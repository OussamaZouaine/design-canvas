// Assets (doop steal-list phase e): real icons and brand logos instead of placeholder boxes. Same pattern as
// fonts.mjs: the SERVER talks to one fixed public host (the keyless Iconify API), keeps what it fetched on disk
// under data/assets/ and hands the agent ready-to-paste inline <svg>. Stock photos / image search are out of
// scope: they all need API keys.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// The ONLY host ever contacted. Query, set and icon names go into the URL, so each is validated first;
// there is no user-supplied URL anywhere, which is what keeps this SSRF-safe.
export const HOST = 'https://api.iconify.design';
export const DEFAULT_SET = 'lucide'; // clean 24px stroke UI set; tabler / phosphor / heroicons work via `set`
export const LOGO_SETS = ['simple-icons', 'logos']; // simple-icons = mono (takes currentColor), logos = full-colour
const PALETTE_SETS = new Set(['logos']); // sets whose artwork carries its own brand colours
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const QUERY_RE = /^[\p{L}\p{N} ._-]{1,40}$/u;
const MAX_SVG_BYTES = 100_000; // a single icon is 1-5 KB; this only stops a runaway response
const MAX_JSON_BYTES = 200_000;
const TIMEOUT_MS = 8000;
// Total inline markup returned by one search, so a result never floods the agent's context.
export const MAX_INLINE_BYTES = 12_000;

export function checkName(kind, v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (s.length > 60 || !NAME_RE.test(s)) throw new Error(`"${v}" is not a valid ${kind} (lowercase letters, digits and hyphens, e.g. "arrow-right").`);
  return s;
}

// A search term, or a domain like "github.com" / "https://www.stripe.com/pricing" reduced to its brand word.
export function cleanQuery(q) {
  let s = String(q ?? '').trim();
  const dom = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+)\.[a-z.]{2,}(?:[/?#].*)?$/i.exec(s);
  if (dom) s = dom[1];
  s = s.toLowerCase();
  if (!QUERY_RE.test(s)) throw new Error('query must be 1-40 characters: letters, digits, spaces, dots, hyphens.');
  return s;
}

// "lucide:arrow-right" -> { prefix, name }
export function splitId(id) {
  const [prefix, name, ...rest] = String(id ?? '').split(':');
  if (!name || rest.length) throw new Error(`"${id}" must look like "prefix:name", e.g. "lucide:arrow-right".`);
  return { prefix: checkName('icon set', prefix), name: checkName('icon name', name) };
}

// ---- colour: the project rule is OKLCH, but icon sets ship hex ---------------------------------

export function hexToOklch(hex) {
  let h = String(hex).replace(/^#/, '');
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  const a = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1;
  const lin = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; // sRGB gamma -> linear light
  });
  const [r, g, b] = lin;
  // linear sRGB -> LMS -> OKLab (Bjorn Ottosson's matrices)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  const H = C < 0.0004 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360; // grey: hue is meaningless
  const f = (n, d) => String(+n.toFixed(d));
  return `oklch(${f(L, 3)} ${f(C, 3)} ${f(H, 1)}${a < 1 ? ` / ${f(a, 2)}` : ''})`;
}

// Accepts only values that are safe inside an attribute: oklch(), hex (converted), currentColor, var(--x).
export function normalizeColor(c) {
  if (c == null || c === '') return null;
  const s = String(c).trim();
  if (/^currentcolor$/i.test(s)) return 'currentColor';
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return hexToOklch(s);
  if (/^oklch\(\s*[0-9.]+%?\s+[0-9.]+\s+[0-9.]+(?:deg)?(?:\s*\/\s*[0-9.]+%?)?\s*\)$/i.test(s)) return s;
  if (/^var\(--[a-z0-9-]+\)$/i.test(s)) return s;
  throw new Error('color must be oklch(L C H), a hex (converted to oklch), currentColor or var(--token).');
}

// ---- svg post-processing (pure) -----------------------------------------------------------------

const PAINT_ATTR_RE = /\b(fill|stroke|stop-color|flood-color|color)="(#[0-9a-f]{3,8})"/gi;

// Turns Iconify's raw file into markup for a board: fixed pixel size (it ships 1em), colours as oklch /
// currentColor, ids made unique (several logos on one page would otherwise share "a", "b" gradients) and
// the namespace/size noise trimmed. The result still goes through sanitizeSvg when it is written.
export function prepareSvg(raw, { prefix, name, color, size } = {}) {
  const m = /<svg\b([^>]*)>([\s\S]*)<\/svg>/i.exec(String(raw));
  if (!m) throw new Error(`${prefix}:${name} did not come back as an SVG.`);
  let [, attrs, inner] = m;
  const vb = /viewBox="([^"]+)"/i.exec(attrs)?.[1] ?? '0 0 24 24';
  const [, , vw, vh] = vb.split(/\s+/).map(Number);
  const px = Math.max(8, Math.min(512, Math.round(Number(size) || 24)));
  const w = vw >= vh ? px : Math.round((px * vw) / vh);
  const h = vw >= vh ? Math.round((px * vh) / vw) : px;
  const tint = normalizeColor(color);

  // Remote references can never survive: drop any href that is not an in-file id (belt and braces with sanitizeSvg).
  inner = inner.replace(/\s(?:xlink:)?href="(?!#)[^"]*"/gi, '');

  // Unique ids per icon: prefix every id and the url(#id) / href="#id" that point at it.
  const ids = [...inner.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]);
  const pre = `${prefix}-${name}-`;
  for (const id of ids) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    inner = inner.replace(new RegExp(`id="${esc}"`, 'g'), `id="${pre}${id}"`)
      .replace(new RegExp(`url\\(#${esc}\\)`, 'g'), `url(#${pre}${id})`)
      .replace(new RegExp(`href="#${esc}"`, 'g'), `href="#${pre}${id}"`);
  }

  // Hex -> OKLCH (project rule). A tint replaces every hex paint (single-colour logo); otherwise brand colours are kept.
  inner = inner.replace(PAINT_ATTR_RE, (_, a, hex) => `${a}="${tint ?? hexToOklch(hex)}"`);
  // Mono sets paint with currentColor: swap it only when the agent asked for a fixed colour.
  if (tint && tint !== 'currentColor') inner = inner.replace(/currentColor/g, tint);
  // A path with no paint at all renders black; make it follow the parent's CSS colour like the other icons.
  const hasPaint = /\b(?:fill|stroke)="/.test(inner) || /\b(?:fill|stroke)="/.test(attrs);
  const root = hasPaint ? '' : ` fill="${tint ?? 'currentColor'}"`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}"${root} aria-hidden="true">${inner}</svg>`;
}

// Compact search result: first `inline` entries carry markup until the byte budget is spent, the rest are names only.
export function formatResults(items, { inline = 4, budget = MAX_INLINE_BYTES } = {}) {
  let spent = 0;
  return items.map((it, i) => {
    const out = { id: it.id, ...(it.colour === 'brand' ? { colour: 'brand' } : {}) };
    if (it.svg && i < inline && spent + it.svg.length <= budget) { out.svg = it.svg; spent += it.svg.length; }
    return out;
  });
}

// ---- network + disk cache ------------------------------------------------------------------------

export class AssetCache {
  // fetchImpl is injectable so tests never touch the network.
  constructor(dir, fetchImpl = globalThis.fetch) {
    this.dir = dir;
    this.fetch = fetchImpl;
  }

  // GET a path on the fixed host with a timeout and a size cap; throws a one-line error when unreachable.
  async _get(pathAndQuery, maxBytes) {
    let res;
    try {
      res = await this.fetch(HOST + pathAndQuery, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new Error(`Could not reach the Iconify API (${e.name === 'TimeoutError' ? 'timed out' : e.message}). Offline? Only assets fetched earlier are available.`);
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Iconify API answered HTTP ${res.status}.`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('Iconify response is larger than expected; ignored.');
    return buf.toString('utf8');
  }

  _write(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', text); // write then rename: a crash never leaves a half file that looks cached
    fs.renameSync(file + '.tmp', file);
  }

  // Search icon ids. Cached per (prefixes, query); a repeat or offline search is served from disk.
  async search(query, prefixes) {
    const q = cleanQuery(query);
    const key = crypto.createHash('sha1').update(`${prefixes.join(',')}|${q}`).digest('hex').slice(0, 16);
    const file = path.join(this.dir, 'search', `${key}.json`);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    // Iconify's /search returns at least 32 ids whatever `limit` says; we slice locally.
    const body = await this._get(`/search?query=${encodeURIComponent(q)}&prefixes=${prefixes.join(',')}&limit=32`, MAX_JSON_BYTES);
    const ids = (JSON.parse(body ?? '{"icons":[]}').icons ?? []).filter((id) => { try { splitId(id); return true; } catch { return false; } });
    this._write(file, JSON.stringify(ids));
    return ids;
  }

  // The raw svg file of one icon, cached forever (icons are versioned by their set, not edited in place).
  async raw(prefix, name) {
    const file = path.join(this.dir, 'svg', prefix, `${name}.svg`);
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
    const svg = await this._get(`/${prefix}/${name}.svg`, MAX_SVG_BYTES);
    if (!svg || !svg.includes('<svg')) throw new Error(`No icon "${prefix}:${name}". Search first (assets icons / logos) and use an id from the result.`);
    this._write(file, svg);
    return svg;
  }

  async getSvg(prefix, name, opts = {}) {
    const p = checkName('icon set', prefix);
    const n = checkName('icon name', name);
    return prepareSvg(await this.raw(p, n), { prefix: p, name: n, ...opts });
  }

  // limit = names returned (max 24); markup is attached to the first few by formatResults.
  async searchIcons(query, { set = DEFAULT_SET, limit = 8, size = 24, color } = {}) {
    const prefix = checkName('icon set', set);
    const ids = (await this.search(query, [prefix])).slice(0, Math.min(Math.max(limit, 1), 24));
    return this._withSvg(ids, { size, color });
  }

  async searchLogos(query, { limit = 6, size = 32, color } = {}) {
    const ids = (await this.search(query, LOGO_SETS)).slice(0, Math.min(Math.max(limit, 1), 24));
    return this._withSvg(ids, { size, color });
  }

  async _withSvg(ids, opts) {
    const items = [];
    for (const [i, id] of ids.entries()) {
      const { prefix, name } = splitId(id);
      let svg;
      if (i < 8) { try { svg = await this.getSvg(prefix, name, opts); } catch (e) { if (i === 0 && /reach/.test(e.message)) throw e; } }
      items.push({ id, svg, colour: PALETTE_SETS.has(prefix) ? 'brand' : 'mono' });
    }
    return items;
  }
}
