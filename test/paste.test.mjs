// Doc side of the clipboard: pasting frames and layers, id keeping after a cut, and undo as one step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Doc } from '../src/doc.mjs';

const seed = () => {
  const doc = new Doc(null);
  const ab = doc.createArtboard({ name: 'Home', width: 400, height: 300 });
  doc.writeHtml(ab.id, '<div style="padding:8px"><p>Hello</p></div>');
  return { doc, ab };
};
const clipOf = (doc, id) => {
  const a = doc.getArtboard(id);
  return { id: a.id, html: a.html, name: a.name, x: a.x, y: a.y, width: a.width, height: a.height };
};

test('pasteBoards copies a frame with fresh ids and a copy suffix on a name clash', () => {
  const { doc, ab } = seed();
  const [id] = doc.pasteBoards([{ ...clipOf(doc, ab.id), x: 600 }]);
  assert.notEqual(id, ab.id);
  const copy = doc.getArtboard(id);
  assert.equal(copy.name, 'Home copy');
  assert.equal(copy.x, 600);
  assert.notEqual(copy.html, doc.getArtboard(ab.id).html); // new data-pid values
  assert.match(copy.html, /Hello/);
});

test('pasteBoards after a cut keeps the frame id and node ids', () => {
  const { doc, ab } = seed();
  const clip = clipOf(doc, ab.id);
  doc.deleteNodes([ab.id]);
  assert.ok(doc.canKeepIds([clip]));
  const [id] = doc.pasteBoards([clip], { keepIds: true });
  assert.equal(id, ab.id);
  assert.equal(doc.getArtboard(id).html, clip.html);
  assert.equal(doc.getArtboard(id).name, 'Home'); // no " copy" on a move
});

test('canKeepIds is false while the source still exists', () => {
  const { doc, ab } = seed();
  assert.equal(doc.canKeepIds([clipOf(doc, ab.id)]), false);
});

test('kept ids move the counter past them so later ids do not repeat', () => {
  const doc = new Doc(null);
  const other = new Doc(null);
  for (let i = 0; i < 6; i++) other.createArtboard({ name: `B${i}` });
  const b = other.createArtboard({ name: 'Far', width: 100, height: 100 });
  other.writeHtml(b.id, '<p>x</p>');
  const clip = clipOf(other, b.id);
  doc.pasteBoards([clip], { keepIds: true });
  const next = doc._newId('N');
  assert.ok(Number(next.slice(1)) > Number(clip.id.slice(1)));
});

test('pasteBoards is one undo step', () => {
  const { doc, ab } = seed();
  doc.pasteBoards([clipOf(doc, ab.id), { ...clipOf(doc, ab.id), x: 900 }]);
  assert.equal(doc.data.artboards.length, 3);
  doc.undo();
  assert.equal(doc.data.artboards.length, 1);
});

test('pasteNodes appends into a frame or goes after a node, stripping ids unless kept', () => {
  const { doc, ab } = seed();
  const html = '<span data-pid="N99">tag</span>';
  const [a] = doc.pasteNodes(ab.id, [{ html }], 'append', false);
  assert.notEqual(a, 'N99');
  const [b] = doc.pasteNodes(a, [{ html }], 'after', false);
  assert.ok(b && b !== a);
  const kept = doc.canKeepIds([{ html }]);
  assert.equal(kept, true);
  const [c] = doc.pasteNodes(ab.id, [{ html }], 'append', true);
  assert.equal(c, 'N99');
  assert.ok(Number(doc._newId('N').slice(1)) > 99);
});
