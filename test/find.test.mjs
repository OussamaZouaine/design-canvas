import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'node-html-parser';
import { Doc } from '../src/doc.mjs';
import { findNodes } from '../src/find.mjs';
import { nodeToReact } from '../src/export.mjs';

function setup() {
  const doc = new Doc(null);
  const ab = doc.createArtboard({ name: 'Home', width: 800, height: 400 });
  doc.writeHtml(ab.id, '<div data-name="Hero" style="display: flex; gap: 8px"><h1>Welcome back</h1><button style="border-radius: 8px">Save</button><button>Cancel</button></div>');
  return { doc, ab };
}

test('find by own text names the node that holds it, not its ancestors', () => {
  const { doc } = setup();
  const r = findNodes(doc, { query: 'welcome' });
  assert.equal(r.total, 1);
  assert.equal(r.nodes[0].tag, 'h1');
  assert.equal(r.nodes[0].text, 'Welcome back');
});

test('filters combine: tag + style, name, limit', () => {
  const { doc } = setup();
  assert.equal(findNodes(doc, { tag: 'button' }).total, 2);
  assert.equal(findNodes(doc, { tag: 'button', style: 'border-radius' }).nodes[0].text, 'Save');
  assert.equal(findNodes(doc, { name: 'hero' }).nodes[0].tag, 'div');
  const r = findNodes(doc, { tag: 'button', limit: 1 });
  assert.deepEqual([r.total, r.shown], [2, 1]);
});

test('needs a filter, and an unknown artboard is an error', () => {
  const { doc } = setup();
  assert.throws(() => findNodes(doc, {}), /at least one/);
  assert.throws(() => findNodes(doc, { tag: 'p', artboard_id: 'nope' }), /not found/);
});

test('nodeToReact renders one subtree as a component', () => {
  const { doc } = setup();
  const id = findNodes(doc, { tag: 'button', style: 'border-radius' }).nodes[0].id;
  const info = doc.nodeInfo(id);
  const jsx = nodeToReact(parse(info.html).firstChild, info.name || info.tag, doc.theme);
  assert.match(jsx, /export function Button\(\)/);
  assert.match(jsx, /<button className="\[border-radius:8px\]">/);
  assert.doesNotMatch(jsx, /data-pid|Cancel/);
});
