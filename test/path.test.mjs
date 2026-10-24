// The path maths lives in the web client (web/src/canvas/path.ts) but has no DOM, so the root test runner imports it
// directly (Node strips the types).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePath, serializePath, pathBounds, insertAnchor, removeAnchor, toggleSmooth, isSmooth, moveHandle,
  setSymmetricHandles, nearestOnPath, fitToBox, segCount,
} from '../web/src/canvas/path.ts';

const close = (a, b, eps = 0.02) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('parse and serialize round-trip lines, cubics and close', () => {
  const d = 'M0 0L10 0C10 5 15 10 20 10Z';
  const m = parsePath(d);
  assert.equal(m.closed, true);
  assert.equal(m.anchors.length, 3);
  assert.equal(serializePath(m), d);
});

test('relative commands, H/V and implicit lineto are absolutised', () => {
  const m = parsePath('m10 10 20 0 v 10 h-20 z');
  assert.deepEqual(m.anchors.map((a) => [a.p.x, a.p.y]), [[10, 10], [30, 10], [30, 20], [10, 20]]);
  assert.equal(m.closed, true);
});

test('a closing line back to the start does not duplicate the first anchor', () => {
  const m = parsePath('M0 0L10 0L10 10L0 0Z');
  assert.equal(m.anchors.length, 3);
});

test('quadratics become cubics with the same end points', () => {
  const m = parsePath('M0 0Q10 10 20 0');
  assert.equal(m.anchors.length, 2);
  close(m.anchors[0].out.x, 20 / 3);
  close(m.anchors[1].in.x, 40 / 3);
});

test('arcs, extra subpaths and garbage are refused', () => {
  assert.equal(parsePath('M0 0A5 5 0 0 1 10 10'), null);
  assert.equal(parsePath('M0 0L5 5ZM10 10L20 20'), null);
  assert.equal(parsePath('M0 0L5 5 foo'), null);
  assert.equal(parsePath('L5 5'), null);
});

test('bounds use curve extrema, not control points', () => {
  // A symmetric arch: control points reach y=-40 but the curve peaks at y=-30 (3/4 of the way).
  const m = parsePath('M0 0C0 -40 40 -40 40 0');
  const b = pathBounds(m);
  close(b.minY, -30);
  close(b.maxY, 0);
  close(b.minX, 0);
  close(b.maxX, 40);
});

test('inserting an anchor on a curve keeps its shape', () => {
  const m = parsePath('M0 0C0 -40 40 -40 40 0');
  const { model, index } = insertAnchor(m, 0, 0.5);
  assert.equal(index, 1);
  assert.equal(model.anchors.length, 3);
  close(model.anchors[1].p.x, 20);
  close(model.anchors[1].p.y, -30);
  // Same outline, so the bounds do not change.
  close(pathBounds(model).minY, -30);
});

test('inserting on the closing segment appends at the end', () => {
  const m = parsePath('M0 0L10 0L10 10Z');
  const { model, index } = insertAnchor(m, 2, 0.5);
  assert.equal(index, 3);
  assert.deepEqual([model.anchors[3].p.x, model.anchors[3].p.y], [5, 5]);
});

test('removing an anchor from a triangle opens it', () => {
  const m = parsePath('M0 0L10 0L10 10Z');
  const out = removeAnchor(m, 1);
  assert.equal(out.anchors.length, 2);
  assert.equal(out.closed, false);
});

test('toggleSmooth grows collinear handles and drops them again', () => {
  const m = parsePath('M0 0L10 0L20 10');
  const smooth = toggleSmooth(m, 1);
  assert.ok(isSmooth(smooth.anchors[1]));
  const corner = toggleSmooth(smooth, 1);
  assert.equal(corner.anchors[1].in, null);
  assert.equal(corner.anchors[1].out, null);
});

test('dragging a handle of a smooth anchor mirrors the other one; alt breaks it', () => {
  let m = parsePath('M0 0L10 0L20 0');
  m = toggleSmooth(m, 1);
  const mirrored = moveHandle(m, 1, 'out', { x: 10, y: 6 });
  assert.ok(isSmooth(mirrored.anchors[1]));
  const broken = moveHandle(m, 1, 'out', { x: 10, y: 6 }, true);
  assert.ok(!isSmooth(broken.anchors[1]));
});

test('pen drag makes symmetric handles', () => {
  const m = setSymmetricHandles(parsePath('M10 10L20 20'), 1, { x: 30, y: 20 });
  assert.deepEqual(m.anchors[1].in, { x: 10, y: 20 });
  assert.ok(isSmooth(m.anchors[1]));
});

test('nearestOnPath finds the closest segment and parameter', () => {
  const m = parsePath('M0 0L100 0L100 100');
  const hit = nearestOnPath(m, { x: 100, y: 50 });
  assert.equal(hit.seg, 1);
  close(hit.t, 0.5, 0.02);
  close(hit.dist, 0, 0.5);
});

test('fitToBox pads, shifts d to the new origin and sizes the viewBox', () => {
  const m = parsePath('M50 60L90 100');
  const r = fitToBox(m, 2);
  assert.equal(r.dx, 48);
  assert.equal(r.dy, 58);
  assert.equal(r.width, 44);
  assert.equal(r.height, 44);
  assert.equal(r.viewBox, '0 0 44 44');
  assert.equal(r.d, 'M2 2L42 42');
});

test('segCount: open vs closed', () => {
  assert.equal(segCount(parsePath('M0 0L1 1L2 2')), 2);
  assert.equal(segCount(parsePath('M0 0L1 1L2 2Z')), 3);
});
