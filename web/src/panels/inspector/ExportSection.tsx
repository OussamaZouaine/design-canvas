import { ChevronDown, Ellipsis } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DocData } from '@/api/types';
import { sendEdit } from '@/lib/htmlTree';
import { boxOf, exportAndDownload, renderCanvas, type ExportItem } from '@/canvas/exporter';
import { DEFAULT_ROW, FORMATS, parseScale, SCALE_PRESETS, type ExportFormat, type ExportRow } from '@/lib/exportspec';
import { cn } from '@/lib/utils';
import { useCanvas } from '@/store/canvas';
import { useProject } from '@/store/project';
import { chrome, IconBtn, Section } from './controls';

// Figma's Export section: rows of scale + format, a "…" for the file-name suffix and JPG / PDF quality, "−" to drop a
// row, "+" in the header to add one, one button that downloads, and a Preview of the first row. The caller decides
// where the rows are kept (saved in the document for a board or layer, local for the page view).
interface Props { projectId: string; items: ExportItem[]; rows: ExportRow[]; setRows: (rows: ExportRow[]) => void }

// Rows saved in the document for the first item; edits are written to every selected item, so a multi-selection
// shares one set of rows (Figma does the same).
export function useSavedRows(projectId: string, doc: DocData, items: ExportItem[]): [ExportRow[], (rows: ExportRow[]) => void] {
  const saved = (doc.exports as Record<string, ExportRow[]> | undefined) ?? {};
  const rows = saved[items[0]?.id] ?? [];
  return [rows, (next) => { for (const it of items) void sendEdit(projectId, 'export-settings', { id: it.id, rows: next }); }];
}

const PREVIEW_KEY = 'dc-export-preview';
const readOpen = () => { try { return localStorage.getItem(PREVIEW_KEY) !== '0'; } catch { return true; } };

export function ExportSection({ projectId, items, rows, setRows }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [more, setMore] = useState(false); // "…" options open
  const label = items.length === 1 ? items[0].name : `${items.length} items`;
  // One setting per item: unsaved items show the default (1x PNG) and save it on the first edit.
  const row = rows[0] ?? DEFAULT_ROW;
  const patch = (next: Partial<ExportRow>) => setRows([{ ...row, ...next }]);

  const run = async () => {
    const host = useCanvas.getState().engine?.replyHost();
    if (!host || busy) return;
    setBusy('Exporting…');
    await exportAndDownload(host, items, [row], (d, t) => t > 1 && setBusy(`Exporting ${d}/${t}`));
    setBusy(null);
  };

  return (
    <Section title="Export">
      <datalist id="dl-export-scale">{SCALE_PRESETS.map((s) => <option key={s} value={s} />)}</datalist>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1">
          <ScaleField value={row.scale} onCommit={(scale) => patch({ scale })} />
          <label className={cn(chrome, 'w-[4.5rem] shrink-0')}>
            <select aria-label="Format" value={row.format} onChange={(e) => patch({ format: e.target.value as ExportFormat })} className="min-w-0 flex-1 bg-transparent px-1.5 uppercase outline-none [&>option]:bg-popover">
              {FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
            </select>
          </label>
          <IconBtn label="More options" on={more} onClick={() => setMore(!more)}><Ellipsis className="size-3.5" /></IconBtn>
        </div>
        {more && (
          <div className="flex items-center gap-1 pl-1">
            <label className={cn(chrome, 'flex-1')} title="Added to the file name">
              <span className="w-12 shrink-0 select-none px-1.5 text-muted-foreground">Suffix</span>
              <input aria-label="File name suffix" spellCheck={false} placeholder="e.g. @2x" defaultValue={row.suffix ?? ''} onBlur={(e) => patch({ suffix: e.target.value.trim() || undefined })} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} className="min-w-0 flex-1 bg-transparent pr-1.5 outline-none placeholder:text-muted-foreground" />
            </label>
            {(row.format === 'jpg' || row.format === 'pdf') && (
              <label className={cn(chrome, 'w-24 shrink-0')} title="JPEG quality (10 to 100)">
                <span className="shrink-0 select-none px-1.5 text-muted-foreground">Quality</span>
                <input aria-label="Quality" type="number" min={10} max={100} defaultValue={Math.round((row.quality ?? 0.92) * 100)} onBlur={(e) => { const q = Number(e.target.value); if (q >= 10 && q <= 100) patch({ quality: q / 100 }); }} className="tnum min-w-0 flex-1 bg-transparent pr-1 outline-none" />
              </label>
            )}
          </div>
        )}
      </div>
      <button
        type="button" onClick={run} disabled={!!busy}
        className="h-7 rounded-md bg-field text-xs font-medium transition-[background-color,scale] duration-150 active:scale-[0.96] disabled:opacity-60 pointer-hover:hover:bg-field-hover"
      >
        {busy ?? `Export ${label}`}
      </button>
      <ExportPreview items={items} row={row} />
    </Section>
  );
}

// Scale text with presets (datalist); typing "512w" gives a fixed width. A bad value snaps back instead of being saved.
function ScaleField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const v = (draft ?? value).trim().toLowerCase();
    if (draft !== null && v !== value && parseScale(v)) onCommit(/^\d*\.?\d+$/.test(v) ? `${v}x` : v);
    setDraft(null);
  };
  return (
    <label className={cn(chrome, 'min-w-0 flex-1')}>
      <input
        aria-label="Scale" list="dl-export-scale" spellCheck={false} value={draft ?? value}
        onFocus={(e) => e.currentTarget.select()} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); } }}
        className="tnum min-w-0 flex-1 bg-transparent px-2 outline-none"
      />
    </label>
  );
}

// The first selected item as it will export (a layer on a checkerboard, so transparency shows). Rendered at panel
// width, 200 ms after the last document change, and skipped while collapsed.
function ExportPreview({ items, row }: { items: ExportItem[]; row: ExportRow }) {
  const [open, setOpen] = useState(readOpen);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const doc = useProject((s) => s.doc);
  const id = items[0]?.id;
  const transparent = row.format === 'png';

  useEffect(() => {
    if (!open || !id) return;
    let stale = false;
    const t = setTimeout(async () => {
      const host = useCanvas.getState().engine?.replyHost();
      if (!host) return;
      try {
        const box = boxOf(host, id);
        const k = Math.min(2, 440 / Math.max(1, box.w)); // ~220 px wide at 2x density
        const { canvas } = await renderCanvas(host, id, `${Math.max(0.05, Math.round(k * 100) / 100)}x`, transparent);
        if (!stale) { setSrc(canvas.toDataURL('image/png')); setError(false); }
      } catch { if (!stale) setError(true); }
    }, 200);
    return () => { stale = true; clearTimeout(t); };
  }, [open, id, doc, transparent]);

  const toggle = () => { setOpen(!open); try { localStorage.setItem(PREVIEW_KEY, open ? '0' : '1'); } catch { /* per-tab only */ } };
  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" aria-expanded={open} onClick={toggle} className="-mx-1 flex h-7 items-center gap-1 rounded-md px-1 text-[11px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
        <ChevronDown className={cn('size-3 text-muted-foreground transition-[rotate] duration-150', !open && '-rotate-90')} />
        Preview
      </button>
      {open && (
        <div className="dc-checker grid min-h-24 place-items-center overflow-hidden rounded-md p-3 outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10">
          {error ? <span className="text-muted-foreground">No preview</span> : src ? <img src={src} alt="Export preview" className="max-h-64 max-w-full object-contain" /> : <span className="text-muted-foreground">Rendering…</span>}
        </div>
      )}
    </div>
  );
}
