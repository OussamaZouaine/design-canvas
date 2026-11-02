// Pure maths for the canvas minimap (no DOM, erasable TS only so node:test can import it).
// World = canvas units; map = minimap pixels. The map always shows the union of every board and the current
// viewport, so the viewport rectangle can never fall outside the map while the user pans away from the boards.

export interface Rect { x: number; y: number; w: number; h: number }
export interface MapFit { minX: number; minY: number; s: number; ox: number; oy: number }

// Union of rects (null for none).
export function unionRects(rs: Rect[]): Rect | null {
  if (!rs.length) return null;
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Scale + offset that fit `world` inside a `w` x `h` box with `pad` px margin, centred. The zero-size guard
// keeps a single empty board from dividing by zero.
export function fitWorld(world: Rect, w: number, h: number, pad = 6): MapFit {
  const s = Math.min((w - 2 * pad) / Math.max(1, world.w), (h - 2 * pad) / Math.max(1, world.h));
  return { minX: world.x, minY: world.y, s, ox: (w - world.w * s) / 2, oy: (h - world.h * s) / 2 };
}

export const toMap = (f: MapFit, r: Rect): Rect => ({ x: f.ox + (r.x - f.minX) * f.s, y: f.oy + (r.y - f.minY) * f.s, w: r.w * f.s, h: r.h * f.s });

// Minimap point -> world point (where the camera should centre).
export const toWorld = (f: MapFit, mx: number, my: number) => ({ x: f.minX + (mx - f.ox) / f.s, y: f.minY + (my - f.oy) / f.s });

// Camera (screen = world * k + x/y) -> the world rectangle the viewport shows.
export const viewRect = (v: { x: number; y: number; k: number }, vw: number, vh: number): Rect => ({ x: -v.x / v.k, y: -v.y / v.k, w: vw / v.k, h: vh / v.k });

// Camera translation that centres world point (wx, wy) in a vw x vh viewport at zoom k.
export const centerCamera = (wx: number, wy: number, k: number, vw: number, vh: number) => ({ x: vw / 2 - wx * k, y: vh / 2 - wy * k });
