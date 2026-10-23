// The MCP tool surface Claude sees. Designs live inside projects: Claude picks or
// creates a project first, then uses the artboard tools against it.
import { applyGrowth, formatReports } from './layout.mjs';
import { BOARD_CSS, boardRoot } from './contract.mjs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { extractTokens } from './tokens.mjs';
import { formatIssues } from './lint.mjs';
import { dialectNote, dialectStylesNote } from './dialect.mjs';
import { artboardToReact, nodeToReact } from './export.mjs';
import { findNodes } from './find.mjs';
import { parse } from 'node-html-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, FAMILIES, toCssDeclarations } from './theme.mjs';
import { slotsOf } from './components.mjs';
import fs from 'node:fs';
import { captureUrl } from './capture.mjs';
import { imageSize } from './meter.mjs';
import { guideText, TOPICS } from './guide.mjs';
import { fontStack, SHORTLIST, SYSTEM_FAMILIES, usedProjectFonts, productionUrl } from './fonts.mjs';
import { readInsideRepo, parseCustomProperties, mapProperties, exportTokens } from './tokensync.mjs';

// Sent once per session with the tool list, so it stays short; the full workflow is in get_guide.
// The first line is a gate: the process and taste rules live in the guide, and clients that skip it skip them.
const INSTRUCTIONS = `Design Canvas: HTML designs on an infinite canvas, shared live with the user.
You MUST call get_guide() once before any other tool: it returns the whole method (workflow, brief, type, layout, review) in one call. Before the first write of a new design post a short brief in chat, then pass it as log_prompt.brief. Only get_guide({topic:"mobile"}) is separate.
Be economical with turns: send independent tool calls together in one turn.
Workflow: list_projects (reuse one if it fits, else create_project) -> log_prompt + create_artboard -> write_html / update_styles -> lint -> one get_screenshot -> finish_working. In a project you just created skip get_basic_info, get_tree and get_comments; use them only in an existing one.
Rules: inline styles only; colours as oklch(); real content, never lorem ipsum; text contrast at least 4.5:1; edit with update_styles or write_html on a parent id instead of rewriting a board; reuse blocks with <x-clone node-id>. Call get_guide for the full guide.`;

// Compact JSON: every result is re-read on each later turn, and pretty-printing adds ~35-40% for nothing the model needs.
const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t) }] });

// Wrap handlers so a thrown error becomes a readable tool error instead of a protocol failure.
const safe = (fn) => async (args) => {
  try {
    return await fn(args ?? {});
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: e.message }] };
  }
};

// Shared optional argument on every design tool.
const pid = { project_id: z.string().optional().describe('Project id (p_xxxxxxxx). Defaults to the active project.') };

export function createMcpServer({ store, ui, fonts, requestScreenshot, requestMeasure, requestComputed, requestCompare, highlight, meter, port }) {
  const server = new McpServer({ name: 'design-canvas', version: '0.3.0' }, { instructions: INSTRUCTIONS });

  // Every tool goes through registerTool, so wrap it once here to meter each result's size
  // instead of touching 25 handlers. The wrapped handler behaves exactly like the original.
  const register = server.registerTool.bind(server);
  server.registerTool = (name, config, handler) =>
    register(name, config, async (...args) => {
      const result = await handler(...args);
      meter?.record(name, result);
      return result;
    });
  const url = (id) => `http://localhost:${port}/p/${id}`;

  // Resolve which project a call targets: explicit id, else the active one.
  const target = (project_id) => {
    const id = project_id ?? store.activeId;
    if (!id) throw new Error('No active project. Call list_projects, then open_project or create_project.');
    const p = store.get(id);
    if (!p || p.meta.deletedAt) throw new Error(`Project ${id} not found (or in Trash). Call list_projects.`);
    return p;
  };
  // Record a design action in the project's Activity (what Claude did, per artboard).
  // `anyId` is one id or a list. Besides the Activity entry this also feeds get_changes (journal)
  // and lights up the touched nodes on the canvas until finish_working or a timeout.
  const log = (meta, doc, tool, anyId, detail) => {
    const ids = [].concat(anyId ?? []);
    const ab = ids[0] ? doc.artboardOf(ids[0]) : null;
    store.logAction(meta.id, { tool, artboardId: ab?.id, artboard: ab?.name, detail });
    doc.record('claude', tool, ids);
    // Remember which boards were edited so finish_working can check that their content still fits.
    const set = ui.touched.get(meta.id) ?? ui.touched.set(meta.id, new Set()).get(meta.id);
    for (const id of ids) { const a = doc.artboardOf(id); if (a) set.add(a.id); }
    if (tool !== 'delete_nodes') highlight?.(meta.id, ids);
  };
  // Ask the browser whether these boards' content fits their frames. `fit` boards are grown to their content
  // here. Returns { text } with one line per problem, or null when no tab is open / it did not answer.
  const checkLayout = async (meta, doc, boardIds) => {
    const boards = boardIds.map((id) => doc.getArtboard(id)).filter((a) => a && !a.generated);
    if (!boards.length) return { text: 'ok: nothing to check' };
    let reports;
    try {
      reports = await requestMeasure(meta.id, boards.map((a) => ({ id: a.id, html: a.html, width: a.width, height: a.height, fit: a.heightMode === 'fit' })));
    } catch { return null; }
    const grown = applyGrowth(doc, reports);
    return { text: formatReports(reports, doc, grown), reports, grown };
  };
  // After a write: one `layout` line only when something does not fit (silent when fine or no tab is open,
  // so the common case costs no tokens).
  const layoutNote = async (meta, doc, anyId) => {
    const ab = doc.artboardOf(anyId);
    const r = ab ? await checkLayout(meta, doc, [ab.id]) : null;
    return r && !r.text.startsWith('ok') ? { layout: r.text } : {};
  };
  const summary = (m) => ({ project_id: m.id, name: m.name, description: m.description, url: url(m.id) });

  // ---- projects ----------------------------------------------------------
  server.registerTool('get_guide', {
    description: 'Read this first, once. No topic = the whole method in one call (workflow, brief, type, layout, review). Single topics (brief, type, layout, review) re-read one part; mobile (status bar, safe areas) is only available as its own topic.',
    inputSchema: { topic: z.enum(Object.keys(TOPICS)).optional() },
  }, safe(({ topic }) => text(guideText(topic))));

  server.registerTool('list_projects', {
    description: 'List all projects (most recently edited first) with ids, names and artboard counts. Call this before creating a project so you reuse an existing one.',
    inputSchema: {},
  }, safe(() => text({
    active_project_id: store.activeId,
    home: `http://localhost:${port}`,
    projects: store.list().sort((a, b) => b.updatedAt - a.updatedAt).map((p) => ({
      ...summary(p), artboards: p.artboardCount, updated: new Date(p.updatedAt).toISOString(),
    })),
  })));

  server.registerTool('create_project', {
    description: 'Create a project and make it active. Name it after what you are building (2-4 words, e.g. the repo or feature). Fails if a project with that name exists: open it instead.',
    inputSchema: { name: z.string().min(1).max(80), description: z.string().max(300).optional() },
  }, safe(({ name, description }) => text(summary(store.create({ name, description, unique: 'error' })))));

  server.registerTool('open_project', {
    description: 'Make an existing project the active one and return its artboards.',
    inputSchema: { project_id: z.string() },
  }, safe(({ project_id }) => {
    const { meta, doc } = target(project_id);
    store.setActive(meta.id);
    return text({ ...summary(meta), ...doc.basicInfo() });
  }));

  server.registerTool('rename_project', {
    description: 'Rename a project, change its description, and/or switch HTML normalization on or off (new projects have it on: classes and <style> dropped, redundant styles stripped, border-box sizing; older projects keep their markup as written).',
    inputSchema: { ...pid, name: z.string().min(1).max(80).optional(), description: z.string().max(300).optional(), normalize: z.boolean().optional() },
  }, safe(({ project_id, name, description, normalize }) => {
    const { meta } = target(project_id);
    return text({ ...summary(store.update(meta.id, { name, description, normalize })), normalize: !!meta.normalize });
  }));

  server.registerTool('delete_project', {
    description: 'Move a project to Trash (the user can restore it from the home page). Only do this when the user asks.',
    inputSchema: { project_id: z.string() },
  }, safe(({ project_id }) => { store.remove(target(project_id).meta.id); return text('Moved to Trash'); }));

  server.registerTool('save_version', {
    description: 'Save a named checkpoint of the project to its version history. Do this before big rewrites.',
    inputSchema: { ...pid, label: z.string().max(80).optional() },
  }, safe(({ project_id, label }) => {
    const { meta } = target(project_id);
    store.snapshot(meta.id, label || 'Saved version', { force: true });
    return text('Version saved');
  }));

  // ---- design tools ------------------------------------------------------

  // ---- history + comments -------------------------------------------------
  server.registerTool('log_prompt', {
    description: "Call at the START of every new user request with the request in the user's own words (one short sentence). Records it in the project's Activity and saves a restore point so the user can undo the whole request.",
    inputSchema: {
      ...pid,
      prompt: z.string().min(1).max(500),
      brief: z.string().min(1).max(1500).optional().describe('For a new design: the brief you posted in chat (mood, palette with oklch roles, type scale, one-sentence direction). Stored with the project and shown in Activity.'),
    },
  }, safe(({ project_id, prompt, brief }) => {
    store.logPrompt(target(project_id).meta.id, prompt, brief);
    return text('Logged');
  }));

  server.registerTool('get_comments', {
    description: 'Comments the user pinned on elements of the design. Each includes the element it points at (tag, text, style) so you can act on it. Returns open comments by default.',
    inputSchema: { ...pid, include_resolved: z.boolean().optional() },
  }, safe(({ project_id, include_resolved }) => {
    const { meta, doc } = target(project_id);
    const list = store.listComments(meta.id).filter((c) => include_resolved || !c.resolved);
    return text(list.map((c) => {
      let element = null;
      try { const n = doc.nodeInfo(c.targetId); element = { tag: n.tag, name: n.name, text: n.text, style: n.style, artboard: n.artboard }; }
      catch { element = doc.getArtboard(c.targetId) ? { artboard: c.targetId } : null; }
      return { comment_id: c.id, target_id: c.targetId, element: element ?? 'element no longer exists', text: c.text, author: c.author, resolved: c.resolved, replies: c.replies };
    }));
  }));

  server.registerTool('reply_comment', {
    description: 'Reply to a comment (say what you changed). The user sees it on the pin.',
    inputSchema: { ...pid, comment_id: z.string(), text: z.string().min(1).max(2000) },
  }, safe(({ project_id, comment_id, text: t }) => { store.replyComment(target(project_id).meta.id, comment_id, { text: t, author: 'claude' }); return text('Replied'); }));

  server.registerTool('resolve_comment', {
    description: 'Mark a comment resolved once you have addressed it.',
    inputSchema: { ...pid, comment_id: z.string(), resolved: z.boolean().optional() },
  }, safe(({ project_id, comment_id, resolved = true }) => { store.setCommentResolved(target(project_id).meta.id, comment_id, resolved); return text(resolved ? 'Resolved' : 'Reopened'); }));

  server.registerTool('get_design_tokens', {
    description:
      'Scan the project and extract its design tokens (colours, fonts, sizes, radii, spacing, shadows) from the styles actually used. Use it to keep new pages consistent with existing ones, or to hand tokens to a codebase. format: summary (default, ranked lists + CSS variables), css, json (W3C design tokens) or tailwind.',
    inputSchema: {
      ...pid,
      format: z.enum(['summary', 'css', 'json', 'tailwind']).optional(),
      artboard_ids: z.array(z.string()).optional().describe('Limit to these artboards (default: all).'),
      node_id: z.string().optional().describe('Scan just this node (e.g. a card you want to turn into tokens) instead of whole artboards.'),
    },
  }, safe(({ project_id, format = 'summary', artboard_ids, node_id }) => {
    const { doc } = target(project_id);
    const boards = node_id
      ? [{ id: node_id, name: 'node', html: doc.nodeInfo(node_id).html }]
      : doc.data.artboards.filter((a) => !artboard_ids || artboard_ids.includes(a.id));
    if (!boards.length) throw new Error('No artboards to scan yet. Create some designs first.');
    const { outputs, ...tokens } = extractTokens(boards);
    return text(format === 'summary' ? { ...tokens, css: outputs.css } : outputs[format]);
  }));
  server.registerTool('get_basic_info', {
    description: 'Project details plus all its artboards with ids, names, positions and sizes.',
    inputSchema: { ...pid },
  }, safe(({ project_id }) => {
    const { meta, doc } = target(project_id);
    return text({ ...summary(meta), ...doc.basicInfo() });
  }));

  server.registerTool('get_selection', {
    description: 'Return the nodes/artboards the user currently has selected in the browser.',
    inputSchema: { ...pid },
  }, safe(({ project_id }) => {
    const { meta, doc } = target(project_id);
    return text((ui.selection.get(meta.id) || []).map((id) => {
      try { return doc.nodeInfo(id); } catch { return doc.getArtboard(id) ?? { id }; }
    }));
  }));

  server.registerTool('create_artboard', {
    description: 'Create an empty artboard (a frame on the canvas). Returns its id. By default the board is height_mode "fit": height is a MINIMUM and the board grows with its content, so nothing is ever cut off. Use "fixed" only when the height must be exact (a 844px phone mockup).',
    inputSchema: {
      ...pid,
      name: z.string().optional(),
      width: z.number().min(40).max(5000).optional(),
      height: z.number().min(40).max(10000).optional().describe('Height in px (minimum height for a fit board). Default 900.'),
      height_mode: z.enum(['fit', 'fixed']).optional().describe('fit (default): grows with content. fixed: exactly this tall; extra content is clipped.'),
      page_id: z.string().optional().describe('Page for the new board (default: the page chosen with set_page, else the first).'),
      x: z.number().optional().describe('Canvas x position (default: placed to the right of the last artboard).'),
      y: z.number().optional().describe('Canvas y position (default 0). Use it to start a new row.'),
    },
  }, safe(({ project_id, ...a }) => {
    const { meta, doc } = target(project_id);
    const { page_id, height_mode = 'fit', ...rest } = a;
    const ab = doc.createArtboard({ ...rest, heightMode: height_mode, page: page_id ?? ui.currentPage.get(meta.id) });
    log(meta, doc, 'create_artboard', ab.id);
    // Soft nudge only (never a refusal): a project with no recorded brief usually means the design method was skipped.
    const reminder = meta.brief ? {} : { reminder: 'No brief is recorded for this project. For a new design, follow the brief section of get_guide, post a brief in chat and pass it to log_prompt.' };
    return text({ ...ab, ...reminder });
  }));

  server.registerTool('write_html', {
    description:
      'Add HTML into an artboard or next to a node (target_id). mode: append (default, last child), prepend (first child), replace (swap children), before / after (siblings of a node). <x-clone node-id="N5"></x-clone> inside the html inserts a copy of that node without resending its markup. Inline styles only. Returns ids of the new top-level nodes.',
    inputSchema: {
      ...pid,
      target_id: z.string().describe('Artboard id (A#) or node id (N#)'),
      html: z.string().max(200_000),
      mode: z.enum(['append', 'prepend', 'replace', 'before', 'after']).optional(),
    },
  }, safe(async ({ project_id, target_id, html, mode }) => {
    const { meta, doc } = target(project_id);
    const created = doc.writeHtml(target_id, html, mode);
    log(meta, doc, 'write_html', target_id);
    // Dialect notes only for projects that normalize (new ones); Sprig and imports keep their own style.
    const dialect = meta.normalize ? dialectNote(html) : '';
    return text({ created, ...(dialect && { dialect }), ...(await layoutNote(meta, doc, target_id)) });
  }));

  server.registerTool('get_tree', {
    description: 'Compact outline, one line per node: id, kind (frame/text/image/svg), name, layout, key styles, [n] hidden children. Far cheaper than HTML: read this first, then get_node_info only for the node you will change. node_id is an artboard or node (default: every artboard); query finds nodes by name or text.',
    inputSchema: { ...pid, node_id: z.string().optional(), depth: z.number().int().min(1).max(10).optional(), query: z.string().min(1).max(100).optional() },
  }, safe(({ project_id, node_id, depth, query }) => text(target(project_id).doc.outline(node_id, { depth, query }) || '(empty)')));

  server.registerTool('get_design_system', {
    description: 'The design tokens as "name: value" lines (modes listed as "name [dark]: value"), then the components with their variants and slots. Reference tokens as var(--name) and components with insert_component. section limits to one token family (color, space, radius, size, font, ...) or "components".',
    inputSchema: { ...pid, section: z.enum([...FAMILIES, 'components']).optional() },
  }, safe(({ project_id, section }) => {
    const { doc } = target(project_id);
    const tokens = section === 'components' ? '' : describe(doc.theme, section);
    const comps = Object.entries(doc.components).map(([name, c]) => {
      const first = Object.values(c.variants)[0];
      const slots = Object.keys(slotsOf(first));
      return `${name}: variants ${Object.keys(c.variants).join(', ')}${slots.length ? ` · slots ${slots.join(', ')}` : ''}`;
    });
    const out = [tokens, section && section !== 'components' ? '' : comps.length ? `components:\n${comps.join('\n')}` : ''].filter(Boolean).join('\n\n');
    return text(out || 'No tokens or components yet. Call set_tokens (preset "starter") and set_component.');
  }));

  server.registerTool('set_tokens', {
    description: 'Create or change design tokens (CSS custom properties). Names start with a family: ' + FAMILIES.join(', ') + ', e.g. color-primary, space-4, radius-md. Values are CSS (colours as oklch()). null deletes a token. mode "dark" writes overrides for that mode only. preset "starter" first loads a ready scale (semantic colours, 4px spacing, radii, type) into an empty theme. Designs use var(--color-primary), so changing a token restyles every board that uses it.',
    inputSchema: {
      ...pid,
      tokens: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
      mode: z.string().optional(),
      preset: z.literal('starter').optional(),
    },
  }, safe(({ project_id, tokens = {}, mode, preset }) => {
    const { meta, doc } = target(project_id);
    const changed = doc.setTokens(tokens, { mode, preset });
    log(meta, doc, 'set_tokens', []);
    return text({ changed, total: Object.keys(doc.theme.tokens).length });
  }));

  server.registerTool('create_foundations', {
    description: 'Create (or refresh) the read-only "Foundations" artboard generated from the tokens: colour swatches per mode, type scale, spacing, radius and shadow samples. It updates itself whenever tokens change. Requires tokens (set_tokens).',
    inputSchema: { ...pid },
  }, safe(({ project_id }) => {
    const { meta, doc } = target(project_id);
    const ab = doc.createFoundations();
    log(meta, doc, 'create_foundations', ab.id);
    return text({ artboard_id: ab.id, width: ab.width, height: ab.height });
  }));

  server.registerTool('set_component', {
    description: 'Create a component or replace all of its variants, then update every instance in every artboard. variants maps a variant name to one HTML root element (inline styles, preferably var(--tokens)); mark text that differs per instance with data-slot="label". Example: {"default": "<button style=\"...\"><span data-slot=\"label\">Button</span></button>", "primary": "..."}. Insert instances with insert_component. Instance text in slots survives a master edit; other edits made inside an instance are replaced by the master.',
    inputSchema: { ...pid, name: z.string(), variants: z.record(z.string(), z.string().max(20_000)) },
  }, safe(({ project_id, name, variants }) => {
    const { meta, doc } = target(project_id);
    const r = doc.setComponent(name, variants);
    log(meta, doc, 'set_component', []);
    return text({ name, variants: Object.keys(variants), ...r });
  }));

  server.registerTool('insert_component', {
    description: 'Insert an instance of a component. target_id is an artboard or node; mode as in write_html (append, prepend, before, after). slots fills data-slot text, e.g. {"label": "Save"}. Returns the new node id. Far cheaper than writing the markup again.',
    inputSchema: {
      ...pid, target_id: z.string(), name: z.string(), variant: z.string().optional(),
      slots: z.record(z.string(), z.string()).optional(),
      mode: z.enum(['append', 'prepend', 'before', 'after']).optional(),
    },
  }, safe(({ project_id, target_id, name, variant, slots = {}, mode }) => {
    const { meta, doc } = target(project_id);
    const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const tag = `<x-component name="${attr(name)}"${variant ? ` variant="${attr(variant)}"` : ''}${Object.entries(slots).map(([k, v]) => ` slot-${attr(k)}="${attr(v)}"`).join('')}></x-component>`;
    const created = doc.writeHtml(target_id, tag, mode);
    log(meta, doc, 'insert_component', created);
    return text({ created });
  }));

  server.registerTool('detach_component', {
    description: 'Turn one component instance into ordinary nodes so it stops following its master.',
    inputSchema: { ...pid, node_id: z.string() },
  }, safe(({ project_id, node_id }) => { const { meta, doc } = target(project_id); doc.detach(node_id); log(meta, doc, 'detach_component', node_id); return text('ok'); }));

  server.registerTool('delete_component', {
    description: 'Delete a component. Its instances stay in the designs as ordinary nodes.',
    inputSchema: { ...pid, name: z.string() },
  }, safe(({ project_id, name }) => { const { meta, doc } = target(project_id); doc.deleteComponent(name); log(meta, doc, 'delete_component', []); return text('ok'); }));

  server.registerTool('create_components_sheet', {
    description: 'Create (or refresh) the read-only "Components" artboard that shows every component and variant. It updates itself when components change.',
    inputSchema: { ...pid },
  }, safe(({ project_id }) => {
    const { meta, doc } = target(project_id);
    const ab = doc.createComponentsSheet();
    log(meta, doc, 'create_components_sheet', ab.id);
    return text({ artboard_id: ab.id, height: ab.height });
  }));

  server.registerTool('move_node', {
    description: 'Move a node (keeping its ids) before / after another node, or into it as first (start) or last (end) child. target_id may be an artboard with start or end. Reorders layers.',
    inputSchema: { ...pid, node_id: z.string(), target_id: z.string(), position: z.enum(['before', 'after', 'start', 'end']).optional().describe('Default end (last child of the target).') },
  }, safe(({ project_id, node_id, target_id, position }) => {
    const { meta, doc } = target(project_id);
    const from = doc.parentOf(node_id); // read before the move: afterwards the old parent is gone from the node
    doc.moveNode(node_id, target_id, position);
    log(meta, doc, 'move_node', node_id);
    // Both parents change size/layout, so name them (Paper's affectedParents) for the follow-up check.
    const to = doc.parentOf(node_id);
    return text({ ok: true, affectedParents: [...new Set([from, to].filter(Boolean))] });
  }));

  server.registerTool('set_flags', {
    description: 'Hide / show nodes (hidden) or lock / unlock them (locked: nobody can edit a locked node or what is inside it until it is unlocked).',
    inputSchema: { ...pid, node_ids: z.array(z.string()).min(1), hidden: z.boolean().optional(), locked: z.boolean().optional() },
  }, safe(({ project_id, node_ids, hidden, locked }) => {
    const { meta, doc } = target(project_id);
    doc.setFlags(node_ids, { hidden, locked });
    log(meta, doc, 'set_flags', node_ids);
    return text('ok');
  }));

  server.registerTool('link_repo', {
    description: 'Link the project to the folder of your code (an absolute path) so tokens can be imported from its stylesheets. Pass null to unlink. Files are only ever read from inside this folder.',
    inputSchema: { ...pid, path: z.string().nullable() },
  }, safe(({ project_id, path: repoPath }) => {
    const { meta } = target(project_id);
    store.update(meta.id, { repo: repoPath });
    return text(meta.repo ? { repo: meta.repo } : 'Unlinked');
  }));

  server.registerTool('import_tokens', {
    description: 'Read CSS custom properties from a stylesheet in the linked repo (path relative to the repo, e.g. src/styles.css) into the project tokens. selector picks the rule: default :root; use ".dark" with mode "dark" to import dark-mode overrides. Names starting with a token family are kept; others are classified by name and value (--brand: oklch(...) becomes color-brand); anything unclear is reported in skipped and not imported.',
    inputSchema: { ...pid, file: z.string(), selector: z.string().optional(), mode: z.string().optional(), dry_run: z.boolean().optional() },
  }, safe(({ project_id, file, selector, mode, dry_run }) => {
    const { meta, doc } = target(project_id);
    const props = parseCustomProperties(readInsideRepo(meta.repo, file), selector);
    if (!Object.keys(props).length) throw new Error(`No custom properties found in ${file} for selector ${selector ?? ':root'}`);
    const { tokens, skipped } = mapProperties(props);
    if (!dry_run && Object.keys(tokens).length) { doc.setTokens(tokens, { mode }); log(meta, doc, 'import_tokens', []); }
    return text({ imported: dry_run ? [] : Object.keys(tokens), would_import: dry_run ? tokens : undefined, skipped });
  }));

  server.registerTool('export_tokens', {
    description: 'The project tokens as text you can paste into a codebase: css (:root plus [data-theme] blocks for modes), tailwind (an @theme block) or json.',
    inputSchema: { ...pid, format: z.enum(['css', 'tailwind', 'json']).optional() },
  }, safe(({ project_id, format = 'css' }) => text(exportTokens(target(project_id).doc.theme, format))));

  server.registerTool('create_page', {
    description: 'Add a page (a separate canvas inside the project, for example one per flow or per breakpoint). Returns its id. New artboards go to the page chosen with set_page.',
    inputSchema: { ...pid, name: z.string().min(1).max(60) },
  }, safe(({ project_id, name }) => {
    const { meta, doc } = target(project_id);
    const page = doc.createPage(name);
    log(meta, doc, 'create_page', []);
    return text(page);
  }));

  server.registerTool('set_page', {
    description: 'Choose the page that new artboards are created on (until you change it again). get_basic_info lists the pages.',
    inputSchema: { ...pid, page_id: z.string() },
  }, safe(({ project_id, page_id }) => {
    const { meta, doc } = target(project_id);
    doc._pageId(page_id); // throws a helpful error for an unknown page
    ui.currentPage.set(meta.id, page_id);
    return text(`New artboards will go to ${page_id}`);
  }));

  server.registerTool('update_page', {
    description: 'Rename a page and/or set its canvas background colour (e.g. oklch(0.2 0 0); empty string clears it).',
    inputSchema: { ...pid, page_id: z.string(), name: z.string().max(60).optional(), background: z.string().max(60).optional() },
  }, safe(({ project_id, page_id, name, background }) => {
    const { meta, doc } = target(project_id);
    const page = doc.updatePage(page_id, { name, background });
    log(meta, doc, 'update_page', []);
    return text(page);
  }));

  server.registerTool('delete_page', {
    description: 'Delete a page. Its artboards are moved to move_boards_to (default: the first remaining page), never deleted.',
    inputSchema: { ...pid, page_id: z.string(), move_boards_to: z.string().optional() },
  }, safe(({ project_id, page_id, move_boards_to }) => {
    const { meta, doc } = target(project_id);
    const dest = doc.deletePage(page_id, move_boards_to);
    if (ui.currentPage.get(meta.id) === page_id) ui.currentPage.delete(meta.id);
    log(meta, doc, 'delete_page', []);
    return text({ deleted: page_id, boards_moved_to: dest });
  }));

  server.registerTool('move_to_page', {
    description: 'Move artboards to another page.',
    inputSchema: { ...pid, artboard_ids: z.array(z.string()).min(1), page_id: z.string() },
  }, safe(({ project_id, artboard_ids, page_id }) => {
    const { meta, doc } = target(project_id);
    doc.moveToPage(artboard_ids, page_id);
    log(meta, doc, 'move_to_page', artboard_ids);
    return text('ok');
  }));

  server.registerTool('add_reference_image', {
    description: 'Add a picture to rebuild a design from (a screenshot of a page or an app). Give an absolute file path on this machine (PNG, JPEG, GIF or WebP, up to 10 MB). It appears on the canvas as a locked "Reference" board; build your own artboard next to it, then call compare_to_reference to see how close you are.',
    inputSchema: { ...pid, path: z.string(), name: z.string().max(80).optional(), page_id: z.string().optional() },
  }, safe(({ project_id, path: file, name, page_id }) => {
    const { meta, doc } = target(project_id);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`File not found: ${file}`);
    if (fs.statSync(file).size > 10_000_000) throw new Error('Image too large (10 MB max)');
    const { ref, board } = store.addReference(meta.id, { name: name || file.split(/[\\/]/).pop().replace(/\.[^.]+$/, ''), buffer: fs.readFileSync(file), page: page_id ?? ui.currentPage.get(meta.id) });
    log(meta, doc, 'add_reference_image', board.id);
    return text({ reference_id: ref.id, artboard_id: board.id, width: ref.width, height: ref.height });
  }));

  // Copy a live web page: headless browser -> flat inline-styled HTML -> artboard (+ screenshot as a reference board).
  server.registerTool('capture_url', {
    description: 'Copy a live web page into a new artboard, plus a screenshot of it as a locked reference board (so compare_to_reference works). Starts a throwaway headless Chrome/Edge, so no tab is needed. The copy is a frozen, flat layout (divs and spans with inline styles; no links, forms or scripts) at the given width: use it to study or restyle a real page, not as production markup. Colours stay as the page had them (rgb) and web fonts are not loaded (use_font if needed). Only public http(s) pages; localhost and private networks need allow_private: true. Takes up to ~30 s.',
    inputSchema: {
      ...pid,
      url: z.string().max(2000).describe('http(s) address of the page'),
      width: z.number().int().min(320).max(2560).optional().describe('Viewport width in px (default 1280). Use 390 for a mobile layout.'),
      name: z.string().max(80).optional().describe('Artboard name (default: the page title).'),
      page_id: z.string().optional(),
      allow_private: z.boolean().optional().describe('Allow localhost / private network addresses. Only when the user clearly means a local page.'),
    },
  }, safe(async ({ project_id, url: pageUrl, width, name, page_id, allow_private }) => {
    const { meta, doc } = target(project_id);
    const cap = await captureUrl(pageUrl, { width, allowPrivate: allow_private });
    const page = page_id ?? ui.currentPage.get(meta.id);
    const ab = doc.createArtboard({ name: (name || cap.title || 'Captured page').slice(0, 80), width: cap.width, height: Math.max(40, cap.height), heightMode: 'fit', page });
    // normalize:false -> the copy is written as captured; the sanitizer still runs on it.
    doc.writeHtml(ab.id, cap.html, 'replace', { normalize: false });
    const { ref, board } = store.addReference(meta.id, { name: `${ab.name} (screenshot)`.slice(0, 80), buffer: cap.screenshot, page });
    log(meta, doc, 'capture_url', ab.id, cap.finalUrl);
    return text({ artboard_id: ab.id, reference_id: ref.id, reference_artboard_id: board.id, width: cap.width, height: cap.height, nodes: cap.nodes, url: cap.finalUrl, ...(cap.truncated && { warning: 'The page was larger than the capture limits, so the copy is cut off.' }) });
  }));

  server.registerTool('compare_to_reference', {
    description: 'Compare an artboard with a reference image pixel by pixel (both scaled to the same width, at most 800 px). Returns the share of pixels that differ, the worst areas of a 4x4 grid, and a diff image (red = different, faded reference elsewhere). Use it to fix the biggest differences first; stop after 3 rounds or when different is under about 5%. Needs the project open in a browser tab.',
    inputSchema: { ...pid, artboard_id: z.string(), reference_id: z.string().optional().describe('Default: the most recently added reference.') },
  }, safe(async ({ project_id, artboard_id, reference_id }) => {
    const { meta, doc } = target(project_id);
    const ab = doc.getArtboard(artboard_id);
    if (!ab) throw new Error(`Artboard ${artboard_id} not found`);
    if (ab.generated === 'reference') throw new Error('Pick your own artboard, not a reference board');
    const ref = reference_id ? doc.references.find((r) => r.id === reference_id) : doc.references.at(-1);
    if (!ref) throw new Error(doc.references.length ? `Reference ${reference_id} not found` : 'No reference images yet. Call add_reference_image first.');
    const r = await requestCompare(meta.id, artboard_id, ref.id);
    const { dataUrl, ...summary } = r;
    return { content: [{ type: 'text', text: JSON.stringify({ reference_id: ref.id, ...summary }) }, { type: 'image', data: dataUrl.split(',')[1], mimeType: 'image/jpeg' }] };
  }));

  server.registerTool('delete_reference', {
    description: 'Remove a reference image and its board.',
    inputSchema: { ...pid, reference_id: z.string() },
  }, safe(({ project_id, reference_id }) => { const { meta, doc } = target(project_id); doc.deleteReference(reference_id); log(meta, doc, 'delete_reference', []); return text('ok'); }));

  server.registerTool('get_changes', {
    description: 'What the USER changed by hand (moved, resized, renamed, deleted, duplicated or created artboards) since you last called this, so you never re-read a whole board to find out. Pass since_version to look further back; the returned version is what to pass next time.',
    inputSchema: { ...pid, since_version: z.number().int().min(0).optional() },
  }, safe(({ project_id, since_version }) => {
    const { meta, doc } = target(project_id);
    const from = since_version ?? ui.lastRead.get(meta.id) ?? 0;
    const changes = doc.changesSince(from, 'user').map((c) => ({
      version: c.version, action: c.tool, ids: c.ids,
      // Outline lines only for things that still exist, one line each.
      now: c.ids.map((id) => { try { return doc.outline(id, { depth: 0 }).split('\n')[0]; } catch { return `${id} (deleted)`; } }),
    }));
    ui.lastRead.set(meta.id, doc.version);
    return text({ version: doc.version, changes: changes.length ? changes : 'none' });
  }));

  server.registerTool('finish_working', {
    description: 'Call when you are done with a task: clears the highlight the canvas shows on nodes you were editing, and checks that every board you edited still fits its frame. If it reports a problem, fix it (fit_artboard, narrower widths) and call finish_working again.',
    inputSchema: { ...pid },
  }, safe(async ({ project_id }) => {
    const { meta, doc } = target(project_id);
    highlight?.(meta.id, []);
    const ids = [...(ui.touched.get(meta.id) ?? [])];
    const r = ids.length ? await checkLayout(meta, doc, ids) : null;
    // Clear only when the check ran: with no browser tab the boards stay "touched" for the next attempt.
    if (r || !ids.length) ui.touched.delete(meta.id);
    if (!r) return text(ids.length ? 'ok (layout not checked: open the project in a browser tab to verify nothing is clipped)' : 'ok');
    return text(r.text.startsWith('ok') ? 'ok' : `Not finished, content does not fit:\n${r.text}`);
  }));

  server.registerTool('check_layout', {
    description: 'Measure real layout in the browser and report content that does not fit its artboard: content taller or wider than the frame, nodes that extend past it, nodes that clip their own content. Boards in fit mode are grown to their content automatically. Omit artboard_id to check every board on the current page (max 20). Needs the project open in a browser tab.',
    inputSchema: { ...pid, artboard_id: z.string().optional() },
  }, safe(async ({ project_id, artboard_id }) => {
    const { meta, doc } = target(project_id);
    if (artboard_id && !doc.getArtboard(artboard_id)) throw new Error(`Artboard ${artboard_id} not found`);
    const page = doc._pageId(ui.currentPage.get(meta.id));
    const ids = artboard_id ? [artboard_id] : doc.data.artboards.filter((a) => doc.pageOf(a) === page).slice(0, 20).map((a) => a.id);
    const r = await checkLayout(meta, doc, ids);
    if (!r) throw new Error(`Open the project in a browser tab first: ${url(meta.id)}`);
    return text(r.text);
  }));

  server.registerTool('fit_artboard', {
    description: 'Make a board fit its content: switches it to fit mode and sets its height to exactly what the content needs (not below min_height). This is the one-call fix for a clipped board; never delete and rebuild a board for an overflow. Needs the project open in a browser tab to measure; without one it only switches the mode.',
    inputSchema: { ...pid, artboard_id: z.string(), min_height: z.number().min(40).max(10000).optional() },
  }, safe(async ({ project_id, artboard_id, min_height }) => {
    const { meta, doc } = target(project_id);
    const ab = doc.getArtboard(artboard_id);
    if (!ab) throw new Error(`Artboard ${artboard_id} not found`);
    let content = null;
    try {
      const [r] = await requestMeasure(meta.id, [{ id: ab.id, html: ab.html, width: ab.width, height: ab.height, fit: true }]);
      content = r.contentHeight;
    } catch { /* no tab: mode only */ }
    doc.fitArtboard(ab.id, content, min_height);
    log(meta, doc, 'fit_artboard', ab.id);
    return text({ artboard_id: ab.id, height: ab.height, height_mode: 'fit', measured: content != null });
  }));

  server.registerTool('lint', {
    description: 'Check an artboard or node (var(--token) values are resolved; mode checks a token mode) for undefined tokens, text contrast below WCAG AA, text under 12px, spacing off the grid (4px by default, grid 2 for designs that use half-steps), fixed widths wider than the artboard, off-artboard absolute offsets, images without alt and lorem ipsum. Returns one line per issue, or "clean". Cheap: run it before get_screenshot. It reads inline styles only: for overflow and clipping use check_layout.',
    inputSchema: { ...pid, id: z.string().describe('Artboard id (A#) or node id (N#)'), grid: z.union([z.literal(2), z.literal(4)]).optional().describe('Spacing grid in px (default 4).'), mode: z.string().optional().describe('Token mode to check, e.g. dark (default: base tokens).') },
  }, safe(({ project_id, id, grid, mode }) => text(formatIssues(target(project_id).doc.lint(id, { grid, mode })))));

  // ---- fonts -------------------------------------------------------------
  server.registerTool('list_fonts', {
    description: 'Fonts you may use: system stacks (always available), this project\'s loaded Google Fonts (with the exact font-family value) and a short Google shortlist by category. Any other font name silently falls back, and lint flags it. Load a Google Font with use_font.',
    inputSchema: { ...pid },
  }, safe(({ project_id }) => {
    const { meta } = target(project_id);
    return text({
      system: ['system-ui, -apple-system, "Segoe UI", sans-serif', 'ui-serif, Georgia, serif', 'ui-monospace, Menlo, Consolas, monospace', ...SYSTEM_FAMILIES.map((f) => `"${f}"`)],
      project: (meta.fonts ?? []).map((f) => ({ family: f.family, css: fontStack(f.family), weights: [...new Set(f.faces.map((x) => x.weight))], italic: f.faces.some((x) => x.style === 'italic') })),
      google_shortlist: SHORTLIST,
      note: 'Call use_font({family, weights}) before using a shortlist or any other Google family.',
    });
  }));

  server.registerTool('use_font', {
    description: 'Load a Google Font into the project so boards and screenshots render it. The server downloads the files once (latin subset, cached on disk) and returns the exact font-family value to paste. Call it before styling with the family; ask for every weight you will use. Errors (unknown family, offline, bad weight) are returned instead of a silent fallback.',
    inputSchema: {
      ...pid,
      family: z.string().describe('Google Fonts family name, e.g. "DM Sans".'),
      weights: z.array(z.number().int()).min(1).max(6).optional().describe('Weights to load, 100-900 in steps of 100 (default 400 and 700).'),
      italic: z.boolean().optional().describe('Also load italics for these weights.'),
      category: z.enum(['sans', 'serif', 'mono', 'display']).optional().describe('Picks the generic fallback in the returned stack (default: from the shortlist, else sans).'),
    },
  }, safe(async ({ project_id, family, weights, italic, category }) => {
    const { meta, doc } = target(project_id);
    const font = await fonts.ensure(family, weights, italic);
    store.addFont(meta.id, font);
    store.logAction(meta.id, { tool: 'use_font', detail: `${font.family} ${[...new Set(font.faces.map((f) => f.weight))].join(',')}` });
    return text({
      family: font.family,
      css: fontStack(font.family, category),
      weights: [...new Set(font.faces.map((f) => f.weight))],
      italic: font.faces.some((f) => f.style === 'italic'),
      note: 'Paste css as the font-family value. Only the listed weights exist; others are synthesized.',
    });
  }));

  server.registerTool('undo', {
    description: 'Revert the last design change(s) made through update_styles, write_html, set_text_content, rename, duplicate, delete or create_artboard. Returns what was reverted.',
    inputSchema: { ...pid, steps: z.number().int().min(1).max(20).optional() },
  }, safe(({ project_id, steps = 1 }) => {
    const { meta, doc } = target(project_id);
    const reverted = doc.undo(steps);
    if (!reverted.length) return text('Nothing to undo');
    store.logAction(meta.id, { tool: 'undo', detail: reverted.join(', ') });
    return text({ reverted });
  }));

  server.registerTool('redo', {
    description: 'Re-apply changes that undo reverted (only until the next new change is made).',
    inputSchema: { ...pid, steps: z.number().int().min(1).max(20).optional() },
  }, safe(({ project_id, steps = 1 }) => {
    const { meta, doc } = target(project_id);
    const redone = doc.redo(steps, 'claude');
    if (!redone.length) return text('Nothing to redo');
    store.logAction(meta.id, { tool: 'redo', detail: redone.join(', ') });
    return text({ redone });
  }));

  server.registerTool('get_tree_summary', {
    description: 'Indented outline of an artboard with node ids and short text, for choosing edit targets.',
    inputSchema: { ...pid, artboard_id: z.string(), depth: z.number().min(1).max(12).optional() },
  }, safe(({ project_id, artboard_id, depth }) => text(target(project_id).doc.treeSummary(artboard_id, depth))));

  server.registerTool('get_node_info', {
    description: 'Details of one node: tag, inline style, text, child ids and its HTML.',
    inputSchema: { ...pid, node_id: z.string() },
  }, safe(({ project_id, node_id }) => text(target(project_id).doc.nodeInfo(node_id))));

  server.registerTool('update_styles', {
    description: 'Merge CSS properties (camelCase or kebab-case) into one or more nodes. Use null to remove a property.',
    inputSchema: {
      ...pid,
      node_ids: z.array(z.string()).min(1),
      styles: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
    },
  }, safe(async ({ project_id, node_ids, styles }) => {
    const { meta, doc } = target(project_id);
    doc.updateStyles(node_ids, styles);
    log(meta, doc, 'update_styles', node_ids);
    const note = await layoutNote(meta, doc, node_ids[0]);
    const dialect = meta.normalize ? dialectStylesNote(styles) : '';
    return text(note.layout || dialect ? { ok: true, ...note, ...(dialect && { dialect }) } : 'ok');
  }));

  server.registerTool('set_text_content', {
    description: 'Replace the text inside a node (plain text; markup is escaped).',
    inputSchema: { ...pid, node_id: z.string(), text: z.string() },
  }, safe(({ project_id, node_id, text: t }) => {
    const { meta, doc } = target(project_id);
    doc.setText(node_id, t);
    log(meta, doc, 'set_text_content', node_id);
    return text('ok');
  }));

  server.registerTool('rename_nodes', {
    description: 'Give nodes or artboards friendly names. Map of id to new name.',
    inputSchema: { ...pid, names: z.record(z.string(), z.string()) },
  }, safe(({ project_id, names }) => {
    const { meta, doc } = target(project_id);
    doc.renameNodes(names);
    log(meta, doc, 'rename_nodes', Object.keys(names));
    return text('ok');
  }));

  server.registerTool('duplicate_nodes', {
    description: 'Duplicate nodes (placed right after the original) or artboards. Returns new ids.',
    inputSchema: { ...pid, ids: z.array(z.string()).min(1) },
  }, safe(({ project_id, ids }) => {
    const { meta, doc } = target(project_id);
    const { created, idMap } = doc.duplicateNodes(ids, { withMap: true });
    log(meta, doc, 'duplicate_nodes', created);
    // idMap: original id -> copy id for every descendant, so the copy can be edited without a get_tree.
    return text({ created, descendantIdMap: idMap });
  }));

  server.registerTool('delete_nodes', {
    description: 'Delete nodes or whole artboards.',
    inputSchema: { ...pid, ids: z.array(z.string()).min(1) },
  }, safe(({ project_id, ids }) => {
    const { meta, doc } = target(project_id);
    log(meta, doc, 'delete_nodes', ids[0]); // log first: afterwards the artboard may be gone
    doc.journal.at(-1).ids = ids;
    doc.deleteNodes(ids);
    return text('ok');
  }));

  server.registerTool('get_screenshot', {
    description: 'Render an artboard (or just one node, via node_id) so you can review your work. Defaults are token-lean: 1x, max 800 px wide, cut at 1600 px tall (a note says where; use node_id for the rest), JPEG. Use node_id to look at one component instead of the whole board; ask for scale 2 or png only when you must read tiny text. Requires the project to be open in a browser tab.',
    inputSchema: {
      ...pid,
      artboard_id: z.string(),
      node_id: z.string().optional().describe('Crop to this node (must be inside the artboard).'),
      scale: z.number().min(0.25).max(2).optional(),
      max_width: z.number().int().min(200).max(2000).optional(),
      max_height: z.number().int().min(400).max(8000).optional().describe('Output px; taller images are cut at the bottom. Default 1600.'),
      format: z.enum(['jpeg', 'png']).optional(),
    },
  }, safe(async ({ project_id, artboard_id, node_id, scale, max_width, max_height = 1600, format = 'jpeg' }) => {
    const { meta, doc } = target(project_id);
    if (!doc.getArtboard(artboard_id)) throw new Error(`Artboard ${artboard_id} not found`);
    if (node_id && doc.artboardOf(node_id)?.id !== artboard_id) throw new Error(`Node ${node_id} is not inside ${artboard_id}`);
    const dataUrl = await requestScreenshot(meta.id, artboard_id, { nodeId: node_id, scale, maxWidth: max_width, maxHeight: max_height, format });
    const data = dataUrl.split(',')[1], mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
    const content = [{ type: 'image', data, mimeType }];
    // Tokens grow with pixel area, so tall boards are cut, not shrunk. The browser cuts at exactly max_height and
    // still replies with a plain data URL, so an image that tall is taken as cut (a board exactly that tall is rare).
    const size = imageSize(data, mimeType);
    if (size && size.h >= max_height) {
      const where = node_id ? `${size.h} px into the node` : `y=${Math.round((size.h * doc.getArtboard(artboard_id).width) / size.w)} of the board`;
      content.push({ type: 'text', text: `Image cut at ${size.h} px tall (${where}). Use node_id on a lower section, or a larger max_height, to see the rest.` });
    }
    return { content };
  }));

  server.registerTool('get_computed_styles', {
    description: 'Computed CSS (as the browser resolved it) for nodes, only the properties you ask for, e.g. ["width","height","color","font-size"]. Use it to check real sizes and colours instead of guessing from inline styles. Requires the project open in a browser tab.',
    inputSchema: {
      ...pid,
      node_ids: z.array(z.string()).min(1).max(20),
      props: z.array(z.string().regex(/^[a-z-]+$/)).min(1).max(20).describe('Kebab-case CSS property names'),
    },
  }, safe(async ({ project_id, node_ids, props }) => {
    const { meta, doc } = target(project_id);
    for (const id of node_ids) if (!doc.artboardOf(id)) throw new Error(`Node ${id} not found`);
    return text(await requestComputed(meta.id, node_ids, props));
  }));

  server.registerTool('export_react', {
    description: 'Return an artboard as a React component (JSX). Each inline style becomes one Tailwind arbitrary-property class, so it renders like the canvas; replace them with your own utilities or tokens afterwards. Needs Tailwind in the target app.',
    inputSchema: { ...pid, artboard_id: z.string() },
  }, safe(({ project_id, artboard_id }) => {
    const { meta, doc } = target(project_id);
    const ab = doc.getArtboard(artboard_id);
    if (!ab) throw new Error(`Artboard ${artboard_id} not found`);
    return text(artboardToReact(ab, doc.theme, usedProjectFonts(ab.html, meta.fonts).map(productionUrl)));
  }));

  server.registerTool('export_html', {
    description: 'Return a standalone HTML document for an artboard, ready to save or hand to a codebase.',
    inputSchema: { ...pid, artboard_id: z.string() },
  }, safe(({ project_id, artboard_id }) => {
    const { meta, doc } = target(project_id);
    const ab = doc.getArtboard(artboard_id);
    if (!ab) throw new Error(`Artboard ${artboard_id} not found`);
    // Google Fonts the board uses: in production they load from Google, so link them (the canvas serves local copies).
    const fontLinks = usedProjectFonts(ab.html, meta.fonts).map((f) => `<link rel="stylesheet" href="${productionUrl(f)}">`).join('');
    const clean = ab.html.replace(/ data-pid="[^"]*"/g, '');
    // Tokens become :root custom properties; a "dark" mode (if any) follows the OS setting.
    const { tokens, modes } = doc.theme;
    const css = Object.keys(tokens).length
      ? `<style>:root{${toCssDeclarations(tokens)}}${modes.dark ? `@media (prefers-color-scheme:dark){:root{${toCssDeclarations(modes.dark)}}}` : ''}</style>`
      : '';
    return text(`<!doctype html>\n<html><head><meta charset="utf-8"><title>${ab.name.replace(/[<>&]/g, '')}</title><style>${BOARD_CSS}</style>${fontLinks}${css}</head>\n<body style="margin:0"><div style="width:${ab.width}px;min-height:${ab.height}px;display:flex;flex-direction:column">${boardRoot(true, clean)}</div></body></html>`);
  }));


  // ---- find / subtree export / file export (small tools; kept in one block) ---------------
  server.registerTool('find_nodes', {
    description: 'Search nodes by text or name (query), tag, data-component or an inline-style substring (e.g. "flex", "oklch(0.6"). Filters combine with AND. Returns ids with short labels, so you can pick edit targets without reading a whole tree. Scope with artboard_id or page; default is the whole project.',
    inputSchema: {
      ...pid,
      query: z.string().optional().describe("Matches a node's data-name or its own text, case-insensitive."),
      name: z.string().optional().describe('Substring of data-name.'),
      tag: z.string().optional().describe('Exact tag, e.g. button, img, h1.'),
      component: z.string().optional().describe('Exact data-component name.'),
      style: z.string().optional().describe('Substring of the inline style, e.g. "display: flex" or "border-radius".'),
      artboard_id: z.string().optional(),
      page: z.string().optional().describe('Page id.'),
      limit: z.number().int().min(1).max(100).optional(),
    },
  }, safe(({ project_id, ...opts }) => text(findNodes(target(project_id).doc, opts))));

  server.registerTool('get_jsx', {
    description: 'React + Tailwind (JSX) for ONE node and its subtree, same output style as export_react (each inline style becomes an arbitrary-property class). Use it to hand a single component to a codebase instead of the whole board.',
    inputSchema: { ...pid, node_id: z.string() },
  }, safe(({ project_id, node_id }) => {
    const { meta, doc } = target(project_id);
    if (doc.getArtboard(node_id)) throw new Error(`${node_id} is an artboard: use export_react`);
    const info = doc.nodeInfo(node_id);
    const el = parse(info.html, { comment: false }).firstChild;
    return text(nodeToReact(el, info.name || info.tag, doc.theme, usedProjectFonts(info.html, meta.fonts).map(productionUrl)));
  }));

  // PNG only: the render round-trip yields a bitmap. A PDF would need the browser's print pipeline
  // (and would lose the exact canvas rendering), so it is deliberately not offered.
  const EXPORT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'exports');
  server.registerTool('export', {
    description: 'Render an artboard (or one node via node_id) to a PNG file on disk and return its path. Default scale 2 (retina). Works without an open tab when Chrome/Edge is installed. Files go to data/exports/<project_id>/ unless dir is given.',
    inputSchema: {
      ...pid,
      artboard_id: z.string(),
      node_id: z.string().optional().describe('Crop to this node (must be inside the artboard).'),
      scale: z.number().min(0.25).max(4).optional(),
      dir: z.string().optional().describe('Absolute output folder (created if missing). Default data/exports/<project_id>.'),
    },
  }, safe(async ({ project_id, artboard_id, node_id, scale = 2, dir }) => {
    const { meta, doc } = target(project_id);
    const ab = doc.getArtboard(artboard_id);
    if (!ab) throw new Error(`Artboard ${artboard_id} not found`);
    if (node_id && doc.artboardOf(node_id)?.id !== artboard_id) throw new Error(`Node ${node_id} is not inside ${artboard_id}`);
    if (dir && !path.isAbsolute(dir)) throw new Error('dir must be an absolute path');
    const dataUrl = await requestScreenshot(meta.id, artboard_id, { nodeId: node_id, scale, maxWidth: 8000, format: 'png' });
    const out = dir ? path.resolve(dir) : path.join(EXPORT_DIR, meta.id);
    fs.mkdirSync(out, { recursive: true });
    // The file name is generated from the board/node name, never taken from the caller (no path tricks).
    const label = (node_id ? doc.nodeInfo(node_id).name ?? '' : ab.name).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'export';
    const file = path.join(out, `${label}-${node_id ?? artboard_id}@${scale}x.png`);
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    fs.writeFileSync(file, buf);
    return text({ path: file, bytes: buf.length });
  }));

  return server;
}
