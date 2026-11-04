// src/webimages.mjs with a mocked fetch: licence filter, id validation, host allowlist, magic-number check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebImages, commercialSafe, splitId, cleanQuery, creditLine, fromOpenverse, fromCommons, OPENVERSE, COMMONS } from '../src/webimages.mjs';

const UUID = '3a2f6c1e-1b2d-4c3e-9f10-aabbccddeeff';
// Smallest buffer imageInfo accepts: a PNG signature + IHDR with a 4x3 size, padded to 24+ bytes.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]), Buffer.from([0, 0, 0, 4, 0, 0, 0, 3])]);

const ov = (over = {}) => ({ id: UUID, title: 'Linen <b>texture</b>', creator: 'Jane', license: 'by', license_version: '4.0', license_url: 'https://creativecommons.org/licenses/by/4.0/', foreign_landing_url: 'https://example.org/p', width: 800, height: 600, ...over });
const page = (over = {}) => ({ pageid: 42, index: 1, title: 'File:Oak.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/x/Oak.jpg', url: 'https://upload.wikimedia.org/o.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Oak.jpg', mime: 'image/jpeg', extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a href="x">Bob</a>' }, ObjectName: { value: 'Oak' } }, ...over }] });

function mock(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    for (const [match, body] of routes) {
      if (String(url).includes(match)) {
        if (Buffer.isBuffer(body)) return new Response(body, { status: 200 });
        return new Response(JSON.stringify(body), { status: 200 });
      }
    }
    return new Response('', { status: 404 });
  };
  return { fetchImpl, calls };
}

test('only commercial-safe licences pass', () => {
  for (const ok of ['CC0', 'Public domain', 'CC BY 4.0', 'CC BY-SA 3.0', 'cc by-sa 2.0']) assert.ok(commercialSafe(ok), ok);
  for (const no of ['CC BY-NC 4.0', 'CC BY-ND 2.0', 'CC BY-NC-SA 4.0', '', 'Copyrighted free use', undefined]) assert.ok(!commercialSafe(no), String(no));
});

test('ids and queries are validated', () => {
  assert.deepEqual(splitId(`openverse:${UUID}`), { source: 'openverse', ref: UUID });
  assert.deepEqual(splitId('commons:42'), { source: 'commons', ref: '42' });
  for (const bad of ['openverse:../x', 'commons:abc', 'http://evil.test/x.png', 'openverse:123', 'other:1']) assert.throws(() => splitId(bad), bad);
  assert.throws(() => cleanQuery('a&b=1'));
  assert.equal(cleanQuery(' linen texture '), 'linen texture');
});

test('openverse results are normalized and html is stripped', () => {
  const r = fromOpenverse(ov());
  assert.equal(r.id, `openverse:${UUID}`);
  assert.equal(r.title, 'Linen texture');
  assert.equal(r.license, 'CC BY 4.0');
  assert.equal(fromOpenverse(ov({ license: 'cc0', license_version: '1.0' })).license, 'CC0');
  assert.equal(fromOpenverse(ov({ license: 'pdm' })).license, 'Public domain');
  assert.equal(creditLine(r), '"Linen texture" by Jane, CC BY 4.0 (https://example.org/p)');
});

test('search asks only the allowed hosts and filters commons licences', async () => {
  const m = mock([
    [OPENVERSE, { results: [ov(), ov({ id: 'not-a-uuid' })] }],
    [COMMONS, { query: { pages: { a: page(), b: page({ extmetadata: { LicenseShortName: { value: 'CC BY-NC 4.0' } } }) } } }],
  ]);
  const w = new WebImages(m.fetchImpl);
  const a = await w.search('linen');
  assert.equal(a.length, 1); // the id that is not a uuid is dropped
  assert.match(m.calls[0], /license=cc0,pdm,by,by-sa/);
  const b = await w.search('oak', { source: 'commons' });
  assert.equal(b.length, 1);
  assert.equal(b[0].creator, 'Bob');
  assert.ok(m.calls.every((u) => u.startsWith(OPENVERSE) || u.startsWith(COMMONS)));
  await assert.rejects(() => w.search('x', { source: 'flickr' }));
});

test('download stores bytes only after the licence and magic-number checks', async () => {
  const m = mock([[`${UUID}/thumb/`, PNG], [`${UUID}/`, ov()]]);
  const { buffer, credit } = await new WebImages(m.fetchImpl).download(`openverse:${UUID}`);
  assert.ok(buffer.equals(PNG));
  assert.equal(credit.license, 'CC BY 4.0');
  assert.ok(!('_thumb' in credit));

  const nc = mock([[`${UUID}/`, ov({ license: 'by-nc' })]]);
  await assert.rejects(() => new WebImages(nc.fetchImpl).download(`openverse:${UUID}`), /not commercial-safe/);

  const junk = mock([[`${UUID}/thumb/`, Buffer.alloc(64, 1)], [`${UUID}/`, ov()]]);
  await assert.rejects(() => new WebImages(junk.fetchImpl).download(`openverse:${UUID}`), /not a PNG/);
});

test('commons image bytes must come from a wikimedia upload or thumb host', async () => {
  const evil = mock([[COMMONS, { query: { pages: { a: page({ thumburl: 'https://evil.test/a.jpg' }) } } }]]);
  await assert.rejects(() => new WebImages(evil.fetchImpl).download('commons:42'), /Unexpected image host/);
  assert.ok(evil.calls.every((u) => !u.includes('evil.test')));
  assert.equal(fromCommons({ pageid: 1 }), null);
});
