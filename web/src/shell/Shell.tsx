import { Link } from '@tanstack/react-router';
import { projectAction } from '@/api/projects';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/store/toast';
import { ArrowLeft, GitCommitHorizontal, Shapes, ChevronDown, ChevronRight, Circle, Crosshair, FolderOpen, Frame, Hand, History, Image, Keyboard, Map as MapIcon, Maximize, MessageSquare, Minus, MousePointer2, Moon, PanelLeft, PenTool, Plug, Plus, Ruler, Search, Slash, Square, Type } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
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
import { ZOOM_STEP } from '@/canvas/engine';
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
      <Tip label="Zoom out" keys="−" side="bottom"><Button variant="outline" size="icon" aria-label="Zoom out" onClick={() => engine?.zoomBy(1 / ZOOM_STEP)}><Minus /></Button></Tip>
      <ButtonGroupText className="tnum w-12 justify-center px-0 text-[11px] font-medium">{Math.round(zoom * 100)}%</ButtonGroupText>
      <Tip label="Zoom in" keys="+" side="bottom"><Button variant="outline" size="icon" aria-label="Zoom in" onClick={() => engine?.zoomBy(ZOOM_STEP)}><Plus /></Button></Tip>
      <Tip label="Fit all" keys="⇧1" side="bottom"><Button variant="outline" size="icon" aria-label="Fit all artboards" onClick={() => engine?.fit()}><Maximize /></Button></Tip>
    </ButtonGroup>
  );
}

// Follow is about Claude, so its on state borrows the signal colour rather than the neutral "pressed" grey.
function FollowButton({ labelled = false }: { labelled?: boolean }) {
  const { engine, follow, setFollow } = useCanvas();
  return (
    <Tip label="Follow Claude's camera" side="bottom"><Button
      variant="ghost" size={labelled ? '28' : 'icon'} aria-pressed={follow} aria-label="Follow Claude's camera"
      className={cn(follow && 'bg-selection-soft text-selection-ink hover:bg-selection-soft hover:text-selection-ink')}
      onClick={() => { setFollow(!follow); engine?.setFollow(!follow); }}
    ><Crosshair />{labelled && 'Follow'}</Button></Tip>
  );
}

// Main menu = the project name's dropdown: everything used rarely lives here.
// (There is no Settings screen yet, so the menu has no Settings item.)
function MainMenu() {
  const { theme, rulers, minimap } = useUi();
  const name = useProject((s) => s.meta?.name);
  const actions = useActions();
  const setTheme = (t: string) => { if (t !== useUi.getState().theme) useUi.getState().toggleTheme(); };
  // Labels and shortcuts come from the registry (lib/actions.ts), so this menu cannot drift from the palette or the dialog.
  const act = (id: string) => actions.find((a) => a.id === id)!;
  const item = (id: string, icon: ReactNode) => { const a = act(id); return (
    <DropdownMenuItem onClick={a.run}>{icon}{a.label}{a.keys && <DropdownMenuShortcut>{formatKeys(a.keys[0], isMac)}</DropdownMenuShortcut>}</DropdownMenuItem>
  ); };
  const rulersAction = act('view.rulers');
  const minimapAction = act('view.minimap');
  return (
    <DropdownMenu>
      {/* React escapes text, so untrusted project names are safe here. */}
      <Tip label="Main menu" side="bottom"><DropdownMenuTrigger render={<button type="button" aria-label="Main menu" className="flex h-7 min-w-0 items-center gap-1 rounded-md px-1.5 text-[13px] font-semibold outline-none transition-[background-color,scale] duration-150 active:scale-96 focus-visible:ring-2 focus-visible:ring-ring/90 pointer-hover:bg-foreground/8" />}><span className="truncate">{name ?? '…'}</span><ChevronDown aria-hidden className="size-3 shrink-0 text-muted-foreground" /></DropdownMenuTrigger></Tip>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem render={<Link to="/" />}><FolderOpen />{act('project.home').label}</DropdownMenuItem>
        {item('help.palette', <Search />)}
        {item('project.connect', <Plug />)}
        {item('panel.history', <History />)}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={rulers} onCheckedChange={rulersAction.run}><Ruler />{rulersAction.label}<DropdownMenuShortcut>{formatKeys(rulersAction.keys![0], isMac)}</DropdownMenuShortcut></DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={minimap} onCheckedChange={minimapAction.run}><MapIcon />{minimapAction.label}<DropdownMenuShortcut>{formatKeys(minimapAction.keys![0], isMac)}</DropdownMenuShortcut></DropdownMenuCheckboxItem>
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
    <div className="absolute top-18 right-7 z-10 flex flex-col items-end gap-1.5">
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

const PanelsToggle = () => {
  const { togglePanels, layersOpen, panelOpen } = useUi();
  return <Tip label="Show / hide panels" side="bottom"><Button variant="ghost" size="icon" aria-pressed={layersOpen || panelOpen} aria-label="Toggle panels" onClick={togglePanels}><PanelLeft /></Button></Tip>;
};

const BackButton = () => (
  <Tip label="All projects" side="bottom"><Link to="/" aria-label="All projects" className={buttonVariants({ variant: 'ghost', size: 'icon' })}><ArrowLeft /></Link></Tip>
);

function ExportButton() {
  const engine = useCanvas((s) => s.engine);
  return <Tip label="Export" keys={`${modLabel()}${shiftLabel()}E`} side="bottom"><Button variant="brand" size="28" onClick={() => engine && openExport(engine)}>Export</Button></Tip>;
}

// Header strips (panel headers and the floating pills) carry data-drag so a desktop shell can turn them into the
// window drag area; interactive children would then be marked no-drag.
// Floating pills: shown only while the matching panel is closed, so the canvas keeps name, panels toggle, zoom and
// Export. They sit inside the canvas sheet (the Rulers occupy the first 20px, hence the 28px offset).
export function FloatingPills() {
  const { layersOpen, panelOpen } = useUi();
  return (
    <>
      {!layersOpen && (
        <div data-drag className="material absolute top-7 left-7 z-10 flex h-9 max-w-1/2 items-center gap-0.5 rounded-xl px-1">
          <BackButton /><MainMenu /><PanelsToggle />
        </div>
      )}
      {!panelOpen && (
        <div data-drag className="material absolute top-7 right-7 z-10 flex h-9 items-center gap-1 rounded-xl px-1">
          <ZoomControls /><FollowButton /><ExportButton />
        </div>
      )}
    </>
  );
}

// Bottom-right pill: who is working and the connection. Replaces the old top-bar centre zone.
export function StatusDock() {
  return (
    <div className="material absolute right-4 bottom-4 z-10 flex h-9 max-w-1/3 items-center gap-1 rounded-xl px-1.5">
      <AgentChips />
      <StatusPill />
    </div>
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

// Toolbar "Component": lists the project's masters; picking one drops an instance into the selection (or the first
// board). Masters live in doc.components, which the doc event already carries.
function ComponentSlot() {
  const engine = useCanvas((s) => s.engine);
  const names = Object.keys((useProject((s) => s.doc)?.components as Record<string, unknown> | undefined) ?? {});
  return (
    <DropdownMenu>
      <Tip label="Insert component">
        <DropdownMenuTrigger render={<button type="button" aria-label="Insert component" className={cn(slotClass(false), 'w-8')} />}><Shapes /></DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent side="top" align="center" sideOffset={10} className="max-h-72 w-48">
        {names.length ? names.map((n) => <DropdownMenuItem key={n} onClick={() => void engine?.insertComponent(n)}>{n}</DropdownMenuItem>)
          : <DropdownMenuItem disabled>No components yet</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Toolbar "Commit version": a named snapshot (the same server action as Save version in History, but with your label).
function CommitVersion({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const save = async () => {
    try {
      await projectAction(projectId, 'snapshot', { label: label.trim() || 'Saved version' });
      toast('Version saved');
      setLabel(''); setOpen(false);
    } catch (e) { toast((e as Error).message || 'Could not save a version'); }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tip label="Commit version">
        <PopoverTrigger render={<button type="button" aria-label="Commit version" className={cn(slotClass(open), 'w-8')} />}><GitCommitHorizontal /></PopoverTrigger>
      </Tip>
      <PopoverContent side="top" sideOffset={10} className="w-64 gap-2">
        <Input autoFocus value={label} maxLength={80} placeholder="Version name" aria-label="Version name"
          onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} />
        <Button size="sm" onClick={() => void save()}>Save version</Button>
      </PopoverContent>
    </Popover>
  );
}

// Bottom-centre floating toolbar, six slots: Move/Hand, Frame, Shapes, Text, Image, Comment. Frame (drag a rectangle),
// Text (click an element), Hand (drag to pan) and Comment are modes the canvas engine reads; Image opens a file
// picker (the picture becomes a reference board).
export function FloatingToolbar({ projectId }: { projectId: string }) {
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
      if (e.shiftKey && e.key.toLowerCase() === 'm') { useUi.getState().toggleMinimap(); return; }
      // Shift+1 = fit all (Figma's key). Matched on `code`, not `key`: Shift+1 types "!" on QWERTY and "1" on AZERTY.
      if (e.shiftKey && e.code === 'Digit1') { e.preventDefault(); engine?.fit(); return; }
      if (e.shiftKey && e.code === 'Digit2') { e.preventDefault(); engine?.zoomToSelection(); return; }
      // + / - zoom (the zoom buttons' tooltips promise these keys). `=` too, so + works without Shift on QWERTY.
      if (e.key === '+' || e.key === '=') { e.preventDefault(); engine?.zoomBy(ZOOM_STEP); return; }
      if (e.key === '-') { e.preventDefault(); engine?.zoomBy(1 / ZOOM_STEP); return; }
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
      <ComponentSlot />
      {sep}
      {single('comment')}
      <CommitVersion projectId={projectId} />
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

// Figma-style: picking an element opens the panels (and shows the Design tab). Keyed on the selected ids, not just
// on "something is selected", so closing the panels and then clicking another element opens them again.
// Below 1024px only the inspector opens (both would leave the canvas too narrow).
export function useAutoOpenPanels() {
  const key = useCanvas((s) => s.selected.join(','));
  useEffect(() => {
    if (!key) return;
    const ui = useUi.getState();
    ui.setPanelTab('design'); // also opens the inspector and leaves any History / Styles view
    if (window.innerWidth >= 1024 && !ui.layersOpen) ui.toggleLayers();
  }, [key]);
}

// Slides a side panel in and out with translate + opacity only. The slot reserves (or frees) the layout width at
// once, so the canvas never re-measures mid-animation; the panel itself is absolutely placed in the slot and, while
// leaving, travels over the canvas edge and out of the window. Panels are floating sheets (8px in from the window
// edges, shadow-float instead of a border) on the borderless canvas. Mounted stays true until the exit finishes.
// shown lags mounted by a tick so the entry has a "from" state to transition from (a bare mount would just appear).
function SlideSlot({ open, side, width, children }: { open: boolean; side: 'left' | 'right'; width: string; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);
  useEffect(() => {
    // setTimeout rather than rAF: rAF never fires in background tabs, which would leave the panel invisible.
    if (open) { setMounted(true); const t = setTimeout(() => setShown(true), 16); return () => clearTimeout(t); }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 220);
    return () => clearTimeout(t);
  }, [open]);
  const out = side === 'left' ? '-translate-x-[110%]' : 'translate-x-[110%]';
  return (
    <div className={cn('relative shrink-0', open ? cn(width, side === 'left' ? 'ml-2' : 'mr-2') : 'w-0')}>
      {mounted && (
        <div
          inert={!open}
          className={cn(
            'absolute inset-y-2 z-10 transition-[translate,opacity] duration-200 ease-(--ease-drawer) motion-reduce:duration-150',
            width, side === 'left' ? 'left-0' : 'right-0',
            // Reduced motion keeps the fade and drops the travel.
            !shown && cn('opacity-0 pointer-events-none', out, 'motion-reduce:translate-x-0'),
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function RightPanel({ projectId }: { projectId: string }) {
  const { panelTab, setPanelTab, panelOpen, panelView } = useUi();
  const open = useProject((s) => s.comments.filter((c) => !c.resolved).length);
  return (
    <SlideSlot open={panelOpen} side="right" width="w-68">
    <aside aria-label="Inspector" className="flex h-full w-full flex-col overflow-hidden rounded-2xl bg-background shadow-float">
      {/* shadcn Tabs as a segmented control: three labelled tabs instead of eight icons. Panels render below, so
          only the list is used. */}
      <div data-drag className="flex h-11 shrink-0 items-center justify-between gap-1 border-b px-2">
        <ZoomControls /><FollowButton /><ExportButton />
      </div>
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
      {/* Stable gutter: the content keeps one width whether or not this view scrolls (board vs node view used to shift). */}
      <div className="flex-1 overflow-auto [scrollbar-gutter:stable]">
        {panelView === 'history' && <HistoryView projectId={projectId} />}
        {panelView === 'styles' && <StylesView projectId={projectId} />}
        {!panelView && panelTab === 'design' && <InspectorPanel projectId={projectId} />}
        {!panelView && panelTab === 'comment' && <CommentsPanel />}
        {!panelView && panelTab === 'agents' && <AgentsTab projectId={projectId} />}
      </div>
    </aside>
    </SlideSlot>
  );
}

// Left drawer: the page list on top, then the layer tree of the active page (search, rename, hide/lock, drag to reorder).
export function LeftPanel({ projectId }: { projectId: string }) {
  const layersOpen = useUi((s) => s.layersOpen);
  return (
    <SlideSlot open={layersOpen} side="left" width="w-60">
      <aside aria-label="Pages and layers" className="flex h-full w-full flex-col overflow-hidden rounded-2xl bg-background shadow-float">
        <div data-drag className="flex h-11 shrink-0 items-center gap-0.5 border-b px-2">
          <BackButton /><div className="flex min-w-0 flex-1"><MainMenu /></div><PanelsToggle />
        </div>
        <PagesPanel projectId={projectId} />
        <h2 className="flex h-8 shrink-0 items-center px-3 text-[11px] font-semibold">Layers</h2>
        <LayersPanel projectId={projectId} />
      </aside>
    </SlideSlot>
  );
}
