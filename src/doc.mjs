// Document model: the single source of truth for artboards and their HTML.
// Both the web UI (via HTTP) and Claude (via MCP) mutate the design through
// this class, so the two can never drift apart.
import { parse, HTMLElement } from 'node-html-parser';
import fs from 'node:fs';

// Tags that could run code or pull in outside pages. The HTML comes from an AI
// and is rendered in the user's own browser, so we strip these on every write.
const FORBIDDEN_TAGS = ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form'];

const kebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

// Parse "a:b; c:d" into an ordered Map so edits keep declaration order.
function parseStyle(str = '') {
  const map = new Map();
  for (const decl of str.split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) map.set(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
  }
  return map;
}
const styleToString = (map) => [...map].map(([k, v]) => `${k}: ${v}`).join('; ');

export class Doc {
  constructor(file) {
    this.file = file;
    this.data = { counter: 0, artboards: [] };
    this.listeners = new Set();
    // In-memory only (not saved): the last states Claude/the user can step back to.
    this.undoStack = [];
    // Who changed what, newest last. `version` grows by one per entry, so a reader can ask
    // "what changed since version N" instead of re-reading whole artboards.
    this.journal = [];
    this.version = 0;
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
    for (const ab of this.data.artboards) ab.html = this._prepare(String(ab.html)).toString();
  }

  // ---- Undo + change journal ----------------------------------------------

  // Remember the current artboards before a mutation. Artboard objects are shallow-copied
  // because mutations replace `html` strings (immutable) rather than editing them in place,
  // so a copy is cheap even for a multi-megabyte design.
  _checkpoint(label) {
    this.undoStack.push({ label, artboards: this.data.artboards.map((a) => ({ ...a })) });
    if (this.undoStack.length > 50) this.undoStack.shift();
  }

  // Step back `steps` mutations. The id counter is deliberately NOT rewound, so an id that was
  // handed out once is never reused for a different node.
  undo(steps = 1) {
    const reverted = [];
    for (let i = 0; i < steps && this.undoStack.length; i++) {
      const entry = this.undoStack.pop();
      this.data.artboards = entry.artboards;
      reverted.push(entry.label);
    }
    if (reverted.length) {
      this.record('claude', 'undo', []);
      this._commit();
    }
    return reverted;
  }

  // Note a change for get_changes. `actor` is 'user' (browser) or 'claude' (MCP).
  record(actor, tool, ids = []) {
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
  _prepare(html) {
    const root = parse(html, { comment: false });
    // <x-clone node-id="N5"> is replaced by a copy of that node, so Claude can repeat a card
    // without resending its markup. The copy loses its ids and gets fresh ones below.
    for (const clone of root.querySelectorAll('x-clone')) {
      const src = this._find(clone.getAttribute('node-id'));
      if (!src) throw new Error(`x-clone: node ${clone.getAttribute('node-id')} not found`);
      clone.replaceWith(...parse(src.el.toString().replace(/ data-pid="[^"]*"/g, '')).childNodes);
    }
    for (const tag of FORBIDDEN_TAGS) root.querySelectorAll(tag).forEach((n) => n.remove());
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

  // ---- Queries ------------------------------------------------------------

  getArtboard(id) {
    return this.data.artboards.find((a) => a.id === id);
  }

  basicInfo() {
    return {
      artboards: this.data.artboards.map(({ id, name, x, y, width, height }) => ({
        id, name, x, y, width, height,
      })),
    };
  }

  treeSummary(artboardId, depth = 6) {
    const ab = this.getArtboard(artboardId);
    if (!ab) throw new Error(`Artboard ${artboardId} not found`);
    const lines = [`${ab.name} [${ab.id}] ${ab.width}x${ab.height}`];
    const walk = (el, d) => {
      for (const c of el.childNodes) {
        if (c instanceof HTMLElement) {
          const label = c.getAttribute('data-name') || c.rawTagName;
          const text = c.childNodes.length === 1 && !(c.childNodes[0] instanceof HTMLElement)
            ? ` "${c.text.trim().slice(0, 40)}"` : '';
          lines.push(`${'  '.repeat(d)}${label} [${c.getAttribute('data-pid')}]${text}`);
          if (d < depth) walk(c, d + 1);
        }
      }
    };
    walk(this._artboardRoot(ab), 1);
    return lines.join('\n');
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
          if (d < depth) walk(c, d + 1);
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

  // ---- Mutations ----------------------------------------------------------

  createArtboard({ name = 'Artboard', width = 1440, height = 900, x, y } = {}) {
    // Place new artboards to the right of the rightmost one so they never overlap.
    this._checkpoint('create_artboard');
    const right = this.data.artboards.reduce((m, a) => Math.max(m, a.x + a.width), -120);
    const ab = {
      id: this._newId('A'),
      name,
      x: x ?? right + 120,
      y: y ?? 0,
      width,
      height,
      html: '',
    };
    this.data.artboards.push(ab);
    this._commit();
    return ab;
  }

  // Add HTML into an artboard or relative to a node.
  //   append / prepend: inside the target, last / first   replace: swap the target's children
  //   before / after:   next to the target (nodes only, an artboard has no siblings)
  writeHtml(targetId, html, mode = 'append') {
    const ab = this.getArtboard(targetId);
    if (ab) {
      if (mode === 'before' || mode === 'after') throw new Error('before/after need a node id, not an artboard id');
      const prepared = this._prepare(html);
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
    const prepared = this._prepare(html);
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

  duplicateNodes(ids) {
    this._checkpoint('duplicate_nodes');
    const out = [];
    for (const id of ids) {
      const ab = this.getArtboard(id);
      if (ab) {
        const copy = this.createArtboard({ name: ab.name + ' copy', width: ab.width, height: ab.height });
        // Strip old ids from the copy so _prepare mints fresh ones.
        copy.html = this._prepare(ab.html.replace(/ data-pid="[^"]*"/g, '')).toString();
        out.push(copy.id);
        continue;
      }
      const hit = this._find(id);
      if (!hit) throw new Error(`Node ${id} not found`);
      const clone = this._prepare(hit.el.toString().replace(/ data-pid="[^"]*"/g, ''));
      hit.el.insertAdjacentHTML('afterend', clone.toString());
      this._save(hit.ab, hit.root);
      out.push(...this._topLevelIds(clone));
    }
    this._commit();
    return out;
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
    ab.width = width;
    ab.height = height;
    this._commit();
  }
}
