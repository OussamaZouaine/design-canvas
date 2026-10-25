// Pure logic behind the Design tab (no DOM, no imports, erasable TypeScript only, so `node --test` can run it:
// see test/inspect.test.mjs). The panels feed it inline-style maps; it answers "what mode is this size in" and
// "which CSS makes it so". Inline styles stand in for computed style because every generated design is inline.

export type StyleMap = Record<string, string>;
export const MIXED = '\u0000mixed';

// ---- Arithmetic in number fields ("16*2", "(8+4)/2px") -------------------------------------------------

// Tiny recursive-descent parser instead of eval(): fields take user text, and eval would run anything typed.
// Grammar: expr = term (('+'|'-') term)*; term = factor (('*'|'/') factor)*; factor = number | '(' expr ')' | '-' factor.
// A trailing `px` on numbers is ignored. Returns null for anything that is not plain arithmetic.
export function evalExpr(src: string): number | null {
  const s = src.replace(/px/gi, '').replace(/\s+/g, '');
  if (!s || /[^0-9+\-*/().%]/.test(s)) return null;
  let i = 0;
  const peek = () => s[i];
  const number = (): number | null => {
    const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const factor = (): number | null => {
    if (peek() === '-') { i++; const v = factor(); return v === null ? null : -v; }
    if (peek() === '+') { i++; return factor(); }
    if (peek() === '(') {
      i++;
      const v = expr();
      if (v === null || peek() !== ')') return null;
      i++;
      return v;
    }
    return number();
  };
  const term = (): number | null => {
    let v = factor();
    while (v !== null && (peek() === '*' || peek() === '/')) {
      const op = s[i++];
      const r = factor();
      if (r === null) return null;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const expr = (): number | null => {
    let v = term();
    while (v !== null && (peek() === '+' || peek() === '-')) {
      const op = s[i++];
      const r = term();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const out = expr();
  return out !== null && i === s.length && Number.isFinite(out) ? out : null;
}

// Round to `decimals` so 0.1 + 0.2 never shows 0.30000000000000004.
export const roundTo = (v: number, decimals: number) => Number(v.toFixed(decimals));

// Step size for a drag / arrow press: Shift = x10, Alt = /10 (Figma's convention).
export const stepFactor = (e: { shiftKey?: boolean; altKey?: boolean }) => (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);

// ---- Mixed values across a selection ---------------------------------------------------------------------

// The shared value of a list, or MIXED when they differ. An empty list yields ''.
export function shared(values: string[]): string {
  if (!values.length) return '';
  return values.every((v) => v === values[0]) ? values[0] : MIXED;
}

// ---- CSS shorthand (padding, border-radius) ----------------------------------------------------------------

// Split a CSS value on spaces that are not inside parentheses (so var(--a, 1px) and calc(1px + 2px) stay whole).
export function splitTop(v: string, sep = ' '): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of v.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === sep && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// 1 value = all, 2 = vertical/horizontal, 3 = top/horizontal/bottom, 4 = top/right/bottom/left. For border-radius the
// same order reads TL / TR / BR / BL, so one pair of helpers serves both.
export function sidesOf(v: string): [string, string, string, string] {
  const p = splitTop(v);
  if (p.length === 0) return ['', '', '', ''];
  if (p.length === 1) return [p[0], p[0], p[0], p[0]];
  if (p.length === 2) return [p[0], p[1], p[0], p[1]];
  if (p.length === 3) return [p[0], p[1], p[2], p[1]];
  return [p[0], p[1], p[2], p[3]];
}
export function shorthandOf(sides: string[]): string {
  const z = (s: string) => s || '0';
  const [t, r, b, l] = sides.map(z);
  if (t === r && r === b && b === l) return t;
  if (t === b && r === l) return `${t} ${r}`;
  return `${t} ${r} ${b} ${l}`;
}

// A plain pixel value ("12", "12px", "-3.5px") as a number, else null (var(), %, auto, calc()).
export function px(v: string | undefined): number | null {
  if (v === undefined) return null;
  const m = /^(-?\d*\.?\d+)(px)?$/.exec(v.trim());
  return m ? parseFloat(m[1]) : null;
}
export const toPx = (n: number) => `${roundTo(n, 2)}px`;

// ---- Size modes: Fixed / Hug / Fill -------------------------------------------------------------------------

export type Axis = 'width' | 'height';
export type SizeMode = 'fixed' | 'hug' | 'fill';

export interface ParentInfo {
  flex: boolean; // parent lays children out with flexbox (flex or inline-flex)
  column: boolean; // flex-direction is column(-reverse)
  alignItems: string; // parent's align-items, '' = default (stretch)
}

// What the child sees of its parent. The board root wrapper is a flex column, so top-level nodes use `BOARD_PARENT`.
export const BOARD_PARENT: ParentInfo = { flex: true, column: true, alignItems: '' };
export function parentInfo(style: StyleMap | null): ParentInfo {
  if (!style) return BOARD_PARENT;
  const display = style.display ?? '';
  const flex = display === 'flex' || display === 'inline-flex';
  return { flex, column: flex && (style['flex-direction'] ?? 'row').startsWith('column'), alignItems: style['align-items'] ?? '' };
}

// Is `axis` the parent's main axis (the direction `flex` grows along)? Only meaningful for flex parents.
const isMain = (axis: Axis, p: ParentInfo) => p.flex && (p.column ? axis === 'height' : axis === 'width');

const stretches = (own: StyleMap, p: ParentInfo) => {
  const a = own['align-self'] || p.alignItems;
  return a === '' || a === 'stretch' || a === 'normal';
};
const grows = (own: StyleMap) => {
  const f = (own.flex ?? '').trim();
  const grow = own['flex-grow'] ?? (f ? f.split(/\s+/)[0] : '');
  return f === 'auto' || (grow !== '' && parseFloat(grow) > 0 && Number.isFinite(parseFloat(grow)));
};

// Derive the mode of one axis from the node's own inline style and its parent. Absent size means "auto", whose
// meaning depends on layout: a block child fills the width but hugs the height, a flex child hugs along its main
// axis and stretches across it (unless the parent aligns otherwise).
export function sizeMode(axis: Axis, own: StyleMap, p: ParentInfo): SizeMode {
  const v = (own[axis] ?? '').trim();
  const abs = own.position === 'absolute' || own.position === 'fixed';
  if (/^(fit-content|max-content|min-content)(\(.*\))?$/.test(v)) return 'hug';
  if (v === '100%') return 'fill';
  if (v !== '' && v !== 'auto') {
    // An explicit size normally means Fixed, but `flex: 1 1 0` with a basis-less width in the main axis is Fill.
    return 'fixed';
  }
  if (abs) return 'hug';
  if (isMain(axis, p)) return grows(own) ? 'fill' : 'hug';
  if (p.flex) return stretches(own, p) ? 'fill' : 'hug';
  return axis === 'width' ? 'fill' : 'hug';
}

// The style patch that puts `axis` into `mode`. `current` is the node's measured size, used when switching to Fixed
// so the node keeps its look. A null value removes the property.
export function sizeCss(axis: Axis, mode: SizeMode, own: StyleMap, p: ParentInfo, current: number): Record<string, string | null> {
  const abs = own.position === 'absolute' || own.position === 'fixed';
  const main = isMain(axis, p) && !abs;
  const cross = p.flex && !main && !abs;
  const patch: Record<string, string | null> = {};
  if (mode === 'fixed') {
    patch[axis] = toPx(current);
    // A fixed main-axis size must stop flexing, and a stretching cross axis is overridden by the explicit size anyway.
    if (main) { patch.flex = null; patch['flex-grow'] = null; }
    return patch;
  }
  if (mode === 'hug') {
    if (main || abs) { patch[axis] = null; if (main) { patch.flex = null; patch['flex-grow'] = null; } }
    else if (cross) { patch[axis] = null; patch['align-self'] = 'flex-start'; }
    else patch[axis] = axis === 'width' ? 'fit-content' : null;
    return patch;
  }
  // fill
  if (main) { patch.flex = '1 1 0'; patch[axis] = null; patch[axis === 'width' ? 'min-width' : 'min-height'] = '0'; }
  else if (cross) { patch[axis] = null; patch['align-self'] = 'stretch'; }
  else patch[axis] = '100%';
  return patch;
}

// ---- Auto layout: 3x3 alignment grid -----------------------------------------------------------------------

export interface Cell { col: number; row: number } // 0..2 each, col = left..right, row = top..bottom

const POS: Record<string, number> = { 'flex-start': 0, start: 0, normal: 0, '': 0, center: 1, 'flex-end': 2, end: 2 };
const NAME = ['flex-start', 'center', 'flex-end'];

// Which cell is lit for a flex container, or null when the combination has no cell (stretch, baseline,
// space-between on the main axis). Main-axis index flips for *-reverse directions.
export function gridCell(s: StyleMap): Cell | null {
  const dir = s['flex-direction'] ?? 'row';
  const column = dir.startsWith('column');
  const reverse = dir.endsWith('reverse');
  const jc = s['justify-content'] ?? '';
  const ai = s['align-items'] ?? '';
  if (!(jc in POS) || !(ai in POS) || ai === '' || ai === 'normal') return null;
  let main = POS[jc];
  if (reverse) main = 2 - main;
  const cross = POS[ai];
  return column ? { col: cross, row: main } : { col: main, row: cross };
}

// Patch for clicking a cell. With space-between on, the main axis keeps its distribution and only the cross axis moves.
export function gridPatch(cell: Cell, s: StyleMap): Record<string, string> {
  const dir = s['flex-direction'] ?? 'row';
  const column = dir.startsWith('column');
  const reverse = dir.endsWith('reverse');
  let main = column ? cell.row : cell.col;
  const cross = column ? cell.col : cell.row;
  if (reverse) main = 2 - main;
  const patch: Record<string, string> = { 'align-items': NAME[cross] };
  const jc = s['justify-content'] ?? '';
  if (!(jc === 'space-between' || jc === 'space-around' || jc === 'space-evenly')) patch['justify-content'] = NAME[main];
  return patch;
}

// ---- Align bar -----------------------------------------------------------------------------------------------

export type AlignOp = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export interface Box { x: number; y: number; w: number; h: number }

// Offsets that move each box so it lines up with the container box (a single node aligns to its parent, several to
// their union). Returns one {dx, dy} per input box, in the boxes' own unit.
export function alignDeltas(boxes: Box[], op: AlignOp, container: Box): { dx: number; dy: number }[] {
  return boxes.map((b) => {
    switch (op) {
      case 'left': return { dx: container.x - b.x, dy: 0 };
      case 'hcenter': return { dx: container.x + container.w / 2 - (b.x + b.w / 2), dy: 0 };
      case 'right': return { dx: container.x + container.w - (b.x + b.w), dy: 0 };
      case 'top': return { dx: 0, dy: container.y - b.y };
      case 'vcenter': return { dx: 0, dy: container.y + container.h / 2 - (b.y + b.h / 2) };
      default: return { dx: 0, dy: container.y + container.h - (b.y + b.h) };
    }
  });
}

// Equal gaps between 3+ boxes along one axis: the outer two stay, the ones between are spaced evenly.
export function distributeDeltas(boxes: Box[], axis: 'x' | 'y'): { dx: number; dy: number }[] {
  const size = axis === 'x' ? 'w' : 'h';
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a][axis] - boxes[b][axis]);
  const out = boxes.map(() => ({ dx: 0, dy: 0 }));
  if (boxes.length < 3) return out;
  const first = boxes[order[0]], last = boxes[order[order.length - 1]];
  const total = last[axis] + last[size] - first[axis];
  const used = order.reduce((n, i) => n + boxes[i][size], 0);
  const gap = (total - used) / (boxes.length - 1);
  let pos = first[axis] + first[size] + gap;
  for (const i of order.slice(1, -1)) {
    const d = pos - boxes[i][axis];
    if (axis === 'x') out[i].dx = d; else out[i].dy = d;
    pos += boxes[i][size] + gap;
  }
  return out;
}

// Flow children cannot take left/top; an align op becomes a flex property instead. Cross-axis ops set the child's
// `align-self`, main-axis ops set the parent's `justify-content`. Returns null when the parent is not flex.
export function flowAlign(op: AlignOp, p: ParentInfo): { target: 'self' | 'parent'; prop: string; value: string } | null {
  if (!p.flex) return null;
  const horizontal = op === 'left' || op === 'hcenter' || op === 'right';
  const value = op === 'left' || op === 'top' ? 'flex-start' : op === 'hcenter' || op === 'vcenter' ? 'center' : 'flex-end';
  // Horizontal ops act on the main axis of a row and the cross axis of a column.
  const onMain = horizontal !== p.column;
  return onMain ? { target: 'parent', prop: 'justify-content', value } : { target: 'self', prop: 'align-self', value };
}

// ---- Stroke and shadow parsing -------------------------------------------------------------------------------

export interface Stroke { width: string; style: string; color: string }
const BORDER_STYLES = new Set(['none', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset']);
// "1px solid oklch(...)" in any order. Missing parts come back empty, so the UI can fill defaults.
export function parseStroke(v: string): Stroke {
  const out: Stroke = { width: '', style: '', color: '' };
  for (const t of splitTop(v)) {
    if (BORDER_STYLES.has(t)) out.style = t;
    else if (px(t) !== null || /^(thin|medium|thick)$/.test(t)) out.width = t;
    else out.color = t;
  }
  return out;
}
export const strokeCss = (s: Stroke) => [s.width || '1px', s.style || 'solid', s.color || 'currentColor'].join(' ');

export interface Shadow { inset: boolean; x: string; y: string; blur: string; spread: string; color: string }
// One box-shadow layer: 2-4 lengths, a colour, optional `inset`. A layer that is a bare var(--token) has lengths
// we cannot see, so it parses as colour-only and the UI falls back to a text field for it.
export function parseShadow(v: string): Shadow {
  const s: Shadow = { inset: false, x: '0px', y: '0px', blur: '0px', spread: '0px', color: '' };
  const lens: string[] = [];
  for (const t of splitTop(v)) {
    if (t === 'inset') s.inset = true;
    else if (px(t) !== null) lens.push(t);
    else s.color = t;
  }
  [s.x, s.y, s.blur, s.spread] = [lens[0] ?? s.x, lens[1] ?? s.y, lens[2] ?? s.blur, lens[3] ?? s.spread];
  return s;
}
export const shadowCss = (s: Shadow) => `${s.inset ? 'inset ' : ''}${s.x} ${s.y} ${s.blur} ${s.spread} ${s.color || 'oklch(0 0 0 / 0.2)'}`;
export const splitShadows = (v: string) => splitTop(v, ',');
// A layer the structured row can edit: only lengths, keywords and one colour.
export const isSimpleShadow = (v: string) => splitTop(v).every((t) => t === 'inset' || px(t) !== null || !/^var\(/.test(t));

// ---- Rotation ------------------------------------------------------------------------------------------------

// `rotate: 15deg` as a number; anything else (turn, rad, 3D forms) is null and handled as text.
export function rotationOf(v: string | undefined): number | null {
  if (!v) return 0;
  const m = /^(-?\d*\.?\d+)deg$/.exec(v.trim());
  return m ? parseFloat(m[1]) : null;
}
