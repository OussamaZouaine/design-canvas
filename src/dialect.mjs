// The layout dialect (see get_guide topic "layout"): flex + padding + gap, no margins, no tables, no inline boxes.
// Why it matters: those features make a box's final size depend on its neighbours (margin collapse, inline
// baselines, table auto-layout), so heights are hard to predict and content ends up clipped.
// Phase B reports only; it never rewrites the author's markup (rewriting is only safe in a few cases).
import { parse, HTMLElement } from 'node-html-parser';
import { parseStyle } from './css.mjs';

const TABLE_TAGS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th']);
// inline-flex is allowed: it is what form controls become and it behaves like a flex box.
const INLINE = /^(inline|inline-block|inline-grid)$/;

// The dialect problem of one element (tag + parsed style Map), or null. One kind per element so counts add up.
export function dialectKind(tag, st) {
  const display = (st.get('display') || '').trim().toLowerCase();
  if (TABLE_TAGS.has(tag) || display.startsWith('table')) return 'table';
  if ([...st.keys()].some((k) => k === 'margin' || k.startsWith('margin-'))) return 'margin';
  if (display === 'grid' || display === 'inline-grid') return 'grid';
  if (INLINE.test(display)) return 'inline';
  return null;
}

const ADVICE = {
  margin: 'margin: use gap on the parent or padding instead',
  grid: 'display:grid: use flex, or give every track an explicit size',
  inline: 'display:inline / inline-block: use a flex row',
  table: 'table: use flex rows with fixed-width slots',
};

// One short line summarising an HTML fragment's departures from the dialect, or '' when it is clean.
export function dialectNote(html) {
  const counts = {};
  const walk = (el) => {
    for (const c of el.childNodes) {
      if (!(c instanceof HTMLElement)) continue;
      const kind = dialectKind(c.rawTagName.toLowerCase(), parseStyle(c.getAttribute('style') || ''));
      if (kind) counts[kind] = (counts[kind] || 0) + 1;
      walk(c);
    }
  };
  walk(parse(String(html)));
  const parts = Object.entries(counts).map(([k, n]) => `${n}x ${ADVICE[k]}`);
  return parts.length ? `outside the layout dialect: ${parts.join('; ')}` : '';
}

// Same check for an update_styles call: only the properties being set matter.
export function dialectStylesNote(styles) {
  const st = new Map();
  for (const [k, v] of Object.entries(styles)) if (v !== null) st.set(k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), String(v));
  const kind = dialectKind('div', st);
  return kind ? `outside the layout dialect: ${ADVICE[kind]}` : '';
}
