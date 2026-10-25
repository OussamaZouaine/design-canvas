// Pure selection logic (no DOM, no imports) so it can be unit-tested by test/selection.test.mjs, like path.ts.
// The engine feeds it ids and a `parentOf` lookup; it answers "what does this click select" and keeps the set sane.
// Ids are node ids (data-pid) or board ids (start with "A"). A "chain" is the ancestor path of a hit,
// deepest node first and the board's top-level child last (the board itself is never part of it).

export interface Box { left: number; top: number; width: number; height: number }

// Figma-style pick. Plain click: the child of the current context on the way down to the hit (the top-level node
// while the context is null). A node that is already selected and lies under the pointer stays the target, so a
// selected inner node can be dragged without first re-picking its parent. Returns the new context too, because a
// click outside the old context leaves it.
export function pickInChain(chain: string[], context: string | null, selected: readonly string[]): string | null {
  if (!chain.length) return null;
  const sel = chain.find((id) => selected.includes(id));
  if (sel) return sel;
  if (context == null) return chain[chain.length - 1];
  const i = chain.indexOf(context);
  if (i < 0) return chain[chain.length - 1]; // clicked outside the context: back to board level
  return i === 0 ? context : chain[i - 1];   // the context itself when the click hit its own empty area
}

// Ctrl/Cmd+click: the deepest hit, except that a locked subtree is one unit (its outermost locked ancestor).
export function pickDeep(chain: string[], isLocked: (id: string) => boolean): string | null {
  if (!chain.length) return null;
  let pick = chain[0];
  for (const id of chain) if (isLocked(id)) pick = id; // keeps overwriting: ends on the outermost locked node
  return pick;
}

// Double-click on a selected node: the child under the pointer, or null when the selected node is the deepest hit.
export function enterTarget(chain: string[], primary: string | null): string | null {
  if (!primary) return null;
  const i = chain.indexOf(primary);
  return i > 0 ? chain[i - 1] : null;
}

// Shift+click: add when absent, remove when present. The toggled id becomes the primary (last).
export function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

// A node and one of its own descendants are never selected together. The later entry wins in both directions:
// adding a parent swallows its selected children, adding a child replaces its selected parent.
export function normalize(ids: readonly string[], parentOf: (id: string) => string | null): string[] {
  const uniq = ids.filter((id, i) => ids.lastIndexOf(id) === i); // a repeated id keeps its newest position
  const isAncestor = (a: string, of: string) => {
    for (let p = parentOf(of), guard = 0; p && guard < 200; p = parentOf(p), guard++) if (p === a) return true;
    return false;
  };
  const kept: string[] = [];
  for (let i = uniq.length - 1; i >= 0; i--) {
    if (!kept.some((k) => isAncestor(uniq[i], k) || isAncestor(k, uniq[i]))) kept.unshift(uniq[i]);
  }
  return kept;
}

export function unionBox(boxes: readonly Box[]): Box | null {
  if (!boxes.length) return null;
  const l = Math.min(...boxes.map((b) => b.left)), t = Math.min(...boxes.map((b) => b.top));
  const r = Math.max(...boxes.map((b) => b.left + b.width)), b = Math.max(...boxes.map((x) => x.top + x.height));
  return { left: l, top: t, width: r - l, height: b - t };
}

// Figma marquee semantics: touching is enough (intersect, not contain).
export function intersects(a: Box, b: Box): boolean {
  return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
}

// Tab / Shift+Tab: the next or previous sibling, wrapping around. Null when the node has no siblings.
export function siblingStep(siblings: readonly string[], id: string, dir: 1 | -1): string | null {
  const i = siblings.indexOf(id);
  if (i < 0 || siblings.length < 2) return null;
  return siblings[(i + dir + siblings.length) % siblings.length];
}

// Shift-click in the Layers panel extends a range from the anchor row to the clicked row (rows in display order).
export function rangeIds(order: readonly string[], anchor: string, to: string): string[] {
  const a = order.indexOf(anchor), b = order.indexOf(to);
  if (a < 0 || b < 0) return [to];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}
