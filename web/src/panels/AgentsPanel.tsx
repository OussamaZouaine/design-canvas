import { Eye, Pause, Pencil, Play, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { idsInArgs, kindOf, presenceOf, useAgents, type CallEntry, type CallKind, type PendingCall, type Presence } from '@/store/agents';
import { useCanvas } from '@/store/canvas';
import { useProject } from '@/store/project';

// Re-render on a slow timer so "active" flips to "idle" (2 min) without any event arriving.
export function useNow(everyMs = 10_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), everyMs); return () => clearInterval(t); }, [everyMs]);
  return now;
}

// Agents seen on this project, from the call log. This is deliberately NOT derived from SSE clients: the headless
// render worker is an SSE client too, but it never makes MCP calls, so it can never show up here.
export function usePresence(): Presence[] {
  const calls = useAgents((s) => s.calls);
  const pending = useAgents((s) => s.pending);
  const now = useNow();
  return useMemo(() => presenceOf(calls, pending, now), [calls, pending, now]);
}

const ICON: Record<CallKind, typeof Eye> = { read: Eye, write: Pencil, review: ShieldCheck };
const KIND_LABEL: Record<CallKind, string> = { read: 'Read', write: 'Write', review: 'Review' };

// Short tool label for chips and rows, with the action for action-enum tools ("pages · set").
export function toolLabel(tool: string, args: Record<string, unknown>) {
  return typeof args.action === 'string' ? `${tool} · ${args.action}` : tool;
}

// Board (artboard) a call touched: the first artboard/node id in its argument summary, resolved to a name.
function useBoardOf() {
  const doc = useProject((s) => s.doc);
  const engine = useCanvas((s) => s.engine);
  return (args: Record<string, unknown>) => {
    for (const id of idsInArgs(args)) {
      const boardId = id.startsWith('A') ? id : engine?.boardOf(id);
      const ab = boardId ? doc?.artboards.find((a) => a.id === boardId) : undefined;
      if (ab) return { boardId: ab.id, name: ab.name, nodeId: id.startsWith('N') ? id : null };
    }
    return null;
  };
}

// Pause / resume one agent: the server makes its writes return a polite error until resumed (reads keep working).
// Fire and forget; the SSE `claims` event brings back the new paused list for every tab.
const setPaused = (agent: string, paused: boolean) =>
  void fetch('/api/agents/pause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent, paused }) }).catch(() => {});

const dur = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

function Dot({ color, pulse }: { color: string; pulse?: boolean }) {
  return <i className={cn('size-2 shrink-0 rounded-full', pulse && 'agent-pulse')} style={{ background: color }} />;
}

// Agents tab: who is working here and a live timeline of every MCP call, newest first. Click a row to jump to the
// board it touched. All text (agent names, board names, errors) is untrusted and rendered as React text.
export function AgentsPanel() {
  const calls = useAgents((s) => s.calls);
  const pending = useAgents((s) => s.pending);
  const { filterAgent, setFilterAgent, writesOnly, setWritesOnly, followAgent, setFollowAgent } = useAgents();
  const presence = usePresence();
  const paused = useAgents((s) => s.paused);
  const claims = useAgents((s) => s.claims);
  const engine = useCanvas((s) => s.engine);
  const boardOf = useBoardOf();

  const rows = useMemo(() => calls.filter((c) => (!filterAgent || c.agent?.id === filterAgent) && (!writesOnly || kindOf(c.tool, c.args) === 'write')).slice(0, 150), [calls, filterAgent, writesOnly]);
  const shownPending = pending.filter((p) => !filterAgent || p.agent?.id === filterAgent);

  const open = (c: CallEntry) => {
    const hit = boardOf(c.args);
    if (!hit || !engine) return;
    engine.focusBoard(hit.boardId);
    engine.selectNode(hit.nodeId ?? hit.boardId);
  };

  return (
    <div className="p-3">
      {presence.length > 0 && (
        <ul className="mb-3 space-y-0.5" aria-label="Agents on this project">
          {presence.map((a) => {
            const isPaused = paused.includes(a.id), held = claims.filter((c) => c.agent.id === a.id);
            return (
              <li key={a.id} className="flex items-center gap-2 rounded-md px-1.5 py-1">
                <Dot color={a.color} pulse={a.pending} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{a.name}</span>
                  <small className="block truncate text-muted-foreground">
                    {isPaused ? 'Paused: writes are refused' : held.length ? `Editing ${held.map((c) => c.name).join(', ')}` : a.active ? a.tool : 'Idle'}
                  </small>
                </span>
                <button
                  onClick={() => setPaused(a.id, !isPaused)} aria-pressed={isPaused}
                  aria-label={isPaused ? `Resume ${a.name}` : `Pause ${a.name}`} title={isPaused ? 'Resume this agent' : 'Pause this agent'}
                  className="flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[11px] transition-transform duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted"
                >
                  {isPaused ? <Play className="size-3" /> : <Pause className="size-3" />}{isPaused ? 'Resume' : 'Pause'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <select aria-label="Filter by agent" value={filterAgent ?? ''} onChange={(e) => setFilterAgent(e.target.value || null)} className="h-6 max-w-32 rounded-md border bg-background px-1 text-[11px]">
          <option value="">All agents</option>
          {presence.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground"><input type="checkbox" checked={writesOnly} onChange={(e) => setWritesOnly(e.target.checked)} />Writes only</label>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        Follow
        <select aria-label="Agent the camera follows" value={followAgent ?? ''} onChange={(e) => setFollowAgent(e.target.value || null)} className="h-6 max-w-32 rounded-md border bg-background px-1 text-[11px] text-foreground">
          <option value="">Any agent</option>
          {presence.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      <ul className="mt-3 space-y-0.5" aria-live="off">
        {shownPending.map((p) => <PendingRow key={p.id} p={p} />)}
        {rows.map((c) => {
          const kind = kindOf(c.tool, c.args), Icon = ICON[kind], hit = boardOf(c.args);
          return (
            <li key={c.id}>
              <button
                onClick={() => open(c)} disabled={!hit} title={c.error ?? undefined}
                className={cn('flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left', hit ? 'hover:bg-muted' : 'cursor-default', !c.ok && 'text-destructive')}
              >
                <Dot color={c.agent?.color ?? 'var(--muted-foreground)'} />
                <Icon className="size-3 shrink-0 text-muted-foreground" aria-label={KIND_LABEL[kind]} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{toolLabel(c.tool, c.args)}</span>
                  <small className={cn('block truncate', c.ok ? 'text-muted-foreground' : 'text-destructive')}>
                    {c.ok ? (hit?.name ?? c.agent?.name ?? '') : (c.error ?? 'failed')}
                  </small>
                </span>
                <span className="tnum shrink-0 text-right text-[10px] text-muted-foreground">{dur(c.ms)}<br />~{c.tokens.toLocaleString()} tok</span>
              </button>
            </li>
          );
        })}
      </ul>
      {!rows.length && !shownPending.length && (
        <p className="text-muted-foreground">{calls.length ? 'No calls match the filters.' : 'No MCP calls yet. When an agent works on this project, each call shows up here live.'}</p>
      )}
    </div>
  );
}

// A slow call (screenshot, layout check...) still waiting on the browser round-trip.
function PendingRow({ p }: { p: PendingCall }) {
  return (
    <li className="flex items-center gap-2 rounded-md px-1.5 py-1 text-muted-foreground">
      <Dot color={p.agent?.color ?? 'var(--muted-foreground)'} pulse />
      <span className="truncate">{toolLabel(p.tool, p.args)} · waiting…</span>
    </li>
  );
}
