// Pure clipboard model for copy / cut / paste of layers and frames: no DOM and no imports, so node:test can import this
// file directly (test/clipboard.test.mjs; Node strips the types). Keep it free of TypeScript-only syntax such as enums.
//
// One payload describes what was copied. It is plain JSON so it can live in localStorage and cross projects and tabs.
export interface ClipItem {
  html: string;                 // outer HTML of a layer, or the whole content of a frame
  id?: string;                  // source id (frame id for boards): kept on paste only after a cut
  name?: string;
  x?: number; y?: number;       // frames only: position on the source page
  width?: number; height?: number;
  heightMode?: string;
}
export interface ClipPayload {
  v: 1;
  kind: 'nodes' | 'boards';
  cut: boolean;                 // the source was removed: paste may keep ids so comments stay attached
  from: { project: string; page: string | null };
  items: ClipItem[];
  t: number;
}
export interface Rect { x: number; y: number; width: number; height: number }

export const CLIP_VERSION = 1;
export const MAX_CLIP_BYTES = 2_000_000;
export const BOARD_GAP = 120; // same gap Doc.createArtboard leaves between frames

export function buildPayload(kind: ClipPayload['kind'], items: ClipItem[], from: ClipPayload['from'], cut: boolean, t = Date.now()): ClipPayload | null {
  const keep = items.filter((i) => i && typeof i.html === 'string' && i.html.trim());
  if (!keep.length) return null;
  return { v: 1, kind, cut, from, items: keep, t };
}

// Accepts the raw localStorage string (or an object). Anything that is not a well-formed payload is dropped: another
// tab, an older build or the user can put arbitrary text there, and the server sanitizes the HTML again on paste.
export function parsePayload(raw: unknown): ClipPayload | null {
  let v: any = raw;
  if (typeof raw === 'string') {
    if (raw.length > MAX_CLIP_BYTES) return null;
    try { v = JSON.parse(raw); } catch { return null; }
  }
  if (!v || typeof v !== 'object' || v.v !== CLIP_VERSION) return null;
  if (v.kind !== 'nodes' && v.kind !== 'boards') return null;
  if (!Array.isArray(v.items) || !v.items.length || v.items.length > 200) return null;
  if (!v.from || typeof v.from.project !== 'string') return null;
  const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : undefined);
  const items: ClipItem[] = [];
  for (const i of v.items) {
    if (!i || typeof i.html !== 'string' || !i.html.trim()) return null;
    items.push({
      html: i.html,
      id: typeof i.id === 'string' ? i.id : undefined,
      name: typeof i.name === 'string' ? i.name.slice(0, 200) : undefined,
      x: num(i.x), y: num(i.y), width: num(i.width), height: num(i.height),
      heightMode: typeof i.heightMode === 'string' ? i.heightMode : undefined,
    });
  }
  if (v.kind === 'boards' && items.some((i) => num(i.width) === undefined || num(i.height) === undefined)) return null;
  return { v: 1, kind: v.kind, cut: !!v.cut, from: { project: v.from.project, page: typeof v.from.page === 'string' ? v.from.page : null }, items, t: num(v.t) ?? 0 };
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// New x/y for pasted frames. The group keeps its internal layout. It stays where it was copied from when that spot is
// free on the target page (a cut, or another page / project); otherwise it goes to the right of the rightmost frame so
// a plain paste next to the originals never stacks on them. `inPlace` (Ctrl+Shift+V) always keeps the spot.
export function placeBoards(items: ClipItem[], existing: Rect[], inPlace = false): { x: number; y: number }[] {
  const rects = items.map((i) => ({ x: i.x ?? 0, y: i.y ?? 0, width: i.width ?? 0, height: i.height ?? 0 }));
  if (!rects.length) return [];
  if (inPlace || !rects.some((r) => existing.some((e) => overlaps(r, e)))) return rects.map((r) => ({ x: r.x, y: r.y }));
  const left = Math.min(...rects.map((r) => r.x));
  const right = existing.reduce((m, e) => Math.max(m, e.x + e.width), -BOARD_GAP);
  const dx = right + BOARD_GAP - left;
  return rects.map((r) => ({ x: r.x + dx, y: r.y }));
}

export interface PasteSel { id: string; isBoard: boolean; hasChildren: boolean }

// Where layers land. A selected frame or container receives them (last child); a selected leaf gets them right after
// it. With nothing selected they go to `fallbackBoard` (the frame under the viewport centre); null = nowhere to paste.
export function pasteTarget(sel: PasteSel | null, fallbackBoard: string | null): { target: string; position: 'append' | 'after' } | null {
  if (sel) return { target: sel.id, position: sel.isBoard || sel.hasChildren ? 'append' : 'after' };
  return fallbackBoard ? { target: fallbackBoard, position: 'append' } : null;
}
