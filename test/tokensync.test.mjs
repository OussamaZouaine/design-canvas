import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCustomProperties, classify, mapProperties, readInsideRepo, exportTokens } from '../src/tokensync.mjs';
import { Doc } from '../src/doc.mjs';

const CSS = `
/* brand */
:root {
  --brand: oklch(0.55 0.2 275);
  --color-fg: #111;
  --space-4: 16px;
  --radius-card: 12px;
  --font-body: Inter, sans-serif;
  --z-modal: 50;
  --text-lg: 18px;
}
.dark { --brand: oklch(0.72 0.15 275); }
`;

test('custom properties are read from :root or a chosen selector', () => {
  const root = parseCustomProperties(CSS);
  assert.equal(root['brand'], 'oklch(0.55 0.2 275)');
  assert.equal(root['z-modal'], '50');
  assert.deepEqual(parseCustomProperties(CSS, '.dark'), { brand: 'oklch(0.72 0.15 275)' });
});

test('names are classified by family, name and value', () => {
  assert.equal(classify('color-fg', '#111'), 'color-fg');
  assert.equal(classify('brand', 'oklch(0.5 0.2 270)'), 'color-brand');
  assert.equal(classify('radius-card', '12px'), 'radius-card');
  assert.equal(classify('font-body', 'Inter, sans-serif'), 'font-body');
  assert.equal(classify('text-lg', '18px'), 'size-lg');
  assert.equal(classify('z-modal', '50'), null);
});

test('mapProperties imports what it can and reports the rest', () => {
  const { tokens, skipped } = mapProperties(parseCustomProperties(CSS));
  assert.equal(tokens['color-brand'], 'oklch(0.55 0.2 275)');
  assert.equal(tokens['space-4'], '16px');
  assert.ok(!('z-modal' in tokens));
  assert.deepEqual(skipped, ['--z-modal: 50']);
});

test('files are only read from inside the linked repo', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-repo-'));
  fs.writeFileSync(path.join(repo, 'a.css'), ':root{--x:1}');
  assert.equal(readInsideRepo(repo, 'a.css'), ':root{--x:1}');
  assert.throws(() => readInsideRepo(repo, '../secret.txt'), /outside/);
  assert.throws(() => readInsideRepo(repo, path.resolve(os.tmpdir(), 'x')), /outside/);
  assert.throws(() => readInsideRepo(repo, 'missing.css'), /not found/);
  assert.throws(() => readInsideRepo(undefined, 'a.css'), /No repo linked/);
});

test('export writes css, tailwind and json', () => {
  const doc = new Doc(null);
  doc.setTokens({ 'color-bg': 'white', 'space-2': '8px' });
  doc.setTokens({ 'color-bg': 'black' }, { mode: 'dark' });
  const css = exportTokens(doc.theme, 'css');
  assert.match(css, /:root \{\n {2}--color-bg: white;/);
  assert.match(css, /\[data-theme="dark"\] \{\n {2}--color-bg: black;/);
  assert.match(exportTokens(doc.theme, 'tailwind'), /^@theme \{/);
  assert.equal(JSON.parse(exportTokens(doc.theme, 'json')).modes.dark['color-bg'], 'black');
  assert.throws(() => exportTokens(doc.theme, 'xml'), /format/);
});
