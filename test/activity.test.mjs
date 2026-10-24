// Activity runs grouped by agent, per-step diffs, "revert this step", and the incremental `since` cursor.
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
import { SNIPPET_CAP, DISPLAY_CAP } from '../src/stepdiff.mjs';

// Same shape as the sessions tests: real MCP clients on one store, one session (= agent) each.
async function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-act-'));
  const store = new ProjectStore(dir);
  const ui = { selection: new Map(), currentPage: new Map(), lastRead: new Map(), touched: new Map() };
  const connect = async (sid, label) => {
    const session = new Session(sid, label);
    const server = createMcpServer({ store, ui, port: 0, session });
    const [s, c] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'claude-code', version: '9' });
    await Promise.all([server.connect(s), client.connect(c)]);
    return async (name, args = {}) => {
      const t = (await client.callTool({ name, arguments: args })).content[0].text;
      try { return JSON.parse(t); } catch { return t; }
    };
  };
  const close = () => {
    store.flushAll();
    for (const t of [...store.snapTimers.values(), ...store.listTimers.values(), ...[...store.metas.values()].map((m) => m._t)]) clearTimeout(t);
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { store, connect, close };
}

// A project with one board holding three cards; returns the ids so tests can edit them one by one.
async function threeCards(call) {
  const pid = (await call('start', { prompt: 'make cards', project: 'Cards' })).project_id;
  const board = (await call('create_artboard', { name: 'Home', width: 600, height: 400 })).id;
  const cards = ['alpha', 'beta', 'gamma'].map((n) => `<div style="color: red; padding: 8px"><p>${n} card with enough padding text to keep spans apart</p></div>`).join('');
  const ids = (await call('write_html', { target_id: board, html: cards })).created;
  return { pid, board, ids };
}
const colorOf = (store, pid, id) => new RegExp(`style="[^"]*color: (\\w+)[^"]*" data-pid="${id}"`).exec(store.get(pid).doc.data.artboards[0].html)?.[1];
const stepsOf = (store, pid) => store.listActivity(pid).runs.flatMap((r) => r.steps);

test('revert one step of a multi-step run keeps the steps around it', async () => {
  const h = await harness();
  const call = await h.connect('aaaa1111', 'alpha');
  const { pid, ids } = await threeCards(call);
  await call('update_styles', { node_ids: [ids[0]], styles: { color: 'blue' } });
  await call('update_styles', { node_ids: [ids[1]], styles: { color: 'green' } });
  await call('update_styles', { node_ids: [ids[2]], styles: { color: 'purple' } });
  const mid = stepsOf(h.store, pid).filter((s) => s.tool === 'update_styles')[1];
  assert.ok(mid.canRevert);
  assert.match(mid.diff.boards[0].after, /green/);
  h.store.revertStep(pid, mid.n); // not the newest step: goes through the reverse patch
  assert.equal(colorOf(h.store, pid, ids[0]), 'blue');
  assert.equal(colorOf(h.store, pid, ids[1]), 'red');
  assert.equal(colorOf(h.store, pid, ids[2]), 'purple');
  assert.throws(() => h.store.revertStep(pid, mid.n), /Already reverted/);
  // The revert is itself one undo step.
  h.store.get(pid).doc.undo();
  assert.equal(colorOf(h.store, pid, ids[1]), 'green');
  h.close();
});

test('reverting the newest step is a plain undo; a conflicting older step is refused and changes nothing', async () => {
  const h = await harness();
  const call = await h.connect('aaaa1111', 'alpha');
  const { pid, ids } = await threeCards(call);
  await call('update_styles', { node_ids: [ids[0]], styles: { color: 'blue' } });
  await call('update_styles', { node_ids: [ids[0]], styles: { color: 'orange' } }); // same span as the step before
  const [first, second] = stepsOf(h.store, pid).filter((s) => s.tool === 'update_styles');
  const before = h.store.get(pid).doc.data.artboards[0].html;
  assert.throws(() => h.store.revertStep(pid, first.n), /Later edits changed the same part/);
  assert.equal(h.store.get(pid).doc.data.artboards[0].html, before);
  h.store.revertStep(pid, second.n); // latest -> undo
  assert.equal(colorOf(h.store, pid, ids[0]), 'blue');
  h.close();
});

test('a step that created a board reverts by removing it, others stay', async () => {
  const h = await harness();
  const call = await h.connect('aaaa1111', 'alpha');
  const { pid, board, ids } = await threeCards(call);
  const second = (await call('create_artboard', { name: 'Second', width: 300, height: 200 })).id;
  await call('update_styles', { node_ids: [ids[0]], styles: { opacity: '0.9' } });
  const created = stepsOf(h.store, pid).find((s) => s.tool === 'create_artboard' && s.artboard === 'Second');
  h.store.revertStep(pid, created.n);
  const doc = h.store.get(pid).doc;
  assert.equal(doc.getArtboard(second), undefined);
  assert.match(doc.getArtboard(board).html, /opacity: 0\.9/);
  h.close();
});

test('diffs are bounded: a huge write is clipped on the wire, stored within the cap, and not patch-revertable', async () => {
  const h = await harness();
  const call = await h.connect('aaaa1111', 'alpha');
  const { pid, board, ids } = await threeCards(call);
  const big = '<div>' + '<p style="margin: 0">row of repeated filler markup</p>'.repeat(400) + '</div>';
  await call('write_html', { target_id: board, html: big });
  const entry = h.store._activityList(pid).filter((e) => e.tool === 'write_html').at(-1);
  assert.ok(entry.diff.boards.every((b) => b.after.length <= SNIPPET_CAP && b.before.length <= SNIPPET_CAP));
  assert.ok(JSON.stringify(entry.diff).length < 4 * SNIPPET_CAP + 2000, 'stored diff stays small');
  const step = stepsOf(h.store, pid).find((s) => s.n === entry.n);
  assert.ok(step.diff.boards.every((b) => b.after.length <= DISPLAY_CAP && b.clipped));
  // It is the newest checkpoint, so undo still works; once another step lands it no longer can.
  assert.ok(step.canRevert);
  await call('update_styles', { node_ids: [ids[0]], styles: { opacity: '0.5' } });
  assert.equal(stepsOf(h.store, pid).find((s) => s.n === entry.n).canRevert, false);
  assert.throws(() => h.store.revertStep(pid, entry.n), /latest change/);
  h.close();
});

test('old entries lose their diff so activity.json stays small', async () => {
  const h = await harness();
  const call = await h.connect('aaaa1111', 'alpha');
  const { pid, ids } = await threeCards(call);
  for (let i = 0; i < 70; i++) await call('update_styles', { node_ids: [ids[0]], styles: { opacity: String(i / 100) } });
  const list = h.store._activityList(pid);
  assert.ok(list.filter((e) => e.diff).length <= 61);
  assert.equal(list.find((e) => e.tool === 'write_html').diff, undefined);
  h.close();
});

test('runs are grouped by prompt AND agent; each run keeps its own agent', async () => {
  const h = await harness();
  const a = await h.connect('aaaa1111', 'alpha');
  const b = await h.connect('bbbb2222', 'beta');
  const { pid, ids } = await threeCards(a);
  await b('start', { prompt: 'beta job', project: 'Cards' });
  await a('update_styles', { node_ids: [ids[0]], styles: { color: 'blue' } });
  await b('update_styles', { node_ids: [ids[1]], styles: { color: 'green' } });
  await a('update_styles', { node_ids: [ids[2]], styles: { color: 'teal' } });
  const { runs } = h.store.listActivity(pid);
  const mine = runs.find((r) => r.prompt === 'make cards');
  const theirs = runs.find((r) => r.prompt === 'beta job');
  assert.equal(mine.agent.name, 'alpha');
  assert.equal(theirs.agent.name, 'beta');
  assert.equal(mine.steps.filter((s) => s.tool === 'update_styles').length, 2); // not merged with beta's step
  assert.equal(theirs.steps.filter((s) => s.tool === 'update_styles').length, 1);
  assert.equal(mine.until, null);
  h.close();
});

test('since returns only runs that changed after the cursor, and a revert counts as a change', async () => {
  const h = await harness();
  const call = await h.connect('aaaa1111', 'alpha');
  const { pid, ids } = await threeCards(call);
  const first = h.store.listActivity(pid);
  assert.equal(h.store.listActivity(pid, { since: first.seq }).runs.length, 0);
  await call('update_styles', { node_ids: [ids[0]], styles: { color: 'blue' } });
  await call('start', { prompt: 'second request', project: 'Cards' });
  const inc = h.store.listActivity(pid, { since: first.seq });
  assert.equal(inc.runs.length, 2);
  assert.ok(inc.seq > first.seq);
  // Revert an old step: its (old) run comes back because the entry got a newer revision.
  const step = stepsOf(h.store, pid).find((s) => s.tool === 'update_styles');
  h.store.revertStep(pid, step.n);
  const after = h.store.listActivity(pid, { since: inc.seq });
  assert.equal(after.runs.length, 1);
  assert.equal(after.runs[0].steps.find((s) => s.n === step.n).reverted, true);
  h.close();
});
