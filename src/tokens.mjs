// Design-token extraction: scans every inline style in a project's artboards and turns
// the raw values into a ranked, named token set (colours, type, radii, spacing, shadows).
// It reads what was actually used, so tokens always match the real designs.
import { parse } from 'node-html-parser';

// ---- colour helpers ----------------------------------------------------------

const NAMED = { white: '#ffffff', black: '#000000' };
const COLOR_RE = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|\b(?:white|black)\b/gi;
const hex2 = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

// ---- OKLCH (Bjorn Ottosson's OKLab) ---------------------------------------------
// OKLCH separates lightness (L), chroma (C) and hue (H) in a perceptually even space, so
// equal L steps look equally light and hue names stay accurate: better than HSL for ramps.
const toLinear = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const fromLinear = (c) => 255 * Math.max(0, Math.min(1, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));

function rgbToOklch({ r, g, b }) {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(a, bb);
  return { L, C, H: C < 1e-4 ? 0 : (Math.atan2(bb, a) * 180 / Math.PI + 360) % 360 };
}

function oklchToRgb(L, C, H) {
  const a = C * Math.cos(H * Math.PI / 180), b = C * Math.sin(H * Math.PI / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  };
}

// CSS Color 4 string, e.g. oklch(0.554 0.201 281.3) or oklch(0 0 0 / 0.1)
function oklchString(c) {
  const { L, C, H } = rgbToOklch(c);
  const n = (v, d) => +v.toFixed(d);
  return `oklch(${n(L, 3)} ${n(C, 3)} ${n(C < 0.004 ? 0 : H, 1)}${c.a < 0.995 ? ` / ${+c.a.toFixed(2)}` : ''})`;
}

// -> { r, g, b, a } or null
function parseColor(raw) {
  const s = raw.trim().toLowerCase();
  if (NAMED[s]) return parseColor(NAMED[s]);
  let m;
  if ((m = s.match(/^#([0-9a-f]{3,8})$/))) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
  }
  if ((m = s.match(/^rgba?\(([^)]*)\)$/))) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map((x) => (x.endsWith('%') ? parseFloat(x) * 2.55 : parseFloat(x)));
    if (p.length < 3 || p.some(Number.isNaN)) return null;
    const a = p[3] === undefined ? 1 : /%/.test(m[1].split(/[\s,/]+/)[3] || '') ? p[3] / 255 : p[3];
    return { r: p[0], g: p[1], b: p[2], a };
  }
  if ((m = s.match(/^oklch\(([^)]*)\)$/))) {
    const parts = m[1].split(/[\s/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const L = parts[0].endsWith('%') ? parseFloat(parts[0]) / 100 : parseFloat(parts[0]);
    const C = parts[1].endsWith('%') ? (parseFloat(parts[1]) / 100) * 0.4 : parseFloat(parts[1]);
    const H = parseFloat(parts[2]);
    if ([L, C, H].some(Number.isNaN)) return null;
    const a = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    return { ...oklchToRgb(L, C, H), a };
  }
  if ((m = s.match(/^hsla?\(([^)]*)\)$/))) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map((x) => parseFloat(x));
    if (p.length < 3 || p.some(Number.isNaN)) return null;
    const [r, g, b] = hslToRgb(p[0], p[1] / 100, p[2] / 100);
    return { r, g, b, a: p[3] ?? 1 };
  }
  return null;
}

const canon = (c) => (c.a >= 0.995 ? `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}` : `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${+c.a.toFixed(2)})`);

// Hue names on the OKLCH wheel (red sits near 25 degrees, blue near 260, not at HSL's 0 / 240).
const hueName = (h) => (h < 10 || h >= 345 ? 'pink' : h < 45 ? 'red' : h < 85 ? 'orange' : h < 125 ? 'yellow' : h < 175 ? 'green' : h < 215 ? 'teal' : h < 270 ? 'blue' : h < 335 ? 'purple' : 'pink');
// Light -> 50, mid -> 500, dark -> 900: the same convention most design systems use.
const step = (l) => { const n = Math.round((1 - l) * 10); return n <= 0 ? 50 : n >= 10 ? 950 : n * 100; };

// ---- value helpers -------------------------------------------------------------

function parseStyle(str = '') {
  const out = [];
  for (const decl of str.split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) out.push([decl.slice(0, i).trim().toLowerCase(), decl.slice(i + 1).trim()]);
  }
  return out;
}
// Split on spaces/commas but not inside parentheses (so rgba(0, 0, 0) stays whole).
const splitTop = (v, sep) => {
  const out = []; let depth = 0, cur = '';
  for (const ch of v) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && sep.test(ch)) { if (cur) out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
};
const px = (v) => {
  const m = String(v).trim().match(/^(-?\d*\.?\d+)(px|rem|em)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2] === 'rem' || m[2] === 'em' ? n * 16 : n;
};
const WEIGHTS = { normal: 400, bold: 700, lighter: 300, bolder: 700 };

const COLOR_PROPS = /^(color|background|background-color|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|fill|stroke|caret-color|text-decoration-color)$/;
const SPACING_PROPS = /^(padding|margin|gap|row-gap|column-gap)(-(top|right|bottom|left))?$/;

const bump = (map, key, by = 1) => map.set(key, (map.get(key) || 0) + by);
const ranked = (map, limit = 24) => [...map].sort((a, b) => b[1] - a[1]).slice(0, limit);

// ---- main ----------------------------------------------------------------------

export function extractTokens(artboards) {
  const colors = new Map(), overlays = new Map(), families = new Map(), sizes = new Map(),
    weights = new Map(), lineHeights = new Map(), radii = new Map(), spacing = new Map(), shadows = new Map();
  let elements = 0;

  for (const ab of artboards) {
    for (const el of parse(ab.html).querySelectorAll('[style]')) {
      elements++;
      for (const [prop, value] of parseStyle(el.getAttribute('style'))) {
        if (COLOR_PROPS.test(prop)) {
          for (const m of value.matchAll(COLOR_RE)) {
            const c = parseColor(m[0]);
            if (!c || c.a === 0) continue;
            bump(c.a >= 0.995 ? colors : overlays, canon(c));
          }
        } else if (prop === 'font-family') {
          bump(families, value.replace(/\s+/g, ' '));
        } else if (prop === 'font-size') {
          const n = px(value); if (n) bump(sizes, +n.toFixed(2));
        } else if (prop === 'font-weight') {
          const n = WEIGHTS[value] ?? parseInt(value, 10); if (n) bump(weights, n);
        } else if (prop === 'line-height') {
          const n = px(value);
          if (n) bump(lineHeights, /px|rem|em/.test(value) ? `${+n.toFixed(2)}px` : String(n));
        } else if (/^border(-(top|bottom)-(left|right))?-radius$/.test(prop)) {
          for (const part of splitTop(value, /\s/)) { const n = px(part); if (n !== null && n > 0) bump(radii, +n.toFixed(2)); }
        } else if (SPACING_PROPS.test(prop)) {
          for (const part of splitTop(value, /\s/)) { const n = px(part); if (n && n > 0) bump(spacing, +n.toFixed(2)); }
        } else if (prop === 'box-shadow') {
          if (value !== 'none') bump(shadows, value.replace(/\s+/g, ' '));
        }
      }
    }
  }

  // Name colours: grey ramp by lightness, chromatic ones by hue + lightness step.
  const used = new Set();
  const unique = (name) => { let n = name, i = 2; while (used.has(n)) n = `${name}-${i++}`; used.add(n); return n; };
  const colorTokens = ranked(colors, 40).map(([value, count]) => {
    const c = parseColor(value);
    const lch = rgbToOklch(c);
    // Chroma under ~0.02 reads as a neutral grey whatever its hue angle is.
    const family = lch.C < 0.02 ? 'gray' : hueName(lch.H);
    return { name: unique(`${family}-${step(lch.L)}`), value, oklch: oklchString(c), count };
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const overlayTokens = ranked(overlays, 12).map(([value, count], i) => ({ name: `overlay-${i + 1}`, value, oklch: oklchString(parseColor(value)), count }));

  // Spacing scale: detect the base grid (8 / 4 / none) from how many values divide evenly.
  const sp = ranked(spacing, 40);
  const total = sp.reduce((s, [, c]) => s + c, 0) || 1;
  const fits = (b) => sp.filter(([v]) => v % b === 0).reduce((s, [, c]) => s + c, 0) / total;
  const base = fits(8) >= 0.8 ? 8 : fits(4) >= 0.8 ? 4 : null;

  const sizeTokens = [...sizes].sort((a, b) => a[0] - b[0]).map(([value, count]) => ({ name: `text-${value}`, value: `${value}px`, count }));
  const weightTokens = [...weights].sort((a, b) => a[0] - b[0]).map(([value, count]) => ({ name: `weight-${value}`, value, count }));
  const lhTokens = ranked(lineHeights, 12).map(([value, count]) => ({ name: `leading-${value.replace('px', '')}`, value, count }));
  // Families: monospace stacks are named font-mono; the most used other stack is font-sans.
  const isMono = (v) => /mono|consolas|courier|menlo/i.test(v);
  let sansDone = false, extra = 1;
  const familyTokens = ranked(families, 6).map(([value, count]) => {
    const name = isMono(value) ? 'font-mono' : !sansDone ? (sansDone = true, 'font-sans') : `font-${++extra}`;
    return { name, value, count };
  }).filter((x, i, arr) => arr.findIndex((y) => y.name === x.name) === i);
  const radiusTokens = [...radii].sort((a, b) => a[0] - b[0]).map(([value, count]) => ({ name: value >= 999 ? 'radius-pill' : `radius-${value}`, value: `${value}px`, count }));
  const spaceTokens = [...spacing].sort((a, b) => a[0] - b[0]).filter(([, c]) => c >= 2 || spacing.size <= 14).map(([value, count]) => ({ name: `space-${value}`, value: `${value}px`, count, onGrid: base ? value % base === 0 : null }));
  const shadowTokens = ranked(shadows, 8).map(([value, count], i) => ({ name: `shadow-${i + 1}`, value, count }));

  const tokens = {
    summary: { artboards: artboards.length, styledElements: elements, spacingBase: base },
    colors: colorTokens, overlays: overlayTokens, fontFamilies: familyTokens, fontSizes: sizeTokens,
    fontWeights: weightTokens, lineHeights: lhTokens, radii: radiusTokens, spacing: spaceTokens, shadows: shadowTokens,
  };
  return { ...tokens, outputs: { css: toCss(tokens), json: toJson(tokens), tailwind: toTailwind(tokens) } };
}

// ---- exporters -----------------------------------------------------------------

function toCss(t) {
  const lines = [':root {'];
  const add = (title, list, prefix) => { if (list.length) { lines.push(`  /* ${title} */`); for (const x of list) lines.push(`  --${prefix}${x.name}: ${x.value};`); } };
  const asOklch = (list) => list.map((x) => ({ ...x, value: x.oklch }));
  add('Colour (OKLCH)', asOklch(t.colors), 'color-');
  add('Overlays', asOklch(t.overlays), 'color-');
  add('Font family', t.fontFamilies, '');
  add('Font size', t.fontSizes, '');
  add('Font weight', t.fontWeights, '');
  add('Line height', t.lineHeights, '');
  add('Radius', t.radii, '');
  add('Spacing', t.spacing, '');
  add('Shadow', t.shadows, '');
  lines.push('}');
  return lines.join('\n');
}

// W3C Design Tokens format ($type / $value) so tools like Style Dictionary can read it.
function toJson(t) {
  const group = (list, type, keyFn = (x) => x.name) => Object.fromEntries(list.map((x) => [keyFn(x), { $type: type, $value: x.value }]));
  return JSON.stringify({
    color: Object.fromEntries([...t.colors, ...t.overlays].map((x) => [x.name, { $type: 'color', $value: x.oklch, $extensions: { hex: x.value } }])),
    fontFamily: group(t.fontFamilies, 'fontFamily'),
    fontSize: group(t.fontSizes, 'dimension'),
    fontWeight: group(t.fontWeights, 'fontWeight'),
    lineHeight: group(t.lineHeights, 'dimension'),
    radius: group(t.radii, 'dimension'),
    space: group(t.spacing, 'dimension'),
    shadow: group(t.shadows, 'shadow'),
  }, null, 2);
}

function toTailwind(t) {
  const obj = (list, keyFn = (x) => x.name) => Object.fromEntries(list.map((x) => [keyFn(x), x.value]));
  const cfg = {
    theme: {
      extend: {
        colors: Object.fromEntries([...t.colors, ...t.overlays].map((x) => [x.name, x.oklch])),
        fontFamily: Object.fromEntries(t.fontFamilies.map((x) => [x.name.replace('font-', ''), [x.value]])),
        fontSize: obj(t.fontSizes, (x) => x.name.replace('text-', '')),
        borderRadius: obj(t.radii, (x) => x.name.replace('radius-', '')),
        spacing: obj(t.spacing, (x) => x.name.replace('space-', '')),
        boxShadow: obj(t.shadows, (x) => x.name.replace('shadow-', '')),
      },
    },
  };
  return `// tailwind.config.js (merge into your config)\nmodule.exports = ${JSON.stringify(cfg, null, 2)};`;
}
