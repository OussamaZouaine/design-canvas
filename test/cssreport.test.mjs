import test from 'node:test';
import assert from 'node:assert/strict';
import { PRUNE_SCRIPT, formatReport } from '../src/cssreport.mjs';

// The helpers are not exported (they must stay self-contained for the in-page script), so load them the way the
// page does: evaluate the script text with a fake document. This also proves the shipped source has no outer deps.
function run(rules, { present, now = () => 0, inPageMs = 5000, fonts = 'Inter' } = {}) {
  const sheet = { cssRules: rules };
  const document = {
    documentElement: {}, body: {}, styleSheets: [sheet],
    querySelector: (s) => (present(s) ? {} : null),
  };
  const getComputedStyle = () => ({ fontFamily: fonts });
  let t = 0;
  const Date2 = { now: () => (t += now()) };
  return new Function('document', 'getComputedStyle', 'Date', `return ${PRUNE_SCRIPT({ inPageMs })}`)(document, getComputedStyle, Date2);
}

// Minimal CSSStyleDeclaration stand-in: indexed property names, `length` and getPropertyValue.
const decl = (o) => Object.assign(Object.keys(o), { getPropertyValue: (k) => o[k] ?? '' });
const style = (sel, props = {}) => ({ selectorText: sel, cssText: `${sel} { x }`, style: decl(props) });

test('pseudo-classes and elements are stripped before matching', () => {
  const seen = [];
  run([style('a:hover::before'), style('.btn:not(.x):focus-visible'), style(':hover'), style('ul > li:first-child + :hover')], { present: (s) => { seen.push(s); return true; } });
  assert.deepEqual(seen, ['a', '.btn', '*', 'ul > li +*']);
});

test('keeps a rule when any comma-separated selector matches, drops it when none do', () => {
  const r = run([style('.gone, a:hover'), style('.nope'), style('[data-x="a,b"]')], { present: (s) => s === 'a' });
  assert.equal(r.rulesTotal, 3);
  assert.equal(r.rulesKept, 1);
  assert.equal(r.states.length, 1);
});

test('conservative: a selector the engine rejects is kept', () => {
  const r = run([style('weird::selector')], { present: () => { throw new SyntaxError('bad'); } });
  assert.equal(r.rulesKept, 1);
});

test('media blocks count only kept rules; custom properties and states are collected', () => {
  const media = { type: 4, media: { mediaText: '(max-width: 640px)' }, cssRules: [style('.nav:hover'), style('.nope')] };
  const r = run([style(':root', { '--brand': ' oklch(0.5 0.1 200) ' }), media], { present: (s) => s !== '.nope' });
  assert.deepEqual(r.breakpoints, { '@media (max-width: 640px)': 1 });
  assert.equal(r.vars['--brand'], 'oklch(0.5 0.1 200)');
  assert.equal(r.states[0].media, '@media (max-width: 640px)');
});

test('font-face and keyframes are kept only when used', () => {
  const face = (family) => ({ type: 5, cssText: `@font-face{${family}}`, style: decl({ 'font-family': family, 'font-weight': '700' }) });
  const kf = (name) => ({ type: 7, name, cssText: `@keyframes ${name}{}` });
  const r = run([face('"Inter"'), face('Unused'), kf('spin'), kf('dead'), style('.s', { animation: 'spin 1s linear' })], { present: () => true });
  assert.deepEqual(r.fontFaces.map((f) => f.family), ['Inter']);
  assert.deepEqual(r.keyframes.map((k) => k.name), ['spin']);
});

test('deadline stops the scan, flags it and skips the use filter (keeps everything unsure)', () => {
  const face = { type: 5, cssText: '@font-face{x}', style: decl({ 'font-family': 'Unused' }) };
  const r = run([style('a'), face, style('b'), style('c')], { present: () => true, now: () => 1000, inPageMs: 2500 });
  assert.equal(r.timedOut, true);
  assert.ok(r.rulesTotal < 4);
});

test('unreadable (cross-origin) sheets are counted, not fatal', () => {
  const bad = { get cssRules() { throw new DOMException('blocked', 'SecurityError'); } };
  const document = { documentElement: {}, body: {}, styleSheets: [bad], querySelector: () => ({}) };
  const r = new Function('document', 'getComputedStyle', `return ${PRUNE_SCRIPT()}`)(document, () => ({ fontFamily: '' }));
  assert.equal(r.skippedSheets, 1);
});

test('formatReport caps lists and total size', () => {
  const raw = {
    bytesBefore: 9000, bytesAfter: 3000, rulesTotal: 50, rulesKept: 20, timedOut: true, skippedSheets: 2,
    states: Array.from({ length: 80 }, (_, i) => ({ media: null, css: `.a${i}:hover { color: red; ${'x'.repeat(400)} }` })),
    breakpoints: { '@media (min-width: 1px)': 3 }, vars: { '--a': 'v'.repeat(200) }, fontFaces: [], keyframes: [{ name: 'k' }],
  };
  const out = formatReport(raw);
  assert.ok(out.interaction_rules.length <= 30);
  assert.ok(JSON.stringify(out).length <= 7000);
  assert.equal(out.custom_properties['--a'].length, 80);
  assert.equal(out.notes.length, 3);
});
