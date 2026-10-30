import test from 'node:test';
import assert from 'node:assert/strict';
import { Doc } from '../src/doc.mjs';

test('a project without pages has an implicit first page and boards carry no field', () => {
  const doc = new Doc(null);
  const a = doc.createArtboard({ name: 'A' });
  assert.deepEqual(doc.pages, [{ id: 'P1', name: 'Page 1' }]);
  assert.equal(a.page, undefined);
  assert.equal(doc.pageOf(a), 'P1');
  assert.equal(doc.data.pages, undefined); // nothing stored until a page is added
});

test('adding a page stamps existing boards and new boards remember their page', () => {
  const doc = new Doc(null);
  const a = doc.createArtboard({ name: 'A' });
  const p2 = doc.createPage('Mobile');
  assert.equal(p2.id, 'P2');
  assert.equal(a.page, 'P1');
  const b = doc.createArtboard({ name: 'B', page: 'P2' });
  assert.equal(b.page, 'P2');
  assert.equal(b.x, 0); // placed from the start of ITS page, not after A
  assert.deepEqual(doc.basicInfo().artboards.map((x) => x.page), ['P1', 'P2']);
});

test('unknown pages are reported with the available ones', () => {
  const doc = new Doc(null);
  assert.throws(() => doc.createArtboard({ page: 'P9' }), /Page P9 not found \(pages: P1 "Page 1"\)/);
  assert.equal(doc.undoStack.length, 0); // the failed call left no undo entry
});

test('boards move between pages and a duplicate stays on its page', () => {
  const doc = new Doc(null);
  const a = doc.createArtboard({ name: 'A' });
  doc.createPage('Two');
  doc.moveToPage([a.id], 'P2');
  assert.equal(doc.pageOf(a), 'P2');
  const [copyId] = doc.duplicateNodes([a.id]);
  assert.equal(doc.pageOf(doc.getArtboard(copyId)), 'P2');
  assert.throws(() => doc.moveToPage(['A99'], 'P2'), /not found/);
});

test('deleting a page with moveTo moves its boards instead of deleting them', () => {
  const doc = new Doc(null);
  const a = doc.createArtboard({ name: 'A' });
  doc.createPage('Two');
  doc.createPage('Three');
  doc.moveToPage([a.id], 'P2');
  assert.deepEqual(doc.deletePage('P2', 'P3'), { moved: 1, deleted: 0 });
  assert.equal(doc.pageOf(a), 'P3');
  assert.equal(doc.data.artboards.length, 1);
  doc.deletePage('P3', 'P1');
  assert.throws(() => doc.deletePage('P1'), /at least one page/);
  assert.equal(doc.pageOf(a), 'P1');
});

test('deleting a page without moveTo deletes its boards in one undo step', () => {
  const doc = new Doc(null);
  const a = doc.createArtboard({ name: 'A' });
  doc.createPage('Two');
  const b = doc.createArtboard({ name: 'B', page: 'P2' });
  doc.createArtboard({ name: 'C', page: 'P2' });
  const steps = doc.undoStack.length;
  assert.deepEqual(doc.deletePage('P2'), { moved: 0, deleted: 2 });
  assert.equal(doc.undoStack.length, steps + 1);
  assert.deepEqual(doc.pages.map((p) => p.id), ['P1']);
  assert.deepEqual(doc.data.artboards.map((x) => x.id), [a.id]);
  doc.undo();
  assert.equal(doc.pages.length, 2);
  assert.equal(doc.pageOf(doc.getArtboard(b.id)), 'P2');
  assert.throws(() => new Doc(null).deletePage('P1'), /at least one page/); // implicit lone page
});

test('deleting the first page promotes the next and keeps boards moved to it', () => {
  const doc = new Doc(null);
  const a = doc.createArtboard({ name: 'A' });
  doc.createPage('Two');
  doc.deletePage('P1', 'P2');
  assert.deepEqual(doc.pages.map((p) => p.id), ['P2']);
  assert.equal(doc.pageOf(a), 'P2');
});

test('page background is validated and clearable; page edits are undoable', () => {
  const doc = new Doc(null);
  doc.updatePage('P1', { background: 'oklch(0.2 0 0)', name: 'Main' });
  assert.equal(doc.pages[0].background, 'oklch(0.2 0 0)');
  assert.throws(() => doc.updatePage('P1', { background: 'red; x' }), /Invalid/);
  doc.updatePage('P1', { background: '' });
  assert.equal(doc.pages[0].background, undefined);
  doc.undo();
  assert.equal(doc.pages[0].background, 'oklch(0.2 0 0)');
  doc.undo(2);
  assert.equal(doc.data.pages, undefined);
});
