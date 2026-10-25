// MCP sessions: one per connected client (Claude Code window, Desktop, a script). The transport is stateful so the
// server can tell clients apart, which the stateless version could not. A session carries:
//   - the agent identity (clientInfo from `initialize` + an optional label), used to attribute every call and change
//   - the project the agent is working in (bound by start / project open), so two agents never fight over the
//     global `store.activeId`
// Everything here is derived server-side; none of it adds a field to a tool result (zero extra tokens).

export const SESSION_TTL_MS = 30 * 60 * 1000;

// Lower-case slug that is safe to show and to use as a map key; untrusted text from the client.
const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);

// Stable colour per agent id: hash -> hue. Fixed lightness/chroma keeps every agent readable on light and dark UI
// (the project rule: colours are OKLCH everywhere).
export function agentColor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `oklch(0.68 0.15 ${h % 360})`;
}

export class Session {
  constructor(id, label = null) {
    this.id = id;
    this.label = label ? slug(label) || null : null; // from /mcp?agent=<name> or start({agent})
    this.client = null; // { name, version } once `initialize` arrived
    this.projectId = null; // bound by start / project open
    this.seen = new Map(); // projectId -> journal version this agent last read (other agents' changes, get_changes/start)
    this.lastSeen = Date.now();
    this.delivered = new Map(); // commentId -> time it was shown to this agent as HUMAN FEEDBACK (feedback.mjs)
    this.status = null; // one-line present-tense status the agent published; shown in the Agents tab
  }

  setClient(info) { if (info) this.client = { name: String(info.name ?? '').slice(0, 60), version: String(info.version ?? '').slice(0, 30) }; }
  setLabel(label) { const l = slug(label); if (l) this.label = l; }

  // Identity. Two windows of the same client share clientInfo, so without a label the id gets a short session suffix
  // to keep them distinct. A label is chosen by the caller and stays stable across sessions (so does its colour).
  get agent() {
    const base = slug(this.client?.name) || 'agent';
    const id = this.label ?? `${base}-${String(this.id).replace(/-/g, '').slice(0, 4)}`;
    return { id, name: this.label ?? (this.client?.name || 'agent'), version: this.client?.version ?? '', color: agentColor(id), status: this.status };
  }
}

// Used for requests that arrive without a session (old stateless clients): no binding, falls back to the active project.
export const anonymousSession = () => new Session('anon');

// Map of live sessions with an idle TTL. `now` is injectable so the TTL is testable without waiting.
export class SessionMap {
  constructor({ ttl = SESSION_TTL_MS, now = Date.now } = {}) {
    this.ttl = ttl;
    this.now = now;
    this.map = new Map(); // id -> { session, transport, server }
    this.revived = new Map(); // id -> Session for ids this process never issued (see revive)
  }

  add(session, transport, server) { session.lastSeen = this.now(); this.map.set(session.id, { session, transport, server }); }

  // Unknown or expired -> undefined. The HTTP layer then serves the request statelessly via revive() (answering 404
  // does not help: the SDK client surfaces it as an error and never re-initializes on its own).
  get(id) {
    const e = this.map.get(id);
    if (!e) return undefined;
    if (this.now() - e.session.lastSeen > this.ttl) { this.remove(id); return undefined; }
    e.session.lastSeen = this.now();
    return e;
  }

  // A client still holds an id from before a server restart or an idle expiry. Rebuild a lightweight Session under the
  // SAME id so its identity suffix and colour stay stable and a project it binds sticks for the rest of this process.
  // The label (?agent=) is re-applied each time; clientInfo is lost with the old initialize, so the name falls back to 'agent'.
  revive(id, label = null) {
    let session = this.revived.get(id);
    if (!session) { session = new Session(id, label); this.revived.set(id, session); }
    else if (label) session.setLabel(label);
    session.lastSeen = this.now();
    return session;
  }

  remove(id) {
    this.revived.delete(id);
    const e = this.map.get(id);
    if (!e) return;
    this.map.delete(id);
    try { e.transport.close(); e.server.close(); } catch { /* already closed */ }
  }

  // Drop idle sessions. Called on a timer so abandoned clients do not accumulate servers forever.
  sweep() {
    for (const [id, e] of [...this.map]) if (this.now() - e.session.lastSeen > this.ttl) this.remove(id);
    for (const [id, x] of [...this.revived]) if (this.now() - x.lastSeen > this.ttl) this.revived.delete(id);
  }

  get size() { return this.map.size; }
}
