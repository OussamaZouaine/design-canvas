// Call log: one entry per MCP tool call, derived server-side from calls the agent already makes
// (so it costs the model zero tokens). Powers the live agent feed and the per-call history.
//   entry: { id, t, ms, tool, project, ok, error?, tokens, args }
// Memory: a ring of the last RING entries per project. Disk: data/projects/<id>/calls.jsonl, appended
// in debounced batches and trimmed so it cannot grow without bound.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const RING = 500;
const FILE_MAX = 2000; // lines kept on disk; trimmed back to FILE_KEEP when exceeded
const FILE_KEEP = 1000;
const TEXT_CAP = 120;

// Tools that can take seconds (they wait for a browser round-trip), so the UI gets a `call-start` for them.
export const SLOW_TOOLS = new Set(['get_screenshot', 'capture_url', 'compare_to_reference', 'check_layout', 'fit_artboard', 'finish_working', 'get_computed_styles', 'export']);

// Keys whose values are markup, styles or binary payloads: only ever reported as a size.
const BULKY = /html|svg|css|data|image|markup|content/i;
// Keys that hold free text from the user/agent: kept, but capped.
const cap = (s) => (s.length > TEXT_CAP ? s.slice(0, TEXT_CAP - 1) + '…' : s);

// Short, safe description of a tool's arguments. Never returns full HTML, image data or long prompts:
// the call log is untrusted text shown in the UI and stored on disk.
export function summarizeArgs(args, depth = 0) {
  if (args == null || typeof args !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    if (v == null) continue;
    if (typeof v === 'string') {
      if (BULKY.test(k) && v.length > 40) out[k] = `${v.length >= 1000 ? Math.round(v.length / 1000) + 'k' : v.length} chars`;
      else out[k] = cap(v.replace(/\s+/g, ' '));
    } else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v)) {
      // batch ops: show which tools they run, not their payloads
      const names = k === 'ops' ? v.map((o) => o?.tool ?? o?.op).filter((n) => typeof n === 'string').slice(0, 8) : [];
      out[k] = names.length ? `${v.length} (${names.join(', ')})` : `${v.length} items`;
    } else if (depth < 1) out[k] = summarizeArgs(v, depth + 1);
    else out[k] = 'object';
  }
  return out;
}

export class CallLog {
  // `emit(type, payload)` is the store's event hook; `dataDir` holds projects/<id>/.
  constructor({ dataDir, emit }) {
    this.projectsDir = path.join(dataDir, 'projects');
    this.emit = emit;
    this.rings = new Map(); // project id -> entries, oldest first
    this.pending = new Map(); // project id -> entries not yet appended to disk
    this.timers = new Map();
    this.lines = new Map(); // project id -> approx lines on disk
    this.lastT = 0;
  }

  _file(id) { return path.join(this.projectsDir, id, 'calls.jsonl'); }

  // Ring for a project, seeded from disk the first time so history survives a restart.
  _ring(id) {
    let ring = this.rings.get(id);
    if (!ring) {
      ring = [];
      try {
        const lines = fs.readFileSync(this._file(id), 'utf8').split('\n').filter(Boolean);
        this.lines.set(id, lines.length);
        for (const l of lines.slice(-RING)) { try { ring.push(JSON.parse(l)); } catch { /* torn last line */ } }
      } catch { /* no file yet */ }
      this.rings.set(id, ring);
    }
    return ring;
  }

  // Timestamps are strictly increasing so `since=<t>` never skips or repeats an entry sharing a millisecond.
  _now() { this.lastT = Math.max(Date.now(), this.lastT + 1); return this.lastT; }

  // A slow call began: let tabs show "in progress". Returns the id to pass to `finish`.
  start(project, tool, args) {
    const id = randomBytes(6).toString('hex');
    if (project && SLOW_TOOLS.has(tool)) this.emit('call-start', { project, call: { id, t: this._now(), tool, args: summarizeArgs(args) } });
    return id;
  }

  // Record a finished call. `entry` carries tool/project/ok/ms/tokens/args(summary already) and optional error/id.
  finish(entry) {
    const e = { id: entry.id ?? randomBytes(6).toString('hex'), t: this._now(), ...entry };
    if (!e.project) return e; // no project to file it under (e.g. list_projects before any is open)
    const ring = this._ring(e.project);
    ring.push(e);
    if (ring.length > RING) ring.splice(0, ring.length - RING);
    this._queue(e);
    this.emit('call', { project: e.project, call: e });
    return e;
  }

  // Entries newer than `since` (ms timestamp), oldest first.
  list(project, since = 0) {
    return this._ring(project).filter((c) => c.t > since);
  }

  _queue(e) {
    const q = this.pending.get(e.project) ?? [];
    q.push(e);
    this.pending.set(e.project, q);
    if (!this.timers.has(e.project)) this.timers.set(e.project, setTimeout(() => this.flush(e.project), 500));
  }

  // Append pending entries; when the file gets long, rewrite it keeping only the newest ones.
  flush(project) {
    clearTimeout(this.timers.get(project));
    this.timers.delete(project);
    const q = this.pending.get(project);
    this.pending.delete(project);
    if (!q?.length || !fs.existsSync(path.dirname(this._file(project)))) return;
    try {
      fs.appendFileSync(this._file(project), q.map((e) => JSON.stringify(e)).join('\n') + '\n');
      const n = (this.lines.get(project) ?? 0) + q.length;
      this.lines.set(project, n);
      if (n > FILE_MAX) {
        const keep = fs.readFileSync(this._file(project), 'utf8').split('\n').filter(Boolean).slice(-FILE_KEEP);
        fs.writeFileSync(this._file(project), keep.join('\n') + '\n');
        this.lines.set(project, keep.length);
      }
    } catch { /* logging must never break a tool call */ }
  }

  flushAll() { for (const id of [...this.pending.keys()]) this.flush(id); }
}
