import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActions, formatKeys, shortcutRows, TOOL_DEFS, GESTURES } from '../web/src/lib/actions.ts';

// A ctx whose callbacks record their name, so a test can prove an action runs the right one.
const calls = [];
const rec = (name) => (...a) => { calls.push([name, ...a]); };
const ctx = (over = {}) => ({
  pages: [{ id: 'pg1', name: 'Landing' }],
  boards: [{ id: 'A1', name: 'Home' }, { id: 'A2', name: 'Home' }],
  has: { selection: () => false, layers: () => false, oneLayer: () => false, paste: () => false },
  do: new Proxy({}, { get: (_t, k) => rec(String(k)) }),
  ...over,
});

test('ids are unique and every action has a label and a group', () => {
  const list = buildActions(ctx());
  assert.equal(new Set(list.map((a) => a.id)).size, list.length);
  for (const a of list) { assert.ok(a.label, a.id); assert.ok(a.group, a.id); }
});

test('boards with the same name stay separate actions', () => {
  const ids = buildActions(ctx()).filter((a) => a.group === 'Boards').map((a) => a.id);
  assert.deepEqual(ids, ['board.A1', 'board.A2']);
});

test('tool keys are unique single letters and every tool has an action', () => {
  assert.equal(new Set(TOOL_DEFS.map((t) => t.key)).size, TOOL_DEFS.length);
  const list = buildActions(ctx());
  for (const t of TOOL_DEFS) assert.ok(list.find((a) => a.id === `tool.${t.id}`)?.keys?.[0] === t.key.toLowerCase(), t.id);
});

test('no shortcut is claimed by two actions', () => {
  const seen = new Map();
  for (const a of buildActions(ctx())) for (const k of a.keys ?? []) { assert.ok(!seen.has(k), `${k}: ${a.id} and ${seen.get(k)}`); seen.set(k, a.id); }
});

test('enabled follows the selection state', () => {
  const off = Object.fromEntries(buildActions(ctx()).map((a) => [a.id, a.enabled ? a.enabled() : true]));
  assert.equal(off['edit.delete'], false);
  assert.equal(off['edit.undo'], true);
  const on = buildActions(ctx({ has: { selection: () => true, layers: () => true, oneLayer: () => true, paste: () => true } }));
  assert.ok(on.filter((a) => a.enabled).every((a) => a.enabled()));
});

test('run calls the matching callback with the right argument', () => {
  calls.length = 0;
  const list = buildActions(ctx());
  list.find((a) => a.id === 'tool.pen').run();
  list.find((a) => a.id === 'edit.pasteInPlace').run();
  list.find((a) => a.id === 'page.pg1').run();
  assert.deepEqual(calls, [['tool', 'pen'], ['paste', true], ['page', 'pg1']]);
});

test('formatKeys is platform aware', () => {
  assert.equal(formatKeys('mod+shift+e', false), 'Ctrl+Shift+E');
  assert.equal(formatKeys('mod+shift+e', true), '⌘⇧E');
  assert.equal(formatKeys('delete', false), 'Delete');
  assert.equal(formatKeys('?', false), '?');
});

test('shortcut rows list aliases and skip groups without keys', () => {
  const rows = shortcutRows(buildActions(ctx()), false);
  const structure = rows.find((g) => g.title === 'Structure');
  assert.ok(structure.rows.some(([k, d]) => d === 'Ungroup' && k === 'Ctrl+Shift+G or Ctrl+Alt+G'));
  assert.ok(!rows.some((g) => g.title === 'Boards' || g.title === 'Panels'));
  assert.ok(GESTURES.every((g) => g.rows.length));
});
