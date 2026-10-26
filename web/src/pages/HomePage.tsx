import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { LayoutGrid, List, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  // Flips after the first non-empty list so later live refreshes do not replay the entrance animation.
  const [animateIn, setAnimateIn] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
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
        query={query}
        onQuery={setQuery}
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
        <div className="mx-auto max-w-[1280px] px-8 pt-10 pb-16">
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <h1 className="mr-auto text-[22px] font-medium tracking-tight">{inTrash ? 'Trash' : 'Recents'}</h1>
            <Select items={SORTS} value={sort} onValueChange={(v) => setSort(v as Sort)}>
              <SelectTrigger aria-label="Sort projects"><SelectValue /></SelectTrigger>
              <SelectContent>{SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
            <Button onClick={() => setNewOpen(true)}><Plus />New project</Button>
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

          <div
            className={cn('gap-6', view === 'grid' ? 'grid justify-start' : 'flex flex-col gap-2')}
            style={view === 'grid' ? { gridTemplateColumns: 'repeat(auto-fill, 256px)' } : undefined}
          >
            {shown.map((p, i) => (
              <ProjectCard key={p.id} project={p} inTrash={inTrash} view={view} index={i} animateIn={animateIn} actions={actions} />
            ))}
          </div>

          {loaded && shown.length === 0 && <EmptyState query={query} inTrash={inTrash} />}
        </div>
      </main>

      <ConnectAgentsDialog />
      <NewProjectDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}

function EmptyState({ query, inTrash }: { query: string; inTrash: boolean }) {
  const [title, body] = query
    ? ['No matches', 'Try a different search.']
    : inTrash
      ? ['Trash is empty', 'Deleted projects stay here until you remove them for good.']
      : ['No projects yet', 'Create one here, or ask Claude to design something and it will create a project for you.'];
  return (
    <div className="py-16 text-center text-muted-foreground text-balance">
      <h2 className="mb-2 text-base font-semibold text-foreground">{title}</h2>
      {body}
      {!query && !inTrash && (
        <code className="mx-auto mt-4 block w-fit rounded-lg border bg-background px-3.5 py-2.5 text-xs text-foreground select-all">
          claude mcp add --transport http design-canvas http://localhost:3777/mcp
        </code>
      )}
    </div>
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
