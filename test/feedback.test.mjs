import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampStatus, pendingFeedback, formatFeedback, markDelivered, MAX_ITEMS, MAX_TEXT, REMIND_MS, STATUS_MAX } from '../src/feedback.mjs';

const c = (id, over = {}) => ({ id, targetId: 'N1', artboardId: 'A1', text: 'make it bigger', author: 'user', resolved: false, replies: [], ...over });

test('clampStatus: one line, capped, empty -> null', () => {
  assert.equal(clampStatus('  Building\n the   hero '), 'Building the hero');
  assert.equal(clampStatus('x'.repeat(200)).length, STATUS_MAX);
  assert.equal(clampStatus('   '), null);
  assert.equal(clampStatus(null), null);
});

test('pendingFeedback: only new, open, user comments', () => {
  const d = new Map();
  const list = [c('c_1'), c('c_2', { author: 'claude' }), c('c_3', { resolved: true })];
  assert.deepEqual(pendingFeedback(list, d).map((x) => x.id), ['c_1']);
  d.set('c_1', 1000);
  assert.deepEqual(pendingFeedback(list, d, 2000), []); // shown once
});

test('pendingFeedback: resurfaces on a newer user reply or after the reminder gap', () => {
  const d = new Map([['c_1', 1000]]);
  const replied = c('c_1', { replies: [{ author: 'user', createdAt: 1500 }] });
  assert.equal(pendingFeedback([replied], d, 2000).length, 1);
  const agentReply = c('c_1', { replies: [{ author: 'claude', createdAt: 1500 }] });
  assert.equal(pendingFeedback([agentReply], d, 2000).length, 0);
  assert.equal(pendingFeedback([c('c_1')], d, 1000 + REMIND_MS).length, 1);
});

test('formatFeedback: null when empty, capped list and text, overflow counted', () => {
  assert.equal(formatFeedback([]), null);
  const many = Array.from({ length: MAX_ITEMS + 2 }, (_, i) => c('c_' + i, { text: 'y'.repeat(MAX_TEXT * 2) }));
  const out = formatFeedback(many, () => 'Hero');
  assert.match(out, /^HUMAN FEEDBACK \(5 new comments\)/);
  assert.equal(out.split('\n').filter((l) => l.startsWith('- ')).length, MAX_ITEMS);
  assert.ok(out.includes('(Hero)') && out.includes('+2 more'));
  assert.ok(out.split('\n')[1].length < MAX_TEXT + 40);
});

test('markDelivered: only the listed comments, so overflow comes next call', () => {
  const d = new Map();
  const many = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => c('c_' + i));
  markDelivered(d, many, 5);
  assert.equal(d.size, MAX_ITEMS);
  assert.deepEqual(pendingFeedback(many, d, 6).map((x) => x.id), ['c_' + MAX_ITEMS]);
});
