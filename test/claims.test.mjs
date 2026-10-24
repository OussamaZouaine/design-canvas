// Several agents on one project: soft board claims, "changes by others since my last read" and the user's pause switch.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp.mjs';
import { ProjectStore } from '../src/store.mjs';
import { Session } from '../src/sessions.mjs';
import { Claims, PAUSED_MESSAGE } from '../src/claims.mjs';

// Two real MCP clients on one store and ONE shared Claims (as the real server has). `now` is a fake clock for expiry.
async function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-claims-'));
  const store = new ProjectStore(dir);
  const ui = { selection: new Map(), currentPage: new Map(), lastRead: new Map(), touched: new Map() };
  const clock = { t: 1_000_000 };
  const claims = new Claims({ now: () => clock.t });
  const connect = async (sid, label) => {
    const session = new Session(sid, label);
    const server = createMcpServer({ store, ui, port: 0, session, claims });
    const [s, c] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'claude-code', version: '9' });
    await Promise.all([server.connect(s), client.connect(c)]);
    // Returns the parsed first part; `.raw` is every text part, so tests can see an appended note.
    return async (name, args = {}) => {
      const r = await client.callTool({ name, arguments: args });
      const texts = r.content.filter((p) => p.type === 'text').map((p) => p.text);
      let v; try { v = JSON.parse(texts[0]); } catch { v = texts[0]; }
      return Object.assign(typeof v === 'object' && v ? v : { value: v }, { raw: texts, isError: r.isError });
    };
  };
  const close = () => {
    store.flushAll();
    for (const t of [...store.snapTimers.values(), ...store.listTimers.values(), ...[...store.metas.values()].map((m) => m._t)]) clearTimeout(t);
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { store, claims, clock, connect, close };
}

// Agent a creates the project with two boards; agent b joins it. Returns both callers and the board ids.
async function twoAgents(h) {
  const a = await h.connect('aaaa1111', 'alpha');
  const pid = (await a('start', { prompt: 'two agents', project: 'Duo' })).project_id;
  const b1 = (await a('create_artboard', { name: 'One', width: 400, height: 300 })).id;
  const b = await h.connect('bbbb2222', 'beta');
  await b('start', { prompt: 'join', project: pid });
  // Each agent creates (so claims) its own board.
  const b2 = (await b('create_artboard', { name: 'Two', width: 400, height: 300 })).id;
  return { a, b, pid, b1, b2 };
}

test('agents on different boards do not interfere and get no note', async () => {
  const h = await harness();
  const { a, b, b1, b2 } = await twoAgents(h);
  const ra = await a('write_html', { target_id: b1, html: '<p>from alpha</p>' });
  const rb = await b('write_html', { target_id: b2, html: '<p>from beta</p>' });
  assert.equal(ra.raw.length, 1, 'no extra text part without a conflict');
  assert.equal(rb.raw.length, 1);
  assert.ok(!rb.raw.join('').includes('being edited'));
  const html = h.store.get(h.store.list()[0].id).doc.data.artboards.map((x) => x.html).join('');
  assert.match(html, /from alpha/);
  assert.match(html, /from beta/);
  h.close();
});

test('writing to a board another agent just edited appends a one-line note, not an error', async () => {
  const h = await harness();
  const { a, b, b1 } = await twoAgents(h);
  await a('write_html', { target_id: b1, html: '<p>alpha was here</p>' });
  const r = await b('write_html', { target_id: b1, html: '<p>beta too</p>' });
  assert.ok(!r.isError);
  assert.equal(r.raw.length, 2);
  assert.match(r.raw[1], /^note: board One \(A\d+\) is being edited by alpha/);
  // b now holds the claim, so b's next write is quiet while a's write gets the note back.
  assert.equal((await b('write_html', { target_id: b1, html: '<p>beta again</p>' })).raw.length, 1);
  assert.match((await a('write_html', { target_id: b1, html: '<p>alpha again</p>' })).raw[1], /edited by beta/);
  h.close();
});

test('a claim expires after the ttl', async () => {
  const h = await harness();
  const { a, b, pid, b1 } = await twoAgents(h);
  await a('write_html', { target_id: b1, html: '<p>x</p>' });
  assert.equal(h.claims.list(pid).find((c) => c.board === b1).agent.id, 'alpha');
  h.clock.t += 61_000;
  assert.equal(h.claims.list(pid).length, 0, 'expired claims are not listed');
  assert.equal((await b('write_html', { target_id: b1, html: '<p>y</p>' })).raw.length, 1, 'no note once the claim lapsed');
  h.close();
});

test('claims are per project', async () => {
  const c = new Claims({ now: () => 1 });
  c.touch('p_00000001', { id: 'A1', name: 'X' }, { id: 'a', name: 'a', color: 'c' });
  assert.equal(c.touch('p_00000002', { id: 'A1', name: 'X' }, { id: 'b', name: 'b', color: 'c' }), null);
});

test('onChange fires when a claim appears, changes hands and expires', async () => {
  const seen = [];
  let now = 0;
  const c = new Claims({ ttl: 20, now: () => now, onChange: (p) => seen.push(p) });
  const A = { id: 'a', name: 'a', color: 'c' }, B = { id: 'b', name: 'b', color: 'c' };
  c.touch('p', { id: 'A1', name: 'X' }, A); // new
  c.touch('p', { id: 'A1', name: 'X' }, A); // same holder refreshing: quiet
  c.touch('p', { id: 'A1', name: 'X' }, B); // hand-over
  assert.equal(seen.length, 2);
  now = 100;
  await new Promise((r) => setTimeout(r, 90)); // the expiry timer pushes the "claim gone" update
  assert.equal(seen.length, 3);
});

test('pause makes writes return a polite error, reads still work, resume restores', async () => {
  const h = await harness();
  const { a, b, b1 } = await twoAgents(h);
  h.claims.setPaused('beta', true);
  const w = await b('write_html', { target_id: b1, html: '<p>nope</p>' });
  assert.ok(w.isError);
  assert.equal(w.raw[0], PAUSED_MESSAGE);
  assert.ok(!(await b('get_tree', { artboard_id: b1 })).isError, 'reads are not paused');
  assert.ok(!(await a('write_html', { target_id: b1, html: '<p>fine</p>' })).isError, 'other agents are unaffected');
  h.claims.setPaused('beta', false);
  assert.ok(!(await b('write_html', { target_id: b1, html: '<p>back</p>' })).isError);
  h.close();
});

test('get_changes and start report other agents since this agent last read, only when there are some', async () => {
  const h = await harness();
  const { a, b, pid, b1, b2 } = await twoAgents(h);
  assert.equal((await b('get_changes')).others, undefined, 'nothing yet: no field at all');
  await a('write_html', { target_id: b1, html: '<p>1</p>' });
  await a('write_html', { target_id: b1, html: '<p>2</p>' });
  await a('write_html', { target_id: b2, html: '<p>3</p>' });
  const first = await b('get_changes');
  assert.equal(first.others.length, 1);
  assert.equal(first.others[0].agent, 'alpha');
  assert.match(first.others[0].did, /write_html x3/);
  assert.deepEqual(first.others[0].boards.sort(), [b1, b2].sort());
  assert.equal((await b('get_changes')).others, undefined, 'the marker advanced');
  const mine = await a('get_changes');
  assert.deepEqual(mine.others.map((o) => o.agent), ['beta'], 'only the other agent shows up, never alpha itself');
  // start reports them too, and also advances the marker.
  await b('write_html', { target_id: b2, html: '<p>b</p>' });
  const s = await a('start', { prompt: 'again', project: pid });
  assert.equal(s.others[0].agent, 'beta');
  assert.equal((await a('get_changes')).others, undefined);
  h.close();
});
