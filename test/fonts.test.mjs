import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'node-html-parser';
import { FontCache, parseCss, cssUrl, validateRequest, fontStack, familiesOf, isKnownFamily, usedProjectFonts, productionUrl } from '../src/fonts.mjs';
import { lintArtboard } from '../src/lint.mjs';
import { artboardToReact } from '../src/export.mjs';

// What Google's css2 endpoint returns: one block per unicode subset, commented with the subset name.
const GOOGLE_CSS = `
/* cyrillic */
@font-face { font-family: 'DM Sans'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/dmsans/cyr.woff2) format('woff2'); unicode-range: U+0301; }
/* latin */
@font-face { font-family: 'DM Sans'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/dmsans/lat400.woff2) format('woff2'); unicode-range: U+0000-00FF; }
/* latin */
@font-face { font-family: 'DM Sans'; font-style: normal; font-weight: 700; src: url(https://fonts.gstatic.com/s/dmsans/lat700.woff2) format('woff2'); unicode-range: U+0000-00FF; }
`;
const WOFF2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(32)]);

// Fake fetch that records the URLs it was asked for.
function fakeFetch(calls, { css = GOOGLE_CSS, status = 200, body = WOFF2 } = {}) {
  return async (url) => {
    calls.push(String(url));
    if (String(url).includes('fonts.googleapis.com')) return { ok: status === 200, status, text: async () => css };
    return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) };
  };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dc-fonts-'));

test('family names and weights are validated before any URL is built', () => {
  assert.equal(validateRequest(' DM   Sans ', [700, 400]).family, 'DM Sans');
  assert.deepEqual(validateRequest('Inter', [700, 400, 400]).weights, [400, 700]);
  for (const bad of ['', 'a/b', 'Inter&display=x', '../etc', 'Inter;', '1Inter', 'a'.repeat(80)]) assert.throws(() => validateRequest(bad), /valid font family/);
  assert.throws(() => validateRequest('Inter', [450]), /weights/);
  assert.throws(() => validateRequest('Inter', []), /weights/);
});

test('cssUrl asks for sorted axis tuples on the Google host only', () => {
  const u = cssUrl('DM Sans', [400, 700], true);
  assert.equal(u, 'https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,700;1,400;1,700&display=swap');
});

test('parseCss keeps only the latin subset and rejects foreign hosts', () => {
  const faces = parseCss(GOOGLE_CSS);
  assert.deepEqual(faces.map((f) => [f.weight, f.style]), [[400, 'normal'], [700, 'normal']]);
  const evil = GOOGLE_CSS.replaceAll('fonts.gstatic.com', 'evil.example.com');
  assert.throws(() => parseCss(evil), /Unexpected font host/);
});

test('ensure downloads once, then works offline from the cache', async () => {
  const dir = tmp();
  const calls = [];
  const cache = new FontCache(dir, fakeFetch(calls));
  const font = await cache.ensure('DM Sans', [400, 700]);
  assert.equal(font.slug, 'dm-sans');
  assert.deepEqual(font.faces.map((f) => f.file), ['normal-400.woff2', 'normal-700.woff2']);
  assert.ok(fs.existsSync(path.join(dir, 'dm-sans', 'normal-400.woff2')));
  const first = calls.length;
  // Second call: nothing missing, so no request at all (a throwing fetch proves it).
  const offline = new FontCache(dir, async () => { throw new Error('offline'); });
  assert.equal((await offline.ensure('DM Sans', [400])).faces.length, 1);
  assert.ok(first > 0);
});

test('ensure reports failures instead of falling back silently', async () => {
  const dir = tmp();
  await assert.rejects(new FontCache(dir, fakeFetch([], { status: 400 })).ensure('Nope Sans', [400]), /no "Nope Sans"/);
  await assert.rejects(new FontCache(dir, async () => { throw new Error('ENOTFOUND'); }).ensure('DM Sans', [400]), /Could not reach Google Fonts/);
  // A response that is not a woff2 is rejected and leaves nothing cached.
  await assert.rejects(new FontCache(dir, fakeFetch([], { body: Buffer.from('<html>captive portal</html>') })).ensure('DM Sans', [400]), /not a valid woff2/);
  assert.equal(new FontCache(dir).have('DM Sans').length, 0);
});

test('file() only serves strict names inside the cache', async () => {
  const dir = tmp();
  const cache = new FontCache(dir, fakeFetch([]));
  await cache.ensure('DM Sans', [400]);
  assert.ok(cache.file('dm-sans', 'normal-400.woff2'));
  for (const [s, n] of [['..', 'normal-400.woff2'], ['dm-sans', '../x.woff2'], ['dm-sans', 'normal-450.woff2'], ['dm sans', 'normal-400.woff2']]) {
    assert.equal(cache.file(s, n), null, `${s}/${n}`);
  }
});

test('font stacks and family helpers', () => {
  assert.equal(fontStack('Fraunces'), '"Fraunces", serif');
  assert.equal(fontStack('Inter'), '"Inter", sans-serif');
  assert.equal(fontStack('Whatever', 'mono'), '"Whatever", monospace');
  assert.deepEqual(familiesOf(`"DM Sans", 'Inter', sans-serif`), ['DM Sans', 'Inter', 'sans-serif']);
  assert.ok(isKnownFamily('Segoe UI') && isKnownFamily('system-ui') && isKnownFamily('Georgia'));
  assert.ok(!isKnownFamily('Inter'));
  assert.ok(isKnownFamily('inter', [{ family: 'Inter' }]));
});

test('lint flags a family that is neither system nor loaded, once per run', () => {
  const html = '<div data-pid="N1" style="font-family: Inter, sans-serif"><p data-pid="N2" style="font-family: Inter, sans-serif">Hi</p><p data-pid="N3" style="font-family: system-ui">Ok</p></div>';
  const root = parse(html);
  const ab = { width: 400, height: 300 };
  const issues = lintArtboard(ab, root, { fonts: [] }).filter((i) => i.includes('font "'));
  assert.equal(issues.length, 1);
  assert.match(issues[0], /use_font/);
  assert.equal(lintArtboard(ab, parse(html), { fonts: [{ family: 'Inter' }] }).filter((i) => i.includes('font "')).length, 0);
  // No font list passed (bare call): the check is off.
  assert.equal(lintArtboard(ab, parse(html)).filter((i) => i.includes('font "')).length, 0);
});

test('export lists the Google families a board uses', () => {
  const font = { family: 'DM Sans', slug: 'dm-sans', faces: [{ weight: 400, style: 'normal', file: 'normal-400.woff2' }, { weight: 700, style: 'normal', file: 'normal-700.woff2' }] };
  const html = `<div style="font-family: 'DM Sans', sans-serif">x</div><p style="color: red">y</p>`;
  assert.deepEqual(usedProjectFonts(html, [font]), [font]);
  assert.deepEqual(usedProjectFonts('<p style="color: red">DM Sans</p>', [font]), []);
  const url = productionUrl(font);
  assert.match(url, /family=DM\+Sans:ital,wght@0,400;0,700/);
  const jsx = artboardToReact({ name: 'Home', width: 100, height: 100, html }, undefined, [url]);
  assert.match(jsx, /Google Fonts used/);
  assert.match(jsx, /fonts\.googleapis\.com/);
  assert.ok(!artboardToReact({ name: 'Home', width: 100, height: 100, html }).includes('Google Fonts used'));
});
