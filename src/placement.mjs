// Where artboards go on the canvas, so agents never stack one board on top of another.
// Pure functions over plain {x, y, width, height} boxes (tested by test/placement.test.mjs); Doc calls them
// with the boards of one page. Boards are laid out in rows: related boards sit side by side, so a clash is
// always resolved by sliding RIGHT along the same row, never by jumping to some other free hole.

export const GAP = 120; // space between neighbouring boards, same as the default placement always used

// Two boxes overlap when they intersect once each is padded by `gap` (touching or too-close counts as a clash).
const hits = (a, b, gap) =>
  a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

// Boards that share some vertical span with [y, y + height]: the "row" a new board joins.
const rowOf = (boards, y, height) => boards.filter((b) => b.y < y + height && y < b.y + b.height);

// First free x for a board of this size at row `y`. Without `x` it goes after the last board of that row
// (or at 0 for an empty row); with `x` it starts there. Either way it then slides right past every board it
// would cover. Each step moves past a board's right edge, so the loop ends after at most boards.length steps.
export function freeSpot(boards, { x, y = 0, width, height }, gap = GAP) {
  const row = rowOf(boards, y, height);
  let nx = x ?? (row.length ? Math.max(...row.map((b) => b.x + b.width)) + gap : 0);
  for (let i = 0; i <= boards.length; i++) {
    const clash = boards.filter((b) => hits({ x: nx, y, width, height }, b, gap));
    if (!clash.length) break;
    nx = Math.max(...clash.map((b) => b.x + b.width)) + gap;
  }
  return { x: nx, y };
}

// A `fit` board grew from `oldHeight` to its current height: push the boards that were below it (and share
// some horizontal span) down just enough to keep `gap` between them. A pushed board can in turn push the
// ones below it, so this works top to bottom. Returns the boards it moved (mutated in place).
export function pushBelow(boards, grown, oldHeight, gap = GAP) {
  const moved = [];
  const queue = [{ box: grown, oldBottom: grown.y + oldHeight }];
  while (queue.length) {
    const { box, oldBottom } = queue.shift();
    const bottom = box.y + box.height;
    for (const b of boards) {
      if (b === box || b.y < oldBottom) continue; // only boards that started below this one's old bottom edge
      if (!(b.x < box.x + box.width && box.x < b.x + b.width)) continue; // not in the same column
      const need = bottom + gap - b.y;
      if (need <= 0) continue;
      const before = b.y + b.height;
      b.y += need;
      if (!moved.includes(b)) moved.push(b);
      queue.push({ box: b, oldBottom: before });
    }
  }
  return moved;
}
