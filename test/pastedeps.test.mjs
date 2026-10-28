import test from 'node:test';
import assert from 'node:assert/strict';
import { collectDeps, planAdopt } from '../src/pastedeps.mjs';
import { Doc } from '../src/doc.mjs';

const src = {
  theme: { tokens: { 'color-primary': 'oklch(0.6 0.2 250)', 'color-bg': 'oklch(1 0 0)', 'shadow-card': '0 1px 2px var(--color-primary)', 'space-4': '16px' }, modes: { dark: { 'color-bg': 'oklch(0.2 0 0)' } } },
  components: { button: { variants: { primary: '<button>x</button>' } } },
  fonts: [{ family: 'Inter', faces: [] }, { family: 'Lora', faces: [] }],
};
const dst = { theme: { tokens: { 'space-4': '12px' }, modes: {} }, components: {}, fonts: [] };
const html = '<div style="background:var(--color-bg);box-shadow:var(--shadow-card);padding:var(--space-4);font-family:\'Inter\',sans-serif" data-component="button"></div>';

test('collectDeps finds var() names and component instances', () => {
  const d = collectDeps([html]);
  assert.deepEqual([...d.vars].sort(), ['color-bg', 'shadow-card', 'space-4']);
  assert.deepEqual([...d.components], ['button']);
});

test('planAdopt follows token references, adds only what is missing and never overwrites', () => {
  const plan = planAdopt([html], src, dst);
  assert.deepEqual(Object.keys(plan.tokens).sort(), ['color-bg', 'color-primary', 'shadow-card']); // space-4 exists; primary comes via shadow-card
  assert.equal(plan.tokens['space-4'], undefined);
  assert.deepEqual(plan.modeTokens, { dark: { 'color-bg': 'oklch(0.2 0 0)' } });
  assert.deepEqual(Object.keys(plan.masters), ['button']);
  assert.deepEqual(plan.fonts.map((f) => f.family), ['Inter']); // Lora is not used
  assert.match(plan.summary, /3 tokens, Inter, 1 component/);
});

test('planAdopt is empty when the target already has everything', () => {
  const full = { theme: src.theme, components: src.components, fonts: src.fonts };
  assert.equal(planAdopt([html], src, full).empty, true);
});

test('Doc.adopt writes the plan and one undo reverts the paste and the adoption', () => {
  const doc = new Doc(null);
  doc.createArtboard({ name: 'T', width: 100, height: 100 });
  const plan = planAdopt([html], src, { theme: doc.theme, components: doc.components, fonts: [] });
  doc.pasteBoards([{ html, name: 'In', x: 0, y: 0, width: 50, height: 50 }]);
  doc.adopt(plan);
  assert.equal(doc.theme.tokens['color-primary'], 'oklch(0.6 0.2 250)');
  assert.equal(doc.theme.modes.dark['color-bg'], 'oklch(0.2 0 0)');
  assert.ok(doc.components.button);
  doc.undo();
  assert.equal(doc.data.artboards.length, 1);
  assert.equal(doc.theme.tokens['color-primary'], undefined);
  assert.equal(doc.components.button, undefined);
});
