// Export row maths lives in web/src/lib/exportspec.ts (no DOM); Node strips the types.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScale, outputSize, validateRows, fileNames, MAX_SIDE } from '../web/src/lib/exportspec.ts';

test('parseScale reads multipliers and fixed sizes', () => {
  assert.deepEqual(parseScale('2x'), { kind: 'x', value: 2 });
  assert.deepEqual(parseScale('0.5X'), { kind: 'x', value: 0.5 });
  assert.deepEqual(parseScale('3'), { kind: 'x', value: 3 });
  assert.deepEqual(parseScale('512w'), { kind: 'w', value: 512 });
  assert.deepEqual(parseScale('300h'), { kind: 'h', value: 300 });
  for (const bad of ['', 'x', '0x', '99x', 'abc', '-2x', '0w']) assert.equal(parseScale(bad), null, bad);
});

test('outputSize scales, fits a width or height, and clamps to the canvas limit', () => {
  assert.deepEqual(outputSize({ w: 100, h: 50 }, '2x'), { w: 200, h: 100, k: 2, clamped: false });
  assert.deepEqual(outputSize({ w: 100, h: 50 }, '300w'), { w: 300, h: 150, k: 3, clamped: false });
  assert.deepEqual(outputSize({ w: 100, h: 50 }, '100h'), { w: 200, h: 100, k: 2, clamped: false });
  const big = outputSize({ w: 10000, h: 10000 }, '4x');
  assert.equal(big.clamped, true);
  assert.ok(big.w <= MAX_SIDE && big.w * big.h <= 268_000_000);
  assert.equal(outputSize({ w: 10, h: 10 }, 'nonsense').k, 1);
});

test('validateRows drops junk, normalizes and caps', () => {
  assert.deepEqual(validateRows('x'), []);
  const rows = validateRows([
    { scale: '2X', format: 'PNG', suffix: '@2x' },
    { scale: 'bad', format: 'png' },
    { scale: '1x', format: 'gif' },
    { scale: '1x', format: 'jpg', quality: 0.5 },
    { scale: '1x', format: 'jpg', quality: 7 },
    null,
  ]);
  assert.deepEqual(rows, [
    { scale: '2x', format: 'png', suffix: '@2x' },
    { scale: '1x', format: 'jpg', quality: 0.5 },
    { scale: '1x', format: 'jpg' },
  ]);
  assert.equal(validateRows(Array.from({ length: 20 }, () => ({ scale: '1x', format: 'png' }))).length, 8);
});

test('fileNames uses suffixes, dedupes rows with @scale and same-named items with a counter', () => {
  assert.deepEqual(fileNames([{ name: 'Hero card' }], [{ scale: '1x', format: 'png' }]), [['Hero-card.png']]);
  assert.deepEqual(fileNames([{ name: 'a' }], [{ scale: '1x', format: 'png', suffix: '-small' }]), [['a-small.png']]);
  assert.deepEqual(fileNames([{ name: 'a' }], [{ scale: '1x', format: 'png' }, { scale: '2x', format: 'png' }]), [['a@1x.png', 'a@2x.png']]);
  assert.deepEqual(fileNames([{ name: 'a' }], [{ scale: '1x', format: 'png' }, { scale: '1x', format: 'jpg' }]), [['a.png', 'a.jpg']]);
  assert.deepEqual(fileNames([{ name: 'a' }, { name: 'a' }], [{ scale: '1x', format: 'png' }]), [['a.png'], ['a-2.png']]);
  assert.deepEqual(fileNames([{ name: '../..//' }], [{ scale: '1x', format: 'svg' }]), [['export.svg']]);
});
