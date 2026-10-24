import test from 'node:test';
import assert from 'node:assert/strict';
import { guideText, TOPICS } from '../src/guide.mjs';

test('every topic is served and non-empty', () => {
  for (const k of Object.keys(TOPICS)) assert.ok(guideText(k).length > 200, k);
});

test('no topic argument returns the workflow', () => {
  assert.equal(guideText(), TOPICS.start);
});

test('unknown topic lists the valid ones instead of throwing', () => {
  const t = guideText('nope');
  for (const k of Object.keys(TOPICS)) assert.ok(t.includes(k));
});

// Project rule: colours are OKLCH. A hex colour in the guide would teach agents the wrong habit.
test('guide text contains no hex colours', () => {
  for (const [k, v] of Object.entries(TOPICS)) assert.doesNotMatch(v, /#[0-9a-fA-F]{6}\b/, k);
});

// The guide must not force get_guide into a serial turn of its own.
test('workflow tells the agent to call get_guide and list_projects together', () => {
  assert.match(TOPICS.start, /get_guide and list_projects together/);
});
