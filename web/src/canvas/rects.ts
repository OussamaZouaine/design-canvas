// Rect index: a board's node boxes in board-local px, so hover/select works while the board is only a
// bitmap snapshot (zoomed out) and has no DOM to ask. Paper does the same job with a world-space model
// it hit-tests in JS; our model is the HTML string, so we measure it once per HTML version instead.

import { BOARD_CSS, boardRoot } from './contract';

export interface RectEntry {
  pid: string;
  x: number; y: number; w: number; h: number; // board-local px at scale 1
  depth: number;                              // nesting level among data-pid nodes (0 = direct child of the board)
  parent: string | null;                      // pid of the nearest data-pid ancestor, null for a direct child of the board
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

// Same wrapper, reset and theme as the engine's live frame (they share contract.ts), so what is measured
// is what the user sees.
function mountForMeasure(html: string, width: number, height: number, themeDecls: string, fit: boolean) {
  const h = measureHost();
  Object.assign(h.style, { width: width + 'px', height: height + 'px' });
  const root = h.shadowRoot!;
  root.innerHTML = `<style>:host{all:initial;display:block;font-family:system-ui,sans-serif}${BOARD_CSS}</style><style>:host{${themeDecls}}</style>${boardRoot(fit, html)}`;
  return root;
}

// What Claude asked for with check_layout: does the content fit the frame? Mounts the HTML hidden, then
// compares real boxes with the frame. `outside` keeps only the outermost offenders (their children would
// just repeat the same problem); `clipped` are nodes that hide their own overflow while having more inside.
export interface LayoutReport {
  id: string; width: number; height: number; fit: boolean;
  contentWidth: number; contentHeight: number;
  outside: { id: string; name?: string; right: number; bottom: number }[];
  clipped: { id: string; name?: string }[];
}
const MAX_FLAGGED = 12; // enough to act on; a runaway board must not produce a huge reply

export function measureLayout(b: { id: string; html: string; width: number; height: number; fit: boolean }, themeDecls: string): LayoutReport {
  const root = mountForMeasure(b.html, b.width, b.height, themeDecls, b.fit);
  const wrap = root.querySelector<HTMLElement>('[data-board-root]')!;
  const base = wrap.getBoundingClientRect();
  const outside: LayoutReport['outside'] = [];
  const clipped: LayoutReport['clipped'] = [];
  const flagged = new Set<Element>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-pid]')) {
    if (outside.length >= MAX_FLAGGED && clipped.length >= MAX_FLAGGED) break;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue; // hidden / empty
    const parent = el.parentElement?.closest('[data-pid]');
    const right = r.right - base.left, bottom = r.bottom - base.top;
    const past = right > b.width + 1 || bottom > Math.max(b.height, 0) + 1 || r.left - base.left < -1;
    // For a fit board the height grows, so only sideways overflow counts as "past the frame".
    const pastNow = b.fit ? right > b.width + 1 || r.left - base.left < -1 : past;
    if (pastNow && !(parent && flagged.has(parent)) && outside.length < MAX_FLAGGED) {
      flagged.add(el);
      outside.push({ id: el.dataset.pid!, name: el.dataset.name, right: Math.round(right), bottom: Math.round(bottom) });
    }
    const cs = getComputedStyle(el);
    const hides = (v: string) => v === 'hidden' || v === 'clip' || v === 'scroll' || v === 'auto';
    if ((hides(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) || (hides(cs.overflowY) && el.scrollHeight > el.clientHeight + 1)) {
      if (clipped.length < MAX_FLAGGED) clipped.push({ id: el.dataset.pid!, name: el.dataset.name });
    }
  }
  // scrollHeight/Width include overflowing descendants, which is exactly "how big would the content be".
  const report: LayoutReport = {
    id: b.id, width: b.width, height: b.height, fit: b.fit,
    contentWidth: Math.round(wrap.scrollWidth), contentHeight: Math.round(wrap.scrollHeight), outside, clipped,
  };
  root.replaceChildren();
  return report;
}

// Mount the board's HTML exactly as the engine does (same reset, same theme) and read every node box.
// This forces one layout, so callers do it lazily (first pick or hover on a snapshot board) and cache it.
export function measureBoard(html: string, width: number, height: number, themeDecls: string, fit = false): RectEntry[] {
  const root = mountForMeasure(html, width, height, themeDecls, fit);
  const base = root.querySelector('[data-board-root]')!.getBoundingClientRect();
  const out: RectEntry[] = [];
  const depthOf = new Map<Element, number>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-pid]')) {
    if (out.length >= MAX_ENTRIES) break;
    const r = el.getBoundingClientRect();
    const parent = el.parentElement?.closest('[data-pid]');
    const depth = parent ? (depthOf.get(parent) ?? 0) + 1 : 0;
    depthOf.set(el, depth);
    if (r.width < 1 || r.height < 1) continue; // display:none / empty nodes cannot be hit
    out.push({ pid: el.dataset.pid!, x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height, depth, parent: (parent as HTMLElement | null)?.dataset.pid ?? null });
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
