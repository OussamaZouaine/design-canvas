import { useProjectEvents } from '@/api/useProjectEvents';
import { FloatingToolbar, LeftPanel, RightPanel, TopBar } from '@/shell/Shell';

// Project page = chrome around the canvas. The imperative canvas engine replaces the placeholder in Phase 3.
export function ProjectPage({ projectId }: { projectId: string }) {
  useProjectEvents(projectId);
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <LeftPanel />
        <main className="relative flex-1 bg-[var(--canvas)]">
          <div className="grid h-full place-items-center text-muted-foreground">Canvas arrives in Phase 3</div>
          <FloatingToolbar />
        </main>
        <RightPanel />
      </div>
    </div>
  );
}
