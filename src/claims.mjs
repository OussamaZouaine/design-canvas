// Soft board claims + user "pause agent", for several agents working on one project (agent-visibility plan, Phase 6).
// Purely server-side bookkeeping: nothing here adds a field to a tool result. The only text an agent ever sees is the
// one-line note produced on a real conflict and the polite error while it is paused.
//
// A claim is "this agent wrote to this board recently". It never blocks anything; it exists so the second writer
// gets a heads-up (and the user sees a coloured outline). Claims are per project and expire on their own.

export const CLAIM_TTL_MS = 60_000;

export class Claims {
  // `onChange(projectId | null)` fires when the set of live claims (projectId) or paused agents (null) changes, so the
  // server can push an SSE update. `now` is injectable so expiry is testable without waiting a minute.
  constructor({ ttl = CLAIM_TTL_MS, now = Date.now, onChange = () => {} } = {}) {
    this.ttl = ttl;
    this.now = now;
    this.onChange = onChange;
    this.byProject = new Map(); // projectId -> Map(boardId -> { agent, name, at, timer })
    this.paused = new Set(); // agent ids
  }

  // Record that `agent` ({id,name,color}) just wrote to `board` ({id,name}). Returns the OTHER agent that still holds a
  // live claim on it (a conflict), else null. The latest writer always takes the claim over, so a note is shown once
  // per hand-over and not on every following write of the new holder.
  touch(projectId, board, agent) {
    const boards = this.byProject.get(projectId) ?? this.byProject.set(projectId, new Map()).get(projectId);
    const prev = boards.get(board.id);
    const live = prev && this.now() - prev.at < this.ttl;
    const conflict = live && prev.agent.id !== agent.id ? prev.agent : null;
    if (prev) clearTimeout(prev.timer);
    // The timer only exists to push the "claim gone" update to the UI; expiry itself is checked against the clock.
    const timer = setTimeout(() => this._expire(projectId, board.id), this.ttl + 50);
    timer.unref?.();
    boards.set(board.id, { agent: { id: agent.id, name: agent.name, color: agent.color }, name: board.name, at: this.now(), timer });
    // Same holder refreshing its claim is not news for the UI (the `until` it already has is close enough).
    if (!prev || !live || conflict) this.onChange(projectId);
    return conflict;
  }

  _expire(projectId, boardId) {
    const boards = this.byProject.get(projectId);
    const c = boards?.get(boardId);
    if (!c || this.now() - c.at < this.ttl) return;
    boards.delete(boardId);
    this.onChange(projectId);
  }

  // Live claims of a project, as sent to the UI. `until` lets the client hide an outline even if an update is missed.
  list(projectId) {
    const out = [];
    for (const [board, c] of this.byProject.get(projectId) ?? []) {
      if (this.now() - c.at < this.ttl) out.push({ board, name: c.name, agent: c.agent, until: c.at + this.ttl });
    }
    return out;
  }

  // The user's pause switch. Keyed by agent id (stable per session, or per label), so it also survives a reconnect
  // under the same ?agent= label.
  setPaused(agentId, paused) {
    const was = this.paused.has(agentId);
    if (paused) this.paused.add(agentId); else this.paused.delete(agentId);
    if (was !== paused) this.onChange(null);
  }
  isPaused(agentId) { return this.paused.has(agentId); }
  pausedList() { return [...this.paused]; }
}

export const PAUSED_MESSAGE = 'The user paused you. Do not retry or work around it: tell them you are paused and wait until they resume you.';
