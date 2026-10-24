import { create } from 'zustand';
import type { AgentInfo } from '@/store/agents';
import type { Artboard, Comment, DocData, ProjectMeta } from '@/api/types';

export type Connection = 'connecting' | 'connected' | 'disconnected';

interface ProjectState {
  meta: ProjectMeta | null;
  doc: DocData | null;
  comments: Comment[];
  connection: Connection;
  // Ids Claude touched recently (the server's `agent` event); drives the "Claude is designing" pill.
  agentIds: string[];
  // Who wrote them (last `agent` event; kept after the highlight clears so the pill/ring colour does not flicker).
  agentInfo: AgentInfo | null;
  // Bumped on every server `activity` event so the Activity and Versions tabs know to refetch.
  activityTick: number;
  bumpActivity: () => void;

  setMeta: (m: ProjectMeta) => void;
  // Takes the raw delta from the server and refills unchanged boards from the previous doc.
  applyDocDelta: (incoming: DocData) => void;
  setComments: (c: Comment[]) => void;
  setConnection: (c: Connection) => void;
  setAgentIds: (ids: string[], agent?: AgentInfo) => void;
  reset: () => void;
}

const empty = { meta: null, doc: null, comments: [], connection: 'connecting' as Connection, agentIds: [], agentInfo: null as AgentInfo | null, activityTick: 0 };

export const useProject = create<ProjectState>((set, get) => ({
  ...empty,
  setMeta: (meta) => set({ meta }),
  applyDocDelta: (incoming) => {
    // Delta sync: the server sends `html: null` for boards unchanged since it last told THIS client,
    // so the previous copy is the only source. Missing previous copy falls back to '' (a reload fixes it).
    const prev = new Map(get().doc?.artboards.map((a) => [a.id, a.html]));
    const artboards = incoming.artboards.map((ab) => ({
      ...ab,
      html: (ab.html as string | null) ?? prev.get(ab.id) ?? '',
    })) as Artboard[];
    set({ doc: { ...incoming, artboards } });
  },
  setComments: (comments) => set({ comments }),
  setConnection: (connection) => set({ connection }),
  setAgentIds: (agentIds, agent) => set((s) => ({ agentIds, agentInfo: agent ?? s.agentInfo })),
  bumpActivity: () => set((s) => ({ activityTick: s.activityTick + 1 })),
  reset: () => set(empty),
}));
