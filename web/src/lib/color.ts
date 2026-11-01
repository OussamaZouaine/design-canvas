// Pure colour maths for the picker: OKLCH <-> sRGB / HSL / hex, gamut mapping, and gradient parse/serialize.
// Import-free on purpose: `test/color.test.mjs` imports it straight from Node (which strips the types).

// ---- OKLCH value <-> parts, for the colour picker ------------------------------------------------------------------

export interface Oklch { l: number; c: number; h: number; a: number }

// Reads `oklch(L C H / A)` (L as 0..1 or a percentage, alpha as number or percentage). Anything else is null; the
// picker then falls back to parseColor / a neutral default.
export function parseOklch(css: string): Oklch | null {
  const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/i.exec(css.trim());
  if (!m) return null;
  const a = m[5] === undefined ? 1 : parseFloat(m[5]) / (m[6] ? 100 : 1);
  return { l: parseFloat(m[1]) / (m[2] ? 100 : 1), c: parseFloat(m[3]), h: parseFloat(m[4]), a };
}

// Canonical text, trimmed to the precision a slider can actually express so the CSS stays readable.
export function formatOklch({ l, c, h, a }: Oklch): string {
  const base = `${+l.toFixed(3)} ${+c.toFixed(3)} ${+(((h % 360) + 360) % 360).toFixed(1)}`;
  return a >= 1 ? `oklch(${base})` : `oklch(${base} / ${+a.toFixed(2)})`;
}

// ---- sRGB <-> OKLCH ------------------------------------------------------------------------------------------------
// Matrices are Bjorn Ottosson's OKLab reference. Kept hand-written (about 30 lines) instead of adding a colour library:
// the picker needs only sRGB, HSL and hex, and this file must stay import-free for node:test.

export type Rgb = [number, number, number]; // gamma-encoded sRGB channels, 0..1 (outside that range = out of gamut)

const toLinear = (c: number) => (Math.abs(c) <= 0.04045 ? c / 12.92 : Math.sign(c) * ((Math.abs(c) + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (Math.abs(c) <= 0.0031308 ? c * 12.92 : Math.sign(c) * (1.055 * Math.abs(c) ** (1 / 2.4) - 0.055));
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function rgbToOklch([R, G, B]: Rgb, a = 1): Oklch {
  const [r, g, b] = [R, G, B].map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s;
  const C = Math.hypot(A, Bb);
  // Hue is meaningless for greys; 0 keeps the output stable instead of printing noise.
  const grey = C < 0.0004;
  return { l: L, c: grey ? 0 : C, h: grey ? 0 : ((Math.atan2(Bb, A) * 180) / Math.PI + 360) % 360, a };
}

// Unclamped: a channel below 0 or above 1 means the colour is outside sRGB (it may still show on a P3 screen).
export function oklchToRgb({ l: L, c: C, h }: Oklch): Rgb {
  const hr = (h * Math.PI) / 180;
  const a = C * Math.cos(hr), b = C * Math.sin(hr);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ].map(toGamma) as Rgb;
}

// A small tolerance so colours that round-trip through 8-bit hex do not flicker in and out of gamut.
export const inGamut = (o: Oklch) => oklchToRgb(o).every((x) => x >= -0.0005 && x <= 1.0005);

// CSS Color 4 style gamut mapping, simplified: keep L and H, lower chroma until it fits sRGB (binary search).
// Hue and lightness are what people notice first, so this changes the colour the least.
export function toGamut(o: Oklch): Oklch {
  const p = { ...o, l: clamp01(o.l) };
  if (inGamut(p)) return p;
  let lo = 0, hi = p.c;
  for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (inGamut({ ...p, c: mid })) lo = mid; else hi = mid; }
  return { ...p, c: lo };
}

// Gamut-mapped 8-bit channels, for the RGB row and hex.
export const toRgb255 = (o: Oklch): Rgb => oklchToRgb(toGamut(o)).map((x) => Math.round(clamp01(x) * 255)) as Rgb;
export const formatHex = (o: Oklch) => toRgb255(o).map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();

// `RGB`, `RRGGBB`, `RRGGBBAA` with or without `#`. The alpha byte is reported separately (null when absent).
export function parseHex(hex: string): { o: Oklch; alpha: number | null } | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const alpha = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : null;
  return { o: rgbToOklch([r, g, b], alpha ?? 1), alpha };
}

export function hexToOklch(hex: string): string | null {
  const p = parseHex(hex);
  return p ? formatOklch(p.o) : null;
}

// Best-effort hex for a native picker's starting value: handles hex and oklch(); anything else (var(), names) is null.
export function toHex(css: string): string | null {
  const t = css.trim();
  if (/^#[0-9a-f]{6}$/i.test(t)) return t;
  const o = parseOklch(t);
  return o ? '#' + formatHex(o).toLowerCase() : null;
}

// HSL (H 0..360, S and L 0..100) over gamma sRGB, for the secondary row of the picker.
export function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  if (d === 0) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s * 100, l * 100];
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))) as Rgb;
}

// Any colour text the picker may be opened on: oklch(), hex, rgb()/rgba(), `transparent`, or var(--token) resolved
// through `tokens` (name -> value). null = unknown (a named colour); the UI then asks the browser to resolve it.
export function parseColor(css: string, tokens: Record<string, string> = {}, depth = 0): Oklch | null {
  const t = css.trim();
  const v = /^var\(--([a-z0-9-]+)\s*(?:,\s*(.*))?\)$/i.exec(t);
  if (v) {
    const next = tokens[v[1]] ?? v[2];
    return next && depth < 5 ? parseColor(next, tokens, depth + 1) : null;
  }
  if (/^transparent$/i.test(t)) return { l: 0, c: 0, h: 0, a: 0 };
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(t);
  if (rgb) {
    const a = rgb[4] === undefined ? 1 : parseFloat(rgb[4]) / (rgb[5] ? 100 : 1);
    return rgbToOklch([1, 2, 3].map((i) => parseFloat(rgb[i]) / 255) as Rgb, a);
  }
  if (t.startsWith('#')) return parseHex(t)?.o ?? null;
  return parseOklch(t);
}

// Interpolate two colours in OKLCH along the shorter hue arc: matches what `in oklch` gradients draw between stops.
export function mixOklch(a: Oklch, b: Oklch, t: number): Oklch {
  // A grey has no hue; borrow the other side's so a grey-to-colour mix does not swing through unrelated hues.
  const ha = a.c < 0.0004 ? b.h : a.h, hb = b.c < 0.0004 ? a.h : b.h;
  const dh = ((hb - ha + 540) % 360) - 180;
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return { l: lerp(a.l, b.l), c: lerp(a.c, b.c), h: (ha + dh * t + 360) % 360, a: lerp(a.a, b.a) };
}

// ---- Gradients -----------------------------------------------------------------------------------------------------
// One CSS gradient layer as the Fill picker edits it. Stop colours stay as authored text (so var(--token) survives),
// positions are 0..1. Written back with `in oklch` interpolation so midpoints never go muddy the way sRGB mixes do.

export interface GradientStop { color: string; pos: number }
export interface Gradient {
  kind: 'linear' | 'radial';
  angle: number; // linear only, degrees (CSS: 0 = to top, 90 = to right)
  shape: string; // radial only: the authored shape/size/position text (e.g. "circle at top"), '' = default ellipse
  stops: GradientStop[];
}

// Split on commas that are not inside parentheses (stops contain oklch(...)).
export function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

// `to <side>` keywords as angles. Corners are approximated as 45deg steps; real CSS corner angles depend on the box's
// aspect ratio, which a pure parser cannot know. The editor writes plain angles, so this only affects imported CSS.
const SIDES: Record<string, number> = {
  top: 0, right: 90, bottom: 180, left: 270, 'top right': 45, 'right top': 45, 'bottom right': 135, 'right bottom': 135,
  'bottom left': 225, 'left bottom': 225, 'top left': 315, 'left top': 315,
};
const ANGLE_UNITS: Record<string, number> = { deg: 1, turn: 360, rad: 180 / Math.PI, grad: 0.9 };

// Reads one linear-gradient(...) / radial-gradient(...) layer. Anything the editor cannot model (several layers,
// repeating or conic gradients, two-position stops, colour hints) is null, and the field keeps it as plain text.
export function parseGradient(css: string): Gradient | null {
  const m = /^(linear|radial)-gradient\((.*)\)$/is.exec(css.trim());
  if (!m) return null;
  // The last ")" must close the opening "(": rejects "linear-gradient(...), red" (two layers).
  let depth = 0;
  for (const ch of m[2]) { if (ch === '(') depth++; if (ch === ')' && --depth < 0) return null; }
  const parts = splitTop(m[2]);
  const kind = m[1].toLowerCase() as Gradient['kind'];
  let angle = 180, shape = '';
  const first = parts[0];
  const isPrefix = kind === 'linear'
    ? /^(to\s|in\s|-?[\d.]+(deg|turn|rad|grad)\b)/i.test(first)
    : /^(in\s|circle|ellipse|closest|farthest|at\s|[\d.]+(px|%)\s)/i.test(first);
  if (isPrefix) {
    parts.shift();
    // Drop the interpolation space (`in oklch`, `in srgb longer hue`...): the editor always writes `in oklch`.
    const rest = first.replace(/\bin\s+[a-z-]+(\s+(shorter|longer|increasing|decreasing)\s+hue)?/i, '').trim();
    if (kind === 'linear' && rest) {
      const a = /^(-?[\d.]+)(deg|turn|rad|grad)$/i.exec(rest);
      const side = /^to\s+(.+)$/i.exec(rest)?.[1].toLowerCase().replace(/\s+/g, ' ');
      if (a) angle = parseFloat(a[1]) * ANGLE_UNITS[a[2].toLowerCase()];
      else if (side && side in SIDES) angle = SIDES[side];
      else return null;
    } else shape = rest;
  }
  if (parts.length < 2) return null;
  const raw: { color: string; pos: number | null }[] = [];
  for (const p of parts) {
    const s = /^(.*?)\s+(-?[\d.]+)%$/s.exec(p);
    const color = (s ? s[1] : p).trim();
    // A second position or a colour hint (a bare percentage) is outside what the stop bar models.
    if (!color || /^-?[\d.]+%?$/.test(color) || /\s-?[\d.]+%$/.test(color)) return null;
    raw.push({ color, pos: s ? parseFloat(s[2]) / 100 : null });
  }
  // Missing positions: first 0, last 1, the rest spread evenly between their known neighbours (CSS's own rule).
  if (raw[0].pos === null) raw[0].pos = 0;
  if (raw[raw.length - 1].pos === null) raw[raw.length - 1].pos = 1;
  for (let i = 1; i < raw.length; i++) {
    if (raw[i].pos !== null) continue;
    let j = i;
    while (raw[j].pos === null) j++;
    const from = raw[i - 1].pos!, to = raw[j].pos!;
    for (let k = i; k < j; k++) raw[k].pos = from + ((to - from) * (k - i + 1)) / (j - i + 1);
  }
  return { kind, angle: ((angle % 360) + 360) % 360, shape, stops: raw.map((r) => ({ color: r.color, pos: r.pos! })) };
}

export function formatGradient(g: Gradient): string {
  const stops = [...g.stops].sort((a, b) => a.pos - b.pos).map((s) => `${s.color} ${+(s.pos * 100).toFixed(1)}%`).join(', ');
  return g.kind === 'linear'
    ? `linear-gradient(${+g.angle.toFixed(1)}deg in oklch, ${stops})`
    : `radial-gradient(${g.shape ? `${g.shape} ` : ''}in oklch, ${stops})`;
}
