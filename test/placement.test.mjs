import test from 'node:test';
import assert from 'node:assert/strict';
import { freeSpot, pushBelow } from '../src/placement.mjs';
import { Doc } from '../src/doc.mjs';

const box = (x, y, width = 400, height = 300) => ({ x, y, width, height });

test('no x: goes after the last board of the row at y, or at 0 in an empty row', () => {
  const boards = [box(0, 0), box(520, 0), box(0, 1000)];
  assert.deepEqual(freeSpot(boards, { y: 0, width: 400, height: 300 }), { x: 1040, y: 0 });
  assert.deepEqual(freeSpot(boards, { y: 1000, width: 400, height: 300 }), { x: 520, y: 1000 });
  assert.deepEqual(freeSpot(boards, { y: 3000, width: 400, height: 300 }), { x: 0, y: 3000 });
});

test('an asked spot that covers a board slides right along the row, past every clash', () => {
  const boards = [box(0, 0), box(520, 0)];
  assert.deepEqual(freeSpot(boards, { x: 100, y: 50, width: 400, height: 300 }), { x: 1040, y: 50 });
  assert.deepEqual(freeSpot(boards, { x: 2000, y: 0, width: 400, height: 300 }), { x: 2000, y: 0 }, 'a free spot is kept');
});

test('a growing board pushes the column below it down, cascading', () => {
  const top = box(0, 0, 400, 300);
  const mid = box(0, 420);
  const low = box(0, 840);
  const beside = box(520, 420);
  const boards = [top, mid, low, beside];
  top.height = 600;
  const moved = pushBelow(boards, top, 300);
  assert.equal(mid.y, 720);
  assert.equal(low.y, 1140);
  assert.equal(beside.y, 420, 'other columns stay');
  assert.deepEqual(moved, [mid, low]);
});

test('Doc: explicit overlapping x is moved and reported, growth pushes boards below', () => {
  const doc = new Doc(null);
  const a = doc.createArtboard({ width: 400, height: 300, heightMode: 'fit' });
  const b = doc.createArtboard({ width: 400, height: 300, x: 0, y: 0 });
  assert.equal(b.x, 520);
  assert.deepEqual(b.placed, { asked: { x: 0, y: 0 } });
  assert.ok(!Object.keys(b).includes('placed'), 'placed never reaches doc.json');
  const c = doc.createArtboard({ width: 400, height: 300, y: 420 });
  assert.equal(c.x, 0);
  doc.growArtboard(a.id, 500);
  assert.equal(c.y, 620);
});
