import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { canvasAction } from '@/api/projects';
import { pageOfBoard, pagesOf } from '@/canvas/engine';
import { buildActions, type Action } from '@/lib/actions';
import { copyAsPng, openExport } from '@/lib/exportActions';
import { useCanvas } from '@/store/canvas';
import { useProject } from '@/store/project';
import { toast } from '@/store/toast';
import { useUi, type Tool } from '@/store/ui';

// Wires the pure registry (lib/actions.ts) to the live app: engine for canvas work, ui store for panels.
// Rebuilt when the page list or the boards change; the enabled-when getters read the engine live, so they stay
// fresh without a rebuild on every selection change.
export function useActions(): Action[] {
  const engine = useCanvas((s) => s.engine);
  const doc = useProject((s) => s.doc);
  const page = useCanvas((s) => s.activePage);
  const projectId = useProject((s) => s.meta?.id);
  const navigate = useNavigate();

  return useMemo(() => {
    const ui = () => useUi.getState();
    const sel = () => engine?.selection ?? [];
    const layers = () => sel().filter((id) => !id.startsWith('A'));
    // Undo / redo go through the server so they also cover Claude's edits (same path as Ctrl+Z).
    const history = (kind: 'undo' | 'redo') => () => {
      if (!engine || !projectId) return;
      engine.markUserEdit();
      canvasAction(projectId, kind).catch((e: Error) => toast(e.message || 'Nothing to do'));
    };
    const here = doc?.artboards.filter((a) => pageOfBoard(doc, a) === (page ?? pagesOf(doc)[0].id)) ?? [];
    return buildActions({
      pages: doc ? pagesOf(doc).map((p) => ({ id: p.id, name: p.name })) : [],
      boards: here.map((a) => ({ id: a.id, name: a.name })),
      has: { selection: () => sel().length > 0, layers: () => layers().length > 0, oneLayer: () => sel().length === 1 && layers().length === 1, paste: () => !!engine?.canPaste },
      do: {
        tool: (id) => {
          // Image opens a file picker owned by the toolbar, so it keeps its own path: reuse the toolbar's key.
          if (id === 'image') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i' }));
          else ui().setTool(id as Tool);
        },
        undo: history('undo'), redo: history('redo'),
        selectAll: () => engine?.selectAll(),
        duplicate: () => engine?.duplicate(), copy: () => engine?.copy(), cut: () => engine?.cut(),
        paste: (inPlace) => engine?.paste(inPlace), remove: () => engine?.remove(),
        group: () => engine?.group('group'), ungroup: () => engine?.ungroup(), autoLayout: () => engine?.group('auto'),
        zoomIn: () => engine?.zoomBy(1.25), zoomOut: () => engine?.zoomBy(1 / 1.25), fit: () => engine?.fit(),
        toggleFollow: () => { const c = useCanvas.getState(); c.setFollow(!c.follow); engine?.setFollow(!c.follow); },
        toggleRulers: () => ui().toggleRulers(), toggleTheme: () => ui().toggleTheme(),
        toggleLayers: () => ui().toggleLayers(), togglePanel: () => ui().togglePanel(),
        tab: (id) => ui().setPanelTab(id), view: (id) => ui().openView(id),
        openExport: () => engine && openExport(engine), copyPng: () => engine && void copyAsPng(engine),
        projects: () => void navigate({ to: '/' }), connect: () => ui().setConnectOpen(true),
        shortcuts: () => ui().setShortcutsOpen(true), palette: () => ui().setPaletteOpen(true),
        page: (id) => engine?.setPage(id), deletePage: () => ui().setDeletePageId(page ?? pagesOf(doc!)[0].id), board: (id) => engine?.focusBoard(id),
      },
    });
  }, [engine, doc, page, projectId, navigate]);
}
