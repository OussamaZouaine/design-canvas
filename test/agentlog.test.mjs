import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CallLog, summarizeArgs, RING } from '../src/agentlog.mjs';

const PID = 'p_aaaaaaaa';
function mk() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-calls-'));
  fs.mkdirSync(path.join(dir, 'projects', PID), { recursive: true });
  const events = [];
  return { dir, events, log: new CallLog({ dataDir: dir, emit: (t, p) => events.push([t, p]) }) };
}
const call = (extra = {}) => ({ ms: 5, tool: 'write_html', project: PID, ok: true, tokens: 10, args: {}, ...extra });

test('summarizeArgs: html and image payloads become sizes, never content', () => {
  const html = '<div style="color:red">SECRET-MARKUP</div>'.repeat(1000);
  const s = summarizeArgs({ node_id: 'n1', html, image_data: 'AAAA'.repeat(100), action: 'set' });
  assert.equal(s.node_id, 'n1');
  assert.equal(s.action, 'set');
  assert.match(s.html, /^\d+k chars$/);
  assert.ok(!JSON.stringify(s).includes('SECRET-MARKUP'));
  assert.ok(!JSON.stringify(s).includes('AAAA'));
});

test('summarizeArgs: prompt text is capped, nested html and batch ops are summarized', () => {
  const s = summarizeArgs({ prompt: 'x'.repeat(500), opts: { html: '<p>nested secret markup that is long enough</p>' }, ops: [{ tool: 'write_html', html: '<b>q</b>' }, { tool: 'update_styles' }] });
  assert.ok(s.prompt.length <= 120);
  assert.ok(!JSON.stringify(s).includes('nested secret'));
  assert.equal(s.ops, '2 (write_html, update_styles)');
});

test('ring is capped per project and keeps the newest entries', () => {
  const { log } = mk();
  for (let i = 0; i < RING + 25; i++) log.finish(call({ args: { i } }));
  const all = log.list(PID);
  assert.equal(all.length, RING);
  assert.equal(all.at(-1).args.i, RING + 24);
  assert.equal(all[0].args.i, 25);
});

test('list(since) returns only newer entries, with strictly increasing t', () => {
  const { log } = mk();
  const a = log.finish(call());
  const b = log.finish(call());
  const c = log.finish(call());
  assert.ok(a.t < b.t && b.t < c.t);
  assert.deepEqual(log.list(PID, a.t).map((e) => e.id), [b.id, c.id]);
  assert.equal(log.list(PID, c.t).length, 0);
});

test('events: call always, call-start only for slow tools', () => {
  const { log, events } = mk();
  log.start(PID, 'write_html', {});
  assert.equal(events.length, 0);
  const id = log.start(PID, 'get_screenshot', { artboard_id: 'a1' });
  assert.equal(events[0][0], 'call-start');
  log.finish(call({ id, tool: 'get_screenshot' }));
  assert.equal(events[1][0], 'call');
  assert.equal(events[1][1].call.id, id);
});

// The UI tints the "waiting for screenshot" pill per agent, so call-start must say who started the call.
test('call-start carries the agent', () => {
  const { log, events } = mk();
  const agent = { id: 'reviewer', name: 'reviewer', color: 'oklch(0.68 0.15 10)' };
  log.start(PID, 'get_screenshot', {}, agent);
  assert.deepEqual(events[0][1].call.agent, agent);
});

test('flush appends to calls.jsonl and a new log reloads it', () => {
  const { dir, log } = mk();
  log.finish(call({ args: { n: 1 } }));
  log.finish(call({ args: { n: 2 } }));
  log.flushAll();
  const lines = fs.readFileSync(path.join(dir, 'projects', PID, 'calls.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  const again = new CallLog({ dataDir: dir, emit: () => {} });
  assert.equal(again.list(PID).length, 2);
});
