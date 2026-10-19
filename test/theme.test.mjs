import test from 'node:test';
import assert from 'node:assert/strict';
import { Doc } from '../src/doc.mjs';
import { applyTokens, emptyTheme, resolveTokens, toCssDeclarations, describe } from '../src/theme.mjs';

test('tokens merge, override per mode and delete with null', () => {
  const t = emptyTheme();
  applyTokens(t, { 'color-bg': 'white', 'space-2': '8px' });
  applyTokens(t, { 'color-bg': 'black' }, 'dark');
  assert.deepEqual(resolveTokens(t, 'dark'), { 'color-bg': 'black', 'space-2': '8px' });
  assert.equal(resolveTokens(t)['color-bg'], 'white');
  applyTokens(t, { 'color-bg': null }, 'dark');
  assert.deepEqual(t.modes, {}); // an empty mode is dropped
});

test('names and values are validated', () => {
  const t = emptyTheme();
  assert.throws(() => applyTokens(t, { Primary: 'red' }), /lowercase/);
  assert.throws(() => applyTokens(t, { 'banana-1': 'red' }), /start the name/);
  assert.throws(() => applyTokens(t, { 'color-x': 'red; } body { display:none' }), /invalid value/);
  assert.throws(() => applyTokens(t, { 'color-x': 'url(http://evil)' }), /invalid value/);
  assert.throws(() => applyTokens(t, { 'color-x': '' }), /invalid value/);
});

test('css declarations and the compact description', () => {
  const t = applyTokens(emptyTheme(), { 'space-4': '16px', 'color-fg': 'black' });
  applyTokens(t, { 'color-fg': 'white' }, 'dark');
  assert.equal(toCssDeclarations(t.tokens), '--space-4: 16px; --color-fg: black');
  assert.equal(describe(t, 'color'), 'color-fg: black\ncolor-fg [dark]: white');
});

test('setTokens on a doc is atomic, undoable and can load the starter preset', () => {
  const doc = new Doc(null);
  assert.throws(() => doc.setTokens({ 'color-a': 'red', 'bad name': 'x' }));
  assert.equal(doc.data.theme, undefined); // nothing half-applied
  doc.setTokens({}, { preset: 'starter' });
  assert.ok(doc.theme.tokens['color-primary']);
  assert.ok(doc.theme.modes.dark);
  doc.setTokens({ 'color-primary': 'oklch(0.5 0.2 30)' });
  doc.undo();
  assert.notEqual(doc.theme.tokens['color-primary'], 'oklch(0.5 0.2 30)');
  doc.undo();
  assert.equal(doc.data.theme, undefined);
});
