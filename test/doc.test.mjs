// Run with `pnpm test` (node's built-in test runner, no extra dependencies).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Doc } from '../src/doc.mjs';

// A doc with one artboard holding one named card; returns handles to both.
function setup() {
  const doc = new Doc(null);
  const ab = doc.createArtboard({ name: 'Test' });
  const [card] = doc.writeHtml(ab.id, '<div data-name="card" style="color: red"><p>hi</p></div>');
  return { doc, ab, card };
}

test('write_html modes place the new node where asked', () => {
  const { doc, ab, card } = setup();
  doc.writeHtml(card, '<b>first</b>', 'prepend');
  doc.writeHtml(card, '<hr>', 'after');
  doc.writeHtml(card, '<i>before</i>', 'before');
  const html = doc.getArtboard(ab.id).html;
  assert.ok(html.indexOf('<i') < html.indexOf('data-name="card"'), 'before goes ahead of the card');
  assert.ok(html.indexOf('<hr') > html.indexOf('</div>'), 'after goes behind the card');
  assert.ok(html.indexOf('<b') < html.indexOf('<p'), 'prepend goes first inside the card');
});

test('before/after on an artboard is rejected', () => {
  const { doc, ab } = setup();
  assert.throws(() => doc.writeHtml(ab.id, '<p>x</p>', 'after'), /need a node id/);
});

test('x-clone copies a node with fresh ids', () => {
  const { doc, ab, card } = setup();
  const created = doc.writeHtml(ab.id, `<x-clone node-id="${card}"></x-clone>`);
  assert.equal(created.length, 1);
  assert.notEqual(created[0], card);
  assert.equal([...doc.getArtboard(ab.id).html.matchAll(/data-name="card"/g)].length, 2);
  assert.throws(() => doc.writeHtml(ab.id, '<x-clone node-id="N999"></x-clone>'), /not found/);
});

test('undo restores the previous state and never reuses ids', () => {
  const { doc, ab, card } = setup();
  const before = doc.getArtboard(ab.id).html;
  doc.updateStyles([card], { color: 'blue' });
  assert.deepEqual(doc.undo(), ['update_styles']);
  assert.equal(doc.getArtboard(ab.id).html, before);
  const [again] = doc.writeHtml(ab.id, '<p>new</p>');
  assert.notEqual(again, card);
});

test('locked nodes refuse edits', () => {
  const { doc, ab } = setup();
  const [locked] = doc.writeHtml(ab.id, '<section data-locked><i>x</i></section>');
  assert.throws(() => doc.updateStyles([locked], { color: 'red' }), /locked/);
  assert.throws(() => doc.deleteNodes([locked]), /locked/);
});

test('updateStyles keeps edits to two nodes in the same artboard', () => {
  const { doc, ab } = setup();
  const [a, b] = doc.writeHtml(ab.id, '<div>1</div><div>2</div>');
  doc.updateStyles([a, b], { color: 'blue' });
  assert.equal([...doc.getArtboard(ab.id).html.matchAll(/color: blue/g)].length, 2);
});

test('journal records changes by actor', () => {
  const { doc } = setup();
  doc.record('user', 'move', ['A1']);
  doc.record('claude', 'write_html', ['N1']);
  assert.equal(doc.changesSince(0, 'user').length, 1);
  assert.equal(doc.changesSince(doc.version).length, 0);
});

test('outline is one compact line per node and supports search', () => {
  const { doc, ab } = setup();
  doc.writeHtml(ab.id, '<div data-name="Hero" style="display:flex; flex-direction:column; gap:16px"><h1>Welcome back</h1><svg></svg></div>');
  const out = doc.outline(ab.id, { depth: 2 });
  assert.match(out, /artboard "Test"/);
  assert.match(out, /frame "Hero" col gap:16px/);
  assert.match(out, /text "Welcome back"/);
  assert.match(out, /svg/);
  assert.match(doc.outline(undefined, { query: 'welcome' }), /Welcome back/);
  assert.doesNotMatch(doc.outline(undefined, { query: 'welcome' }), /Hero/);
});

test('outline marks locked nodes and counts hidden children', () => {
  const { doc, ab } = setup();
  doc.writeHtml(ab.id, '<div data-locked><p>a</p><p>b</p></div>');
  const out = doc.outline(ab.id, { depth: 1 });
  assert.match(out, /locked \[2\]/);
});
