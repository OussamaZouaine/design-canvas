// Rect index: a board's node boxes in board-local px, so hover/select works while the board is only a
// bitmap snapshot (zoomed out) and has no DOM to ask. Paper does the same job with a world-space model
// it hit-tests in JS; our model is the HTML string, so we measure it once per HTML version instead.

export interface RectEntry {
  pid: string;
  x: number; y: number; w: number; h: number; // board-local px at scale 1
  depth: number;                              // nesting level among data-pid nodes (0 = direct child of the board)
}

const MAX_ENTRIES = 5000; // a runaway board must not make the index (or the measure pass) unbounded
// Nodes smaller than this on screen are not picked, so far out you grab frames and sections and zooming in
// reveals the small targets (the same idea as Paper's size-bucketed level of detail).
export const MIN_PICK_PX = 12;

let host: HTMLDivElement | null = null;

// One reusable off-screen host: measuring many boards must not create and destroy DOM each time.
function measureHost() {
  if (host) return host;
  host = document.createElement('div');
  // fixed + far off-screen + contain:strict = real layout, but no paint and no effect on the page.
  host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;contain:strict';
  document.body.appendChild(host);
  host.attachShadow({ mode: 'open' });
  return host;
}

// Mount the board's HTML exactly as the engine does (same reset, same theme) and read every node box.
// This forces one layout, so callers do it lazily (first pick or hover on a snapshot board) and cache it.
export function measureBoard(html: string, width: number, height: number, themeDecls: string): RectEntry[] {
  const h = measureHost();
  Object.assign(h.style, { width: width + 'px', height: height + 'px' });
  const root = h.shadowRoot!;
  root.innerHTML = `<style>:host{all:initial;display:block;font-family:system-ui,sans-serif}[hidden]{display:none !important}</style><style>:host{${themeDecls}}</style><div style="position:relative;width:100%;height:100%">${html}</div>`;
  const base = root.querySelector('div')!.getBoundingClientRect();
  const out: RectEntry[] = [];
  const depthOf = new Map<Element, number>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-pid]')) {
    if (out.length >= MAX_ENTRIES) break;
    const r = el.getBoundingClientRect();
    const parent = el.parentElement?.closest('[data-pid]');
    const depth = parent ? (depthOf.get(parent) ?? 0) + 1 : 0;
    depthOf.set(el, depth);
    if (r.width < 1 || r.height < 1) continue; // display:none / empty nodes cannot be hit
    out.push({ pid: el.dataset.pid!, x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height, depth });
  }
  root.replaceChildren(); // free the nodes; the host stays for the next board
  return out;
}

// Deepest node under a board-local point that is big enough to pick at this zoom. Document order means a
// later entry at the same depth paints on top, so ties go to the last one. `tol` widens thin nodes (rules, borders).
export function pickRect(entries: RectEntry[], lx: number, ly: number, k: number): RectEntry | null {
  const tol = 4 / k;
  let best: RectEntry | null = null;
  for (const e of entries) {
    if (Math.max(e.w, e.h) * k < MIN_PICK_PX) continue;
    if (lx < e.x - tol || lx > e.x + e.w + tol || ly < e.y - tol || ly > e.y + e.h + tol) continue;
    if (!best || e.depth >= best.depth) best = e;
  }
  return best;
}
