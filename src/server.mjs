// One local process that does four jobs:
//   1. serves the web UI: project home (/) and the canvas (/p/<id>)
//   2. pushes live changes to open browser tabs over Server-Sent Events
//   3. exposes the design + project tools to Claude Code as an MCP server at /mcp
//   4. persists everything in data/ (see store.mjs)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ProjectStore, ID_RE } from './store.mjs';
import { createMcpServer } from './mcp.mjs';
import { Meter } from './meter.mjs';
import { CallLog, RING } from './agentlog.mjs';
import { analyze, evalSummary, fixedCosts } from './efficiency.mjs';
import { guideText } from './guide.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { layoutMetrics, lintMetrics } from './evalmetrics.mjs';
import { extractTokens } from './tokens.mjs';
import { FontCache } from './fonts.mjs';
import { HeadlessWorker } from './headless.mjs';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { Session, SessionMap } from './sessions.mjs';
import { Claims } from './claims.mjs';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3777);
// Loopback only: the MCP endpoint can edit your designs, so it must not be reachable from the network.
const HOST = '127.0.0.1';
// Build output of the React client (web/, `pnpm build:web`). It is the only UI the server serves.
const WEB = path.join(ROOT, 'web', 'dist');

// DC_DATA lets a second instance (tests, a spare port) run on its own data folder instead of sharing data/.
const DATA = process.env.DC_DATA || path.join(ROOT, 'data');
const store = new ProjectStore(DATA);

// One-time migration: the pre-projects version kept a single design.json in the repo root.
const legacy = path.join(ROOT, 'design.json');
if (fs.existsSync(legacy) && store.metas.size === 0) {
  try {
    const json = JSON.parse(fs.readFileSync(legacy, 'utf8'));
    const meta = store.create({ name: 'Sprig design system', description: 'Migrated from the single-design version.' });
    store.get(meta.id).doc.replace(json);
    fs.renameSync(legacy, legacy + '.migrated');
    console.log('Migrated design.json into project "' + meta.name + '"');
  } catch (e) {
    console.warn('Could not migrate design.json:', e.message);
  }
}

// Shared UI state the MCP tools need to read (selection) or request (screenshots).
const ui = {
  selection: new Map(), // projectId -> selected ids
  clients: new Set(), // { res, projectId } for every open SSE stream (projectId null = home page)
  pendingShots: new Map(), // requestId -> { resolve, reject, timer }
  lastRead: new Map(), // projectId -> journal version Claude last saw through get_changes
  currentPage: new Map(), // projectId -> page id that create_artboard targets by default
  agentTimers: new Map(), // projectId -> timer that clears the "Claude is editing" highlight
  touched: new Map(), // projectId -> Set of artboard ids Claude edited since its last finish_working (the layout gate checks these)
};
const meter = new Meter(); // per-tool token estimates, shown by /api/status
// Per-call MCP log; its events ride the store's listener list so they reach tabs like every other event.
const calls = new CallLog({ dataDir: DATA, emit: (t, p) => store._emit(t, p) });

// Send the document as a delta. Each client remembers the HTML it last received per artboard;
// unchanged boards go out with html:null and the browser reuses its copy. A single MCP write
// then costs a few KB instead of re-sending the whole (often multi-MB) design to every tab.
function sendDoc(c, data) {
  const sent = (c.sent ??= new Map());
  const artboards = data.artboards.map((ab) => {
    const same = sent.get(ab.id) === ab.html; // string compare: same reference is O(1), else length-first
    sent.set(ab.id, ab.html);
    return same ? { ...ab, html: null } : ab;
  });
  for (const id of sent.keys()) if (!data.artboards.some((a) => a.id === id)) sent.delete(id);
  send(c.res, 'doc', { ...data, artboards });
}

const send = (res, event, payload) => res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);

// Fan store events out to the right browser tabs.
store.on((type, payload) => {
  for (const c of ui.clients) {
    if (type === 'doc' && c.projectId === payload.id) sendDoc(c, payload.data);
    else if (type === 'meta' && c.projectId === payload.id) send(c.res, 'meta', payload.meta);
    else if (type === 'comments' && c.projectId === payload.id) send(c.res, 'comments', payload.comments);
    else if (type === 'activity' && c.projectId === payload.id) send(c.res, 'activity', {});
    else if ((type === 'call' || type === 'call-start') && c.projectId === payload.project) send(c.res, type, payload.call);
    else if (type === 'projects' && c.projectId === null) send(c.res, 'projects', {});
    else if (type === 'comments' && c.projectId === null) send(c.res, 'comments-changed', {});
  }
});

// Ask an open tab of this project to do something only a browser can (rasterize an artboard,
// read computed styles): it needs real layout. The tab answers via POST /api/p/:id/reply.
// With no tab open, the headless worker (headless.mjs) starts one in the background.
const headless = new HeadlessWorker({
  port: PORT,
  hasTab: (projectId) => [...ui.clients].some((c) => c.projectId === projectId),
});

async function askBrowser(projectId, event, payload, timeoutMs = 15000) {
  if (![...ui.clients].some((c) => c.projectId === projectId)) {
    try {
      await headless.ensure(projectId);
    } catch (e) {
      throw new Error(`Open the project in a browser tab first (http://localhost:${PORT}/p/${projectId}). Headless fallback failed: ${e.message}`);
    }
  } else {
    headless.touch(projectId);
  }
  // A real tab the user is looking at wins over the headless one.
  const tabs = [...ui.clients].filter((c) => c.projectId === projectId).sort((a, b) => Number(!!a.headless) - Number(!!b.headless));
  if (!tabs.length) throw new Error('The browser tab closed before it could answer');
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      ui.pendingShots.delete(id);
      reject(new Error(`Browser did not answer ${event} in time`));
    }, timeoutMs);
    ui.pendingShots.set(id, { resolve, reject, timer });
    send(tabs[0].res, event, { id, ...payload });
  });
}
const requestScreenshot = (projectId, artboardId, opts = {}) => askBrowser(projectId, 'screenshot', { artboardId, ...opts });
const requestCompare = (projectId, artboardId, refId) => askBrowser(projectId, 'compare', { artboardId, refId });
// Layout checks run on every write, so a hung tab must not stall the tool call for the full 15 s.
const requestMeasure = (projectId, boards) => askBrowser(projectId, 'measure', { boards }, 5000);
const requestComputed = (projectId, nodeIds, props) => askBrowser(projectId, 'computed', { nodeIds, props });

// Light up the nodes Claude just touched in every tab of the project. They clear on
// finish_working, or on their own after 10 s so a forgotten call never leaves them stuck.
function highlight(projectId, ids, agent = null) {
  clearTimeout(ui.agentTimers.get(projectId));
  for (const c of ui.clients) if (c.projectId === projectId) send(c.res, 'agent', { ids: ids.slice(0, 40), ...(agent && { agent }) });
  if (ids.length) ui.agentTimers.set(projectId, setTimeout(() => highlight(projectId, []), 10_000));
}

// Google Fonts the server downloaded (use_font). Shared by all projects, so a family is fetched once.
const fonts = new FontCache(path.join(DATA, 'fonts'));

// What every agent pays before doing anything: the tools/list payload, the server instructions and one get_guide().
// Measured once by listing the tools through an in-memory client (the same path a real client takes) and cached,
// because it only changes when the server code does.
let fixedCache = null;
async function measureFixed() {
  if (fixedCache) return fixedCache;
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ store, ui, fonts, highlight, port: PORT });
  const client = new Client({ name: 'cost-probe', version: '0' });
  try {
    await Promise.all([server.connect(a), client.connect(b)]);
    const { tools } = await client.listTools();
    fixedCache = fixedCosts({ tools, instructions: client.getInstructions(), guide: guideText('start') });
  } finally { await client.close().catch(() => {}); }
  return fixedCache;
}

// Soft board claims + paused agents (src/claims.mjs). Any change is pushed to the project's tabs as an SSE `claims`
// event; a pause is global (an agent id, not a project), so it goes to every tab.
const claimsPayload = (projectId) => ({ claims: projectId ? claims.list(projectId) : [], paused: claims.pausedList() });
const claims = new Claims({
  onChange: (projectId) => { for (const c of ui.clients) if (projectId === null || c.projectId === projectId) send(c.res, 'claims', claimsPayload(c.projectId)); },
});

const mcpDeps = { store, ui, fonts, requestScreenshot, requestMeasure, requestComputed, requestCompare, highlight, meter, calls, claims, port: PORT };

// Sessions of the MCP endpoint. Each client gets its own McpServer so identity and project binding live with it.
const sessions = new SessionMap();
setInterval(() => sessions.sweep(), 60_000).unref();

// A client may hold a session id this process no longer knows (server restart, idle TTL). Answering 404 would be
// spec-correct but the SDK client does not re-initialize on it, so every restart would break the tools. Instead such
// requests are served statelessly under a revived Session with the same id (see SessionMap.revive).
async function handleStaleSession(req, res, url, sid) {
  if (req.method === 'DELETE') { sessions.remove(sid); res.writeHead(204).end(); return; }
  if (req.method !== 'POST') { res.writeHead(405).end(); return; } // no standalone SSE stream without a real session
  const body = await readJson(req);
  const mcp = createMcpServer({ ...mcpDeps, session: sessions.revive(sid, url.searchParams.get('agent')) });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); mcp.close(); });
  await mcp.connect(transport);
  await transport.handleRequest(req, res, body);
}

async function handleMcp(req, res, url) {
  const sid = req.headers['mcp-session-id'];
  if (sid) {
    const entry = sessions.get(String(sid));
    if (!entry) return handleStaleSession(req, res, url, String(sid));
    if (req.method === 'DELETE') { await entry.transport.handleRequest(req, res); sessions.remove(entry.session.id); return; }
    const body = req.method === 'POST' ? await readJson(req) : undefined;
    return entry.transport.handleRequest(req, res, body);
  }
  if (req.method !== 'POST') { res.writeHead(405).end(); return; }
  const body = await readJson(req);
  // New client: `initialize` opens a session. The optional ?agent=<name> in the registered URL labels it (Claude Code
  // subagents share one connection, so the label is the only way to tell them apart).
  if (isInitializeRequest(body)) {
    const session = new Session(null, url.searchParams.get('agent'));
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (id) => { session.id = id; sessions.add(session, transport, mcp); },
    });
    const mcp = createMcpServer({ ...mcpDeps, session });
    transport.onclose = () => { if (session.id) sessions.map.delete(session.id); };
    await mcp.connect(transport);
    return transport.handleRequest(req, res, body);
  }
  // Old stateless clients (no session header, no initialize): serve the request on a throwaway server that falls back
  // to the active project, exactly as before sessions existed.
  const mcp = createMcpServer(mcpDeps);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); mcp.close(); });
  await mcp.connect(transport);
  await transport.handleRequest(req, res, body);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 20_000_000) throw new Error('Request too large');
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString();
  return raw ? JSON.parse(raw) : {};
}

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

// Project-level actions (home page + canvas header).
const projectActions = {
  rename: (id, b) => store.update(id, { name: b.name, description: b.description }),
  delete: (id) => store.remove(id),
  restore: (id) => store.restore(id),
  purge: (id) => store.purge(id),
  duplicate: (id) => store.duplicate(id),
  snapshot: (id, b) => store.snapshot(id, String(b.label || 'Saved version').slice(0, 80), { force: true }),
  'restore-snapshot': (id, b) => store.restoreSnapshot(id, String(b.snapshotId)),
  'revert-step': (id, b) => store.revertStep(id, Number(b.n)),
  activate: (id) => store.setActive(id),
};

// Canvas actions that change the design (the rest are selection, comments, screenshots).
const USER_EDITS = new Set(['move', 'resize', 'rename', 'delete', 'duplicate', 'create', 'theme', 'move-node', 'flags', 'style', 'attrs', 'text', 'page-create', 'page-update', 'page-delete', 'move-to-page', 'reference', 'paste']); // undo and redo record themselves

// Canvas actions on one project's document.
const canvasActions = {
  move: (p, b) => p.doc.moveArtboard(b.id, b.x, b.y),
  resize: (p, b) => p.doc.resizeArtboard(b.id, b.width, b.height),
  rename: (p, b) => p.doc.renameNodes({ [b.id]: b.name }),
  delete: (p, b) => p.doc.deleteNodes(b.ids),
  duplicate: (p, b) => p.doc.duplicateNodes(b.ids),
  create: (p, b) => ({ id: p.doc.createArtboard(b).id }), // the id lets the frame tool select the new board
  // Ctrl+V of a node copied in the canvas: its HTML goes next to (or into) the target. The old ids are
  // stripped so the copy gets fresh ones, and writeHtml sanitizes it like any other write.
  paste: (p, b) => {
    const html = String(b.html || '').slice(0, 200_000).replace(/ data-pid="[^"]*"/g, '');
    const created = p.doc.writeHtml(String(b.target), html, b.position === 'after' ? 'after' : 'append');
    return { ids: created };
  },
  // The user pasted or dropped an image: { name, dataUrl } becomes a reference and a board showing it.
  reference: (p, b) => {
    const m = /^data:image\/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.dataUrl || ''));
    if (!m) throw new Error('Not an image');
    const { board } = store.addReference(p.meta.id, { name: String(b.name || 'Pasted image'), buffer: Buffer.from(m[1], 'base64'), page: b.page });
    return { id: board.id };
  },
  // Layers panel: reorder / reparent a node, and the hidden + locked toggles.
  'move-node': (p, b) => p.doc.moveNode(String(b.id), String(b.target), b.position),
  // Inspector and in-place editing: styles on nodes, text of a node, and browser undo / redo.
  style: (p, b) => p.doc.updateStyles(b.ids, b.styles),
  // Inspector fields for vectors: SVG attributes (fill, stroke...) go through the same allowlist as the set_attrs tool.
  attrs: (p, b) => p.doc.setAttrs(b.ids, b.attrs),
  text: (p, b) => p.doc.setText(String(b.id), String(b.text)),
  undo: (p) => { if (!p.doc.undo(1, 'user').length) throw new Error('Nothing to undo'); },
  redo: (p) => { if (!p.doc.redo(1, 'user').length) throw new Error('Nothing to redo'); },
  // Pages (the page selector in the header)
  'page-create': (p, b) => p.doc.createPage(String(b.name || 'Page')),
  'page-update': (p, b) => p.doc.updatePage(String(b.id), { name: b.name, background: b.background }),
  'page-delete': (p, b) => p.doc.deletePage(String(b.id), b.moveTo),
  'move-to-page': (p, b) => p.doc.moveToPage(b.ids, String(b.page)),
  flags: (p, b) => p.doc.setFlags(b.ids ?? [b.id], { hidden: b.hidden, locked: b.locked }),
  theme: (p, b) => p.doc.setTokens(b.tokens, { mode: b.mode, preset: b.preset }), // the Theme tab edits one value at a time
  selection: (p, b) => ui.selection.set(p.meta.id, (b.ids || []).slice(0, 50)),
  // Comments (author is always 'user' here: Claude uses the MCP tools)
  'comment-add': (p, b) => {
    const ab = p.doc.artboardOf(String(b.targetId));
    if (!ab) throw new Error('Element not found');
    store.addComment(p.meta.id, { targetId: b.targetId, artboardId: ab.id, text: b.text });
  },
  'comment-reply': (p, b) => store.replyComment(p.meta.id, String(b.commentId), { text: b.text }),
  'comment-resolve': (p, b) => store.setCommentResolved(p.meta.id, String(b.commentId), b.resolved !== false),
  'comment-delete': (p, b) => store.deleteComment(p.meta.id, String(b.commentId)),
  // The browser's answer to askBrowser: dataUrl for screenshots, result for everything else.
  reply: (p, b) => canvasActions.screenshot(p, b),
  screenshot: (p, b) => {
    const s = ui.pendingShots.get(b.id);
    if (!s) return;
    clearTimeout(s.timer);
    ui.pendingShots.delete(b.id);
    b.error ? s.reject(new Error(b.error)) : s.resolve(b.dataUrl ?? b.result);
  },
};

function serveFile(res, file, root = WEB) {
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('Not found');
    return;
  }
  // no-cache: the browser must revalidate, so edits to the UI show up on reload (no stale scripts)
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);

  // Block DNS-rebinding: a malicious site could point its domain at 127.0.0.1
  // and drive our API from the user's browser. Only accept our own host names.
  const hostOk = [`localhost:${PORT}`, `127.0.0.1:${PORT}`].includes(req.headers.host);
  if (!hostOk) { res.writeHead(403).end('Forbidden host'); return; }

  // Browsers always send Origin on cross-site requests and on fetch POSTs. A foreign one means
  // another website is driving our API from the user's browser, so refuse it. (No Origin =
  // curl or the MCP client, which is fine: those are not a browser acting for a web page.)
  const origin = req.headers.origin;
  if (origin && ![`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`].includes(origin)) {
    res.writeHead(403).end('Forbidden origin');
    return;
  }

  try {
    // --- MCP endpoint (stateful: one server + transport per client session, see src/sessions.mjs) ---
    if (url.pathname === '/mcp') {
      await handleMcp(req, res, url);
      return;
    }

    // --- Live updates: /events (home) or /events?project=<id> (canvas) ---
    if (url.pathname === '/events') {
      const projectId = url.searchParams.get('project');
      if (projectId && !(ID_RE.test(projectId) && store.get(projectId))) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const client = { res, projectId: projectId || null, headless: url.searchParams.has('headless') };
      if (projectId) {
        const p = store.get(projectId);
        send(res, 'meta', p.meta);
        sendDoc(client, p.doc.data);
        send(res, 'comments', store.listComments(projectId));
      } else {
        send(res, 'projects', {});
      }
      ui.clients.add(client);
      req.on('close', () => ui.clients.delete(client));
      return;
    }

    // --- JSON API ---
    if (parts[0] === 'api') {
      // Mutations must be JSON POSTs: a cross-site <form> can't send that without a CORS preflight.
      if (req.method === 'POST' && !String(req.headers['content-type']).includes('application/json')) {
        res.writeHead(415).end(); return;
      }

      // Projects: list / create / import
      if (parts[1] === 'projects' && parts.length === 2) {
        if (req.method === 'GET') return json(res, 200, store.list({ trashed: url.searchParams.get('deleted') === '1' }));
        if (req.method === 'POST') {
          const b = await readJson(req);
          return json(res, 200, store.create({ name: b.name || 'Untitled project', description: b.description, unique: 'suffix' }));
        }
      }
      if (parts[1] === 'projects' && parts[2] === 'import' && req.method === 'POST') {
        return json(res, 200, store.import(await readJson(req)));
      }

      // User switch: pause / resume one agent (its writes get a polite error). Agent ids are slugs, so the pattern is strict.
      if (parts[1] === 'agents' && parts[2] === 'pause' && req.method === 'POST') {
        const b = await readJson(req);
        if (!/^[a-z0-9-]{1,40}$/.test(String(b.agent))) return json(res, 400, { error: 'Bad agent id' });
        claims.setPaused(b.agent, b.paused === true);
        return json(res, 200, { ok: true, paused: claims.pausedList() });
      }

      // Server health for the MCP panel: open tabs and where Claude's tokens go.
      if (parts[1] === 'status' && req.method === 'GET') {
        return json(res, 200, { ok: true, tabs: [...ui.clients].filter((c) => c.projectId && !c.headless).length, headless: { available: headless.available, running: headless.procs.size }, meter: meter.snapshot() });
      }

      // Downloaded font files: /api/fonts/<slug>/<style>-<weight>.woff2. FontCache.file only accepts strict
      // name patterns, so this cannot reach outside data/fonts. A file never changes once written: cache hard.
      if (parts[1] === 'fonts' && parts.length === 4 && req.method === 'GET') {
        const f = fonts.file(parts[2], parts[3]);
        if (!f) return json(res, 404, { error: 'Font not found' });
        res.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
        fs.createReadStream(f).pipe(res);
        return;
      }

      // Every comment in every non-trashed project, newest activity first (powers /comments).
      if (parts[1] === 'comments' && req.method === 'GET') {
        const out = [];
        for (const m of store.list()) {
          const { doc } = store.get(m.id);
          for (const c of store.listComments(m.id)) {
            let element = null;
            try { const n = doc.nodeInfo(c.targetId); element = { tag: n.tag, text: String(n.text || '').slice(0, 80), artboard: n.artboard }; } catch { /* target deleted or is an artboard */ }
            const abId = element?.artboard || c.artboardId || (c.targetId.startsWith('A') ? c.targetId : '');
            const ab = abId && doc.getArtboard(abId);
            out.push({ ...c, projectId: m.id, projectName: m.name, artboardName: ab ? ab.name : null, element, orphaned: !element && !(ab && c.targetId === abId) });
          }
        }
        out.sort((a, b) => Math.max(b.createdAt, ...b.replies.map((r) => r.createdAt)) - Math.max(a.createdAt, ...a.replies.map((r) => r.createdAt)));
        return json(res, 200, out);
      }

      // Single project: /api/projects/:id/<action>
      if (parts[1] === 'projects' && ID_RE.test(parts[2] || '')) {
        const id = parts[2];
        if (!store.get(id)) return json(res, 404, { error: 'Project not found' });
        if (req.method === 'GET' && parts[3] === 'snapshots') return json(res, 200, store.listSnapshots(id));
        if (req.method === 'GET' && parts[3] === 'export') {
          const name = store.get(id).meta.name.replace(/[^\w.-]+/g, '_');
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${name}.dcproject.json"` });
          res.end(JSON.stringify(store.export(id), null, 2));
          return;
        }
        if (req.method === 'POST' && projectActions[parts[3]]) {
          projectActions[parts[3]](id, await readJson(req));
          return json(res, 200, { ok: true });
        }
      }

      // Read-only canvas data: /api/p/:id/tokens
      if (parts[1] === 'p' && ID_RE.test(parts[2] || '') && req.method === 'GET') {
        const p = store.get(parts[2]);
        if (!p) return json(res, 404, { error: 'Project not found' });
        if (parts[3] === 'ref' && parts[4]) {
          const f = store.refFile(p.meta.id, parts[4]);
          if (!f) return json(res, 404, { error: 'Reference not found' });
          res.writeHead(200, { 'Content-Type': f.mime, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
          fs.createReadStream(f.file).pipe(res);
          return;
        }
        if (parts[3] === 'tokens') return json(res, 200, extractTokens(p.doc.data.artboards));
        // Activity runs; `since` (a sequence number from the previous answer's `seq`) returns only runs that changed after it.
        if (parts[3] === 'activity') return json(res, 200, store.listActivity(p.meta.id, { since: Number(new URL(req.url, 'http://x').searchParams.get('since')) || 0 }));
        // Per-call log of MCP tool calls; `since` (ms timestamp) makes polling incremental.
        // Live board claims + paused agents (the same payload the SSE `claims` event carries), to seed the UI on load.
        if (parts[3] === 'claims') return json(res, 200, claimsPayload(p.meta.id));
        if (parts[3] === 'calls') return json(res, 200, calls.list(p.meta.id, Number(new URL(req.url, 'http://x').searchParams.get('since')) || 0));
        // Cost + efficiency dashboard: per agent and per prompt, derived from the call log (src/efficiency.mjs).
        if (parts[3] === 'efficiency') {
          let fixed = null;
          try { fixed = await measureFixed(); } catch { /* fixed costs are a nicety: the rest still answers */ }
          return json(res, 200, analyze(calls.list(p.meta.id), { fixed, limit: RING }));
        }
        // Eval numbers for examples/evals. Read-only: boards are measured but never grown, so the run
        // is judged on what the agent left behind, not on what this call would repair.
        if (parts[3] === 'eval') {
          const boards = p.doc.data.artboards.filter((a) => !a.generated);
          // tabOpen reports whether a real (non-headless) tab was there; the measure itself may use the headless worker.
          const tabOpen = [...ui.clients].some((c) => c.projectId === p.meta.id && !c.headless);
          let reports = null;
          if (boards.length) {
            try { reports = await requestMeasure(p.meta.id, boards.map((a) => ({ id: a.id, html: a.html, width: a.width, height: a.height, fit: a.heightMode === 'fit' }))); } catch { /* tab did not answer */ }
          }
          const issues = Object.fromEntries(boards.map((a) => [a.id, p.doc.lint(a.id)]));
          return json(res, 200, { tabOpen, boards: boards.length, brief: Boolean(p.meta.brief), ...evalSummary(calls.list(p.meta.id)), ...lintMetrics(issues), ...(reports ? layoutMetrics(reports) : { layout: 'not measured' }) });
        }
        return json(res, 404, { error: 'Not found' });
      }

      // Canvas actions: /api/p/:id/<action>
      if (parts[1] === 'p' && ID_RE.test(parts[2] || '') && req.method === 'POST' && canvasActions[parts[3]]) {
        const p = store.get(parts[2]);
        if (!p) return json(res, 404, { error: 'Project not found' });
        const body = await readJson(req);
        const result = canvasActions[parts[3]](p, body);
        // What the user did by hand, so Claude's get_changes can report it.
        if (USER_EDITS.has(parts[3])) p.doc.record('user', parts[3], body.ids ?? [body.id].filter(Boolean));
        // Only these need their result back: the browser switches to a new page, selects a new board (frame tool)
        // and opens a pasted / inserted node for typing (text tool).
        return json(res, 200, { ok: true, result: ['page-create', 'reference', 'create', 'paste'].includes(parts[3]) ? result : undefined });
      }
      return json(res, 404, { error: 'Not found' });
    }

    // --- React client. Unknown or trashed project: back to the home page instead of a broken canvas. ---
    if (parts[0] === 'p' && parts.length === 2) {
      const p = ID_RE.test(parts[1]) ? store.get(parts[1]) : null;
      if (!p || p.meta.deletedAt) { res.writeHead(302, { Location: '/' }).end(); return; }
    }
    if (!fs.existsSync(path.join(WEB, 'index.html'))) {
      res.writeHead(503, { 'Content-Type': 'text/plain' }).end('The web client is not built. Run: pnpm build:web');
      return;
    }
    // Real files (hashed assets) are served as is. A path without an extension is a client-side route
    // (/, /p/<id>, /comments), so it gets index.html (SPA fallback); a missing file with an extension is a real 404.
    // serveFile's startsWith check blocks path traversal.
    const file = path.join(WEB, url.pathname.slice(1));
    const isFile = file.startsWith(WEB) && fs.existsSync(file) && fs.statSync(file).isFile();
    if (isFile) return serveFile(res, file);
    if (path.extname(url.pathname)) { res.writeHead(404).end('Not found'); return; }
    serveFile(res, path.join(WEB, 'index.html'));
  } catch (err) {
    // Validation errors from the store are user-facing; everything else is still just a message.
    if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err.message || err) }));
  }
});

// Don't lose the last few edits: debounced writes are flushed when the process is stopped.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { headless.stopAll(); store.flushAll(); calls.flushAll(); process.exit(0); });
}

server.listen(PORT, HOST, () => {
  console.log(`Design Canvas running:\n  Projects  http://localhost:${PORT}\n  MCP       http://localhost:${PORT}/mcp`);
});
