import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { FolderPlus, LayoutGrid, List, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Skeleton } from '@/components/ui/skeleton';
import { Select,SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createProject, importProject, listAllComments, listProjects, projectAction, type ProjectSummary } from '@/api/projects';
import { useLiveReload } from '@/hooks/useLiveReload';
import { toast } from '@/store/toast';
import { cn } from '@/lib/utils';
import { ConnectAgentsDialog } from '@/shell/ConnectAgentsDialog';
import { useUi } from '@/store/ui';
import { HomeSidebar } from './home/HomeSidebar';
import { ProjectCard, type CardActions, type View } from './home/ProjectCard';

type Sort = 'recent' | 'created' | 'name';
const SORTS = [
  { value: 'recent', label: 'Recently edited' },
  { value: 'created', label: 'Newest first' },
  { value: 'name', label: 'Name A–Z' },
];
const BY: Record<Sort, (a: ProjectSummary, b: ProjectSummary) => number> = {
  recent: (a, b) => b.updatedAt - a.updatedAt,
  created: (a, b) => b.createdAt - a.createdAt,
  name: (a, b) => a.name.localeCompare(b.name),
};

const PAGE = 12; // divisible by the 2 and 3 grid columns, so pages end on a full row
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Project home: every project as a card with a live preview of its cover artboard. Names and descriptions can come
// from Claude, but React escapes text children, so no manual textContent handling is needed here.
export function HomePage() {
  const [live, setLive] = useState<ProjectSummary[]>([]);
  const [trashed, setTrashed] = useState<ProjectSummary[]>([]);
  const [openComments, setOpenComments] = useState(0);
  const [inTrash, setInTrash] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [newOpen, setNewOpen] = useState(false);
  // How many cards are mounted; each card renders a live preview, so the list grows in pages via "Load more".
  const [limit, setLimit] = useState(PAGE);
  // A new filter, sort or section starts again from the first page (state reset during render, no extra effect).
  const [listKey, setListKey] = useState('');
  const key = `${query}|${sort}|${inTrash}`;
  if (key !== listKey) { setListKey(key); setLimit(PAGE); }
  // Flips after the first non-empty list so later live refreshes do not replay the entrance animation.
  const [animateIn, setAnimateIn] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // "/" focuses search (GitHub/YouTube convention), unless the user is already typing in a field or a dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || document.querySelector('[role="dialog"]')) return;
      e.preventDefault(); // otherwise the "/" would be typed into the field we just focused
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Grid/list choice is remembered; localStorage can throw (private mode), so it is guarded.
  const [view, setView] = useState<View>(() => { try { return localStorage.getItem('dc-home-view') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; } });
  const changeView = (v: View) => { setView(v); try { localStorage.setItem('dc-home-view', v); } catch { /* not persisted */ } };

  const load = () => {
    Promise.all([listProjects(), listProjects({ trashed: true })])
      .then(([l, t]) => { setLive(l); setTrashed(t); setLoaded(true); })
      .catch((e) => toast(message(e)));
    // Open-comment count for the header badge; best effort.
    listAllComments().then((cs) => setOpenComments(cs.filter((c) => !c.resolved).length)).catch(() => {});
  };
  useEffect(load, []);
  // Reload shortly after any burst of project changes (Claude can fire many edits per second).
  const connection = useLiveReload(load, { projects: 300, 'comments-changed': 300 });

  // Run a server action, toast the outcome, then refresh. Errors from the server become the toast text.
  const act = async (p: ProjectSummary, action: string, done: string, body?: unknown) => {
    try { await projectAction(p.id, action, body); toast(done); } catch (e) { toast(message(e)); }
    load();
  };
  const actions: CardActions = {
    rename: (p, name) => act(p, 'rename', 'Renamed', { name }),
    duplicate: (p) => act(p, 'duplicate', 'Duplicated'),
    restore: (p) => act(p, 'restore', 'Restored'),
    purge: (p) => act(p, 'purge', 'Deleted forever'),
    // Soft delete with an Undo link instead of a confirmation dialog.
    trash: async (p) => {
      try {
        await projectAction(p.id, 'delete');
        toast(`“${p.name}” moved to Trash`, 'Undo', async () => { await projectAction(p.id, 'restore').catch(() => {}); load(); });
      } catch (e) { toast(message(e)); }
      load();
    },
  };

  const q = query.trim().toLowerCase();
  const shown = (inTrash ? trashed : live)
    .filter((p) => !q || `${p.name} ${p.description ?? ''}`.toLowerCase().includes(q))
    .sort(BY[sort]);
  // Cards animate only if they mount on the first paint; once any card is on screen, later mounts stop animating.
  const hasCards = shown.length > 0;
  useEffect(() => { if (loaded && hasCards) setAnimateIn(false); }, [loaded, hasCards]);

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const p = await importProject(JSON.parse(await file.text()));
      toast(`Imported “${p.name}”`);
    } catch (e) { toast(`Import failed: ${message(e)}`); }
    load();
  };

  return (
    <div className="flex h-full flex-col md:flex-row">
      <HomeSidebar
        inTrash={inTrash}
        onSection={setInTrash}
        liveCount={live.length}
        trashCount={trashed.length}
        openComments={openComments}
        connection={connection}
        onImport={() => fileRef.current?.click()}
        onConnect={() => useUi.getState().setConnectOpen(true)}
      />
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onImport(f); }} />

      <main className="min-h-0 flex-1 overflow-y-auto">
        {/* Sticky topbar: position sticky works because main is the scroll container, so New project and search
            stay reachable however far the list scrolls. Translucent + blur so cards read through it. */}
        <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-md">
        <div className="@container">
          {/* Narrow: title + New project on the first row, the controls group wraps to a full-width second row
              (order-last) so the search field gets the room. Wide: one row. A container query (@3xl = 48rem of the
              header's own width) is used instead of a viewport breakpoint because the sidebar eats part of the viewport. */}
          <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-2 px-4 py-3 md:px-10">
            <h1 className="mr-auto text-[13px] font-semibold whitespace-nowrap">{inTrash ? 'Trash' : 'Recent projects'} {loaded && <span className="tnum ml-2 font-normal text-muted-foreground">{shown.length}</span>}</h1>
            <div className="flex items-center gap-2 @max-3xl:order-last @max-3xl:w-full">
            <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md bg-field px-2.5 text-muted-foreground transition-colors duration-150 pointer-hover:bg-field-hover focus-within:ring-1 focus-within:ring-selection @3xl:w-56 @3xl:flex-none">
              <Search className="size-3.5 shrink-0" aria-hidden />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                // Esc clears first, then leaves the field, so the "/" shortcut can be used again right away.
                onKeyDown={(e) => { if (e.key === 'Escape') { if (query) setQuery(''); else e.currentTarget.blur(); } }}
                placeholder="Search"
                aria-label="Search projects"
                aria-keyshortcuts="/"
                className="peer min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
              />
              {/* Hint only while the field is idle; hidden on touch-sized screens where there is no keyboard. */}
              <Kbd className="max-sm:hidden peer-focus:hidden">/</Kbd>
            </label>
            <Select items={SORTS} value={sort} onValueChange={(v) => setSort(v as Sort)}>
              <SelectTrigger aria-label="Sort projects"><SelectValue /></SelectTrigger>
              <SelectContent>{SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
            <div role="group" aria-label="View" className="flex rounded-lg bg-muted p-0.5">
              {([['grid', LayoutGrid, 'Grid view'], ['list', List, 'List view']] as const).map(([v, Icon, label]) => (
                <button
                  key={v}
                  type="button"
                  aria-label={label}
                  aria-pressed={view === v}
                  onClick={() => changeView(v)}
                  className={cn('grid size-7 place-items-center rounded-md text-muted-foreground transition-colors duration-150', view === v && 'bg-background text-foreground shadow-sm')}
                >
                  <Icon className="size-4" />
                </button>
              ))}
            </div>
            </div>
            {!inTrash && <Button variant="brand" size="32" onClick={() => setNewOpen(true)}><Plus />New project</Button>}
          </div>
        </div>
        </header>

        <div className="mx-auto max-w-[1280px] px-4 pt-6 pb-16 md:px-10">
          <div className={cn(view === 'grid' ? 'grid gap-x-6 gap-y-8 sm:grid-cols-2 xl:grid-cols-3' : 'flex flex-col gap-2')}>
            {/* Until the first list arrives, placeholders stand in so the page never reads as "0 projects". */}
            {!loaded && Array.from({ length: 3 }, (_, i) => <CardSkeleton key={i} view={view} />)}
            {shown.slice(0, limit).map((p, i) => (
              <ProjectCard key={p.id} project={p} inTrash={inTrash} view={view} index={i} animateIn={animateIn} actions={actions} />
            ))}
          </div>

          {shown.length > limit && (
            <div className="mt-10 flex justify-center">
              <Button variant="outline" size="32" onClick={() => setLimit((n) => n + PAGE)}>Load more <span className="tnum text-muted-foreground">{shown.length - limit}</span></Button>
            </div>
          )}

          {loaded && shown.length === 0 && <EmptyState query={query} inTrash={inTrash} onNew={() => setNewOpen(true)} />}
        </div>
      </main>

      <ConnectAgentsDialog />
      <NewProjectDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}

// Loading placeholder shaped like ProjectCard (grid: 200px preview in a padded card; list: 96x60 thumb) so nothing jumps
// when the real cards replace it. The pulse stops for reduced-motion users.
function CardSkeleton({ view }: { view: View }) {
  const bar = 'motion-reduce:animate-none';
  if (view === 'list') {
    return (
      <div aria-hidden className="flex items-center gap-4 rounded-xl p-2">
        <Skeleton className={cn('h-[60px] w-24 shrink-0', bar)} />
        <div className="flex flex-1 flex-col gap-2"><Skeleton className={cn('h-4 w-40', bar)} /><Skeleton className={cn('h-3 w-56', bar)} /></div>
      </div>
    );
  }
  return (
    <div aria-hidden className="flex flex-col gap-3">
      <div className="rounded-2xl border bg-card p-2"><Skeleton className={cn('h-[200px] w-full rounded-lg', bar)} /></div>
      <div className="flex flex-col gap-2 px-1"><Skeleton className={cn('h-4 w-2/5', bar)} /><Skeleton className={cn('h-3 w-3/5', bar)} /></div>
    </div>
  );
}

// First run, empty Trash and no search match share one shadcn Empty; only the first run offers the setup command.
function EmptyState({ query, inTrash, onNew }: { query: string; inTrash: boolean; onNew: () => void }) {
  const [Icon, title, body] = query
    ? [Search, 'No matches', 'Try a different search.']
    : inTrash
      ? [Trash2, 'Trash is empty', 'Deleted projects stay here until you remove them for good.']
      : [FolderPlus, 'No projects yet', 'Create one here, or ask your agent to design something and it will create a project for you.'];
  return (
    <Empty className="border py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Icon /></EmptyMedia>
        <EmptyTitle className="font-display text-xl tracking-[-0.03em]">{title}</EmptyTitle>
        <EmptyDescription>{body}</EmptyDescription>
      </EmptyHeader>
      {!query && !inTrash && (
        <EmptyContent>
          <Button variant="brand" size="32" onClick={onNew}><Plus />New project</Button>
          <code className="mt-2 block w-fit rounded-lg bg-field px-3.5 py-2.5 text-xs text-foreground select-all">
            claude mcp add --transport http design-canvas http://localhost:3777/mcp
          </code>
        </EmptyContent>
      )}
    </Empty>
  );
}

// A real dialog (not window.prompt) so it never blocks the page. Creating a project opens it straight away.
function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const p = await createProject(String(f.get('name')), String(f.get('description')));
      onOpenChange(false);
      navigate({ to: '/p/$id', params: { id: p.id } });
    } catch (err) { toast(message(err)); }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader><DialogTitle>New project</DialogTitle></DialogHeader>
          <label className="grid gap-1.5 text-xs font-medium">
            Name
            <Input name="name" autoFocus required maxLength={80} placeholder="e.g. Checkout redesign" />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            <span>Description <span className="font-normal text-muted-foreground">(optional)</span></span>
            <Input name="description" maxLength={300} placeholder="What are you designing?" />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
