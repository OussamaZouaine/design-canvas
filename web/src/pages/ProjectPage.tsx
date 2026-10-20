import { useProjectEvents } from '@/api/useProjectEvents';
import { Canvas } from '@/canvas/Canvas';
import { pageOfBoard } from '@/canvas/engine';
import { FloatingToolbar, LeftPanel, LivePill, RightPanel, TopBar } from '@/shell/Shell';
import { useCanvas } from '@/store/canvas';
import { useProject } from '@/store/project';

// Project page = React chrome around the imperative canvas engine (`<Canvas>` renders an empty div the engine fills).
export function ProjectPage({ projectId }: { projectId: string }) {
  useProjectEvents(projectId);
  const page = useCanvas((s) => s.activePage);
  // Only show the empty-state hint once a doc has arrived and the current page truly has no boards.
  const empty = useProject((s) => !!s.doc && !s.doc.artboards.some((a) => pageOfBoard(s.doc!, a) === page));
  return (
    <div className="flex h-full flex-col">
      <TopBar projectId={projectId} />
      <div className="flex min-h-0 flex-1">
        <LeftPanel />
        <main className="relative min-w-0 flex-1 bg-[var(--canvas)]">
          <Canvas projectId={projectId} />
          {empty && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center text-muted-foreground">
              Nothing here yet.<br />Ask Claude to design something and it will appear live.
            </div>
          )}
          <LivePill />
          <FloatingToolbar />
        </main>
        <RightPanel />
      </div>
    </div>
  );
}
