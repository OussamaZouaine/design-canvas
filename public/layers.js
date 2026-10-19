// Layers panel: the document as a tree (artboards > frames > text...), like a design tool's layer
// list. It reads the artboards' HTML (already in the browser) and sends edits (rename, hide, lock,
// reorder) to the server; the doc event brings the result back and the tree redraws.
//
// Everything user-controlled (names, text) is put in with textContent, never innerHTML.

const KIND_ICON = { artboard: '▭', frame: '□', text: 'T', image: '▣', svg: '◇', component: '◆' };
const INLINE = new Set(['span', 'b', 'strong', 'i', 'em', 'a', 'br', 'small', 'sub', 'sup', 'code']);
const MAX_ROWS = 400; // a board with thousands of nodes must not freeze the panel

export function initLayers({ h, markUserEdit, getDoc, getSelected, select, post, api, toast, abOf, onHover }) {
  const panel = document.getElementById('layers');
  const list = panel.querySelector('.layers-list');
  const search = panel.querySelector('input[type="search"]');
  const expanded = new Set(); // ids of artboards / nodes whose children are showing
  const trees = new Map(); // artboard id -> { html, root } so a board is parsed once per change
  let dragId = null;
  let raf = 0;

  // Parse an artboard's HTML into a detached DOM. DOMParser documents never run scripts or load images.
  const treeOf = (ab) => {
    let t = trees.get(ab.id);
    if (!t || t.html !== ab.html) {
      t = { html: ab.html, root: new DOMParser().parseFromString(`<body>${ab.html}</body>`, 'text/html').body };
      trees.set(ab.id, t);
    }
    return t.root;
  };
  const kids = (el) => [...el.children].filter((c) => c.dataset.pid);
  const kindOf = (el) => {
    if (el.dataset.component) return 'component';
    const t = el.tagName.toLowerCase();
    if (t === 'svg') return 'svg';
    if (t === 'img') return 'image';
    return [...el.children].every((c) => INLINE.has(c.tagName.toLowerCase())) && el.textContent.trim() ? 'text' : 'frame';
  };
  const labelOf = (el) => el.dataset.name || (el.dataset.component ? `${el.dataset.component}/${el.dataset.variant ?? ''}` : el.tagName.toLowerCase());
  const snippet = (el) => (kindOf(el) === 'text' ? el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40) : '');

  async function send(path, body) {
    markUserEdit(); // so the canvas does not treat our own edit as Claude drawing
    const r = await post(`${api}/${path}`, body);
    if (!r.ok) toast((await r.json().catch(() => ({}))).error || 'That change was not allowed');
  }

  function row({ id, depth, kind, name, text, hasKids, hidden, locked, isBoard, dim }) {
    const sel = getSelected() === id;
    const el = h('div', { class: `lrow${sel ? ' sel' : ''}${hidden ? ' off' : ''}`, 'data-id': id, style: `padding-left:${6 + depth * 14}px`, draggable: isBoard ? 'false' : 'true' });
    const chev = h('button', { class: 'lchev', tabindex: '-1', 'aria-label': expanded.has(id) ? 'Collapse' : 'Expand' }, hasKids ? (expanded.has(id) ? '▾' : '▸') : '');
    chev.onclick = (e) => { e.stopPropagation(); expanded.has(id) ? expanded.delete(id) : expanded.add(id); render(); };
    const label = h('span', { class: 'lname' }, name);
    el.append(chev, h('span', { class: 'lkind' }, KIND_ICON[kind]), label);
    if (text) el.append(h('span', { class: 'ltext' }, text));
    if (dim) el.append(h('span', { class: 'ltext' }, dim));
    if (!isBoard) {
      const eye = h('button', { class: `lbtn${hidden ? ' on' : ''}`, title: hidden ? 'Show' : 'Hide', 'aria-label': hidden ? 'Show layer' : 'Hide layer' }, hidden ? '○' : '●');
      eye.onclick = (e) => { e.stopPropagation(); send('flags', { ids: [id], hidden: !hidden }); };
      const lock = h('button', { class: `lbtn${locked ? ' on' : ''}`, title: locked ? 'Unlock' : 'Lock', 'aria-label': locked ? 'Unlock layer' : 'Lock layer' }, locked ? '🔒' : '·');
      lock.onclick = (e) => { e.stopPropagation(); send('flags', { ids: [id], locked: !locked }); };
      el.append(eye, lock);
    }

    el.onclick = () => select(id);
    el.onmouseenter = () => onHover(id);
    el.onmouseleave = () => onHover(null);
    // Rename in place: swap the label for an input; Enter or blur saves, Escape cancels.
    label.ondblclick = (e) => {
      e.stopPropagation();
      const input = h('input', { class: 'lrename', 'aria-label': 'Layer name', maxlength: '80' });
      input.value = name;
      let done = false;
      const finish = (save) => {
        if (done) return;
        done = true;
        const v = input.value.trim();
        // Put the label back first: the redraw is skipped while an input is in the list, so leaving
        // it there would block the update that the rename itself triggers.
        label.textContent = save && v ? v : name;
        input.replaceWith(label);
        if (save && v && v !== name) send('rename', { id, name: v });
        else render();
      };
      input.onkeydown = (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false); };
      input.onblur = () => finish(true);
      label.replaceWith(input);
      input.focus();
      input.select();
    };

    // Drag to reorder: the pointer's height inside the row decides before / inside / after.
    if (!isBoard) el.ondragstart = (e) => { dragId = id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); };
    el.ondragend = () => { dragId = null; clearDrop(); };
    el.ondragover = (e) => {
      if (!dragId || dragId === id) return;
      e.preventDefault();
      clearDrop();
      el.classList.add(`drop-${dropPosition(e, el, isBoard)}`);
    };
    el.ondragleave = () => el.classList.remove('drop-before', 'drop-after', 'drop-inside');
    el.ondrop = (e) => {
      e.preventDefault();
      const pos = dropPosition(e, el, isBoard);
      const moving = dragId;
      dragId = null;
      clearDrop();
      if (moving && moving !== id) send('move-node', { id: moving, target: id, position: pos === 'inside' ? 'end' : pos });
    };
    return el;
  }
  const dropPosition = (e, el, isBoard) => {
    if (isBoard) return 'inside';
    const r = el.getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    return f < 0.28 ? 'before' : f > 0.72 ? 'after' : 'inside';
  };
  const clearDrop = () => list.querySelectorAll('.drop-before, .drop-after, .drop-inside').forEach((n) => n.classList.remove('drop-before', 'drop-after', 'drop-inside'));

  function render() {
    if (!panel.classList.contains('open')) return;
    // A rename in progress owns the list: redrawing now (the click that started it also re-rendered
    // for the selection change) would throw the input away mid-typing.
    if (list.querySelector('.lrename')) return;
    const doc = getDoc();
    const q = search.value.trim().toLowerCase();
    const rows = [];
    const walk = (root, depth) => {
      for (const el of kids(root)) {
        if (rows.length >= MAX_ROWS) return;
        const id = el.dataset.pid;
        const sub = kids(el);
        rows.push(row({ id, depth, kind: kindOf(el), name: labelOf(el), text: snippet(el), hasKids: sub.length > 0 && !el.dataset.component, hidden: el.hasAttribute('hidden'), locked: el.hasAttribute('data-locked') }));
        if (sub.length && !el.dataset.component && expanded.has(id)) walk(el, depth + 1);
      }
    };
    for (const ab of doc.artboards) {
      if (rows.length >= MAX_ROWS) break;
      if (q) {
        // Search mode: a flat list of every layer whose name or text matches, tagged with its artboard.
        for (const el of treeOf(ab).querySelectorAll('[data-pid]')) {
          if (rows.length >= MAX_ROWS) break;
          if (`${labelOf(el)} ${el.textContent}`.toLowerCase().includes(q) && !kids(el).some((k) => `${labelOf(k)} ${k.textContent}`.toLowerCase().includes(q))) {
            rows.push(row({ id: el.dataset.pid, depth: 0, kind: kindOf(el), name: labelOf(el), text: snippet(el), hasKids: false, hidden: el.hasAttribute('hidden'), locked: el.hasAttribute('data-locked'), dim: ab.name }));
          }
        }
        continue;
      }
      rows.push(row({ id: ab.id, depth: 0, kind: 'artboard', name: ab.name, hasKids: !!ab.html.trim(), isBoard: true }));
      if (expanded.has(ab.id)) walk(treeOf(ab), 1);
    }
    if (rows.length >= MAX_ROWS) rows.push(h('div', { class: 'empty' }, `Showing the first ${MAX_ROWS} layers. Collapse some boards or search.`));
    list.replaceChildren(...(rows.length ? rows : [h('div', { class: 'empty' }, q ? 'No layers match.' : 'No layers yet.')]));
    list.querySelector('.lrow.sel')?.scrollIntoView({ block: 'nearest' });
  }

  const refresh = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };

  // Open every ancestor of a node so a selection made on the canvas shows up in the tree.
  function reveal(id) {
    if (!id) return refresh();
    const abId = abOf(id);
    const ab = getDoc().artboards.find((a) => a.id === abId);
    if (!ab) return refresh();
    expanded.add(ab.id);
    for (let el = treeOf(ab).querySelector(`[data-pid="${CSS.escape(id)}"]`)?.parentElement; el && el.dataset?.pid; el = el.parentElement) expanded.add(el.dataset.pid);
    refresh();
  }

  // The parent of a node (or its artboard), for Escape-to-select-parent.
  function parentOf(id) {
    const ab = getDoc().artboards.find((a) => a.id === abOf(id));
    if (!ab) return null;
    const p = treeOf(ab).querySelector(`[data-pid="${CSS.escape(id)}"]`)?.parentElement;
    return p?.dataset?.pid ?? ab.id;
  }

  search.oninput = refresh;
  const button = document.getElementById('open-layers');
  const open = () => { panel.classList.add('open'); panel.inert = false; button.setAttribute('aria-pressed', 'true'); render(); };
  const close = () => { panel.classList.remove('open'); panel.inert = true; button.setAttribute('aria-pressed', 'false'); };
  panel.querySelector('.layers-close').onclick = close;
  return { refresh, reveal, parentOf, toggle: () => (panel.classList.contains('open') ? close() : open()), isOpen: () => panel.classList.contains('open') };
}
