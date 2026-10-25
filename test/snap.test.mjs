import test from 'node:test';
import assert from 'node:assert/strict';
import { snapMove, snapResize, annotate, measure, resizeBox, scaleInto, unionOf } from '../web/src/canvas/snap.ts';

const B = (x, y, w, h) => ({ x, y, w, h });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('left edge snaps to a sibling edge within the threshold, each axis on its own', () => {
  const r = snapMove(B(103, 40, 50, 50), [B(100, 300, 80, 20)], null, 5);
  near(r.dx, -3); near(r.dy, 0);
  assert.ok(r.guides.some((g) => g.axis === 'x' && g.pos === 100));
});

test('outside the threshold nothing moves', () => {
  const r = snapMove(B(300, 40, 50, 50), [B(100, 300, 80, 20)], null, 5);
  near(r.dx, 0); assert.equal(r.guides.filter((g) => g.axis === 'x').length, 0);
});

test('centre snaps to a sibling centre', () => {
  const r = snapMove(B(0, 0, 40, 40), [B(100, 100, 100, 100)], null, 5, {}); // centre of box 20, sibling lines 100/150/200
  near(r.dx, 0);
  const r2 = snapMove(B(128, 0, 40, 40), [B(100, 100, 100, 100)], null, 5); // centre 148 -> 150
  near(r2.dx, 2);
});

test('parent content box is a candidate', () => {
  const r = snapMove(B(3, 5, 20, 20), [], B(0, 0, 200, 100), 5);
  near(r.dx, -3); near(r.dy, -5);
});

test('lock skips an axis', () => {
  const r = snapMove(B(103, 98, 50, 50), [B(100, 100, 10, 10)], null, 5, { x: true });
  near(r.dx, 0); near(r.dy, 2);
});

test('equal spacing between two neighbours', () => {
  // L ends at 50, R starts at 200, box is 50 wide -> centred x = 100 (gaps of 50); start at 97 snaps by +3
  const L = B(0, 0, 50, 50), R = B(200, 0, 50, 50);
  const r = snapMove(B(97, 0, 50, 50), [L, R], null, 5);
  near(r.dx, 3);
  const marks = r.pills.filter((p) => p.equal);
  assert.equal(marks.length, 2);
  assert.ok(marks.every((p) => Math.abs(p.value - 50) < 1e-6));
});

test('equal spacing by extending an existing gap', () => {
  const a = B(0, 0, 50, 50), b = B(80, 0, 50, 50); // gap 30
  const r = snapMove(B(163, 0, 50, 50), [a, b], null, 5); // wants left edge at 130 + 30 = 160
  near(r.dx, -3);
  assert.ok(r.pills.some((p) => p.equal && p.value === 30));
});

test('neighbour that does not overlap across the axis gives no gap pill', () => {
  const pills = annotate(B(0, 0, 10, 10), [B(100, 500, 10, 10)], null).pills;
  assert.equal(pills.length, 0);
});

test('gap pills measure to siblings and fall back to the parent edge', () => {
  const p = annotate(B(60, 20, 40, 40), [B(0, 20, 40, 40)], B(0, 0, 200, 100)).pills;
  const x = p.filter((q) => q.axis === 'x').map((q) => q.value).sort((a, b) => a - b);
  assert.deepEqual(x, [20, 100]);
});

test('resize snaps only the moving edge', () => {
  const r = snapResize(B(0, 0, 97, 50), 'e', [B(200, 0, 10, 10), B(100, 300, 10, 10)], null, 5);
  near(r.box.w, 100); near(r.box.x, 0); near(r.box.h, 50);
  const w = snapResize(B(2, 0, 98, 50), 'w', [B(0, 300, 10, 10)], null, 5);
  near(w.box.x, 0); near(w.box.w, 100); // right edge stays at 100
});

test('resizeBox: plain, Shift ratio, Alt centre', () => {
  const s = B(100, 100, 200, 100);
  let r = resizeBox(s, 'se', 50, 0);
  near(r.w, 250); near(r.h, 100);
  r = resizeBox(s, 'se', 50, 0, { shift: true });
  near(r.w, 250); near(r.h, 125);
  r = resizeBox(s, 'e', 40, 0, { alt: true });
  near(r.w, 280); near(r.x, 60); near(r.y, 100);
  r = resizeBox(s, 'nw', -20, -20); // drag up-left grows
  near(r.w, 220); near(r.h, 120); near(r.x, 80); near(r.y, 80);
  r = resizeBox(s, 'e', -500, 0); // clamps to the minimum
  near(r.w, 4);
});

test('resizeBox keeps ratio when the other axis is clamped', () => {
  const r = resizeBox(B(0, 0, 200, 100), 'se', -500, 0, { shift: true });
  near(r.w / r.h, 2); assert.ok(r.h >= 4);
});

test('scaleInto keeps relative placement in the union', () => {
  const from = B(0, 0, 100, 100), to = B(10, 10, 200, 50);
  const m = scaleInto(B(50, 0, 50, 100), from, to);
  assert.deepEqual(m, B(110, 10, 100, 50));
  assert.deepEqual(unionOf([B(0, 0, 10, 10), B(20, 5, 10, 10)]), B(0, 0, 30, 15));
});

test('measure: apart, nested', () => {
  const apart = measure(B(0, 0, 10, 10), B(50, 0, 10, 10));
  assert.equal(apart.find((p) => p.axis === 'x').value, 40);
  const nested = measure(B(20, 30, 10, 10), B(0, 0, 100, 100));
  assert.deepEqual(nested.map((p) => p.value).sort((a, b) => a - b), [20, 30, 60, 70]);
});
