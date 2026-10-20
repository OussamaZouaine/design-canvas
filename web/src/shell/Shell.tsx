import { Link } from '@tanstack/react-router';
import { Crosshair, Hand, Image, Maximize, MessageSquare, Minus, MousePointer2, Moon, PanelLeft, PanelRight, Plus, Square, Sun, Type } from 'lucide-react';
import type { ReactNode } from 'react';
import { canvasAction } from '@/api/projects';
import { pageOfBoard, pagesOf } from '@/canvas/engine';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useCanvas } from '@/store/canvas';
import { useProject } from '@/store/project';
import { toast } from '@/store/toast';
import { useUi, type PanelTab, type Tool } from '@/store/ui';

// Status pill: connection state, plus "Claude is designing" while the server reports touched nodes.
function StatusPill() {
  const connection = useProject((s) => s.connection);
  const designing = useProject((s) => s.agentIds.length > 0);
  const text = designing ? 'Claude is designing' : connection;
  return (
    <span className="flex h-6 items-center gap-1.5 rounded-full bg-muted px-2 text-[11px] text-muted-foreground">
      <span className={cn('size-1.5 rounded-full', designing ? 'bg-[var(--selection)]' : connection === 'connected' ? 'bg-emerald-500' : 'bg-destructive')} />
      {text}
    </span>
  );
}

// Page switcher: pages are separate canvases inside one project. The engine owns which one is visible
// (it also switches by itself when Claude draws on another page); this just mirrors and drives it.
function PageSwitcher({ projectId }: { projectId: string }) {
  const doc = useProject((s) => s.doc);
  const engine = useCanvas((s) => s.engine);
  const active = useCanvas((s) => s.activePage);
  const list = pagesOf(doc);
  const add = async () => {
    if (!engine) return;
    engine.markUserEdit();
    try {
      const r = await canvasAction(projectId, 'page-create', { name: `Page ${list.length + 1}` });
      engine.setPageWhenReady((r.result as { id: string }).id);
    } catch (e) { toast((e as Error).message || 'Could not add a page'); }
  };
  return (
    <div className="flex items-center gap-1">
      <Select items={list.map((p) => ({ value: p.id, label: p.name }))} value={active ?? list[0].id} onValueChange={(v) => engine?.setPage(v as string)}>
        <SelectTrigger aria-label="Page" className="h-7 w-32"><SelectValue /></SelectTrigger>
        <SelectContent>{list.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
      </Select>
      <Button variant="ghost" size="icon" aria-label="Add a page" onClick={add}><Plus /></Button>
    </div>
  );
}

// Zoom readout + fit + the "follow Claude" camera toggle.
function ZoomControls() {
  const { engine, zoom, follow, setFollow } = useCanvas();
  return (
    <div className="flex items-center gap-0.5">
      <Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => engine?.zoomBy(1 / 1.25)}><Minus /></Button>
      <span className="tnum w-10 text-center text-muted-foreground">{Math.round(zoom * 100)}%</span>
      <Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => engine?.zoomBy(1.25)}><Plus /></Button>
      <Button variant="ghost" size="icon" aria-label="Fit all artboards" title="Fit all" onClick={() => engine?.fit()}><Maximize /></Button>
      <Button
        variant={follow ? 'secondary' : 'ghost'} size="icon" aria-pressed={follow} aria-label="Follow Claude" title="Follow Claude's camera"
        onClick={() => { setFollow(!follow); engine?.setFollow(!follow); }}
      ><Crosshair /></Button>
    </div>
  );
}

// "Claude is writing to <board>" pill over the canvas. The board's own label is unreadable when zoomed out
// over dozens of boards, so this is the always-visible cue; clicking it glides to that board.
export function LivePill() {
  const live = useCanvas((s) => s.live);
  const engine = useCanvas((s) => s.engine);
  if (!live) return null;
  return (
    <button
      onClick={() => engine?.focusBoard(live.id)}
      className="live-pill absolute top-3 right-3 z-10 flex h-7 items-center gap-2 rounded-full border bg-popover px-3 text-[11px] shadow-md"
    >
      <span className="size-1.5 rounded-full bg-[oklch(0.68_0.2_295)]" />
      {/* React escapes text, so an untrusted board name is safe here. */}
      Designing <b className="max-w-40 truncate font-medium">{live.name}</b>
    </button>
  );
}

export function TopBar({ projectId }: { projectId: string }) {
  const name = useProject((s) => s.meta?.name);
  const doc = useProject((s) => s.doc);
  const page = useCanvas((s) => s.activePage);
  const count = doc ? doc.artboards.filter((a) => pageOfBoard(doc, a) === page).length : 0;
  const { theme, toggleTheme, toggleLayers, togglePanel } = useUi();
  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b bg-background px-2">
      <Button variant="ghost" size="icon" aria-label="Toggle layers" onClick={toggleLayers}><PanelLeft /></Button>
      <Link to="/" className="text-muted-foreground hover:text-foreground">Projects</Link>
      <span className="text-muted-foreground">/</span>
      {/* textContent-equivalent: React escapes text, so untrusted project names are safe here. */}
      <span className="truncate font-medium">{name ?? '…'}</span>
      <span className="tnum text-muted-foreground">{count} {count === 1 ? 'artboard' : 'artboards'}</span>
      <div className="ml-auto flex items-center gap-3">
        <PageSwitcher projectId={projectId} />
        <ZoomControls />
        <StatusPill />
        <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={toggleTheme}>{theme === 'dark' ? <Sun /> : <Moon />}</Button>
        <Button variant="ghost" size="icon" aria-label="Toggle panel" onClick={togglePanel}><PanelRight /></Button>
      </div>
    </header>
  );
}

const TOOLS: { id: Tool; icon: ReactNode; label: string; key: string }[] = [
  { id: 'move', icon: <MousePointer2 />, label: 'Move', key: 'V' },
  { id: 'frame', icon: <Square />, label: 'Frame', key: 'F' },
  { id: 'text', icon: <Type />, label: 'Text', key: 'T' },
  { id: 'image', icon: <Image />, label: 'Image', key: 'I' },
  { id: 'comment', icon: <MessageSquare />, label: 'Comment', key: 'C' },
  { id: 'hand', icon: <Hand />, label: 'Hand', key: 'H' },
];

// Bottom-centre floating toolbar. Skeleton only: tools are selectable, wired to the canvas in Phase 7.
export function FloatingToolbar() {
  const { tool, setTool } = useUi();
  return (
    <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-0.5 rounded-xl border bg-popover p-1 shadow-lg">
      {TOOLS.map((t) => (
        <Button key={t.id} variant={tool === t.id ? 'secondary' : 'ghost'} size="icon" aria-label={`${t.label} (${t.key})`} title={`${t.label} (${t.key})`} onClick={() => setTool(t.id)}>
          {t.icon}
        </Button>
      ))}
    </div>
  );
}

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'design', label: 'Design' }, { id: 'comment', label: 'Comments' }, { id: 'activity', label: 'Activity' },
  { id: 'versions', label: 'Versions' }, { id: 'theme', label: 'Theme' }, { id: 'tokens', label: 'Tokens' }, { id: 'mcp', label: 'MCP' },
];

export function RightPanel() {
  const { panelTab, setPanelTab, panelOpen } = useUi();
  if (!panelOpen) return null;
  return (
    <aside className="flex w-64 shrink-0 flex-col border-l bg-background">
      <nav className="flex flex-wrap gap-x-3 gap-y-1 border-b px-3 py-2">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setPanelTab(t.id)} className={cn('text-[11px]', panelTab === t.id ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-auto p-3 text-muted-foreground">{panelTab} panel (Phase {panelTab === 'design' ? 5 : 6})</div>
    </aside>
  );
}

// Left drawer: icon rail + layers frame. The real tree arrives in Phase 5; for now it lists artboard names live.
export function LeftPanel() {
  const layersOpen = useUi((s) => s.layersOpen);
  const boards = useProject((s) => s.doc?.artboards);
  if (!layersOpen) return null;
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-background">
      <div className="border-b px-3 py-2 text-[11px] font-medium">Layers</div>
      <ul className="flex-1 overflow-auto py-1">
        {boards?.map((b) => <li key={b.id} className="truncate px-3 py-1 hover:bg-muted">{b.name}</li>)}
      </ul>
    </aside>
  );
}
