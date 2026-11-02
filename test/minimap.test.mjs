import test from 'node:test';
import assert from 'node:assert/strict';
import { unionRects, fitWorld, toMap, toWorld, viewRect, centerCamera } from '../web/src/canvas/minimap.ts';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('union covers every rect, null when empty', () => {
  assert.equal(unionRects([]), null);
  assert.deepEqual(unionRects([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: -5, w: 10, h: 10 }]), { x: 0, y: -5, w: 30, h: 15 });
});

test('fit keeps the world inside the box, centred', () => {
  const f = fitWorld({ x: 100, y: 100, w: 400, h: 100 }, 200, 100, 0);
  near(f.s, 0.5);
  const m = toMap(f, { x: 100, y: 100, w: 400, h: 100 });
  near(m.x, 0); near(m.w, 200); near(m.y, 25); near(m.h, 50);
});

test('toWorld inverts toMap', () => {
  const f = fitWorld({ x: -50, y: 30, w: 300, h: 200 }, 160, 120);
  const m = toMap(f, { x: 10, y: 60, w: 0, h: 0 });
  const w = toWorld(f, m.x, m.y);
  near(w.x, 10); near(w.y, 60);
});

test('viewRect and centerCamera are consistent', () => {
  const k = 0.5, c = centerCamera(1000, 400, k, 800, 600);
  const r = viewRect({ ...c, k }, 800, 600);
  near(r.x + r.w / 2, 1000); near(r.y + r.h / 2, 400);
});

test('zero-size world does not divide by zero', () => {
  assert.ok(Number.isFinite(fitWorld({ x: 0, y: 0, w: 0, h: 0 }, 100, 100).s));
});
