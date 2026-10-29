// Saved export rows live in doc.data.exports (Doc.setExports): validated, undoable, pruned when a node disappears.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Doc } from '../src/doc.mjs';

const setup = () => {
  const doc = new Doc(null);
  const ab = doc.createArtboard({ name: 'A' });
  const [node] = doc.writeHtml(ab.id, '<div data-name="card">hi</div>');
  return { doc, ab, node };
};

test('rows are stored per id, cleaned, and nothing is stored when empty', () => {
  const { doc, ab, node } = setup();
  assert.deepEqual(doc.setExports(node, [{ scale: '2X', format: 'PNG' }, { scale: 'bad', format: 'png' }]), [{ scale: '2x', format: 'png' }]);
  assert.deepEqual(doc.exportSettings[node], [{ scale: '2x', format: 'png' }]);
  doc.setExports(ab.id, [{ scale: '1x', format: 'pdf' }]);
  assert.equal(Object.keys(doc.exportSettings).length, 2);
  doc.setExports(node, []);
  assert.deepEqual(Object.keys(doc.exportSettings), [ab.id]);
  doc.setExports(ab.id, []);
  assert.equal(doc.data.exports, undefined);
});

test('unknown ids are refused and undo restores the previous rows', () => {
  const { doc, node } = setup();
  assert.throws(() => doc.setExports('N999', [{ scale: '1x', format: 'png' }]), /not found/);
  doc.setExports(node, [{ scale: '1x', format: 'png' }]);
  doc.setExports(node, [{ scale: '3x', format: 'jpg' }]);
  doc.undo();
  assert.deepEqual(doc.exportSettings[node], [{ scale: '1x', format: 'png' }]);
  doc.undo();
  assert.deepEqual(doc.exportSettings, {});
});

test('rows of a deleted node are dropped on the next write', () => {
  const { doc, ab, node } = setup();
  doc.setExports(node, [{ scale: '1x', format: 'png' }]);
  doc.deleteNodes([node]);
  doc.setExports(ab.id, [{ scale: '1x', format: 'png' }]);
  assert.deepEqual(Object.keys(doc.exportSettings), [ab.id]);
});
