// The clipboard model lives in the web client (web/src/canvas/clipboard.ts) but has no DOM, so node:test imports it directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPayload, parsePayload, placeBoards, pasteTarget, MAX_CLIP_BYTES } from '../web/src/canvas/clipboard.ts';

const from = { project: 'p_aaaaaaaa', page: null };
const board = (x, y, w = 100, h = 100) => ({ html: '<div>x</div>', id: 'A1', x, y, width: w, height: h });

test('buildPayload drops empty items and returns null when nothing is left', () => {
  assert.equal(buildPayload('nodes', [{ html: '  ' }], from, false), null);
  const p = buildPayload('nodes', [{ html: '<p>a</p>' }, { html: '' }], from, true, 5);
  assert.equal(p.items.length, 1);
  assert.equal(p.cut, true);
  assert.equal(p.t, 5);
});

test('parsePayload round-trips and rejects junk', () => {
  const p = buildPayload('boards', [board(0, 0)], from, false);
  assert.deepEqual(parsePayload(JSON.stringify(p)), { ...p, items: [{ ...p.items[0], name: undefined, heightMode: undefined }] });
  assert.equal(parsePayload('not json'), null);
  assert.equal(parsePayload('{"v":2}'), null);
  assert.equal(parsePayload(JSON.stringify({ ...p, kind: 'other' })), null);
  assert.equal(parsePayload(JSON.stringify({ ...p, items: [] })), null);
  assert.equal(parsePayload(JSON.stringify({ ...p, from: {} })), null);
  assert.equal(parsePayload('x'.repeat(MAX_CLIP_BYTES + 1)), null);
});

test('parsePayload requires a size for boards but not for nodes', () => {
  const noSize = { v: 1, kind: 'boards', cut: false, from, items: [{ html: '<p/>' }] };
  assert.equal(parsePayload(noSize), null);
  assert.ok(parsePayload({ ...noSize, kind: 'nodes' }));
});

test('placeBoards keeps the spot when it is free', () => {
  const out = placeBoards([board(500, 40)], [{ x: 0, y: 0, width: 100, height: 100 }]);
  assert.deepEqual(out, [{ x: 500, y: 40 }]);
});

test('placeBoards moves right of the rightmost frame when the spot is taken, keeping the group layout', () => {
  const items = [board(0, 0), board(200, 50)];
  const existing = [{ x: 0, y: 0, width: 100, height: 100 }, { x: 200, y: 0, width: 300, height: 100 }];
  const out = placeBoards(items, existing);
  assert.deepEqual(out, [{ x: 620, y: 0 }, { x: 820, y: 50 }]);
});

test('placeBoards in place always keeps the spot', () => {
  assert.deepEqual(placeBoards([board(0, 0)], [{ x: 0, y: 0, width: 100, height: 100 }], true), [{ x: 0, y: 0 }]);
});

test('placeBoards on an empty page keeps the spot', () => {
  assert.deepEqual(placeBoards([board(30, 30)], []), [{ x: 30, y: 30 }]);
});

test('pasteTarget: boards and containers receive, leaves get a sibling, none falls back', () => {
  assert.deepEqual(pasteTarget({ id: 'A1', isBoard: true, hasChildren: false }, 'A2'), { target: 'A1', position: 'append' });
  assert.deepEqual(pasteTarget({ id: 'n1', isBoard: false, hasChildren: true }, null), { target: 'n1', position: 'append' });
  assert.deepEqual(pasteTarget({ id: 'n2', isBoard: false, hasChildren: false }, null), { target: 'n2', position: 'after' });
  assert.deepEqual(pasteTarget(null, 'A2'), { target: 'A2', position: 'append' });
  assert.equal(pasteTarget(null, null), null);
});
