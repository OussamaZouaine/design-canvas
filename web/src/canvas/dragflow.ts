// Pure maths for dragging a node among its flow siblings (no DOM, no imports, so test/dragflow.test.mjs can run it
// in Node, like path.ts and selection.ts). The engine measures child rects in screen px and asks: where would the
// dragged nodes be inserted, which server move does that mean, and where is the blue insertion line?

export interface Rect { left: number; top: number; width: number; height: number }
export type Axis = 'x' | 'y' | 'flow';

// The direction children are laid out in, read from their boxes rather than from CSS: that covers block, flex (row
// or column) and grid with one rule. 'y' = each child starts below the previous, 'x' = each starts to its right,
// 'flow' = both (wrapping rows, grid). With fewer than two children there is nothing to read, so the CSS hint wins.
// Gotcha: row-reverse / column-reverse containers lay out against DOM order and come out as 'flow'.
export function inferAxis(rects: readonly Rect[], hint: 'x' | 'y' = 'y'): Axis {
  if (rects.length < 2) return hint;
  let below = true, right = true;
  for (let i = 1; i < rects.length; i++) {
    const p = rects[i - 1], r = rects[i];
    if (r.top < p.top + p.height - 1) below = false;
    if (r.left < p.left + p.width - 1) right = false;
  }
  return below ? 'y' : right ? 'x' : 'flow';
}

// Insertion index 0..n for a pointer (same coordinate space as the rects): the number of children that come before
// the pointer. It is the first child that does not precede it, so the answer is monotonic even for odd layouts.
// 'flow' reads like text: a child precedes the pointer when the pointer is on a later row, or on its row and right
// of the child's centre.
export function insertionIndex(rects: readonly Rect[], axis: Axis, px: number, py: number): number {
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const midX = r.left + r.width / 2, midY = r.top + r.height / 2;
    const precedes = axis === 'x' ? px > midX
      : axis === 'y' ? py > midY
        : py > r.top + r.height || (py >= r.top && px > midX);
    if (!precedes) return i;
  }
  return rects.length;
}

// Where the 2 px insertion line goes (same space as the rects) for an insertion index. `box` is the container's
// content box, used for an empty container and for the line's length across a column/row.
export function insertionLine(rects: readonly Rect[], index: number, axis: Axis, box: Rect): { left: number; top: number; width: number; height: number } {
  const n = rects.length;
  if (!n) {
    // Empty container: a line along its start edge, inset a little so it does not hide under the outline.
    return { left: box.left + 4, top: box.top + 4, width: Math.max(0, box.width - 8), height: 2 };
  }
  const prev = rects[Math.min(Math.max(index, 1), n) - 1];
  const next = rects[Math.min(index, n - 1)];
  if (axis === 'y') {
    const y = index <= 0 ? next.top : index >= n ? prev.top + prev.height : (prev.top + prev.height + next.top) / 2;
    const left = Math.min(...rects.map((r) => r.left)), right = Math.max(...rects.map((r) => r.left + r.width));
    return { left, top: y - 1, width: right - left, height: 2 };
  }
  // Row or wrapping flow: a vertical line beside the sibling it lands next to.
  const sameRow = index > 0 && index < n && prev.top < next.top + next.height && next.top < prev.top + prev.height;
  const anchor = index >= n ? prev : next;
  const x = index <= 0 ? next.left : index >= n ? prev.left + prev.width : sameRow ? (prev.left + prev.width + next.left) / 2 : next.left;
  return { left: x - 1, top: anchor.top, width: 2, height: anchor.height };
}

export interface Drop {
  target: string;                                   // id the server call names
  position: 'before' | 'after' | 'start' | 'end';
  noop: boolean;                                    // dropping here would leave the order unchanged
}

// Turn "insert at this index among the container's children" into a server move. The dragged nodes themselves are
// still in `childIds` (the original just dims), so the index is first converted to a slot among the remaining
// siblings; the move is then expressed against a sibling that stays put (before the next one, else after the last),
// or start/end of the container when nothing else is in it. `containerId` is the node (or board) that holds them.
export function resolveDrop(containerId: string, childIds: readonly string[], moving: readonly string[], index: number): Drop {
  const mv = new Set(moving);
  const rest = childIds.filter((id) => !mv.has(id));
  const slot = childIds.slice(0, index).filter((id) => !mv.has(id)).length;
  // No-op only if every moved node is already in this container and ends up in the same place relative to the others.
  const inHere = moving.every((id) => childIds.includes(id));
  let noop = false;
  if (inHere) {
    const current = childIds.filter((id) => mv.has(id));
    const next = [...rest.slice(0, slot), ...current, ...rest.slice(slot)];
    noop = next.every((id, i) => id === childIds[i]);
  }
  if (!rest.length) return { target: containerId, position: 'end', noop };
  if (slot < rest.length) return { target: rest[slot], position: 'before', noop };
  return { target: rest[rest.length - 1], position: 'after', noop };
}

// Arrow-key reorder: move the (contiguous or not) moving set one slot earlier (-1) or later (+1) among its siblings.
// Returns null at the edge, so the key does nothing. The set lands together at the first moved node's slot +/- 1.
export function stepDrop(containerId: string, childIds: readonly string[], moving: readonly string[], dir: -1 | 1): Drop | null {
  const mv = new Set(moving);
  const first = childIds.findIndex((id) => mv.has(id));
  if (first < 0) return null;
  const rest = childIds.filter((id) => !mv.has(id));
  const slot = childIds.slice(0, first).filter((id) => !mv.has(id)).length;
  const to = slot + dir;
  if (to < 0 || to > rest.length) return null;
  // Convert slot back to a child index so resolveDrop does the target maths in one place.
  let index = 0, seen = 0;
  while (index < childIds.length && seen < to) { if (!mv.has(childIds[index])) seen++; index++; }
  return resolveDrop(containerId, childIds, moving, index);
}
