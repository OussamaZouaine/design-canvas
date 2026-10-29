// Store-only zip and raster PDF writers (web/src/lib/zip.ts, pdf.ts): pure, round-tripped by parsing the bytes back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeZip, crc32 } from '../web/src/lib/zip.ts';
import { makePdf } from '../web/src/lib/pdf.ts';

const enc = new TextEncoder();

test('crc32 matches the known check value', () => {
  assert.equal(crc32(enc.encode('123456789')), 0xcbf43926);
});

test('zip round-trips through its central directory', () => {
  const files = [{ name: 'a.png', data: enc.encode('hello') }, { name: 'dir/é.txt', data: new Uint8Array([1, 2, 3, 4]) }];
  const zip = makeZip(files);
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  assert.equal(v.getUint32(eocd, true), 0x06054b50);
  assert.equal(v.getUint16(eocd + 10, true), 2);
  let p = v.getUint32(eocd + 16, true);
  for (const f of files) {
    assert.equal(v.getUint32(p, true), 0x02014b50);
    const crc = v.getUint32(p + 16, true), size = v.getUint32(p + 24, true), nameLen = v.getUint16(p + 28, true), off = v.getUint32(p + 42, true);
    assert.equal(new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen)), f.name);
    assert.equal(crc, crc32(f.data));
    assert.equal(size, f.data.length);
    // The local header repeats the name, and the data follows it.
    assert.equal(v.getUint32(off, true), 0x04034b50);
    const start = off + 30 + v.getUint16(off + 26, true);
    assert.deepEqual([...zip.subarray(start, start + size)], [...f.data]);
    p += 46 + nameLen;
  }
});

test('pdf xref offsets point at their objects and pages are counted', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = makePdf([{ jpeg, width: 100, height: 50 }, { jpeg, width: 20, height: 20 }]);
  const text = new TextDecoder('latin1').decode(pdf);
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.match(text, /\/Count 2/);
  const xref = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.equal(text.slice(xref, xref + 4), 'xref');
  const entries = [...text.slice(xref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
  assert.equal(entries.length, 8); // catalog, tree, 2 x (page, content, image)
  entries.forEach((off, i) => assert.equal(text.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`));
});
