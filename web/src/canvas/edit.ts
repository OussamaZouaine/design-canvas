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
import { siblingStep, soleDescent } from './selection';
import { inEdgeBand, inferAxis, insertionIndex, insertionLine, resolveDrop, stepDrop, type Axis, type Drop } from './dragflow';
import { isNodeEl } from '@/lib/htmlTree';
import { annotate, measure as measureBoxes, resizeBox, scaleInto, snapMove, snapResize, unionOf, type Box } from './snap';
import { Guides } from './guides';
import { planUnwrap, planWrap, type FlowAxis, type Item } from './structure';

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
  selectNew: (ids: string[]) => void;         // select nodes that only exist once the doc event has redrawn (wrapper, freed children)
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
  private guides: Guides;                      // smart guides + distance pills drawn in the overlay
  private measuring = false;                   // Alt-hover measure is showing, so it must be cleared later
  private nudgePending = new Map<string, { l: number; t: number }>(); // absolute target left/top of a nudge burst
  private nudgeTimer = 0;

  constructor(private host: EditHost, signal: AbortSignal) {
    this.guides = new Guides(host.overlay, host.viewport, host.zoom);
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
    window.addEventListener('keyup', this.onKeyUp, sig);
    // A click elsewhere must not race a nudge that is still waiting to be saved.
    host.viewport.addEventListener('pointerdown', () => this.flushNudge(), { capture: true, ...sig });
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

  showHandles(targets: HTMLElement[]) {
    const sel = this.host.primary() ?? '';
    const isBoard = sel.startsWith('A');
    const locked = !isBoard && targets.some((t) => t.closest('[data-locked]'));
    // One node: all eight when it is a board or absolute, else e/s/se. Several nodes resize together inside their
    // union box, which only makes sense when every one of them is absolutely positioned.
    const free = isBoard || targets.every(isAbs);
    const allowed: readonly Dir[] = locked ? [] : free ? HANDLE_DIRS : targets.length === 1 ? ['e', 's', 'se'] : [];
    for (const [dir, el] of this.handles) el.hidden = !allowed.includes(dir);
  }

  // Resize works on the union box of the selection (for one node that is the node itself): resizeBox applies the
  // modifiers (Shift = keep ratio, Alt = from the centre), snapping nudges the moving edges, then every member is scaled
  // inside the union (scaleInto). Boards go through the same maths in world units. Snapping is skipped with Shift
  // (the ratio wins) and with Ctrl (off). One 'style' action with per-id values = one undo step on release.
  private beginResize(dir: Dir, e: PointerEvent) {
    const { host } = this;
    const sel = host.selected();
    const board = sel.length === 1 && sel[0].startsWith('A') ? host.board(sel[0]) : undefined;
    interface Sub { id: string; el: HTMLElement; abs: boolean; local: Box; rect: Box; next: Box }
    const subs: Sub[] = [];
    if (board) {
      const frame = host.findElement(board.id);
      if (!frame) return;
      const local = { x: board.x, y: board.y, w: board.width, h: board.height };
      subs.push({ id: board.id, el: frame, abs: false, local, rect: this.rbox(frame), next: local });
    } else {
      for (const id of sel) {
        const el = id.startsWith('A') ? null : host.findElement(id);
        if (!el) return; // a snapshot board or a mixed selection: nothing to resize
        const b = boxOf(el, host.zoom());
        const local = { x: b.x, y: b.y, w: b.w, h: b.h };
        subs.push({ id, el, abs: isAbs(el), local, rect: this.rbox(el), next: local });
      }
    }
    if (!subs.length) return;
    const U = unionOf(subs.map((m) => m.rect))!;
    const min = board ? 40 : 4;
    const ids = subs.map((m) => m.id);
    const cands = board
      ? host.boardsHere().filter((b) => b.id !== board.id).map((b) => host.findElement(b.id)).filter((x): x is HTMLElement => !!x).map((x) => this.rbox(x))
      : this.neighbours(ids, subs[0].el);
    const parent = board || !subs[0].el.parentElement ? null : this.rbox(subs[0].el.parentElement);
    host.viewport.setPointerCapture?.(e.pointerId);
    const sx = e.clientX, sy = e.clientY;
    const move = (ev: PointerEvent) => {
      // Screen pixels to design pixels: everything on the canvas is scaled by the zoom.
      const k = host.zoom(), dx = (ev.clientX - sx) / k, dy = (ev.clientY - sy) / k;
      let u = resizeBox(U, dir, dx, dy, { shift: ev.shiftKey, alt: ev.altKey, min });
      if (ev.ctrlKey || ev.metaKey) this.guides.clear();
      else {
        if (!ev.shiftKey) {
          const snapped = snapResize(u, dir, cands, parent, 5 / k).box;
          if (ev.altKey) {
            // From the centre: whatever the dragged edge gained by snapping, the opposite edge gains too.
            const gx = dir.includes('e') ? snapped.x + snapped.w - (u.x + u.w) : dir.includes('w') ? u.x - snapped.x : 0;
            const gy = dir.includes('s') ? snapped.y + snapped.h - (u.y + u.h) : dir.includes('n') ? u.y - snapped.y : 0;
            u = { x: u.x - gx, y: u.y - gy, w: u.w + 2 * gx, h: u.h + 2 * gy };
          } else u = snapped;
        }
        const a = annotate(u, cands, parent);
        this.guides.show(a.guides, a.guides.length ? a.pills : []);
      }
      for (const m of subs) {
        const r = scaleInto(m.rect, U, u);
        m.next = { x: m.local.x + (r.x - m.rect.x), y: m.local.y + (r.y - m.rect.y), w: r.w, h: r.h };
        const n = m.next, l = m.local, moved = (a: number, b: number) => Math.abs(a - b) > 0.01;
        if (board) {
          Object.assign(host.boardEl(board.id)!.style, { left: n.x + 'px', top: n.y + 'px', width: n.w + 'px', height: n.h + 'px' });
          continue;
        }
        if (moved(n.w, l.w)) m.el.style.width = n.w + 'px';
        if (moved(n.h, l.h)) m.el.style.height = n.h + 'px';
        if (m.abs && moved(n.x, l.x)) m.el.style.left = n.x + 'px';
        if (m.abs && moved(n.y, l.y)) m.el.style.top = n.y + 'px';
      }
      host.redraw(); // also refreshes the live W x H pill under the box
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      this.guides.clear();
      host.markUserEdit();
      const r = Math.round;
      if (board) {
        const n = subs[0].next, l = subs[0].local;
        if (r(n.w) !== r(l.w) || r(n.h) !== r(l.h)) canvasAction(host.projectId, 'resize', { id: board.id, width: r(n.w), height: r(n.h) }).catch((err) => fail(err, 'Could not resize'));
        if (r(n.x) !== r(l.x) || r(n.y) !== r(l.y)) canvasAction(host.projectId, 'move', { id: board.id, x: r(n.x), y: r(n.y) }).catch((err) => fail(err, 'Could not move'));
        return;
      }
      const perId: Record<string, Record<string, string>> = {};
      for (const m of subs) {
        const n = m.next, l = m.local, st: Record<string, string> = {};
        if (r(n.w) !== r(l.w)) st.width = `${r(n.w)}px`;
        if (r(n.h) !== r(l.h)) st.height = `${r(n.h)}px`;
        if (m.abs && r(n.x) !== r(l.x)) st.left = `${r(n.x)}px`;
        if (m.abs && r(n.y) !== r(l.y)) st.top = `${r(n.y)}px`;
        if (Object.keys(st).length) perId[m.id] = st;
      }
      if (Object.keys(perId).length) canvasAction(host.projectId, 'style', { ids: Object.keys(perId), perId }).catch((err) => fail(err, 'Could not resize'));
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  // Box of an element in the snap space: client px divided by the zoom, so nodes and boards compare directly.
  private rbox(el: Element): Box {
    const r = el.getBoundingClientRect(), k = this.host.zoom();
    return { x: r.left / k, y: r.top / k, w: r.width / k, h: r.height / k };
  }

  // Snap candidates for a node move / resize: the visible siblings of `el` that are not themselves being moved.
  private neighbours(movingIds: string[], el: HTMLElement): Box[] {
    const { host } = this;
    return host.siblingsOf(movingIds[0])
      .filter((s) => !movingIds.includes(s))
      .map((s) => host.findElement(s))
      .filter((n): n is HTMLElement => !!n && n !== el && !n.hasAttribute('hidden') && getComputedStyle(n).display !== 'none')
      .map((n) => this.rbox(n))
      .filter((b) => b.w > 0 || b.h > 0);
  }

  // ---- Dragging --------------------------------------------------------------------
  // Generic pointer drag. `scale` converts screen px into the unit being moved: boards live in world
  // units (divide by zoom). Pointer capture keeps the drag alive when the cursor leaves the viewport.
  private startDrag(e: PointerEvent, onMove: (dx: number, dy: number, ev: PointerEvent) => void, onEnd: () => void, scale: number) {
    const { viewport } = this.host;
    const sx = e.clientX, sy = e.clientY;
    viewport.classList.add('panning');
    viewport.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => onMove((ev.clientX - sx) / scale, (ev.clientY - sy) / scale, ev);
    const up = () => {
      viewport.classList.remove('panning');
      viewport.removeEventListener('pointermove', move);
      viewport.removeEventListener('pointerup', up);
      onEnd();
    };
    viewport.addEventListener('pointermove', move);
    viewport.addEventListener('pointerup', up);
  }

  // Snap a moving box (client px / zoom space) against candidates and draw the guides. Ctrl switches snapping off,
  // Shift locks to one axis (`lock` names the axis that must not move). Distances only show once something lines up,
  // otherwise the pills would flicker on every pointer move.
  private snapBox(box: Box, cands: Box[], parent: Box | null, ev: PointerEvent, lock: { x?: boolean; y?: boolean }) {
    if (ev.ctrlKey || ev.metaKey) { this.guides.clear(); return { dx: 0, dy: 0 }; }
    const r = snapMove(box, cands, parent, 5 / this.host.zoom(), lock);
    this.guides.show(r.guides, r.guides.length || r.pills.some((p) => p.equal) ? r.pills : []);
    return r;
  }

  // Shift: keep only the axis the pointer has travelled furthest on.
  private lockAxis(dx: number, dy: number, shift: boolean) {
    if (!shift) return { dx, dy, lock: {} as { x?: boolean; y?: boolean } };
    return Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0, lock: { y: true } } : { dx: 0, dy, lock: { x: true } };
  }

  // Drag an artboard by its label; it snaps to the other boards on the page.
  dragBoard(e: PointerEvent, id: string) {
    const { host } = this;
    const ab = host.board(id), el = host.boardEl(id), frame = host.findElement(id);
    if (!ab || !el || !frame) return;
    const start = this.rbox(frame);
    const cands = host.boardsHere().filter((b) => b.id !== id).map((b) => host.findElement(b.id)).filter((x): x is HTMLElement => !!x).map((x) => this.rbox(x));
    let x = ab.x, y = ab.y;
    this.startDrag(e, (rawX, rawY, ev) => {
      const l = this.lockAxis(rawX, rawY, ev.shiftKey);
      const s = this.snapBox({ ...start, x: start.x + l.dx, y: start.y + l.dy }, cands, null, ev, l.lock);
      x = ab.x + l.dx + s.dx; y = ab.y + l.dy + s.dy;
      el.style.left = x + 'px'; el.style.top = y + 'px';
      host.redraw();
    }, () => {
      this.guides.clear();
      if (x === ab.x && y === ab.y) return;
      canvasAction(host.projectId, 'move', { id, x: Math.round(x), y: Math.round(y) }).catch((err) => fail(err, 'Could not move'));
    }, host.zoom());
  }

  // Drag a node. Absolutely positioned nodes move freely (left / top): the whole selection moves together when the
  // pressed node is part of it, with snapping to siblings and the parent. A node that flows with its siblings is
  // reordered or reparented (dragFlow). A drag under 3 px counts as a click. Returns false when the node cannot be
  // dragged (locked), so the caller treats it as a click.
  dragNode(e: PointerEvent, el: HTMLElement) {
    const { host } = this;
    if (el.closest('[data-locked]')) return false;
    if (!isAbs(el)) { this.dragFlow(e, el); return true; }
    const id = el.dataset.pid!;
    const picked = host.selected().includes(id) ? host.selected() : [id];
    // Only absolute, unlocked nodes can move freely; flow members of a mixed selection stay where they are.
    const items = picked.filter((m) => !m.startsWith('A')).map((m) => host.findElement(m))
      .filter((m): m is HTMLElement => !!m && isAbs(m) && !m.closest('[data-locked]'))
      .map((m) => ({ el: m, id: m.dataset.pid!, ...boxOf(m, host.zoom()) }));
    if (!items.length) return false;
    const start = unionOf(items.map((i) => this.rbox(i.el)))!;
    const cands = this.neighbours(items.map((i) => i.id), el);
    const parent = el.parentElement ? this.rbox(el.parentElement) : null;
    let moved = false, mx = 0, my = 0;
    this.startDrag(e, (rawX, rawY, ev) => {
      if (!moved && Math.hypot(rawX, rawY) * host.zoom() < 3) return;
      moved = true;
      const l = this.lockAxis(rawX, rawY, ev.shiftKey);
      const s = this.snapBox({ ...start, x: start.x + l.dx, y: start.y + l.dy }, cands, parent, ev, l.lock);
      mx = l.dx + s.dx; my = l.dy + s.dy;
      for (const i of items) { i.el.style.left = `${i.x + mx}px`; i.el.style.top = `${i.y + my}px`; }
      host.redraw();
    }, () => {
      this.guides.clear();
      if (!moved) return;
      host.markUserEdit();
      // One 'style' action with a value per node = one undo step for the whole drag.
      const perId: Record<string, Record<string, string>> = {};
      for (const i of items) perId[i.id] = { left: `${Math.round(i.x + mx)}px`, top: `${Math.round(i.y + my)}px` };
      canvasAction(host.projectId, 'style', { ids: items.map((i) => i.id), perId }).catch((err) => fail(err, 'Could not move'));
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
    const line = document.createElement('div'), outline = document.createElement('div'), hints = document.createElement('div');
    hints.className = 'dc-hints';
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
      host.overlay.append(hints, line, outline);
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
      this.drawHints(hints, cur.el, kids.filter((kid) => !moving.includes(kid)), axis, vp);
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
      ghosts.forEach((g) => g.remove()); line.remove(); outline.remove(); hints.remove();
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

  // Figma's auto-layout overlay while dragging in flow: the container's outline, a dashed outline on each sibling, and
  // shaded padding and gaps so the user sees what the drop will respect. Rebuilt on every move (a handful of
  // elements, capped at 40 siblings); screen px, like the rest of the overlay. Purely visual, never hit-tested.
  private drawHints(layer: HTMLElement, container: HTMLElement, sibs: HTMLElement[], axis: Axis, vp: DOMRect) {
    const k = this.host.zoom(), cs = getComputedStyle(container), r = container.getBoundingClientRect();
    const add = (cls: string, x: number, y: number, w: number, h: number) => {
      if (w <= 0 || h <= 0) return;
      const i = document.createElement('i');
      i.className = cls;
      Object.assign(i.style, { left: x - vp.left + 'px', top: y - vp.top + 'px', width: w + 'px', height: h + 'px' });
      layer.append(i);
    };
    layer.replaceChildren();
    add('dc-hint-box', r.left, r.top, r.width, r.height);
    // Padding = the frame between the outer box and the content box (a border is left out on purpose: it is not drawn as padding).
    const pt = (parseFloat(cs.paddingTop) || 0) * k, pb = (parseFloat(cs.paddingBottom) || 0) * k;
    const pl = (parseFloat(cs.paddingLeft) || 0) * k, pr = (parseFloat(cs.paddingRight) || 0) * k;
    const innerH = r.height - pt - pb;
    add('dc-hint-pad', r.left, r.top, r.width, pt);
    add('dc-hint-pad', r.left, r.bottom - pb, r.width, pb);
    add('dc-hint-pad', r.left, r.top + pt, pl, innerH);
    add('dc-hint-pad', r.right - pr, r.top + pt, pr, innerH);
    const rects = sibs.slice(0, 40).map((n) => n.getBoundingClientRect());
    rects.forEach((q) => add('dc-hint-sib', q.left, q.top, q.width, q.height));
    // Gaps between neighbours along the axis (a wrapping 'flow' layout has no single gap direction, so it shows none).
    if (axis === 'flow') return;
    for (let i = 1; i < rects.length; i++) {
      const p = rects[i - 1], n = rects[i];
      if (axis === 'y') add('dc-hint-gap', r.left + pl, p.bottom, r.width - pl - pr, n.top - p.bottom);
      else add('dc-hint-gap', p.right, r.top + pt, n.left - p.right, innerH);
    }
  }

  // Arrow keys reorder the selection along the parent's axis (left/up = earlier). Returns true when the key was ours.
  private arrowReorder(e: KeyboardEvent): boolean {
    const { host } = this;
    const ids = host.selected();
    if (!ids.length || ids.some((i) => i.startsWith('A'))) return false;
    const parent = host.parentOf(ids[0]);
    if (!parent || ids.some((i) => host.parentOf(i) !== parent)) return false;
    // Absolute nodes are left alone: arrows nudge them instead (see nudge).
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
    } else if (e.key.startsWith('Arrow') && !mod && !e.altKey && sel.length && (this.nudge(e) || this.arrowReorder(e))) {
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
        // ...past sole-child wrappers, like a double-click does (Shift+Enter still steps out one real level at a time).
        const kids = sel.flatMap((id) => host.childrenOf(soleDescent(id, host.childrenOf)));
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
      this.flushNudge(); // an unsaved nudge must land before the undo, or it would undo the wrong step
      host.markUserEdit();
      canvasAction(host.projectId, key === 'y' || e.shiftKey ? 'redo' : 'undo').catch((err) => fail(err, 'Nothing to do'));
    } else if (mod && (key === 'c' || key === 'x') && nodes.length && !getSelection()?.toString()) {
      this.copy(nodes);
      if (key === 'x') this.remove(nodes);
    } else if (mod && key === 'g' && nodes.length) {
      // Ctrl+G groups, Ctrl+Shift+G / Ctrl+Alt+G ungroups (the browser's own Ctrl+Shift+G is find-previous).
      e.preventDefault();
      if (e.shiftKey || e.altKey) void this.unwrap(nodes);
      else void this.wrap(nodes, 'group');
    } else if (!mod && !e.altKey && e.shiftKey && key === 'a' && nodes.length) {
      e.preventDefault();
      void this.wrap(nodes, 'auto');
    } else if (mod && key === 'd' && sel.length) {
      e.preventDefault();
      this.duplicate(sel);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.key.startsWith('Arrow')) this.flushNudge();
    if (e.key === 'Alt') this.endMeasure();
  };

  // Arrow keys move the selected absolute nodes: 1 px, Shift 10 px. The preview is written straight to the elements
  // and the save is deferred, so a held key (key-repeat fires many keydowns) is ONE style action = one undo step.
  // It is sent on key release; the timer is only a fallback for a lost keyup. Returns true when the key was ours.
  private nudge(e: KeyboardEvent): boolean {
    const { host } = this;
    const sel = host.selected();
    const els = sel.map((id) => (id.startsWith('A') ? null : host.findElement(id)));
    if (els.some((el) => !el || !isAbs(el) || el.closest('[data-locked]'))) return false;
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    sel.forEach((id, i) => {
      const el = els[i]!;
      // Continue from the pending target, not from the element, so rounding never drifts during a burst.
      const b = boxOf(el, host.zoom());
      const cur = this.nudgePending.get(id) ?? { l: b.x, t: b.y };
      const next = { l: cur.l + dx, t: cur.t + dy };
      this.nudgePending.set(id, next);
      el.style.left = `${next.l}px`; el.style.top = `${next.t}px`;
    });
    host.redraw();
    window.clearTimeout(this.nudgeTimer);
    this.nudgeTimer = window.setTimeout(() => this.flushNudge(), 700);
    return true;
  }

  flushNudge() {
    window.clearTimeout(this.nudgeTimer);
    if (!this.nudgePending.size) return;
    const perId: Record<string, Record<string, string>> = {};
    for (const [id, p] of this.nudgePending) perId[id] = { left: `${Math.round(p.l)}px`, top: `${Math.round(p.t)}px` };
    this.nudgePending.clear();
    this.host.markUserEdit();
    canvasAction(this.host.projectId, 'style', { ids: Object.keys(perId), perId }).catch((err) => fail(err, 'Could not move'));
  }

  // Alt + hover: distances from the selection to the hovered node (or its parent's edges when it contains the
  // selection). `id` null clears. Only draws; nothing is changed.
  measure(id: string | null) {
    const { host } = this;
    const els = host.selected().map((s) => host.findElement(s));
    const target = id ? host.findElement(id) : null;
    if (!target || els.some((el) => !el) || els.some((el) => el === target || el!.contains(target))) { this.endMeasure(); return; }
    const a = unionOf(els.map((el) => this.rbox(el!)))!;
    this.guides.show([], measureBoxes(a, this.rbox(target)));
    this.measuring = true;
  }

  endMeasure() { if (this.measuring) { this.measuring = false; this.guides.clear(); } }

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

  // ---- Group / ungroup / add auto layout -------------------------------------------------------
  // The browser measures (boxes need real layout), structure.ts decides the styles, the server wraps in ONE undo step.
  // Selects the new wrapper once it exists; resolves to its id, or undefined when nothing was done.
  async wrap(ids: string[], mode: 'group' | 'auto'): Promise<string | undefined> {
    const { host } = this;
    const els = ids.map((id) => host.findElement(id));
    if (!ids.length || els.some((el) => !el)) { toast('Zoom in to group: this board is only a picture right now'); return; }
    const nodes = els as HTMLElement[];
    if (nodes.some((n) => n.closest('[data-locked]'))) { toast('Locked layers cannot be grouped'); return; }
    if (new Set(ids.map((i) => host.parentOf(i))).size > 1) { toast('Select layers with the same parent to group them'); return; }
    // Document order, because the wrapper keeps the DOM order and the axis guess reads the boxes in that order.
    nodes.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const k = host.zoom();
    const items: Item[] = nodes.map((n) => ({ id: n.dataset.pid!, box: boxOf(n, k), abs: isAbs(n) }));
    const parent = nodes[0].parentElement;
    const hint = parent && getComputedStyle(parent).flexDirection.startsWith('row') ? 'x' : 'y';
    const axis: FlowAxis = inferAxis(items.map(({ box }) => ({ left: box.x, top: box.y, width: box.w, height: box.h })), hint);
    const plan = planWrap(items, mode, axis);
    if (!plan) { toast('Group flow and absolute layers separately'); return; }
    host.markUserEdit();
    try {
      const r = await canvasAction(host.projectId, 'wrap', { ids: items.map((i) => i.id), styles: plan.styles, perId: plan.perId, name: mode === 'auto' ? 'Auto layout' : 'Group' });
      const id = (r.result as { id?: string } | undefined)?.id;
      if (id) host.selectNew([id]);
      return id;
    } catch (err) { fail(err, 'Could not group'); }
  }

  // Ungroup one node: its children take its place. Absolute children are re-based so they stay where they are.
  async unwrap(ids: string[]): Promise<string[] | undefined> {
    const { host } = this;
    if (ids.length !== 1) { toast('Ungroup works on one layer at a time'); return; }
    const el = host.findElement(ids[0]);
    if (!el) { toast('Zoom in to ungroup: this board is only a picture right now'); return; }
    const kids = host.childrenOf(ids[0]).map((c) => host.findElement(c)).filter((c): c is HTMLElement => !!c);
    if (!kids.length) { toast('Nothing inside to ungroup'); return; }
    if (el.closest('[data-locked]')) { toast('Locked layers cannot be ungrouped'); return; }
    const k = host.zoom(), w = boxOf(el, k);
    const perId = planUnwrap({ abs: isAbs(el), x: w.x, y: w.y }, kids.map((c) => { const b = boxOf(c, k); return { id: c.dataset.pid!, abs: isAbs(c), x: b.x, y: b.y }; }));
    host.markUserEdit();
    try {
      const r = await canvasAction(host.projectId, 'unwrap', { id: ids[0], perId });
      const freed = (r.result as { ids?: string[] } | undefined)?.ids;
      if (freed?.length) host.selectNew(freed);
      return freed;
    } catch (err) { fail(err, 'Could not ungroup'); }
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
