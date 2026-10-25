// Editing half of the canvas (port of the edit code in public/app.js): resize handles, dragging boards and
// absolutely positioned nodes, in-place text edit, keyboard shortcuts, node clipboard, reference images.
// Plain module, no React. The engine owns rendering and the selection; this class asks it for what it needs
// through EditHost and sends every change to the server, whose doc event then redraws the canvas.
// Previews while dragging write straight to the element, and the server's version replaces them on release.
import { canvasAction } from '@/api/projects';
import type { Artboard } from '@/api/types';
import { toast } from '@/store/toast';
import type { PathModel } from './path';
import { pathHtml, shapeHtml, type ShapeBox, type ShapeKind } from './shapes';
import { siblingStep } from './selection';
import { inEdgeBand, inferAxis, insertionIndex, insertionLine, resolveDrop, stepDrop, type Axis, type Drop } from './dragflow';
import { isNodeEl } from '@/lib/htmlTree';

export interface EditHost {
  viewport: HTMLElement;
  projectId: string;
  zoom: () => number;
  selected: () => string[];                    // ordered, last = primary
  primary: () => string | null;
  select: (ids: string[]) => void;
  parentOf: (id: string) => string | null;    // parent node id, the board id for a top-level node, null for a board
  siblingsOf: (id: string) => string[];       // ids sharing id's parent, in document order
  childrenOf: (id: string) => string[];       // direct child node ids (a board's top-level nodes for a board id)
  selectAll: () => void;                      // Ctrl+A: every child of the current context
  board: (id: string) => Artboard | undefined;
  boardsHere: () => Artboard[];
  boardEl: (id: string) => HTMLElement | undefined;
  findElement: (id: string) => HTMLElement | null;
  boardOf: (id: string) => string | undefined; // node id -> artboard id
  redraw: () => void;                          // reposition selection / hover boxes
  markUserEdit: () => void;
  activePage: () => string | null;
  selBox: HTMLElement;
  overlay: HTMLElement;                        // screen-px layer for the drag ghost and insertion line
  // Live nodes under a screen point, deepest first, plus the board there and its root wrapper (null over bare canvas
  // or a bitmap board, which has no DOM to drop into).
  nodesAt: (x: number, y: number) => { board: string | null; nodes: HTMLElement[]; root: HTMLElement | null };
}

const HANDLE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Dir = (typeof HANDLE_DIRS)[number];

// Position and size in design px. An <svg> has no offsetLeft/offsetWidth (those are HTMLElement only), so it is
// read from its inline left/top and its rendered rect divided by the zoom.
const boxOf = (el: HTMLElement, zoom: number) => {
  if (el instanceof HTMLElement) return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  const r = (el as Element).getBoundingClientRect(), st = (el as SVGElement).style;
  return { x: parseFloat(st.left) || 0, y: parseFloat(st.top) || 0, w: r.width / zoom, h: r.height / zoom };
};
const isAbs = (el: Element) => ['absolute', 'fixed'].includes(getComputedStyle(el).position);
const typing = (t: EventTarget | null) => t instanceof Element && !!t.closest('input, textarea, [contenteditable]');
const fail = (err: unknown, fallback: string) => toast((err as Error)?.message || fallback);

export class CanvasEditor {
  private handles = new Map<Dir, HTMLElement>();
  private nodeClip: string | null = null; // HTML of the node last copied with Ctrl+C
  private pasteSeen = false;

  constructor(private host: EditHost, signal: AbortSignal) {
    // Eight handles ride on the selection box. They are children of it so they move with it for free.
    for (const dir of HANDLE_DIRS) {
      const el = document.createElement('i');
      el.className = 'dc-handle';
      el.dataset.dir = dir;
      el.hidden = true;
      // stopPropagation: the viewport would otherwise start a pan / re-select on the same press.
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.beginResize(dir, e); });
      host.selBox.append(el);
      this.handles.set(dir, el);
    }
    const sig = { signal };
    window.addEventListener('keydown', this.onKey, sig);
    window.addEventListener('keydown', this.onPasteKey, sig);
    window.addEventListener('paste', this.onPaste, sig);
    host.viewport.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types ?? [])].includes('Files')) e.preventDefault(); }, sig);
    host.viewport.addEventListener('drop', (e) => {
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (file) { e.preventDefault(); void this.addReferenceFile(file); }
    }, sig);
  }

  // ---- Handles -----------------------------------------------------------------------
  // An artboard uses all eight. An absolutely positioned node can too (width, height, left, top). A node that
  // flows with its siblings only gets east, south and south-east: moving its west or north edge would mean
  // changing its position, which the layout decides. Locked nodes get none.
  // A node picked on a snapshot board has no DOM to resize, so the handles stay hidden until you zoom in.
  hideHandles() { for (const el of this.handles.values()) el.hidden = true; }

  showHandles(target: HTMLElement) {
    const sel = this.host.primary() ?? '';
    const isBoard = sel.startsWith('A');
    const locked = !isBoard && !!target.closest('[data-locked]');
    const allowed: readonly Dir[] = locked ? [] : isBoard || isAbs(target) ? HANDLE_DIRS : ['e', 's', 'se'];
    for (const [dir, el] of this.handles) el.hidden = !allowed.includes(dir);
  }

  private beginResize(dir: Dir, e: PointerEvent) {
    const { host } = this;
    const id = host.primary();
    if (!id || host.selected().length > 1) return; // multi-resize arrives with the free-move phase
    const board = id.startsWith('A') ? host.board(id) : undefined;
    const el = board ? null : host.findElement(id);
    if (!board && !el) return;
    const abs = !board && !!el && isAbs(el);
    const start = board
      ? { x: board.x, y: board.y, w: board.width, h: board.height }
      : boxOf(el!, host.zoom());
    const min = board ? 40 : 4;
    const next = { ...start };
    const sx = e.clientX, sy = e.clientY;
    host.viewport.setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent) => {
      // Screen pixels to design pixels: everything on the canvas is scaled by the zoom.
      const dx = (ev.clientX - sx) / host.zoom(), dy = (ev.clientY - sy) / host.zoom();
      Object.assign(next, start);
      if (dir.includes('e')) next.w = Math.max(min, start.w + dx);
      if (dir.includes('s')) next.h = Math.max(min, start.h + dy);
      if (dir.includes('w')) { next.w = Math.max(min, start.w - dx); next.x = start.x + (start.w - next.w); }
      if (dir.includes('n')) { next.h = Math.max(min, start.h - dy); next.y = start.y + (start.h - next.h); }
      if (board) {
        Object.assign(host.boardEl(board.id)!.style, { left: next.x + 'px', top: next.y + 'px', width: next.w + 'px', height: next.h + 'px' });
      } else {
        if (dir.includes('e') || dir.includes('w')) el!.style.width = next.w + 'px';
        if (dir.includes('s') || dir.includes('n')) el!.style.height = next.h + 'px';
        if (abs && dir.includes('w')) el!.style.left = next.x + 'px';
        if (abs && dir.includes('n')) el!.style.top = next.y + 'px';
      }
      host.redraw();
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      host.markUserEdit();
      const r = Math.round;
      if (board) {
        if (next.w !== start.w || next.h !== start.h) canvasAction(host.projectId, 'resize', { id, width: r(next.w), height: r(next.h) }).catch((err) => fail(err, 'Could not resize'));
        if (next.x !== start.x || next.y !== start.y) canvasAction(host.projectId, 'move', { id, x: r(next.x), y: r(next.y) }).catch((err) => fail(err, 'Could not move'));
        return;
      }
      const styles: Record<string, string> = {};
      if (next.w !== start.w) styles.width = `${r(next.w)}px`;
      if (next.h !== start.h) styles.height = `${r(next.h)}px`;
      if (abs && next.x !== start.x) styles.left = `${r(next.x)}px`;
      if (abs && next.y !== start.y) styles.top = `${r(next.y)}px`;
      if (Object.keys(styles).length) canvasAction(host.projectId, 'style', { ids: [id], styles }).catch((err) => fail(err, 'Could not resize'));
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  // ---- Dragging --------------------------------------------------------------------
  // Generic pointer drag. `scale` converts screen px into the unit being moved: boards live in world
  // units (divide by zoom). Pointer capture keeps the drag alive when the cursor leaves the viewport.
  private startDrag(e: PointerEvent, onMove: (dx: number, dy: number) => void, onEnd: () => void, scale: number) {
    const { viewport } = this.host;
    const sx = e.clientX, sy = e.clientY;
    viewport.classList.add('panning');
    viewport.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => onMove((ev.clientX - sx) / scale, (ev.clientY - sy) / scale);
    const up = () => {
      viewport.classList.remove('panning');
      viewport.removeEventListener('pointermove', move);
      viewport.removeEventListener('pointerup', up);
      onEnd();
    };
    viewport.addEventListener('pointermove', move);
    viewport.addEventListener('pointerup', up);
  }

  // Drag an artboard by its label.
  dragBoard(e: PointerEvent, id: string) {
    const { host } = this;
    const ab = host.board(id), el = host.boardEl(id);
    if (!ab || !el) return;
    let x = ab.x, y = ab.y;
    this.startDrag(e, (dx, dy) => {
      x = ab.x + dx; y = ab.y + dy;
      el.style.left = x + 'px'; el.style.top = y + 'px';
      host.redraw();
    }, () => {
      if (x === ab.x && y === ab.y) return;
      canvasAction(host.projectId, 'move', { id, x: Math.round(x), y: Math.round(y) }).catch((err) => fail(err, 'Could not move'));
    }, host.zoom());
  }

  // Drag a node. An absolutely positioned one moves freely (left / top); a node that flows with its siblings is
  // reordered or reparented (dragFlow). A drag under 3 px counts as a click. Returns false when the node cannot be
  // dragged (locked), so the caller treats it as a click.
  dragNode(e: PointerEvent, el: HTMLElement) {
    const { host } = this;
    if (el.closest('[data-locked]')) return false;
    if (!isAbs(el)) { this.dragFlow(e, el); return true; }
    const id = el.dataset.pid!;
    const { x: l0, y: t0 } = boxOf(el, host.zoom());
    let moved = false, mx = 0, my = 0;
    this.startDrag(e, (dx, dy) => {
      mx = dx; my = dy;
      if (!moved && Math.hypot(dx, dy) * host.zoom() < 3) return;
      moved = true;
      el.style.left = `${l0 + dx}px`;
      el.style.top = `${t0 + dy}px`;
      host.redraw();
    }, () => {
      if (!moved) return;
      host.markUserEdit();
      canvasAction(host.projectId, 'style', { ids: [id], styles: { left: `${Math.round(l0 + mx)}px`, top: `${Math.round(t0 + my)}px` } })
        .catch((err) => fail(err, 'Could not move'));
    }, host.zoom());
    return true;
  }

  // ---- Drag in flow: reorder among siblings / move into another container ---------------------------------
  // Nothing in the document changes while dragging: the original is dimmed, a ghost follows the pointer in the
  // overlay, and a 2 px blue line shows where the nodes would land. Release sends ONE move-nodes (one undo step).
  // The pure maths (axis, index, which sibling to name) is in dragflow.ts.

  // A child that takes part in its parent's layout: a node box, not hidden, not absolutely positioned, not display:contents.
  private flowKids(container: Element): HTMLElement[] {
    return [...container.children].filter((c): c is HTMLElement => {
      if (!isNodeEl(c) || c.hasAttribute('hidden')) return false;
      const cs = getComputedStyle(c);
      if (cs.display === 'none' || cs.display === 'contents' || cs.position === 'absolute' || cs.position === 'fixed') return false;
      const r = c.getBoundingClientRect();
      return r.width > 0 || r.height > 0;
    });
  }

  // Can a node be dropped inside this element? Not images / vectors / controls, not text (a leaf with text or text
  // mixed with elements), not display:contents (no box), and not locked.
  private canHold(n: HTMLElement) {
    if (/^(img|svg|input|textarea|select|br|hr|video|canvas|iframe|button)$/i.test(n.tagName) || n.hasAttribute('data-shape') || n.closest('[data-locked]')) return false;
    if ([...n.childNodes].some((c) => c.nodeType === 3 && c.textContent?.trim())) return false;
    if (!n.children.length && n.textContent?.trim()) return false;
    const d = getComputedStyle(n).display;
    return d !== 'contents' && d !== 'none' && d !== 'inline';
  }

  private dragFlow(e: PointerEvent, el: HTMLElement) {
    const { host } = this;
    const id = el.dataset.pid!;
    // The set that moves: the whole selection when the pressed node is part of it (the server restores document
    // order), else just this node. Boards, absolute and locked nodes stay out.
    const picked = host.selected().includes(id) ? host.selected() : [id];
    const moving = picked.filter((m) => !m.startsWith('A')).map((m) => host.findElement(m))
      .filter((m): m is HTMLElement => !!m && !isAbs(m) && !m.closest('[data-locked]'));
    if (!moving.length) return;
    const ids = moving.map((m) => m.dataset.pid!);
    const origin = { el: el.parentElement as HTMLElement, id: host.parentOf(id) ?? '' };
    const vp = host.viewport.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    let started = false, cancelled = false;
    let cur = origin;                                 // the container the line is drawn in
    let cand: { el: HTMLElement; id: string } | null = null, candSince = 0, timer = 0;
    let drop: Drop | null = null;
    let last = { x: sx, y: sy };
    const ghosts: HTMLElement[] = [];
    const line = document.createElement('div'), outline = document.createElement('div');
    line.className = 'dc-dropline dc-hide'; outline.className = 'dc-dropbox dc-hide';
    const saved = moving.map((m) => m.style.opacity);

    const begin = () => {
      started = true;
      host.viewport.classList.add('panning');
      // Ghost = a translucent copy of each moved node at its on-screen size. Inline styles survive the clone; text
      // colour / font are inherited from the board, so they are copied across explicitly. Capped at 6 for cost.
      moving.slice(0, 6).forEach((m) => {
        const r = m.getBoundingClientRect(), cs = getComputedStyle(m), k = host.zoom();
        const g = document.createElement('div');
        g.className = 'dc-ghost';
        Object.assign(g.style, { left: r.left - vp.left + 'px', top: r.top - vp.top + 'px', width: r.width + 'px', height: r.height + 'px' });
        const inner = m.cloneNode(true) as HTMLElement;
        Object.assign(inner.style, {
          position: 'absolute', left: '0', top: '0', margin: '0', width: r.width / k + 'px', height: r.height / k + 'px',
          transformOrigin: '0 0', transform: `scale(${k})`, color: cs.color, fontFamily: cs.fontFamily, fontSize: cs.fontSize,
        });
        g.append(inner);
        host.overlay.append(g);
        ghosts.push(g);
      });
      host.overlay.append(line, outline);
      moving.forEach((m) => { m.style.opacity = '0.35'; });
    };

    // The container under the pointer: the deepest droppable node that is not (inside) a moved node, else the
    // board's root wrapper when the pointer is on a board.
    const candidateAt = (x: number, y: number) => {
      const hit = host.nodesAt(x, y);
      for (const n of hit.nodes) {
        if (moving.some((m) => m === n || m.contains(n))) continue;
        if (this.canHold(n)) return { el: n, id: n.dataset.pid! };
      }
      return hit.root && hit.board ? { el: hit.root, id: hit.board } : null;
    };
    const hintOf = (c: Element) => (getComputedStyle(c).flexDirection.startsWith('row') ? 'x' : 'y');

    const evaluate = () => {
      const { x, y } = last;
      window.clearTimeout(timer);
      let c = candidateAt(x, y);
      // Over the middle of a sibling container the candidate is that container; over its outer band the drop stays
      // in the current one (see inEdgeBand).
      if (c && c.el !== cur.el && c.el.parentElement === cur.el) {
        const axis = inferAxis(this.flowKids(cur.el).map((k) => k.getBoundingClientRect()), hintOf(cur.el));
        if (inEdgeBand(c.el.getBoundingClientRect(), axis, x, y)) c = null;
      }
      if (c && c.el !== cur.el) {
        if (c.el === origin.el) { cur = origin; cand = null; }
        else {
          // Dwell: only reparent once the pointer has stayed ~150 ms over the other container (re-check on a timer,
          // because a still pointer sends no more move events).
          if (!cand || cand.el !== c.el) { cand = c; candSince = performance.now(); }
          const wait = 150 - (performance.now() - candSince);
          if (wait <= 0) { cur = c; cand = null; } else timer = window.setTimeout(evaluate, wait + 5);
        }
      } else cand = null;

      const kids = this.flowKids(cur.el);
      const rects = kids.map((k) => k.getBoundingClientRect());
      const axis: Axis = inferAxis(rects, hintOf(cur.el));
      const index = insertionIndex(rects, axis, x, y);
      drop = resolveDrop(cur.id, kids.map((k) => k.dataset.pid!), ids, index);
      const box = cur.el.getBoundingClientRect();
      const place = (b: HTMLElement, r: { left: number; top: number; width: number; height: number }) =>
        Object.assign(b.style, { left: r.left - vp.left + 'px', top: r.top - vp.top + 'px', width: r.width + 'px', height: r.height + 'px' });
      place(line, insertionLine(rects, index, axis, box)); line.classList.remove('dc-hide');
      place(outline, box); outline.classList.toggle('dc-hide', cur.el === origin.el);
    };

    const move = (ev: PointerEvent) => {
      last = { x: ev.clientX, y: ev.clientY };
      if (!started) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return; begin(); }
      const t = `translate(${ev.clientX - sx}px, ${ev.clientY - sy}px)`;
      ghosts.forEach((g) => { g.style.transform = t; });
      evaluate();
    };

    const cleanup = () => {
      window.clearTimeout(timer);
      host.viewport.removeEventListener('pointermove', move);
      host.viewport.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', onKey, true);
      host.viewport.classList.remove('panning');
      ghosts.forEach((g) => g.remove()); line.remove(); outline.remove();
      moving.forEach((m, i) => { m.style.opacity = saved[i]; });
    };
    const up = (ev: PointerEvent) => {
      const d = drop, target = cur;
      cleanup();
      if (!started || cancelled || !d) return;
      const copy = ev.altKey;
      if (d.noop && !copy) return;
      // A grid child placed by grid-column / grid-row keeps its cell: only the DOM order changes.
      if (getComputedStyle(target.el).display.includes('grid') && ids.some((i) => /grid-(column|row|area)/.test(host.findElement(i)?.getAttribute('style') ?? ''))) toast('Grid items keep their explicit cell; only the order changed');
      host.markUserEdit();
      canvasAction(host.projectId, 'move-nodes', { ids, target: d.target, position: d.position, copy })
        .catch((err) => fail(err, 'Could not move'));
    };
    // Esc cancels. Capture phase + stopImmediatePropagation so the Esc shortcut (select parent) does not also fire.
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.stopImmediatePropagation(); ev.preventDefault();
      cancelled = true;
      cleanup();
    };
    host.viewport.setPointerCapture(e.pointerId);
    host.viewport.addEventListener('pointermove', move);
    host.viewport.addEventListener('pointerup', up);
    window.addEventListener('keydown', onKey, true);
  }

  // Arrow keys reorder the selection along the parent's axis (left/up = earlier). Returns true when the key was ours.
  private arrowReorder(e: KeyboardEvent): boolean {
    const { host } = this;
    const ids = host.selected();
    if (!ids.length || ids.some((i) => i.startsWith('A'))) return false;
    const parent = host.parentOf(ids[0]);
    if (!parent || ids.some((i) => host.parentOf(i) !== parent)) return false;
    // Absolute nodes are left alone: arrows will nudge them in the free-move phase.
    const els = ids.map((i) => host.findElement(i));
    if (els.some((n) => !n || isAbs(n) || n.closest('[data-locked]'))) return false;
    const kidIds = host.childrenOf(parent);
    const kids = kidIds.map((k) => host.findElement(k));
    if (kids.some((k) => !k)) return false;
    const container = kids[0]!.parentElement!;
    const axis = inferAxis(kids.map((k) => k!.getBoundingClientRect()), getComputedStyle(container).flexDirection.startsWith('row') ? 'x' : 'y');
    const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown';
    if ((axis === 'x' && vertical) || (axis === 'y' && !vertical)) return false; // across the axis: nothing to reorder
    const dir = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1;
    const d = stepDrop(parent, kidIds, ids, dir);
    if (d && !d.noop) {
      host.markUserEdit();
      canvasAction(host.projectId, 'move-nodes', { ids, target: d.target, position: d.position }).catch((err) => fail(err, 'Could not move'));
    }
    return true; // an edge press is still ours: do not scroll
  }

  // ---- Text edit -----------------------------------------------------------------------
  // Double-click a text leaf (the engine decides when a double-click enters a node and when it edits), type, click
  // away or press Enter to save (Escape cancels). Only leaf elements qualify: setting text on a node with children
  // would replace them. contenteditable turns any element into a text field right inside its shadow root;
  // plaintext-only keeps pasted formatting out.
  editText(el: HTMLElement) {
    if (el.children.length || !el.textContent?.trim() || el.isContentEditable) return;
    this.startTextEdit(el);
  }

  private startTextEdit(el: HTMLElement) {
    const { host } = this;
    const id = el.dataset.pid!, before = el.textContent ?? '';
    let cancelled = false;
    try { el.contentEditable = 'plaintext-only'; } catch { el.contentEditable = 'true'; }
    if (!el.isContentEditable) el.contentEditable = 'true'; // browsers without plaintext-only ignore it silently
    el.focus();
    getSelection()?.selectAllChildren(el);
    const onKey = (ev: KeyboardEvent) => {
      ev.stopPropagation(); // typing must never reach the canvas shortcuts (Delete, Ctrl+Z...)
      if (ev.key === 'Escape') { cancelled = true; ev.preventDefault(); el.blur(); }
      else if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); el.blur(); }
    };
    el.addEventListener('keydown', onKey);
    el.addEventListener('blur', () => {
      el.removeEventListener('keydown', onKey);
      el.removeAttribute('contenteditable');
      const text = el.textContent ?? '';
      if (cancelled || text === before) { el.textContent = before; return; }
      host.markUserEdit();
      canvasAction(host.projectId, 'text', { id, text }).catch((err) => { el.textContent = before; fail(err, 'Could not save the text'); });
    }, { once: true });
  }

  // ---- Keyboard ------------------------------------------------------------------------
  // Shortcuts never animate: they are repeated all day.
  private onKey = (e: KeyboardEvent) => {
    if (typing(e.target)) return; // typing is not a shortcut
    const { host } = this;
    const sel = host.selected(), primary = host.primary();
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    const nodes = sel.filter((id) => !id.startsWith('A')); // boards cannot be copied as nodes
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) {
      this.remove(sel);
    } else if (e.key.startsWith('Arrow') && !mod && !e.altKey && sel.length && this.arrowReorder(e)) {
      e.preventDefault();
    } else if (e.key === 'Escape') {
      // Up one level (the parent becomes the selection and so the context), then deselect at board level.
      const parent = primary && !primary.startsWith('A') ? host.parentOf(primary) : null;
      host.select(parent && !parent.startsWith('A') ? [parent] : []);
    } else if (e.key === 'Enter' && !mod && sel.length) {
      e.preventDefault();
      if (e.shiftKey) {
        // Shift+Enter: select the parent(s); a top-level node's parent is its board.
        host.select([...new Set(sel.map((id) => host.parentOf(id)).filter((p): p is string => !!p))]);
      } else {
        // Enter: go into the selection. A lone text leaf has no children, so Enter edits it instead.
        const kids = sel.flatMap((id) => host.childrenOf(id));
        const el = sel.length === 1 && primary ? host.findElement(primary) : null;
        if (kids.length) host.select(kids);
        else if (el && !el.children.length && el.textContent?.trim() && !primary!.startsWith('A')) this.startTextEdit(el);
      }
    } else if (e.key === '\\' &&!mod && sel.length) {
      e.preventDefault();
      host.select([...new Set(sel.map((id) => host.parentOf(id)).filter((p): p is string => !!p))]);
    } else if (e.key === 'Tab' && primary) {
      // Tab walks the siblings of the primary node (wrapping); focus must not leave the canvas.
      e.preventDefault();
      const next = siblingStep(host.siblingsOf(primary), primary, e.shiftKey ? -1 : 1);
      if (next) host.select([next]);
    } else if (mod && key === 'a' && !e.shiftKey) {
      e.preventDefault();
      host.selectAll();
    } else if (mod && !e.altKey && (key === 'z' || key === 'y')) {
      // Undo / redo go through the server so they cover Claude's changes and the theme too.
      e.preventDefault();
      host.markUserEdit();
      canvasAction(host.projectId, key === 'y' || e.shiftKey ? 'redo' : 'undo').catch((err) => fail(err, 'Nothing to do'));
    } else if (mod && (key === 'c' || key === 'x') && nodes.length && !getSelection()?.toString()) {
      this.copy(nodes);
      if (key === 'x') this.remove(nodes);
    } else if (mod && key === 'd' && sel.length) {
      e.preventDefault();
      this.duplicate(sel);
    }
  };

  // The actions below are shared by the keyboard shortcuts and the right-click menu. They take the whole set:
  // the server actions already accept `ids`, so a multi-selection is still one request and one undo step.
  remove(ids: string[]) {
    if (!ids.length) return;
    this.host.markUserEdit();
    canvasAction(this.host.projectId, 'delete', { ids }).catch((err) => fail(err, 'Could not delete'));
    this.host.select([]);
  }

  duplicate(ids: string[]) {
    if (!ids.length) return;
    this.host.markUserEdit();
    canvasAction(this.host.projectId, 'duplicate', { ids }).catch((err) => fail(err, 'Could not duplicate'));
  }

  // Copy the nodes' HTML now, paste it later (even on another board or page). Several nodes are joined in the
  // order they were selected; the server's paste writes them as siblings.
  copy(ids: string[]) {
    const html = ids.map((id) => this.nodeHtml(id)).filter(Boolean).join('');
    if (html) { this.nodeClip = html; toast(ids.length > 1 ? `Copied ${ids.length} layers. Paste with Ctrl+V.` : 'Copied. Paste with Ctrl+V.'); }
  }

  get canPaste() { return !!this.nodeClip; }

  // Outer HTML of a node, read from its board's HTML text so it works for unmounted boards and never
  // includes transient attributes such as contenteditable.
  private nodeHtml(id: string) {
    const abId = this.host.boardOf(id);
    const html = abId ? this.host.board(abId)?.html : undefined;
    if (!html) return null;
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    return tpl.content.querySelector(`[data-pid="${id}"]`)?.outerHTML ?? null;
  }

  // ---- Paste: a copied node, or a picture from the system clipboard ----------------------------
  // Pasting into an artboard appends; pasting with a node selected puts the copy right after it.
  pasteNode() {
    const { host } = this;
    const sel = host.primary();
    const target = sel ?? host.boardsHere()[0]?.id;
    if (!this.nodeClip || !target) return;
    host.markUserEdit();
    canvasAction(host.projectId, 'paste', { html: this.nodeClip, target, position: sel && !sel.startsWith('A') ? 'after' : 'append' })
      .catch((err) => fail(err, 'Could not paste'));
  }

  // Some environments (automation, a few embedded browsers) send Ctrl+V as plain key events without ever
  // firing a paste event. If none arrives shortly after the keystroke, paste the copied node anyway.
  private onPasteKey = (e: KeyboardEvent) => {
    if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') || !this.nodeClip || typing(e.target)) return;
    this.pasteSeen = false;
    setTimeout(() => { if (!this.pasteSeen) this.pasteNode(); }, 150);
  };

  private onPaste = (e: ClipboardEvent) => {
    this.pasteSeen = true;
    if (typing(e.target)) return; // pasting text into a field is not ours
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); void this.addReferenceFile(file); return; }
    const text = e.clipboardData?.getData('text');
    if (this.nodeClip && !text?.trim()) { e.preventDefault(); this.pasteNode(); }
  };

  // A screenshot to rebuild from: the server stores the file and adds a locked board that shows it, so
  // Claude can compare its own board against it (compare_to_reference).
  async addReferenceFile(file: File) {
    const { host } = this;
    if (!file.type.startsWith('image/')) { toast('That is not an image'); return; }
    if (file.size > 10_000_000) { toast('Images up to 10 MB, please'); return; }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
    host.markUserEdit(); // the new board is the user's own, not Claude drawing
    try {
      await canvasAction(host.projectId, 'reference', { name: (file.name || 'Pasted image').replace(/\.[^.]+$/, ''), dataUrl, page: host.activePage() });
      toast('Added as a reference board');
    } catch (err) { fail(err, 'Could not add the image'); }
  }

  // New empty artboard (frame tool drag, or a plain click for the default size). Returns the request so callers can await it.
  createArtboard(opts: { x?: number; y?: number; width?: number; height?: number } = {}) {
    this.host.markUserEdit();
    return canvasAction(this.host.projectId, 'create', { name: 'Artboard', width: 1440, height: 900, page: this.host.activePage(), ...opts });
  }

  // Shape tools: write one absolutely positioned <svg> into the board. Returns the new node id once the server
  // answers (the element only exists after the doc event redraws, so the caller waits for it before selecting).
  async addShape(boardId: string, kind: ShapeKind, box: ShapeBox): Promise<string | undefined> {
    this.host.markUserEdit();
    try {
      const r = await canvasAction(this.host.projectId, 'paste', { html: shapeHtml(kind, box), target: boardId, position: 'append' });
      return (r.result as { ids?: string[] } | undefined)?.ids?.[0];
    } catch (err) { fail(err, 'Could not draw the shape'); }
  }

  // Pen tool: write the finished path (board px) as one <svg data-shape="path">. Same contract as addShape.
  async addPath(boardId: string, model: PathModel): Promise<string | undefined> {
    this.host.markUserEdit();
    try {
      const r = await canvasAction(this.host.projectId, 'paste', { html: pathHtml(model), target: boardId, position: 'append' });
      return (r.result as { ids?: string[] } | undefined)?.ids?.[0];
    } catch (err) { fail(err, 'Could not draw the path'); }
  }

  // Text tool: drop a paragraph into the clicked element (or after it when it is a text leaf, since text
  // cannot hold children), then open it for typing. The new id comes back from the server; the element only
  // exists once the doc event has redrawn the board, so we wait for it a few frames.
  async addText(targetId: string) {
    const { host } = this;
    const el = targetId.startsWith('A') ? null : host.findElement(targetId);
    const leaf = !!el && !el.children.length && !!el.textContent?.trim();
    host.markUserEdit();
    try {
      const r = await canvasAction(host.projectId, 'paste', {
        html: '<p style="margin:0;font-size:16px">Text</p>', target: targetId, position: leaf ? 'after' : 'append',
      });
      const id = (r.result as { ids?: string[] } | undefined)?.ids?.[0];
      if (!id) return;
      for (let i = 0; i < 40; i++) {
        const node = host.findElement(id);
        // Select only now: before the board redraws there is no element to draw the selection box around.
        if (node) { host.select([id]); this.startTextEdit(node); return; }
        await new Promise((res) => requestAnimationFrame(res));
      }
    } catch (err) { fail(err, 'Could not add text'); }
  }
}
