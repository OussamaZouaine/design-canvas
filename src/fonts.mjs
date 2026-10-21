// Fonts (Phase E). Boards cannot just link a font: the sanitizer strips <link>/<style>, boards live in a
// shadow DOM, and screenshots are drawn through an SVG foreignObject, which cannot load anything from the
// network. So the SERVER fetches a Google Font once, keeps the woff2 files in data/fonts/, and the browser
// gets them from /api/fonts/... (live DOM) or embeds them as data: URIs (screenshots, see web/src/canvas/fonts.ts).
import fs from 'node:fs';
import path from 'node:path';

// Only these two hosts are ever contacted. The family name goes into a URL, so it is validated first.
export const CSS_HOST = 'fonts.googleapis.com';
export const FILE_HOST = 'fonts.gstatic.com';
export const FAMILY_RE = /^[A-Za-z][A-Za-z0-9]*(?: [A-Za-z0-9]+){0,4}$/;
const MAX_FILE_BYTES = 2_000_000; // a latin woff2 is ~20-100 KB; this only stops a runaway response
const FONT_FILE_RE = /^(normal|italic)-[1-9]00\.woff2$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Names an agent can use without calling use_font: generic keywords plus fonts that ship with the OS.
export const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
  '-apple-system', 'blinkmacsystemfont', 'inherit', 'initial', 'unset',
]);
export const SYSTEM_FAMILIES = [
  'Segoe UI', 'SF Pro Text', 'SF Pro Display', 'SF Mono', 'Helvetica Neue', 'Helvetica', 'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS',
  'Georgia', 'Times New Roman', 'Palatino', 'Cambria', 'Menlo', 'Monaco', 'Consolas', 'Courier New', 'Roboto',
  'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji',
];
const SYSTEM_SET = new Set(SYSTEM_FAMILIES.map((f) => f.toLowerCase()));

// A short, opinionated list so an agent does not guess names. Any other Google Font works too.
export const SHORTLIST = {
  sans: ['Inter', 'DM Sans', 'Manrope', 'Plus Jakarta Sans', 'Space Grotesk', 'Outfit', 'Figtree', 'Work Sans'],
  serif: ['Fraunces', 'Playfair Display', 'Newsreader', 'Source Serif 4', 'DM Serif Display', 'Instrument Serif'],
  mono: ['JetBrains Mono', 'IBM Plex Mono', 'DM Mono', 'Space Mono'],
  display: ['Bricolage Grotesque', 'Syne', 'Unbounded', 'Bebas Neue', 'Archivo Black'],
};
const FALLBACK = { sans: 'sans-serif', serif: 'serif', mono: 'monospace', display: 'sans-serif' };

export const slugOf = (family) => family.toLowerCase().replace(/ /g, '-');

// The CSS value to paste into font-family: quoted name plus the generic fallback of its category.
export function fontStack(family, category) {
  const cat = category ?? Object.keys(SHORTLIST).find((k) => SHORTLIST[k].includes(family)) ?? 'sans';
  return `"${family}", ${FALLBACK[cat] ?? 'sans-serif'}`;
}

export function validateRequest(family, weights = [400, 700]) {
  const f = String(family ?? '').trim().replace(/\s+/g, ' ');
  if (f.length > 40 || !FAMILY_RE.test(f)) throw new Error(`"${family}" is not a valid font family name (letters, digits and single spaces, e.g. "DM Sans").`);
  const ws = [...new Set(weights.map(Number))].sort((a, b) => a - b);
  if (!ws.length || ws.length > 6 || ws.some((w) => !Number.isInteger(w) || w < 100 || w > 900 || w % 100)) {
    throw new Error('weights must be 1-6 values from 100, 200 ... 900.');
  }
  return { family: f, weights: ws };
}

// Google's css2 endpoint wants axis tuples sorted: "ital,wght@0,400;0,700;1,400".
export function cssUrl(family, weights, italic) {
  const tuples = [];
  for (const w of weights) tuples.push(`0,${w}`);
  if (italic) for (const w of weights) tuples.push(`1,${w}`);
  return `https://${CSS_HOST}/css2?family=${family.replace(/ /g, '+')}:ital,wght@${tuples.join(';')}&display=swap`;
}

// Google answers with one @font-face per unicode subset, each preceded by a "/* latin */" comment.
// We keep only the latin subset (covers U+0000-00FF: English, French, German, Spanish...) so a family stays
// ~30 KB per weight. Returns [{ weight, style, url }].
export function parseCss(css) {
  const out = [];
  for (const m of css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    if (m[1] !== 'latin') continue;
    const body = m[2];
    const weight = Number(/font-weight:\s*(\d+)/.exec(body)?.[1]);
    const style = /font-style:\s*(italic|normal)/.exec(body)?.[1];
    const url = /url\((https:\/\/[^)]+?\.woff2)\)/.exec(body)?.[1];
    if (!weight || !style || !url) continue;
    if (new URL(url).hostname !== FILE_HOST) throw new Error('Unexpected font host in the Google Fonts response.'); // allowlist
    out.push({ weight, style, url });
  }
  return out;
}

// Chrome's UA makes Google answer with woff2 (a bare Node request gets ttf).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export class FontCache {
  // fetchImpl is injectable so tests never touch the network.
  constructor(dir, fetchImpl = globalThis.fetch) {
    this.dir = dir;
    this.fetch = fetchImpl;
  }

  _famDir(slug) { return path.join(this.dir, slug); }

  // The faces of a family already on disk.
  have(family) {
    const dir = this._famDir(slugOf(family));
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => FONT_FILE_RE.test(f)).map((file) => {
      const [style, w] = file.replace('.woff2', '').split('-');
      return { weight: Number(w), style, file };
    });
  }

  // Make sure every requested face is on disk (network only for the missing ones, so it works offline after
  // the first fetch) and return the project font entry: { family, slug, faces:[{weight,style,file}] }.
  async ensure(family, weights, italic = false) {
    const req = validateRequest(family, weights);
    const wanted = [];
    for (const w of req.weights) { wanted.push({ weight: w, style: 'normal' }); if (italic) wanted.push({ weight: w, style: 'italic' }); }
    const have = this.have(req.family);
    const missing = wanted.filter((x) => !have.some((h) => h.weight === x.weight && h.style === x.style));
    if (missing.length) await this._download(req.family, missing);
    const faces = this.have(req.family).filter((h) => wanted.some((x) => x.weight === h.weight && x.style === h.style));
    return { family: req.family, slug: slugOf(req.family), faces };
  }

  async _download(family, missing) {
    const weights = [...new Set(missing.map((m) => m.weight))];
    const italic = missing.some((m) => m.style === 'italic');
    let res;
    try {
      res = await this.fetch(cssUrl(family, weights, italic), { headers: { 'User-Agent': UA } });
    } catch (e) {
      throw new Error(`Could not reach Google Fonts for "${family}" (${e.message}). Offline? Only fonts fetched earlier are available.`);
    }
    if (!res.ok) throw new Error(`Google Fonts has no "${family}" with weights ${weights.join(', ')}${italic ? ' (italic)' : ''} (HTTP ${res.status}). Check the spelling and the weights the family offers.`);
    const faces = parseCss(await res.text());
    if (!faces.length) throw new Error(`Google Fonts returned no latin faces for "${family}".`);
    const dir = this._famDir(slugOf(family));
    fs.mkdirSync(dir, { recursive: true });
    for (const f of faces) {
      const r = await this.fetch(f.url);
      if (!r.ok) throw new Error(`Could not download a "${family}" font file (HTTP ${r.status}).`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_FILE_BYTES || buf.subarray(0, 4).toString('latin1') !== 'wOF2') throw new Error(`"${family}" font file is not a valid woff2.`);
      const file = `${f.style}-${f.weight}.woff2`;
      fs.writeFileSync(path.join(dir, file + '.tmp'), buf); // write then rename: a crash never leaves a half file that looks cached
      fs.renameSync(path.join(dir, file + '.tmp'), path.join(dir, file));
    }
  }

  // Absolute path of a served file, or null. Both parts are matched against strict patterns, so no traversal.
  file(slug, name) {
    if (!SLUG_RE.test(slug) || !FONT_FILE_RE.test(name)) return null;
    const f = path.join(this._famDir(slug), name);
    return fs.existsSync(f) ? f : null;
  }
}

// ---- helpers shared by lint and export ------------------------------------------------

// Families named in one font-family value, unquoted, in order.
export function familiesOf(value) {
  return String(value).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '').trim()).filter(Boolean);
}

export function isKnownFamily(name, projectFonts = []) {
  const n = name.toLowerCase();
  return GENERIC_FAMILIES.has(n) || SYSTEM_SET.has(n) || projectFonts.some((f) => f.family.toLowerCase() === n);
}

// Google families a board's HTML uses, from the project's fonts (for export).
export function usedProjectFonts(html, projectFonts = []) {
  return projectFonts.filter((f) => new RegExp(`font[^;>]*?${f.family.replace(/ /g, '\\s+')}`, 'i').test(html));
}

// The Google CSS URL for production, covering the weights we downloaded.
export function productionUrl(font) {
  const weights = [...new Set(font.faces.filter((f) => f.style === 'normal').map((f) => f.weight))];
  const italic = font.faces.some((f) => f.style === 'italic');
  return cssUrl(font.family, weights.length ? weights : [400], italic);
}
