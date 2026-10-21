import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Doc } from '../src/doc.mjs';
import { BOARD_CSS, boardRoot, boardRootStyle } from '../src/contract.mjs';
import { applyGrowth, describeReport, formatReports, overflows } from '../src/layout.mjs';

const report = (over = {}) => ({ id: 'A1', width: 400, height: 600, fit: false, contentWidth: 400, contentHeight: 600, outside: [], clipped: [], ...over });

test('the server contract strings equal the web ones (drift = screenshots that lie)', () => {
  const ts = fs.readFileSync(new URL('../web/src/canvas/contract.ts', import.meta.url), 'utf8');
  assert.ok(ts.includes(`'${BOARD_CSS}'`), 'BOARD_CSS differs between contract.ts and contract.mjs');
  assert.ok(ts.includes(boardRootStyle(true).replace('min-height:100%', '')), 'root style prefix differs');
  assert.ok(ts.includes("fit ? 'min-height:100%' : 'height:100%'"), 'fit/fixed rule differs');
  assert.match(boardRoot(false, 'x'), /data-board-root="" style=/, 'attribute must be XML-safe (value present) for the SVG snapshot');
});

test('new boards store heightMode only when fit', () => {
  const doc = new Doc(null);
  assert.equal(doc.createArtboard({ name: 'old' }).heightMode, undefined);
  assert.equal(doc.createArtboard({ name: 'new', heightMode: 'fit' }).heightMode, 'fit');
});

test('growArtboard only grows fit boards, never shrinks, and caps', () => {
  const doc = new Doc(null);
  const fit = doc.createArtboard({ height: 500, heightMode: 'fit' });
  const fixed = doc.createArtboard({ height: 500 });
  assert.equal(doc.growArtboard(fit.id, 800.2), true);
  assert.equal(fit.height, 801);
  assert.equal(doc.growArtboard(fit.id, 300), false, 'no shrinking');
  assert.equal(doc.growArtboard(fixed.id, 900), false, 'fixed boards keep their height');
  doc.growArtboard(fit.id, 10 ** 6);
  assert.equal(fit.height, 20000);
});

test('fitArtboard sets the mode and may shrink to the content', () => {
  const doc = new Doc(null);
  const ab = doc.createArtboard({ height: 900 });
  doc.fitArtboard(ab.id, 420);
  assert.deepEqual([ab.heightMode, ab.height], ['fit', 420]);
  doc.fitArtboard(ab.id, 10, 200);
  assert.equal(ab.height, 200, 'min_height wins over a tiny measurement');
  doc.fitArtboard(ab.id, null);
  assert.equal(ab.height, 200, 'no measurement: only the mode changes');
});

test('a manual resize to a new height turns auto-grow off', () => {
  const doc = new Doc(null);
  const ab = doc.createArtboard({ height: 500, heightMode: 'fit' });
  doc.resizeArtboard(ab.id, ab.width + 20, ab.height); // width only
  assert.equal(ab.heightMode, 'fit');
  doc.resizeArtboard(ab.id, ab.width, 700);
  assert.equal(ab.heightMode, undefined);
});

test('overflow detection covers tall, wide, outside and clipped content', () => {
  assert.equal(overflows(report()), false);
  assert.equal(overflows(report({ contentHeight: 1184 })), true);
  assert.equal(overflows(report({ contentWidth: 500 })), true);
  assert.equal(overflows(report({ outside: [{ id: 'N1', right: 450, bottom: 10 }] })), true);
  assert.equal(overflows(report({ clipped: [{ id: 'N2' }] })), true);
  assert.equal(overflows(report({ contentHeight: 600.5 })), false, 'sub-pixel rounding is not overflow');
});

test('the message names the board, sizes, nodes and the fix', () => {
  const line = describeReport(report({ contentHeight: 1184, outside: [{ id: 'N12', name: 'Hero', right: 480, bottom: 9 }] }), 'Home');
  assert.match(line, /A1 "Home"/);
  assert.match(line, /1184px tall but the board is fixed at 600px/);
  assert.match(line, /fit_artboard/);
  assert.match(line, /N12 "Hero"/);
});

test('fit boards grow and the message says so instead of asking for a fix', () => {
  const doc = new Doc(null);
  const ab = doc.createArtboard({ height: 600, heightMode: 'fit' });
  const reports = [report({ id: ab.id, fit: true, contentHeight: 1184 })];
  const grown = applyGrowth(doc, reports);
  assert.deepEqual(grown, [ab.id]);
  const msg = formatReports(reports, doc, grown);
  assert.match(msg, /grew to fit/);
  assert.doesNotMatch(msg, /clips the rest/);
  assert.equal(formatReports([report()], doc), 'ok: everything fits inside its frame');
});
