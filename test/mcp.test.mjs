// Drives the real MCP server through an in-memory Client, so tests see exactly what an agent sees
// (tools/list, instructions, tool results) without HTTP or a browser tab.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp.mjs';
import { ProjectStore } from '../src/store.mjs';

async function harness(deps = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-mcp-'));
  const store = new ProjectStore(dir);
  const ui = { selection: new Map(), currentPage: new Map(), lastRead: new Map(), touched: new Map() };
  const server = createMcpServer({ store, ui, port: 0, ...deps });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  // Calls a tool and parses its JSON text (or returns the raw string).
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const t = r.content[0].text;
    try { return JSON.parse(t); } catch { return t; }
  };
  // Saves are debounced: write what is pending and cancel the timers before deleting the folder,
  // or they fire into a missing directory (and keep the process alive for ~40 s).
  const close = () => {
    store.flushAll();
    for (const t of [...store.snapTimers.values(), ...store.listTimers.values(), ...[...store.metas.values()].map((m) => m._t)]) clearTimeout(t);
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { store, client, call, close };
}

// Stubs for the browser round-trips: a 1x1 JPEG-ish data URL and a measure that reports "fits" or an overflow.
const fakeShot = async () => 'data:image/jpeg;base64,/9j/4AAQ';
// extraWidth > 0 makes the content wider than the board (a problem a fit board cannot fix by growing).
const measure = (extraWidth = 0) => async (_id, boards) => boards.map((b) => ({
  id: b.id, width: b.width, height: b.height, fit: b.fit, contentWidth: b.width + extraWidth, contentHeight: b.height, outside: [], clipped: [],
}));

test('get_screenshot review:true returns lint, a layout line only on problems, then the image', async () => {
  const shots = [];
  const h = await harness({ requestScreenshot: async (...a) => { shots.push(a); return fakeShot(); }, requestMeasure: measure() });
  const { pid, board } = await withBoard(h);
  const run = async () => (await h.client.callTool({ name: 'get_screenshot', arguments: { project_id: pid, artboard_id: board, review: true } })).content;
  let c = await run();
  assert.equal(c[0].type, 'text');
  assert.match(c[0].text, /^lint: /);
  assert.doesNotMatch(c[0].text, /layout:/);
  assert.equal(c.at(-1).type, 'image');
  // Without the flag the result is just the image, as before.
  c = (await h.client.callTool({ name: 'get_screenshot', arguments: { project_id: pid, artboard_id: board } })).content;
  assert.deepEqual(c.map((p) => p.type), ['image']);
  h.close();
  // A layout problem adds the layout line; no tab (measure rejects) stays silent.
  const bad = await harness({ requestScreenshot: fakeShot, requestMeasure: measure(500) });
  const b = await withBoard(bad);
  c = (await bad.client.callTool({ name: 'get_screenshot', arguments: { project_id: b.pid, artboard_id: b.board, review: true } })).content;
  assert.match(c[0].text, /\nlayout: .*wide/);
  bad.close();
  const none = await harness({ requestScreenshot: fakeShot, requestMeasure: async () => { throw new Error('no tab'); } });
  const n = await withBoard(none);
  c = (await none.client.callTool({ name: 'get_screenshot', arguments: { project_id: n.pid, artboard_id: n.board, review: true } })).content;
  assert.doesNotMatch(c[0].text, /layout:/);
  none.close();
});

test('finish_working screenshot_artboard_id adds the image only when the layout is fine', async () => {
  const ok = await harness({ requestScreenshot: fakeShot, requestMeasure: measure() });
  const a = await withBoard(ok);
  let r = await ok.client.callTool({ name: 'finish_working', arguments: { project_id: a.pid, screenshot_artboard_id: a.board } });
  assert.deepEqual(r.content.map((p) => p.type), ['text', 'image']);
  assert.equal(r.content[0].text, 'ok');
  // Without the argument nothing changes.
  r = await ok.client.callTool({ name: 'finish_working', arguments: { project_id: a.pid } });
  assert.deepEqual(r.content.map((p) => p.type), ['text']);
  ok.close();
  const bad = await harness({ requestScreenshot: fakeShot, requestMeasure: measure(500) });
  const b = await withBoard(bad);
  r = await bad.client.callTool({ name: 'finish_working', arguments: { project_id: b.pid, screenshot_artboard_id: b.board } });
  assert.deepEqual(r.content.map((p) => p.type), ['text']);
  assert.match(r.content[0].text, /Not finished/);
  bad.close();
});

test('instructions: first turn pairs get_guide with start and names the core tools for one ToolSearch', async () => {
  const h = await harness();
  const i = h.client.getInstructions();
  assert.match(i, /get_guide\(\) and start\(\) together/);
  assert.match(i, /ONE ToolSearch/);
  for (const t of ['get_guide', 'start', 'list_projects', 'log_prompt', 'create_artboard', 'write_html', 'update_styles', 'get_tree', 'lint', 'get_screenshot', 'finish_working']) {
    assert.ok(i.includes(t), t);
  }
  h.close();
});

// A project with one board holding one node, for the reader-trimming tests.
async function withBoard(h, html = '<div style="padding:8px">Hello</div>') {
  const p = await h.call('create_project', { name: 'Trim' });
  const ab = await h.call('create_artboard', { project_id: p.project_id, name: 'Home' });
  const { created } = await h.call('write_html', { project_id: p.project_id, target_id: ab.id, html });
  return { pid: p.project_id, board: ab.id, node: created[0] };
}

test('get_node_info omits html unless include_html, and caps it', async () => {
  const h = await harness();
  const { pid, node } = await withBoard(h);
  const lean = await h.call('get_node_info', { project_id: pid, node_id: node });
  assert.equal(lean.html, undefined);
  assert.equal(lean.tag, 'div');
  const full = await h.call('get_node_info', { project_id: pid, node_id: node, include_html: true });
  assert.match(full.html, /Hello/);

  const big = await withBoard(h, `<div>${'<p>x</p>'.repeat(1000)}</div>`);
  const capped = await h.call('get_node_info', { project_id: big.pid, node_id: big.node, include_html: true });
  assert.match(capped.html, /\[truncated, \d+ chars total/);
  assert.ok(capped.html.length < 2300);
  h.close();
});

test('get_selection and get_comments still work without node html', async () => {
  const h = await harness();
  const { pid, node } = await withBoard(h);
  h.store.addComment(pid, { targetId: node, text: 'bigger', author: 'user' });
  const list = await h.call('get_comments', { project_id: pid });
  assert.equal(list[0].element.tag, 'div');
  assert.deepEqual(await h.call('get_selection', { project_id: pid }), []);
  h.close();
});

test('get_tree lists only artboards when a project has more than 8', async () => {
  const h = await harness();
  const { pid, board } = await withBoard(h);
  for (let i = 0; i < 8; i++) await h.call('create_artboard', { project_id: pid, name: `B${i}` });
  const t = await h.call('get_tree', { project_id: pid });
  assert.match(t, /9 artboards: pass node_id/);
  assert.equal(t.split('\n').length, 10); // 9 boards + the hint
  assert.doesNotMatch(t, /Hello/);
  // An explicit node_id still outlines normally.
  assert.match(await h.call('get_tree', { project_id: pid, node_id: board }), /Hello/);
  h.close();
});

test('list_projects drops url and description and limits to 15 with a more count', async () => {
  const h = await harness();
  for (let i = 0; i < 17; i++) await h.call('create_project', { name: `Proj ${i}`, description: 'long text' });
  const r = await h.call('list_projects');
  assert.equal(r.projects.length, 15);
  assert.equal(r.more, 2);
  assert.equal(r.projects[0].url, undefined);
  assert.equal(r.projects[0].description, undefined);
  assert.ok(r.projects[0].project_id && r.projects[0].name);
  h.close();
});

test('get_basic_info omits empty pages and references', async () => {
  const h = await harness();
  const { pid } = await withBoard(h);
  const info = await h.call('get_basic_info', { project_id: pid });
  assert.equal(info.pages, undefined);
  assert.equal(info.references, undefined);
  assert.equal(info.artboards.length, 1);
  await h.call('pages', { project_id: pid, action: 'create', name: 'Mobile' });
  assert.equal((await h.call('get_basic_info', { project_id: pid })).pages.length, 2);
  h.close();
});

test('tools/list carries no $schema keys and project_id only on the tools that pick a project', async () => {
  const h = await harness();
  const { tools } = await h.client.listTools();
  assert.ok(tools.length > 30);
  assert.doesNotMatch(JSON.stringify(tools), /\$schema/);
  // Sessions are bound to a project, so project_id left the schemas (saves tools/list tokens) except where a project is picked.
  const withPid = tools.filter((t) => t.inputSchema.properties?.project_id).map((t) => t.name);
  assert.deepEqual(withPid, ['project']);
  // The schemas still validate: an optional-only tool is callable with no arguments.
  assert.ok(await h.call('list_projects'));
  h.close();
});

test('reply_comment with resolve: true replies and resolves in one call', async () => {
  const h = await harness();
  const { pid, node, board } = await withBoard(h);
  const c1 = h.store.addComment(pid, { targetId: node, artboardId: board, text: 'bigger' });
  const c2 = h.store.addComment(pid, { targetId: node, artboardId: board, text: 'bluer' });
  assert.equal(await h.call('reply_comment', { project_id: pid, comment_id: c1.id, text: 'Done', resolve: true }), 'Replied and resolved');
  assert.equal(await h.call('reply_comment', { project_id: pid, comment_id: c2.id, text: 'Looking' }), 'Replied');
  const all = await h.call('get_comments', { project_id: pid, include_resolved: true });
  const by = Object.fromEntries(all.map((c) => [c.comment_id, c]));
  assert.equal(by[c1.id].resolved, true);
  assert.equal(by[c1.id].replies[0].text, 'Done');
  assert.equal(by[c2.id].resolved, false);
  h.close();
});

test('create_artboard with html writes the first content in the same call', async () => {
  const h = await harness();
  const p = await h.call('create_project', { name: 'First write' });
  const r = await h.call('create_artboard', { project_id: p.project_id, name: 'Home', html: '<div style="padding:8px">Hi</div>' });
  assert.ok(r.id);
  assert.equal(r.created.length, 1);
  // the written markup is not echoed back (it once returned the whole normalized board)
  assert.equal(r.html, undefined);
  // the content is really in the board, and omitting html keeps the old shape
  assert.match(await h.call('get_tree', { project_id: p.project_id, node_id: r.id }), /Hi|N\d+/);
  const empty = await h.call('create_artboard', { project_id: p.project_id, name: 'Empty' });
  assert.equal(empty.created, undefined);
  h.close();
});

test('write_html and update_styles report only NEW lint issues, silent otherwise', async () => {
  const h = await harness();
  const { pid, board, node } = await withBoard(h);
  // clean write: no lint key
  const ok = await h.call('write_html', { project_id: pid, target_id: board, html: '<div style="padding:8px">Fine</div>' });
  assert.equal(ok.lint, undefined);
  // an off-grid padding is new, so it is reported
  const bad = await h.call('write_html', { project_id: pid, target_id: board, html: '<div style="padding:5px">Off</div>' });
  assert.match(bad.lint, /not on the 4px spacing grid/);
  // the old issue is not repeated by a later clean write to the same board
  const again = await h.call('write_html', { project_id: pid, target_id: board, html: '<div style="padding:8px">Fine</div>' });
  assert.equal(again.lint, undefined);
  // update_styles: new issue shows, a clean change stays the bare 'ok'
  const u = await h.call('update_styles', { project_id: pid, node_ids: [node], styles: { padding: '7px' } });
  assert.match(u.lint, /spacing grid/);
  assert.equal(await h.call('update_styles', { project_id: pid, node_ids: [node], styles: { padding: '8px' } }), 'ok');
  // more than 5 new issues are capped with "+N more"
  const many = Array.from({ length: 8 }, (_, i) => `<div style="padding:${5 + i * 8}px">x</div>`).join('');
  const m = await h.call('write_html', { project_id: pid, target_id: board, html: many });
  assert.match(m.lint, /\+\d+ more$/);
  assert.equal(m.lint.split('\n').length, 6);
  h.close();
});

// batch: several edits in one call, same handlers as the single tools.
test('batch runs ops in order, one result line each, and checks layout once', async () => {
  let measures = 0;
  const h = await harness({ requestMeasure: async (...a) => { measures++; return measure(500)(...a); } });
  const { pid, board, node } = await withBoard(h);
  measures = 0; // withBoard's own writes measure too
  const r = await h.call('batch', { project_id: pid, ops: [
    { tool: 'update_styles', args: { node_ids: [node], styles: { color: 'red' } } },
    { tool: 'set_text_content', args: { node_id: node, text: 'First' } },
    { tool: 'write_html', args: { target_id: board, html: '<p style="padding:0">Second</p>' } },
    { tool: 'set_text_content', args: { node_id: node, text: 'Last' } },
  ] });
  const lines = r.split('\n');
  assert.equal(lines[0], '1 update_styles ok');
  assert.equal(lines[1], '2 set_text_content ok');
  assert.match(lines[2], /^3 write_html \{"created":\["N\d+"\]\}$/);
  assert.equal(lines[3], '4 set_text_content ok');
  assert.match(lines[4], /^layout: .*wide/); // measure(500) overflows: reported once, as the last line
  assert.equal(measures, 1);
  // Order: the last text write wins.
  assert.equal((await h.call('get_node_info', { project_id: pid, node_id: node })).text, 'Last');
  h.close();
});

test('batch stops at the first error and says what was applied', async () => {
  const h = await harness();
  const { pid, node } = await withBoard(h);
  const res = await h.client.callTool({ name: 'batch', arguments: { project_id: pid, ops: [
    { tool: 'set_text_content', args: { node_id: node, text: 'Done' } },
    { tool: 'set_text_content', args: { node_id: 'N9999', text: 'x' } },
    { tool: 'set_text_content', args: { node_id: node, text: 'Never' } },
  ] } });
  assert.equal(res.isError, true);
  const lines = res.content[0].text.split('\n');
  assert.equal(lines[0], '1 set_text_content ok');
  assert.match(lines[1], /^2 set_text_content error: /);
  assert.match(lines[2], /Stopped at op 2; ops 1-1 stay applied.*undo/);
  assert.equal(lines.length, 3);
  assert.equal((await h.call('get_node_info', { project_id: pid, node_id: node })).text, 'Done');
  h.close();
});

test('batch rejects tools outside the whitelist and a per-op project_id', async () => {
  const h = await harness();
  const { pid, node } = await withBoard(h);
  const res = await h.client.callTool({ name: 'batch', arguments: { project_id: pid, ops: [{ tool: 'project', args: { project_id: pid } }] } });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /write_html/); // the validation error lists the allowed names
  const own = await h.client.callTool({ name: 'batch', arguments: { project_id: pid, ops: [{ tool: 'set_text_content', args: { project_id: pid, node_id: node, text: 'x' } }] } });
  assert.match(own.content[0].text, /project_id is not allowed/);
  assert.match(own.content[0].text, /nothing was applied/);
  h.close();
});

test('start: new project by name logs the prompt and creates the first board with html', async () => {
  const h = await harness();
  const r = await h.call('start', { prompt: 'Make a pricing page', project: 'Pricing', description: 'Plans', brief: 'calm', artboard: { name: 'Home', width: 800, html: '<div style="padding:8px">Hi</div>' } });
  assert.equal(r.created, true);
  assert.match(r.project_id, /^p_[a-f0-9]{8}$/);
  assert.match(r.artboard_id, /^A/);
  // A brand-new project has nothing to report, and the brief is stored so no reminder appears.
  assert.equal(r.comments, undefined);
  assert.equal(r.artboards, undefined);
  assert.equal(r.reminder, undefined);
  assert.equal(h.store.get(r.project_id).meta.name, 'Pricing');
  assert.equal(h.store.activeId, r.project_id);
  h.close();
});

test('start: artboard html is optional and the no-brief reminder is kept', async () => {
  const h = await harness();
  const r = await h.call('start', { prompt: 'x', project: 'Empty board', artboard: { name: 'A' } });
  assert.ok(r.artboard_id);
  assert.match(r.reminder, /No brief/);
  h.close();
});

test('start: existing project by name (any case) and by id returns comments and boards, not a new project', async () => {
  const h = await harness();
  const { pid, board, node } = await withBoard(h);
  h.store.addComment(pid, { targetId: node, artboardId: board, text: 'x'.repeat(200) });
  const byName = await h.call('start', { prompt: 'again', project: 'trim' });
  assert.equal(byName.created, false);
  assert.equal(byName.project_id, pid);
  assert.match(byName.comments, /^1 open\n\S+ \S+ x{120}…$/);
  assert.match(byName.artboards, new RegExp(`${board} Home \\d+x\\d+`));
  const byId = await h.call('start', { prompt: 'again', project: pid });
  assert.equal(byId.project_id, pid);
  assert.equal(h.store.list().length, 1);
  h.close();
});

test('start: no project uses the active one, and errors when there is none', async () => {
  const h = await harness();
  const err = await h.client.callTool({ name: 'start', arguments: { prompt: 'x' } });
  assert.equal(err.isError, true);
  assert.match(err.content[0].text, /Pass project/);
  const { pid } = await withBoard(h);
  const r = await h.call('start', { prompt: 'x' });
  assert.equal(r.project_id, pid);
  h.close();
});

test('pages: create, set, update, move_boards, delete through one tool, with per-action required fields', async () => {
  const h = await harness();
  const { pid, board } = await withBoard(h);
  const page = await h.call('pages', { project_id: pid, action: 'create', name: 'Mobile' });
  assert.ok(page.id ?? page.page_id, 'returns the new page');
  const pageId = page.id ?? page.page_id;
  assert.match(await h.call('pages', { project_id: pid, action: 'set', page_id: pageId }), /New artboards will go to/);
  assert.equal((await h.call('pages', { project_id: pid, action: 'update', page_id: pageId, name: 'Phones' })).name, 'Phones');
  assert.equal(await h.call('pages', { project_id: pid, action: 'move_boards', artboard_ids: [board], page_id: pageId }), 'ok');
  const del = await h.call('pages', { project_id: pid, action: 'delete', page_id: pageId });
  assert.equal(del.deleted, pageId);
  // Missing fields name the action; an unknown action is rejected by the enum.
  assert.match(await h.call('pages', { project_id: pid, action: 'update' }), /pages update needs page_id/);
  assert.match(await h.call('pages', { project_id: pid, action: 'create' }), /pages create needs name/);
  assert.match(await h.call('pages', { project_id: pid, action: 'rename' }), /invalid|enum/i);
  h.close();
});

test('components: set, sheet, detach and delete through one tool; insert_component stays its own tool', async () => {
  const h = await harness();
  const { pid, board } = await withBoard(h);
  const set = await h.call('components', { project_id: pid, action: 'set', name: 'button', variants: { default: '<button style="padding:8px"><span data-slot="label">Go</span></button>' } });
  assert.deepEqual(set.variants, ['default'], JSON.stringify(set));
  const ins = await h.call('insert_component', { project_id: pid, target_id: board, name: 'button', slots: { label: 'Save' } });
  assert.equal(ins.created.length, 1);
  assert.ok((await h.call('components', { project_id: pid, action: 'sheet' })).artboard_id);
  assert.equal(await h.call('components', { project_id: pid, action: 'detach', node_id: ins.created[0] }), 'ok');
  assert.equal(await h.call('components', { project_id: pid, action: 'delete', name: 'button' }), 'ok');
  assert.match(await h.call('components', { project_id: pid, action: 'set', name: 'x' }), /components set needs variants/);
  assert.match(await h.call('components', { project_id: pid, action: 'detach' }), /components detach needs node_id/);
  h.close();
});

test('export_code: react and html for a board, jsx for a node, with clear errors', async () => {
  const h = await harness();
  const { pid, board, node } = await withBoard(h);
  assert.match(await h.call('export_code', { project_id: pid, format: 'react', artboard_id: board }), /export default function|function /);
  assert.match(await h.call('export_code', { project_id: pid, format: 'html', artboard_id: board }), /^<!doctype html>/);
  assert.match(await h.call('export_code', { project_id: pid, format: 'jsx', node_id: node }), /Hello/);
  assert.match(await h.call('export_code', { project_id: pid, format: 'jsx', node_id: board }), /is an artboard: use format react/);
  assert.match(await h.call('export_code', { project_id: pid, format: 'react' }), /export_code react needs artboard_id/);
  assert.match(await h.call('export_code', { project_id: pid, format: 'jsx' }), /export_code jsx needs node_id/);
  h.close();
});

test('history: undo and redo through one tool, with steps', async () => {
  const h = await harness();
  const { pid, node } = await withBoard(h);
  await h.call('set_text_content', { project_id: pid, node_id: node, text: 'Changed' });
  assert.ok((await h.call('history', { project_id: pid, action: 'undo' })).reverted.length);
  assert.ok((await h.call('history', { project_id: pid, action: 'redo' })).redone.length);
  assert.equal(await h.call('history', { project_id: pid, action: 'redo' }), 'Nothing to redo');
  assert.equal(await h.call('history', { project_id: pid, action: 'undo', steps: 20 }) !== undefined, true);
  h.close();
});

test('references: add from a file path and delete through one tool', async () => {
  const h = await harness();
  const { pid } = await withBoard(h);
  const file = path.join(os.tmpdir(), `dc-ref-${Date.now()}.png`);
  // 1x1 transparent PNG: enough for the magic-number and size checks.
  fs.writeFileSync(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
  const added = await h.call('references', { project_id: pid, action: 'add', path: file });
  assert.ok(added.reference_id && added.artboard_id, JSON.stringify(added));
  assert.equal(await h.call('references', { project_id: pid, action: 'delete', reference_id: added.reference_id }), 'ok');
  assert.match(await h.call('references', { project_id: pid, action: 'add' }), /references add needs path/);
  assert.match(await h.call('references', { project_id: pid, action: 'delete' }), /references delete needs reference_id/);
  fs.rmSync(file, { force: true });
  h.close();
});

test('project: open, update, save_version and delete; open and delete need an explicit project_id', async () => {
  const h = await harness();
  const { pid } = await withBoard(h);
  const opened = await h.call('project', { project_id: pid, action: 'open' });
  assert.equal(opened.project_id, pid);
  const upd = await h.call('project', { action: 'update', name: 'Renamed' });
  assert.equal(upd.name, 'Renamed');
  assert.equal(await h.call('project', { action: 'save_version', label: 'v1' }), 'Version saved');
  // No explicit id: delete must not fall back to the active project.
  assert.match(await h.call('project', { action: 'delete' }), /project delete needs project_id/);
  assert.match(await h.call('project', { action: 'open' }), /project open needs project_id/);
  assert.equal(await h.call('project', { project_id: pid, action: 'delete' }), 'Moved to Trash');
  h.close();
});

test('tokens: extract, export, link_repo and import through one tool', async () => {
  const h = await harness();
  const { pid } = await withBoard(h, '<div style="padding:8px;background:oklch(0.6 0.2 250);color:oklch(0.98 0 0)">Hi</div>');
  assert.ok((await h.call('tokens', { project_id: pid, action: 'extract' })).css, 'summary has css');
  assert.match(JSON.stringify(await h.call('tokens', { project_id: pid, action: 'extract', format: 'tailwind' })), /@theme|theme/);
  await h.call('set_tokens', { project_id: pid, tokens: { 'color-primary': 'oklch(0.6 0.2 250)' } });
  assert.match(await h.call('tokens', { project_id: pid, action: 'export' }), /--color-primary/);
  // link_repo + import from a throwaway folder
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-repo-'));
  fs.writeFileSync(path.join(repo, 'styles.css'), ':root{--color-accent: oklch(0.7 0.1 30);}');
  assert.deepEqual(await h.call('tokens', { project_id: pid, action: 'link_repo', path: repo }), { repo });
  const dry = await h.call('tokens', { project_id: pid, action: 'import', file: 'styles.css', dry_run: true });
  assert.ok(dry.would_import['color-accent']);
  assert.deepEqual((await h.call('tokens', { project_id: pid, action: 'import', file: 'styles.css' })).imported, ['color-accent']);
  assert.equal(await h.call('tokens', { project_id: pid, action: 'link_repo', path: null }), 'Unlinked');
  assert.match(await h.call('tokens', { project_id: pid, action: 'import' }), /tokens import needs file/);
  assert.match(await h.call('tokens', { project_id: pid, action: 'link_repo' }), /tokens link_repo needs path/);
  fs.rmSync(repo, { recursive: true, force: true });
  h.close();
});
