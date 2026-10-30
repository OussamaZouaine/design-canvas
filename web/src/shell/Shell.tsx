import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, Circle, Crosshair, FolderOpen, Frame, Hand, History, Image, Keyboard, Maximize, MessageSquare, Minus, MousePointer2, Moon, PanelLeft, PanelRight, PenTool, Plug, Plus, Ruler, Search, Slash, Square, Type } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupText } from '@/components/ui/button-group';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CommentsPanel } from '@/panels/CommentsPanel';
import { InspectorPanel } from '@/panels/InspectorPanel';
import { McpPanel } from '@/panels/TokensMcpPanels';
import { AgentsPanel, toolLabel, usePresence } from '@/panels/AgentsPanel';
import { LayersPanel } from '@/panels/LayersPanel';
import { PagesPanel } from '@/panels/PagesPanel';
import { HistoryView, StylesView } from '@/shell/PanelViews';
import { formatKeys, TOOL_DEFS } from '@/lib/actions';
import { openExport } from '@/lib/exportActions';
import { isMac, modLabel, shiftLabel } from '@/lib/platform';
import { useActions } from '@/shell/useActions';
import { cn } from '@/lib/utils';
import { useAgents } from '@/store/agents';
import { useCanvas } from '@/store/canvas';
import { useProject } from '@/store/project';
import { useUi, type PanelTab, type Tool } from '@/store/ui';
import { Tip } from '@/ui/Tip';

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
        <Tip key={a.id} label={`${a.name}: ${a.active ? `${a.pending ? 'waiting on ' : 'last used '}${a.tool}` : 'idle'}${followAgent === a.id ? ' (followed)' : ''}${paused.includes(a.id) ? ' (paused)' : ''}`} side="bottom"><button
          role="listitem" onClick={() => setTab('agents')}
          className={cn('flex h-6 max-w-40 items-center gap-1.5 rounded-full bg-field px-2 text-[11px] transition-[background-color,scale] duration-150 active:scale-96 pointer-hover:bg-field-hover', a.active ? 'text-foreground' : 'text-muted-foreground opacity-60')}
        >
          <i className={cn('size-1.5 shrink-0 rounded-full', a.pending && 'agent-pulse')} style={{ background: a.color }} />
          <span className="truncate">{a.name}</span>
          {paused.includes(a.id) && <span className="text-[10px] text-muted-foreground">paused</span>}
          {a.active && <span className="hidden truncate text-muted-foreground xl:inline">{a.tool}</span>}
        </button></Tip>
      ))}
      {presence.length > 3 && <span className="text-[11px] text-muted-foreground">+{presence.length - 3}</span>}
    </div>
  );
}

// Zoom group: one shadcn button-group (minus, readout, plus, fit) so the view controls read as a unit.
function ZoomControls() {
  const { engine, zoom } = useCanvas();
  return (
    <ButtonGroup aria-label="Zoom">
      <Tip label="Zoom out" keys="−" side="bottom"><Button variant="outline" size="icon" aria-label="Zoom out" onClick={() => engine?.zoomBy(1 / 1.25)}><Minus /></Button></Tip>
      <ButtonGroupText className="tnum w-12 justify-center px-0 text-[11px] font-medium">{Math.round(zoom * 100)}%</ButtonGroupText>
      <Tip label="Zoom in" keys="+" side="bottom"><Button variant="outline" size="icon" aria-label="Zoom in" onClick={() => engine?.zoomBy(1.25)}><Plus /></Button></Tip>
      <Tip label="Fit all" keys="⇧1" side="bottom"><Button variant="outline" size="icon" aria-label="Fit all artboards" onClick={() => engine?.fit()}><Maximize /></Button></Tip>
    </ButtonGroup>
  );
}

// Follow is about Claude, so its on state borrows the signal colour rather than the neutral "pressed" grey.
function FollowButton() {
  const { engine, follow, setFollow } = useCanvas();
  return (
    <Tip label="Follow Claude's camera" side="bottom"><Button
      variant="ghost" size="28" aria-pressed={follow}
      className={cn(follow && 'bg-selection-soft text-selection-ink hover:bg-selection-soft hover:text-selection-ink')}
      onClick={() => { setFollow(!follow); engine?.setFollow(!follow); }}
    ><Crosshair />Follow</Button></Tip>
  );
}

// Main menu behind the champagne logo mark: everything that left the bar because it is used rarely.
// (There is no Settings screen yet, so the menu has no Settings item.)
function MainMenu() {
  const { theme, rulers } = useUi();
  const actions = useActions();
  const setTheme = (t: string) => { if (t !== useUi.getState().theme) useUi.getState().toggleTheme(); };
  // Labels and shortcuts come from the registry (lib/actions.ts), so this menu cannot drift from the palette or the dialog.
  const act = (id: string) => actions.find((a) => a.id === id)!;
  const item = (id: string, icon: ReactNode) => { const a = act(id); return (
    <DropdownMenuItem onClick={a.run}>{icon}{a.label}{a.keys && <DropdownMenuShortcut>{formatKeys(a.keys[0], isMac)}</DropdownMenuShortcut>}</DropdownMenuItem>
  ); };
  const rulersAction = act('view.rulers');
  return (
    <DropdownMenu>
      <Tip label="Main menu" side="bottom"><DropdownMenuTrigger render={<button type="button" aria-label="Main menu" className="grid size-7 shrink-0 place-items-center rounded-md bg-brand font-display text-[13px] text-brand-ink outline-none transition-[scale] duration-150 active:scale-96 focus-visible:ring-2 focus-visible:ring-ring/90" />}>D</DropdownMenuTrigger></Tip>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem render={<Link to="/" />}><FolderOpen />{act('project.home').label}</DropdownMenuItem>
        {item('help.palette', <Search />)}
        {item('project.connect', <Plug />)}
        {item('panel.history', <History />)}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={rulers} onCheckedChange={rulersAction.run}><Ruler />{rulersAction.label}<DropdownMenuShortcut>{formatKeys(rulersAction.keys![0], isMac)}</DropdownMenuShortcut></DropdownMenuCheckboxItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger><Moon />Theme</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        {item('help.shortcuts', <Keyboard />)}
      </DropdownMenuContent>
    </DropdownMenu>
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

// Three zones (a grid with equal side columns keeps the centre truly centred): left = menu + where you are,
// centre = who is working and the connection, right = view controls, the one primary action (Export), panel toggle.
export function TopBar({ projectId: _projectId }: { projectId: string }) {
  const name = useProject((s) => s.meta?.name);
  const { toggleLayers, togglePanel, layersOpen, panelOpen } = useUi();
  const engine = useCanvas((s) => s.engine);
  return (
    <header className="grid h-11 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b bg-background px-2">
      <div className="flex min-w-0 items-center gap-1">
        <MainMenu />
        <Tip label="Pages and layers" side="bottom"><Button variant="ghost" size="icon" aria-pressed={layersOpen} aria-label="Toggle pages and layers" onClick={toggleLayers}><PanelLeft /></Button></Tip>
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1">
          <Link to="/" className="shrink-0 rounded-sm px-1 text-muted-foreground outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/90 pointer-hover:text-foreground">Projects</Link>
          <ChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground/60" />
          {/* React escapes text, so untrusted project names are safe here. */}
          <span aria-current="page" className="truncate px-1 font-semibold">{name ?? '…'}</span>
        </nav>
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <AgentChips />
        <StatusPill />
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <ZoomControls />
        <FollowButton />
        <Tip label="Export" keys={`${modLabel()}${shiftLabel()}E`} side="bottom"><Button variant="brand" size="28" onClick={() => engine && openExport(engine)}>Export</Button></Tip>
        <Tip label="Inspector" side="bottom"><Button variant="ghost" size="icon" aria-pressed={panelOpen} aria-label="Toggle inspector" onClick={togglePanel}><PanelRight /></Button></Tip>
      </div>
    </header>
  );
}

// Ids, labels and keys come from the registry (TOOL_DEFS); only the icons live here.
const TOOL_ICONS: Record<Tool, ReactNode> = {
  move: <MousePointer2 />, hand: <Hand />, frame: <Frame />, rect: <Square />, ellipse: <Circle />, line: <Slash />,
  pen: <PenTool />, text: <Type />, image: <Image />, comment: <MessageSquare />,
};
const TOOLS = TOOL_DEFS.map((t) => ({ ...t, icon: TOOL_ICONS[t.id] }));
const toolOf = (id: Tool) => TOOLS.find((t) => t.id === id)!;
// The two split slots: Move/Hand and the four shape tools. Six toolbar slots in all.
const POINTER_GROUP: Tool[] = ['move', 'hand'];
const SHAPE_GROUP: Tool[] = ['rect', 'ellipse', 'line', 'pen'];

const typing = (t: EventTarget | null) => t instanceof Element && !!t.closest('input, textarea, select, [contenteditable]');

// Active tool = solid signal blue, the one place the chrome spends colour. Tool switching is frequent, so feedback
// is a 150ms colour change plus the 0.96 press scale, nothing more. Radii: 8px buttons + 4px padding = 12px shell.
const slotClass = (on: boolean) => cn(
  'grid h-8 place-items-center rounded-lg outline-none transition-[background-color,color,scale] duration-150 active:scale-96 focus-visible:ring-2 focus-visible:ring-ring/90 [&_svg]:size-4',
  on ? 'bg-selection text-white' : 'text-foreground/75 pointer-hover:bg-foreground/8 pointer-hover:text-foreground',
);

// A toolbar slot that stands for several tools (split button): the main button runs the last-used one, the small
// chevron opens the list. Remembering the last choice keeps the common path one click.
function SplitSlot({ group, label, tool, pick }: { group: Tool[]; label: string; tool: Tool; pick: (id: Tool) => void }) {
  const [last, setLast] = useState<Tool>(group[0]);
  const active = group.includes(tool);
  // Shortcuts (R, O, L, P...) change the tool without touching this slot, so follow the store to keep `last` honest.
  useEffect(() => { if (group.includes(tool)) setLast(tool); }, [tool, group]);
  const shown = toolOf(active ? tool : last);
  return (
    <div role="group" aria-label={label} className="flex items-center">
      <Tip label={shown.label} keys={shown.key}><button type="button" aria-pressed={active} aria-label={`${shown.label} (${shown.key})`} onClick={() => pick(shown.id)} className={cn(slotClass(active), 'w-7 rounded-r-none')}>{shown.icon}</button></Tip>
      <DropdownMenu>
        <DropdownMenuTrigger render={<button type="button" aria-label={`More ${label.toLowerCase()} tools`} className={cn(slotClass(active), 'w-4 rounded-l-none [&_svg]:size-3')} />}><ChevronDown /></DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" sideOffset={10} className="w-44">
          {group.map((id) => { const t = toolOf(id); return (
            <DropdownMenuItem key={id} onClick={() => pick(id)}>{t.icon}{t.label}<DropdownMenuShortcut>{t.key}</DropdownMenuShortcut></DropdownMenuItem>
          ); })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// Bottom-centre floating toolbar, six slots: Move/Hand, Frame, Shapes, Text, Image, Comment. Frame (drag a rectangle),
// Text (click an element), Hand (drag to pan) and Comment are modes the canvas engine reads; Image opens a file
// picker (the picture becomes a reference board).
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
      // Shift+1 = fit all (Figma's key). Matched on `code`, not `key`: Shift+1 types "!" on QWERTY and "1" on AZERTY.
      if (e.shiftKey && e.code === 'Digit1') { e.preventDefault(); engine?.fit(); return; }
      const hit = TOOLS.find((t) => t.key.toLowerCase() === e.key.toLowerCase() && t.id !== 'comment');
      if (hit) pick(hit.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const single = (id: Tool) => { const t = toolOf(id); return (
    <Tip label={t.label} keys={t.key}><button type="button" aria-pressed={tool === id} aria-label={`${t.label} (${t.key})`} onClick={() => pick(id)} className={cn(slotClass(tool === id), 'w-8')}>{t.icon}</button></Tip>
  ); };
  const sep = <span aria-hidden className="mx-1 h-5 w-px bg-border" />;

  return (
    // Translucent material so the canvas stays visible under it.
    <div role="toolbar" aria-label="Tools" aria-orientation="horizontal" className="material absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-xl p-1">
      <input
        ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden aria-hidden tabIndex={-1}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void engine?.addImageFile(f); e.target.value = ''; }}
      />
      <SplitSlot group={POINTER_GROUP} label="Pointer" tool={tool} pick={pick} />
      {sep}
      {single('frame')}
      <SplitSlot group={SHAPE_GROUP} label="Shapes" tool={tool} pick={pick} />
      {sep}
      {single('text')}
      {single('image')}
      {sep}
      {single('comment')}
    </div>
  );
}

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'design', label: 'Design' }, { id: 'comment', label: 'Comments' }, { id: 'agents', label: 'Agents' },
];

// Agents tab: the live feed, plus the two things that used to be their own tabs: History (a view) and MCP (a collapsed section).
function AgentsTab({ projectId }: { projectId: string }) {
  return (
    <>
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <span className="text-[11px] text-muted-foreground">Who is working here</span>
        <Button variant="ghost" size="24" onClick={() => useUi.getState().openView('history')}><History />History</Button>
      </div>
      <AgentsPanel />
      <Collapsible className="border-t">
        <CollapsibleTrigger className="group flex h-8 w-full items-center gap-1.5 px-3 text-[11px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/90">
          <ChevronRight className="size-3 transition-transform duration-150 group-data-panel-open:rotate-90" />MCP connection
        </CollapsibleTrigger>
        <CollapsibleContent><McpPanel projectId={projectId} /></CollapsibleContent>
      </Collapsible>
    </>
  );
}

export function RightPanel({ projectId }: { projectId: string }) {
  const { panelTab, setPanelTab, panelOpen, panelView } = useUi();
  const open = useProject((s) => s.comments.filter((c) => !c.resolved).length);
  if (!panelOpen) return null;
  return (
    <aside aria-label="Inspector" className="flex w-68 shrink-0 flex-col border-l bg-background">
      {/* shadcn Tabs as a segmented control: three labelled tabs instead of eight icons. Panels render below, so
          only the list is used. */}
      <div className="shrink-0 border-b p-2">
        <Tabs value={panelTab} onValueChange={(v) => setPanelTab(v as PanelTab)}>
          <TabsList aria-label="Panels" className="w-full bg-field">
            {TABS.map((t) => (
              // onValueChange never fires for the already-active tab, so this click is what closes an open
              // History / Styles view (the Agents tab stays active while History is shown).
              <TabsTrigger key={t.id} value={t.id} onClick={() => panelView && setPanelTab(t.id)} className="data-active:bg-background data-active:shadow-sm">
                {t.label}
                {t.id === 'comment' && open > 0 && <span className="tnum grid h-3.5 min-w-3.5 place-items-center rounded-full bg-selection px-1 text-[9px] font-semibold text-white">{open}</span>}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="flex-1 overflow-auto">
        {panelView === 'history' && <HistoryView projectId={projectId} />}
        {panelView === 'styles' && <StylesView projectId={projectId} />}
        {!panelView && panelTab === 'design' && <InspectorPanel projectId={projectId} />}
        {!panelView && panelTab === 'comment' && <CommentsPanel />}
        {!panelView && panelTab === 'agents' && <AgentsTab projectId={projectId} />}
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
