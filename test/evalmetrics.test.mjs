import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutMetrics, lintMetrics, meterDelta } from '../src/evalmetrics.mjs';

const report = (over = {}) => ({ id: 'A1', width: 400, height: 800, fit: false, contentWidth: 400, contentHeight: 800, outside: [], clipped: [], ...over });

test('layoutMetrics counts only boards that still overflow', () => {
  const m = layoutMetrics([report(), report({ id: 'A2', contentHeight: 1200, outside: [{ id: 'N1' }], clipped: [{ id: 'N2' }] })]);
  assert.deepEqual(m, { boardsMeasured: 2, overflowBoards: 1, overflowNodes: 2 });
});

test('lintMetrics totals issues and boards with issues', () => {
  assert.deepEqual(lintMetrics({ A1: [], A2: ['a', 'b'], A3: ['c'] }), { lintIssues: 3, lintBoards: 2 });
});

test('meterDelta subtracts the earlier snapshot and derives run counts', () => {
  const before = { tools: [{ name: 'get_screenshot', calls: 4, tokens: 400, errors: 0 }] };
  const after = { tools: [
    { name: 'get_screenshot', calls: 7, tokens: 1000, errors: 0 },
    { name: 'fit_artboard', calls: 1, tokens: 10, errors: 0 },
    { name: 'lint', calls: 2, tokens: 20, errors: 0 },
  ] };
  const d = meterDelta(before, after);
  assert.equal(d.screenshots, 3);
  assert.equal(d.fixRounds, 1);
  assert.equal(d.toolCalls, 6);
  assert.equal(d.toolTokens, 630);
});
