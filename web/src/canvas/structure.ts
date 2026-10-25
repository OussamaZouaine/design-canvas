// Pure maths for grouping (Ctrl+G), "Add auto layout" (Shift+A) and ungrouping (Ctrl+Shift+G).
// DOM-free so test/structure.test.mjs can run it in Node: keep it import-free and erasable-TS only.
// The browser measures the nodes (design px, all relative to the SAME offset parent) and this decides what the new
// wrapper's inline styles are and how the members must be restyled so nothing visibly jumps.

export interface Box { x: number; y: number; w: number; h: number }
export interface Item { id: string; box: Box; abs: boolean }
export type Styles = Record<string, string | null>;
export interface WrapPlan { styles: Styles; perId: Record<string, Styles> }
export type FlowAxis = 'x' | 'y' | 'flow';

const px = (n: number) => `${Math.round(n)}px`;

export function unionBox(boxes: readonly Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w)), b = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: b - y };
}

// Gap to give the wrapper: the median of the positive spacings between neighbours along the axis. A median (not the
// mean) so one oddly spaced item cannot skew a list of evenly spaced ones. 'flow' (wrapping rows) looks at both axes.
// Overlaps and a single item give 0.
export function measureGap(boxes: readonly Box[], axis: FlowAxis): number {
  const gaps: number[] = [];
  for (let i = 1; i < boxes.length; i++) {
    const p = boxes[i - 1], n = boxes[i];
    const dx = n.x - (p.x + p.w), dy = n.y - (p.y + p.h);
    const v = axis === 'x' ? dx : axis === 'y' ? dy : Math.max(dx, dy);
    if (v > 0) gaps.push(v);
  }
  if (!gaps.length) return 0;
  gaps.sort((a, b) => a - b);
  return Math.round(gaps[Math.floor(gaps.length / 2)]);
}

// mode 'group' (Ctrl+G): a plain container that must not change how anything looks.
//   - all flow nodes: a flex wrapper (direction from the layout, measured gap) that takes the first node's slot;
//   - all absolute nodes: an absolute wrapper over their union box, members re-based on its corner.
// mode 'auto' (Shift+A): like group, but absolute nodes become flow children of an absolute flex wrapper.
// Flow and absolute nodes mixed cannot share one wrapper without moving something: returns null.
export function planWrap(items: readonly Item[], mode: 'group' | 'auto', axis: FlowAxis): WrapPlan | null {
  if (!items.length) return null;
  const abs = items.filter((i) => i.abs).length;
  if (abs && abs !== items.length) return null;
  const boxes = items.map((i) => i.box);
  const flex = (): Styles => {
    const gap = measureGap(boxes, axis);
    return axis === 'x' ? { display: 'flex', flexDirection: 'row', gap: px(gap) }
      : axis === 'y' ? { display: 'flex', flexDirection: 'column', gap: px(gap) }
        : { display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: px(gap) };
  };
  if (!abs) return { styles: flex(), perId: {} };
  const u = unionBox(boxes);
  const place: Styles = { position: 'absolute', left: px(u.x), top: px(u.y) };
  if (mode === 'group') {
    const perId: Record<string, Styles> = {};
    for (const i of items) perId[i.id] = { left: px(i.box.x - u.x), top: px(i.box.y - u.y) };
    return { styles: { ...place, width: px(u.w), height: px(u.h) }, perId };
  }
  // Auto layout: the members stop being absolute (null removes the property), the wrapper hugs them at the old spot.
  const perId: Record<string, Styles> = {};
  for (const i of items) perId[i.id] = { position: null, left: null, top: null, right: null, bottom: null };
  return { styles: { ...place, ...flex() }, perId };
}

// Ungroup: absolute members of an absolute wrapper were positioned relative to it, so they move by the wrapper's
// offset to stay where they are on screen. Anything else keeps its styles (flow members just join the parent's flow).
export function planUnwrap(wrapper: { abs: boolean; x: number; y: number }, kids: readonly { id: string; abs: boolean; x: number; y: number }[]): Record<string, Styles> {
  const perId: Record<string, Styles> = {};
  if (!wrapper.abs) return perId;
  for (const k of kids) if (k.abs) perId[k.id] = { left: px(k.x + wrapper.x), top: px(k.y + wrapper.y) };
  return perId;
}
