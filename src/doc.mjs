// Document model: the single source of truth for artboards and their HTML.
// Both the web UI (via HTTP) and Claude (via MCP) mutate the design through
// this class, so the two can never drift apart.
import { parse, HTMLElement } from 'node-html-parser';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { diffStates, patchable, reversePatch } from './stepdiff.mjs';
import { lintArtboard } from './lint.mjs';
import { parseStyle, styleToString } from './css.mjs';
import { normalizeTree } from './normalize.mjs';
import { applyTokens, emptyTheme, resolveTokens, STARTER } from './theme.mjs';
import { foundationsHtml } from './foundations.mjs';
import { checkName, checkMaster, expand, readSlots, defaultVariant, componentsSheetHtml } from './components.mjs';

// Tags that could run code or pull in outside pages. The HTML comes from an AI
// and is rendered in the user's own browser, so we strip these on every write.
const MAX_BOARD_HEIGHT = 20000; // a runaway `fit` board must not grow without bound
const FORBIDDEN_TAGS =['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form'];

const kebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

export class Doc {
  constructor(file) {
    this.file = file;
    this.data = { counter: 0, artboards: [] };
    this.listeners = new Set();
    // Set by the store: returns true when this project normalizes HTML on write (see normalize.mjs).
    this.normalize = () => false;
    // Set by the store: the project's Google Fonts (meta.fonts), so lint knows which families are loaded.
    this.fonts = () => [];
    // In-memory only (not saved): the last states Claude/the user can step back to.
    this.undoStack = [];
    this.redoStack = [];
    // Who changed what, newest last. `version` grows by one per entry, so a reader can ask
    // "what changed since version N" instead of re-reading whole artboards.
    this.journal = [];
    this.version = 0;
    // Step numbering for Activity: `seq` grows per checkpoint, `boot` tells a step of this process from one
    // saved by an earlier run (the undo stack is memory only, so old seq numbers would otherwise collide).
    this.stepSeq = 0;
    this._capturedSeq = 0;
    this.boot = randomBytes(4).toString('hex');
    if (file && fs.existsSync(file)) {
      try {
        this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        // A corrupt save file shouldn't brick the app; start empty and keep the bad file.
        fs.copyFileSync(file, file + '.corrupt');
      }
    }
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // Persist + notify. Writes are debounced so a burst of tool calls is one disk write.
  _commit() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.flush(), 200);
    for (const fn of this.listeners) fn(this.data);
  }

  // Write now. Goes to a temp file then renames over the target, so a crash
  // mid-write can never leave a half-written (corrupt) design file behind.
  flush() {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    if (!this.file) return;
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  // Swap in a whole document (snapshot restore / import) and notify listeners.
  replace(data) {
    this.data = data;
    this.undoStack = []; // history belongs to the old document
    this.redoStack = [];
    this._commit();
  }

  // Re-run sanitizing over every artboard and make sure the id counter is ahead
  // of every id already present. Used for imported files, which we don't trust.
  sanitizeAll() {
    let max = this.data.counter || 0;
    for (const ab of this.data.artboards) {
      const n = Number(String(ab.id).replace(/\D/g, ''));
      if (n > max) max = n;
      for (const m of String(ab.html).matchAll(/data-pid="N(\d+)"/g)) max = Math.max(max, Number(m[1]));
    }
    this.data.counter = max;
    for (const ab of this.data.artboards) ab.html = this._prepare(String(ab.html), false).toString();
  }

  // ---- Undo + change journal ----------------------------------------------

  // Remember the current artboards before a mutation. Artboard objects are shallow-copied
  // because mutations replace `html` strings (immutable) rather than editing them in place,
  // so a copy is cheap even for a multi-megabyte design.
  _snapshotState(label) {
    return { label, artboards: this.data.artboards.map((a) => ({ ...a })), theme: structuredClone(this.data.theme), components: structuredClone(this.data.components), pages: structuredClone(this.data.pages), references: structuredClone(this.data.references) };
  }

  _checkpoint(label) {
    // `seq` names this step so an Activity row can find its own checkpoint again (see captureStep / revertStep).
    this.undoStack.push({ ...this._snapshotState(label), seq: ++this.stepSeq });
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = []; // a fresh change forks history: what was undone can no longer be redone
  }

  _restore(entry) {
    this.data.artboards = entry.artboards;
    this.data.theme = entry.theme;
    this.data.components = entry.components;
    this.data.pages = entry.pages;
    this.data.references = entry.references;
  }

  // Step back `steps` mutations. The id counter is deliberately NOT rewound, so an id that was
  // handed out once is never reused for a different node.
  // `actor` says who asked, for get_changes: Claude through MCP, the user through Ctrl+Z in the browser.
  undo(steps = 1, actor = 'claude') {
    const reverted = [];
    for (let i = 0; i < steps && this.undoStack.length; i++) {
      const entry = this.undoStack.pop();
      this.redoStack.push(this._snapshotState(entry.label)); // the state we are leaving, so redo can return to it
      this._restore(entry);
      reverted.push(entry.label);
    }
    if (reverted.length) {
      this.record(actor, 'undo', []);
      this._commit();
    }
    return reverted;
  }

  redo(steps = 1, actor = 'user') {
    const redone = [];
    for (let i = 0; i < steps && this.redoStack.length; i++) {
      const entry = this.redoStack.pop();
      this.undoStack.push(this._snapshotState(entry.label));
      this._restore(entry);
      redone.push(entry.label);
    }
    if (redone.length) {
      this.record(actor, 'redo', []);
      this._commit();
    }
    return redone;
  }

  // Called right after a logged write: the newest checkpoint is that write's "before" state. Returns
  // { step, boot, diff } once per checkpoint (null when the write took none or changed nothing), so the
  // Activity entry can show what changed and be reverted later. Costs nothing when nobody reads it.
  captureStep() {
    const prev = this.undoStack.at(-1);
    if (!prev?.seq || prev.seq <= this._capturedSeq) return null;
    this._capturedSeq = prev.seq;
    const diff = diffStates(prev, this.data);
    return diff && { step: prev.seq, boot: this.boot, diff };
  }

  // Undo one specific step of a run without losing the steps around it.
  //  - the newest step: a plain undo (also covers theme/component changes and deleted boards);
  //  - an older step: reverse just its patch in the current markup. All boards are checked first, so a
  //    conflict (a later step edited the same span) leaves the document untouched.
  revertStep({ step, boot, diff }, actor = 'user') {
    if (boot === this.boot && this.undoStack.at(-1)?.seq === step) { this.undo(1, actor); return 'undo'; }
    if (!patchable(diff)) throw new Error('This step can only be reverted while it is the latest change');
    const plans = [];
    for (const b of diff.boards) {
      const ab = this.getArtboard(b.id);
      if (b.kind === 'added') { if (ab) plans.push({ ab, remove: true }); continue; }
      if (!ab) throw new Error(`Board ${b.name || b.id} no longer exists`);
      const html = reversePatch(ab.html, b);
      if (html === null) throw new Error(`Later edits changed the same part of ${b.name || b.id}. Revert those first.`);
      plans.push({ ab, html });
    }
    if (!plans.length) throw new Error('Nothing left to revert');
    this._checkpoint('revert_step');
    for (const { ab, html, remove } of plans) {
      if (remove) this.data.artboards = this.data.artboards.filter((a) => a.id !== ab.id);
      else ab.html = html;
    }
    this.record(actor, 'revert_step', plans.map((x) => x.ab.id));
    this._commit();
    return 'patch';
  }

  // Note a change for get_changes. `actor` is 'user' (browser) or 'claude' (MCP).
  record(actor, tool, ids = []) {
    // Dragging fires many moves for the same board; fold a repeat within 3 s into one entry.
    const last = this.journal.at(-1);
    if (last && last.actor === actor && last.tool === tool && Date.now() - last.at < 3000 && last.ids.join() === ids.join() && ['move', 'resize'].includes(tool)) {
      last.at = Date.now();
      last.version = ++this.version;
      return;
    }
    this.journal.push({ version: ++this.version, actor, tool, ids, at: Date.now() });
    if (this.journal.length > 500) this.journal.shift();
  }

  changesSince(version, actor) {
    return this.journal.filter((e) => e.version > version && (!actor || e.actor === actor));
  }

  // A locked node (data-locked) or anything inside one can't be edited until it is unlocked.
  _assertUnlocked(el, id) {
    for (let n = el; n instanceof HTMLElement; n = n.parentNode) {
      if (n.hasAttribute?.('data-locked')) throw new Error(`Node ${id} is locked (data-locked). Remove the lock first.`);
    }
  }

  _newId(prefix) {
    return `${prefix}${++this.data.counter}`;
  }

  // ---- HTML helpers -------------------------------------------------------

  // Sanitize and stamp every element with a stable data-pid so tools can
  // target individual nodes later (like Paper's node ids).
  // `normalize` defaults to the project's setting; imports pass false so a file's own markup is kept.
  _prepare(html, normalize = this.normalize()) {
    const root = parse(html, { comment: false });
    // <x-clone node-id="N5"> is replaced by a copy of that node, so Claude can repeat a card
    // without resending its markup. The copy loses its ids and gets fresh ones below.
    for (const clone of root.querySelectorAll('x-clone')) {
      const src = this._find(clone.getAttribute('node-id'));
      if (!src) throw new Error(`x-clone: node ${clone.getAttribute('node-id')} not found`);
      clone.replaceWith(...parse(src.el.toString().replace(/ data-pid="[^"]*"/g, '')).childNodes);
    }
    // <x-component name="button" variant="primary" slot-label="Save"> becomes a copy of that master
    // variant with the slot text filled in. Instances are stored expanded (see components.mjs).
    for (const x of root.querySelectorAll('x-component')) {
      const name = x.getAttribute('name');
      const comp = this.components[name];
      if (!comp) throw new Error(`x-component: no component named "${name}". Create it with components (action set).`);
      const variant = x.getAttribute('variant') || defaultVariant(comp);
      if (!comp.variants[variant]) throw new Error(`x-component: ${name} has no variant "${variant}" (has: ${Object.keys(comp.variants).join(', ')})`);
      const slots = {};
      for (const [k, v] of Object.entries(x.attributes)) if (k.startsWith('slot-')) slots[k.slice(5)] = v;
      x.replaceWith(...parse(expand(comp.variants[variant], name, variant, { slots })).childNodes);
    }
    for (const tag of FORBIDDEN_TAGS) root.querySelectorAll(tag).forEach((n) => n.remove());
    // Normalize BEFORE the id walk below: it replaces and unwraps nodes, and whatever it creates must get an id too.
    if (normalize) normalizeTree(root);
    const walk = (el) => {
      for (const child of el.childNodes) {
        if (!(child instanceof HTMLElement)) continue;
        for (const [name, value] of Object.entries(child.attributes)) {
          const bad =
            name.toLowerCase().startsWith('on') ||
            (['href', 'src', 'xlink:href'].includes(name.toLowerCase()) &&
              /^\s*javascript:/i.test(value));
          if (bad) child.removeAttribute(name);
        }
        if (!child.getAttribute('data-pid')) child.setAttribute('data-pid', this._newId('N'));
        walk(child);
      }
    };
    walk(root);
    return root;
  }

  _artboardRoot(ab) {
    return parse(ab.html, { comment: false });
  }

  // Find a node by id anywhere; returns the artboard, its parsed root and the element.
  _find(id) {
    for (const ab of this.data.artboards) {
      const root = this._artboardRoot(ab);
      const el = root.querySelector(`[data-pid="${id}"]`);
      if (el) return { ab, root, el };
    }
    return null;
  }

  _save(ab, root) {
    ab.html = root.toString();
  }

  // The artboard that contains an id (an artboard id returns itself).
  artboardOf(id) {
    return this.getArtboard(id) ?? this._find(id)?.ab ?? null;
  }

  // The id of a node's parent: another node's id, or the artboard id when the node is a top-level child.
  parentOf(id) {
    const hit = this._find(id);
    if (!hit) return null;
    return hit.el.parentNode?.getAttribute?.('data-pid') ?? hit.ab.id;
  }

  // ---- Queries ------------------------------------------------------------

  getArtboard(id) {
    return this.data.artboards.find((a) => a.id === id);
  }

  basicInfo() {
    return {
      pages: this.pages,
      references: this.references,
      artboards: this.data.artboards.map((a) => ({
        id: a.id, name: a.name, x: a.x, y: a.y, width: a.width, height: a.height, ...(a.heightMode ? { heightMode: a.heightMode } : {}), page: this.pageOf(a),
      })),
    };
  }

  // Compact one-line-per-node outline, much cheaper to read than HTML. Shape:
  //   N5 frame "Sidebar" col w:240 bg:oklch(...) gap:16 [6]      ([n] = children not shown)
  // `id` may be an artboard or a node; with a `query` it lists every node whose name or text matches.
  outline(id, { depth = 2, query } = {}) {
    const ids = id ? [id] : this.data.artboards.map((a) => a.id);
    const q = query?.toLowerCase();
    const lines = [];
    const kids = (el) => el.childNodes.filter((c) => c instanceof HTMLElement);
    const kindOf = (el) => {
      const t = el.rawTagName.toLowerCase();
      if (t === 'svg') return 'svg';
      if (t === 'img') return 'image';
      // Only text/inline children: Paper flattens these into one text layer, so we call it text.
      const inline = new Set(['span', 'b', 'strong', 'i', 'em', 'a', 'br', 'small', 'sub', 'sup', 'code']);
      return kids(el).every((c) => inline.has(c.rawTagName.toLowerCase())) && el.text.trim() ? 'text' : 'frame';
    };
    const line = (el, d, extra = '') => {
      const st = parseStyle(el.getAttribute('style'));
      const bits = [];
      if (/flex/.test(st.get('display') || '')) bits.push(st.get('flex-direction')?.startsWith('column') ? 'col' : 'row');
      else if (st.get('display') === 'grid') bits.push('grid');
      if (st.get('position') === 'absolute') bits.push('abs');
      for (const [k, short] of [['width', 'w'], ['height', 'h'], ['background', 'bg'], ['background-color', 'bg'], ['color', 'fg'], ['gap', 'gap'], ['padding', 'p']]) {
        if (st.has(k) && !bits.some((b) => b.startsWith(short + ':'))) bits.push(`${short}:${st.get(k).slice(0, 28)}`);
      }
      if (el.hasAttribute('data-locked')) bits.push('locked');
      if (el.hasAttribute('hidden')) bits.push('hidden');
      const name = el.getAttribute('data-name');
      const txt = kindOf(el) === 'text' ? ` "${el.text.trim().replace(/\s+/g, ' ').slice(0, 40)}"` : '';
      const hidden = d >= depth && kids(el).length ? ` [${kids(el).length}]` : '';
      const comp = el.getAttribute('data-component');
      if (comp) {
        // An instance reads as one tag: name/variant plus its slot text, children not listed.
        const slotText = el.querySelectorAll('[data-slot]').map((s) => s.text.trim().replace(/\s+/g, ' ').slice(0, 30)).filter(Boolean);
        return `${'  '.repeat(d)}${el.getAttribute('data-pid')} ${comp}/${el.getAttribute('data-variant')}${slotText.length ? ` ${slotText.map((t) => `"${t}"`).join(' ')}` : ''}${el.hasAttribute('data-locked') ? ' locked' : ''}`;
      }
      return `${'  '.repeat(d)}${el.getAttribute('data-pid')} ${kindOf(el)}${name ? ` "${name}"` : ''}${txt}${bits.length ? ' ' + bits.join(' ') : ''}${hidden}${extra}`;
    };
    const walk = (el, d) => {
      for (const c of kids(el)) {
        if (q) {
          const hay = `${c.getAttribute('data-name') || ''} ${c.text}`.toLowerCase();
          if (hay.includes(q) && kids(c).every((k) => !`${k.getAttribute('data-name') || ''} ${k.text}`.toLowerCase().includes(q))) lines.push(line(c, 0));
          walk(c, d + 1); // keep searching: matches can be anywhere in the tree
        } else {
          lines.push(line(c, d));
          if (d < depth && !c.getAttribute('data-component')) walk(c, d + 1);
        }
      }
    };
    for (const one of ids) {
      const ab = this.getArtboard(one);
      if (ab) {
        lines.push(`${ab.id} artboard "${ab.name}" ${ab.width}×${ab.height}`);
        walk(this._artboardRoot(ab), q ? 0 : 1);
        continue;
      }
      const hit = this._find(one);
      if (!hit) throw new Error(`Node ${one} not found`);
      if (!q) lines.push(line(hit.el, 0));
      walk(hit.el, q ? 0 : 1);
    }
    return lines.join('\n');
  }

  // Static lint of an artboard or of one node's subtree. Returns an array of one-line issues.
  // opts: { grid, mode }. `mode` lints against that mode's token values (default: the base tokens).
  lint(id, { mode, ...opts } = {}) {
    opts = { ...opts, tokens: resolveTokens(this.data.theme, mode), fonts: this.fonts() };
    const ab = this.getArtboard(id);
    if (ab) return lintArtboard(ab, this._artboardRoot(ab), opts);
    const hit = this._find(id);
    if (!hit) throw new Error(`Node ${id} not found`);
    // lintArtboard walks a container's children, so hand it a stand-in container holding just
    // this node. (Inherited colour/background above the node are not known here.)
    return lintArtboard(hit.ab, { childNodes: [hit.el] }, opts);
  }

  nodeInfo(id) {
    const hit = this._find(id);
    if (!hit) throw new Error(`Node ${id} not found`);
    const { ab, el } = hit;
    return {
      id,
      artboard: ab.id,
      tag: el.rawTagName,
      name: el.getAttribute('data-name') || null,
      style: el.getAttribute('style') || '',
      text: el.text.trim().slice(0, 200),
      childIds: el.childNodes.filter((c) => c instanceof HTMLElement).map((c) => c.getAttribute('data-pid')),
      html: el.toString(),
    };
  }

  // ---- Theme (design tokens) ------------------------------------------------

  get theme() { return this.data.theme ?? emptyTheme(); }

  // Merge token values (null removes one). `mode` writes overrides for that mode instead of the base.
  // `preset: 'starter'` first loads the built-in scale (only into a theme that has no tokens yet).
  setTokens(partial = {}, { mode, preset } = {}) {
    // Build on a copy and validate everything before touching the document: all or nothing.
    const next = structuredClone(this.data.theme ?? emptyTheme());
    if (preset === 'starter' && !Object.keys(next.tokens).length) {
      applyTokens(next, STARTER.tokens);
      for (const [m, t] of Object.entries(STARTER.modes)) applyTokens(next, t, m);
    }
    applyTokens(next, partial, mode);
    this._checkpoint('set_tokens');
    this.data.theme = next;
    this._refreshFoundations();
    this._commit();
    return Object.keys(partial);
  }

  // The Foundations artboard is generated from the tokens (swatches, type, spacing...). It is
  // marked `generated` so token edits can refresh it, and its root is data-locked so nobody
  // hand-edits something that the next token change would overwrite.
  _refreshFoundations() {
    for (const ab of this.data.artboards) {
      if (!ab.generated || ab.generated === 'reference') continue;
      const { html, height } = ab.generated === 'components' ? componentsSheetHtml(this.components, this.theme) : foundationsHtml(this.theme);
      ab.html = this._prepare(html, false).toString();
      ab.height = height;
    }
  }

  createFoundations() {
    if (!Object.keys(this.theme.tokens).length) throw new Error('No tokens yet. Call set_tokens first (preset "starter" loads a ready scale).');
    let ab = this.data.artboards.find((a) => a.generated === 'foundations');
    if (!ab) {
      ab = this.createArtboard({ name: 'Foundations', width: 1200, height: 900 }); // checkpoints itself
      ab.generated = 'foundations';
    } else {
      this._checkpoint('create_foundations');
    }
    this._refreshFoundations();
    this._commit();
    return ab;
  }

  // ---- Reference images ------------------------------------------------------------
  // Screenshots to rebuild from. The bytes live in the project's refs/ folder (the store writes
  // them); the document only keeps the metadata and a board that shows the picture.

  get references() { return this.data.references ?? []; }

  addReference({ name, mime, width, height }) {
    this._checkpoint('add_reference');
    const n = this.references.reduce((m, r) => Math.max(m, Number(r.id.slice(1)) || 0), 0) + 1;
    const ref = { id: `R${n}`, name: String(name || 'Reference').trim().slice(0, 80) || 'Reference', mime, width, height };
    this.data.references = [...this.references, ref];
    this._commit();
    return ref;
  }

  // A board that displays the reference at (up to) its own size, placed like any new board.
  createReferenceBoard(ref, src, page) {
    const width = Math.min(1600, ref.width);
    const height = Math.max(40, Math.round((ref.height * width) / ref.width));
    const ab = this.createArtboard({ name: `Reference · ${ref.name}`, width, height, page });
    ab.generated = 'reference';
    ab.ref = ref.id;
    const alt = ref.name.replace(/[&<>"]/g, '');
    ab.html = this._prepare(`<img data-name="Reference" data-locked src="${src}" alt="Reference: ${alt}" style="display:block;width:100%;height:100%;object-fit:contain">`, false).toString();
    this._commit();
    return ab;
  }

  // Remove a reference and its boards. The file stays on disk so undo can bring it back.
  deleteReference(refId) {
    if (!this.references.some((r) => r.id === refId)) throw new Error(`No reference ${refId}`);
    this._checkpoint('delete_reference');
    this.data.references = this.references.filter((r) => r.id !== refId);
    this.data.artboards = this.data.artboards.filter((a) => a.ref !== refId);
    this._commit();
  }

  // ---- Pages -------------------------------------------------------------------
  // A project always has at least one page. Boards without a `page` field belong to the first one,
  // so projects made before pages existed need no migration and the first page needs no stored list.

  get pages() { return this.data.pages?.length ? this.data.pages : [{ id: 'P1', name: 'Page 1' }]; }

  // A board without a `page` field is on the first page.
  pageOf(ab) { return ab.page ?? this.pages[0].id; }

  _pageId(id) {
    if (id === undefined || id === null) return this.pages[0].id;
    if (!this.pages.some((p) => p.id === id)) throw new Error(`Page ${id} not found (pages: ${this.pages.map((p) => `${p.id} "${p.name}"`).join(', ')})`);
    return id;
  }

  // Store the implicit first page. Boards that had no `page` field are stamped with it here, so from
  // now on every board names its page explicitly and deleting or reordering pages cannot move them.
  _ensurePages() {
    if (!this.data.pages?.length) {
      this.data.pages = [{ id: 'P1', name: 'Page 1' }];
      for (const ab of this.data.artboards) ab.page ??= 'P1';
    }
    return this.data.pages;
  }

  createPage(name = 'Page') {
    const clean = String(name).trim().slice(0, 60) || 'Page';
    this._checkpoint('create_page');
    const pages = this._ensurePages();
    const n = pages.reduce((m, p) => Math.max(m, Number(p.id.slice(1)) || 0), 0) + 1;
    const page = { id: `P${n}`, name: clean };
    pages.push(page);
    this._commit();
    return page;
  }

  updatePage(id, { name, background } = {}) {
    this._pageId(id);
    if (background && !/^[a-z0-9#(),.%/ -]{1,60}$/i.test(background)) throw new Error('Invalid background colour');
    this._checkpoint('update_page');
    const page = this._ensurePages().find((p) => p.id === id);
    if (name !== undefined) page.name = String(name).trim().slice(0, 60) || page.name;
    if (background !== undefined) { if (background) page.background = background; else delete page.background; }
    this._commit();
    return page;
  }

  // Delete a page. Its boards must go somewhere: `moveTo` (default: the first remaining page).
  deletePage(id, moveTo) {
    this._pageId(id);
    const pages = this._ensurePages();
    if (pages.length === 1) throw new Error('A project needs at least one page');
    const rest = pages.filter((p) => p.id !== id);
    const dest = moveTo ? this._pageId(moveTo) : rest[0].id;
    if (dest === id) throw new Error('Choose a different page to move the boards to');
    this._checkpoint('delete_page');
    for (const ab of this.data.artboards) if (ab.page === id) ab.page = dest;
    this.data.pages = rest;
    this._commit();
    return dest;
  }

  moveToPage(ids, pageId) {
    const page = this._pageId(pageId);
    const boards = ids.map((id) => {
      const ab = this.getArtboard(id);
      if (!ab) throw new Error(`Artboard ${id} not found`);
      return ab;
    });
    this._checkpoint('move_to_page');
    this._ensurePages();
    for (const ab of boards) ab.page = page;
    this._commit();
  }

  // ---- Components ------------------------------------------------------------

  get components() { return this.data.components ?? {}; }

  // Create a component or replace ALL of its variants, then re-expand every instance so they
  // follow the master. `variants` maps variant name -> HTML (one root element, data-slot marks text).
  setComponent(name, variants) {
    checkName(name);
    if (!variants || !Object.keys(variants).length) throw new Error('Give at least one variant');
    const clean = {};
    for (const [vname, html] of Object.entries(variants)) {
      checkName(vname, 'Variant');
      // Same sanitizing as any write, then drop the ids: a master has none, instances mint their own.
      clean[vname] = this._prepare(String(html), false).toString().replace(/ data-pid="[^"]*"/g, '');
      checkMaster(clean[vname], name, vname);
    }
    this._checkpoint('set_component');
    const existed = name in this.components;
    this.data.components = { ...this.components, [name]: { variants: clean } };
    const updated = this._reexpand(name);
    this._refreshFoundations();
    this._commit();
    return { created: !existed, instancesUpdated: updated };
  }

  // Re-expand every instance of a component in place. The instance's root id and its slot text are
  // kept; everything else comes from the master. A variant that no longer exists falls back to the default.
  _reexpand(name) {
    const comp = this.components[name];
    let count = 0;
    for (const ab of this.data.artboards) {
      if (ab.generated || !ab.html.includes(`data-component="${name}"`)) continue;
      const root = this._artboardRoot(ab);
      for (const el of root.querySelectorAll(`[data-component="${name}"]`)) {
        const wanted = el.getAttribute('data-variant');
        const variant = comp.variants[wanted] ? wanted : defaultVariant(comp);
        const html = expand(comp.variants[variant], name, variant, { rawSlots: readSlots(el), pid: el.getAttribute('data-pid') });
        el.replaceWith(...parse(this._prepare(html, false).toString()).childNodes); // _prepare gives the new children ids
        count++;
      }
      this._save(ab, root);
    }
    return count;
  }

  // Remove a component; its instances stay as ordinary nodes (detached).
  deleteComponent(name) {
    if (!(name in this.components)) throw new Error(`No component named "${name}"`);
    this._checkpoint('delete_component');
    for (const ab of this.data.artboards) {
      if (!ab.html.includes(`data-component="${name}"`)) continue;
      const root = this._artboardRoot(ab);
      for (const el of root.querySelectorAll(`[data-component="${name}"]`)) { el.removeAttribute('data-component'); el.removeAttribute('data-variant'); }
      this._save(ab, root);
    }
    const { [name]: _gone, ...rest } = this.components;
    this.data.components = rest;
    this._refreshFoundations();
    this._commit();
  }

  // Turn one instance into plain nodes so it no longer follows its master.
  detach(id) {
    const hit = this._find(id);
    if (!hit) throw new Error(`Node ${id} not found`);
    if (!hit.el.getAttribute('data-component')) throw new Error(`Node ${id} is not a component instance`);
    this._assertUnlocked(hit.el, id);
    this._checkpoint('detach_component');
    hit.el.removeAttribute('data-component');
    hit.el.removeAttribute('data-variant');
    this._save(hit.ab, hit.root);
    this._commit();
  }

  // The generated sheet that lists every component and variant (kept current by setComponent).
  createComponentsSheet() {
    if (!Object.keys(this.components).length) throw new Error('No components yet. Call components (action set) first.');
    let ab = this.data.artboards.find((a) => a.generated === 'components');
    if (!ab) {
      ab = this.createArtboard({ name: 'Components', width: 1200, height: 600 }); // checkpoints itself
      ab.generated = 'components';
    } else {
      this._checkpoint('create_components_sheet');
    }
    this._refreshFoundations();
    this._commit();
    return ab;
  }

  // ---- Mutations ----------------------------------------------------------

  // heightMode 'fit' = `height` is a minimum and the board grows with its content; anything else = fixed.
  createArtboard({ name = 'Artboard', width = 1440, height = 900, x, y, page: pageArg, heightMode } = {}) {
    // Place new artboards to the right of the rightmost one so they never overlap.
    const page = this._pageId(pageArg); // validate before the undo checkpoint so a bad page leaves no entry
    this._checkpoint('create_artboard');
    const right = this.data.artboards.filter((a) => this.pageOf(a) === page).reduce((m, a) => Math.max(m, a.x + a.width), -120);
    const ab = {
      id: this._newId('A'),
      name,
      x: x ?? right + 120,
      y: y ?? 0,
      width,
      height,
      html: '',
      ...(heightMode === 'fit' ? { heightMode } : {}), // stored only when set: old boards stay fixed
      ...(this.data.pages?.length ? { page } : {}), // projects that never added a page keep boards field-free
    };
    this.data.artboards.push(ab);
    this._commit();
    return ab;
  }

  // Add HTML into an artboard or relative to a node.
  //   append / prepend: inside the target, last / first   replace: swap the target's children
  //   before / after:   next to the target (nodes only, an artboard has no siblings)
  // `opts.normalize` overrides the project setting for this write (capture_url keeps a copied page as it is).
  writeHtml(targetId, html, mode = 'append', opts = {}) {
    const ab = this.getArtboard(targetId);
    if (ab) {
      if (mode === 'before' || mode === 'after') throw new Error('before/after need a node id, not an artboard id');
      const prepared = this._prepare(html, opts.normalize);
      this._checkpoint('write_html');
      const out = prepared.toString();
      ab.html = mode === 'replace' ? out : mode === 'prepend' ? out + ab.html : ab.html + out;
      this._commit();
      return this._topLevelIds(prepared);
    }
    const hit = this._find(targetId);
    if (!hit) throw new Error(`Target ${targetId} is neither an artboard nor a node`);
    // Inserting beside a locked node is fine; changing what is inside one is not.
    if (mode !== 'before' && mode !== 'after') this._assertUnlocked(hit.el, targetId);
    const prepared = this._prepare(html, opts.normalize);
    this._checkpoint('write_html');
    if (mode === 'replace') hit.el.set_content(prepared.toString());
    else {
      const where = { append: 'beforeend', prepend: 'afterbegin', before: 'beforebegin', after: 'afterend' }[mode];
      hit.el.insertAdjacentHTML(where, prepared.toString());
    }
    this._save(hit.ab, hit.root);
    this._commit();
    return this._topLevelIds(prepared);
  }

  _topLevelIds(root) {
    return root.childNodes.filter((c) => c instanceof HTMLElement).map((c) => c.getAttribute('data-pid'));
  }

  updateStyles(ids, styles) {
    // Validate every id first so a bad id can't leave the batch half-applied.
    for (const id of ids) {
      const hit = this._find(id);
      if (!hit) throw new Error(`Node ${id} not found`);
      this._assertUnlocked(hit.el, id);
    }
    this._checkpoint('update_styles');
    // Re-find per id: each lookup parses a fresh copy of its artboard, and saving a stale copy
    // would overwrite the previous node's edit when two ids share an artboard.
    for (const id of ids) {
      const hit = this._find(id);
      const map = parseStyle(hit.el.getAttribute('style'));
      for (const [k, v] of Object.entries(styles)) {
        // null/'' removes a property; accept camelCase like Paper does.
        if (v === null || v === '') map.delete(kebab(k));
        else map.set(kebab(k), String(v));
      }
      hit.el.setAttribute('style', styleToString(map));
      this._save(hit.ab, hit.root);
    }
    this._commit();
  }

  setText(id, text) {
    const hit = this._find(id);
    if (!hit) throw new Error(`Node ${id} not found`);
    this._assertUnlocked(hit.el, id);
    this._checkpoint('set_text_content');
    // Escape so AI-provided text can never inject markup.
    hit.el.set_content(text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    this._save(hit.ab, hit.root);
    this._commit();
  }

  deleteNodes(ids) {
    this._checkpoint('delete_nodes');
    for (const id of ids) {
      const ab = this.getArtboard(id);
      if (ab) {
        this.data.artboards = this.data.artboards.filter((a) => a.id !== id);
        continue;
      }
      const hit = this._find(id);
      if (!hit) throw new Error(`Node ${id} not found`);
      this._assertUnlocked(hit.el, id);
      hit.el.remove();
      this._save(hit.ab, hit.root);
    }
    this._commit();
  }

  renameNodes(map) {
    this._checkpoint('rename_nodes');
    for (const [id, name] of Object.entries(map)) {
      const ab = this.getArtboard(id);
      if (ab) { ab.name = name; continue; }
      const hit = this._find(id);
      if (!hit) throw new Error(`Node ${id} not found`);
      hit.el.setAttribute('data-name', name);
      this._save(hit.ab, hit.root);
    }
    this._commit();
  }

  // Returns the new top-level ids. With { withMap: true } returns { created, idMap } where idMap maps every
  // original id (node and descendants) to its copy's id, so the copy can be edited without another get_tree.
  duplicateNodes(ids, { withMap = false } = {}) {
    this._checkpoint('duplicate_nodes');
    const out = [];
    const idMap = {};
    // A copy has the same structure, so the n-th id in document order of the original pairs with the n-th of the copy.
    const pidsIn = (html) => parse(html).querySelectorAll('[data-pid]').map((n) => n.getAttribute('data-pid'));
    const pair = (fromHtml, toHtml) => {
      const a = pidsIn(fromHtml);
      const b = pidsIn(toHtml);
      a.forEach((id, i) => { if (b[i]) idMap[id] = b[i]; });
    };
    for (const id of ids) {
      const ab = this.getArtboard(id);
      if (ab) {
        const copy = this.createArtboard({ name: ab.name + ' copy', width: ab.width, height: ab.height, heightMode: ab.heightMode, page: this.pageOf(ab) });
        // Strip old ids from the copy so _prepare mints fresh ones.
        copy.html = this._prepare(ab.html.replace(/ data-pid="[^"]*"/g, '')).toString();
        pair(ab.html, copy.html);
        idMap[ab.id] = copy.id;
        out.push(copy.id);
        continue;
      }
      const hit = this._find(id);
      if (!hit) throw new Error(`Node ${id} not found`);
      const clone = this._prepare(hit.el.toString().replace(/ data-pid="[^"]*"/g, ''));
      pair(hit.el.toString(), clone.toString());
      hit.el.insertAdjacentHTML('afterend', clone.toString());
      this._save(hit.ab, hit.root);
      out.push(...this._topLevelIds(clone));
    }
    this._commit();
    return withMap ? { created: out, idMap } : out;
  }

  // Move a node next to or inside another node, keeping its ids. position: before | after (siblings
  // of the target) or start | end (first / last child of the target). Works across artboards.
  moveNode(id, targetId, position = 'end') {
    if (!['before', 'after', 'start', 'end'].includes(position)) throw new Error('position must be before, after, start or end');
    if (id === targetId) throw new Error('A node cannot be moved onto itself');
    const src = this._find(id);
    if (!src) throw new Error(`Node ${id} not found`);
    this._assertUnlocked(src.el, id);
    const inside = position === 'start' || position === 'end';
    const targetIsBoard = !!this.getArtboard(targetId);
    if (targetIsBoard && !inside) throw new Error('Use position start or end to move a node into an artboard');
    // The target must not be the node itself or live inside it, or the node would swallow itself.
    if (!targetIsBoard) {
      const tgt = this._find(targetId);
      if (!tgt) throw new Error(`Target ${targetId} not found`);
      if (src.el.querySelector(`[data-pid="${targetId}"]`)) throw new Error('Cannot move a node into its own descendant');
      if (inside) this._assertUnlocked(tgt.el, targetId);
    }
    const html = src.el.toString();
    this._checkpoint('move_node');
    src.el.remove();
    this._save(src.ab, src.root);
    if (targetIsBoard) {
      const ab = this.getArtboard(targetId);
      ab.html = position === 'start' ? html + ab.html : ab.html + html;
    } else {
      const tgt = this._find(targetId); // re-find: the source artboard was just re-saved
      const where = { before: 'beforebegin', after: 'afterend', start: 'afterbegin', end: 'beforeend' }[position];
      tgt.el.insertAdjacentHTML(where, html);
      this._save(tgt.ab, tgt.root);
    }
    this._commit();
  }

  // Toggle the two flags the layers panel exposes: hidden (not drawn) and data-locked (not editable).
  setFlags(ids, { hidden, locked }) {
    for (const id of ids) {
      const hit = this._find(id);
      if (!hit) throw new Error(`Node ${id} not found`);
      // Unlocking must work on a locked node, so only check the lock when we are not changing it.
      if (locked === undefined) this._assertUnlocked(hit.el, id);
    }
    this._checkpoint('set_flags');
    for (const id of ids) {
      const hit = this._find(id);
      const set = (attr, on) => (on ? hit.el.setAttribute(attr, '') : hit.el.removeAttribute(attr));
      if (hidden !== undefined) set('hidden', hidden);
      if (locked !== undefined) set('data-locked', locked);
      this._save(hit.ab, hit.root);
    }
    this._commit();
  }

  moveArtboard(id, x, y) {
    const ab = this.getArtboard(id);
    if (!ab) return;
    ab.x = x;
    ab.y = y;
    this._commit();
  }

  resizeArtboard(id, width, height) {
    const ab = this.getArtboard(id);
    if (!ab) return;
    // Dragging a board to a new height is an explicit "this tall": it stops auto-growing.
    if (height !== ab.height) delete ab.heightMode;
    ab.width = width;
    ab.height = height;
    this._commit();
  }

  // The browser measured more content than a `fit` board holds: raise the height. Never shrinks, and is not
  // an undo step or journal entry (it follows from the write that caused it). Returns true if it changed.
  growArtboard(id, contentHeight) {
    const ab = this.getArtboard(id);
    const next = Math.min(MAX_BOARD_HEIGHT, Math.ceil(contentHeight));
    if (!ab || ab.heightMode !== 'fit' || next <= ab.height) return false;
    ab.height = next;
    this._commit();
    return true;
  }

  // Switch a board to `fit` and set its height to exactly its content (at least `minHeight`). This is the one
  // place a board shrinks. `contentHeight` is the browser's measurement, or null when no tab was open.
  fitArtboard(id, contentHeight, minHeight = 40) {
    const ab = this.getArtboard(id);
    if (!ab) throw new Error(`Artboard ${id} not found`);
    this._checkpoint('fit_artboard');
    ab.heightMode = 'fit';
    if (contentHeight != null) ab.height = Math.min(MAX_BOARD_HEIGHT, Math.max(minHeight, Math.ceil(contentHeight)));
    this._commit();
    return ab;
  }
}
