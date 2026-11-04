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
test('workflow tells the agent to call get_guide and start together', () => {
  assert.match(TOPICS.start, /get_guide, and in the same turn start\(/);
});

test('guide points at reply_comment with resolve instead of two calls', () => {
  assert.match(TOPICS.start, /reply_comment with resolve: true/);
});

// The brand topic may only name tools that exist, and keeps its quality bar and agency order.
test('brand topic names real tools and keeps the agency order', async () => {
  const { readFileSync } = await import('node:fs');
  const mcp = readFileSync(new URL('../src/mcp.mjs', import.meta.url), 'utf8');
  for (const tool of ['set_tokens', 'components', 'insert_component', 'references', 'capture_url', 'export', 'pages', 'memory', 'use_font', 'more_tools']) {
    assert.ok(mcp.includes(`'${tool}'`), `${tool} is not a registered tool`);
    assert.ok(TOPICS.brand.includes(tool), `brand topic should mention ${tool}`);
  }
  for (const step of ['0 Strategy', '1 Mood', '3f Misuse', '6 Guidelines']) assert.ok(TOPICS.brand.includes(step), step);
  assert.match(TOPICS.brand, /Never use an icon from the assets tool as the mark/);
});

// The taste doctrine must stay in the guide: scene-derived colour, named cliches, hero checkpoint.
test('guide carries the colour method, cliche list and hero checkpoint', () => {
  assert.match(TOPICS.brief, /derive EVERY colour/);
  assert.match(TOPICS.brief, /AI-look cliches/);
  assert.match(TOPICS.brief, /ONE reference/);
  assert.match(TOPICS.review, /FIRST section/);
});
