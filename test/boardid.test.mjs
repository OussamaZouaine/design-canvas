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
