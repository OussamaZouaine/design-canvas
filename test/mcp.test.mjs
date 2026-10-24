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
  return { store, client, call, close: () => fs.rmSync(dir, { recursive: true, force: true }) };
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
