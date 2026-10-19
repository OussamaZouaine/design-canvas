import test from 'node:test';
import assert from 'node:assert/strict';
import { Doc } from '../src/doc.mjs';

test('foundations needs tokens, then renders swatches, type, spacing and a dark preview', () => {
  const doc = new Doc(null);
  assert.throws(() => doc.createFoundations(), /No tokens yet/);
  doc.setTokens({}, { preset: 'starter' });
  const ab = doc.createFoundations();
  assert.equal(ab.generated, 'foundations');
  assert.match(ab.html, /color-primary/);
  assert.match(ab.html, /Colour · dark/);
  assert.match(ab.html, /size-2xl/);
  assert.match(ab.html, /var\(--space-8\)/);
  assert.match(ab.html, /data-locked/);
  assert.ok(ab.height >= 400);
});

test('calling it again refreshes the same artboard instead of adding another', () => {
  const doc = new Doc(null);
  doc.setTokens({}, { preset: 'starter' });
  const a = doc.createFoundations();
  const b = doc.createFoundations();
  assert.equal(a.id, b.id);
  assert.equal(doc.data.artboards.length, 1);
});

test('token edits regenerate the foundations labels', () => {
  const doc = new Doc(null);
  doc.setTokens({}, { preset: 'starter' });
  const ab = doc.createFoundations();
  doc.setTokens({ 'color-primary': 'oklch(0.5 0.2 30)' });
  assert.match(ab.html, /oklch\(0\.5 0\.2 30\)/);
  doc.setTokens({ 'color-brand': 'oklch(0.6 0.1 90)' });
  assert.match(ab.html, /color-brand/);
});

test('the generated board is locked against hand edits but not against regeneration', () => {
  const doc = new Doc(null);
  doc.setTokens({}, { preset: 'starter' });
  const ab = doc.createFoundations();
  const root = ab.html.match(/data-pid="(N\d+)"/)[1];
  assert.throws(() => doc.updateStyles([root], { color: 'red' }), /locked/);
});

test('undo removes a freshly created foundations board', () => {
  const doc = new Doc(null);
  doc.setTokens({}, { preset: 'starter' });
  doc.createFoundations();
  doc.undo();
  assert.equal(doc.data.artboards.length, 0);
});
