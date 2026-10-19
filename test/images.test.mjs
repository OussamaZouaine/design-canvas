import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { imageInfo } from '../src/images.mjs';
import { ProjectStore } from '../src/store.mjs';

// Minimal headers: enough bytes for each format's size fields, which is all imageInfo reads.
const png = (w, h) => { const b = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const gif = (w, h) => { const b = Buffer.alloc(30); b.write('GIF89a'); b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8); return b; };
const jpeg = (w, h) => {
  const b = Buffer.alloc(40);
  b[0] = 0xff; b[1] = 0xd8;
  b[2] = 0xff; b[3] = 0xe0; b.writeUInt16BE(6, 4); // an APPn segment to walk past
  b[10] = 0xff; b[11] = 0xc0; b.writeUInt16BE(17, 12); b[14] = 8; b.writeUInt16BE(h, 15); b.writeUInt16BE(w, 17);
  return b;
};
const webpX = (w, h) => { const b = Buffer.alloc(40); b.write('RIFF'); b.write('WEBP', 8); b.write('VP8X', 12); b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); return b; };

test('image size and type come from the bytes', () => {
  assert.deepEqual(imageInfo(png(1440, 900)), { mime: 'image/png', width: 1440, height: 900 });
  assert.deepEqual(imageInfo(gif(64, 32)), { mime: 'image/gif', width: 64, height: 32 });
  assert.deepEqual(imageInfo(jpeg(800, 600)), { mime: 'image/jpeg', width: 800, height: 600 });
  assert.deepEqual(imageInfo(webpX(1200, 630)), { mime: 'image/webp', width: 1200, height: 630 });
});

test('non-images are rejected whatever they claim to be', () => {
  assert.equal(imageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(imageInfo(Buffer.alloc(100)), null);
  assert.equal(imageInfo(Buffer.from('short')), null);
});

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-store-'));
  const store = new ProjectStore(dir);
  return { store, id: store.create({ name: 'refs' }).id, dir };
}

test('a reference is stored, shown on a locked board and served back by id', () => {
  const { store, id, dir } = tempStore();
  const { ref, board } = store.addReference(id, { name: 'Landing', buffer: png(1000, 500) });
  assert.equal(ref.id, 'R1');
  assert.equal(board.generated, 'reference');
  assert.equal(board.width, 1000);
  assert.equal(board.height, 500);
  assert.match(board.html, new RegExp(`/api/p/${id}/ref/R1`));
  assert.match(board.html, /data-locked/);
  assert.ok(fs.existsSync(path.join(dir, 'projects', id, 'refs', 'R1.png')));
  assert.equal(store.refFile(id, 'R1').mime, 'image/png');
  assert.equal(store.refFile(id, '../R1'), null);
  assert.equal(store.refFile(id, 'R9'), null);
});

test('big images are scaled down on the board but keep their pixel size in the metadata', () => {
  const { store, id } = tempStore();
  const { ref, board } = store.addReference(id, { name: 'Wide', buffer: png(3200, 1600) });
  assert.equal(ref.width, 3200);
  assert.equal(board.width, 1600);
  assert.equal(board.height, 800);
});

test('bad uploads are refused with a clear message', () => {
  const { store, id } = tempStore();
  assert.throws(() => store.addReference(id, { name: 'x', buffer: Buffer.from('not an image at all, just text') }), /Not a PNG/);
  assert.throws(() => store.addReference(id, { name: 'x', buffer: Buffer.alloc(0) }), /Empty/);
});

test('deleting a reference removes its board and is undoable', () => {
  const { store, id } = tempStore();
  const doc = store.get(id).doc;
  store.addReference(id, { name: 'A', buffer: png(100, 100) });
  doc.deleteReference('R1');
  assert.equal(doc.data.artboards.length, 0);
  assert.equal(doc.references.length, 0);
  doc.undo();
  assert.equal(doc.data.artboards.length, 1);
  assert.equal(doc.references.length, 1);
});
