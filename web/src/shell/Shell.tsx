import { Link } from '@tanstack/react-router';
import { Activity, Bot, Braces, ChevronRight, Circle, Crosshair, Hand, History, Keyboard, Image, Maximize, MessageSquare, Minus, MousePointer2, Moon, Palette, PanelLeft, PanelRight, PenTool, Plug, Plus, RectangleHorizontal, Ruler, Slash, SlidersHorizontal, Square, Sun, Type } from 'lucide-react';
import { Fragment, useEffect, useRef, type ReactNode } from 'react';
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
    <span role="status" className="flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[11px] text-muted-foreground">
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
  const paused = useAgents((s) => s.paused);
  const setTab = useUi((s) => s.setPanelTab);
  if (!presence.length) return null;
  return (
    <div className="flex min-w-0 items-center gap-1" role="list" aria-label="Agents on this project">
      {presence.slice(0, 3).map((a) => (
        <button
          key={a.id} role="listitem" onClick={() => setTab('agents')}
          title={`${a.name}: ${a.active ? `${a.pending ? 'waiting on ' : 'last used '}${a.tool}` : 'idle'}${followAgent === a.id ? ' (followed)' : ''}${paused.includes(a.id) ? ' (paused)' : ''}`}
          className={cn('flex h-6 max-w-40 items-center gap-1.5 rounded-full bg-field px-2 text-[11px] transition-[background-color,scale] duration-150 active:scale-96 pointer-hover:bg-field-hover', a.active ? 'text-foreground' : 'text-muted-foreground opacity-60')}
        >
          <i className={cn('size-1.5 shrink-0 rounded-full', a.pending && 'agent-pulse')} style={{ background: a.color }} />
          <span className="truncate">{a.name}</span>
          {paused.includes(a.id) && <span className="text-[10px] text-muted-foreground">paused</span>}
          {a.active && <span className="hidden truncate text-muted-foreground xl:inline">{a.tool}</span>}
        </button>
      ))}
      {presence.length > 3 && <span className="text-[11px] text-muted-foreground">+{presence.length - 3}</span>}
    </div>
  );
}

// Zoom readout + fit + rulers + the "follow Claude" camera toggle. The zoom trio sits in one filled segment so the
// view controls read as a unit (Apple: grouping and mapping) instead of a row of loose icons.
function ZoomControls() {
  const { engine, zoom, follow, setFollow } = useCanvas();
  const { rulers, toggleRulers } = useUi();
  return (
    <div role="group" aria-label="View" className="flex items-center gap-0.5">
      <div className="flex h-7 items-center rounded-md bg-field">
        <Button variant="ghost" size="icon" aria-label="Zoom out" title="Zoom out" onClick={() => engine?.zoomBy(1 / 1.25)}><Minus /></Button>
        <span className="tnum w-10 text-center text-[11px] font-medium">{Math.round(zoom * 100)}%</span>
        <Button variant="ghost" size="icon" aria-label="Zoom in" title="Zoom in" onClick={() => engine?.zoomBy(1.25)}><Plus /></Button>
      </div>
      <Button variant="ghost" size="icon" aria-label="Fit all artboards" title="Fit all" onClick={() => engine?.fit()}><Maximize /></Button>
      <Button variant={rulers ? 'secondary' : 'ghost'} size="icon" aria-pressed={rulers} aria-label="Rulers (Shift+R)" title="Rulers (Shift+R)" onClick={toggleRulers}><Ruler /></Button>
      {/* Follow is about Claude, so its on state borrows the signal colour rather than the neutral "pressed" grey. */}
      <Button
        variant="ghost" size="icon" aria-pressed={follow} aria-label="Follow Claude" title="Follow Claude's camera"
        className={cn(follow && 'bg-selection-soft text-selection hover:bg-selection-soft hover:text-selection')}
        onClick={() => { setFollow(!follow); engine?.setFollow(!follow); }}
      ><Crosshair /></Button>
    </div>
  );
}

// Hairline between groups in the top bar.
const Divider = () => <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />;

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
        <button onClick={() => engine?.focusBoard(live.id)} className="live-pill material flex h-7 items-center gap-2 rounded-full px-3 text-[11px] transition-[scale] duration-150 active:scale-96">
          {/* A soft halo in the agent's colour makes the dot read as "live" without animating it. */}
          <span className="size-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 0 3px color-mix(in oklch, ${color} 28%, transparent)` }} />
          {/* React escapes text, so untrusted agent and board names are safe here. */}
          <b className="max-w-24 truncate font-semibold">{agent?.name ?? 'Claude'}</b>
          <span className="text-muted-foreground">is designing</span> <b className="max-w-40 truncate font-medium">{live.name}</b>
        </button>
      )}
      {waiting && (
        <div className="live-pill material flex h-7 items-center gap-2 rounded-full px-3 text-[11px] text-muted-foreground">
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
  const { theme, toggleTheme, toggleLayers, togglePanel, layersOpen, panelOpen } = useUi();
  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b bg-background px-2">
      <Button variant="ghost" size="icon" aria-pressed={layersOpen} aria-label="Toggle pages and layers" title="Pages and layers" onClick={toggleLayers}><PanelLeft /></Button>
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 pl-1">
        <Link to="/" className="shrink-0 rounded-sm px-1 text-muted-foreground outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/40 pointer-hover:text-foreground">Projects</Link>
        <ChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground/60" />
        {/* textContent-equivalent: React escapes text, so untrusted project names are safe here. */}
        <span aria-current="page" className="truncate px-1 font-semibold">{name ?? '…'}</span>
        <span className="tnum shrink-0 whitespace-nowrap text-muted-foreground">{count} {count === 1 ? 'artboard' : 'artboards'}</span>
      </nav>
      <div className="ml-auto flex items-center gap-1">
        <AgentChips />
        <StatusPill />
        <Divider />
        <ZoomControls />
        <Divider />
        <Button variant="ghost" size="icon" aria-label="Connect agents" title="Connect agents" onClick={() => useUi.getState().setConnectOpen(true)}><Plug /></Button>
        <Button variant="ghost" size="icon" aria-label="Keyboard shortcuts (?)" title="Keyboard shortcuts (?)" onClick={() => useUi.getState().setShortcutsOpen(true)}><Keyboard /></Button>
        <Button variant="ghost" size="icon" aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title="Theme" onClick={toggleTheme}>{theme === 'dark' ? <Sun /> : <Moon />}</Button>
        <Button variant="ghost" size="icon" aria-pressed={panelOpen} aria-label="Toggle inspector" title="Inspector" onClick={togglePanel}><PanelRight /></Button>
      </div>
    </header>
  );
}

// `group` splits the toolbar into navigate / draw / content / review clusters with a hairline between them.
const TOOLS: { id: Tool; icon: ReactNode; label: string; key: string; group: number }[] = [
  { id: 'move', icon: <MousePointer2 />, label: 'Move', key: 'V', group: 0 },
  { id: 'hand', icon: <Hand />, label: 'Hand', key: 'H', group: 0 },
  { id: 'frame', icon: <Square />, label: 'Frame', key: 'F', group: 1 },
  { id: 'rect', icon: <RectangleHorizontal />, label: 'Rectangle', key: 'R', group: 1 },
  { id: 'ellipse', icon: <Circle />, label: 'Ellipse', key: 'O', group: 1 },
  { id: 'line', icon: <Slash />, label: 'Line', key: 'L', group: 1 },
  { id: 'pen', icon: <PenTool />, label: 'Pen', key: 'P', group: 1 },
  { id: 'text', icon: <Type />, label: 'Text', key: 'T', group: 2 },
  { id: 'image', icon: <Image />, label: 'Image', key: 'I', group: 2 },
  { id: 'comment', icon: <MessageSquare />, label: 'Comment', key: 'C', group: 3 },
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
    // Translucent material so the canvas stays visible under it. Radii are concentric: 8px buttons + 4px padding = 12px shell.
    <div role="toolbar" aria-label="Tools" aria-orientation="horizontal" className="material absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-xl p-1">
      <input
        ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden aria-hidden tabIndex={-1}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void engine?.addImageFile(f); e.target.value = ''; }}
      />
      {TOOLS.map((t, i) => (
        <Fragment key={t.id}>
          {i > 0 && TOOLS[i - 1].group !== t.group && <span aria-hidden className="mx-1 h-5 w-px bg-border" />}
          {/* Active tool = solid signal blue, the one place the chrome spends colour. Tool switching is frequent,
              so feedback is a 150ms colour change plus the 0.96 press scale, nothing more. */}
          <button
            type="button" aria-pressed={tool === t.id} aria-label={`${t.label} (${t.key})`} title={`${t.label} (${t.key})`} onClick={() => pick(t.id)}
            className={cn(
              'grid size-8 place-items-center rounded-lg outline-none transition-[background-color,color,scale] duration-150 active:scale-96 focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-4',
              tool === t.id ? 'bg-selection text-white' : 'text-foreground/75 pointer-hover:bg-foreground/8 pointer-hover:text-foreground',
            )}
          >
            {t.icon}
          </button>
        </Fragment>
      ))}
    </div>
  );
}

const TABS: { id: PanelTab; label: string; icon: ReactNode }[] = [
  { id: 'design', label: 'Design', icon: <SlidersHorizontal /> }, { id: 'comment', label: 'Comments', icon: <MessageSquare /> },
  { id: 'activity', label: 'Activity', icon: <Activity /> }, { id: 'versions', label: 'Versions', icon: <History /> },
  { id: 'theme', label: 'Theme', icon: <Palette /> }, { id: 'tokens', label: 'Tokens', icon: <Braces /> },
  { id: 'agents', label: 'Agents', icon: <Bot /> }, { id: 'mcp', label: 'MCP', icon: <Plug /> },
];

export function RightPanel({ projectId }: { projectId: string }) {
  const { panelTab, setPanelTab, panelOpen } = useUi();
  const open = useProject((s) => s.comments.filter((c) => !c.resolved).length);
  if (!panelOpen) return null;
  return (
    <aside aria-label="Inspector" className="flex w-68 shrink-0 flex-col border-l bg-background">
      {/* Eight text tabs wrapped onto two ragged lines at this width; one even row of icon tabs keeps the panel's top
          edge aligned with the header. Names are in the tooltip and aria-label. */}
      <nav role="tablist" aria-label="Panels" className="flex h-10 shrink-0 items-center justify-between border-b px-2">
        {TABS.map((t) => (
          <button
            key={t.id} role="tab" aria-selected={panelTab === t.id} aria-label={t.label} title={t.label} onClick={() => setPanelTab(t.id)}
            className={cn(
              'relative grid size-7 place-items-center rounded-md outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/40 [&_svg]:size-3.5',
              panelTab === t.id ? 'bg-field text-foreground' : 'text-muted-foreground pointer-hover:text-foreground',
            )}
          >
            {t.icon}
            {t.id === 'comment' && open > 0 && (
              <span className="tnum absolute -top-0.5 -right-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-selection px-0.5 text-[9px] font-semibold text-white ring-2 ring-background">{open}</span>
            )}
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
      <h2 className="flex h-8 shrink-0 items-center px-3 text-[11px] font-semibold">Layers</h2>
      <LayersPanel projectId={projectId} />
    </aside>
  );
}
