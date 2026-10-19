import test from 'node:test';
import assert from 'node:assert/strict';
import { Doc } from '../src/doc.mjs';

function setup() {
  const doc = new Doc(null);
  const ab = doc.createArtboard({ name: 'T' });
  const [a, b, c] = doc.writeHtml(ab.id, '<div data-name="A"><i>a</i></div><div data-name="B"><i>b</i></div><div data-name="C"></div>');
  return { doc, ab, a, b, c };
}
const names = (doc, ab) => [...doc.getArtboard(ab.id).html.matchAll(/data-name="(\w+)"/g)].map((m) => m[1]);

test('before / after reorder siblings and keep ids', () => {
  const { doc, ab, a, c } = setup();
  doc.moveNode(c, a, 'before');
  assert.deepEqual(names(doc, ab), ['C', 'A', 'B']);
  doc.moveNode(c, a, 'after');
  assert.deepEqual(names(doc, ab), ['A', 'C', 'B']);
  assert.match(doc.getArtboard(ab.id).html, new RegExp(`data-pid="${c}"`));
});

test('start / end reparent into a node or an artboard', () => {
  const { doc, ab, a, b } = setup();
  doc.moveNode(b, a, 'end');
  assert.match(doc.getArtboard(ab.id).html, /data-name="A"[^>]*><i[^>]*>a<\/i><div[^>]*data-name="B"/);
  doc.moveNode(b, ab.id, 'start');
  assert.deepEqual(names(doc, ab)[0], 'B');
});

test('a node can move to another artboard', () => {
  const { doc, ab, a } = setup();
  const other = doc.createArtboard({ name: 'Other' });
  doc.moveNode(a, other.id, 'end');
  assert.doesNotMatch(doc.getArtboard(ab.id).html, /data-name="A"/);
  assert.match(doc.getArtboard(other.id).html, /data-name="A"/);
});

test('cycles, self moves and locked targets are refused', () => {
  const { doc, ab, a } = setup();
  const [inner] = doc.writeHtml(a, '<p></p>');
  assert.throws(() => doc.moveNode(a, inner, 'end'), /own descendant/);
  assert.throws(() => doc.moveNode(a, a, 'end'), /itself/);
  assert.throws(() => doc.moveNode(a, ab.id, 'before'), /start or end/);
  doc.setFlags([a], { locked: true });
  assert.throws(() => doc.moveNode(inner, a, 'end'), /locked/);
});

test('hidden and locked flags toggle, and unlocking works on a locked node', () => {
  const { doc, ab, a } = setup();
  doc.setFlags([a], { hidden: true, locked: true });
  assert.match(doc.getArtboard(ab.id).html, /hidden/);
  assert.throws(() => doc.setFlags([a], { hidden: false }), /locked/);
  doc.setFlags([a], { locked: false });
  doc.setFlags([a], { hidden: false });
  assert.doesNotMatch(doc.getArtboard(ab.id).html, /hidden|data-locked/);
});

test('moves are undoable', () => {
  const { doc, ab, a, c } = setup();
  doc.moveNode(c, a, 'before');
  doc.undo();
  assert.deepEqual(names(doc, ab), ['A', 'B', 'C']);
});
