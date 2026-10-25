import test from 'node:test';
import assert from 'node:assert/strict';
import { measureGap, planWrap, planUnwrap, unionBox } from '../web/src/canvas/structure.ts';

const b = (x, y, w, h) => ({ x, y, w, h });

test('measureGap takes the median positive spacing and ignores overlaps', () => {
  assert.equal(measureGap([b(0, 0, 10, 10), b(0, 18, 10, 10), b(0, 46, 10, 10)], 'y'), 18); // gaps 8, 18 -> upper median
  assert.equal(measureGap([b(0, 0, 10, 10), b(5, 0, 10, 10)], 'x'), 0);
  assert.equal(measureGap([b(0, 0, 10, 10)], 'y'), 0);
});

test('planWrap: flow nodes get a flex wrapper with the guessed direction and gap', () => {
  const items = [{ id: 'a', box: b(0, 0, 50, 20), abs: false }, { id: 'b', box: b(0, 30, 50, 20), abs: false }];
  assert.deepEqual(planWrap(items, 'group', 'y').styles, { display: 'flex', flexDirection: 'column', gap: '10px' });
  assert.equal(planWrap(items, 'auto', 'flow').styles.flexWrap, 'wrap');
});

test('planWrap: absolute members are re-based on the union box (group) or freed (auto layout)', () => {
  const items = [{ id: 'a', box: b(10, 20, 30, 30), abs: true }, { id: 'b', box: b(60, 20, 30, 30), abs: true }];
  const g = planWrap(items, 'group', 'x');
  assert.deepEqual(g.styles, { position: 'absolute', left: '10px', top: '20px', width: '80px', height: '30px' });
  assert.deepEqual(g.perId.b, { left: '50px', top: '0px' });
  const a = planWrap(items, 'auto', 'x');
  assert.equal(a.styles.display, 'flex');
  assert.equal(a.styles.gap, '20px');
  assert.equal(a.perId.a.position, null);
});

test('planWrap refuses a mix of flow and absolute nodes', () => {
  assert.equal(planWrap([{ id: 'a', box: b(0, 0, 1, 1), abs: true }, { id: 'b', box: b(0, 0, 1, 1), abs: false }], 'group', 'y'), null);
});

test('planUnwrap moves absolute kids by the absolute wrapper offset only', () => {
  const kids = [{ id: 'a', abs: true, x: 5, y: 6 }, { id: 'b', abs: false, x: 0, y: 0 }];
  assert.deepEqual(planUnwrap({ abs: true, x: 100, y: 50 }, kids), { a: { left: '105px', top: '56px' } });
  assert.deepEqual(planUnwrap({ abs: false, x: 100, y: 50 }, kids), {});
  assert.deepEqual(unionBox([b(0, 0, 5, 5), b(10, 10, 5, 5)]), b(0, 0, 15, 15));
});
