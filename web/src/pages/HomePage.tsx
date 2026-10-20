import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createProject, importProject, listAllComments, listProjects, projectAction, type ProjectSummary } from '@/api/projects';
import { useLiveReload } from '@/hooks/useLiveReload';
import { toast } from '@/store/toast';
import { AppHeader } from '@/ui/AppHeader';
import { ProjectCard, type CardActions } from './home/ProjectCard';

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
    <div className="h-full overflow-y-auto bg-muted/30">
      <AppHeader
        connection={connection}
        actions={
          <>
            <Link to="/comments" className={buttonVariants({ variant: 'outline' })}>
              Comments
              {openComments > 0 && <span className="rounded-full bg-amber-500/20 px-1.5 text-[11px] font-bold text-amber-600 dark:text-amber-300">{openComments}</span>}
            </Link>
            <Button variant="outline" title="Import a .dcproject.json file" onClick={() => fileRef.current?.click()}>Import</Button>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onImport(f); }} />
            <Button onClick={() => setNewOpen(true)}>+ New project</Button>
          </>
        }
      >
        <Input type="search" placeholder="Search projects" aria-label="Search projects" className="w-64" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select items={SORTS} value={sort} onValueChange={(v) => setSort(v as Sort)}>
          <SelectTrigger aria-label="Sort projects"><SelectValue /></SelectTrigger>
          <SelectContent>{SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
        </Select>
      </AppHeader>

      <main className="mx-auto max-w-[1280px] px-7 pt-6 pb-16">
        <Tabs value={inTrash ? 'trash' : 'all'} onValueChange={(v) => setInTrash(v === 'trash')} className="mb-5">
          <TabsList>
            <TabsTrigger value="all">Projects <span className="tnum opacity-70">{live.length || ''}</span></TabsTrigger>
            <TabsTrigger value="trash">Trash <span className="tnum opacity-70">{trashed.length || ''}</span></TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="grid justify-start gap-6" style={{ gridTemplateColumns: 'repeat(auto-fill, 320px)' }}>
          {shown.map((p, i) => (
            <ProjectCard key={p.id} project={p} inTrash={inTrash} index={i} animateIn={animateIn} actions={actions} />
          ))}
        </div>

        {loaded && shown.length === 0 && <EmptyState query={query} inTrash={inTrash} />}
      </main>

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
