import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evalExpr, shared, MIXED, sidesOf, shorthandOf, sizeMode, sizeCss, parentInfo, BOARD_PARENT,
  gridCell, gridPatch, alignDeltas, distributeDeltas, flowAlign, parseStroke, parseShadow, shadowCss, splitShadows, rotationOf, stepFactor, px,
} from '../web/src/lib/inspect.ts';
import { parseOklch, formatOklch } from '../web/src/lib/color.ts';

test('expressions: arithmetic, precedence, parentheses, px suffix, rejects junk', () => {
  assert.equal(evalExpr('16*2'), 32);
  assert.equal(evalExpr('8+4/2'), 10);
  assert.equal(evalExpr('(8+4)/2px'), 6);
  assert.equal(evalExpr('-3 + 10'), 7);
  assert.equal(evalExpr('12'), 12);
  assert.equal(evalExpr('2*'), null);
  assert.equal(evalExpr('alert(1)'), null);
  assert.equal(evalExpr(''), null);
  assert.equal(evalExpr('1/0'), null);
});

test('step factor: shift x10, alt /10', () => {
  assert.equal(stepFactor({}), 1);
  assert.equal(stepFactor({ shiftKey: true }), 10);
  assert.equal(stepFactor({ altKey: true }), 0.1);
});

test('shared values report MIXED only when they differ', () => {
  assert.equal(shared(['4px', '4px']), '4px');
  assert.equal(shared(['4px', '8px']), MIXED);
  assert.equal(shared([]), '');
});

test('shorthand round trip for padding / radius', () => {
  assert.deepEqual(sidesOf('8px 16px'), ['8px', '16px', '8px', '16px']);
  assert.equal(shorthandOf(['8px', '16px', '8px', '16px']), '8px 16px');
  assert.equal(shorthandOf(['4px', '4px', '4px', '4px']), '4px');
  assert.equal(shorthandOf(['1px', '2px', '3px', '4px']), '1px 2px 3px 4px');
  assert.deepEqual(sidesOf('var(--a, 1px) 2px'), ['var(--a, 1px)', '2px', 'var(--a, 1px)', '2px']);
  assert.equal(px('12px'), 12);
  assert.equal(px('var(--x)'), null);
});

const row = parentInfo({ display: 'flex' });
const col = parentInfo({ display: 'flex', 'flex-direction': 'column', 'align-items': 'center' });
const block = parentInfo({ display: 'block' });

test('size mode derives from own style and parent layout', () => {
  assert.equal(sizeMode('width', { width: '120px' }, row), 'fixed');
  assert.equal(sizeMode('width', {}, row), 'hug');
  assert.equal(sizeMode('width', { flex: '1 1 0' }, row), 'fill');
  assert.equal(sizeMode('height', {}, row), 'fill'); // cross axis stretches by default
  assert.equal(sizeMode('width', {}, col), 'hug'); // parent centres, so no stretch
  assert.equal(sizeMode('width', { 'align-self': 'stretch' }, col), 'fill');
  assert.equal(sizeMode('width', {}, block), 'fill');
  assert.equal(sizeMode('height', {}, block), 'hug');
  assert.equal(sizeMode('width', { width: '100%' }, block), 'fill');
  assert.equal(sizeMode('width', { width: 'fit-content' }, block), 'hug');
  assert.equal(sizeMode('width', { position: 'absolute' }, row), 'hug');
  assert.equal(sizeMode('height', {}, BOARD_PARENT), 'hug'); // board root is a column: main axis hugs
  assert.equal(sizeMode('width', {}, BOARD_PARENT), 'fill');
});

test('size css round-trips through sizeMode for every parent kind', () => {
  for (const [p, name] of [[row, 'row'], [col, 'col'], [block, 'block'], [BOARD_PARENT, 'board']]) {
    for (const axis of ['width', 'height']) {
      for (const mode of ['fixed', 'hug', 'fill']) {
        const own = {};
        const patch = sizeCss(axis, mode, own, p, 120);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) delete own[k];
          else own[k] = v;
        }
        assert.equal(sizeMode(axis, own, p), mode, `${name} ${axis} ${mode}: ${JSON.stringify(own)}`);
      }
    }
  }
});

test('fixed keeps the measured size and stops flexing', () => {
  const patch = sizeCss('width', 'fixed', { flex: '1 1 0' }, row, 87.456);
  assert.equal(patch.width, '87.46px');
  assert.equal(patch.flex, null);
});

test('3x3 grid: row, column and reverse directions', () => {
  assert.deepEqual(gridCell({ 'justify-content': 'center', 'align-items': 'flex-end' }), { col: 1, row: 2 });
  assert.deepEqual(gridCell({ 'flex-direction': 'column', 'justify-content': 'flex-end', 'align-items': 'flex-start' }), { col: 0, row: 2 });
  assert.deepEqual(gridCell({ 'flex-direction': 'row-reverse', 'justify-content': 'flex-start', 'align-items': 'center' }), { col: 2, row: 1 });
  assert.equal(gridCell({ 'align-items': 'stretch' }), null);
  assert.equal(gridCell({}), null);
  assert.deepEqual(gridPatch({ col: 2, row: 0 }, {}), { 'align-items': 'flex-start', 'justify-content': 'flex-end' });
  assert.deepEqual(gridPatch({ col: 2, row: 0 }, { 'flex-direction': 'column' }), { 'align-items': 'flex-end', 'justify-content': 'flex-start' });
  // space-between keeps the main axis
  assert.deepEqual(gridPatch({ col: 1, row: 1 }, { 'justify-content': 'space-between' }), { 'align-items': 'center' });
  // clicking a cell and reading it back is the identity
  for (const dir of ['row', 'column', 'row-reverse', 'column-reverse']) {
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 3; r++) {
        const s = { 'flex-direction': dir, ...gridPatch({ col: c, row: r }, { 'flex-direction': dir }) };
        assert.deepEqual(gridCell(s), { col: c, row: r }, dir);
      }
    }
  }
});

test('align deltas to a container, and even distribution', () => {
  const boxes = [{ x: 10, y: 0, w: 20, h: 10 }, { x: 50, y: 30, w: 40, h: 10 }];
  const c = { x: 0, y: 0, w: 100, h: 100 };
  assert.deepEqual(alignDeltas(boxes, 'left', c).map((d) => d.dx), [-10, -50]);
  assert.deepEqual(alignDeltas(boxes, 'right', c).map((d) => d.dx), [70, 10]);
  assert.deepEqual(alignDeltas(boxes, 'hcenter', c).map((d) => d.dx), [30, -20]);
  assert.deepEqual(alignDeltas(boxes, 'bottom', c).map((d) => d.dy), [90, 60]);
  const three = [{ x: 0, y: 0, w: 10, h: 10 }, { x: 15, y: 0, w: 10, h: 10 }, { x: 90, y: 0, w: 10, h: 10 }];
  const d = distributeDeltas(three, 'x');
  assert.equal(three[1].x + d[1].dx, 45); // gap = (100-30)/2 = 35, so the middle box starts at 10 + 35
  assert.equal(distributeDeltas(three.slice(0, 2), 'x')[0].dx, 0);
});

test('flow align maps to align-self or justify-content by axis', () => {
  assert.deepEqual(flowAlign('left', row), { target: 'parent', prop: 'justify-content', value: 'flex-start' });
  assert.deepEqual(flowAlign('vcenter', row), { target: 'self', prop: 'align-self', value: 'center' });
  assert.deepEqual(flowAlign('right', col), { target: 'self', prop: 'align-self', value: 'flex-end' });
  assert.deepEqual(flowAlign('bottom', col), { target: 'parent', prop: 'justify-content', value: 'flex-end' });
  assert.equal(flowAlign('left', block), null);
});

test('stroke, shadow and rotation parsing', () => {
  assert.deepEqual(parseStroke('1px solid oklch(0.5 0.1 200)'), { width: '1px', style: 'solid', color: 'oklch(0.5 0.1 200)' });
  assert.deepEqual(parseStroke('dashed 2px red'), { width: '2px', style: 'dashed', color: 'red' });
  const s = parseShadow('inset 0 2px 8px oklch(0 0 0 / 0.2)');
  assert.equal(s.inset, true);
  assert.equal(s.y, '2px');
  assert.equal(s.color, 'oklch(0 0 0 / 0.2)');
  assert.equal(shadowCss(parseShadow('0px 4px 12px 0px oklch(0 0 0 / 0.1)')), '0px 4px 12px 0px oklch(0 0 0 / 0.1)');
  assert.equal(splitShadows('0 1px 2px oklch(0 0 0 / 0.1), 0 4px 8px oklch(0 0 0 / 0.2)').length, 2);
  assert.equal(rotationOf('15deg'), 15);
  assert.equal(rotationOf(''), 0);
  assert.equal(rotationOf('0.1turn'), null);
});

test('oklch parts round trip', () => {
  assert.deepEqual(parseOklch('oklch(0.7 0.1 250 / 0.5)'), { l: 0.7, c: 0.1, h: 250, a: 0.5 });
  assert.deepEqual(parseOklch('oklch(70% 0.1 250)'), { l: 0.7, c: 0.1, h: 250, a: 1 });
  assert.equal(parseOklch('#fff'), null);
  assert.equal(formatOklch({ l: 0.7, c: 0.1, h: 250, a: 1 }), 'oklch(0.7 0.1 250)');
  assert.equal(formatOklch({ l: 0.7, c: 0.1, h: 250, a: 0.5 }), 'oklch(0.7 0.1 250 / 0.5)');
});
