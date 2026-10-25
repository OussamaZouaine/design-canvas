// Selection maths lives in the web client (web/src/canvas/selection.ts) but has no DOM, so the root runner imports it directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickInChain, pickDeep, enterTarget, toggleId, normalize, unionBox, intersects, siblingStep, rangeIds, soleDescent } from '../web/src/canvas/selection.ts';

// board A1 > N1 (card) > N2 (row) > N3 (title)
const chain = ['N3', 'N2', 'N1'];
const parents = { N1: 'A1', N2: 'N1', N3: 'N2', N4: 'N1', A1: null };
const parentOf = (id) => parents[id] ?? null;

test('plain click picks the top-level node at board level', () => {
  assert.equal(pickInChain(chain, null, []), 'N1');
});

test('inside a context a click picks the child on the way to the hit', () => {
  assert.equal(pickInChain(chain, 'N1', []), 'N2');
  assert.equal(pickInChain(chain, 'N2', []), 'N3');
  assert.equal(pickInChain(chain, 'N3', []), 'N3'); // the context itself: its own empty area
});

test('a click outside the context falls back to board level', () => {
  assert.equal(pickInChain(['X2', 'X1'], 'N1', []), 'X1');
});

test('an already selected node under the pointer stays the target', () => {
  assert.equal(pickInChain(chain, null, ['N2']), 'N2');
  assert.equal(pickInChain([], null, ['N2']), null);
});

test('ctrl pick is the deepest node, locked subtrees count as one unit', () => {
  assert.equal(pickDeep(chain, () => false), 'N3');
  assert.equal(pickDeep(chain, (id) => id === 'N2'), 'N2');
  assert.equal(pickDeep(chain, (id) => id === 'N2' || id === 'N1'), 'N1');
});

test('double-click enters the selected node toward the pointer', () => {
  assert.equal(enterTarget(chain, 'N1'), 'N2');
  assert.equal(enterTarget(chain, 'N3'), null); // deepest: caller falls through to text edit
  assert.equal(enterTarget(chain, null), null);
});

// board A1 > W (sole wrapper) > L (sole layer) > C1, C2 (cards) > T (title)
test('sole-child wrappers are skipped until a node has siblings or is the hit', () => {
  const sole = (id) => id === 'W' || id === 'L';
  const inCard = ['T', 'C1', 'L', 'W'];
  assert.equal(pickInChain(inCard, null, [], sole), 'C1');
  assert.equal(pickInChain(inCard, 'C1', [], sole), 'T');
  assert.equal(pickInChain(inCard, 'L', [], sole), 'C1');       // context = wrapper: its child as before
  assert.equal(pickInChain(['L', 'W'], null, [], sole), 'L');   // padding of the inner wrapper: it is the hit, stop
  assert.equal(pickInChain(['W'], null, [], sole), 'W');        // padding of the outer wrapper
  assert.equal(pickInChain(['X1', 'X0'], 'C1', [], () => false), 'X0');
});

test('sole wrappers inside a context are skipped too, and double-click enters past them', () => {
  const sole = (id) => id === 'W2';
  assert.equal(pickInChain(['T', 'W2', 'C1'], 'C1', [], sole), 'T');
  assert.equal(enterTarget(['T', 'W2', 'C1'], 'C1', sole), 'T');
  assert.equal(enterTarget(['T', 'W2', 'C1'], 'C1'), 'W2');
});

test('soleDescent finds the level a click works on', () => {
  const kids = { A1: ['W'], W: ['L'], L: ['C1', 'C2'], C1: ['T'], C2: [], T: [] };
  const childrenOf = (id) => kids[id] ?? [];
  assert.equal(soleDescent('A1', childrenOf), 'L');
  assert.equal(soleDescent('C1', childrenOf), 'C1'); // its only child is a leaf: stay
  assert.equal(soleDescent('L', childrenOf), 'L');
});

test('toggle adds and removes, newest is last (primary)', () => {
  assert.deepEqual(toggleId(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggleId(['a', 'b'], 'a'), ['b']);
});

test('normalize: the later entry wins between a node and its descendant', () => {
  assert.deepEqual(normalize(['N2', 'N1'], parentOf), ['N1']);   // parent added later swallows the child
  assert.deepEqual(normalize(['N1', 'N3'], parentOf), ['N3']);   // child added later replaces the parent
  assert.deepEqual(normalize(['N2', 'N4', 'N2'], parentOf), ['N4', 'N2']);
  assert.deepEqual(normalize(['A1', 'N3'], parentOf), ['N3']);   // board and its child
  assert.deepEqual(normalize(['N3', 'A1'], parentOf), ['A1']);
});

test('union box and intersection', () => {
  assert.deepEqual(unionBox([{ left: 0, top: 0, width: 10, height: 10 }, { left: 20, top: 5, width: 10, height: 30 }]), { left: 0, top: 0, width: 30, height: 35 });
  assert.equal(unionBox([]), null);
  const a = { left: 0, top: 0, width: 10, height: 10 };
  assert.ok(intersects(a, { left: 9, top: 9, width: 5, height: 5 }));
  assert.ok(!intersects(a, { left: 10, top: 0, width: 5, height: 5 })); // touching edges only
});

test('sibling step wraps around', () => {
  assert.equal(siblingStep(['a', 'b', 'c'], 'c', 1), 'a');
  assert.equal(siblingStep(['a', 'b', 'c'], 'a', -1), 'c');
  assert.equal(siblingStep(['a'], 'a', 1), null);
});

test('range between two rows is inclusive in either direction', () => {
  assert.deepEqual(rangeIds(['a', 'b', 'c', 'd'], 'b', 'd'), ['b', 'c', 'd']);
  assert.deepEqual(rangeIds(['a', 'b', 'c', 'd'], 'c', 'a'), ['a', 'b', 'c']);
  assert.deepEqual(rangeIds(['a'], 'zz', 'a'), ['a']);
});
