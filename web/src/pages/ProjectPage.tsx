import { useProjectEvents } from '@/api/useProjectEvents';
import { Canvas } from '@/canvas/Canvas';
import { useEffect } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { pageOfBoard, pagesOf } from '@/canvas/engine';
import { CommentsLayer } from '@/panels/CommentsLayer';
import { CanvasContextMenu } from '@/shell/ContextMenu';
import { DeletePageDialog } from '@/panels/DeletePageDialog';
import { ConnectAgentsDialog } from '@/shell/ConnectAgentsDialog';
import { CommandPalette } from '@/shell/CommandPalette';
import { ShortcutsDialog } from '@/shell/ShortcutsDialog';
import { Rulers } from '@/shell/Rulers';
import { FloatingToolbar, LeftPanel, LivePill, RightPanel, TopBar } from '@/shell/Shell';
import { useCanvas } from '@/store/canvas';
import { useProject } from '@/store/project';

// Mirrors the shown page into ?page=<id> and the tab title. `replace: true` swaps the history entry instead of
// pushing one, so Back leaves the project rather than stepping through every page clicked. Single-page projects get
// no ?page (it would always be the implicit first page).
function usePageInUrl(page: string | null) {
  const navigate = useNavigate();
  // Primitive selectors only: pagesOf() can build a fresh array, and a selector returning a new object each time
  // makes zustand (useSyncExternalStore) re-render forever.
  const loaded = useProject((s) => !!s.doc);
  const multi = useProject((s) => !!s.doc && pagesOf(s.doc).length > 1);
  const pageName = useProject((s) => (s.doc ? pagesOf(s.doc).find((p) => p.id === page)?.name : undefined));
  const projectName = useProject((s) => s.meta?.name);
  useEffect(() => {
    if (!page || !loaded) return; // wait for the first doc, or a stale ?page would be wiped before setDoc fixes it
    void navigate({ to: '.', search: (prev: Record<string, unknown>) => ({ ...prev, page: multi ? page : undefined }), replace: true });
  }, [page, multi, loaded, navigate]);
  useEffect(() => {
    document.title = [multi && pageName, projectName, 'Design Canvas'].filter(Boolean).join(' · ');
    return () => { document.title = 'Design Canvas'; };
  }, [multi, pageName, projectName]);
}

// Project page = React chrome around the imperative canvas engine (`<Canvas>` renders an empty div the engine fills).
export function ProjectPage({ projectId }: { projectId: string }) {
  useProjectEvents(projectId);
  // ?comment=<id> comes from the Comments page; CommentsLayer opens that thread once everything has loaded.
  const { comment } = useSearch({ strict: false }) as { comment?: string };
  const page = useCanvas((s) => s.activePage);
  usePageInUrl(page);
  // Only show the empty-state hint once a doc has arrived and the current page truly has no boards.
  const loading = useProject((s) => !s.doc);
  const empty = useProject((s) => !!s.doc && !s.doc.artboards.some((a) => pageOfBoard(s.doc!, a) === page));
  return (
    <div className="flex h-full flex-col">
      <TopBar projectId={projectId} />
      <div className="flex min-h-0 flex-1">
        <LeftPanel projectId={projectId} />
        <main className="relative min-w-0 flex-1 bg-[var(--canvas)]">
          <Canvas projectId={projectId} />
          {/* Skeleton boards while the first doc event is on its way (hidden for reduced motion by .sk). */}
          {loading && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-6" aria-hidden>
              <div className="sk h-72 w-56" /><div className="sk h-72 w-96" /><div className="sk h-72 w-56" />
            </div>
          )}
          {empty && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center text-muted-foreground">
              <div>
                Nothing here yet.<br />Ask your agent to design something and it will appear live,<br />or press <kbd className="rounded border px-1">F</kbd> and drag to draw an artboard.
              </div>
            </div>
          )}
          <Rulers />
          <CommentsLayer projectId={projectId} deepLink={comment} />
          <LivePill />
          <FloatingToolbar />
          <CanvasContextMenu />
          <ShortcutsDialog />
          <CommandPalette />
          <ConnectAgentsDialog />
          <DeletePageDialog projectId={projectId} />
        </main>
        <RightPanel projectId={projectId} />
      </div>
    </div>
  );
}
