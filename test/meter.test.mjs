import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, Meter } from '../src/meter.mjs';

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

test('images cost one token per 28x28 patch', () => {
  // The plan quotes 828 tokens for a 1000x625 image.
  assert.equal(estimateTokens({ content: [{ type: 'image', mimeType: 'image/png', data: fakePng(1000, 625) }] }), 828);
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
