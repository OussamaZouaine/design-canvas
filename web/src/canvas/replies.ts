// Answers to questions Claude asks the open browser tab over SSE (screenshot, computed styles, compare).
// The server cannot rasterize or measure anything itself: only a browser knows real layout, so it sends
// a request event and waits for our POST. Plain module, no React; the engine supplies the board data.
import { canvasAction } from '@/api/projects';
import type { Artboard } from '@/api/types';
import { rasterizeCanvas, type Crop } from './raster';
import { measureLayout } from './rects';
import { fontsReady } from './fonts';

export interface ReplyHost {
  projectId: string;
  themeDecls: () => string;
  findBoard: (artboardId: string) => Artboard | undefined;
  findElement: (id: string, opts?: { mount?: boolean }) => HTMLElement | null;
  // Artboard that holds a node id, plus its frame element (for measuring a crop).
  frameOf: (id: string) => HTMLElement | null;
  reference: (refId: string) => { id: string; width: number; height: number } | undefined;
}

// Token-lean defaults (an image costs about one token per 28x28 px patch): 1x, at most 1000 px wide,
// JPEG at quality 0.8 (heavier compression blurs small text). Callers can ask for more.
// With nodeId the picture is cropped to that node's box, measured from the live DOM, so the board
// is mounted first if it was showing a bitmap.
export async function screenshot(
  host: ReplyHost,
  artboardId: string,
  { nodeId, scale = 1, maxWidth = 1000, format = 'jpeg' }: { nodeId?: string; scale?: number; maxWidth?: number; format?: string } = {},
) {
  const ab = host.findBoard(artboardId);
  if (!ab) throw new Error('Artboard not found');
  let crop: Crop | undefined;
  if (nodeId) {
    const el = host.findElement(nodeId, { mount: true });
    const frame = host.frameOf(nodeId);
    if (!el || !frame) throw new Error('Node not found on the canvas');
    const f = frame.getBoundingClientRect(), r = el.getBoundingClientRect();
    const k = f.width / ab.width; // on-screen pixels per artboard unit (the current zoom)
    crop = { x: (r.left - f.left) / k, y: (r.top - f.top) / k, w: r.width / k, h: r.height / k };
  }
  const w = crop?.w ?? ab.width;
  const eff = Math.min(scale, maxWidth / w); // never exceed maxWidth, whatever scale was asked
  const canvas = await rasterizeCanvas(host.projectId, ab, eff, host.themeDecls(), crop);
  return format === 'png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.8);
}

// Resolved CSS values for some nodes. Only a laid-out DOM knows real values (used widths, resolved colours).
export function computedStyles(host: ReplyHost, nodeIds: string[], props: string[]) {
  const result: Record<string, unknown> = {};
  for (const nid of nodeIds) {
    const el = host.findElement(nid, { mount: true });
    if (!el) { result[nid] = 'not rendered'; continue; }
    const cs = getComputedStyle(el);
    result[nid] = Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
  }
  return result;
}

// Layout check for check_layout / the write results. The server sends each board's html, so the answer
// never depends on this tab having received the latest doc yet (SSE delivery order is not guaranteed
// relative to the request). Measuring mounts hidden DOM, so boards that are only snapshots work too.
export async function measure(host: ReplyHost, boards: { id: string; html: string; width: number; height: number; fit: boolean }[]) {
  await fontsReady(); // a web font changes line breaks, so measuring with the fallback would report the wrong height
  return boards.map((b) => measureLayout(b, host.themeDecls()));
}

// How close is an artboard to a reference picture? Both are drawn at the same width (at most 800 px:
// plenty for layout, cheap to compare), then every pixel pair is measured. A pixel is "different" when its
// colour distance is over 6%. The result also names the 4x4 grid cells that differ most, so a fix can start
// where it matters, and carries a diff picture (the reference as a pale backdrop, differences in red).
export async function compareToReference(host: ReplyHost, artboardId: string, refId: string) {
  const ab = host.findBoard(artboardId);
  const ref = host.reference(refId);
  if (!ab || !ref) throw new Error('Artboard or reference not found');
  const W = Math.min(800, ref.width);
  const mine = await rasterizeCanvas(host.projectId, ab, W / ab.width, host.themeDecls());
  const img = new Image();
  img.src = `/api/p/${host.projectId}/ref/${encodeURIComponent(refId)}`;
  await img.decode();
  const refH = Math.round((ref.height * W) / ref.width);
  const theirs = document.createElement('canvas');
  theirs.width = W; theirs.height = refH;
  const tctx = theirs.getContext('2d')!;
  tctx.fillStyle = '#fff'; tctx.fillRect(0, 0, W, refH);
  tctx.drawImage(img, 0, 0, W, refH);

  const H = Math.min(mine.height, refH); // compare only the area both pictures cover
  const a = mine.getContext('2d')!.getImageData(0, 0, W, H).data;
  const b = tctx.getImageData(0, 0, W, H).data;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const octx = out.getContext('2d')!;
  const diff = octx.createImageData(W, H);
  const cells = Array.from({ length: 16 }, () => ({ bad: 0, n: 0 }));
  let bad = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 765;
      const cell = cells[Math.min(3, Math.floor((y / H) * 4)) * 4 + Math.min(3, Math.floor((x / W) * 4))];
      cell.n++;
      const lum = 0.3 * b[i] + 0.59 * b[i + 1] + 0.11 * b[i + 2];
      const faded = 255 - (255 - lum) * 0.35;
      if (d > 0.06) {
        bad++; cell.bad++;
        const k = Math.min(1, 0.45 + d); // stronger colour distance, stronger red
        diff.data[i] = 255 * k + faded * (1 - k); diff.data[i + 1] = faded * (1 - k); diff.data[i + 2] = faded * (1 - k);
      } else { diff.data[i] = diff.data[i + 1] = diff.data[i + 2] = faded; }
      diff.data[i + 3] = 255;
    }
  }
  octx.putImageData(diff, 0, 0);
  const names = ['top', 'upper-middle', 'lower-middle', 'bottom'];
  const cols = ['left', 'centre-left', 'centre-right', 'right'];
  const worst = cells.map((c, i) => ({ area: `${names[Math.floor(i / 4)]} ${cols[i % 4]}`, different: Math.round((c.bad / Math.max(1, c.n)) * 100) }))
    .sort((p, q) => q.different - p.different).slice(0, 3);
  const taller = Math.max(mine.height, refH), shorter = Math.min(mine.height, refH);
  return {
    different_pct: Math.round((bad / (W * H)) * 1000) / 10,
    compared_px: `${W}x${H}`,
    worst_areas: worst,
    // Boards of different heights only overlap; say so, because the rest could not be compared.
    height_mismatch: taller - shorter > taller * 0.05
      ? `artboard is ${Math.round(mine.height / (W / ab.width))}px tall at its own scale, reference is ${Math.round(refH * (ab.width / W))}px`
      : undefined,
    dataUrl: out.toDataURL('image/jpeg', 0.8),
  };
}

// Wire one SSE request to its handler: run it, then POST the result (or the error message) back by id.
// Screenshots reply on /screenshot (legacy contract); the others on /reply.
export async function answer(projectId: string, endpoint: 'screenshot' | 'reply', id: string, run: () => unknown | Promise<unknown>) {
  const key = endpoint === 'screenshot' ? 'dataUrl' : 'result';
  try {
    await canvasAction(projectId, endpoint, { id, [key]: await run() });
  } catch (err) {
    await canvasAction(projectId, endpoint, { id, error: String((err as Error)?.message || err) }).catch(() => {});
  }
}
