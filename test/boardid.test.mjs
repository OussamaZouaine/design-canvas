import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Doc } from '../src/doc.mjs';

// Rebuild scripts delete a board and recreate it by name: the id must survive so pinned comments stay attached.
test('a same-named board created after a delete gets the old id back', () => {
  const doc = new Doc(null);
  const a = doc.createArtboard({ name: 'Home' });
  doc.deleteNodes([a.id]);
  assert.equal(doc.createArtboard({ name: 'Home' }).id, a.id);
});

test('a different name gets a fresh id, and the claim is used once', () => {
  const doc = new Doc(null);
  const a = doc.createArtboard({ name: 'Home' });
  doc.deleteNodes([a.id]);
  assert.notEqual(doc.createArtboard({ name: 'Other' }).id, a.id);
  assert.equal(doc.createArtboard({ name: 'Home' }).id, a.id);
  assert.notEqual(doc.createArtboard({ name: 'Home' }).id, a.id);
});

// Element comments: the rebuilt board's nodes get new ids, so the doc reports old -> new pairs by tree position.
test('a rebuilt board reports old -> new node ids, also across several writes', () => {
  const doc = new Doc(null);
  const a = doc.createArtboard({ name: 'Home' });
  doc.writeHtml(a.id, '<div><h1>Hi</h1><button>Go</button></div>');
  const oldIds = [...doc.getArtboard(a.id).html.matchAll(/data-pid="(\w+)"/g)].map((m) => m[1]); // div, h1, button
  doc.deleteNodes([a.id]);
  const seen = new Map();
  doc.onRemap = (m) => m.forEach((v, k) => seen.set(k, v));
  const b = doc.createArtboard({ name: 'Home' });
  doc.writeHtml(b.id, '<div><h1>Hello</h1></div>'); // first write: only div + h1 exist yet
  assert.deepEqual([...seen.keys()], [oldIds[0], oldIds[1]]);
  doc.writeHtml(b.id, '<p>x</p>', 'append'); // different spot: the button's twin has not arrived
  assert.equal(seen.size, 2);
  const newIds = [...doc.getArtboard(b.id).html.matchAll(/data-pid="(\w+)"/g)].map((m) => m[1]);
  assert.equal(seen.get(oldIds[1]), newIds[1]);
  assert.ok(!oldIds.includes(newIds[0]));
});
