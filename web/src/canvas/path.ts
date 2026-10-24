// Pure bezier-path maths for the Pen tool and path edit mode: no DOM, so node:test can import this file directly
// (test/path.test.mjs; Node strips the types). Keep it free of imports and of TypeScript-only syntax such as enums.
//
// The model is anchors with absolute handle positions, which is what an editor wants to drag around. SVG `d` strings
// are converted to it (parsePath) and back (serializePath). Only one subpath of lines and cubic/quadratic curves is
// editable; arcs and multi-subpath data return null and the caller says "this path cannot be edited".
export interface Pt { x: number; y: number }
// `in` / `out` are the handle positions (absolute, not offsets); null = no handle on that side (a corner).
export interface Anchor { p: Pt; in: Pt | null; out: Pt | null }
export interface PathModel { anchors: Anchor[]; closed: boolean }

const r2 = (v: number) => Math.round(v * 100) / 100;
const same = (a: Pt, b: Pt, eps = 1e-6) => Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const len = (a: Pt) => Math.hypot(a.x, a.y);

export const clonePath = (m: PathModel): PathModel => ({
  closed: m.closed,
  anchors: m.anchors.map((a) => ({ p: { ...a.p }, in: a.in && { ...a.in }, out: a.out && { ...a.out } })),
});

// ---- Parse -------------------------------------------------------------------------------
const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, z: 0 };

// Splits `d` into commands with their numbers. Numbers may be glued ("1.5.5", "-3-4") so a regex pulls them out.
function tokenize(d: string): { cmd: string; nums: number[] }[] | null {
  const TOKEN = /[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g;
  // Anything left once tokens and separators are removed is something we do not understand.
  if (d.replace(TOKEN, '').replace(/[\s,]+/g, '')) return null;
  const out: { cmd: string; nums: number[] }[] = [];
  for (const [t] of d.matchAll(TOKEN)) {
    if (/[a-zA-Z]/.test(t)) out.push({ cmd: t, nums: [] });
    else if (!out.length) return null;
    else out[out.length - 1].nums.push(parseFloat(t));
  }
  return out;
}

// Returns null when the data cannot be edited (arcs, several subpaths, garbage).
export function parsePath(d: string): PathModel | null {
  const toks = tokenize(d);
  if (!toks || !toks.length || toks[0].cmd.toLowerCase() !== 'm') return null;
  const anchors: Anchor[] = [];
  let closed = false;
  let cur: Pt = { x: 0, y: 0 };
  let prevCmd = '';
  // Last control point, for the smooth shorthands S and T which mirror it.
  let lastC: Pt | null = null, lastQ: Pt | null = null;
  const lastAnchor = () => anchors[anchors.length - 1];
  const cubic = (c1: Pt, c2: Pt, p: Pt) => {
    lastAnchor().out = same(c1, lastAnchor().p) ? null : c1;
    anchors.push({ p, in: same(c2, p) ? null : c2, out: null });
    cur = p; lastC = c2; lastQ = null;
  };
  for (const { cmd, nums } of toks) {
    const lower = cmd.toLowerCase();
    const rel = cmd === lower;
    if (!(lower in ARGS)) return null; // arcs (a) and anything unknown
    if (closed) return null;           // data after Z = another subpath
    const n = ARGS[lower];
    if (lower === 'z') { closed = true; prevCmd = 'z'; continue; }
    if (!nums.length || nums.length % n) return null;
    for (let i = 0; i < nums.length; i += n) {
      const a = nums.slice(i, i + n);
      const o = rel ? cur : { x: 0, y: 0 };
      // Extra coordinate pairs after M are implicit lineto.
      const eff = lower === 'm' && i > 0 ? 'l' : lower;
      if (eff === 'm') {
        if (anchors.length) return null; // second subpath
        cur = { x: a[0] + o.x, y: a[1] + o.y };
        anchors.push({ p: cur, in: null, out: null });
        lastC = lastQ = null;
      } else if (eff === 'l' || eff === 'h' || eff === 'v') {
        const p = eff === 'h' ? { x: a[0] + (rel ? cur.x : 0), y: cur.y } : eff === 'v' ? { x: cur.x, y: a[0] + (rel ? cur.y : 0) } : { x: a[0] + o.x, y: a[1] + o.y };
        anchors.push({ p, in: null, out: null });
        cur = p; lastC = lastQ = null;
      } else if (eff === 'c') {
        cubic({ x: a[0] + o.x, y: a[1] + o.y }, { x: a[2] + o.x, y: a[3] + o.y }, { x: a[4] + o.x, y: a[5] + o.y });
      } else if (eff === 's') {
        const c1 = lastC && 'cs'.includes(prevCmd) ? sub(mul(cur, 2), lastC) : cur;
        cubic(c1, { x: a[0] + o.x, y: a[1] + o.y }, { x: a[2] + o.x, y: a[3] + o.y });
      } else if (eff === 'q' || eff === 't') {
        const q = eff === 'q' ? { x: a[0] + o.x, y: a[1] + o.y } : lastQ && 'qt'.includes(prevCmd) ? sub(mul(cur, 2), lastQ) : cur;
        const p = eff === 'q' ? { x: a[2] + o.x, y: a[3] + o.y } : { x: a[0] + o.x, y: a[1] + o.y };
        // A quadratic is a cubic whose controls sit 2/3 of the way from each end to the quadratic control point.
        const from = cur;
        cubic(lerp(from, q, 2 / 3), lerp(p, q, 2 / 3), p);
        lastC = null; lastQ = q;
      }
      prevCmd = eff;
    }
  }
  // "... L first Z" and "... C ... first Z": the last anchor repeats the first, so merge them.
  if (closed && anchors.length > 2 && same(lastAnchor().p, anchors[0].p)) {
    anchors[0].in = lastAnchor().in;
    anchors.pop();
  }
  return { anchors, closed };
}

// ---- Serialize ---------------------------------------------------------------------------
const f = (v: number) => String(r2(v));
const pt = (p: Pt) => `${f(p.x)} ${f(p.y)}`;

// One segment from anchor a to anchor b: a straight line when neither has a handle on that side.
function seg(a: Anchor, b: Anchor): string {
  if (!a.out && !b.in) return `L${pt(b.p)}`;
  return `C${pt(a.out ?? a.p)} ${pt(b.in ?? b.p)} ${pt(b.p)}`;
}

export function serializePath(m: PathModel): string {
  if (!m.anchors.length) return '';
  const parts = [`M${pt(m.anchors[0].p)}`];
  for (let i = 1; i < m.anchors.length; i++) parts.push(seg(m.anchors[i - 1], m.anchors[i]));
  if (m.closed) {
    const first = m.anchors[0], last = m.anchors[m.anchors.length - 1];
    // The closing segment only needs spelling out when it is a curve; Z draws the straight one itself.
    if (last.out || first.in) parts.push(seg(last, first));
    parts.push('Z');
  }
  return parts.join('');
}

// ---- Geometry ----------------------------------------------------------------------------
// Segment i runs from anchors[i] to anchors[i+1] (the last one wraps to the first when closed).
export const segCount = (m: PathModel) => (m.closed ? m.anchors.length : Math.max(0, m.anchors.length - 1));

function segPoints(m: PathModel, i: number): [Pt, Pt, Pt, Pt] {
  const a = m.anchors[i], b = m.anchors[(i + 1) % m.anchors.length];
  return [a.p, a.out ?? a.p, b.in ?? b.p, b.p];
}

const cubicAt = ([p0, p1, p2, p3]: [Pt, Pt, Pt, Pt], t: number): Pt => {
  const u = 1 - t;
  return add(add(mul(p0, u * u * u), mul(p1, 3 * u * u * t)), add(mul(p2, 3 * u * t * t), mul(p3, t * t * t)));
};

// Tight bounds: the control points would overestimate, so find where each axis of each cubic turns around
// (roots of its derivative) and include those points.
export function pathBounds(m: PathModel): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const take = (p: Pt) => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); };
  for (const a of m.anchors) take(a.p);
  for (let i = 0; i < segCount(m); i++) {
    const s = segPoints(m, i);
    for (const axis of ['x', 'y'] as const) {
      const [a, b, c, d] = s.map((p) => p[axis]);
      // B'(t) = 3[(b-a)(1-t)^2 + 2(c-b)(1-t)t + (d-c)t^2] expanded into A t^2 + B t + C.
      const A = -a + 3 * b - 3 * c + d, B = 2 * (a - 2 * b + c), C = b - a;
      const roots: number[] = [];
      if (Math.abs(A) < 1e-9) { if (Math.abs(B) > 1e-9) roots.push(-C / B); }
      else {
        const disc = B * B - 4 * A * C;
        if (disc >= 0) { const q = Math.sqrt(disc); roots.push((-B + q) / (2 * A), (-B - q) / (2 * A)); }
      }
      for (const t of roots) if (t > 0 && t < 1) take(cubicAt(s, t));
    }
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

// Applies fn to every anchor and handle (translate, scale...).
export function mapPath(m: PathModel, fn: (p: Pt) => Pt): PathModel {
  return {
    closed: m.closed,
    anchors: m.anchors.map((a) => ({ p: fn(a.p), in: a.in && fn(a.in), out: a.out && fn(a.out) })),
  };
}

// ---- Editing -----------------------------------------------------------------------------
// Closest point on the path to `target`: coarse sampling then a local refinement, plenty for picking a segment
// with the mouse. dist is in the model's units.
export function nearestOnPath(m: PathModel, target: Pt): { seg: number; t: number; dist: number } | null {
  let best: { seg: number; t: number; dist: number } | null = null;
  const probe = (i: number, t: number) => {
    const dist = len(sub(cubicAt(segPoints(m, i), t), target));
    if (!best || dist < best.dist) best = { seg: i, t, dist };
  };
  for (let i = 0; i < segCount(m); i++) {
    for (let k = 0; k <= 24; k++) probe(i, k / 24);
    // Refine around the best sample of this segment.
    if (best && best.seg === i) {
      let lo = Math.max(0, best.t - 1 / 24), hi = Math.min(1, best.t + 1 / 24);
      for (let k = 0; k < 12; k++) {
        const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
        const d1 = len(sub(cubicAt(segPoints(m, i), m1), target)), d2 = len(sub(cubicAt(segPoints(m, i), m2), target));
        if (d1 < d2) hi = m2; else lo = m1;
      }
      probe(i, (lo + hi) / 2);
    }
  }
  return best;
}

// Splits segment `i` at t (de Casteljau) and returns the new anchor's index. The curve keeps its exact shape.
export function insertAnchor(m: PathModel, i: number, t: number): { model: PathModel; index: number } {
  const model = clonePath(m);
  const a = model.anchors[i], bIdx = (i + 1) % model.anchors.length, b = model.anchors[bIdx];
  const [p0, p1, p2, p3] = segPoints(model, i);
  const curved = !!(a.out || b.in);
  let node: Anchor;
  if (!curved) {
    node = { p: lerp(p0, p3, t), in: null, out: null };
  } else {
    const p01 = lerp(p0, p1, t), p12 = lerp(p1, p2, t), p23 = lerp(p2, p3, t);
    const p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t);
    node = { p: lerp(p012, p123, t), in: p012, out: p123 };
    a.out = p01;
    b.in = p23;
  }
  // For a closing segment (last -> first) the new anchor goes at the end of the list.
  const index = i + 1;
  model.anchors.splice(index, 0, node);
  return { model, index };
}

export function removeAnchor(m: PathModel, index: number): PathModel {
  const model = clonePath(m);
  model.anchors.splice(index, 1);
  if (model.anchors.length < 3) model.closed = false; // two points cannot enclose anything
  return model;
}

// Smooth = both handles exist and point in opposite directions (collinear through the anchor).
export function isSmooth(a: Anchor): boolean {
  if (!a.in || !a.out) return false;
  const u = sub(a.in, a.p), v = sub(a.out, a.p);
  const lu = len(u), lv = len(v);
  if (lu < 1e-6 || lv < 1e-6) return false;
  const cross = (u.x * v.y - u.y * v.x) / (lu * lv), dot = (u.x * v.x + u.y * v.y) / (lu * lv);
  return Math.abs(cross) < 0.02 && dot < 0;
}

// Corner <-> smooth. Smooth -> corner drops the handles. Corner -> smooth grows handles along the line between the
// neighbours, a third of the way to the nearer one (the usual "auto smooth" look).
export function toggleSmooth(m: PathModel, index: number): PathModel {
  const model = clonePath(m);
  const a = model.anchors[index];
  const hasHandles = !!(a.in || a.out);
  if (hasHandles) { a.in = null; a.out = null; return model; }
  const n = model.anchors.length;
  const prev = model.anchors[model.closed ? (index + n - 1) % n : Math.max(0, index - 1)];
  const next = model.anchors[model.closed ? (index + 1) % n : Math.min(n - 1, index + 1)];
  let dir = sub(next.p, prev.p);
  if (len(dir) < 1e-6) return model;
  dir = mul(dir, 1 / len(dir));
  const d = Math.min(len(sub(a.p, prev.p)) || Infinity, len(sub(next.p, a.p)) || Infinity) / 3;
  if (!isFinite(d)) return model;
  // The ends of an open path only get the handle that faces into the path.
  if (model.closed || index > 0) a.in = sub(a.p, mul(dir, d));
  if (model.closed || index < n - 1) a.out = add(a.p, mul(dir, d));
  return model;
}

// Moves an anchor with its handles.
export function moveAnchor(m: PathModel, index: number, to: Pt): PathModel {
  const model = clonePath(m);
  const a = model.anchors[index];
  const d = sub(to, a.p);
  a.p = to;
  if (a.in) a.in = add(a.in, d);
  if (a.out) a.out = add(a.out, d);
  return model;
}

// Moves one handle. A smooth anchor keeps its other handle collinear (same length, opposite direction) unless
// `independent` (Alt held) asks to break it.
export function moveHandle(m: PathModel, index: number, which: 'in' | 'out', to: Pt, independent = false): PathModel {
  const model = clonePath(m);
  const a = model.anchors[index];
  const other = which === 'in' ? 'out' : 'in';
  const wasSmooth = isSmooth(a);
  const otherLen = a[other] ? len(sub(a[other]!, a.p)) : 0;
  a[which] = to;
  if (wasSmooth && !independent) {
    const v = sub(to, a.p), l = len(v);
    if (l > 1e-6) a[other] = sub(a.p, mul(v, otherLen / l));
  }
  return model;
}

// Pen tool: dragging out of a freshly placed anchor sets symmetric handles (out follows the pointer, in mirrors it).
export function setSymmetricHandles(m: PathModel, index: number, dragTo: Pt): PathModel {
  const model = clonePath(m);
  const a = model.anchors[index];
  a.out = dragTo;
  a.in = sub(mul(a.p, 2), dragTo);
  return model;
}

// ---- Fit to an svg box -------------------------------------------------------------------
// A path svg is `viewBox="0 0 w h"` with the box sized to the path plus stroke padding. After any edit the model is
// refitted so the box hugs the path again. `model` is in px relative to the old box origin; the result gives the
// shift to apply to the svg's left/top and the new box size, with d already expressed in the new box.
export function fitToBox(m: PathModel, pad: number): { d: string; dx: number; dy: number; width: number; height: number; viewBox: string } {
  const b = pathBounds(m);
  const dx = Math.floor(b.minX - pad), dy = Math.floor(b.minY - pad);
  const width = Math.max(1, Math.ceil(b.maxX + pad) - dx), height = Math.max(1, Math.ceil(b.maxY + pad) - dy);
  const shifted = mapPath(m, (p) => ({ x: p.x - dx, y: p.y - dy }));
  return { d: serializePath(shifted), dx, dy, width, height, viewBox: `0 0 ${width} ${height}` };
}
