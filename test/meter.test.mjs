import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, imageSize, Meter } from '../src/meter.mjs';

// A 1x1-pixel-header PNG we resize in the header: only bytes 16-23 (width, height) matter here.
function fakePng(w, h) {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b.toString('base64');
}

test('text costs about one token per four bytes', () => {
  assert.equal(estimateTokens({ content: [{ type: 'text', text: 'a'.repeat(400) }] }), 100);
});

// A hand-built JPEG header: SOI, an APP segment of appLen payload bytes (pushes the frame header
// past the first decoded window when large), then SOF0/SOF2 with the size. Nothing after it is needed.
function fakeJpeg(w, h, { appLen = 14, sof = 0xc0 } = {}) {
  const app = Buffer.alloc(4 + appLen);
  app.writeUInt16BE(0xffe0, 0);
  app.writeUInt16BE(2 + appLen, 2);
  const frame = Buffer.alloc(11);
  frame.writeUInt16BE(0xff00 | sof, 0);
  frame.writeUInt16BE(11, 2); // length, unused by the parser
  frame[4] = 8; // precision
  frame.writeUInt16BE(h, 5);
  frame.writeUInt16BE(w, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app, frame]).toString('base64');
}

test('images cost about width*height/750 tokens', () => {
  assert.equal(estimateTokens({ content: [{ type: 'image', mimeType: 'image/png', data: fakePng(1000, 625) }] }), 834);
  assert.equal(estimateTokens({ content: [{ type: 'image', mimeType: 'image/jpeg', data: fakeJpeg(1000, 2000) }] }), 2667);
});

test('jpeg size is read from SOF0 and SOF2, even behind a large APP segment', () => {
  assert.deepEqual(imageSize(fakeJpeg(800, 1600), 'image/jpeg'), { w: 800, h: 1600 });
  assert.deepEqual(imageSize(fakeJpeg(640, 480, { sof: 0xc2 }), 'image/jpeg'), { w: 640, h: 480 });
  // 60 KB of EXIF-like data: far beyond the first 4096 base64 chars, so the parser must decode more.
  assert.deepEqual(imageSize(fakeJpeg(321, 123, { appLen: 60000 }), 'image/jpeg'), { w: 321, h: 123 });
});

test('broken or truncated jpeg falls back to null', () => {
  assert.equal(imageSize(Buffer.from('not a jpeg').toString('base64'), 'image/jpeg'), null);
  assert.equal(imageSize(fakeJpeg(10, 10).slice(0, 8), 'image/jpeg'), null);
});

test('meter totals per tool and counts errors', () => {
  const m = new Meter();
  m.record('lint', { content: [{ type: 'text', text: 'x'.repeat(40) }] });
  m.record('lint', { isError: true, content: [{ type: 'text', text: 'boom' }] });
  const { tools, totalTokens } = m.snapshot();
  assert.equal(tools[0].calls, 2);
  assert.equal(tools[0].errors, 1);
  assert.equal(totalTokens, 11);
});
