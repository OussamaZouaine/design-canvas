// Browser side of export: turns one or more canvas items (artboards or layers) into PNG / JPG / SVG / PDF files,
// and hands several files over as one zip. Plain module (no React). Pure maths lives in lib/exportspec.ts,
// the zip and PDF writers in lib/zip.ts and lib/pdf.ts.
import type { Artboard } from '@/api/types';
import { fileNames, outputSize, safeName, type ExportFormat, type ExportRow } from '@/lib/exportspec';
import { makePdf } from '@/lib/pdf';
import { makeZip, type ZipEntry } from '@/lib/zip';
import { boardSvg, rasterizeCanvas, type Crop } from './raster';
import { cropOf, type ReplyHost } from './replies';

export interface ExportItem { id: string; name: string }
export interface ExportResult { name: string; blob: Blob; count: number; clamped: boolean }

const MIME: Record<ExportFormat | 'zip', string> = { png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml', pdf: 'application/pdf', zip: 'application/zip' };

// What an id points at: its board, the box to draw (the whole board, or the node's box inside it).
function target(host: ReplyHost, id: string): { ab: Artboard; crop: Crop; isNode: boolean } {
  const ab = host.findBoard(host.boardIdOf(id) ?? '');
  if (!ab) throw new Error('Artboard not found');
  if (id.startsWith('A')) return { ab, crop: { x: 0, y: 0, w: ab.width, h: ab.height }, isNode: false };
  return { ab, crop: cropOf(host, ab, id), isNode: true };
}

export function boxOf(host: ReplyHost, id: string) {
  const { crop } = target(host, id);
  return { w: crop.w, h: crop.h };
}

// Pixels for one item at a scale (a multiplier, or "512w" / "512h"). A layer is isolated, and its PNG keeps alpha.
export async function renderCanvas(host: ReplyHost, id: string, scale: string, transparent = false) {
  const { ab, crop, isNode } = target(host, id);
  const size = outputSize({ w: crop.w, h: crop.h }, scale);
  const canvas = await rasterizeCanvas(host.projectId, ab, size.k, host.themeDecls(), crop, { isolate: isNode ? id : undefined, transparent: isNode && transparent });
  return { canvas, size };
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The browser could not encode the image (too large?)'))), type, quality));

async function svgFor(host: ReplyHost, id: string, scale: string): Promise<Blob> {
  const { ab, crop, isNode } = target(host, id);
  const el = isNode ? host.findElement(id, { mount: true }) : null;
  const { w, h } = outputSize({ w: crop.w, h: crop.h }, scale);
  // A vector layer is already an <svg>: hand it over as is (real vector, no HTML inside).
  if (el && el.tagName.toLowerCase() === 'svg') {
    const clone = el.cloneNode(true) as SVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(w));
    clone.setAttribute('height', String(h));
    if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${crop.w} ${crop.h}`);
    return new Blob([new XMLSerializer().serializeToString(clone)], { type: MIME.svg });
  }
  // Anything else: the board's foreignObject SVG, cropped with a viewBox (HTML inside; opens in browsers).
  const svg = (await boardSvg(ab, host.themeDecls(), { isolate: isNode ? id : undefined, transparent: isNode }))
    .replace(/^<svg [^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${crop.x} ${crop.y} ${crop.w} ${crop.h}">`);
  return new Blob([svg], { type: MIME.svg });
}

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

// Render every (item, row) pair. Pixel formats and SVG give one file each; PDF rows give one file per row with a page
// per item. One file is returned as is; several are zipped. Returns null when there is nothing to export.
export async function buildExport(host: ReplyHost, items: ExportItem[], rows: ExportRow[], onProgress?: (done: number, total: number) => void): Promise<ExportResult | null> {
  if (!items.length || !rows.length) return null;
  const names = fileNames(items, rows);
  const files: ZipEntry[] = [];
  let clamped = false;
  let done = 0;
  const total = items.length * rows.length;
  const tick = () => onProgress?.(++done, total);
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    if (row.format === 'pdf') {
      const pages = [];
      for (const it of items) {
        const { canvas, size } = await renderCanvas(host, it.id, row.scale);
        clamped ||= size.clamped;
        pages.push({ jpeg: await bytes(await toBlob(canvas, 'image/jpeg', row.quality ?? 0.92)), width: canvas.width, height: canvas.height });
        tick();
      }
      files.push({ name: items.length === 1 ? names[0][ri] : `export${(row.suffix ?? '').replace(/[^A-Za-z0-9._@-]+/g, '-')}.pdf`, data: makePdf(pages) });
      continue;
    }
    for (let ii = 0; ii < items.length; ii++) {
      const id = items[ii].id;
      let blob: Blob;
      if (row.format === 'svg') blob = await svgFor(host, id, row.scale);
      else {
        const { canvas, size } = await renderCanvas(host, id, row.scale, row.format === 'png');
        clamped ||= size.clamped;
        blob = await toBlob(canvas, MIME[row.format], row.format === 'jpg' ? row.quality ?? 0.92 : undefined);
      }
      files.push({ name: names[ii][ri], data: await bytes(blob) });
      tick();
    }
  }
  if (files.length === 1) {
    const ext = files[0].name.split('.').pop() as ExportFormat;
    return { name: files[0].name, blob: new Blob([files[0].data as BlobPart], { type: MIME[ext] }), count: 1, clamped };
  }
  const zipName = `${items.length === 1 ? safeName(items[0].name) : 'export'}.zip`;
  return { name: zipName, blob: new Blob([makeZip(files) as BlobPart], { type: MIME.zip }), count: files.length, clamped };
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000); // after the browser has started reading it
}

// "Copy as PNG": 2x, transparent for a layer. Needs a secure context (localhost counts) and a user gesture.
export async function copyPng(host: ReplyHost, id: string) {
  const { canvas } = await renderCanvas(host, id, '2x', true);
  const blob = await toBlob(canvas, 'image/png');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
