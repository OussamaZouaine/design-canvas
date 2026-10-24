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

async function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-mcp-'));
  const store = new ProjectStore(dir);
  const ui = { selection: new Map(), currentPage: new Map(), lastRead: new Map(), touched: new Map() };
  const server = createMcpServer({ store, ui, port: 0 });
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

test('instructions: first turn pairs get_guide with list_projects and names the core tools for one ToolSearch', async () => {
  const h = await harness();
  const i = h.client.getInstructions();
  assert.match(i, /get_guide\(\) and list_projects\(\) together/);
  assert.match(i, /ONE ToolSearch/);
  for (const t of ['get_guide', 'list_projects', 'log_prompt', 'create_artboard', 'write_html', 'update_styles', 'get_tree', 'lint', 'get_screenshot', 'finish_working']) {
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
  await h.call('create_page', { project_id: pid, name: 'Mobile' });
  assert.equal((await h.call('get_basic_info', { project_id: pid })).pages.length, 2);
  h.close();
});
