// Pure parts of src/assets.mjs plus the cache with a mocked fetch: these tests never touch the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'node-html-parser';
import { AssetCache, checkName, cleanQuery, splitId, hexToOklch, normalizeColor, prepareSvg, formatResults, HOST } from '../src/assets.mjs';
import { sanitizeSvg } from '../src/svg.mjs';

const LUCIDE = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M5 12h14"/></svg>';
const SIMPLE = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path d="M12 0z"/></svg>';
const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" width="1.03em" height="1em" viewBox="0 0 256 250"><defs><linearGradient id="a"><stop stop-color="#fff"/></linearGradient></defs><path fill="#161614" d="M0 0z"/><path fill="url(#a)" d="M1 1z"/><image href="https://evil.test/x.png"/></svg>';

test('names and queries are validated', () => {
  assert.equal(checkName('icon name', ' Arrow-Right '), 'arrow-right');
  assert.throws(() => checkName('icon name', '../etc'));
  assert.throws(() => checkName('icon name', 'a/b'));
  assert.deepEqual(splitId('lucide:home'), { prefix: 'lucide', name: 'home' });
  assert.throws(() => splitId('lucide'));
  assert.throws(() => splitId('a:b:c'));
  assert.equal(cleanQuery('GitHub.com'), 'github');
  assert.equal(cleanQuery('https://www.stripe.com/pricing'), 'stripe');
  assert.equal(cleanQuery('arrow up'), 'arrow up');
  assert.throws(() => cleanQuery('a&b=1'));
  assert.throws(() => cleanQuery(''));
});

test('hex converts to oklch', () => {
  assert.equal(hexToOklch('#ffffff'), 'oklch(1 0 0)');
  assert.equal(hexToOklch('#000'), 'oklch(0 0 0)');
  const red = hexToOklch('#ff0000');
  assert.match(red, /^oklch\(0\.628 0\.258 29\.2\)$/);
  assert.match(hexToOklch('#ff000080'), / \/ 0\.5\)$/);
});

test('colour input is restricted to safe values', () => {
  assert.equal(normalizeColor('currentcolor'), 'currentColor');
  assert.equal(normalizeColor('oklch(0.6 0.2 30)'), 'oklch(0.6 0.2 30)');
  assert.equal(normalizeColor('var(--accent)'), 'var(--accent)');
  assert.match(normalizeColor('#336699'), /^oklch\(/);
  assert.equal(normalizeColor(undefined), null);
  assert.throws(() => normalizeColor('red" onload="x'));
  assert.throws(() => normalizeColor('url(http://x)'));
});

test('prepareSvg sizes, keeps currentColor and recolours', () => {
  const a = prepareSvg(LUCIDE, { prefix: 'lucide', name: 'minus', size: 20 });
  assert.match(a, /width="20" height="20"/);
  assert.match(a, /stroke="currentColor"/);
  assert.doesNotMatch(a, /1em/);
  const b = prepareSvg(LUCIDE, { prefix: 'lucide', name: 'minus', color: 'oklch(0.5 0.2 260)' });
  assert.match(b, /stroke="oklch\(0\.5 0\.2 260\)"/);
  assert.doesNotMatch(b, /currentColor/);
  // paintless mono path inherits the parent colour instead of rendering black
  assert.match(prepareSvg(SIMPLE, { prefix: 'simple-icons', name: 'x' }), /<svg [^>]*fill="currentColor"/);
});

test('prepareSvg handles brand logos: oklch, unique ids, no remote hrefs, aspect ratio', () => {
  const s = prepareSvg(LOGO, { prefix: 'logos', name: 'github-icon', size: 32 });
  assert.doesNotMatch(s, /="#[0-9a-f]{3,8}"/i); // no raw hex paint left
  assert.match(s, /fill="oklch\(/);
  assert.match(s, /stop-color="oklch\(1 0 0\)"/);
  assert.match(s, /id="logos-github-icon-a"/);
  assert.match(s, /url\(#logos-github-icon-a\)/);
  assert.doesNotMatch(s, /evil\.test/);
  assert.match(s, /width="32" height="31"/); // 256x250 keeps its ratio
  const tinted = prepareSvg(LOGO, { prefix: 'logos', name: 'github-icon', color: 'currentColor' });
  assert.doesNotMatch(tinted, /oklch/);
});

test('prepared markup survives sanitizeSvg unchanged in substance', () => {
  const root = parse(prepareSvg(LOGO, { prefix: 'logos', name: 'g' }));
  sanitizeSvg(root);
  const out = root.toString();
  assert.match(out, /<path/);
  assert.match(out, /linearGradient/);
});

test('formatResults caps inline markup', () => {
  const items = [1, 2, 3, 4, 5].map((i) => ({ id: `lucide:i${i}`, svg: 'x'.repeat(100), colour: i === 1 ? 'brand' : 'mono' }));
  const r = formatResults(items, { inline: 3 });
  assert.equal(r.filter((x) => x.svg).length, 3);
  assert.equal(r[0].colour, 'brand');
  const tight = formatResults(items, { inline: 5, budget: 250 });
  assert.equal(tight.filter((x) => x.svg).length, 2);
  assert.equal(tight.length, 5); // names are never dropped
});

// ---- cache with a mocked fetch ---------------------------------------------------------------

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dc-assets-'));
const ok = (body) => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from(body) });

test('search + svg are fetched once, then served from disk', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('/search')) return ok(JSON.stringify({ icons: ['lucide:home', 'lucide:house', '../bad:x'] }));
    return ok(LUCIDE);
  };
  const cache = new AssetCache(tmp(), fetchImpl);
  const r1 = await cache.searchIcons('home', { limit: 5 });
  assert.deepEqual(r1.map((x) => x.id), ['lucide:home', 'lucide:house']);
  assert.ok(r1[0].svg.startsWith('<svg'));
  assert.ok(calls.every((u) => u.startsWith(HOST + '/')));
  const n = calls.length;
  await cache.searchIcons('home');
  assert.equal(calls.length, n);
});

test('offline gives a one-line error, and a cached search still works', async () => {
  const dir = tmp();
  const down = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  await assert.rejects(new AssetCache(dir, down).searchIcons('home'), /Could not reach the Iconify API.*Offline/);
  const warm = new AssetCache(dir, async (u) => (u.includes('/search') ? ok('{"icons":["lucide:home"]}') : ok(LUCIDE)));
  await warm.searchIcons('home');
  const offline = await new AssetCache(dir, down).searchIcons('home');
  assert.equal(offline[0].id, 'lucide:home');
});

test('unknown icon and oversized responses are rejected', async () => {
  const missing = new AssetCache(tmp(), async () => ({ ok: false, status: 404 }));
  await assert.rejects(missing.getSvg('lucide', 'nope'), /No icon/);
  const huge = new AssetCache(tmp(), async () => ok('<svg>' + 'x'.repeat(200_000) + '</svg>'));
  await assert.rejects(huge.getSvg('lucide', 'big'), /larger than expected/);
  await assert.rejects(huge.getSvg('../x', 'big'), /not a valid/);
});
