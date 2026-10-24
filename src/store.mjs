// Project store: every project is a folder on disk.
//   data/projects/<id>/meta.json       name, description, timestamps, trash flag
//   data/projects/<id>/doc.json        the artboards (managed by Doc)
//   data/projects/<id>/snapshots/*.json  version history
//   data/state.json                    which project Claude is currently working on
// Plain JSON files (not a database) so the data is easy to inspect, diff and back up.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Doc } from './doc.mjs';
import { imageInfo, EXT, MAX_IMAGE_BYTES } from './images.mjs';

// Ids arrive over HTTP and end up in file paths, so only accept our own format.
// This is what stops a request like /api/projects/..%2F..%2Fsecret from escaping data/.
export const ID_RE = /^p_[a-f0-9]{8}$/;

const MAX_SNAPSHOTS = 40;
const SNAPSHOT_IDLE_MS = 45_000; // auto-snapshot this long after the last edit
const SNAPSHOT_MIN_GAP_MS = 60_000; // ...but never more often than this

// Atomic JSON write (temp file + rename) so a crash can't corrupt metadata.
function writeJson(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export class ProjectStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.projectsDir = path.join(dataDir, 'projects');
    this.statePath = path.join(dataDir, 'state.json');
    fs.mkdirSync(this.projectsDir, { recursive: true });

    this.metas = new Map(); // id -> meta
    this.docs = new Map(); // id -> Doc (loaded lazily)
    this.snapTimers = new Map();
    this.lastSnap = new Map(); // id -> { at, json }
    this.lists = new Map(); // `${id}:${name}` -> array (activity, comments)
    this.listTimers = new Map();
    this.listeners = new Set();

    for (const name of fs.readdirSync(this.projectsDir)) {
      if (!ID_RE.test(name)) continue;
      const meta = readJson(path.join(this.projectsDir, name, 'meta.json'), null);
      if (meta && meta.id === name) this.metas.set(name, meta);
    }
    const state = readJson(this.statePath, {});
    this.activeId = this.metas.get(state.activeId) && !this.metas.get(state.activeId).deletedAt ? state.activeId : null;
  }

  // ---- events -------------------------------------------------------------
  // Events: 'projects' (list changed), 'meta' (one project's name etc.), 'doc' (artboards changed).
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(type, payload = {}) { for (const fn of this.listeners) fn(type, payload); }

  // ---- helpers ------------------------------------------------------------
  _dir(id) {
    if (!ID_RE.test(id)) throw new Error('Invalid project id');
    return path.join(this.projectsDir, id);
  }
  _meta(id) {
    const m = this.metas.get(id);
    if (!m) throw new Error(`Project ${id} not found`);
    return m;
  }
  _saveMeta(id) { writeJson(path.join(this._dir(id), 'meta.json'), this._meta(id)); }
  _saveState() { writeJson(this.statePath, { activeId: this.activeId }); }

  // Load a project's Doc on first use and wire its changes into metadata + events.
  _doc(id) {
    if (this.docs.has(id)) return this.docs.get(id);
    const doc = new Doc(path.join(this._dir(id), 'doc.json'));
    // Read live from meta so toggling the option takes effect without reloading the doc.
    doc.normalize = () => !!this.metas.get(id)?.normalize;
    doc.fonts = () => this.metas.get(id)?.fonts ?? [];
    doc.onChange((data) => {
      const meta = this.metas.get(id);
      if (!meta) return;
      meta.updatedAt = Date.now();
      clearTimeout(meta._t);
      Object.defineProperty(meta, '_t', { value: setTimeout(() => this._saveMeta(id), 300), writable: true, enumerable: false, configurable: true });
      this._emit('doc', { id, data });
      this._emit('projects');
      this._scheduleSnapshot(id);
    });
    this.docs.set(id, doc);
    return doc;
  }

  // Cover shown on the home page: an artboard called Home/Landing/Cover, else the first one.
  _cover(data) {
    const ab = data.artboards.find((a) => /^(home|landing|cover)$/i.test(a.name.trim())) || data.artboards[0];
    return ab ? { name: ab.name, width: ab.width, height: ab.height, html: ab.html } : null;
  }

  _uniqueName(name, ignoreId) {
    const taken = new Set([...this.metas.values()].filter((m) => !m.deletedAt && m.id !== ignoreId).map((m) => m.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) if (!taken.has(`${name} (${i})`.toLowerCase())) return `${name} (${i})`;
  }

  static cleanName(name) {
    const n = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!n) throw new Error('Project name is required');
    return n;
  }

  // ---- queries ------------------------------------------------------------
  get(id) {
    if (!id || !this.metas.has(id)) return null;
    return { meta: this.metas.get(id), doc: this._doc(id) };
  }

  findByName(name) {
    return [...this.metas.values()].find((m) => !m.deletedAt && m.name.toLowerCase() === String(name).toLowerCase());
  }

  // trashed=false -> live projects, true -> only trashed ones.
  list({ trashed = false } = {}) {
    return [...this.metas.values()]
      .filter((m) => Boolean(m.deletedAt) === trashed)
      .map((m) => {
        const data = this._doc(m.id).data;
        return { ...m, artboardCount: data.artboards.length, cover: this._cover(data), active: m.id === this.activeId };
      });
  }

  // ---- project lifecycle --------------------------------------------------
  // unique: 'error' (Claude: refuse duplicates so it reuses the project) or 'suffix' (UI: add " (2)").
  create({ name, description = '', unique = 'suffix' }) {
    let clean = ProjectStore.cleanName(name);
    const existing = this.findByName(clean);
    if (existing) {
      if (unique === 'error') throw new Error(`A project named "${existing.name}" already exists (project_id ${existing.id}). Use project (action open) to continue it.`);
      clean = this._uniqueName(clean);
    }
    const id = 'p_' + randomBytes(4).toString('hex');
    fs.mkdirSync(path.join(this.projectsDir, id, 'snapshots'), { recursive: true });
    const now = Date.now();
    this.metas.set(id, { id, name: clean, description: String(description).slice(0, 300), createdAt: now, updatedAt: now, deletedAt: null, normalize: true });
    this._saveMeta(id);
    writeJson(path.join(this._dir(id), 'doc.json'), { counter: 0, artboards: [] });
    this.setActive(id);
    this._emit('projects');
    return this._meta(id);
  }

  update(id, { name, description, normalize, repo }) {
    const meta = this._meta(id);
    if (name !== undefined) meta.name = this._uniqueName(ProjectStore.cleanName(name), id);
    if (description !== undefined) meta.description = String(description).slice(0, 300);
    if (normalize !== undefined) meta.normalize = !!normalize;
    if (repo !== undefined) {
      // The linked code folder: tokens are read from files inside it. null / '' unlinks.
      if (repo && !(fs.existsSync(repo) && fs.statSync(repo).isDirectory())) throw new Error(`Not a folder: ${repo}`);
      if (repo) meta.repo = path.resolve(repo); else delete meta.repo;
    }
    meta.updatedAt = Date.now();
    this._saveMeta(id);
    this._emit('meta', { id, meta });
    this._emit('projects');
    return meta;
  }

  // Record a Google Font on the project (meta.fonts). Re-adding a family replaces its entry, so asking for
  // more weights later just widens it. The browser gets the change through the normal `meta` event.
  addFont(id, font) {
    const meta = this._meta(id);
    meta.fonts = [...(meta.fonts ?? []).filter((f) => f.family !== font.family), font];
    meta.updatedAt = Date.now();
    this._saveMeta(id);
    this._emit('meta', { id, meta });
    return meta.fonts;
  }

  setActive(id) {
    this._meta(id);
    this.activeId = id;
    this._saveState();
    this._emit('projects');
  }

  // Soft delete: the folder stays on disk so the project can be restored from Trash.
  remove(id) {
    const meta = this._meta(id);
    meta.deletedAt = Date.now();
    this._saveMeta(id);
    if (this.activeId === id) {
      const next = [...this.metas.values()].filter((m) => !m.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      this.activeId = next ? next.id : null;
      this._saveState();
    }
    this._emit('projects');
  }

  restore(id) {
    const meta = this._meta(id);
    meta.deletedAt = null;
    meta.name = this._uniqueName(meta.name, id); // avoid clashing with a project created meanwhile
    this._saveMeta(id);
    this._emit('projects');
  }

  purge(id) {
    const meta = this._meta(id);
    if (!meta.deletedAt) throw new Error('Move the project to Trash before deleting it forever');
    this._doc(id).listeners.clear();
    clearTimeout(this.snapTimers.get(id));
    fs.rmSync(this._dir(id), { recursive: true, force: true });
    this.metas.delete(id);
    this.docs.delete(id);
    for (const key of [...this.lists.keys()]) if (key.startsWith(id + ':')) { this.lists.delete(key); clearTimeout(this.listTimers.get(key)); this.listTimers.delete(key); }
    this._emit('projects');
  }

  duplicate(id) {
    const src = this._meta(id);
    const copy = this.create({ name: `${src.name} copy`, description: src.description });
    this._doc(copy.id).replace(JSON.parse(JSON.stringify(this._doc(id).data)));
    copy.normalize = !!src.normalize; // a copy of an un-normalized design must not start rewriting its markup
    this._saveMeta(copy.id);
    return copy;
  }

  // ---- reference images ----------------------------------------------------
  // Pictures to rebuild from live in data/projects/<id>/refs/R<n>.<ext>; the doc keeps their metadata.

  addReference(id, { name, buffer, page }) {
    if (!buffer?.length) throw new Error('Empty image');
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Image too large (10 MB max)');
    const info = imageInfo(buffer); // trusts the bytes, not the file name or a claimed type
    if (!info) throw new Error('Not a PNG, JPEG, GIF or WebP image');
    if (!info.width || !info.height || info.width * info.height > 60_000_000) throw new Error('Image dimensions are not supported');
    const doc = this._doc(id);
    const ref = doc.addReference({ name, ...info });
    const dir = path.join(this._dir(id), 'refs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${ref.id}.${EXT[info.mime]}`), buffer);
    const board = doc.createReferenceBoard(ref, `/api/p/${id}/ref/${ref.id}`, page);
    return { ref, board };
  }

  // Absolute path of a reference file, or null. The id must match our own format, so it can never
  // be turned into a path outside refs/.
  refFile(id, refId) {
    if (!/^R\d+$/.test(refId)) return null;
    const ref = this._doc(id).references.find((r) => r.id === refId);
    if (!ref) return null;
    const file = path.join(this._dir(id), 'refs', `${refId}.${EXT[ref.mime]}`);
    return fs.existsSync(file) ? { file, mime: ref.mime } : null;
  }

  // ---- export / import ----------------------------------------------------
  export(id) {
    const meta = this._meta(id);
    return { format: 'design-canvas-project', version: 1, name: meta.name, description: meta.description, doc: this._doc(id).data };
  }

  import(json) {
    if (!json || json.format !== 'design-canvas-project' || !json.doc || !Array.isArray(json.doc.artboards)) {
      throw new Error('Not a Design Canvas project file');
    }
    const meta = this.create({ name: json.name || 'Imported project', description: json.description || '' });
    meta.normalize = false; // imported markup is kept as written; switch on via project (action update) if wanted
    this._saveMeta(meta.id);
    const doc = this._doc(meta.id);
    // Imported HTML is untrusted: keep only the fields we know, then re-sanitize.
    doc.data = {
      counter: Number(json.doc.counter) || 0,
      artboards: json.doc.artboards.slice(0, 500).map((a) => ({
        id: String(a.id), name: String(a.name ?? 'Artboard').slice(0, 80),
        x: Number(a.x) || 0, y: Number(a.y) || 0,
        width: Math.min(5000, Math.max(40, Number(a.width) || 1440)),
        height: Math.min(10000, Math.max(40, Number(a.height) || 900)),
        html: String(a.html ?? ''),
      })),
    };
    doc.sanitizeAll();
    doc._commit();
    return meta;
  }

  // ---- version history ----------------------------------------------------
  _snapDir(id) { return path.join(this._dir(id), 'snapshots'); }

  // Take a snapshot now. Skips if nothing changed since the last one (unless forced).
  snapshot(id, label = 'Saved version', { force = false } = {}) {
    const json = JSON.stringify(this._doc(id).data);
    const last = this.lastSnap.get(id);
    if (!force && last && last.json === json) return null;
    const at = Date.now();
    fs.mkdirSync(this._snapDir(id), { recursive: true });
    writeJson(path.join(this._snapDir(id), `${at}.json`), { label, createdAt: at, data: JSON.parse(json) });
    this.lastSnap.set(id, { at, json });
    // Keep the newest MAX_SNAPSHOTS, drop the oldest.
    const files = fs.readdirSync(this._snapDir(id)).filter((f) => f.endsWith('.json')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - MAX_SNAPSHOTS))) fs.rmSync(path.join(this._snapDir(id), f));
    return at;
  }

  // Debounced: wait for edits to go quiet, then snapshot, at most once a minute.
  _scheduleSnapshot(id) {
    clearTimeout(this.snapTimers.get(id));
    this.snapTimers.set(id, setTimeout(() => {
      const last = this.lastSnap.get(id);
      if (last && Date.now() - last.at < SNAPSHOT_MIN_GAP_MS) return this._scheduleSnapshot(id);
      this.snapshot(id, 'Auto-saved');
    }, SNAPSHOT_IDLE_MS));
  }

  listSnapshots(id) {
    this._meta(id);
    const dir = this._snapDir(id);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse().map((f) => {
      const s = readJson(path.join(dir, f), null);
      return s && { id: f.replace('.json', ''), label: s.label, createdAt: s.createdAt, artboards: s.data.artboards.length };
    }).filter(Boolean);
  }

  restoreSnapshot(id, snapId) {
    if (!/^\d+$/.test(snapId)) throw new Error('Invalid snapshot id');
    const s = readJson(path.join(this._snapDir(id), `${snapId}.json`), null);
    if (!s) throw new Error('Snapshot not found');
    // Keep the current state so a restore can itself be undone.
    this.snapshot(id, 'Before restore', { force: true });
    this._doc(id).replace(s.data);
  }

  // ---- small per-project lists (activity log, comments) ---------------------
  // Loaded lazily, cached in memory, written back debounced + atomically.
  _list(id, name) {
    const key = `${id}:${name}`;
    if (!this.lists.has(key)) this.lists.set(key, readJson(path.join(this._dir(id), `${name}.json`), []));
    return this.lists.get(key);
  }
  _saveListSoon(id, name) {
    const key = `${id}:${name}`;
    clearTimeout(this.listTimers.get(key));
    this.listTimers.set(key, setTimeout(() => this._saveListNow(id, name), 400));
  }
  _saveListNow(id, name) {
    const key = `${id}:${name}`;
    clearTimeout(this.listTimers.get(key));
    this.listTimers.delete(key);
    if (this.metas.has(id) && fs.existsSync(this._dir(id))) writeJson(path.join(this._dir(id), `${name}.json`), this.lists.get(key) ?? []);
  }

  // ---- activity: what the user asked and what Claude did ----------------------
  // Entries: { t, kind: 'prompt'|'action', text?, tool?, artboardId?, artboard?, detail?, snapshotId? }
  _pushActivity(id, entry) {
    const list = this._list(id, 'activity');
    list.push({ t: Date.now(), ...entry });
    if (list.length > 1000) list.splice(0, list.length - 1000);
    this._saveListSoon(id, 'activity');
    this._emit('activity', { id });
  }

  logAction(id, { tool, artboardId, artboard, detail }) {
    this._pushActivity(id, { kind: 'action', tool, artboardId, artboard, detail });
  }

  // A user request. Also takes a restore point so "undo this whole request" is one click.
  // `brief` (optional) is the design brief for a new design: kept on the project meta so later sessions
  // (and the create_artboard reminder) know the intent, and on the entry so Activity can show it.
  logPrompt(id, text, brief) {
    const clean = String(text).replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!clean) throw new Error('prompt is required');
    const cleanBrief = brief ? String(brief).trim().slice(0, 1500) : '';
    const snapshotId = this.snapshot(id, `Before: ${clean.slice(0, 60)}`) ?? this.lastSnap.get(id)?.at ?? null;
    this._pushActivity(id, { kind: 'prompt', text: clean, brief: cleanBrief || undefined, snapshotId: snapshotId ? String(snapshotId) : null });
    if (cleanBrief) {
      const meta = this._meta(id);
      meta.brief = cleanBrief;
      this._saveMeta(id);
    }
  }

  // Group the raw log into runs: each prompt starts a run; its actions are merged by tool.
  // Actions with no prompt before them (direct edits) form their own "Edits" runs.
  listActivity(id, limit = 40) {
    const raw = this._list(id, 'activity');
    const runs = [];
    let cur = null;
    for (const e of raw) {
      const gap = cur && e.t - cur.end > 10 * 60 * 1000;
      if (e.kind === 'prompt') {
        cur = { t: e.t, end: e.t, prompt: e.text, brief: e.brief, snapshotId: e.snapshotId, actions: [] };
        runs.push(cur);
      } else {
        if (!cur || (!cur.prompt && gap)) { cur = { t: e.t, end: e.t, prompt: null, snapshotId: null, actions: [] }; runs.push(cur); }
        cur.end = e.t;
        const last = cur.actions[cur.actions.length - 1];
        if (last && last.tool === e.tool) { last.count++; if (e.artboard && !last.artboards.includes(e.artboard)) last.artboards.push(e.artboard); }
        else cur.actions.push({ tool: e.tool, count: 1, artboards: e.artboard ? [e.artboard] : [], detail: e.detail || '' });
      }
    }
    const snapDir = this._snapDir(id);
    return runs.slice(-limit).reverse().map((r) => ({
      ...r,
      restorable: Boolean(r.snapshotId && fs.existsSync(path.join(snapDir, `${r.snapshotId}.json`))),
    }));
  }

  // ---- comments pinned to elements -----------------------------------------------
  // { id, targetId, artboardId, text, author: 'user'|'claude', createdAt, resolved, replies: [{author,text,createdAt}] }
  listComments(id) { return this._list(id, 'comments'); }

  addComment(id, { targetId, artboardId, text, author = 'user' }) {
    const body = String(text ?? '').trim().slice(0, 2000);
    if (!body) throw new Error('Comment text is required');
    const c = { id: 'c_' + randomBytes(4).toString('hex'), targetId: String(targetId), artboardId: String(artboardId || ''), text: body, author, createdAt: Date.now(), resolved: false, replies: [] };
    this._list(id, 'comments').push(c);
    this._commentsChanged(id);
    return c;
  }

  _comment(id, commentId) {
    const c = this._list(id, 'comments').find((x) => x.id === commentId);
    if (!c) throw new Error(`Comment ${commentId} not found`);
    return c;
  }

  replyComment(id, commentId, { text, author = 'user' }) {
    const body = String(text ?? '').trim().slice(0, 2000);
    if (!body) throw new Error('Reply text is required');
    this._comment(id, commentId).replies.push({ author, text: body, createdAt: Date.now() });
    this._commentsChanged(id);
  }

  setCommentResolved(id, commentId, resolved) {
    const c = this._comment(id, commentId);
    c.resolved = Boolean(resolved);
    this._commentsChanged(id);
  }

  deleteComment(id, commentId) {
    this._comment(id, commentId);
    const list = this._list(id, 'comments');
    list.splice(list.findIndex((x) => x.id === commentId), 1);
    this._commentsChanged(id);
  }

  _commentsChanged(id) {
    this._saveListSoon(id, 'comments');
    this._emit('comments', { id, comments: this._list(id, 'comments') });
  }

  // Write everything pending to disk (called on shutdown).
  flushAll() {
    for (const doc of this.docs.values()) doc.flush();
    for (const id of this.metas.keys()) { try { this._saveMeta(id); } catch { /* folder purged */ } }
    for (const key of [...this.listTimers.keys()]) { const [id, name] = key.split(':'); this._saveListNow(id, name); }
  }
}
