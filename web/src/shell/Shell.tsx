import { Link } from '@tanstack/react-router';
import { Crosshair, Hand, Image, Maximize, MessageSquare, Minus, MousePointer2, Moon, PanelLeft, PanelRight, Plus, Ruler, Square, Sun, Type } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { pageOfBoard } from '@/canvas/engine';
import { Button } from '@/components/ui/button';
import { CommentsPanel } from '@/panels/CommentsPanel';
import { ActivityPanel, VersionsPanel } from '@/panels/HistoryPanels';
import { InspectorPanel } from '@/panels/InspectorPanel';
import { ThemePanel } from '@/panels/ThemePanel';
import { McpPanel, TokensPanel } from '@/panels/TokensMcpPanels';
import { AgentsPanel, toolLabel, usePresence } from '@/panels/AgentsPanel';
import { LayersPanel } from '@/panels/LayersPanel';
import { PagesPanel } from '@/panels/PagesPanel';
import { cn } from '@/lib/utils';
import { useAgents } from '@/store/agents';
import { useCanvas } from '@/store/canvas';
import { useProject } from '@/store/project';
import { useUi, type PanelTab, type Tool } from '@/store/ui';

// Status pill: connection state, plus "Claude is designing" while the server reports touched nodes.
function StatusPill() {
  const connection = useProject((s) => s.connection);
  const designing = useProject((s) => s.agentIds.length > 0);
  const agent = useProject((s) => s.agentInfo);
  const text = designing ? `${agent?.name ?? 'Claude'} is designing` : connection;
  return (
    <span className="flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-muted px-2 text-[11px] text-muted-foreground">
      <span
        className={cn('size-1.5 rounded-full', !designing && (connection === 'connected' ? 'bg-emerald-500' : 'bg-destructive'))}
        style={designing ? { background: agent?.color ?? 'var(--selection)' } : undefined}
      />
      {text}
    </span>
  );
}

// One chip per agent seen on this project: colour dot, name, and the tool it is on (dimmed once idle for 2 min).
// Names come from the MCP client and are untrusted; React escapes them.
function AgentChips() {
  const presence = usePresence();
  const followAgent = useAgents((s) => s.followAgent);
  const setTab = useUi((s) => s.setPanelTab);
  if (!presence.length) return null;
  return (
    <div className="flex min-w-0 items-center gap-1" role="list" aria-label="Agents on this project">
      {presence.slice(0, 3).map((a) => (
        <button
          key={a.id} role="listitem" onClick={() => setTab('agents')}
          title={`${a.name}: ${a.active ? `${a.pending ? 'waiting on ' : 'last used '}${a.tool}` : 'idle'}${followAgent === a.id ? ' (followed)' : ''}`}
          className={cn('flex h-6 max-w-40 items-center gap-1.5 rounded-full border px-2 text-[11px]', a.active ? 'text-foreground' : 'text-muted-foreground opacity-60')}
        >
          <i className={cn('size-1.5 shrink-0 rounded-full', a.pending && 'agent-pulse')} style={{ background: a.color }} />
          <span className="truncate">{a.name}</span>
          {a.active && <span className="hidden truncate text-muted-foreground xl:inline">{a.tool}</span>}
        </button>
      ))}
      {presence.length > 3 && <span className="text-[11px] text-muted-foreground">+{presence.length - 3}</span>}
    </div>
  );
}

// Zoom readout + fit + the "follow Claude" camera toggle.
function ZoomControls() {
  const { engine, zoom, follow, setFollow } = useCanvas();
  const { rulers, toggleRulers } = useUi();
  return (
    <div className="flex items-center gap-0.5">
      <Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => engine?.zoomBy(1 / 1.25)}><Minus /></Button>
      <span className="tnum w-10 text-center text-muted-foreground">{Math.round(zoom * 100)}%</span>
      <Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => engine?.zoomBy(1.25)}><Plus /></Button>
      <Button variant="ghost" size="icon" aria-label="Fit all artboards" title="Fit all" onClick={() => engine?.fit()}><Maximize /></Button>
      <Button variant={rulers ? 'secondary' : 'ghost'} size="icon" aria-pressed={rulers} aria-label="Rulers (Shift+R)" title="Rulers (Shift+R)" onClick={toggleRulers}><Ruler /></Button>
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
  const agent = useProject((s) => s.agentInfo);
  const waiting = useAgents((s) => s.pending[0]);
  const color = agent?.color ?? 'oklch(0.68 0.2 295)';
  // A pending slow call (screenshot...) shows even when no board is being written, so a 15 s round-trip is visible.
  if (!live && !waiting) return null;
  return (
    <div className="absolute top-6 right-3 z-10 flex flex-col items-end gap-1.5">
      {live && (
        <button onClick={() => engine?.focusBoard(live.id)} className="live-pill flex h-7 items-center gap-2 rounded-full border bg-popover px-3 text-[11px] shadow-md" style={{ borderColor: color }}>
          <span className="size-1.5 rounded-full" style={{ background: color }} />
          {/* React escapes text, so untrusted agent and board names are safe here. */}
          <b className="max-w-24 truncate font-medium">{agent?.name ?? 'Claude'}</b>
          designing <b className="max-w-40 truncate font-medium">{live.name}</b>
        </button>
      )}
      {waiting && (
        <div className="live-pill flex h-7 items-center gap-2 rounded-full border bg-popover px-3 text-[11px] text-muted-foreground shadow-md" style={{ borderColor: waiting.agent?.color }}>
          <span className="agent-pulse size-1.5 rounded-full" style={{ background: waiting.agent?.color ?? 'var(--muted-foreground)' }} />
          Waiting for {waiting.tool === 'get_screenshot' ? 'screenshot' : toolLabel(waiting.tool, waiting.args)}…
        </div>
      )}
    </div>
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
        <ZoomControls />
        <AgentChips />
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

const typing = (t: EventTarget | null) => t instanceof Element && !!t.closest('input, textarea, select, [contenteditable]');

// Bottom-centre floating toolbar. Frame (drag a rectangle), Text (click an element), Hand (drag to pan) and
// Comment are modes the canvas engine reads; Image opens a file picker (the picture becomes a reference board).
export function FloatingToolbar() {
  const { tool, setTool } = useUi();
  const fileInput = useRef<HTMLInputElement>(null);
  const engine = useCanvas((s) => s.engine);
  const pick = (id: Tool) => {
    if (id === 'image') fileInput.current?.click();
    else setTool(tool === id && id !== 'move' ? 'move' : id); // pressing the active tool again returns to Move
  };

  // Single-letter shortcuts, ignored while typing or with a modifier held (Ctrl+C is copy, not Comment).
  // C is handled by the comments layer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.shiftKey && e.key.toLowerCase() === 'r') { useUi.getState().toggleRulers(); return; }
      const hit = TOOLS.find((t) => t.key.toLowerCase() === e.key.toLowerCase() && t.id !== 'comment');
      if (hit) pick(hit.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div role="toolbar" aria-label="Tools" aria-orientation="horizontal" className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-0.5 rounded-xl border bg-popover p-1 shadow-lg">
      <input
        ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden aria-hidden tabIndex={-1}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void engine?.addImageFile(f); e.target.value = ''; }}
      />
      {TOOLS.map((t) => (
        <Button key={t.id} variant={tool === t.id ? 'secondary' : 'ghost'} size="icon" aria-pressed={tool === t.id} aria-label={`${t.label} (${t.key})`} title={`${t.label} (${t.key})`} onClick={() => pick(t.id)}>
          {t.icon}
        </Button>
      ))}
    </div>
  );
}

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'design', label: 'Design' }, { id: 'comment', label: 'Comments' }, { id: 'activity', label: 'Activity' },
  { id: 'versions', label: 'Versions' }, { id: 'theme', label: 'Theme' }, { id: 'tokens', label: 'Tokens' }, { id: 'agents', label: 'Agents' }, { id: 'mcp', label: 'MCP' },
];

export function RightPanel({ projectId }: { projectId: string }) {
  const { panelTab, setPanelTab, panelOpen } = useUi();
  const open = useProject((s) => s.comments.filter((c) => !c.resolved).length);
  if (!panelOpen) return null;
  return (
    <aside aria-label="Inspector" className="flex w-64 shrink-0 flex-col border-l bg-background">
      <nav role="tablist" aria-label="Panels" className="flex flex-wrap gap-x-3 gap-y-1 border-b px-3 py-2">
        {TABS.map((t) => (
          <button
            key={t.id} role="tab" aria-selected={panelTab === t.id} onClick={() => setPanelTab(t.id)}
            className={cn('rounded-sm text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring', panelTab === t.id ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            {t.label}{t.id === 'comment' && open > 0 && <span className="tnum ml-1 rounded-full bg-[var(--selection)] px-1 text-[9px] text-white">{open}</span>}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-auto">
        {panelTab === 'design' && <InspectorPanel projectId={projectId} />}
        {panelTab === 'comment' && <CommentsPanel />}
        {panelTab === 'activity' && <ActivityPanel projectId={projectId} />}
        {panelTab === 'versions' && <VersionsPanel projectId={projectId} />}
        {panelTab === 'theme' && <ThemePanel projectId={projectId} />}
        {panelTab === 'tokens' && <TokensPanel projectId={projectId} />}
        {panelTab === 'agents' && <AgentsPanel />}
        {panelTab === 'mcp' && <McpPanel projectId={projectId} />}
      </div>
    </aside>
  );
}

// Left drawer: the page list on top, then the layer tree of the active page (search, rename, hide/lock, drag to reorder).
export function LeftPanel({ projectId }: { projectId: string }) {
  const layersOpen = useUi((s) => s.layersOpen);
  if (!layersOpen) return null;
  return (
    <aside aria-label="Pages and layers" className="flex w-60 shrink-0 flex-col border-r bg-background">
      <PagesPanel projectId={projectId} />
      <div className="border-b px-3 py-2 text-[11px] font-medium">Layers</div>
      <LayersPanel projectId={projectId} />
    </aside>
  );
}
