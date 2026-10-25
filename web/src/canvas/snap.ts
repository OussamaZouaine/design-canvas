// Pure maths for snapping and smart guides (no DOM, no imports, so test/snap.test.mjs can run it in Node, like
// dragflow.ts and path.ts). Everything is in ONE coordinate space chosen by the caller (the editor uses "screen px
// divided by zoom", so nodes and boards share it); `th` is the snap threshold in that same space (5 screen px / zoom).

export interface Box { x: number; y: number; w: number; h: number }
export type Axis = 'x' | 'y';

// A guide is a line at `pos` on its own axis ('x' = vertical line at x = pos) running from..to along the other axis.
export interface Guide { axis: Axis; pos: number; from: number; to: number }
// A distance pill: the segment a..b measured along `axis`, drawn at `at` on the other axis. `equal` marks the gaps
// that matched each other (Figma's pink "=" spacing marks).
export interface Pill { axis: Axis; a: number; b: number; at: number; value: number; equal: boolean }

export interface SnapResult { dx: number; dy: number; guides: Guide[]; pills: Pill[] }

const lo = (b: Box, a: Axis) => (a === 'x' ? b.x : b.y);
const size = (b: Box, a: Axis) => (a === 'x' ? b.w : b.h);
const hi = (b: Box, a: Axis) => lo(b, a) + size(b, a);
const mid = (b: Box, a: Axis) => lo(b, a) + size(b, a) / 2;
const other = (a: Axis): Axis => (a === 'x' ? 'y' : 'x');
const EPS = 0.5; // lines closer than this count as "on" the guide (design px)

// Smallest signed offset (target - value) within th, or null. Ties keep the first pair found.
function nearest(values: readonly number[], targets: readonly number[], th: number): number | null {
  let best: number | null = null;
  for (const v of values) for (const t of targets) {
    const d = t - v;
    if (Math.abs(d) <= th && (best === null || Math.abs(d) < Math.abs(best))) best = d;
  }
  return best;
}

// Do two boxes overlap on the axis ACROSS `a` (so a gap measured along `a` is a real neighbour, not a box far above)?
const overlapsAcross = (p: Box, q: Box, a: Axis) => {
  const c = other(a);
  return Math.min(hi(p, c), hi(q, c)) > Math.max(lo(p, c), lo(q, c));
};

// The snap offset along `a` that makes the box's gaps equal, if any is within th. Two cases:
//  between: neighbours L and R on both sides -> centre the box in the gap between them;
//  extend:  two neighbours on one side with gap g between them -> put the box at gap g from the nearer one.
function equalOffset(box: Box, others: readonly Box[], a: Axis, th: number): number | null {
  const near = others.filter((o) => overlapsAcross(box, o, a));
  const before = near.filter((o) => hi(o, a) <= lo(box, a) + EPS).sort((p, q) => hi(q, a) - hi(p, a));
  const after = near.filter((o) => lo(o, a) >= hi(box, a) - EPS).sort((p, q) => lo(p, a) - lo(q, a));
  const cands: number[] = [];
  if (before[0] && after[0]) cands.push((hi(before[0], a) + lo(after[0], a) - size(box, a)) / 2 - lo(box, a));
  if (before[0] && before[1]) cands.push(hi(before[0], a) + (lo(before[0], a) - hi(before[1], a)) - lo(box, a));
  if (after[0] && after[1]) cands.push(lo(after[0], a) - (lo(after[1], a) - hi(after[0], a)) - size(box, a) - lo(box, a));
  let best: number | null = null;
  for (const d of cands) if (Math.abs(d) <= th && (best === null || Math.abs(d) < Math.abs(best))) best = d;
  return best;
}

// Candidate lines on axis `a`: edges and centre of every sibling, and of the parent's content box.
function targetsOf(others: readonly Box[], parent: Box | null, a: Axis): number[] {
  const out: number[] = [];
  for (const o of [...others, ...(parent ? [parent] : [])]) out.push(lo(o, a), mid(o, a), hi(o, a));
  return out;
}

// Snap a moving box. `lock` skips an axis (Shift-lock already fixed it). Each axis snaps independently to the nearest
// candidate; an equal-spacing match competes with the line snaps and wins only when strictly closer.
export function snapMove(box: Box, others: readonly Box[], parent: Box | null, th: number, lock: { x?: boolean; y?: boolean } = {}): SnapResult {
  const d = { x: 0, y: 0 };
  for (const a of ['x', 'y'] as Axis[]) {
    if (lock[a]) continue;
    const line = nearest([lo(box, a), mid(box, a), hi(box, a)], targetsOf(others, parent, a), th);
    const eq = equalOffset(box, others, a, th);
    d[a] = eq !== null && (line === null || Math.abs(eq) < Math.abs(line)) ? eq : line ?? 0;
  }
  const out = { ...box, x: box.x + d.x, y: box.y + d.y };
  return { dx: d.x, dy: d.y, ...annotate(out, others, parent) };
}

// Resize: only the edges that move may snap (no centres: the centre of a box being stretched is not what you aim at).
// `dir` is the handle ('e', 'nw'...). Returns the adjusted box; the opposite edge stays put.
export function snapResize(box: Box, dir: string, others: readonly Box[], parent: Box | null, th: number): SnapResult & { box: Box } {
  const b = { ...box };
  const edge = (a: Axis, side: 'lo' | 'hi') => (side === 'lo' ? lo(b, a) : hi(b, a));
  for (const a of ['x', 'y'] as Axis[]) {
    const moves = a === 'x' ? { lo: dir.includes('w'), hi: dir.includes('e') } : { lo: dir.includes('n'), hi: dir.includes('s') };
    for (const side of ['lo', 'hi'] as const) {
      if (!moves[side]) continue;
      const d = nearest([edge(a, side)], targetsOf(others, parent, a), th);
      if (d === null) continue;
      if (a === 'x') { if (side === 'lo') { b.x += d; b.w -= d; } else b.w += d; }
      else if (side === 'lo') { b.y += d; b.h -= d; } else b.h += d;
    }
  }
  return { dx: b.x - box.x, dy: b.y - box.y, box: b, ...annotate(b, others, parent) };
}

// Guides + distance pills for a box already at its final position.
export function annotate(box: Box, others: readonly Box[], parent: Box | null): { guides: Guide[]; pills: Pill[] } {
  const guides: Guide[] = [];
  const cands = [...others, ...(parent ? [parent] : [])];
  for (const a of ['x', 'y'] as Axis[]) {
    const c = other(a);
    for (const mine of [lo(box, a), mid(box, a), hi(box, a)]) {
      for (const o of cands) {
        for (const theirs of [lo(o, a), mid(o, a), hi(o, a)]) {
          if (Math.abs(theirs - mine) > EPS) continue;
          // A guide spans both boxes along the other axis so it visibly connects them.
          const from = Math.min(lo(box, c), lo(o, c)), to = Math.max(hi(box, c), hi(o, c));
          if (!guides.some((g) => g.axis === a && Math.abs(g.pos - theirs) < EPS && g.from === from && g.to === to)) guides.push({ axis: a, pos: theirs, from, to });
        }
      }
    }
  }
  return { guides, pills: gapPills(box, others, parent) };
}

// Distance to the nearest neighbour on each of the four sides (parent edge when a side has no sibling), plus the
// equal-spacing marks: gaps that match another gap next to them are flagged `equal`.
export function gapPills(box: Box, others: readonly Box[], parent: Box | null): Pill[] {
  const pills: Pill[] = [];
  for (const a of ['x', 'y'] as Axis[]) {
    const c = other(a);
    const near = others.filter((o) => overlapsAcross(box, o, a));
    const before = near.filter((o) => hi(o, a) <= lo(box, a) + EPS).sort((p, q) => hi(q, a) - hi(p, a));
    const after = near.filter((o) => lo(o, a) >= hi(box, a) - EPS).sort((p, q) => lo(p, a) - lo(q, a));
    const across = (o: Box) => (Math.max(lo(box, c), lo(o, c)) + Math.min(hi(box, c), hi(o, c))) / 2;
    const gaps: Pill[] = [];
    const L = before[0], R = after[0];
    if (L) gaps.push({ axis: a, a: hi(L, a), b: lo(box, a), at: across(L), value: lo(box, a) - hi(L, a), equal: false });
    else if (parent && lo(box, a) > lo(parent, a) + EPS && hi(box, a) <= hi(parent, a) + EPS) gaps.push({ axis: a, a: lo(parent, a), b: lo(box, a), at: mid(box, c), value: lo(box, a) - lo(parent, a), equal: false });
    if (R) gaps.push({ axis: a, a: hi(box, a), b: lo(R, a), at: across(R), value: lo(R, a) - hi(box, a), equal: false });
    else if (parent && hi(box, a) < hi(parent, a) - EPS && lo(box, a) >= lo(parent, a) - EPS) gaps.push({ axis: a, a: hi(box, a), b: hi(parent, a), at: mid(box, c), value: hi(parent, a) - hi(box, a), equal: false });
    // Equal marks: the two sides match, or a side matches the existing gap one step further out.
    if (L && R && Math.abs(gaps[0].value - gaps[1].value) <= EPS) { gaps[0].equal = true; gaps[1].equal = true; }
    if (L && before[1]) {
      const g = lo(L, a) - hi(before[1], a);
      if (Math.abs(g - (lo(box, a) - hi(L, a))) <= EPS) {
        gaps[0].equal = true;
        pills.push({ axis: a, a: hi(before[1], a), b: lo(L, a), at: across(before[1]), value: g, equal: true });
      }
    }
    if (R && after[1]) {
      const g = lo(after[1], a) - hi(R, a);
      if (Math.abs(g - (lo(R, a) - hi(box, a))) <= EPS) {
        gaps[gaps.length - 1].equal = true;
        pills.push({ axis: a, a: hi(R, a), b: lo(after[1], a), at: across(after[1]), value: g, equal: true });
      }
    }
    pills.push(...gaps.filter((g) => g.value > EPS));
  }
  return pills;
}

// Alt-measure: distances from the selection box `a` to the hovered box `b`. When b contains a (its parent), the four
// inner margins; when they are apart, the gap per axis; when they overlap on an axis, the edge-to-edge offsets.
export function measure(a: Box, b: Box): Pill[] {
  const pills: Pill[] = [];
  for (const ax of ['x', 'y'] as Axis[]) {
    const c = other(ax);
    const at = (Math.max(lo(a, c), lo(b, c)) + Math.min(hi(a, c), hi(b, c))) / 2;
    const atAny = Math.min(hi(a, c), hi(b, c)) > Math.max(lo(a, c), lo(b, c)) ? at : mid(a, c);
    if (hi(a, ax) <= lo(b, ax)) pills.push({ axis: ax, a: hi(a, ax), b: lo(b, ax), at: atAny, value: lo(b, ax) - hi(a, ax), equal: false });
    else if (hi(b, ax) <= lo(a, ax)) pills.push({ axis: ax, a: hi(b, ax), b: lo(a, ax), at: atAny, value: lo(a, ax) - hi(b, ax), equal: false });
    else {
      // Overlapping on this axis: show how far each pair of edges is apart (leading and trailing).
      const d1 = lo(a, ax) - lo(b, ax), d2 = hi(b, ax) - hi(a, ax);
      if (Math.abs(d1) > EPS) pills.push({ axis: ax, a: Math.min(lo(a, ax), lo(b, ax)), b: Math.max(lo(a, ax), lo(b, ax)), at: mid(a, c), value: Math.abs(d1), equal: false });
      if (Math.abs(d2) > EPS) pills.push({ axis: ax, a: Math.min(hi(a, ax), hi(b, ax)), b: Math.max(hi(a, ax), hi(b, ax)), at: mid(a, c), value: Math.abs(d2), equal: false });
    }
  }
  return pills;
}

// Resize with modifiers, from the start box and the pointer delta (design px). Shift keeps the aspect ratio (a corner
// follows the dominant axis; an edge handle drives the other dimension too), Alt grows from the centre. Pure so the
// maths is testable; snapping is applied by the caller afterwards on the moving edges.
export function resizeBox(start: Box, dir: string, dx: number, dy: number, o: { shift?: boolean; alt?: boolean; min?: number } = {}): Box {
  const min = o.min ?? 4;
  const mx = dir.includes('e') ? 1 : dir.includes('w') ? -1 : 0, my = dir.includes('s') ? 1 : dir.includes('n') ? -1 : 0;
  // Alt mirrors the drag on the opposite edge, so the same delta changes the size twice as much.
  const k = o.alt ? 2 : 1;
  let w = start.w + mx * dx * k, h = start.h + my * dy * k;
  if (o.shift && start.w > 0 && start.h > 0) {
    const r = start.w / start.h;
    if (mx && my) {
      // Corner: the axis the pointer has stretched proportionally more drives the other.
      if (Math.abs(w / start.w - 1) >= Math.abs(h / start.h - 1)) h = w / r; else w = h * r;
    } else if (mx) h = w / r; else if (my) w = h * r;
  }
  if (o.shift && start.w > 0 && start.h > 0) {
    // Clamp on the ratio, not per axis, so the minimum can never distort the shape.
    const r = start.w / start.h;
    w = Math.max(w, min, min * r); h = w / r;
  } else { w = Math.max(min, w); h = Math.max(min, h); }
  // Anchor: Alt = centre; else the edge opposite the handle. An edge-only handle keeps the cross axis centred when
  // Shift changed it (Figma does the same), otherwise the cross axis does not move.
  const grow = (pos: number, len0: number, len: number, m: number, cross: boolean) => {
    if (o.alt) return pos - (len - len0) / 2;
    if (m < 0) return pos + len0 - len;
    if (m > 0) return pos;
    return cross ? pos - (len - len0) / 2 : pos;
  };
  const cross = !!o.shift;
  return { x: grow(start.x, start.w, w, mx, cross), y: grow(start.y, start.h, h, my, cross), w, h };
}

// Scale a member box inside the union box when the union goes from `from` to `to` (multi-resize). Each member keeps
// its relative position and size within the union.
export function scaleInto(m: Box, from: Box, to: Box): Box {
  const sx = from.w ? to.w / from.w : 1, sy = from.h ? to.h / from.h : 1;
  return { x: to.x + (m.x - from.x) * sx, y: to.y + (m.y - from.y) * sy, w: m.w * sx, h: m.h * sy };
}

export const unionOf = (boxes: readonly Box[]): Box | null => {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
};
