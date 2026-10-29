// Pure model of an export row (Figma's Export section): scale + format + suffix, plus the size and file-name maths.
// No DOM and no imports so node:test can load it (test/exportspec.test.mjs) and the server can share validateRows.
// Keep it free of TypeScript-only syntax such as enums.
export type ExportFormat = 'png' | 'jpg' | 'svg' | 'pdf';
export interface ExportRow { scale: string; format: ExportFormat; suffix?: string; quality?: number }
export interface Box { w: number; h: number }

export const FORMATS: ExportFormat[] = ['png', 'jpg', 'svg', 'pdf'];
export const SCALE_PRESETS = ['0.5x', '0.75x', '1x', '1.5x', '2x', '3x', '4x'];
export const DEFAULT_ROW: ExportRow = { scale: '1x', format: 'png' };
// Browsers refuse canvases past these limits (Chrome: 16384 px a side, about 268 megapixels).
export const MAX_SIDE = 16384;
export const MAX_AREA = 268_000_000;
// One setting per item (the array shape is kept so the MCP tool and the multi-row writers still work).
export const MAX_ROWS = 1;

export type ParsedScale = { kind: 'x'; value: number } | { kind: 'w' | 'h'; value: number };

// "2x", "0.5x", "512w", "512h"; a bare number means a multiplier. Anything else is null.
export function parseScale(s: string): ParsedScale | null {
  const m = /^\s*(\d*\.?\d+)\s*([xwh]?)\s*$/i.exec(String(s));
  if (!m) return null;
  const value = Number(m[1]);
  const kind = (m[2].toLowerCase() || 'x') as 'x' | 'w' | 'h';
  if (!(value > 0)) return null;
  if (kind === 'x' && (value < 0.01 || value > 16)) return null;
  if (kind !== 'x' && (value < 1 || value > MAX_SIDE)) return null;
  return { kind, value };
}

// Pixel size of the output plus whether it had to be shrunk to fit the canvas limits. `k` is the final multiplier.
export function outputSize(box: Box, scale: string): { w: number; h: number; k: number; clamped: boolean } {
  const p = parseScale(scale) ?? { kind: 'x' as const, value: 1 };
  let k = p.kind === 'x' ? p.value : p.kind === 'w' ? p.value / box.w : p.value / box.h;
  let clamped = false;
  const limit = Math.min(MAX_SIDE / Math.max(box.w, box.h), Math.sqrt(MAX_AREA / (box.w * box.h)));
  if (k > limit) { k = limit; clamped = true; }
  // Floor when clamped: rounding up could land one pixel past the limit.
  const rnd = clamped ? Math.floor : Math.round;
  return { w: Math.max(1, rnd(box.w * k)), h: Math.max(1, rnd(box.h * k)), k, clamped };
}

// A row that came from the network or a file: drop what is unusable, cap the count.
export function validateRows(rows: unknown): ExportRow[] {
  if (!Array.isArray(rows)) return [];
  const out: ExportRow[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue;
    const format = String(r.format ?? 'png').toLowerCase() as ExportFormat;
    if (!FORMATS.includes(format) || !parseScale(String(r.scale ?? '1x'))) continue;
    const row: ExportRow = { scale: String(r.scale ?? '1x').trim().toLowerCase(), format };
    if (typeof r.suffix === 'string' && r.suffix) row.suffix = r.suffix.slice(0, 40);
    if (typeof r.quality === 'number' && r.quality >= 0.1 && r.quality <= 1) row.quality = Math.round(r.quality * 100) / 100;
    out.push(row);
    if (out.length >= MAX_ROWS) break;
  }
  return out;
}

// File-name safe: letters, digits, dot, dash, underscore; runs of anything else become one dash.
export const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60) || 'export';
export const extOf = (f: ExportFormat) => (f === 'jpg' ? 'jpg' : f);

// One file name per (item, row). Rows on the same item that would collide get "@<scale>" (Figma's rule); items with
// the same name get "-2", "-3"... so a zip never overwrites an entry.
export function fileNames(items: { name: string }[], rows: ExportRow[]): string[][] {
  const used = new Map<string, number>();
  return items.map((it) => {
    const base = safeName(it.name);
    // "@" stays allowed in a suffix because "@2x" is the usual one.
    const plain = rows.map((r) => `${base}${(r.suffix ?? '').replace(/[^A-Za-z0-9._@-]+/g, '-')}.${extOf(r.format)}`);
    return rows.map((r, i) => {
      let n = plain[i];
      if (plain.filter((p) => p === n).length > 1) n = n.replace(/\.(\w+)$/, `@${r.scale.replace(/x$/, '')}x.$1`);
      const seen = used.get(n) ?? 0;
      used.set(n, seen + 1);
      return seen ? n.replace(/(\.\w+)$/, `-${seen + 1}$1`) : n;
    });
  });
}
