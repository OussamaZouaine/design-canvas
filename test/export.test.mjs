import test from 'node:test';
import assert from 'node:assert/strict';
import { Doc } from '../src/doc.mjs';
import { artboardToReact, componentName, styleToClasses } from '../src/export.mjs';

test('styles become one arbitrary-property class each', () => {
  assert.deepEqual(styleToClasses('display: flex; padding: 4px 8px; font-family: a_b'), [
    '[display:flex]', '[padding:4px_8px]', '[font-family:a\\_b]',
  ]);
});

test('component names are PascalCase and never start with a digit', () => {
  assert.equal(componentName('Board screen · empty'), 'BoardScreenEmpty');
  assert.equal(componentName('404 page'), 'Artboard404Page');
});

test('artboard becomes JSX without canvas bookkeeping', () => {
  const doc = new Doc(null);
  const ab = doc.createArtboard({ name: 'Home', width: 800, height: 400 });
  doc.writeHtml(ab.id, '<div data-name="Hero" style="gap: 8px"><h1>Hi {there}</h1><img src="a.png" alt="x"><svg stroke-width="2"><path d="M0 0"></path></svg></div>');
  const jsx = artboardToReact(doc.getArtboard(ab.id));
  assert.match(jsx, /export function Home\(\)/);
  assert.match(jsx, /<div className="\[gap:8px\]">/);
  assert.match(jsx, /Hi \{'\{'\}there\{'\}'\}/); // braces would otherwise start a JSX expression
  assert.match(jsx, /<img src="a.png" alt="x" \/>/);
  assert.match(jsx, /strokeWidth="2"/);
  assert.doesNotMatch(jsx, /data-pid|data-name/);
});

test('theme tokens are declared on the React wrapper', () => {
  const doc = new Doc(null);
  const ab = doc.createArtboard({ name: 'Home', width: 100, height: 50 });
  doc.writeHtml(ab.id, '<p style="color: var(--color-fg)">x</p>');
  const jsx = artboardToReact(doc.getArtboard(ab.id), { tokens: { 'color-fg': 'oklch(0.2 0 0)', 'space-2': '8px' }, modes: {} });
  assert.match(jsx, /\[--color-fg:oklch\(0\.2_0_0\)\]/);
  assert.match(jsx, /\[--space-2:8px\]/);
});
