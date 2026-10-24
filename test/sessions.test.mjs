import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp.mjs';
import { ProjectStore } from '../src/store.mjs';
import { CallLog } from '../src/agentlog.mjs';
import { Session, SessionMap, agentColor } from '../src/sessions.mjs';

test('SessionMap: unknown id is undefined, idle sessions expire, activity renews them', () => {
  let now = 1000;
  const closed = [];
  const m = new SessionMap({ ttl: 100, now: () => now });
  const mk = (id) => ({ close: () => closed.push(id) });
  m.add(new Session('a'), mk('a-t'), mk('a-s'));
  m.add(new Session('b'), mk('b-t'), mk('b-s'));
  assert.equal(m.get('nope'), undefined);
  now += 80;
  assert.ok(m.get('a')); // touching renews a
  now += 80; // b is now 160 idle, a only 80
  m.sweep();
  assert.equal(m.size, 1);
  assert.ok(m.get('a'));
  assert.deepEqual(closed.sort(), ['b-s', 'b-t']);
  now += 500;
  assert.equal(m.get('a'), undefined); // expired on access too
  assert.equal(m.size, 0);
});

test('identity: same client in two sessions gets two ids, a label is stable and wins', () => {
  const a = new Session('11112222-aaaa'), b = new Session('33334444-bbbb');
  a.setClient({ name: 'claude-code', version: '2.1' });
  b.setClient({ name: 'claude-code', version: '2.1' });
  assert.notEqual(a.agent.id, b.agent.id);
  assert.equal(a.agent.name, 'claude-code');
  assert.equal(a.agent.version, '2.1');
  const l1 = new Session('x', 'Reviewer!'), l2 = new Session('y');
  l2.setClient({ name: 'other', version: '1' });
  l2.setLabel('reviewer!');
  assert.equal(l1.agent.id, 'reviewer');
  assert.equal(l2.agent.id, 'reviewer');
  assert.equal(l1.agent.color, l2.agent.color);
  assert.match(agentColor('reviewer'), /^oklch\(/);
  assert.notEqual(agentColor('a'), agentColor('b'));
});

// Two real MCP clients (in-memory) on one store, each with its own session, like two Claude Code windows.
async function twoAgents() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-sess-'));
  const store = new ProjectStore(dir);
  const events = [];
  const calls = new CallLog({ dataDir: dir, emit: (t, p) => events.push([t, p]) });
  const ui = { selection: new Map(), currentPage: new Map(), lastRead: new Map(), touched: new Map() };
  const highlights = [];
  const highlight = (project, ids, agent) => highlights.push({ project, ids, agent });
  const connect = async (sid, label) => {
    const session = new Session(sid, label);
    const server = createMcpServer({ store, ui, port: 0, calls, highlight, session });
    const [s, c] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'claude-code', version: '9' });
    await Promise.all([server.connect(s), client.connect(c)]);
    const call = async (name, args = {}) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
    return { session, call };
  };
  const close = () => {
    store.flushAll(); calls.flushAll();
    for (const t of [...store.snapTimers.values(), ...store.listTimers.values(), ...[...store.metas.values()].map((m) => m._t)]) clearTimeout(t);
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { store, calls, highlights, connect, close };
}

test('binding: start binds the session, so another agent switching project does not move it', async () => {
  const h = await twoAgents();
  const a = await h.connect('aaaa1111', 'alpha'), b = await h.connect('bbbb2222');
  const pa = (await a.call('start', { prompt: 'one', project: 'Alpha' })).project_id;
  const pb = (await b.call('start', { prompt: 'two', project: 'Beta' })).project_id;
  assert.notEqual(pa, pb);
  // The shared active project is now Beta, but alpha's calls still land in Alpha without any project_id.
  const r = await a.call('create_artboard', { name: 'Home', width: 400, height: 300 });
  assert.ok(h.store.get(pa).doc.getArtboard(r.id));
  assert.equal(h.store.get(pb).doc.data.artboards.length, 0);
  assert.equal(a.session.projectId, pa);
  assert.equal(b.session.projectId, pb);
  h.close();
});

test('identity is threaded through the call log, the change journal and the highlight', async () => {
  const h = await twoAgents();
  const a = await h.connect('aaaa1111', 'alpha'), b = await h.connect('bbbb2222');
  const pid = (await a.call('start', { prompt: 'one', project: 'Shared' })).project_id;
  await b.call('project', { action: 'open', project_id: pid });
  const ra = await a.call('create_artboard', { name: 'A', width: 400, height: 300 });
  await b.call('create_artboard', { name: 'B', width: 400, height: 300 });
  const agents = new Set(h.calls.list(pid).map((c) => c.agent.id));
  assert.ok(agents.has('alpha'));
  assert.equal(agents.size, 2, 'two distinct agents in the call log');
  assert.ok(h.calls.list(pid).every((c) => c.agent.color.startsWith('oklch(')));
  const actors = new Set(h.store.get(pid).doc.journal.map((e) => e.actor));
  assert.ok(actors.has('alpha') && actors.size >= 2);
  assert.ok(h.highlights.some((x) => x.agent?.id === 'alpha' && x.ids.includes(ra.id)));
  h.close();
});

test('tool results carry no identity fields (zero extra tokens)', async () => {
  const h = await twoAgents();
  const a = await h.connect('aaaa1111', 'alpha');
  const out = await a.call('start', { prompt: 'one', project: 'Quiet' });
  assert.doesNotMatch(JSON.stringify(out), /alpha|agent|oklch/);
  h.close();
});

test('revive: an unknown id keeps one stable Session (same identity), expires with the TTL', () => {
  let now = 0;
  const m = new SessionMap({ ttl: 100, now: () => now });
  const a = m.revive('old-id-1234', 'Reviewer');
  assert.equal(m.revive('old-id-1234'), a); // same object, so a bound project survives between requests
  assert.equal(a.agent.id, 'reviewer');
  const anon = m.revive('abcd-5678');
  assert.equal(anon.agent.id, 'agent-abcd'); // no clientInfo after a restart: stable suffix from the id
  now += 500;
  m.sweep();
  assert.equal(m.revived.size, 0);
  assert.notEqual(m.revive('old-id-1234'), a); // expired -> fresh Session
});

// End to end over real HTTP: initialize, restart the server, reuse the old session id without re-initializing.
test('stale mcp-session-id after a server restart still answers tools/call', async () => {
  const { spawn } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-stale-'));
  const port = 3800 + Math.floor(Math.random() * 150);
  const boot = async () => {
    const p = spawn(process.execPath, ['src/server.mjs'], { env: { ...process.env, PORT: String(port), DC_DATA: dir, DC_HEADLESS: '0' }, stdio: 'ignore' });
    for (let i = 0; i < 50; i++) {
      try { await fetch(`http://127.0.0.1:${port}/api/projects`); return p; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    throw new Error('server did not start');
  };
  const post = (body, sid) => fetch(`http://127.0.0.1:${port}/mcp?agent=Tester`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(sid ? { 'mcp-session-id': sid } : {}) },
    body: JSON.stringify(body),
  });
  let srv = await boot();
  try {
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } } });
    const sid = init.headers.get('mcp-session-id');
    assert.ok(sid);
    srv.kill(); await new Promise((r) => srv.once('exit', r));
    srv = await boot();
    const r = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_projects', arguments: {} } }, sid);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /"result"/);
  } finally {
    srv.kill();
    await new Promise((r) => srv.once('exit', r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
