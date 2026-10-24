import { create } from 'zustand';

// Live agent feed: the MCP call log as the server streams it (SSE `call` / `call-start`), seeded from
// GET /api/p/<id>/calls so a freshly opened tab sees recent history. Everything here is derived server-side
// from calls the agent already makes, so showing it costs the model nothing.

export interface AgentInfo { id: string; name: string; color: string }
export interface CallEntry {
  id: string; t: number; ms: number; tool: string; project: string; ok: boolean; error?: string;
  tokens: number; args: Record<string, unknown>; agent?: AgentInfo;
}
// A slow call (screenshot...) that started but has not finished: the "waiting for ..." state.
export interface PendingCall { id: string; t: number; tool: string; args: Record<string, unknown>; agent?: AgentInfo }

const MAX_CALLS = 300;
export const IDLE_MS = 2 * 60_000; // no call for 2 min -> the agent's chip dims to "idle"
export const FORGET_MS = 30 * 60_000; // matches the server's session TTL; chips older than this disappear
const PENDING_MAX_MS = 60_000; // a call-start whose `call` never arrives (server restart) must not spin forever

// Tools by effect: what the timeline icon and the "writes only" filter use. Anything unlisted counts as a read.
const WRITE = new Set([
  'write_html', 'update_styles', 'set_text_content', 'create_artboard', 'delete_nodes', 'duplicate_nodes', 'move_node',
  'rename_nodes', 'set_flags', 'insert_component', 'batch', 'set_tokens', 'use_font', 'create_foundations', 'fit_artboard',
  'create_project', 'reply_comment', 'resolve_comment', 'start', 'log_prompt', 'capture_url',
]);
const REVIEW = new Set(['get_screenshot', 'lint', 'check_layout', 'compare_to_reference', 'finish_working']);
// Action-enum tools (pages, components, tokens...) are reads only for their listing/inspecting actions.
const READ_ACTION = /^(list|get|show|info|read|find|preview|export|check)/;
export type CallKind = 'read' | 'write' | 'review';
export function kindOf(tool: string, args: Record<string, unknown> = {}): CallKind {
  if (REVIEW.has(tool)) return 'review';
  if (WRITE.has(tool)) return 'write';
  if (['pages', 'components', 'references', 'project', 'tokens', 'history', 'export_code'].includes(tool)) {
    return typeof args.action === 'string' && !READ_ACTION.test(args.action) ? 'write' : 'read';
  }
  return 'read';
}

interface AgentsState {
  calls: CallEntry[]; // newest first
  pending: PendingCall[];
  filterAgent: string | null; // agent id, null = all
  writesOnly: boolean;
  // The agent the camera follows; null = whoever writes.
  followAgent: string | null;
  seed: (calls: CallEntry[]) => void;
  addCall: (c: CallEntry) => void;
  addPending: (p: PendingCall) => void;
  setFilterAgent: (id: string | null) => void;
  setWritesOnly: (on: boolean) => void;
  setFollowAgent: (id: string | null) => void;
  reset: () => void;
}

const empty = { calls: [] as CallEntry[], pending: [] as PendingCall[] };

export const useAgents = create<AgentsState>((set) => ({
  ...empty,
  filterAgent: null,
  writesOnly: false,
  followAgent: null,
  seed: (incoming) => set((s) => {
    // The SSE stream may already have delivered some of these while the fetch was in flight.
    const have = new Set(s.calls.map((c) => c.id));
    const merged = [...s.calls, ...incoming.filter((c) => !have.has(c.id))].sort((a, b) => b.t - a.t);
    return { calls: merged.slice(0, MAX_CALLS) };
  }),
  addCall: (c) => set((s) => ({
    calls: s.calls.some((x) => x.id === c.id) ? s.calls : [c, ...s.calls].slice(0, MAX_CALLS),
    pending: s.pending.filter((p) => p.id !== c.id),
  })),
  addPending: (p) => set((s) => ({ pending: [p, ...s.pending.filter((x) => x.id !== p.id && Date.now() - x.t < PENDING_MAX_MS)] })),
  setFilterAgent: (filterAgent) => set({ filterAgent }),
  setWritesOnly: (writesOnly) => set({ writesOnly }),
  setFollowAgent: (followAgent) => set({ followAgent }),
  // Filters are view preferences and survive switching project; only the data is cleared.
  reset: () => set(empty),
}));

export interface Presence extends AgentInfo { lastT: number; tool: string; active: boolean; pending: boolean }

// One entry per agent seen on this project, newest first. `now` is passed in so callers can re-evaluate
// "idle" on a timer without the store changing.
export function presenceOf(calls: CallEntry[], pending: PendingCall[], now: number): Presence[] {
  const out = new Map<string, Presence>();
  for (const c of calls) { // newest first, so the first hit per agent is its latest call
    if (!c.agent || out.has(c.agent.id) || now - c.t > FORGET_MS) continue;
    out.set(c.agent.id, { ...c.agent, lastT: c.t, tool: c.tool, active: now - c.t < IDLE_MS, pending: false });
  }
  for (const p of pending) {
    if (!p.agent || now - p.t > PENDING_MAX_MS) continue;
    out.set(p.agent.id, { ...p.agent, lastT: p.t, tool: p.tool, active: true, pending: true });
  }
  return [...out.values()].sort((a, b) => b.lastT - a.lastT);
}

// Artboard / node ids mentioned in a call's argument summary (ids look like A3 or N42). The summary is already
// capped and never holds HTML, so a regex over its values is cheap and safe.
export function idsInArgs(args: Record<string, unknown>): string[] {
  const found: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (typeof v === 'string') { for (const m of v.matchAll(/\b[AN]\d+\b/g)) found.push(m[0]); }
    else if (v && typeof v === 'object' && depth < 2) for (const x of Object.values(v)) walk(x, depth + 1);
  };
  walk(args, 0);
  return [...new Set(found)];
}
