import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, countTurns, evalSummary, fixedCosts, hintsFor, kindOf, splitPrompts, summarize } from '../src/efficiency.mjs';

const A = { id: 'a1', name: 'claude-code', color: 'oklch(0.7 0.1 200)' };
// Builds a call that FINISHED at t (like the real log) and ran for ms.
let n = 0;
const c = (tool, t, extra = {}) => ({ id: `c${++n}`, t, ms: 10, tool, project: 'p', ok: true, tokens: 100, args: {}, agent: A, ...extra });
// Sequential model turns are 5 s apart, so each call is its own turn.
const seq = (...specs) => specs.map(([tool, extra], i) => c(tool, 10_000 + i * 5000, extra));

test('turns: overlapping or back-to-back calls are one turn, gaps start a new one', () => {
  const calls = [c('get_tree', 1000), c('lint', 1005), c('get_screenshot', 1010, { ms: 8 }), c('write_html', 9000)];
  assert.equal(countTurns(calls), 2);
  assert.equal(countTurns([]), 0);
});

test('kindOf: action tools are reads only for list/get style actions', () => {
  assert.equal(kindOf('pages', { action: 'list' }), 'read');
  assert.equal(kindOf('pages', { action: 'create' }), 'write');
  assert.equal(kindOf('get_screenshot'), 'review');
  assert.equal(kindOf('get_tree'), 'read');
});

test('summarize: tokens, screenshots (+pixels), errors, retries and slowest calls', () => {
  const calls = seq(
    ['get_screenshot', { tokens: 1600, ms: 900 }],
    ['write_html', { ok: false, error: 'x', args: { target_id: 'A1' }, ms: 30 }],
    ['write_html', { args: { target_id: 'A1' }, tokens: 50, ms: 40 }],
  );
  const s = summarize(calls);
  assert.equal(s.calls, 3);
  assert.equal(s.turns, 3);
  assert.equal(s.tokens, 1750);
  assert.equal(s.screenshots, 1);
  assert.equal(s.screenshotPixels, 1600 * 750);
  assert.equal(s.errors, 1);
  assert.equal(s.retries, 1); // the failed write_html was repeated with the same args
  assert.equal(s.slowest[0].tool, 'get_screenshot');
  assert.deepEqual(s.tools.map((t) => t.tool), ['get_screenshot', 'write_html']);
});

test('retry: same tool + args right after an error is counted and flagged', () => {
  const a = { target_id: 'A1' };
  const calls = seq(['write_html', { ok: false, args: a }], ['write_html', { args: a }]);
  assert.equal(summarize(calls).retries, 1);
  assert.equal(hintsFor(calls).find((h) => h.id === 'retry').count, 1);
});

test('repeat-read: identical read twice in a row is flagged, with a write between it is not', () => {
  const same = seq(['get_tree', { args: { node_id: 'A1' } }], ['get_tree', { args: { node_id: 'A1' } }]);
  assert.equal(hintsFor(same).find((h) => h.id === 'repeat-read').count, 1);
  const between = seq(['get_tree', { args: { node_id: 'A1' } }], ['update_styles', {}], ['get_tree', { args: { node_id: 'A1' } }]);
  assert.equal(hintsFor(between).find((h) => h.id === 'repeat-read'), undefined);
  const differentArgs = seq(['get_tree', { args: { node_id: 'A1' } }], ['get_tree', { args: { node_id: 'A2' } }]);
  assert.equal(hintsFor(differentArgs).find((h) => h.id === 'repeat-read'), undefined);
});

test('screenshot-per-write: needs several writes, nearly all followed by a screenshot', () => {
  const loop = seq(...Array.from({ length: 4 }, () => [['write_html', {}], ['get_screenshot', {}]]).flat());
  assert.equal(hintsFor(loop).find((h) => h.id === 'screenshot-per-write').count, 4);
  // A normal pass: many writes, one screenshot at the end.
  const normal = seq(['write_html', {}], ['update_styles', {}], ['update_styles', {}], ['get_screenshot', {}]);
  assert.equal(hintsFor(normal).find((h) => h.id === 'screenshot-per-write'), undefined);
});

test('lint-write-loop: three lint->write cycles flag, two do not', () => {
  const cycle = (k) => seq(...Array.from({ length: k }, () => [['lint', {}], ['update_styles', {}]]).flat());
  assert.equal(hintsFor(cycle(3)).find((h) => h.id === 'lint-write-loop').count, 3);
  assert.equal(hintsFor(cycle(2)).find((h) => h.id === 'lint-write-loop'), undefined);
});

test('unbatched-edits: four single-edit turns in a row; parallel calls in one turn do not count', () => {
  const lone = seq(...Array.from({ length: 4 }, () => ['update_styles', {}]));
  assert.equal(hintsFor(lone).find((h) => h.id === 'unbatched-edits').count, 4);
  // Same four edits issued in one turn (calls finish within the gap).
  const together = [0, 1, 2, 3].map((i) => c('update_styles', 10_000 + i));
  assert.equal(hintsFor(together).find((h) => h.id === 'unbatched-edits'), undefined);
});

test('splitPrompts: start/log_prompt with a prompt begin a segment; earlier calls form a leading one', () => {
  const calls = seq(['get_tree', {}], ['start', { args: { prompt: 'make a card' } }], ['write_html', {}], ['log_prompt', { args: { prompt: 'darker' } }], ['lint', {}]);
  const parts = splitPrompts(calls);
  assert.deepEqual(parts.map((p) => [p.prompt, p.calls.length]), [[null, 1], ['make a card', 2], ['darker', 2]]);
  // start without a prompt (just opening a project) does not split.
  assert.equal(splitPrompts(seq(['start', { args: { project: 'x' } }], ['write_html', {}])).length, 1);
});

test('analyze: one session per agent, totals match the sum, window flags a full ring', () => {
  const B = { id: 'b1', name: 'reviewer', color: '' };
  const calls = [
    c('start', 1000, { args: { prompt: 'p1' }, tokens: 200 }),
    c('write_html', 6000, { tokens: 300 }),
    c('get_comments', 11000, { agent: B, tokens: 50 }),
  ];
  const r = analyze(calls, { limit: 3 });
  assert.equal(r.sessions.length, 2);
  assert.equal(r.total.tokens, 550);
  assert.equal(r.sessions.reduce((s, x) => s + x.tokens, 0), r.total.tokens);
  assert.equal(r.sessions.find((s) => s.agent.id === 'a1').prompts[0].prompt, 'p1');
  assert.equal(r.window.truncated, true);
  assert.equal(analyze(calls, { limit: 500 }).window.truncated, false);
  assert.equal(analyze([]).sessions.length, 0);
});

test('evalSummary names match the eval result fields and fixedCosts counts bytes/4', () => {
  const e = evalSummary(seq(['get_screenshot', { tokens: 750 }]));
  assert.equal(e.loggedScreenshots, 1);
  assert.equal(e.loggedScreenshotPixels, 750 * 750);
  const f = fixedCosts({ tools: [{ name: 'a' }], instructions: 'x'.repeat(40), guide: 'y'.repeat(8) });
  assert.equal(f.instructionsTokens, 10);
  assert.equal(f.guideTokens, 2);
  assert.equal(f.toolCount, 1);
});
