// The MCP tool surface Claude sees. Designs live inside projects: Claude picks or
// creates a project first, then uses the artboard tools against it.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { extractTokens } from './tokens.mjs';
import { formatIssues } from './lint.mjs';
import { artboardToReact } from './export.mjs';

const GUIDE = `Design Canvas workflow:
0. PROJECTS FIRST. Call list_projects. If one already matches the thing you are building, open_project it; otherwise create_project with a short (2-4 word) name taken from what you are working on (the repo, product or feature, e.g. "Checkout redesign"), plus a one-line description. Never create a second project for the same work. After create/open, pass the returned project_id on every later call so parallel sessions don't mix up projects.
0b. LOG THE REQUEST. At the start of every new user request, call log_prompt with the request in the user's own words (one short sentence). It records the request in the project's Activity and saves a restore point so the user can roll back to before it.
1. get_basic_info to see the project's artboards; get_tree for a compact outline (use query to find a node by name or text).
2. create_artboard, then write_html into it. Add roughly one visual group (header, hero, card row) per call.
3. Style with inline style attributes only (flexbox/grid are fine). No <script>, <link> or event handlers: they are stripped.
4. Every element gets a stable id (data-pid). Use get_tree_summary to see ids, then update_styles / set_text_content / delete_nodes to refine instead of rewriting. Repeat a block with <x-clone node-id="N5"></x-clone> in write_html; undo reverts a bad change. Nodes marked data-locked can't be edited.
5. After meaningful changes call lint (text, cheap) and fix what it reports, then one get_screenshot to critique the result (needs the project open in the browser). Stop after 3 fix rounds or when lint says clean.
Colour: write colours as oklch(L C H), e.g. oklch(0.62 0.19 262) for a blue, oklch(0.98 0.004 90) for a warm off-white. OKLCH keeps lightness perceptually even, so ramps and contrast are predictable; for gradients use linear-gradient(in oklch, ...). Build a ramp by holding C and H and stepping L.
Tips: pick a palette, type scale and spacing scale first; use px units; give containers explicit widths; use system fonts (Inter, system-ui) because custom fonts are not loaded.
Feedback: the user can pin comments on elements. Call get_comments at the start of a task and after finishing; fix what open comments ask, then reply_comment and resolve_comment.
Consistency: call get_design_tokens before adding pages to an existing design, and reuse its colours, type sizes, radii and spacing.
Safety net: the app auto-saves version history, so a bad generation can be rolled back from the History panel.`;

// Sent once per session with the tool list, so it stays short; the full workflow is in get_guide.
const INSTRUCTIONS = `Design Canvas: HTML designs on an infinite canvas, shared live with the user.
Workflow: list_projects (reuse one if it fits, else create_project) -> log_prompt -> get_basic_info -> get_tree -> write_html / update_styles -> lint -> one get_screenshot -> finish_working.
Rules: inline styles only; colours as oklch(); real content, never lorem ipsum; text contrast at least 4.5:1; edit with update_styles or write_html on a parent id instead of rewriting a board; reuse blocks with <x-clone node-id>; check get_comments and get_changes before starting. Call get_guide for the full guide.`;

const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] });

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

export function createMcpServer({ store, ui, requestScreenshot, requestComputed, highlight, meter, port }) {
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
    if (tool !== 'delete_nodes') highlight?.(meta.id, ids);
  };
  const summary = (m) => ({ project_id: m.id, name: m.name, description: m.description, url: url(m.id) });

  // ---- projects ----------------------------------------------------------
  server.registerTool('get_guide', {
    description: 'Read this first. Explains the project + design workflow and constraints.',
    inputSchema: {},
  }, safe(() => text(GUIDE)));

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
    description: 'Rename a project and/or change its description.',
    inputSchema: { ...pid, name: z.string().min(1).max(80).optional(), description: z.string().max(300).optional() },
  }, safe(({ project_id, name, description }) => {
    const { meta } = target(project_id);
    return text(summary(store.update(meta.id, { name, description })));
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
    inputSchema: { ...pid, prompt: z.string().min(1).max(500) },
  }, safe(({ project_id, prompt }) => {
    store.logPrompt(target(project_id).meta.id, prompt);
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
    },
  }, safe(({ project_id, format = 'summary', artboard_ids }) => {
    const { doc } = target(project_id);
    const boards = doc.data.artboards.filter((a) => !artboard_ids || artboard_ids.includes(a.id));
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
    description: 'Create an empty artboard (a frame on the canvas). Returns its id.',
    inputSchema: {
      ...pid,
      name: z.string().optional(),
      width: z.number().min(40).max(5000).optional(),
      height: z.number().min(40).max(10000).optional(),
      x: z.number().optional().describe('Canvas x position (default: placed to the right of the last artboard).'),
      y: z.number().optional().describe('Canvas y position (default 0). Use it to start a new row.'),
    },
  }, safe(({ project_id, ...a }) => {
    const { meta, doc } = target(project_id);
    const ab = doc.createArtboard(a);
    log(meta, doc, 'create_artboard', ab.id);
    return text(ab);
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
  }, safe(({ project_id, target_id, html, mode }) => {
    const { meta, doc } = target(project_id);
    const created = doc.writeHtml(target_id, html, mode);
    log(meta, doc, 'write_html', target_id);
    return text({ created });
  }));

  server.registerTool('get_tree', {
    description: 'Compact outline, one line per node: id, kind (frame/text/image/svg), name, layout, key styles, [n] hidden children. Far cheaper than HTML: read this first, then get_node_info only for the node you will change. node_id is an artboard or node (default: every artboard); query finds nodes by name or text.',
    inputSchema: { ...pid, node_id: z.string().optional(), depth: z.number().int().min(1).max(10).optional(), query: z.string().min(1).max(100).optional() },
  }, safe(({ project_id, node_id, depth, query }) => text(target(project_id).doc.outline(node_id, { depth, query }) || '(empty)')));

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
    description: 'Call when you are done with a task: clears the highlight the canvas shows on nodes you were editing.',
    inputSchema: { ...pid },
  }, safe(({ project_id }) => { highlight?.(target(project_id).meta.id, []); return text('ok'); }));

  server.registerTool('lint', {
    description: 'Check an artboard or node for text contrast below WCAG AA, text under 12px, odd pixel spacing (off the 2px grid), fixed widths wider than the artboard, off-artboard absolute offsets, images without alt and lorem ipsum. Returns one line per issue, or "clean". Cheap: run it before get_screenshot. It reads inline styles only, so overflow/clipping still needs a screenshot.',
    inputSchema: { ...pid, id: z.string().describe('Artboard id (A#) or node id (N#)') },
  }, safe(({ project_id, id }) => text(formatIssues(target(project_id).doc.lint(id)))));

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
  }, safe(({ project_id, node_ids, styles }) => {
    const { meta, doc } = target(project_id);
    doc.updateStyles(node_ids, styles);
    log(meta, doc, 'update_styles', node_ids);
    return text('ok');
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
    const created = doc.duplicateNodes(ids);
    log(meta, doc, 'duplicate_nodes', created);
    return text({ created });
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
    description: 'Render an artboard (or just one node, via node_id) so you can review your work. Defaults are token-lean: 1x, max 1000 px wide, JPEG. Use node_id to look at one component instead of the whole board; ask for scale 2 or png only when you must read tiny text. Requires the project to be open in a browser tab.',
    inputSchema: {
      ...pid,
      artboard_id: z.string(),
      node_id: z.string().optional().describe('Crop to this node (must be inside the artboard).'),
      scale: z.number().min(0.25).max(2).optional(),
      max_width: z.number().int().min(200).max(2000).optional(),
      format: z.enum(['jpeg', 'png']).optional(),
    },
  }, safe(async ({ project_id, artboard_id, node_id, scale, max_width, format = 'jpeg' }) => {
    const { meta, doc } = target(project_id);
    if (!doc.getArtboard(artboard_id)) throw new Error(`Artboard ${artboard_id} not found`);
    if (node_id && doc.artboardOf(node_id)?.id !== artboard_id) throw new Error(`Node ${node_id} is not inside ${artboard_id}`);
    const dataUrl = await requestScreenshot(meta.id, artboard_id, { nodeId: node_id, scale, maxWidth: max_width, format });
    return { content: [{ type: 'image', data: dataUrl.split(',')[1], mimeType: format === 'png' ? 'image/png' : 'image/jpeg' }] };
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
    const ab = target(project_id).doc.getArtboard(artboard_id);
    if (!ab) throw new Error(`Artboard ${artboard_id} not found`);
    return text(artboardToReact(ab));
  }));

  server.registerTool('export_html', {
    description: 'Return a standalone HTML document for an artboard, ready to save or hand to a codebase.',
    inputSchema: { ...pid, artboard_id: z.string() },
  }, safe(({ project_id, artboard_id }) => {
    const ab = target(project_id).doc.getArtboard(artboard_id);
    if (!ab) throw new Error(`Artboard ${artboard_id} not found`);
    const clean = ab.html.replace(/ data-pid="[^"]*"/g, '');
    return text(`<!doctype html>\n<html><head><meta charset="utf-8"><title>${ab.name.replace(/[<>&]/g, '')}</title></head>\n<body style="margin:0"><div style="position:relative;width:${ab.width}px;min-height:${ab.height}px">${clean}</div></body></html>`);
  }));

  return server;
}
