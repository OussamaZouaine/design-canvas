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
import { healHtml } from './heal.mjs';
import { parse } from 'node-html-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, FAMILIES, toCssDeclarations } from './theme.mjs';
import { slotsOf } from './components.mjs';
import fs from 'node:fs';
import { captureUrl } from './capture.mjs';
import { imageSize, estimateTokens } from './meter.mjs';
import { summarizeArgs } from './agentlog.mjs';
import { guideText, TOPICS } from './guide.mjs';
import { fontStack, SHORTLIST, SYSTEM_FAMILIES, usedProjectFonts, productionUrl } from './fonts.mjs';
import { anonymousSession } from './sessions.mjs';
import { Claims, PAUSED_MESSAGE } from './claims.mjs';
import { kindOf } from './efficiency.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { formatMemory } from './memory.mjs';
import { clampStatus,pendingFeedback, formatFeedback, markDelivered, STATUS_MAX } from './feedback.mjs';

// Optional on the hot tools (no new tool): shown beside the agent's name in the Agents tab, cleared by finish_working.
const STATUS_FIELD = z.string().max(STATUS_MAX * 2).optional().describe(`One present-tense line (max ${STATUS_MAX} chars) on what you are doing now, e.g. "Building the pricing section". Once per phase, not per call.`);
import { extractSvg, MAX_SVG_BYTES } from './svg.mjs';
import { formatResults, splitId } from './assets.mjs';
import { readInsideRepo, parseCustomProperties, mapProperties, exportTokens } from './tokensync.mjs';

// Sent once per session with the tool list, so it stays short; the full workflow is in get_guide.
// The first line is a gate: the process and taste rules live in the guide, and clients that skip it skip them.
const INSTRUCTIONS = `Design Canvas: HTML designs on an infinite canvas, shared live with the user.
Your first turn: call get_guide() and start() together. get_guide returns the whole method (workflow, brief, type, layout, review) in one call; read it before any design call. Before the first write of a new design post a short brief in chat, then pass it as start.brief. Only get_guide({topic:"mobile"}) is separate.
Be economical with turns: send independent tool calls together in one turn. If tools are deferred, load the core set in ONE ToolSearch select: get_guide, start, list_projects, log_prompt, create_artboard, write_html, update_styles, get_tree, lint, get_screenshot, finish_working.
Workflow: start({prompt, project, brief, artboard}) = find/create project + log the request + first board (with html for the first group) -> write_html / update_styles (new lint issues come back in the result) -> one get_screenshot -> finish_working. start also returns an existing project's open comments, user changes and boards, so skip get_comments, get_changes and get_basic_info. list_projects is for browsing only.
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

// Optional project argument. A session is bound to its project by start / project open, so only the tools that pick
// a project keep it in their schema (KEEP_PID); on the others the register wrapper turns the schema into a
// passthrough object, so an explicit project_id still works but costs no tools/list tokens.
const pid = { project_id: z.string().optional().describe('Default: the project this session opened') };
const KEEP_PID = new Set(['project']);

// Every listed tool's schema is resent with every request of the session: all 50 cost ~9.2k tokens, this core set
// ~4.3k. The rest stay registered but disabled until the agent calls `more_tools` (or connects with ?tools=all).
// Keep the hot path here: a design task (start -> write -> lint -> screenshot -> finish) and the comment loop.
export const CORE_TOOLS = new Set([
  'get_guide', 'start', 'list_projects', 'log_prompt', 'project', 'create_artboard', 'write_html', 'update_styles',
  'set_text_content', 'get_tree', 'get_node_info', 'get_selection', 'get_changes', 'get_comments', 'reply_comment',
  'resolve_comment', 'lint', 'get_screenshot', 'finish_working', 'fit_artboard', 'delete_nodes', 'duplicate_nodes',
  'batch', 'use_font',
]);

// `toolset`: 'core' (what server.mjs gives new sessions) or 'all' (the default here, so tests and old stateless
// clients, which cannot unlock anything across requests, see every tool).
export function createMcpServer({ store, ui, fonts, assets, requestScreenshot, requestMeasure, requestComputed, requestCompare, highlight, meter, calls, port, session = anonymousSession(), claims = new Claims(), toolset = 'all' }) {
  const instructions = toolset === 'core'
    ? `${INSTRUCTIONS}\nSome tools are hidden to save tokens (pages, components, tokens, references, capture, export, assets...): call more_tools once when the guide or the task needs one that is not listed.`
    : INSTRUCTIONS;
  const server = new McpServer({ name: 'design-canvas', version: '0.3.0' }, { instructions });
  const registered = new Map(); // name -> RegisteredTool, so the extended ones can be disabled / enabled after registration
  // clientInfo arrives once, on `initialize`: that is where the agent's name comes from.
  server.server.oninitialized = () => session.setClient(server.server.getClientVersion());
  // The project this session works in: bound by start / project open, else the shared active one (old clients).
  const currentId = () => session.projectId ?? store.activeId;
  const bind = (id) => {
    session.projectId = id;
    // First contact with this project: "changes by others since my last read" starts here, not at version 0.
    if (!session.seen.has(id)) { const p = store.get(id); if (p) session.seen.set(id, p.doc.version); }
  };

  // Every tool goes through registerTool, so wrap it once here to meter each result's size
  // instead of touching 25 handlers. The wrapped handler behaves exactly like the original.
  const callScope = new AsyncLocalStorage();
  const register = server.registerTool.bind(server);
  server.registerTool = (name, config, handler) => {
    if (config.inputSchema && !KEEP_PID.has(name)) {
      const { project_id, ...rest } = config.inputSchema;
      if (project_id) config = { ...config, inputSchema: z.object(rest).passthrough() };
    }
    const tool = register(name, config, async (...args) => {
      const input = args[0];
      // Project the call targets: explicit id, else the session's (resolved again after, since start/open can bind it).
      const projectOf = () => input?.project_id ?? currentId();
      const t0 = Date.now();
      // Optional `status` on hot tools (start, write_html): a one-line "what I'm doing now". Set before the call is
      // logged so this very entry carries it to the Agents tab (the log entry's agent snapshot is the transport).
      if (typeof input?.status === 'string') session.status = clampStatus(input.status);
      const callId = calls?.start(projectOf(), name, input, agentOf());
      // The user can pause an agent from the Agents panel: its writes (not its reads) get a polite error until resumed.
      const paused = claims.isPaused(session.agent.id) && kindOf(name, input) === 'write';
      // AsyncLocalStorage = a per-call scratch space that follows the async chain, so `log()` (deep inside a handler,
      // possibly inside a batch) can leave claim-conflict notes for exactly this call even when calls run in parallel.
      const scratch = { notes: new Set() };
      const result = paused
        ? { isError: true, content: [{ type: 'text', text: PAUSED_MESSAGE }] }
        : await callScope.run(scratch, () => handler(...args));
      // Only a real conflict adds text; the normal case returns the handler's result untouched (zero extra tokens).
      if (scratch.notes.size && !result?.isError && Array.isArray(result?.content)) result.content.push({ type: 'text', text: [...scratch.notes].join('\n') });
      if (name === 'finish_working' && !result?.isError) session.status = null; // done: nothing left to narrate
      appendFeedback(name, result, projectOf());
      meter?.record(name, result);
      // Logging is derived from what already happened: no new fields in the result, so it costs the model nothing.
      try {
        calls?.finish({
          id: callId, ms: Date.now() - t0, tool: name, project: projectOf() ?? null, ok: !result?.isError, agent: agentOf(),
          ...(result?.isError ? { error: String(result.content?.[0]?.text ?? '').slice(0, 200) } : {}),
          tokens: estimateTokens(result), args: summarizeArgs(input),
        });
      } catch { /* the log must never break a tool call */ }
      return result;
    });
    registered.set(name, tool);
    return tool;
  };
  // Who is calling, as stored on call-log entries (id for joins, name + colour so the UI needs no second lookup).
  const agentOf = () => { const { id, name, color } = session.agent; return { id, name, color, ...(session.status && { status: session.status }) }; };

  // HUMAN FEEDBACK: append the user's new/unresolved comments to this call's result, once per session (feedback.mjs).
  // Skipped for the anonymous fallback session (shared by every id-less client, so "delivered" would be meaningless and
  // it would spam), for errors, and for the comment tools themselves; start / get_comments list comments already, so
  // they only mark what they showed as delivered.
  const appendFeedback = (tool, result, pid) => {
    if (session.id === 'anon' || !pid || result?.isError || !Array.isArray(result?.content)) return;
    const p = store.get(pid);
    if (!p || p.meta.deletedAt) return;
    const due = pendingFeedback(store.listComments(pid), session.delivered);
    if (!due.length) return;
    if (tool === 'start' || tool === 'get_comments') { for (const c of due) session.delivered.set(c.id, Date.now()); return; }
    if (tool === 'reply_comment' || tool === 'resolve_comment') return;
    const block = formatFeedback(due, (c) => p.doc.getArtboard(c.artboardId)?.name?.replace(/[^\w .-]/g, '').slice(0, 30) ?? '');
    markDelivered(session.delivered, due);
    result.content.push({ type: 'text', text: block });
  };
  const url = (id) => `http://localhost:${port}/p/${id}`;

  // Resolve which project a call targets: explicit id, else the active one.
  const target = (project_id) => {
    const id = project_id ?? currentId();
    if (!id) throw new Error('No active project. Call list_projects, then project (action open) or create_project.');
    const p = store.get(id);
    if (!p || p.meta.deletedAt) throw new Error(`Project ${id} not found (or in Trash). Call list_projects.`);
    return p;
  };
  // Record a design action in the project's Activity (what Claude did, per artboard).
  // `anyId` is one id or a list. Besides the Activity entry this also feeds get_changes (journal)
  // and lights up the touched nodes on the canvas until finish_working or a timeout.
  // While a batch runs, `batchBoards` collects the boards its ops touched so the layout is checked once at the end.
  let batchBoards = null;
  const log = (meta, doc, tool, anyId, detail, boardOverride) => {
    const ids = [].concat(anyId ?? []);
    const ab = boardOverride ?? (ids[0] ? doc.artboardOf(ids[0]) : null);
    // The checkpoint taken just before this write is its "before" state: keep the diff on the Activity row (see stepdiff.mjs).
    store.logAction(meta.id, { tool, artboardId: ab?.id, artboard: ab?.name, detail, agent: agentOf(), step: doc.captureStep() });
    doc.record(session.agent.id, tool, ids);
    // Soft claim: writing to a board claims it for ~60 s. If another agent still holds it, this call's result gets a
    // one-line note (not an error), so the two can coordinate instead of silently overwriting each other.
    if (ab && !ab.generated) {
      const other = claims.touch(meta.id, ab, agentOf());
      // The agent id is a slug (safe to echo); the display name is untrusted client text and stays out of results.
      if (other) callScope.getStore()?.notes.add(`note: board ${String(ab.name).slice(0, 40)} (${ab.id}) is being edited by ${other.id}; check get_changes before overwriting their work`);
    }
    // Remember which boards were edited so finish_working can check that their content still fits.
    const set = ui.touched.get(meta.id) ?? ui.touched.set(meta.id, new Set()).get(meta.id);
    for (const id of ids) { const a = doc.artboardOf(id); if (a) { set.add(a.id); batchBoards?.add(a.id); } }
    if (tool !== 'delete_nodes') highlight?.(meta.id, ids, agentOf());
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
  // Lint of each id, never throwing: auto-lint is a courtesy and must not turn a successful write into an error.
  const lintIds = (doc, ids) => {
    const out = [];
    for (const id of ids) { try { out.push(...doc.lint(id)); } catch { /* node gone or not lintable */ } }
    return out;
  };
  // Only issues that were not there before the write, so the common case (nothing new) adds no tokens.
  // At most 5 lines, then "+N more". Returns {} when silent so it can be spread into a result.
  const newLint = (before, after) => {
    const seen = new Set(before);
    const fresh = after.filter((i) => !seen.has(i));
    if (!fresh.length) return {};
    const extra = fresh.length - 5;
    return { lint: fresh.slice(0, 5).join('\n') + (extra > 0 ? `\n+${extra} more` : '') };
  };
  // Open streamed write_html runs, by `projectId:targetId` -> { raw, ids } (see edits.write_html).
  const streams = new Map();
  // write_html / create_artboard html: write, then report dialect, lint (new issues only) and layout notes.
  const writeWithNotes = async (meta, doc, targetId, html, mode, tool, quiet = false, opts = {}) => {
    // before/after write siblings, so the target's own subtree is not what changes: lint the new nodes alone.
    const sibling = mode === 'before' || mode === 'after';
    const before = sibling || quiet ? [] : lintIds(doc, [targetId]);
    const created = doc.writeHtml(targetId, html, mode, opts);
    log(meta, doc, tool, targetId);
    // Dialect notes only for projects that normalize (new ones); Sprig and imports keep their own style.
    const dialect = meta.normalize ? dialectNote(html) : '';
    // quiet (inside a batch): the batch reports layout once at its end, so no per-write lint or layout round-trip.
    if (quiet) return { created, ...(dialect && { dialect }) };
    const after = lintIds(doc, sibling ? created : [targetId]);
    return { created, ...(dialect && { dialect }), ...newLint(before, after), ...(await layoutNote(meta, doc, targetId)) };
  };
  const summary = (m) => ({ project_id: m.id, name: m.name, description: m.description, url: url(m.id) });
  // basicInfo without the fields that carry no information yet: a single implicit page and an empty reference list.
  const leanInfo = (doc) => {
    const { pages, references, ...rest } = doc.basicInfo();
    return { ...(pages.length > 1 && { pages }), ...(references.length && { references }), ...rest };
  };
  // nodeInfo's HTML is the bulk of its size (the whole subtree), so it is opt-in and capped.
  const HTML_CAP = 2000;
  const withHtml = (info, include) => {
    const { html, ...rest } = info;
    if (!include) return rest;
    return { ...rest, html: html.length > HTML_CAP ? `${html.slice(0, HTML_CAP)}… [truncated, ${html.length} chars total: use get_tree or a child node_id]` : html };
  };

  // The edit tools' logic, by tool name. Both registerTool (one call per tool) and `batch` (many ops in one call)
  // dispatch here, so there is a single copy of each behaviour. A handler takes the tool's arguments and returns
  // the plain result (string or object); `viaEdit` wraps it as MCP text. `quiet` (batch) skips the per-op layout
  // and lint notes, because the batch reports layout once at its end.
  const edits = {
    async create_artboard({ project_id, ...a }, quiet) {
      const { meta, doc } = target(project_id);
      const { page_id, height_mode = 'fit', html, ...rest } = a;
      const ab = doc.createArtboard({ ...rest, heightMode: height_mode, page: page_id ?? ui.currentPage.get(meta.id) });
      log(meta, doc, 'create_artboard', ab.id);
      // Soft nudge only (never a refusal): a project with no recorded brief usually means the design method was skipped.
      const reminder = meta.brief ? {} : { reminder: 'No brief is recorded for this project. For a new design, follow the brief section of get_guide, post a brief in chat and pass it to log_prompt.' };
      const written = html ? await writeWithNotes(meta, doc, ab.id, html, undefined, 'write_html', quiet) : {};
      // ab is the live artboard object, so after the write its html holds the whole normalized board (a 27k-char
      // write echoed ~9k tokens back). The caller already has the markup; return only the board's fields.
      const { html: _written, ...board } = ab;
      // The asked x/y would have covered another board: say where it went instead, so the agent's mental map stays right.
      const placed = ab.placed ? { placed: `x ${ab.placed.asked.x}, y ${ab.placed.asked.y} was taken by another board; placed at x ${ab.x}, y ${ab.y} in the same row` } : {};
      return { ...board, ...placed, ...written, ...reminder };
    },
    async write_html({ project_id, target_id, html, mode, stream }, quiet) {
      const { meta, doc } = target(project_id);
      if (!stream) return writeWithNotes(meta, doc, target_id, html, mode, 'write_html', quiet);
      // Streamed run: the chunks of one section may split mid-element, so we keep the raw text of the run so far and
      // each call rewrites the run's nodes from its healed prefix (one undo step per call, in document order, always
      // valid markup). Ids of the run's nodes are provisional until the call with stream "end".
      if (mode && mode !== 'append') throw new Error('stream runs append to the end of the target; drop mode or use "append"');
      const key = `${meta.id}:${target_id}`;
      let run = streams.get(key);
      if (stream === 'start' || !run) {
        if (stream !== 'start') throw new Error(`No open stream on ${target_id} (the server may have restarted). Send stream "start" with the first chunk.`);
        run = { raw: '', ids: [] };
        streams.set(key, run);
      }
      const raw = run.raw + html;
      try {
        const res = await writeWithNotes(meta, doc, target_id, healHtml(raw), 'append', 'write_html', quiet, { drop: run.ids });
        run.raw = raw;
        run.ids = res.created;
        return { ...res, stream: stream === 'end' ? 'closed' : 'open' };
      } finally {
        if (stream === 'end') streams.delete(key);
      }
    },
    async insert_component({ project_id, target_id, name, variant, slots = {}, mode }) {
      const { meta, doc } = target(project_id);
      const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      const tag = `<x-component name="${attr(name)}"${variant ? ` variant="${attr(variant)}"` : ''}${Object.entries(slots).map(([k, v]) => ` slot-${attr(k)}="${attr(v)}"`).join('')}></x-component>`;
      const created = doc.writeHtml(target_id, tag, mode);
      log(meta, doc, 'insert_component', created);
      return { created };
    },
    async move_node({ project_id, node_id, target_id, position }) {
      const { meta, doc } = target(project_id);
      const from = doc.parentOf(node_id); // read before the move: afterwards the old parent is gone from the node
      doc.moveNode(node_id, target_id, position);
      log(meta, doc, 'move_node', node_id);
      // Both parents change size/layout, so name them (Paper's affectedParents) for the follow-up check.
      const to = doc.parentOf(node_id);
      return { ok: true, affectedParents: [...new Set([from, to].filter(Boolean))] };
    },
    async set_flags({ project_id, node_ids, hidden, locked }) {
      const { meta, doc } = target(project_id);
      doc.setFlags(node_ids, { hidden, locked });
      log(meta, doc, 'set_flags', node_ids);
      return 'ok';
    },
    async update_styles({ project_id, node_ids, styles }, quiet) {
      const { meta, doc } = target(project_id);
      const before = quiet ? [] : lintIds(doc, node_ids);
      doc.updateStyles(node_ids, styles);
      log(meta, doc, 'update_styles', node_ids);
      const note = quiet ? {} : await layoutNote(meta, doc, node_ids[0]);
      const dialect = meta.normalize ? dialectStylesNote(styles) : '';
      const lint = quiet ? {} : newLint(before, lintIds(doc, node_ids));
      return note.layout || dialect || lint.lint ? { ok: true, ...note, ...lint, ...(dialect && { dialect }) } : 'ok';
    },
    // SVG geometry and paint are attributes, so update_styles cannot reach them (see Doc.setAttrs).
    async set_attrs({ project_id, node_ids, attrs }) {
      const { meta, doc } = target(project_id);
      doc.setAttrs(node_ids, attrs);
      log(meta, doc, 'set_attrs', node_ids);
      return 'ok';
    },
    // Drops an SVG onto the board as an ordinary editable node. The file route reuses the repo path check so
    // an agent cannot read arbitrary files off the disk; the sanitizer in Doc._prepare does the safety work.
    async import_svg({ project_id, target_id, svg, file, mode, name }, quiet) {
      const { meta, doc } = target(project_id);
      if (!svg === !file) throw new Error('import_svg: pass exactly one of svg (markup) or file (path inside the linked repo)');
      const src = extractSvg(svg ?? readInsideRepo(meta.repo, file));
      if (src.length > MAX_SVG_BYTES) throw new Error('import_svg: SVG is too large (1 MB max)');
      // Same path as write_html so a fit-height board grows to hold the new vector (and lint/layout notes come back).
      const res = await writeWithNotes(meta, doc, target_id, src, mode, 'import_svg', quiet);
      if (name) doc.renameNodes({ [res.created[0]]: name });
      return res;
    },
    async set_text_content({ project_id, node_id, text: t }) {
      const { meta, doc } = target(project_id);
      doc.setText(node_id, t);
      log(meta, doc, 'set_text_content', node_id);
      return 'ok';
    },
    async rename_nodes({ project_id, names }) {
      const { meta, doc } = target(project_id);
      doc.renameNodes(names);
      log(meta, doc, 'rename_nodes', Object.keys(names));
      return 'ok';
    },
    async duplicate_nodes({ project_id, ids }) {
      const { meta, doc } = target(project_id);
      const { created, idMap } = doc.duplicateNodes(ids, { withMap: true });
      log(meta, doc, 'duplicate_nodes', created);
      // idMap: original id -> copy id for every descendant, so the copy can be edited without a get_tree.
      return { created, descendantIdMap: idMap };
    },
    async delete_nodes({ project_id, ids }) {
      const { meta, doc } = target(project_id);
      const board = doc.artboardOf(ids[0]); // read first: afterwards the artboard may be gone
      doc.deleteNodes(ids);
      log(meta, doc, 'delete_nodes', ids[0], undefined, board); // after the delete so the diff sees it
      doc.journal.at(-1).ids = ids;
      return 'ok';
    },
  };
  // The user's hand edits since Claude last looked (shared by get_changes and start); advances the read marker.
  const userChanges = (meta, doc, since_version) => {
    const from = since_version ?? ui.lastRead.get(meta.id) ?? 0;
    const changes = doc.changesSince(from, 'user').map((c) => ({
      version: c.version, action: c.tool, ids: c.ids,
      // Outline lines only for things that still exist, one line each.
      now: c.ids.map((id) => { try { return doc.outline(id, { depth: 0 }).split('\n')[0]; } catch { return `${id} (deleted)`; } }),
    }));
    ui.lastRead.set(meta.id, doc.version);
    const others = othersChanges(meta, doc);
    return { version: doc.version, changes: changes.length ? changes : 'none', ...(others && { others }) };
  };
  // What OTHER agents changed in this project since this agent last looked (the journal already records the author).
  // Compact: one entry per agent with a count per tool and the boards touched; absent when nobody else wrote.
  // The marker lives on the session, so two agents each get their own "since my last read". A session's first look
  // starts at "now" (bind sets it), so a newcomer is not flooded with history it never saw.
  const othersChanges = (meta, doc) => {
    const from = session.seen.get(meta.id) ?? doc.version;
    session.seen.set(meta.id, doc.version);
    const by = new Map(); // actor -> { tools: Map(tool -> n), boards: Set }
    for (const c of doc.changesSince(from)) {
      if (c.actor === 'user' || c.actor === session.agent.id) continue;
      const e = by.get(c.actor) ?? by.set(c.actor, { tools: new Map(), boards: new Set() }).get(c.actor);
      e.tools.set(c.tool, (e.tools.get(c.tool) ?? 0) + 1);
      for (const id of c.ids) { const b = doc.artboardOf(id); if (b) e.boards.add(b.id); else if (doc.getArtboard(id)) e.boards.add(id); }
    }
    if (!by.size) return null;
    return [...by].map(([agent, e]) => ({ agent, did: [...e.tools].map(([t, n]) => (n > 1 ? `${t} x${n}` : t)).join(', '), boards: [...e.boards] }));
  };
  const viaEdit = (name) => safe(async (args) => text(await edits[name](args)));
  // Action-enum tools (pages, components, ...) keep one flat schema, so each action checks its own required fields here.
  const need = (tool, action, args, ...keys) => {
    const missing = keys.filter((k) => args[k] === undefined);
    if (missing.length) throw new Error(`${tool} ${action} needs ${missing.join(', ')}`);
  };

  // ---- projects ----------------------------------------------------------
  server.registerTool('get_guide', {
    description: 'Read this first, once. No topic = the whole method in one call (workflow, brief, type, layout, review). Single topics (brief, type, layout, review) re-read one part; mobile (status bar, safe areas) is only available as its own topic.',
    inputSchema: { topic: z.enum(Object.keys(TOPICS)).optional() },
  }, safe(({ topic }) => text(guideText(topic))));

  server.registerTool('list_projects', {
    description: 'List projects (15 most recently edited first, `more` counts the rest) with ids, names and artboard counts. Call this before creating a project so you reuse an existing one.',
    inputSchema: {},
  }, safe(() => {
    const all = store.list().sort((a, b) => b.updatedAt - a.updatedAt);
    // No url/description: the id is all a later call needs, and 18 projects of prose were ~1k tokens.
    return text({
      active_project_id: currentId(),
      projects: all.slice(0, 15).map((p) => ({ project_id: p.id, name: p.name, artboards: p.artboardCount, updated: new Date(p.updatedAt).toISOString() })),
      ...(all.length > 15 && { more: all.length - 15 }),
    });
  }));

  server.registerTool('create_project', {
    description: 'Create a project and make it active. Name it after what you are building (2-4 words, e.g. the repo or feature). Fails if a project with that name exists: open it instead.',
    inputSchema: { name: z.string().min(1).max(80), description: z.string().max(300).optional() },
  }, safe(({ name, description }) => {
    const meta = store.create({ name, description, unique: 'error' });
    bind(meta.id);
    return text(summary(meta));
  }));

  // Project admin (open / update / delete / checkpoint) in one low-traffic tool; create_project and list_projects stay
  // separate because they open every session. open and delete require an explicit project_id: delete must never
  // fall back to "the active project".
  server.registerTool('project', {
    description: 'Project admin. action open (project_id): make an existing project the one this session works in and return its artboards. update (name, description and/or normalize; default: the open project): rename it, change its description, or switch HTML normalization on/off (new projects have it on: classes and <style> dropped, redundant styles stripped, border-box sizing; older projects keep their markup as written). save_version (optional label): save a named checkpoint to the version history, do this before big rewrites. delete (project_id): move it to Trash, the user can restore it from the home page; only when the user asks.',
    inputSchema: {
      ...pid,
      action: z.enum(['open', 'update', 'save_version', 'delete']),
      name: z.string().min(1).max(80).optional(),
      description: z.string().max(300).optional(),
      normalize: z.boolean().optional(),
      label: z.string().max(80).optional(),
    },
  }, safe(({ project_id, action, name, description, normalize, label }) => {
    if (action === 'open' || action === 'delete') need('project', action, { project_id }, 'project_id');
    const { meta, doc } = target(project_id);
    if (action === 'open') {
      store.setActive(meta.id);
      bind(meta.id);
      return text({ ...summary(meta), ...leanInfo(doc) });
    }
    if (action === 'delete') { store.remove(meta.id); return text('Moved to Trash'); }
    if (action === 'save_version') {
      store.snapshot(meta.id, label || 'Saved version', { force: true });
      return text('Version saved');
    }
    return text({ ...summary(store.update(meta.id, { name, description, normalize })), normalize: !!meta.normalize });
  }));

  // Design memory (low traffic, so one action-enum tool like pages/project). start already delivers the rules and the
  // latest decisions, so agents mostly only WRITE here: add_decision when a choice was made and add_rule when the user
  // states a standing rule. list is for the older entries start does not show.
  server.registerTool('memory', {
    description: 'Project design memory that survives between sessions; start already returns the rules and latest decisions. action: add_rule (text): a durable one-line style rule the user stated or that every board must follow, e.g. "one accent colour, oklch hue 150". add_decision (text, optional target_id board/node): a choice made and why, e.g. "pricing cards have no borders, shadow only". list: every rule and decision with ids. remove (id): delete an entry that is wrong or outdated.',
    inputSchema: {
      ...pid,
      action: z.enum(['add_rule', 'add_decision', 'list', 'remove']),
      text: z.string().max(400).optional(),
      target_id: z.string().max(40).optional(),
      id: z.string().max(20).optional(),
    },
  }, safe(({ project_id, action, text: body, target_id, id }) => {
    const { meta } = target(project_id);
    if (action === 'list') return text(store.listMemory(meta.id).map((e) => ({ id: e.id, kind: e.kind, text: e.text, at: new Date(e.at).toISOString().slice(0, 10), ...(e.agent && { agent: e.agent }), ...(e.targetId && { target: e.targetId }) })));
    if (action === 'remove') {
      need('memory', action, { id }, 'id');
      store.removeMemory(meta.id, id);
      return text('Removed');
    }
    need('memory', action, { text: body }, 'text');
    const e = store.addMemory(meta.id, { kind: action === 'add_rule' ? 'rule' : 'decision', text: body, targetId: target_id, agent: session.agent.name });
    return text({ saved: e.id });
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
    store.logPrompt(target(project_id).meta.id, prompt, brief, agentOf());
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
    description: 'Reply to a comment (say what you changed). The user sees it on the pin. resolve: true also marks it resolved, so one call closes a handled comment.',
    inputSchema: { ...pid, comment_id: z.string(), text: z.string().min(1).max(2000), resolve: z.boolean().optional() },
  }, safe(({ project_id, comment_id, text: t, resolve }) => {
    const { meta } = target(project_id);
    store.replyComment(meta.id, comment_id, { text: t, author: 'claude' });
    if (resolve) store.setCommentResolved(meta.id, comment_id, true);
    return text(resolve ? 'Replied and resolved' : 'Replied');
  }));

  server.registerTool('resolve_comment', {
    description: 'Mark a comment resolved once you have addressed it.',
    inputSchema: { ...pid, comment_id: z.string(), resolved: z.boolean().optional() },
  }, safe(({ project_id, comment_id, resolved = true }) => { store.setCommentResolved(target(project_id).meta.id, comment_id, resolved); return text(resolved ? 'Resolved' : 'Reopened'); }));

  // Token readers and code-sync in one tool; set_tokens (the writer) and get_design_system stay separate.
  // log() keeps the old import_tokens name for the Activity panel.
  server.registerTool('tokens', {
    description: 'Token tools besides set_tokens. action extract: scan the project and derive its design tokens (colours, fonts, sizes, radii, spacing, shadows) from the styles actually used, to keep new pages consistent or hand tokens to a codebase; format summary (default, ranked lists + CSS variables), css, json (W3C design tokens) or tailwind; limit with artboard_ids or scan one node_id (e.g. a card). export: the project tokens as text to paste into a codebase, format css (default, :root plus [data-theme] blocks for modes), tailwind (@theme block) or json. link_repo (path, absolute folder of your code, null unlinks): files are only ever read from inside it. import (file relative to the linked repo, e.g. src/styles.css; optional selector, default :root, use ".dark" with mode "dark" for dark overrides; dry_run previews): reads CSS custom properties into the tokens; names starting with a token family are kept, others are classified by name and value (--brand: oklch(...) becomes color-brand), anything unclear is reported in skipped and not imported.',
    inputSchema: {
      ...pid,
      action: z.enum(['extract', 'export', 'import', 'link_repo']),
      format: z.enum(['summary', 'css', 'json', 'tailwind']).optional(),
      artboard_ids: z.array(z.string()).optional(),
      node_id: z.string().optional(),
      path: z.string().nullable().optional(),
      file: z.string().optional(),
      selector: z.string().optional(),
      mode: z.string().optional(),
      dry_run: z.boolean().optional(),
    },
  }, safe(({ project_id, action, format, artboard_ids, node_id, path: repoPath, file, selector, mode, dry_run }) => {
    const { meta, doc } = target(project_id);
    if (action === 'extract') {
      const boards = node_id
        ? [{ id: node_id, name: 'node', html: doc.nodeInfo(node_id).html }]
        : doc.data.artboards.filter((a) => !artboard_ids || artboard_ids.includes(a.id));
      if (!boards.length) throw new Error('No artboards to scan yet. Create some designs first.');
      const { outputs, ...found } = extractTokens(boards);
      return text((format ?? 'summary') === 'summary' ? { ...found, css: outputs.css } : outputs[format]);
    }
    // summary only means something for extract; export falls back to css.
    if (action === 'export') return text(exportTokens(doc.theme, !format || format === 'summary' ? 'css' : format));
    if (action === 'link_repo') {
      need('tokens', action, { path: repoPath }, 'path');
      store.update(meta.id, { repo: repoPath });
      return text(meta.repo ? { repo: meta.repo } : 'Unlinked');
    }
    need('tokens', action, { file }, 'file');
    const props = parseCustomProperties(readInsideRepo(meta.repo, file), selector);
    if (!Object.keys(props).length) throw new Error(`No custom properties found in ${file} for selector ${selector ?? ':root'}`);
    const { tokens, skipped } = mapProperties(props);
    if (!dry_run && Object.keys(tokens).length) { doc.setTokens(tokens, { mode }); log(meta, doc, 'import_tokens', []); }
    return text({ imported: dry_run ? [] : Object.keys(tokens), would_import: dry_run ? tokens : undefined, skipped });
  }));

  server.registerTool('get_basic_info', {
    description: 'Project details plus all its artboards with ids, names, positions and sizes (pages and references appear only when there are any).',
    inputSchema: { ...pid },
  }, safe(({ project_id }) => {
    const { meta, doc } = target(project_id);
    return text({ ...summary(meta), ...leanInfo(doc) });
  }));

  server.registerTool('get_selection', {
    description: 'Return the nodes/artboards the user currently has selected in the browser.',
    inputSchema: { ...pid },
  }, safe(({ project_id }) => {
    const { meta, doc } = target(project_id);
    return text((ui.selection.get(meta.id) || []).map((id) => {
      try { return withHtml(doc.nodeInfo(id), false); } catch { return doc.getArtboard(id) ?? { id }; }
    }));
  }));

  server.registerTool('create_artboard', {
    description: 'Create an empty artboard (a frame on the canvas). Returns its id. Pass html to write the first content in the same call (same result as write_html: created ids plus any dialect / lint / layout lines). By default the board is height_mode "fit": height is a MINIMUM and the board grows with its content, so nothing is ever cut off. Use "fixed" only when the height must be exact (a 844px phone mockup).',
    inputSchema: {
      ...pid,
      name: z.string().optional(),
      width: z.number().min(40).max(5000).optional(),
      height: z.number().min(40).max(10000).optional().describe('Height in px (minimum height for a fit board). Default 900.'),
      height_mode: z.enum(['fit', 'fixed']).optional().describe('fit (default): grows with content. fixed: exactly this tall; extra content is clipped.'),
      page_id: z.string().optional().describe('Page for the new board (default: the page chosen with pages set, else the first).'),
      x: z.number().optional().describe('Canvas x position (default: right after the last board of the row at y). A spot that covers another board slides right along the row.'),
      y: z.number().optional().describe('Row y position (default 0). Related boards share a row; start a new row (below the lowest board + 120) only for a different topic.'),
      html: z.string().max(200_000).optional().describe('First content for the board, written in the same call (saves a write_html turn).'),
    },
  }, viaEdit('create_artboard'));

  server.registerTool('write_html', {
    description:
      'Add HTML into an artboard or next to a node (target_id). mode: append (default, last child), prepend (first child), replace (swap children), before / after (siblings of a node). <x-clone node-id="N5"></x-clone> inside the html inserts a copy of that node without resending its markup. Inline styles only. Returns ids of the new top-level nodes, plus dialect / lint (new issues only) / layout lines when something needs fixing.',
    inputSchema: {
      ...pid,
      target_id: z.string().describe('Artboard id (A#) or node id (N#)'),
      html: z.string().max(200_000),
      mode: z.enum(['append', 'prepend', 'replace', 'before', 'after']).optional(),
      status: STATUS_FIELD,
      stream: z.enum(['start', 'next', 'end']).optional().describe('Stream a big section in pieces: "start" with the first chunk, "next" for each following chunk, "end" with the last. Chunks may stop mid-element (the server closes it); each call shows the section so far. Appends to the end of target_id; node ids are final only after "end".'),
    },
  }, viaEdit('write_html'));

  server.registerTool('get_tree', {
    description: 'Compact outline, one line per node: id, kind (frame/text/image/svg), name, layout, key styles, [n] hidden children. Far cheaper than HTML: read this first, then get_node_info only for the node you will change. node_id is an artboard or node (default: every artboard, but one line per artboard when the project has more than 8); query finds nodes by name or text.',
    inputSchema: { ...pid, node_id: z.string().optional(), depth: z.number().int().min(1).max(10).optional(), query: z.string().min(1).max(100).optional() },
  }, safe(({ project_id, node_id, depth, query }) => {
    const { doc } = target(project_id);
    // A big project outlined whole is thousands of tokens (46 boards = 3.6k): list the boards, let the agent pick one.
    if (!node_id && !query && depth === undefined && doc.data.artboards.length > 8) {
      const lines = doc.data.artboards.map((a) => `${a.id} artboard "${a.name}" ${a.width}×${a.height} at ${a.x},${a.y}`);
      return text(`${lines.join('\n')}\n(${lines.length} artboards: pass node_id to outline one, or query to search by name or text)`);
    }
    return text(doc.outline(node_id, { depth, query }) || '(empty)');
  }));

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
    return text(out || 'No tokens or components yet. Call set_tokens (preset "starter") and components (action set).');
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

  // Component masters in one tool (insert_component stays separate: it is the hot, cheap one). Same flat-schema
  // pattern as `pages`; log() keeps the old names (set_component, ...) for the Activity panel.
  server.registerTool('components', {
    description: 'Manage component masters. action: set (name, variants) creates a component or replaces all its variants and updates every instance in every artboard; variants maps a variant name to ONE HTML root element (inline styles, preferably var(--tokens)), with data-slot="label" on text that differs per instance, e.g. {"default": "<button style=\"...\"><span data-slot=\"label\">Button</span></button>", "primary": "..."}; slot text survives a master edit, other edits inside an instance are replaced by the master. detach (node_id) turns one instance into ordinary nodes. delete (name) removes a component; its instances stay as ordinary nodes. sheet creates or refreshes the read-only "Components" artboard showing every variant. Insert instances with insert_component.',
    inputSchema: {
      ...pid,
      action: z.enum(['set', 'detach', 'delete', 'sheet']),
      name: z.string().optional().describe('Component and variant names: lowercase letters, digits and dashes, starting with a letter (max 31 chars)'),
      variants: z.record(z.string(), z.string().max(20_000)).optional(),
      node_id: z.string().optional(),
    },
  }, safe(({ project_id, action, name, variants, node_id }) => {
    const { meta, doc } = target(project_id);
    if (action === 'set') {
      need('components', action, { name, variants }, 'name', 'variants');
      const r = doc.setComponent(name, variants);
      log(meta, doc, 'set_component', []);
      return text({ name, variants: Object.keys(variants), ...r });
    }
    if (action === 'detach') {
      need('components', action, { node_id }, 'node_id');
      doc.detach(node_id);
      log(meta, doc, 'detach_component', node_id);
      return text('ok');
    }
    if (action === 'delete') {
      need('components', action, { name }, 'name');
      doc.deleteComponent(name);
      log(meta, doc, 'delete_component', []);
      return text('ok');
    }
    const ab = doc.createComponentsSheet();
    log(meta, doc, 'create_components_sheet', ab.id);
    return text({ artboard_id: ab.id, height: ab.height });
  }));

  server.registerTool('insert_component', {
    description: 'Insert an instance of a component. target_id is an artboard or node; mode as in write_html (append, prepend, before, after). slots fills data-slot text, e.g. {"label": "Save"}. Returns the new node id. Far cheaper than writing the markup again.',
    inputSchema: {
      ...pid, target_id: z.string(), name: z.string(), variant: z.string().optional(),
      slots: z.record(z.string(), z.string()).optional(),
      mode: z.enum(['append', 'prepend', 'before', 'after']).optional(),
    },
  }, viaEdit('insert_component'));

  server.registerTool('move_node', {
    description: 'Move a node (keeping its ids) before / after another node, or into it as first (start) or last (end) child. target_id may be an artboard with start or end. Reorders layers.',
    inputSchema: { ...pid, node_id: z.string(), target_id: z.string(), position: z.enum(['before', 'after', 'start', 'end']).optional().describe('Default end (last child of the target).') },
  }, viaEdit('move_node'));

  server.registerTool('set_flags', {
    description: 'Hide / show nodes (hidden) or lock / unlock them (locked: nobody can edit a locked node or what is inside it until it is unlocked).',
    inputSchema: { ...pid, node_ids: z.array(z.string()).min(1), hidden: z.boolean().optional(), locked: z.boolean().optional() },
  }, viaEdit('set_flags'));

  // ---- pages -------------------------------------------------------------
  // One tool for the five page operations (low traffic): a single schema costs less than five. The action enum is
  // strict; fields are flat and optional in the schema, so each action checks its own required ones with `need`.
  // log() keeps the old per-operation names (create_page, ...): the Activity panel labels and doc history use them.
  server.registerTool('pages', {
    description: 'Pages are separate canvases inside a project (one per flow or breakpoint); get_basic_info lists them. action: create (name) returns the page id; set (page_id) chooses the page NEW artboards go to until changed; update (page_id, name and/or background colour such as oklch(0.2 0 0), "" clears it); delete (page_id; ASK THE USER FIRST, it removes a page they may rely on; its artboards move to move_boards_to, default the first remaining page, never deleted); move_boards (artboard_ids, page_id).',
    inputSchema: {
      ...pid,
      action: z.enum(['create', 'set', 'update', 'delete', 'move_boards']),
      page_id: z.string().optional(),
      name: z.string().max(60).optional(),
      background: z.string().max(60).optional(),
      move_boards_to: z.string().optional(),
      artboard_ids: z.array(z.string()).min(1).optional(),
    },
  }, safe(({ project_id, action, page_id, name, background, move_boards_to, artboard_ids }) => {
    const { meta, doc } = target(project_id);
    if (action === 'create') {
      need('pages', action, { name }, 'name');
      if (!name) throw new Error('pages create needs a non-empty name');
      const page = doc.createPage(name);
      log(meta, doc, 'create_page', []);
      return text(page);
    }
    if (action === 'move_boards') {
      need('pages', action, { artboard_ids, page_id }, 'artboard_ids', 'page_id');
      doc.moveToPage(artboard_ids, page_id);
      log(meta, doc, 'move_to_page', artboard_ids);
      return text('ok');
    }
    need('pages', action, { page_id }, 'page_id');
    if (action === 'set') {
      doc._pageId(page_id); // throws a helpful error for an unknown page
      ui.currentPage.set(meta.id, page_id);
      return text(`New artboards will go to ${page_id}`);
    }
    if (action === 'update') {
      const page = doc.updatePage(page_id, { name, background });
      log(meta, doc, 'update_page', []);
      return text(page);
    }
    // Agents keep the safe default (boards move to the first remaining page); the UI dialog deletes them.
    doc._pageId(page_id);
    const dest = move_boards_to ?? doc.pages.find((p) => p.id !== page_id)?.id;
    doc.deletePage(page_id, dest);
    if (ui.currentPage.get(meta.id) === page_id) ui.currentPage.delete(meta.id);
    log(meta, doc, 'delete_page', []);
    return text({ deleted: page_id, boards_moved_to: dest });
  }));

  // add / delete of reference pictures in one tool; compare_to_reference and capture_url stay separate (different jobs).
  server.registerTool('references', {
    description: 'Reference pictures to rebuild a design from. action add (path, optional name, page_id): give an absolute file path on this machine (PNG, JPEG, GIF or WebP, up to 10 MB); it appears on the canvas as a locked "Reference" board, build your own artboard next to it, then call compare_to_reference. action delete (reference_id): remove a reference and its board.',
    inputSchema: { ...pid, action: z.enum(['add', 'delete']), path: z.string().optional(), name: z.string().max(80).optional(), page_id: z.string().optional(), reference_id: z.string().optional() },
  }, safe(({ project_id, action, path: file, name, page_id, reference_id }) => {
    const { meta, doc } = target(project_id);
    if (action === 'delete') {
      need('references', action, { reference_id }, 'reference_id');
      doc.deleteReference(reference_id);
      log(meta, doc, 'delete_reference', []);
      return text('ok');
    }
    need('references', action, { path: file }, 'path');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`File not found: ${file}`);
    if (fs.statSync(file).size > 10_000_000) throw new Error('Image too large (10 MB max)');
    const { ref, board } = store.addReference(meta.id, { name: name || file.split(/[\/]/).pop().replace(/\.[^.]+$/, ''), buffer: fs.readFileSync(file), page: page_id ?? ui.currentPage.get(meta.id) });
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
      prune_css: z.boolean().optional().describe('Also return css_report: the page\'s own CSS reduced to rules that match its DOM (breakpoints, hover / focus rules, custom properties, used fonts, keyframes). A reference to read; the board markup does not change. Default false.'),
    },
  }, safe(async ({ project_id, url: pageUrl, width, name, page_id, allow_private, prune_css }) => {
    const { meta, doc } = target(project_id);
    const cap = await captureUrl(pageUrl, { width, allowPrivate: allow_private, pruneCss: prune_css });
    const page = page_id ?? ui.currentPage.get(meta.id);
    const ab = doc.createArtboard({ name: (name || cap.title || 'Captured page').slice(0, 80), width: cap.width, height: Math.max(40, cap.height), heightMode: 'fit', page });
    // normalize:false -> the copy is written as captured; the sanitizer still runs on it.
    doc.writeHtml(ab.id, cap.html, 'replace', { normalize: false });
    const { ref, board } = store.addReference(meta.id, { name: `${ab.name} (screenshot)`.slice(0, 80), buffer: cap.screenshot, page });
    log(meta, doc, 'capture_url', ab.id, cap.finalUrl);
    return text({ artboard_id: ab.id, reference_id: ref.id, reference_artboard_id: board.id, width: cap.width, height: cap.height, nodes: cap.nodes, url: cap.finalUrl, ...(cap.cssReport && { css_report: cap.cssReport }), ...(cap.truncated && { warning: 'The page was larger than the capture limits, so the copy is cut off.' }) });
  }));

  server.registerTool('compare_to_reference', {
    description: 'Compare an artboard with a reference image pixel by pixel (both scaled to the same width, at most 800 px). Returns the share of pixels that differ, the worst areas of a 4x4 grid, and a diff image (red = different, faded reference elsewhere). Use it to fix the biggest differences first; stop after 3 rounds or when different is under about 5%. Works with no tab open (a headless browser renders it).',
    inputSchema: { ...pid, artboard_id: z.string(), reference_id: z.string().optional().describe('Default: the most recently added reference.') },
  }, safe(async ({ project_id, artboard_id, reference_id }) => {
    const { meta, doc } = target(project_id);
    const ab = doc.getArtboard(artboard_id);
    if (!ab) throw new Error(`Artboard ${artboard_id} not found`);
    if (ab.generated === 'reference') throw new Error('Pick your own artboard, not a reference board');
    const ref = reference_id ? doc.references.find((r) => r.id === reference_id) : doc.references.at(-1);
    if (!ref) throw new Error(doc.references.length ? `Reference ${reference_id} not found` : 'No reference images yet. Call references (action add) first.');
    const r = await requestCompare(meta.id, artboard_id, ref.id);
    const { dataUrl, ...summary } = r;
    return { content: [{ type: 'text', text: JSON.stringify({ reference_id: ref.id, ...summary }) }, { type: 'image', data: dataUrl.split(',')[1], mimeType: 'image/jpeg' }] };
  }));

  server.registerTool('get_changes', {
    description: 'What the USER changed by hand (moved, resized, renamed, deleted, duplicated or created artboards) since you last called this, so you never re-read a whole board to find out. `others` lists what other agents changed meanwhile. Pass since_version to look further back; the returned version is what to pass next time.',
    inputSchema: { ...pid, since_version: z.number().int().min(0).optional() },
  }, safe(({ project_id, since_version }) => {
    const { meta, doc } = target(project_id);
    return text(userChanges(meta, doc, since_version));
  }));

  server.registerTool('finish_working', {
    description: 'Call when you are done with a task: clears the highlight the canvas shows on nodes you were editing, and checks that every board you edited still fits its frame. If it reports a problem, fix it (fit_artboard, narrower widths) and call finish_working again. Pass screenshot_artboard_id to get the final look (default get_screenshot settings) in the same call once the layout is fine.',
    inputSchema: { ...pid, screenshot_artboard_id: z.string().optional() },
  }, safe(async ({ project_id, screenshot_artboard_id }) => {
    const { meta, doc } = target(project_id);
    highlight?.(meta.id, [], agentOf());
    const ids = [...(ui.touched.get(meta.id) ?? [])];
    const r = ids.length ? await checkLayout(meta, doc, ids) : null;
    // Clear only when the check ran: with no browser tab the boards stay "touched" for the next attempt.
    if (r || !ids.length) ui.touched.delete(meta.id);
    if (!r) return text(ids.length ? 'ok (layout not checked: open the project in a browser tab to verify nothing is clipped)' : 'ok');
    if (!r.text.startsWith('ok')) return text(`Not finished, content does not fit:\n${r.text}`);
    // Layout is fine: attach the final look so "last screenshot + finish" is one turn. Skipped on problems above.
    if (screenshot_artboard_id) return { content: [{ type: 'text', text: 'ok' }, ...(await shoot(meta, doc, { artboard_id: screenshot_artboard_id }))] };
    return text('ok');
  }));

  server.registerTool('check_layout', {
    description: 'Measure real layout in the browser and report content that does not fit its artboard: content taller or wider than the frame, nodes that extend past it, nodes that clip their own content. Boards in fit mode are grown to their content automatically. Omit artboard_id to check every board on the current page (max 20). Works with no tab open (a headless browser renders it).',
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
    description: 'Make a board fit its content: switches it to fit mode and sets its height to exactly what the content needs (not below min_height). This is the one-call fix for a clipped board; never delete and rebuild a board for an overflow. Measures in an open tab or, with none, in a headless browser.',
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

  // ---- assets (icons + brand logos from Iconify) --------------------------------------
  // One action tool: searches return ready-to-paste inline <svg> for the top few hits; insert places one via the
  // import_svg path so it gets ids and a fit-height board grows around it. Stock photos are out of scope (API keys).
  server.registerTool('assets', {
    description: 'Real icons and brand logos instead of placeholder boxes. action icons (query, set default lucide; others: tabler, phosphor, heroicons...): UI icons. action logos (query = brand name or domain, e.g. "stripe" or "github.com"): brand marks from simple-icons (mono) and logos (full colour). Both return ids ("lucide:arrow-right") plus inline <svg> for the first few (size px, color oklch / currentColor / var(--x); hex is converted). action insert (id, target_id, optional size, color, mode, name): place one on the board as an editable node. Needs internet the first time; results are cached on disk. No stock photos.',
    inputSchema: {
      ...pid,
      action: z.enum(['icons', 'logos', 'insert']),
      query: z.string().optional(), set: z.string().optional(), limit: z.number().int().min(1).max(24).optional(),
      size: z.number().int().min(8).max(512).optional(), color: z.string().optional(),
      id: z.string().optional().describe('prefix:name, e.g. lucide:home (insert)'), target_id: z.string().optional(),
      mode: z.enum(['replace', 'append', 'prepend', 'before', 'after']).optional(), name: z.string().optional(),
    },
  }, safe(async ({ project_id, action, query, set, limit, size, color, id, target_id, mode, name }) => {
    if (!assets) throw new Error('assets: not available on this server');
    if (action === 'insert') {
      need('assets', action, { id, target_id }, 'id', 'target_id');
      const { prefix, name: icon } = splitId(id);
      const svg = await assets.getSvg(prefix, icon, { size, color });
      return text(await edits.import_svg({ project_id, target_id, svg, mode, name: name ?? icon }));
    }
    need('assets', action, { query }, 'query');
    const found = action === 'icons' ? await assets.searchIcons(query, { set, limit, size, color }) : await assets.searchLogos(query, { limit, size, color });
    if (!found.length) return text(`No ${action} found for "${query}". Try a simpler or more generic word.`);
    return text({ results: formatResults(found), note: 'Paste svg as is (colours follow CSS color via currentColor; logos keep brand colours). Use insert for ids without svg.' });
  }));

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
    store.logAction(meta.id, { agent: agentOf(), tool: 'use_font', detail: `${font.family} ${[...new Set(font.faces.map((f) => f.weight))].join(',')}` });
    return text({
      family: font.family,
      css: fontStack(font.family, category),
      weights: [...new Set(font.faces.map((f) => f.weight))],
      italic: font.faces.some((f) => f.style === 'italic'),
      note: 'Paste css as the font-family value. Only the listed weights exist; others are synthesized.',
    });
  }));

  server.registerTool('history', {
    description: 'action undo: revert the last design change(s) made through update_styles, write_html, set_text_content, rename, duplicate, delete or create_artboard; returns what was reverted. action redo: re-apply what undo reverted (only until the next new change). steps defaults to 1.',
    inputSchema: { ...pid, action: z.enum(['undo', 'redo']), steps: z.number().int().min(1).max(20).optional() },
  }, safe(({ project_id, action, steps = 1 }) => {
    const { meta, doc } = target(project_id);
    // logAction keeps the plain 'undo' / 'redo' names: the Activity panel and eval metrics read them.
    const done = action === 'undo' ? doc.undo(steps, session.agent.id) : doc.redo(steps, session.agent.id);
    if (!done.length) return text(`Nothing to ${action}`);
    store.logAction(meta.id, { agent: agentOf(), tool: action, detail: done.join(', ') });
    return text(action === 'undo' ? { reverted: done } : { redone: done });
  }));

  server.registerTool('get_node_info', {
    description: 'Details of one node: tag, inline style, text and child ids. Set include_html to also get its HTML (capped at 2000 chars); get_tree is cheaper for structure.',
    inputSchema: { ...pid, node_id: z.string(), include_html: z.boolean().optional() },
  }, safe(({ project_id, node_id, include_html }) => text(withHtml(target(project_id).doc.nodeInfo(node_id), include_html))));

  server.registerTool('update_styles', {
    description: 'Merge CSS properties (camelCase or kebab-case) into one or more nodes. Use null to remove a property. Adds a lint line only when the change introduces new lint issues.',
    inputSchema: {
      ...pid,
      node_ids: z.array(z.string()).min(1),
      styles: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
    },
  }, viaEdit('update_styles'));

  server.registerTool('set_attrs', {
    description: 'Set SVG attributes (d, fill, stroke, stroke-width, viewBox, transform, cx/cy/r...) on nodes inside an <svg>. Use null to remove one. Only geometry and paint attributes are allowed; colours as oklch(). For HTML nodes use update_styles.',
    inputSchema: {
      ...pid,
      node_ids: z.array(z.string()).min(1),
      attrs: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
    },
  }, viaEdit('set_attrs'));

  server.registerTool('import_svg', {
    description: 'Place an SVG on the board as an editable node (paths, groups and shapes get ids like any other node). Pass svg (markup) or file (path inside the repo linked with tokens link_repo). Scripts, foreignObject, external images and remote url() are stripped. mode defaults to append.',
    inputSchema: {
      ...pid,
      target_id: z.string().describe('Artboard or node to place it in/next to'),
      svg: z.string().optional(),
      file: z.string().optional(),
      mode: z.enum(['replace', 'append', 'prepend', 'before', 'after']).optional(),
      name: z.string().optional().describe('Layer name for the imported root'),
    },
  }, viaEdit('import_svg'));

  server.registerTool('set_text_content', {
    description: 'Replace the text inside a node (plain text; markup is escaped).',
    inputSchema: { ...pid, node_id: z.string(), text: z.string() },
  }, viaEdit('set_text_content'));

  server.registerTool('rename_nodes', {
    description: 'Give nodes or artboards friendly names. Map of id to new name.',
    inputSchema: { ...pid, names: z.record(z.string(), z.string()) },
  }, viaEdit('rename_nodes'));

  server.registerTool('duplicate_nodes', {
    description: 'Duplicate nodes (placed right after the original) or artboards. Returns new ids.',
    inputSchema: { ...pid, ids: z.array(z.string()).min(1) },
  }, viaEdit('duplicate_nodes'));

  server.registerTool('delete_nodes', {
    description: 'Delete nodes or whole artboards.',
    inputSchema: { ...pid, ids: z.array(z.string()).min(1) },
  }, viaEdit('delete_nodes'));

  // Many edits in one call: the main lever against turn count (every turn re-reads the whole conversation).
  // Ops run in order through the same handlers as the single tools; the first error stops the run (no rollback).
  const BATCH_TOOLS = Object.keys(edits);
  server.registerTool('batch', {
    description: 'Run 3+ independent edits in ONE call instead of one turn each. Ops run in order against one project; one result line per op. Allowed tools: ' + BATCH_TOOLS.join(', ') + '. Stops at the first error (earlier ops stay applied: use history undo). Layout is checked once at the end and reported only if something does not fit; per-op lint is not run (use lint or get_screenshot review).',
    inputSchema: {
      ...pid,
      ops: z.array(z.object({ tool: z.enum(BATCH_TOOLS), args: z.record(z.string(), z.any()) })).min(1).max(30).describe('Each op: tool name plus the arguments of that tool (without project_id).'),
    },
  }, safe(async ({ project_id, ops }) => {
    const { meta, doc } = target(project_id);
    const lines = [];
    batchBoards = new Set();
    try {
      for (const [i, op] of ops.entries()) {
        const label = `${i + 1} ${op.tool}`;
        // A per-op project would let one batch write into another project, and the layout check below covers one.
        if ('project_id' in op.args) { lines.push(label + ' error: project_id is not allowed in an op, set it on the batch'); break; }
        try {
          const r = await edits[op.tool]({ ...op.args, project_id: meta.id }, true);
          lines.push(r === 'ok' ? label + ' ok' : label + ' ' + (typeof r === 'string' ? r : JSON.stringify(r)));
        } catch (e) {
          lines.push(label + ' error: ' + e.message);
          break;
        }
      }
      const failed = lines.at(-1).includes(' error: ');
      if (failed) lines.push(lines.length === 1 ? `Stopped at op 1; nothing was applied.` : `Stopped at op ${lines.length}; ops 1-${lines.length - 1} stay applied (no rollback; history undo reverts them).`);
      const r = batchBoards.size ? await checkLayout(meta, doc, [...batchBoards]) : null;
      if (r && !r.text.startsWith('ok')) lines.push('layout: ' + r.text);
      return { isError: failed, content: [{ type: 'text', text: lines.join('\n') }] };
    } finally {
      batchBoards = null;
    }
  }));

  // start: the first call of a request. Resolve/create the project, log the prompt and optionally create the first
  // board, so the normal opening (list_projects + create/open + log_prompt + create_artboard) is one turn. For an
  // existing project it also returns what the agent would otherwise fetch (open comments, user changes, boards).
  // The resolved project is bound to this session (store.activeId is shared between sessions, so it is only a fallback).
  server.registerTool('start', {
    description: 'Begin a request in ONE call (replaces list_projects + create_project/project open + log_prompt + create_artboard). project: an id (p_...) or a name; an existing project matches by exact id or name (case-insensitive), otherwise one is created with that name. Without project the active one is used. Returns project_id (later calls use this project automatically); for an existing project also its open comments, the changes the user (and other agents) made and its artboards, so skip get_comments / get_changes / get_basic_info. artboard (same fields as create_artboard, html optional) creates the first board.',
    inputSchema: {
      prompt: z.string().min(1).max(500).describe("The request in the user's own words (one short sentence)."),
      project: z.string().max(80).optional().describe('Project id or name (2-4 words, e.g. the repo or feature).'),
      description: z.string().max(300).optional().describe('One line, used only when the project is created.'),
      agent: z.string().max(40).optional().describe('Optional name for you (e.g. reviewer) so the user can tell agents apart.'),
      brief: z.string().min(1).max(1500).optional().describe('For a new design: the brief you posted in chat.'),
      status: STATUS_FIELD,
      artboard: z.object({
        name: z.string().optional(), width: z.number().min(40).max(5000).optional(), height: z.number().min(40).max(10000).optional(),
        height_mode: z.enum(['fit', 'fixed']).optional(), page_id: z.string().optional(), x: z.number().optional(), y: z.number().optional(),
        html: z.string().max(200_000).optional(),
      }).optional(),
    },
  }, safe(async ({ prompt, project, description, brief, artboard, agent }) => {
    let created = false, meta;
    if (project) {
      const wanted = project.trim();
      const found = /^p_[a-f0-9]{8}$/.test(wanted) ? store.get(wanted) : null;
      const hit = found && !found.meta.deletedAt ? found.meta : store.findByName(wanted);
      if (hit) meta = hit;
      else { meta = store.create({ name: wanted, description, unique: 'error' }); created = true; }
    } else {
      if (!currentId()) throw new Error('No active project. Pass project: a name for a new project, or an id/name of an existing one (list_projects to browse).');
      meta = target(null).meta;
    }
    store.setActive(meta.id);
    bind(meta.id);
    if (agent) session.setLabel(agent);
    const { doc } = store.get(meta.id);
    const out = { project_id: meta.id, created };
    // Read before this request writes anything, so boards/changes describe the state the user left.
    if (!created) {
      const open = store.listComments(meta.id).filter((c) => !c.resolved);
      if (open.length) {
        out.comments = `${open.length} open` + open.slice(0, 10).map((c) => `\n${c.id} ${c.targetId} ${c.text.length > 120 ? c.text.slice(0, 120) + '…' : c.text}`).join('') + (open.length > 10 ? `\n+${open.length - 10} more (get_comments)` : '');
      }
      const ch = userChanges(meta, doc);
      if (ch.changes !== 'none') out.changes = ch;
      if (ch.others) out.others = ch.others;
      // Rules + latest decisions ride along so agents obey them without another call; absent when memory is empty.
      const mem = formatMemory(store.listMemory(meta.id));
      if (mem) out.memory = mem;
      const boards = doc.data.artboards;
      // Position + page on each line: without them agents guessed x/y for a new row and stacked boards.
      if (boards.length) out.artboards = boards.map((a) => `${a.id} ${a.name} ${a.width}x${a.height} at ${a.x},${a.y}${doc.data.pages?.length ? ' ' + doc.pageOf(a) : ''}`).join('\n');
    } else ui.lastRead.set(meta.id, doc.version);
    store.logPrompt(meta.id, prompt, brief, agentOf());
    if (artboard) {
      // Keep only what the agent needs from the create_artboard result: the id plus its dialect/lint/layout/reminder notes.
      const r = await edits.create_artboard({ ...artboard, project_id: meta.id });
      const { created: ids, dialect, lint, layout, reminder } = r;
      Object.assign(out, { artboard_id: r.id }, ids && { created_ids: ids }, { ...(dialect && { dialect }), ...(lint && { lint }), ...(layout && { layout }), ...(reminder && { reminder }) });
    }
    return text(out);
  }));

  // Screenshot as MCP content parts (image, plus a note when cut). Shared by get_screenshot and finish_working.
  const shoot = async (meta, doc, { artboard_id, node_id, scale, max_width, max_height = 1600, format = 'jpeg' }) => {
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
    return content;
  };

  server.registerTool('get_screenshot', {
    description: 'Render an artboard (or just one node, via node_id) so you can review your work. review:true makes this the whole review step in one call: it first returns the lint text for the target ("clean" when none) and a layout line only if something does not fit, then the image. Defaults are token-lean: 1x, max 800 px wide, cut at 1600 px tall (a note says where; use node_id for the rest), JPEG. Use node_id to look at one component instead of the whole board; ask for scale 2 or png only when you must read tiny text. Works with no tab open (a headless browser renders it).',
    inputSchema: {
      ...pid,
      artboard_id: z.string(),
      node_id: z.string().optional().describe('Crop to this node (must be inside the artboard).'),
      scale: z.number().min(0.25).max(2).optional(),
      max_width: z.number().int().min(200).max(2000).optional(),
      max_height: z.number().int().min(400).max(8000).optional().describe('Output px; taller images are cut at the bottom. Default 1600.'),
      format: z.enum(['jpeg', 'png']).optional(),
      review: z.boolean().optional().describe('Also return lint text and any layout problem before the image.'),
    },
  }, safe(async ({ project_id, artboard_id, node_id, scale, max_width, max_height, format, review }) => {
    const { meta, doc } = target(project_id);
    const content = [];
    if (review) {
      // One-call review: lint of the target, then the layout line only when something does not fit
      // (layoutNote is silent without a browser tab), then the image below.
      const lintText = formatIssues(doc.lint(node_id ?? artboard_id));
      const note = await layoutNote(meta, doc, artboard_id);
      content.push({ type: 'text', text: `lint: ${lintText}${note.layout ? `\nlayout: ${note.layout}` : ''}` });
    }
    content.push(...(await shoot(meta, doc, { artboard_id, node_id, scale, max_width, max_height, format })));
    return { content };
  }));

  server.registerTool('get_computed_styles', {
    description: 'Computed CSS (as the browser resolved it) for nodes, only the properties you ask for, e.g. ["width","height","color","font-size"]. Use it to check real sizes and colours instead of guessing from inline styles. Works with no tab open (a headless browser renders it).',
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

  // Code handed to a codebase, three renderings behind one `format` (PNG stays in `export`, which writes a file).
  server.registerTool('export_code', {
    description: 'Return code for a design. format react: an artboard (artboard_id) as a React component where each inline style becomes one Tailwind arbitrary-property class, so it renders like the canvas (replace them with your own utilities or tokens afterwards; needs Tailwind in the target app). html: an artboard as a standalone HTML document (tokens as :root properties, Google Fonts linked). jsx: ONE node and its subtree (node_id) in the react style, to hand over a single component.',
    inputSchema: { ...pid, format: z.enum(['react', 'html', 'jsx']), artboard_id: z.string().optional(), node_id: z.string().optional() },
  }, safe(({ project_id, format, artboard_id, node_id }) => {
    const { meta, doc } = target(project_id);
    if (format === 'jsx') {
      need('export_code', 'jsx', { node_id }, 'node_id');
      if (doc.getArtboard(node_id)) throw new Error(`${node_id} is an artboard: use format react`);
      const info = doc.nodeInfo(node_id);
      const el = parse(info.html, { comment: false }).firstChild;
      return text(nodeToReact(el, info.name || info.tag, doc.theme, usedProjectFonts(info.html, meta.fonts).map(productionUrl)));
    }
    need('export_code', format, { artboard_id }, 'artboard_id');
    const ab = doc.getArtboard(artboard_id);
    if (!ab) throw new Error(`Artboard ${artboard_id} not found`);
    if (format === 'react') return text(artboardToReact(ab, doc.theme, usedProjectFonts(ab.html, meta.fonts).map(productionUrl)));
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


  // ---- find (small tool) ---------------
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

  // Rendered by the open tab (same exporter as the Export button): PNG, JPG, SVG, and a raster PDF (one JPEG page).
  const EXPORT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'exports');
  server.registerTool('export', {
    description: 'Render an artboard (or one node via node_id) to a file on disk and return its path. Without scale/format it writes the settings saved in the Export section for that item, else PNG at 2x. format png (layer on transparent), jpg, svg or pdf. Works without an open tab when Chrome/Edge is installed. Files go to data/exports/<project_id>/ unless dir is given.',
    inputSchema: {
      ...pid,
      artboard_id: z.string(),
      node_id: z.string().optional().describe('Crop to this node (must be inside the artboard).'),
      scale: z.number().min(0.25).max(4).optional(),
      format: z.enum(['png', 'jpg', 'svg', 'pdf']).optional(),
      dir: z.string().optional().describe('Absolute output folder (created if missing). Default data/exports/<project_id>.'),
    },
  }, safe(async ({ project_id, artboard_id, node_id, scale, format, dir }) => {
    const { meta, doc } = target(project_id);
    const ab = doc.getArtboard(artboard_id);
    if (!ab) throw new Error(`Artboard ${artboard_id} not found`);
    if (node_id && doc.artboardOf(node_id)?.id !== artboard_id) throw new Error(`Node ${node_id} is not inside ${artboard_id}`);
    if (dir && !path.isAbsolute(dir)) throw new Error('dir must be an absolute path');
    const id = node_id ?? artboard_id;
    const saved = doc.exportSettings[id];
    const rows = scale === undefined && !format && saved?.length ? saved : [{ scale: `${scale ?? 2}x`, format: format ?? 'png' }];
    const out = dir ? path.resolve(dir) : path.join(EXPORT_DIR, meta.id);
    fs.mkdirSync(out, { recursive: true });
    // The file name is generated from the board/node name, never taken from the caller (no path tricks).
    const label = (node_id ? doc.nodeInfo(node_id).name ?? '' : ab.name).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'export';
    const files = [];
    for (const row of rows) {
      const dataUrl = await requestScreenshot(meta.id, artboard_id, { nodeId: node_id, exportRow: row });
      const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
      const suffix = (row.suffix ?? `@${row.scale.replace(/x$/, '')}x`).replace(/[^A-Za-z0-9._@-]+/g, '-');
      const file = path.join(out, `${label}-${id}${suffix}.${row.format}`);
      fs.writeFileSync(file, buf);
      files.push({ path: file, bytes: buf.length });
    }
    return text(files.length === 1 ? files[0] : { files });
  }));

  // Core toolset: disable everything outside CORE_TOOLS and offer one tool that turns them back on.
  // A disabled RegisteredTool is left out of tools/list and refuses calls; enable() makes the SDK send a
  // `notifications/tools/list_changed`, and clients that honour it re-list. `session.tools` remembers the choice so a
  // revived session (server restart, one McpServer per request) keeps the full list too.
  if (toolset === 'core') {
    const extended = [...registered.keys()].filter((n) => !CORE_TOOLS.has(n));
    for (const n of extended) registered.get(n).disable();
    const more = server.registerTool('more_tools', {
      description: `Shows the hidden tools: ${extended.join(', ')}. Call once, only when you need one of them.`,
      inputSchema: {},
    }, safe(() => {
      session.tools = 'all';
      for (const n of extended) registered.get(n).enable();
      more.disable(); // nothing left to unlock; also drops its own schema from the list
      return text(`Enabled ${extended.length} tools. If your client does not show them yet, reconnect the design-canvas MCP server (or register its URL with ?tools=all).`);
    }));
  }

  // The SDK stamps `$schema` on every inputSchema (~14 tokens x 62 tools) and the model gets nothing from it.
  // There is no option for that, so wrap the tools/list handler it installed (the registrations above set it up).
  // `_requestHandlers` is an internal Map of the SDK's Protocol class; if it ever disappears we just keep the key.
  const listTools = server.server._requestHandlers?.get('tools/list');
  if (listTools) {
    server.server._requestHandlers.set('tools/list', async (...args) => {
      const res = await listTools(...args);
      for (const t of res.tools) { delete t.inputSchema?.$schema; delete t.outputSchema?.$schema; }
      return res;
    });
  }

  return server;
}
