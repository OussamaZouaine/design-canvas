import test from 'node:test';
import assert from 'node:assert/strict';
import { Doc } from '../src/doc.mjs';
import { parseColor, contrast } from '../src/lint.mjs';

const ratio = (a, b) => contrast(parseColor(a).rgb, parseColor(b).rgb);

test('contrast matches known WCAG values', () => {
  assert.ok(Math.abs(ratio('#000', '#fff') - 21) < 0.01);
  assert.ok(Math.abs(ratio('#777', '#fff') - 4.48) < 0.05);
  // oklch white vs black round-trips to the same extremes
  assert.ok(ratio('oklch(1 0 0)', 'oklch(0 0 0)') > 20.9);
});

function lint(html, size = {}) {
  const doc = new Doc(null);
  const ab = doc.createArtboard({ name: 'T', width: 400, ...size });
  doc.writeHtml(ab.id, html);
  return doc.lint(ab.id);
}

test('flags low contrast but accepts passing text', () => {
  assert.match(lint('<p style="color:#999">faint</p>').join('\n'), /low contrast/);
  assert.deepEqual(lint('<p style="color:#111">fine</p>'), []);
});

test('judges text against the nearest painted background', () => {
  assert.deepEqual(lint('<div style="background:#111"><p style="color:#fff">inverse</p></div>'), []);
  assert.match(lint('<div style="background:#111"><p style="color:#222">dark on dark</p></div>').join('\n'), /low contrast/);
});

test('skips gradients it cannot evaluate', () => {
  assert.deepEqual(lint('<div style="background:linear-gradient(red,blue)"><p style="color:#eee">x</p></div>'), []);
});

test('flags small text, placeholder copy, wide boxes and odd spacing', () => {
  const out = lint('<div style="width:900px; padding:5px"><p style="font-size:10px">Lorem ipsum</p></div>').join('\n');
  assert.match(out, /wider than the artboard/);
  assert.match(out, /not on the 4px spacing grid/);
  assert.match(out, /small text 10px/);
  assert.match(out, /placeholder copy/);
});

test('the spacing grid is configurable', () => {
  const doc = new Doc(null);
  const ab = doc.createArtboard({ name: 'T' });
  doc.writeHtml(ab.id, '<div style="gap:6px"></div>');
  assert.match(doc.lint(ab.id).join(''), /4px spacing grid/);
  assert.deepEqual(doc.lint(ab.id, { grid: 2 }), []);
});

test('large text only needs 3:1', () => {
  assert.deepEqual(lint('<h1 style="color:#8a8a8a; font-size:32px">Big</h1>'), []);
});

test('node-scoped lint works', () => {
  const doc = new Doc(null);
  const ab = doc.createArtboard({ name: 'T' });
  const [id] = doc.writeHtml(ab.id, '<p style="color:#ccc">x</p>');
  assert.match(doc.lint(id).join(''), /low contrast/);
});

test('disabled and aria-hidden text is exempt from contrast', () => {
  assert.deepEqual(lint('<button aria-disabled="true"><span style="color:#ddd">Off</span></button>'), []);
  assert.deepEqual(lint('<p aria-hidden="true" style="color:#eee">404</p>'), []);
});

test('a negative offset inside a positioned parent is not off-artboard', () => {
  assert.deepEqual(lint('<div style="position:relative"><i style="position:absolute;top:-6px;right:-6px"></i></div>'), []);
  assert.match(lint('<i style="position:absolute;top:-6px"></i>').join(''), /outside the artboard/);
});

test('var() colours are resolved from the theme and checked per mode', () => {
  const doc = new Doc(null);
  doc.setTokens({ 'color-fg': '#bbb', 'color-bg': '#fff' });
  doc.setTokens({ 'color-fg': '#eee', 'color-bg': '#111' }, { mode: 'dark' });
  const ab = doc.createArtboard({ name: 'T' });
  doc.writeHtml(ab.id, '<div style="background:var(--color-bg)"><p style="color:var(--color-fg)">hi</p></div>');
  assert.match(doc.lint(ab.id).join(''), /low contrast/); // light grey on white
  assert.deepEqual(doc.lint(ab.id, { mode: 'dark' }), []); // light on dark passes
});

test('a var() with no token and no fallback is reported; a fallback is used', () => {
  assert.match(lint('<p style="color:var(--color-nope)">x</p>').join(''), /var\(--color-nope\) is not a defined token/);
  assert.match(lint('<p style="color:var(--color-nope, #ccc)">x</p>').join(''), /low contrast/);
});

test('spacing tokens are checked against the grid after resolving', () => {
  const doc = new Doc(null);
  doc.setTokens({ 'space-odd': '5px' });
  const ab = doc.createArtboard({ name: 'T' });
  doc.writeHtml(ab.id, '<div style="gap:var(--space-odd)"></div>');
  assert.match(doc.lint(ab.id).join(''), /gap: 5px/);
});
