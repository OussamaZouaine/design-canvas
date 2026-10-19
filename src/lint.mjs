// Static design lint: cheap text checks Claude can run before spending tokens on a screenshot.
// It reads only inline styles (the one place styling lives in this app), so it cannot see
// real layout: overflow/clipping still needs a screenshot. Each issue is one short line.
import { HTMLElement } from 'node-html-parser';

// ---- colour parsing ---------------------------------------------------------

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

// OKLCH -> linear sRGB (Björn Ottosson's reference matrices). Out-of-gamut values are clamped,
// which is also what browsers do when painting, so the contrast we compute matches what is shown.
function oklchToLinear(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(clamp01);
}

const NAMED = { white: [1, 1, 1], black: [0, 0, 0] };

// Returns { rgb: linear [r,g,b], alpha } or null when the value isn't a plain colour
// (gradients, var(), currentColor...). null means "can't judge", never "fails".
export function parseColor(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return null;
  if (v === 'transparent') return { rgb: [0, 0, 0], alpha: 0 };
  if (NAMED[v]) return { rgb: NAMED[v], alpha: 1 };
  let m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    return { rgb: n.map(toLinear), alpha: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  m = v.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { rgb: [m[1], m[2], m[3]].map((x) => toLinear(parseFloat(x) / 255)), alpha: a };
  }
  m = v.match(/^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:deg)?(?:\s*\/\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    const L = m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
    const C = m[2].endsWith('%') ? (parseFloat(m[2]) / 100) * 0.4 : parseFloat(m[2]);
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { rgb: oklchToLinear(L, C, parseFloat(m[3])), alpha: a };
  }
  return null;
}

// WCAG relative luminance + contrast ratio of two linear-RGB colours.
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Blend a translucent colour over an opaque backdrop (in linear light, close enough for a lint).
const over = (fg, bg) => fg.rgb.map((c, i) => c * fg.alpha + bg[i] * (1 - fg.alpha));

// ---- style helpers ------------------------------------------------------------

function styleMap(el) {
  const map = new Map();
  for (const decl of (el.getAttribute('style') || '').split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) map.set(decl.slice(0, i).trim().toLowerCase(), decl.slice(i + 1).trim());
  }
  return map;
}

const px = (v) => (/^-?[\d.]+px$/.test(String(v).trim()) ? parseFloat(v) : null);
const MAX_LINES = 40;

// Lint everything under `rootEl` (a parsed artboard or one node). `ab` supplies the size that
// widths and offsets are checked against.
export function lintArtboard(ab, rootEl, { grid = 4 } = {}) {
  const issues = [];
  const add = (el, msg) => issues.push(`${el.getAttribute('data-pid')} ${msg}`);

  // Walk with the inherited text colour and the nearest painted background so contrast is judged
  // against what is really behind the text, not just the element's own style.
  const walk = (el, inherit) => {
    for (const child of el.childNodes) {
      if (!(child instanceof HTMLElement)) continue;
      const st = styleMap(child);
      const tag = child.rawTagName.toLowerCase();
      const ctx = { ...inherit };

      const bg = st.get('background-color') ?? (st.get('background') && !/gradient|url/i.test(st.get('background')) ? st.get('background') : null);
      if (st.get('background') && /gradient|url/i.test(st.get('background')) || st.has('background-image')) ctx.bgUnknown = true;
      else if (bg) {
        const c = parseColor(bg);
        if (c && c.alpha >= 0.99) { ctx.bg = c.rgb; ctx.bgUnknown = false; }
        else if (c && c.alpha > 0) ctx.bg = over(c, ctx.bg);
        else if (!c) ctx.bgUnknown = true;
      }
      if (st.has('color')) ctx.fg = st.get('color');
      if (st.has('font-size')) ctx.size = px(st.get('font-size')) ?? ctx.size;
      if (st.has('font-weight')) ctx.weight = Number(st.get('font-weight')) || (st.get('font-weight') === 'bold' ? 700 : ctx.weight);
      // WCAG exempts inactive controls and purely decorative text, so the author can opt out.
      if (child.hasAttribute('disabled') || child.getAttribute('aria-disabled') === 'true' || child.getAttribute('aria-hidden') === 'true') ctx.exempt = true;
      if (st.has('opacity')) ctx.opacity = (ctx.opacity ?? 1) * Number(st.get('opacity'));

      const ownText = child.childNodes.some((n) => !(n instanceof HTMLElement) && n.rawText.trim());
      if (ownText && !/^(script|style)$/.test(tag)) {
        const label = `"${child.text.trim().replace(/\s+/g, ' ').slice(0, 24)}"`;
        const size = ctx.size ?? 16;
        if (size < 12) add(child, `small text ${size}px ${label}: use 12px or larger`);
        if (/lorem ipsum|dolor sit amet/i.test(child.text)) add(child, `placeholder copy ${label}: write real content`);
        const fg = parseColor(ctx.fg ?? '#000');
        if (fg && !ctx.bgUnknown && !ctx.exempt) {
          // Blend a translucent text colour (and any ancestor opacity) over the backdrop first,
          // so "rgba(0,0,0,.3)" is judged by the grey it actually paints.
          const alpha = fg.alpha * (ctx.opacity ?? 1);
          const ratio = contrast(over({ rgb: fg.rgb, alpha }, ctx.bg), ctx.bg);
          // WCAG "large text" (24px, or 18.66px bold) only needs 3:1.
          const large = size >= 24 || (size >= 18.66 && (ctx.weight ?? 400) >= 700);
          const need = large ? 3 : 4.5;
          if (ratio < need) add(child, `low contrast ${ratio.toFixed(1)}:1 (needs ${need}:1) ${label}`);
        }
      }

      if (tag === 'img' && !child.getAttribute('alt') && child.getAttribute('alt') !== '') add(child, 'image has no alt text');

      // A fixed width wider than the artboard always overflows it.
      const w = px(st.get('width'));
      if (w !== null && w > ab.width) add(child, `width ${w}px is wider than the artboard (${ab.width}px)`);
      // A negative offset only escapes the artboard when nothing between here and the artboard is
      // positioned; otherwise it is relative to that parent (a corner badge, a timeline dot).
      if (st.get('position') && st.get('position') !== 'static') ctx.positioned = true;
      if (st.get('position') === 'absolute' && !inherit.positioned) {
        const left = px(st.get('left'));
        const top = px(st.get('top'));
        if ((left !== null && left < 0) || (top !== null && top < 0)) add(child, 'absolutely positioned outside the artboard (negative offset)');
      }

      // Spacing off the grid (default 4px, the plan's scale) usually means a guess. Designs that
      // use half-steps on purpose (Sprig: 6, 10, 14) lint with grid 2 instead of getting noise.
      for (const prop of ['gap', 'padding', 'margin', 'row-gap', 'column-gap']) {
        const v = st.get(prop);
        if (!v || /var\(|%|auto|calc/.test(v)) continue;
        const off = v.split(/\s+/).map(px).some((n) => n !== null && n !== 0 && Math.abs(n) % grid !== 0);
        if (off) add(child, `${prop}: ${v} is not on the ${grid}px spacing grid`);
      }

      walk(child, ctx);
    }
  };

  walk(rootEl, { bg: [1, 1, 1], bgUnknown: false, fg: '#000', positioned: false });
  return issues;
}

export function formatIssues(issues) {
  if (!issues.length) return 'clean';
  const shown = issues.slice(0, MAX_LINES);
  return shown.join('\n') + (issues.length > MAX_LINES ? `\n… and ${issues.length - MAX_LINES} more` : '');
}
