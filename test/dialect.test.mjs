import test from 'node:test';
import assert from 'node:assert/strict';
import { Doc } from '../src/doc.mjs';
import { dialectNote, dialectStylesNote } from '../src/dialect.mjs';

test('dialectNote counts margin, grid, inline and table, and is empty for clean flex markup', () => {
  assert.equal(dialectNote('<div style="display:flex; gap:8px; padding:16px"><p>ok</p></div>'), '');
  const note = dialectNote('<div style="margin:8px"></div><div style="margin-top:4px"></div><div style="display:grid"></div><table><tr><td>x</td></tr></table>');
  assert.match(note, /2x margin/);
  assert.match(note, /1x display:grid/);
  assert.match(note, /table/);
  // inline-flex is what inputs become, so it is allowed
  assert.equal(dialectNote('<div style="display:inline-flex"></div>'), '');
});

test('dialectStylesNote only looks at properties being set', () => {
  assert.match(dialectStylesNote({ marginTop: 8 }), /margin/);
  assert.equal(dialectStylesNote({ margin: null, padding: '8px' }), '');
});

function lint(html) {
  const doc = new Doc(null);
  const ab = doc.createArtboard({ name: 'T', width: 400 });
  doc.writeHtml(ab.id, html);
  return doc.lint(ab.id).join('\n');
}

test('lint flags margin, a full-board absolute overlay and a fixed-width row that overflows', () => {
  assert.match(lint('<div style="margin:8px">x</div>'), /margin is outside the layout dialect/);
  assert.match(lint('<div style="position:absolute; top:0; right:0; bottom:0; left:0"></div>'), /covers the whole artboard/);
  const row = '<div style="display:flex; width:200px; gap:8px"><div style="width:120px; flex-shrink:0"></div><div style="width:120px; flex-shrink:0"></div></div>';
  assert.match(lint(row), /wider than their row/);
  // shrinkable children are fine
  assert.doesNotMatch(lint('<div style="display:flex; width:200px"><div style="width:120px"></div><div style="width:120px"></div></div>'), /wider than their row/);
});

test('duplicate_nodes returns an id map for every descendant; parentOf names the parent', () => {
  const doc = new Doc(null);
  const ab = doc.createArtboard({ name: 'T', width: 400 });
  const [card] = doc.writeHtml(ab.id, '<div><p>a</p><p>b</p></div>');
  const kids = doc.outline(card, { depth: 2 });
  assert.ok(kids);
  const { created, idMap } = doc.duplicateNodes([card], { withMap: true });
  assert.equal(created.length, 1);
  assert.equal(idMap[card], created[0]);
  assert.equal(Object.keys(idMap).length, 3);
  assert.equal(doc.parentOf(created[0]), ab.id);
  assert.equal(doc.parentOf(Object.values(idMap)[1]), created[0]);
  // the default return shape is unchanged
  assert.ok(Array.isArray(doc.duplicateNodes([card])));
});
