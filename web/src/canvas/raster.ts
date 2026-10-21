// Bitmap side of the canvas: turning an artboard's HTML into pixels, and caching those pixels.
// Plain module (no React). The engine uses it for zoomed-out snapshots now; Phase 4 reuses
// rasterizeCanvas for the get_screenshot / compare_to_reference replies.
import type { Artboard } from '@/api/types';
import { BOARD_CSS, boardRoot } from './contract';
import { embeddedFontCss } from './fonts';

// FNV-1a: a fast non-cryptographic hash, good enough as a cache key for "did this HTML change".
export const hashStr = (str: string) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36) + str.length.toString(36);
};

// ---- IndexedDB blob cache -------------------------------------------------------
// Same database and store name as the legacy client, so snapshots rendered by either app are reused.
let dbPromise: Promise<IDBDatabase | null> | null = null;
const openDb = () => (dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
  try {
    const rq = indexedDB.open('design-canvas-thumbs', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('t');
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => resolve(null);
  } catch {
    resolve(null); // private mode etc.: run without the persistent cache
  }
}));

export async function thumbGet(key: string): Promise<Blob | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const q = db.transaction('t').objectStore('t').get(key);
    q.onsuccess = () => resolve((q.result as Blob | undefined) ?? null);
    q.onerror = () => resolve(null);
  });
}

export async function thumbPut(key: string, blob: Blob) {
  const db = await openDb();
  if (!db) return;
  try {
    db.transaction('t', 'readwrite').objectStore('t').put(blob, key);
  } catch { /* quota exceeded: the snapshot just will not persist */ }
}

// ---- Rasterizing ------------------------------------------------------------------
export interface Crop { x: number; y: number; w: number; h: number }

// Turn an artboard's HTML into a canvas: wrap it in an SVG foreignObject, load that as an image, draw
// the image onto a canvas. Limit: only inline styles and data: images survive, because the SVG is
// rendered in isolation (no network, no page CSS).
export async function rasterizeCanvas(
  projectId: string,
  ab: Artboard,
  scale: number,
  themeDecls: string,
  crop: Crop = { x: 0, y: 0, w: ab.width, h: ab.height },
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(crop.w * scale));
  canvas.height = Math.max(1, Math.round(crop.h * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; // JPEG has no alpha: without this, transparent areas turn black
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // A reference board is just a picture. The SVG route cannot load http images, so draw it directly.
  if (ab.generated === 'reference' && ab.ref) {
    const img = new Image();
    img.src = `/api/p/${projectId}/ref/${encodeURIComponent(ab.ref)}`;
    await img.decode();
    const k = Math.min((ab.width * scale) / img.naturalWidth, (ab.height * scale) / img.naturalHeight); // object-fit: contain
    const w = img.naturalWidth * k, h = img.naturalHeight * k;
    ctx.drawImage(img, (ab.width * scale - w) / 2 - crop.x * scale, (ab.height * scale - h) / 2 - crop.y * scale, w, h);
    return canvas;
  }

  // The SVG cannot fetch anything, so the faces this board uses travel inside it as data: URIs.
  const fontCss = await embeddedFontCss(ab.html);
  const holder = document.createElement('div');
  holder.innerHTML = ab.html;
  // HTML -> well-formed XML (SVG requires it), minus the holder div. The hidden rule is added AFTER
  // stripping because the strip regex anchors on the holder's opening tag at the very start.
  const xhtml = `<style>${fontCss}${BOARD_CSS}</style>`
    + boardRoot(ab.heightMode === 'fit', new XMLSerializer().serializeToString(holder).replace(/^<div[^>]*>|<\/div>$/g, ''));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ab.width}" height="${ab.height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${ab.width}px;height:${ab.height}px;background:#fff;overflow:hidden;font-family:system-ui,sans-serif;${themeDecls.replace(/"/g, '&quot;')}">${xhtml}</div></foreignObject></svg>`;
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  ctx.scale(scale, scale);
  ctx.drawImage(img, -crop.x, -crop.y); // shifting the origin is how the crop is taken
  return canvas;
}
