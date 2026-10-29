// What the context menu and the shortcut do with an export, kept out of the engine and the inspector so both
// (and the Export section) behave the same. Works on the engine's current selection.
import type { CanvasEngine as Engine } from '@/canvas/engine';
import { copyPng, exportAndDownload, type ExportItem } from '@/canvas/exporter';
import { DEFAULT_ROW, type ExportRow } from '@/lib/exportspec';
import { sendEdit } from '@/lib/htmlTree';
import { useProject } from '@/store/project';
import { useToast } from '@/store/toast';
import { useUi } from '@/store/ui';

function items(engine: Engine): ExportItem[] {
  const host = engine.replyHost();
  return engine.selection.map((id) => {
    if (id.startsWith('A')) return { id, name: host.findBoard(id)?.name ?? id };
    const el = host.findElement(id, { mount: true });
    return { id, name: el?.dataset.name || el?.tagName.toLowerCase() || id };
  });
}

const savedRows = (id: string): ExportRow[] => ((useProject.getState().doc?.exports as Record<string, ExportRow[]> | undefined) ?? {})[id] ?? [];

// "Export…": show the Export section, and give the selection a first row (1x PNG) when it has none, so the
// section is not empty. Exporting itself stays a deliberate click on the button.
export async function openExport(engine: Engine) {
  const list = items(engine);
  if (!list.length) return;
  useUi.getState().setPanelTab('design');
  const projectId = engine.replyHost().projectId;
  if (!savedRows(list[0].id).length) await Promise.all(list.map((it) => sendEdit(projectId, 'export-settings', { id: it.id, rows: [DEFAULT_ROW] })));
  // The section renders after the tab switch and the doc update: wait a frame or two, then bring it into view.
  const reveal = (tries: number) => {
    const sec = document.getElementById('dl-export-scale')?.closest('section');
    if (sec) sec.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    else if (tries > 0) setTimeout(() => reveal(tries - 1), 80);
  };
  reveal(10);
}

// Shortcut: download with the saved rows of the first selected item, or a 1x PNG.
export async function exportNow(engine: Engine) {
  const list = items(engine);
  if (!list.length) return;
  const rows = savedRows(list[0].id);
  await exportAndDownload(engine.replyHost(), list, rows.length ? rows : [DEFAULT_ROW]);
}

export async function copyAsPng(engine: Engine) {
  const first = items(engine)[0];
  if (!first) return;
  const toast = useToast.getState().show;
  try {
    await copyPng(engine.replyHost(), first.id);
    toast('Copied as PNG');
  } catch (e) {
    toast((e as Error).message || 'Could not copy the image');
  }
}
