import { ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { projectAction } from '@/api/projects';
import { Button } from '@/components/ui/button';
import { useJson } from '@/hooks/useJson';
import { ago } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useProject } from '@/store/project';
import { toast } from '@/store/toast';
import type { CallEntry } from '@/store/agents';
import { Tip } from '@/ui/Tip';

// What the server's grouped activity looks like (src/store.mjs listActivity). Every string here is untrusted
// (prompts, agent and board names, markup snippets): it is only ever rendered as React text.
interface Diff { boards: { id: string; name: string; kind: 'added' | 'changed' | 'removed'; before: string; after: string; clipped: boolean }[]; more: number; other: string[] }
interface Step { n: number; t: number; tool: string; artboard?: string; detail?: string; diff?: Diff; reverted: boolean; canRevert: boolean }
interface Run {
  id: number; t: number; end: number; until: number | null; rev: number;
  prompt?: string | null; brief?: string;
  agent?: { id: string; name: string; color: string };
  actions: { tool: string; count: number; artboards: string[] }[];
  steps: Step[];
  restorable?: boolean; snapshotId?: string;
}
interface Snapshot { id: string; label: string; createdAt: number; artboards: number }

const TOOL_LABEL: Record<string, string> = {
  create_artboard: 'Created artboard', write_html: 'Wrote HTML', update_styles: 'Updated styles', set_text_content: 'Edited text',
  delete_nodes: 'Deleted', duplicate_nodes: 'Duplicated', rename_nodes: 'Renamed', set_tokens: 'Changed tokens', undo: 'Undid a change',
};
const KEEP_RUNS = 60;

const restore = async (projectId: string, snapshotId: string, message: string) => {
  try {
    await projectAction(projectId, 'restore-snapshot', { snapshotId });
    toast(message);
  } catch (e) { toast((e as Error).message || 'Could not restore'); }
};

// Runs, loaded incrementally: the first fetch gets the newest runs and a cursor (`seq`); each later `activity` tick
// asks only for runs that changed after it and merges them by id, instead of refetching and re-rendering everything.
function useActivityRuns(projectId: string, tick: number) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  const pid = useRef(projectId);

  useEffect(() => {
    if (pid.current !== projectId) { pid.current = projectId; seq.current = 0; setRuns(null); } // another project: start over
    let alive = true; // a slow answer must not land after a newer one or after unmount
    fetch(`/api/p/${projectId}/activity?since=${seq.current}`)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<{ runs: Run[]; seq: number }>; })
      .then((d) => {
        if (!alive) return;
        const first = seq.current === 0;
        seq.current = d.seq;
        setFailed(false);
        setRuns((prev) => {
          if (first || !prev) return d.runs;
          if (!d.runs.length) return prev; // nothing changed: keep the same array so nothing re-renders
          const byId = new Map(prev.map((r) => [r.id, r]));
          for (const r of d.runs) byId.set(r.id, r);
          return [...byId.values()].sort((a, b) => b.t - a.t).slice(0, KEEP_RUNS);
        });
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [projectId, tick]);

  return { runs, failed };
}

function Dot({ color }: { color: string }) {
  return <i className="size-2 shrink-0 rounded-full" style={{ background: color }} />;
}

// One side of a diff. The markup is shown as text in a scrollable block, never parsed.
function Side({ label, text, tint }: { label: string; text: string; tint: string }) {
  if (!text) return null;
  return (
    <div className="mt-1">
      <small className="text-muted-foreground">{label}</small>
      <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded px-1.5 py-1 font-mono text-[10px]" style={{ background: tint }}>{text}</pre>
    </div>
  );
}

// What one step changed, from the diff the server stored (clipped on the server too).
function DiffView({ diff }: { diff: Diff }) {
  return (
    <div className="mt-1 text-[11px]">
      {diff.boards.map((b) => (
        <div key={b.id} className="mb-1">
          <span className="font-medium">{b.name || b.id}</span> <span className="text-muted-foreground">{b.kind}{b.clipped ? ' · clipped' : ''}</span>
          <Side label="Before" text={b.before} tint="oklch(0.65 0.18 25 / 0.14)" />
          <Side label="After" text={b.after} tint="oklch(0.7 0.16 150 / 0.14)" />
        </div>
      ))}
      {diff.more > 0 && <p className="text-muted-foreground">+{diff.more} more board{diff.more === 1 ? '' : 's'}</p>}
      {diff.other.length > 0 && <p className="text-muted-foreground">Also changed: {diff.other.join(', ')}</p>}
    </div>
  );
}

function StepRow({ projectId, step }: { projectId: string; step: Step }) {
  const [busy, setBusy] = useState(false);
  const revert = async () => {
    setBusy(true);
    try {
      await projectAction(projectId, 'revert-step', { n: step.n });
      toast('Reverted this step. The others are kept.');
    } catch (e) { toast((e as Error).message || 'Could not revert'); }
    setBusy(false);
  };
  return (
    <li className="py-1">
      <div className="flex items-center gap-1.5">
        <span className={cn('min-w-0 flex-1 truncate', step.reverted && 'text-muted-foreground line-through')}>
          {TOOL_LABEL[step.tool] || step.tool}{step.artboard ? ` · ${step.artboard}` : ''}
        </span>
        <small className="shrink-0 text-muted-foreground">{step.reverted ? 'Reverted' : ago(step.t)}</small>
        {step.canRevert && <Tip label="Undo just this step and keep the rest"><Button size="sm" variant="outline" className="h-5 px-1.5 text-[10px]" disabled={busy} onClick={revert}>Revert</Button></Tip>}
      </div>
      {step.diff && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">What changed</summary>
          <DiffView diff={step.diff} />
        </details>
      )}
    </li>
  );
}

// The agent's raw tool calls during this run (reads and reviews too), from the call log. Fetched only when the run is open.
function RunCalls({ projectId, run }: { projectId: string; run: Run }) {
  const start = run.t - 1500; // the log_prompt call itself starts just before its activity entry
  const { data, failed } = useJson<CallEntry[]>(`/api/p/${projectId}/calls?since=${start}`, run.rev);
  if (!data) return <p className="text-muted-foreground">{failed ? 'Could not read the calls.' : 'Loading calls…'}</p>;
  const mine = data.filter((c) => (!run.agent || c.agent?.id === run.agent.id) && (run.until === null || c.t < run.until - 1500));
  if (!mine.length) return <p className="text-muted-foreground">No calls kept for this run (the call log holds the latest 500).</p>;
  return (
    <ul className="divide-y">
      {mine.map((c) => (
        <li key={c.id} className="flex items-center gap-1.5 py-0.5">
          <span className={cn('min-w-0 flex-1 truncate font-mono text-[10px]', !c.ok && 'text-destructive')}>{c.tool}{typeof c.args.action === 'string' ? ` · ${c.args.action}` : ''}</span>
          <small className="shrink-0 text-muted-foreground">{c.ms} ms · ~{c.tokens} tok</small>
        </li>
      ))}
    </ul>
  );
}

function RunCard({ projectId, run: r }: { projectId: string; run: Run }) {
  const [open, setOpen] = useState(false);
  const [calls, setCalls] = useState(false);
  return (
    <div className="mb-3 border-b pb-3 last:border-b-0">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {r.agent && <div className="mb-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground"><Dot color={r.agent.color} /><span className="truncate">{r.agent.name}</span></div>}
          {/* Prompts are untrusted text: React escapes them. */}
          <div className="line-clamp-3 break-words font-medium">{r.prompt ? `“${r.prompt}”` : 'Edits'}</div>
          {/* The design brief Claude posted for a new design; also untrusted text, so no HTML. */}
          {r.brief && (
            <details className="mt-1 text-xs text-muted-foreground">
              <summary className="cursor-pointer">Design brief</summary>
              <p className="mt-1 whitespace-pre-wrap break-words">{r.brief}</p>
            </details>
          )}
          <small className="text-muted-foreground">{ago(r.t)}</small>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {r.actions.map((a, j) => (
              <span key={j} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                {TOOL_LABEL[a.tool] || a.tool}{a.count > 1 ? ` ×${a.count}` : ''}
                {a.artboards.length ? ` · ${a.artboards.slice(0, 2).join(', ')}${a.artboards.length > 2 ? '…' : ''}` : ''}
              </span>
            ))}
          </div>
        </div>
        {r.restorable && r.snapshotId && (
          <Tip label="Restore the project to how it was before this request"><Button size="sm" variant="outline"
            onClick={() => restore(projectId, r.snapshotId!, 'Undid this request. Redo it from the Versions tab.')}>Undo</Button></Tip>
        )}
      </div>
      {r.steps.length > 0 && (
        <button type="button" className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <ChevronRight className={cn('size-3', open && 'rotate-90')} />{r.steps.length} step{r.steps.length === 1 ? '' : 's'}
        </button>
      )}
      {open && (
        <div className="mt-1 pl-3 text-xs">
          <ul className="divide-y">{[...r.steps].reverse().map((s) => <StepRow key={s.n} projectId={projectId} step={s} />)}</ul>
          <button type="button" className="mt-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline" onClick={() => setCalls((v) => !v)}>{calls ? 'Hide calls' : 'Show every call'}</button>
          {calls && <div className="mt-1"><RunCalls projectId={projectId} run={r} /></div>}
        </div>
      )}
    </div>
  );
}

// Activity tab: one row per request and agent, expandable to its steps (each with a diff and a Revert) and raw calls.
// Loads incrementally on the server's `activity` event (counted in the project store).
export function ActivityPanel({ projectId }: { projectId: string }) {
  const tick = useProject((s) => s.activityTick);
  const { runs, failed } = useActivityRuns(projectId, tick);
  if (!runs) return <p className="p-3 text-muted-foreground">{failed ? 'Could not read the activity.' : 'Loading…'}</p>;
  if (!runs.length) return <p className="p-3 text-muted-foreground">Nothing yet. Requests you give Claude and the changes it makes will appear here.</p>;
  return (
    <div className="p-3">
      {runs.map((r) => <RunCard key={r.id} projectId={projectId} run={r} />)}
    </div>
  );
}

// Versions tab: automatic and manual snapshots. Restoring saves the current state first (server side), so it is undoable.
export function VersionsPanel({ projectId }: { projectId: string }) {
  const tick = useProject((s) => s.activityTick);
  const { data: list, failed, reload } = useJson<Snapshot[]>(`/api/projects/${projectId}/snapshots`, tick);
  const save = async () => {
    try {
      await projectAction(projectId, 'snapshot', { label: 'Saved version' });
      toast('Version saved');
      reload();
    } catch (e) { toast((e as Error).message || 'Could not save a version'); }
  };
  return (
    <div className="p-3">
      <Button size="sm" className="mb-3" onClick={save}>Save version</Button>
      {!list && <p className="text-muted-foreground">{failed ? 'Could not read the versions.' : 'Loading…'}</p>}
      {list && !list.length && <p className="text-muted-foreground">No versions yet. They are saved automatically while you work.</p>}
      {list?.map((s) => (
        <div key={s.id} className="mb-2 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <b className="block truncate font-medium">{s.label}</b>
            <small className="text-muted-foreground">{ago(s.createdAt)} · {s.artboards} artboard{s.artboards === 1 ? '' : 's'}</small>
          </div>
          <Button size="sm" variant="outline" onClick={async () => { await restore(projectId, s.id, 'Restored. The previous state is saved too.'); reload(); }}>Restore</Button>
        </div>
      ))}
    </div>
  );
}
