import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { canvasAction, listAllComments } from '@/api/projects';
import type { OverviewComment } from '@/api/types';
import { useLiveReload } from '@/hooks/useLiveReload';
import { ago } from '@/lib/time';
import { cn } from '@/lib/utils';
import { toast } from '@/store/toast';
import { AppHeader } from '@/ui/AppHeader';

type Status = 'all' | 'open' | 'resolved';

const WHO = [
  { value: 'any', label: 'Anyone' },
  { value: 'user', label: 'From you' },
  { value: 'claude', label: 'From Claude' },
];

const authorLabel = (a?: string) => (a === 'claude' ? 'Claude' : 'You');
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Every comment from every project, with its status. Comment text and project/artboard names can come from Claude or
// imported files; React escapes text children, so rendering them as text is safe (never use dangerouslySetInnerHTML).
export function CommentsPage() {
  const [all, setAll] = useState<OverviewComment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<Status>('all');
  const [query, setQuery] = useState('');
  const [project, setProject] = useState('all');
  const [who, setWho] = useState('any');

  const load = () => listAllComments().then((cs) => { setAll(cs); setLoaded(true); }).catch((e) => toast(errMsg(e)));
  useEffect(() => { load(); }, []);
  // Any comment change anywhere (resolve here, Claude replying, a pin added) refreshes the list; renames/deletions too.
  const connection = useLiveReload(load, { 'comments-changed': 150, projects: 300 });

  // The project filter lists only projects that actually have comments, sorted by name.
  const projects = [...new Map(all.map((c) => [c.projectId, c.projectName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const projectItems = [{ value: 'all', label: 'All projects' }, ...projects.map(([id, name]) => ({ value: id, label: name }))];
  // A project filter whose project lost its last comment would otherwise hide everything; fall back to all.
  const activeProject = projects.some(([id]) => id === project) ? project : 'all';

  const q = query.trim().toLowerCase();
  // Counts follow the project/author/search filters, so the tabs always match what you would see.
  const base = all.filter((c) =>
    (activeProject === 'all' || c.projectId === activeProject)
    && (who === 'any' || c.author === who)
    && (!q || `${c.text} ${c.projectName} ${c.artboardName ?? ''} ${c.replies.map((r) => r.text).join(' ')}`.toLowerCase().includes(q)));
  const nOpen = base.filter((c) => !c.resolved).length;
  const shown = base.filter((c) => status === 'all' || (status === 'open') === !c.resolved);

  return (
    <div className="h-full overflow-y-auto bg-muted/30">
      <AppHeader crumb="Comments" connection={connection}>
        <Input type="search" placeholder="Search comments" aria-label="Search comments" className="w-64" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select items={projectItems} value={activeProject} onValueChange={(v) => setProject(String(v))}>
          <SelectTrigger aria-label="Filter by project"><SelectValue /></SelectTrigger>
          <SelectContent>{projectItems.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select items={WHO} value={who} onValueChange={(v) => setWho(String(v))}>
          <SelectTrigger aria-label="Filter by author"><SelectValue /></SelectTrigger>
          <SelectContent>{WHO.map((w) => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}</SelectContent>
        </Select>
      </AppHeader>

      <main className="mx-auto max-w-[860px] px-7 pt-6 pb-16">
        {/* Status tabs double as the summary: how many are open vs resolved. */}
        <Tabs value={status} onValueChange={(v) => setStatus(v as Status)} className="mb-5">
          <TabsList>
            <TabsTrigger value="all">All <span className="tnum opacity-70">{base.length}</span></TabsTrigger>
            <TabsTrigger value="open">Open <span className="tnum opacity-70">{nOpen}</span></TabsTrigger>
            <TabsTrigger value="resolved">Resolved <span className="tnum opacity-70">{base.length - nOpen}</span></TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-col gap-3">
          {shown.map((c, i) => <CommentCard key={`${c.projectId}/${c.id}`} comment={c} index={i} animateIn={!loaded || i < 10} />)}
        </div>

        {loaded && shown.length === 0 && (
          <div className="py-16 text-center text-muted-foreground text-balance">
            <h2 className="mb-2 text-base font-semibold text-foreground">{all.length ? 'Nothing matches' : 'No comments yet'}</h2>
            {all.length ? 'Try another filter.' : 'Open a project, press C and click an element to leave a comment. Claude reads open comments and replies.'}
          </div>
        )}
      </main>
    </div>
  );
}

// Where the comment points, in words: "Home · button “Sign in”".
function Where({ c }: { c: OverviewComment }) {
  const target = c.orphaned
    ? <span className="italic">{c.targetId.startsWith('A') ? 'artboard was replaced or deleted' : 'element was deleted'}</span>
    : c.element
      ? <span>{c.element.tag}{c.element.text ? ` “${c.element.text}”` : ''}</span>
      : <span>artboard</span>;
  return (
    <div className="min-w-0 truncate text-xs text-muted-foreground">
      <b className="font-semibold text-foreground">{c.projectName}</b>{c.artboardName ? ` · ${c.artboardName}` : ''} · {target}
    </div>
  );
}

function CommentCard({ comment: c, index, animateIn }: { comment: OverviewComment; index: number; animateIn: boolean }) {
  // Local state is kept across live refreshes because the card is keyed by project + comment id.
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const disarm = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(disarm.current), []);

  const run = (action: string, body: object) => canvasAction(c.projectId, action, body).catch((e) => toast(errMsg(e)));
  const n = c.replies.length;

  // Delete needs a second click: the first arms the button, and it disarms itself after 3s.
  const onDelete = () => {
    if (!armed) {
      setArmed(true);
      disarm.current = setTimeout(() => setArmed(false), 3000);
      return;
    }
    run('comment-delete', { commentId: c.id });
  };

  return (
    <article
      className={cn('rounded-xl border bg-card px-[18px] py-4', animateIn && 'animate-in fade-in slide-in-from-bottom-1.5 duration-300 fill-mode-backwards')}
      style={animateIn ? { animationDelay: `${Math.min(index, 10) * 40}ms` } : undefined}
    >
      <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
        <span className={cn(
          'inline-flex h-[22px] items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold before:size-[7px] before:rounded-full',
          // Status ink is dark enough for small text (AA) on its tint; the dot uses the livelier fill.
          c.resolved
            ? 'bg-[oklch(0.95_0.04_160)] text-[oklch(0.42_0.1_160)] before:bg-[oklch(0.65_0.15_160)] dark:bg-[oklch(0.3_0.05_160)] dark:text-[oklch(0.82_0.12_160)]'
            : 'bg-[oklch(0.95_0.05_85)] text-[oklch(0.45_0.1_65)] before:bg-[oklch(0.72_0.15_75)] dark:bg-[oklch(0.32_0.06_80)] dark:text-[oklch(0.85_0.12_85)]',
        )}>
          {c.resolved ? 'Resolved' : 'Open'}
        </span>
        <Where c={c} />
        <span className="tnum ml-auto text-[11px] whitespace-nowrap text-muted-foreground">{ago(c.createdAt)}</span>
      </div>

      <div className={cn('text-sm/[22px] whitespace-pre-wrap [overflow-wrap:anywhere] text-pretty', c.resolved && 'text-muted-foreground')}>
        <span className="mr-2 text-xs font-semibold text-muted-foreground">{authorLabel(c.author)}</span>{c.text}
      </div>

      {repliesOpen && n > 0 && (
        <div className="mt-3 flex flex-col gap-2 border-l-2 pl-3.5">
          {c.replies.map((r, i) => (
            <div key={i} className="text-[13px]/5 whitespace-pre-wrap [overflow-wrap:anywhere]">
              <span className="mr-2 text-xs font-semibold text-muted-foreground">{authorLabel(r.author)}</span>{r.text}
              <small className="tnum ml-1.5 text-muted-foreground">{ago(r.createdAt)}</small>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3.5 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => run('comment-resolve', { commentId: c.id, resolved: !c.resolved })}>{c.resolved ? 'Reopen' : 'Resolve'}</Button>
        <Link to="/p/$id" params={{ id: c.projectId }} search={{ comment: c.id }} className={buttonVariants({ variant: 'outline', size: 'sm' })}>Open on canvas</Link>
        {n > 0 && (
          <Button variant="outline" size="sm" aria-expanded={repliesOpen} onClick={() => setRepliesOpen((o) => !o)}>
            {repliesOpen ? 'Hide' : 'Show'} {n} repl{n === 1 ? 'y' : 'ies'}
          </Button>
        )}
        <Button variant="ghost" size="sm" className={cn('ml-auto text-destructive hover:text-destructive', armed && 'border-destructive')} onClick={onDelete}>
          {armed ? 'Click to confirm' : 'Delete'}
        </Button>
      </div>
    </article>
  );
}
