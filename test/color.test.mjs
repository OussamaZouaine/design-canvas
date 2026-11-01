import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rgbToOklch, oklchToRgb, inGamut, toGamut, formatHex, parseHex, hexToOklch, toHex, rgbToHsl, hslToRgb,
  parseColor, mixOklch, parseGradient, formatGradient, splitTop,
} from '../web/src/lib/color.ts';

const near = (a, b, eps = 0.002) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('sRGB <-> OKLCH round-trips and greys have no hue', () => {
  const red = rgbToOklch([1, 0, 0]);
  near(red.l, 0.628); near(red.c, 0.2577); near(red.h, 29.23, 0.05);
  oklchToRgb(red).forEach((x, i) => near(x, [1, 0, 0][i], 0.001));
  assert.deepEqual(rgbToOklch([0.5, 0.5, 0.5]).c, 0);
  assert.deepEqual(rgbToOklch([0.5, 0.5, 0.5]).h, 0);
  assert.equal(hexToOklch('#ffffff'), 'oklch(1 0 0)');
  assert.equal(toHex('oklch(1 0 0)'), '#ffffff');
});

test('gamut: detect and map by lowering chroma only', () => {
  const vivid = { l: 0.7, c: 0.35, h: 150, a: 1 };
  assert.equal(inGamut(vivid), false);
  const mapped = toGamut(vivid);
  assert.equal(inGamut(mapped), true);
  assert.equal(mapped.l, 0.7); assert.equal(mapped.h, 150);
  assert.ok(mapped.c < 0.35 && mapped.c > 0.1);
  assert.equal(formatHex({ l: 1, c: 0, h: 0, a: 1 }), 'FFFFFF');
});

test('hex parsing: short, long, with alpha', () => {
  assert.equal(formatHex(parseHex('f00').o), 'FF0000');
  assert.equal(parseHex('#ff000080').alpha.toFixed(2), '0.50');
  assert.equal(parseHex('#12345'), null);
});

test('HSL round-trip', () => {
  const [h, s, l] = rgbToHsl([1, 0.5, 0]);
  near(h, 30, 0.01); near(s, 100, 0.01); near(l, 50, 0.01);
  hslToRgb(h, s, l).forEach((x, i) => near(x, [1, 0.5, 0][i], 0.001));
});

test('parseColor: oklch, hex, rgb, transparent, tokens (nested), unknown', () => {
  assert.deepEqual(parseColor('oklch(0.5 0.1 200 / 50%)'), { l: 0.5, c: 0.1, h: 200, a: 0.5 });
  near(parseColor('#000').l, 0);
  near(parseColor('rgb(255 255 255 / 0.5)').a, 0.5);
  assert.equal(parseColor('transparent').a, 0);
  const tokens = { 'color-bg': 'var(--color-base)', 'color-base': 'oklch(0.9 0 0)' };
  assert.equal(parseColor('var(--color-bg)', tokens).l, 0.9);
  assert.equal(parseColor('var(--nope)', tokens), null);
  assert.equal(parseColor('rebeccapurple'), null);
});

test('mixOklch takes the shorter hue arc and borrows hue from greys', () => {
  near(mixOklch({ l: 0.5, c: 0.1, h: 350, a: 1 }, { l: 0.5, c: 0.1, h: 10, a: 1 }, 0.5).h, 0, 0.001);
  near(mixOklch({ l: 1, c: 0, h: 0, a: 1 }, { l: 0.5, c: 0.2, h: 250, a: 1 }, 0.5).h, 250, 0.001);
});

test('splitTop ignores commas inside parentheses', () => {
  assert.deepEqual(splitTop('a(1, 2), b, c(d(3, 4))'), ['a(1, 2)', 'b', 'c(d(3, 4))']);
});

test('parseGradient: linear angles, sides, interpolation space, missing positions', () => {
  assert.deepEqual(parseGradient('linear-gradient(90deg in oklch, oklch(1 0 0) 0%, oklch(0 0 0) 100%)'), {
    kind: 'linear', angle: 90, shape: '', stops: [{ color: 'oklch(1 0 0)', pos: 0 }, { color: 'oklch(0 0 0)', pos: 1 }],
  });
  assert.equal(parseGradient('linear-gradient(to right, red, blue)').angle, 90);
  assert.equal(parseGradient('linear-gradient(red, blue)').angle, 180);
  assert.equal(parseGradient('linear-gradient(0.25turn, red, blue)').angle, 90);
  assert.equal(parseGradient('linear-gradient(in oklch longer hue, red, blue)').angle, 180);
  const spread = parseGradient('linear-gradient(red, var(--color-a), green, blue 80%)').stops.map((s) => s.pos);
  [0, 0.8 / 3, 1.6 / 3, 0.8].forEach((p, i) => near(spread[i], p, 1e-9));
});

test('parseGradient: radial keeps its shape text; unsupported forms are null', () => {
  const r = parseGradient('radial-gradient(circle at top in oklch, oklch(1 0 0), oklch(0 0 0))');
  assert.equal(r.kind, 'radial'); assert.equal(r.shape, 'circle at top');
  assert.equal(parseGradient('radial-gradient(red, blue)').shape, '');
  assert.equal(parseGradient('linear-gradient(red, blue), red'), null); // two layers
  assert.equal(parseGradient('repeating-linear-gradient(red, blue 10%)'), null);
  assert.equal(parseGradient('linear-gradient(red 10% 20%, blue)'), null); // two-position stop
  assert.equal(parseGradient('linear-gradient(red, 30%, blue)'), null); // colour hint
  assert.equal(parseGradient('linear-gradient(red)'), null);
  assert.equal(parseGradient('oklch(1 0 0)'), null);
});

test('formatGradient sorts stops, writes in oklch, and round-trips', () => {
  const g = { kind: 'linear', angle: 45, shape: '', stops: [{ color: 'var(--color-a)', pos: 1 }, { color: 'oklch(1 0 0)', pos: 0 }] };
  const css = formatGradient(g);
  assert.equal(css, 'linear-gradient(45deg in oklch, oklch(1 0 0) 0%, var(--color-a) 100%)');
  assert.equal(formatGradient(parseGradient(css)), css);
  const r = 'radial-gradient(circle in oklch, oklch(1 0 0) 0%, oklch(0 0 0) 62.5%)';
  assert.equal(formatGradient(parseGradient(r)), r);
});
