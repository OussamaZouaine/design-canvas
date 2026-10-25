import test from 'node:test';
import assert from 'node:assert/strict';
import { inferAxis, insertionIndex, insertionLine, resolveDrop, stepDrop } from '../web/src/canvas/dragflow.ts';

const R = (left, top, width, height) => ({ left, top, width, height });
const col = [R(0, 0, 100, 40), R(0, 50, 100, 40), R(0, 100, 100, 40)];
const row = [R(0, 0, 40, 100), R(50, 0, 40, 100), R(100, 0, 40, 100)];
const grid = [R(0, 0, 40, 40), R(50, 0, 40, 40), R(0, 50, 40, 40), R(50, 50, 40, 40)];

test('axis is read from the boxes, with a hint for 0-1 children', () => {
  assert.equal(inferAxis(col), 'y');
  assert.equal(inferAxis(row), 'x');
  assert.equal(inferAxis(grid), 'flow');
  assert.equal(inferAxis([R(0, 0, 10, 10)], 'x'), 'x');
  assert.equal(inferAxis([]), 'y');
});

test('insertion index counts the children before the pointer', () => {
  assert.equal(insertionIndex(col, 'y', 50, -5), 0);
  assert.equal(insertionIndex(col, 'y', 50, 25), 1); // below the first child's centre line (20)
  assert.equal(insertionIndex(col, 'y', 50, 15), 0);
  assert.equal(insertionIndex(col, 'y', 50, 500), 3);
  assert.equal(insertionIndex(row, 'x', 75, 50), 2);
  assert.equal(insertionIndex(row, 'x', -10, 50), 0);
  assert.equal(insertionIndex([], 'y', 0, 0), 0);
});

test('flow axis reads rows left to right, then down', () => {
  assert.equal(insertionIndex(grid, 'flow', 10, 10), 0);
  assert.equal(insertionIndex(grid, 'flow', 45, 10), 1); // left of the second child's centre (70)
  assert.equal(insertionIndex(grid, 'flow', 80, 10), 2); // past it: end of the first row
  assert.equal(insertionIndex(grid, 'flow', 10, 60), 2);
  assert.equal(insertionIndex(grid, 'flow', 95, 95), 4);
});

test('insertion line sits between siblings and spans the column / row', () => {
  assert.deepEqual(insertionLine(col, 1, 'y', R(0, 0, 100, 140)), { left: 0, top: 44, width: 100, height: 2 });
  assert.deepEqual(insertionLine(col, 0, 'y', R(0, 0, 100, 140)), { left: 0, top: -1, width: 100, height: 2 });
  assert.deepEqual(insertionLine(col, 3, 'y', R(0, 0, 100, 140)), { left: 0, top: 139, width: 100, height: 2 });
  assert.deepEqual(insertionLine(row, 1, 'x', R(0, 0, 140, 100)), { left: 44, top: 0, width: 2, height: 100 });
  assert.deepEqual(insertionLine(row, 3, 'x', R(0, 0, 140, 100)), { left: 139, top: 0, width: 2, height: 100 });
  const empty = insertionLine([], 0, 'y', R(10, 20, 100, 50));
  assert.equal(empty.height, 2);
  assert.equal(empty.width, 92);
});

test('resolveDrop expresses the move against a sibling that stays put', () => {
  const kids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(resolveDrop('P', kids, ['a'], 3), { target: 'd', position: 'before', noop: false }); // after c == before d
  assert.deepEqual(resolveDrop('P', kids, ['d'], 1), { target: 'b', position: 'before', noop: false });
  assert.deepEqual(resolveDrop('P', kids, ['a'], 4), { target: 'd', position: 'after', noop: false });
  // Dropping a node right before / after itself changes nothing.
  assert.equal(resolveDrop('P', kids, ['b'], 1).noop, true);
  assert.equal(resolveDrop('P', kids, ['b'], 2).noop, true);
  assert.equal(resolveDrop('P', kids, ['b', 'c'], 1).noop, true);
  assert.equal(resolveDrop('P', kids, ['b', 'c'], 4).noop, false);
});

test('resolveDrop into another container is never a no-op, and empty containers use end', () => {
  assert.deepEqual(resolveDrop('Q', ['x', 'y'], ['a'], 1), { target: 'y', position: 'before', noop: false });
  assert.deepEqual(resolveDrop('Q', [], ['a'], 0), { target: 'Q', position: 'end', noop: false });
  assert.equal(resolveDrop('P', ['a'], ['a'], 0).noop, true);
});

test('stepDrop moves the set one slot and stops at the edges', () => {
  const kids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(stepDrop('P', kids, ['b'], -1), { target: 'a', position: 'before', noop: false });
  assert.deepEqual(stepDrop('P', kids, ['b'], 1), { target: 'd', position: 'before', noop: false });
  assert.equal(stepDrop('P', kids, ['a'], -1), null);
  assert.equal(stepDrop('P', kids, ['d'], 1), null);
  assert.deepEqual(stepDrop('P', kids, ['b', 'c'], 1), { target: 'd', position: 'after', noop: false });
});

test('edge band: outer part of a sibling along the axis', async () => {
  const { inEdgeBand } = await import('../web/src/canvas/dragflow.ts');
  const r = R(0, 0, 100, 100);
  assert.equal(inEdgeBand(r, 'x', 10, 50), true);
  assert.equal(inEdgeBand(r, 'x', 50, 50), false);
  assert.equal(inEdgeBand(r, 'y', 50, 95), true);
  assert.equal(inEdgeBand(r, 'y', 5, 50), false);
});
