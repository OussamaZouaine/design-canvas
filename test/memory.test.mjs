import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEntry, addEntry, formatMemory, MAX_RULES, MAX_DECISIONS, RULE_CHARS, SHOWN_DECISIONS, BLOCK_CHARS } from '../src/memory.mjs';

const rule = (text, id = 'm_' + text) => makeEntry({ kind: 'rule', text }, id, 1);
const dec = (text, id, at = 1) => makeEntry({ kind: 'decision', text, agent: 'bot', targetId: 'A1' }, id, at);

test('makeEntry clips, collapses whitespace and validates', () => {
  const e = makeEntry({ kind: 'rule', text: '  one\n accent   colour ' + 'x'.repeat(500) }, 'm_1', 5);
  assert.equal(e.text.length, RULE_CHARS);
  assert.ok(!/\s{2}|\n/.test(e.text));
  assert.throws(() => makeEntry({ kind: 'rule', text: '   ' }, 'm_2'), /required/);
  assert.throws(() => makeEntry({ kind: 'nope', text: 'x' }, 'm_3'), /kind/);
});

test('targetId is kept only for decisions and only when it looks like an id', () => {
  assert.equal(dec('a', 'm_1').targetId, 'A1');
  assert.equal(makeEntry({ kind: 'decision', text: 'a', targetId: '<script>' }, 'm_2').targetId, undefined);
  assert.equal(makeEntry({ kind: 'rule', text: 'a', targetId: 'A1' }, 'm_3').targetId, undefined);
});

test('addEntry skips duplicates, refuses rules past the cap, drops oldest decisions', () => {
  let l = addEntry([], rule('Same'));
  assert.equal(addEntry(l, rule('same', 'm_other')).length, 1);
  l = [];
  for (let i = 0; i < MAX_RULES; i++) l = addEntry(l, rule('r' + i));
  assert.throws(() => addEntry(l, rule('one too many')), /At most/);
  let d = [];
  for (let i = 0; i < MAX_DECISIONS + 3; i++) d = addEntry(d, dec('d' + i, 'm_d' + i, i));
  assert.equal(d.length, MAX_DECISIONS);
  assert.equal(d[0].text, 'd3');
});

test('formatMemory is null when empty, rules first, newest decisions first, capped', () => {
  assert.equal(formatMemory([]), null);
  let l = addEntry([], rule('use oklch only'));
  for (let i = 0; i < 8; i++) l = addEntry(l, dec('choice ' + i, 'm_d' + i, Date.UTC(2026, 9, 1 + i)));
  const s = formatMemory(l);
  assert.match(s, /^RULES \(follow these\):\n- use oklch only\nRECENT DECISIONS/);
  assert.ok(s.indexOf('choice 7') < s.indexOf('choice 6'));
  assert.ok(!s.includes('choice 2'));
  assert.equal((s.match(/\n- 2026/g) ?? []).length, SHOWN_DECISIONS);
  assert.match(s, /\(\+3 older/);
  const big = [];
  for (let i = 0; i < 12; i++) big.push(rule('y'.repeat(190), 'm_' + i));
  assert.ok(formatMemory(big).length <= BLOCK_CHARS);
});
