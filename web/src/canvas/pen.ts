// Pen tool and path edit mode. Plain module like edit.ts: the engine owns rendering and selection and hands in what
// we need through PenHost; every change is sent to the server (the `paste` action for a new path, the `vector`
// action for edits) and the doc event redraws the canvas.
//
// Two overlay <svg>s live above the board content, drawn in viewport pixels like the selection box:
// - the pen preview (committed segments, a dashed rubber band to the cursor, anchors and handles), and
// - the edit overlay (outline, anchors, handles, and a fat invisible stroke for click-to-add-a-point).
// The path maths (parse, insert, fit to a box...) is in path.ts, which is DOM-free and unit-tested.
import { canvasAction } from '@/api/projects';
import { toast } from '@/store/toast';
import {
  clonePath, fitToBox, insertAnchor, mapPath, moveAnchor, moveHandle, nearestOnPath, parsePath, removeAnchor, serializePath,
  setSymmetricHandles, toggleSmooth, type PathModel, type Pt,
} from './path';

export interface PenHost {
  viewport: HTMLElement;
  overlay: HTMLElement;
  projectId: string;
  zoom: () => number;
  frameRect: (boardId: string) => { left: number; top: number } | null; // board frame, viewport-relative px
  rectOf: (el: Element) => { left: number; top: number; width: number; height: number };
  findElement: (id: string) => HTMLElement | null;
  selected: () => string | null;
  select: (id: string | null) => void;
  markUserEdit: () => void;
  done: () => void;                                          // the tool finished its job: chrome goes back to Move
  addPath: (boardId: string, model: PathModel) => Promise<string | undefined>;
  selectWhenReady: (id: string) => void;
  hideSel: () => void;                                       // the selection box would sit on top of the anchors
  remove: (id: string) => void;
}

const NS = 'http://www.w3.org/2000/svg';
const CLOSE_PX = 8;  // clicking within this many screen px of the first anchor closes the path
const DRAG_PX = 3;   // a press that moves less than this is a click (corner anchor), more makes handles
const r1 = (v: number) => Math.round(v * 10) / 10;
const typing = (t: EventTarget | null) => t instanceof Element && !!t.closest('input, textarea, select, [contenteditable]');

function makeSvg(cls: string) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('class', `dc-pathsvg dc-hide ${cls}`);
  return s;
}

// One handle: a line from its anchor and a dot at its end. data-k / data-i tell the pointer handler what was grabbed.
const handleMarkup = (a: Pt, h: Pt | null, kind: 'in' | 'out', i: number) =>
  h ? `<line class="hl" x1="${r1(a.x)}" y1="${r1(a.y)}" x2="${r1(h.x)}" y2="${r1(h.y)}"/><circle class="hd" data-k="${kind}" data-i="${i}" cx="${r1(h.x)}" cy="${r1(h.y)}" r="4"/>` : '';

interface Pen { boardId: string; model: PathModel; cursor: Pt | null; dragging: boolean; ctl: AbortController }
interface Edit { id: string; pathId: string; model: PathModel; sel: number | null; appliedD: string; dragging: boolean }

export class PathTools {
  private penSvg = makeSvg('pen');
  private editSvg = makeSvg('edit');
  private pen: Pen | null = null;
  private edit: Edit | null = null;

  constructor(private host: PenHost, signal: AbortSignal) {
    host.overlay.append(this.penSvg, this.editSvg);
    // Capture phase on window: while the pen or edit mode is active these keys must not reach the editor's own
    // shortcuts (Delete would remove the whole node, Escape would select the parent).
    window.addEventListener('keydown', this.onKey, { capture: true, signal });
    host.viewport.addEventListener('dblclick', this.onDblClick, { signal });
    this.editSvg.addEventListener('pointerdown', this.onEditDown, { signal });
    this.editSvg.addEventListener('dblclick', this.onEditDbl, { signal });
    signal.addEventListener('abort', () => { this.pen?.ctl.abort(); });
  }

  get editing() { return !!this.edit; }
  get penning() { return !!this.pen; }

  redraw() { this.drawPen(); this.drawEdit(); }

  // =========================================================================================
  // Pen tool
  // =========================================================================================
  // Board px of a pointer position (the pen path is built in its board's coordinates, then fitted to an svg box).
  private boardPt(clientX: number, clientY: number, boardId: string): Pt | null {
    const f = this.host.frameRect(boardId), v = this.host.viewport.getBoundingClientRect();
    if (!f) return null;
    const k = this.host.zoom();
    return { x: (clientX - v.left - f.left) / k, y: (clientY - v.top - f.top) / k };
  }

  private boardToScreen(p: Pt, boardId: string): Pt {
    const f = this.host.frameRect(boardId) ?? { left: 0, top: 0 }, k = this.host.zoom();
    return { x: f.left + p.x * k, y: f.top + p.y * k };
  }

  // Pointer went down with the pen tool. The first press starts a path on that board; later presses add anchors or
  // close the path (press on the first anchor). Pressing and dragging pulls out symmetric handles.
  penDown(e: PointerEvent, boardId: string | undefined) {
    if (!this.pen) {
      if (!boardId) { toast('Draw inside an artboard'); return; }
      this.leaveEdit();
      const ctl = new AbortController();
      this.pen = { boardId, model: { anchors: [], closed: false }, cursor: null, dragging: false, ctl };
      const sig = { signal: ctl.signal };
      this.host.viewport.addEventListener('pointermove', this.onPenMove, sig);
      this.host.viewport.addEventListener('pointerup', this.onPenUp, sig);
    }
    const pen = this.pen;
    e.preventDefault();
    const p = this.boardPt(e.clientX, e.clientY, pen.boardId);
    if (!p) return;
    const { anchors } = pen.model;
    if (anchors.length >= 3) {
      const first = this.boardToScreen(anchors[0].p, pen.boardId), here = this.boardToScreen(p, pen.boardId);
      if (Math.hypot(first.x - here.x, first.y - here.y) < CLOSE_PX) { this.finishPen(true); return; }
    }
    anchors.push({ p, in: null, out: null });
    pen.dragging = true;
    pen.cursor = p;
    this.host.viewport.setPointerCapture?.(e.pointerId);
    this.penStart = { x: e.clientX, y: e.clientY };
    this.drawPen();
  }

  private penStart = { x: 0, y: 0 };

  private onPenMove = (e: PointerEvent) => {
    const pen = this.pen;
    if (!pen) return;
    const p = this.boardPt(e.clientX, e.clientY, pen.boardId);
    if (!p) return;
    pen.cursor = p;
    // Only a real drag makes handles; below the threshold the anchor stays a corner.
    if (pen.dragging && Math.hypot(e.clientX - this.penStart.x, e.clientY - this.penStart.y) >= DRAG_PX) {
      pen.model = setSymmetricHandles(pen.model, pen.model.anchors.length - 1, p);
    }
    this.drawPen();
  };

  private onPenUp = () => { if (this.pen) this.pen.dragging = false; this.drawPen(); };

  // Double-click ends an open path. The two presses of the double-click each added an anchor at the same spot, so
  // the duplicate goes before finishing.
  private onDblClick = (e: MouseEvent) => {
    if (this.pen) {
      const a = this.pen.model.anchors;
      if (a.length >= 2 && Math.hypot(a[a.length - 1].p.x - a[a.length - 2].p.x, a[a.length - 1].p.y - a[a.length - 2].p.y) * this.host.zoom() < CLOSE_PX) a.pop();
      this.finishPen(false);
      return;
    }
    // Double-click on the selected pen path enters edit mode.
    const sel = this.host.selected();
    if (!sel || this.edit) return;
    const hit = e.composedPath().find((n): n is SVGElement => n instanceof SVGElement && n.dataset?.pid === sel);
    if (hit && hit.getAttribute('data-shape') === 'path') this.enterEdit(sel);
  };

  // Ends the pen session. With enough anchors the path is written to the board; otherwise it is dropped.
  // `notify: false` is for a tool switch, where the chrome is already changing the tool itself.
  finishPen(close: boolean, notify = true) {
    const pen = this.pen;
    if (!pen) return;
    this.endPenSession();
    if (pen.model.anchors.length < 2) { if (notify) this.host.done(); return; }
    pen.model.closed = close;
    void this.host.addPath(pen.boardId, pen.model)
      .then((id) => { if (id) this.host.selectWhenReady(id); })
      .finally(() => { if (notify) this.host.done(); });
  }

  cancelPen(notify = true) {
    if (!this.pen) return;
    this.endPenSession();
    if (notify) this.host.done();
  }

  private endPenSession() {
    this.pen?.ctl.abort();
    this.pen = null;
    this.penSvg.classList.add('dc-hide');
  }

  // The tool changed away from the pen: keep what was drawn if it is already a path.
  toolChanged(tool: string) {
    if (tool !== 'pen' && this.pen) this.finishPen(false, false);
    if (tool !== 'move') this.leaveEdit();
  }

  private drawPen() {
    const pen = this.pen;
    if (!pen) { this.penSvg.classList.add('dc-hide'); return; }
    const toS = (p: Pt) => this.boardToScreen(p, pen.boardId);
    const screen = mapPath(pen.model, toS);
    const a = screen.anchors;
    let html = '';
    if (a.length > 1) html += `<path class="line" d="${serializePath(screen)}"/>`;
    // Rubber band: the segment the next click would add, curved if the last anchor has an out handle.
    if (pen.cursor && a.length && !pen.dragging) {
      const band: PathModel = { anchors: [{ ...a[a.length - 1], in: null }, { p: toS(pen.cursor), in: null, out: null }], closed: false };
      html += `<path class="band" d="${serializePath(band)}"/>`;
    }
    const last = a.length - 1;
    a.forEach((n, i) => {
      if (i === last) html += handleMarkup(n.p, n.in, 'in', i) + handleMarkup(n.p, n.out, 'out', i);
    });
    a.forEach((n, i) => {
      // The first anchor grows when the cursor is close enough that a click would close the path.
      const nearFirst = i === 0 && a.length >= 3 && pen.cursor && Math.hypot(n.p.x - toS(pen.cursor).x, n.p.y - toS(pen.cursor).y) < CLOSE_PX;
      const s = nearFirst ? 12 : 8;
      html += `<rect class="pt${i === last ? ' sel' : ''}" x="${r1(n.p.x - s / 2)}" y="${r1(n.p.y - s / 2)}" width="${s}" height="${s}"/>`;
    });
    this.penSvg.innerHTML = html;
    this.penSvg.classList.remove('dc-hide');
  }

  // =========================================================================================
  // Edit mode
  // =========================================================================================
  private pathEl(svg: Element) { return svg.querySelector<SVGPathElement>('path[data-pid]'); }

  // Rendered box of the svg in viewport px plus its viewBox: together they map path coordinates to the screen.
  private geom(svg: Element) {
    const rect = this.host.rectOf(svg);
    const nums = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
    const k = this.host.zoom();
    const vb = nums.length === 4 && nums.every(Number.isFinite) && nums[2] > 0 && nums[3] > 0
      ? { x: nums[0], y: nums[1], w: nums[2], h: nums[3] }
      : { x: 0, y: 0, w: rect.width / k || 1, h: rect.height / k || 1 };
    return { rect, vb };
  }

  enterEdit(id: string) {
    const svg = this.host.findElement(id);
    const path = svg && this.pathEl(svg);
    if (!svg || !path) return;
    if (svg.closest('[data-locked]')) return;
    const model = parsePath(path.getAttribute('d') ?? '');
    if (!model) { toast('This path uses arcs or several subpaths; edit its d attribute instead'); return; }
    this.edit = { id, pathId: path.dataset.pid!, model, sel: null, appliedD: path.getAttribute('d') ?? '', dragging: false };
    this.drawEdit();
  }

  leaveEdit() {
    if (!this.edit) return;
    this.edit = null;
    this.editSvg.classList.add('dc-hide');
    this.host.select(this.host.selected()); // redraws the normal selection box
  }

  // The engine tells us when the selection moved so edit mode never outlives its path.
  selectionChanged(id: string | null) { if (this.edit && this.edit.id !== id) { this.edit = null; this.editSvg.classList.add('dc-hide'); } }

  private drawEdit() {
    const ed = this.edit;
    if (!ed) { this.editSvg.classList.add('dc-hide'); return; }
    const svg = this.host.findElement(ed.id);
    const path = svg && this.pathEl(svg);
    if (!svg || !path || !svg.isConnected) { this.edit = null; this.editSvg.classList.add('dc-hide'); return; }
    // The DOM's d differs from the one we last applied when the doc event arrived (the server refitted the box) or
    // someone else changed it (undo, Claude). Re-read it then, keeping the selected anchor if it still exists.
    if (!ed.dragging) {
      const domD = path.getAttribute('d') ?? '';
      if (domD !== ed.appliedD) {
        const model = parsePath(domD);
        if (!model) { this.edit = null; this.editSvg.classList.add('dc-hide'); return; }
        ed.model = model;
        ed.appliedD = domD;
        if (ed.sel !== null && ed.sel >= model.anchors.length) ed.sel = null;
      }
    }
    const { rect, vb } = this.geom(svg);
    const sx = rect.width / vb.w, sy = rect.height / vb.h;
    const screen = mapPath(ed.model, (p) => ({ x: rect.left + (p.x - vb.x) * sx, y: rect.top + (p.y - vb.y) * sy }));
    const d = serializePath(screen);
    let html = `<path class="hit" data-k="hit" d="${d}"/><path class="line" d="${d}"/>`;
    screen.anchors.forEach((a, i) => { html += handleMarkup(a.p, a.in, 'in', i) + handleMarkup(a.p, a.out, 'out', i); });
    screen.anchors.forEach((a, i) => {
      html += `<rect class="pt${ed.sel === i ? ' sel' : ''}" data-k="a" data-i="${i}" x="${r1(a.p.x - 4)}" y="${r1(a.p.y - 4)}" width="8" height="8"/>`;
    });
    this.editSvg.innerHTML = html;
    this.editSvg.classList.remove('dc-hide');
    this.host.hideSel();
  }

  // Viewport-relative pointer position -> path (viewBox) coordinates.
  private toLocal(clientX: number, clientY: number, svg: Element): Pt {
    const { rect, vb } = this.geom(svg), v = this.host.viewport.getBoundingClientRect();
    return { x: vb.x + (clientX - v.left - rect.left) * vb.w / rect.width, y: vb.y + (clientY - v.top - rect.top) * vb.h / rect.height };
  }

  private onEditDown = (e: PointerEvent) => {
    const ed = this.edit;
    const t = e.target as SVGElement;
    const kind = t.dataset?.k;
    if (!ed || !kind || e.button !== 0) return;
    // stopPropagation: the viewport would otherwise start a pan or re-select on the same press.
    e.stopPropagation();
    e.preventDefault();
    const svg = this.host.findElement(ed.id);
    if (!svg) return;
    const start = this.toLocal(e.clientX, e.clientY, svg);
    const i = Number(t.dataset.i);
    if (kind === 'a') {
      ed.sel = i;
      const from = clonePath(ed.model), a0 = from.anchors[i].p;
      this.drag(e, svg, (p) => moveAnchor(from, i, { x: a0.x + p.x - start.x, y: a0.y + p.y - start.y }));
    } else if (kind === 'in' || kind === 'out') {
      ed.sel = i;
      const from = clonePath(ed.model);
      this.drag(e, svg, (p, ev) => moveHandle(from, i, kind, p, ev.altKey));
    } else if (kind === 'hit') {
      // Click on a segment: split it there, then keep dragging the new anchor like any other.
      const hit = nearestOnPath(ed.model, start);
      if (!hit) return;
      const { model, index } = insertAnchor(ed.model, hit.seg, hit.t);
      ed.model = model;
      ed.sel = index;
      const from = clonePath(model), a0 = from.anchors[index].p;
      this.drag(e, svg, (p) => moveAnchor(from, index, { x: a0.x + p.x - start.x, y: a0.y + p.y - start.y }), true);
    }
  };

  // Pointer drag that rewrites the model. The DOM gets the new d live (cheap, instant), the server gets one
  // `vector` action on release, so a whole drag is a single undo step. `changed` forces a commit with no movement
  // (a freshly inserted anchor).
  private drag(e: PointerEvent, svg: Element, apply: (p: Pt, ev: PointerEvent) => PathModel, changed = false) {
    const ed = this.edit!;
    const path = this.pathEl(svg);
    if (!path) return;
    const sx = e.clientX, sy = e.clientY;
    let moved = changed;
    ed.dragging = true;
    const patch = () => {
      const d = serializePath(ed.model);
      path.setAttribute('d', d);
      ed.appliedD = d;
    };
    if (changed) patch();
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_PX) return;
      moved = true;
      ed.model = apply(this.toLocal(ev.clientX, ev.clientY, svg), ev);
      patch();
      this.drawEdit();
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      ed.dragging = false;
      if (moved) this.commit(svg); else this.drawEdit();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    this.drawEdit();
  }

  // Refit the svg box to the edited path and send d, viewBox and the box together (one undo step on the server).
  private commit(svg: Element) {
    const ed = this.edit;
    if (!ed) return;
    const { rect, vb } = this.geom(svg);
    const k = this.host.zoom();
    // Path units -> design px relative to the old box origin (the box may have been resized, so the scale is not 1).
    const sx = rect.width / k / vb.w, sy = rect.height / k / vb.h;
    const px = mapPath(ed.model, (p) => ({ x: (p.x - vb.x) * sx, y: (p.y - vb.y) * sy }));
    const sw = parseFloat(svg.getAttribute('stroke-width') ?? '2') || 0;
    const fit = fitToBox(px, Math.ceil(sw / 2) + 1);
    const el = svg as unknown as HTMLElement;
    const abs = getComputedStyle(el).position === 'absolute';
    const styles: Record<string, string> = { width: `${fit.width}px`, height: `${fit.height}px` };
    if (abs) {
      styles.left = `${Math.round((parseFloat(el.style.left) || 0) + fit.dx)}px`;
      styles.top = `${Math.round((parseFloat(el.style.top) || 0) + fit.dy)}px`;
    }
    this.host.markUserEdit();
    canvasAction(this.host.projectId, 'vector', {
      edits: [{ id: ed.pathId, attrs: { d: fit.d } }, { id: ed.id, attrs: { viewBox: fit.viewBox }, styles }],
    }).catch((err) => toast((err as Error)?.message || 'Could not edit the path'));
  }

  // Corner <-> smooth on double-click of an anchor.
  private onEditDbl = (e: MouseEvent) => {
    const ed = this.edit;
    const t = e.target as SVGElement;
    e.stopPropagation();
    if (!ed || t.dataset?.k !== 'a') return;
    const svg = this.host.findElement(ed.id);
    if (!svg) return;
    ed.model = toggleSmooth(ed.model, Number(t.dataset.i));
    const path = this.pathEl(svg);
    if (path) { const d = serializePath(ed.model); path.setAttribute('d', d); ed.appliedD = d; }
    this.commit(svg);
    this.drawEdit();
  };

  // ---- Keyboard ------------------------------------------------------------------------
  private onKey = (e: KeyboardEvent) => {
    if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    // stopImmediatePropagation as well: listeners on the same target (window) are not stopped by stopPropagation alone.
    const eat = () => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
    if (this.pen) {
      if (e.key === 'Enter') { eat(); this.finishPen(false); }
      else if (e.key === 'Escape') { eat(); this.cancelPen(); }
      else if (e.key === 'Backspace' || e.key === 'Delete') {
        eat();
        const a = this.pen.model.anchors;
        a.pop();
        if (!a.length) this.cancelPen(); else this.drawPen();
      }
      return;
    }
    const ed = this.edit;
    if (ed) {
      if (e.key === 'Escape' || e.key === 'Enter') { eat(); this.leaveEdit(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && ed.sel !== null) {
        eat();
        const svg = this.host.findElement(ed.id);
        const next = removeAnchor(ed.model, ed.sel);
        // Fewer than two anchors is no path any more: remove the layer instead of leaving an invisible one.
        if (next.anchors.length < 2 || !svg) { this.host.remove(ed.id); this.leaveEdit(); return; }
        ed.model = next;
        ed.sel = null;
        const path = this.pathEl(svg);
        if (path) { const d = serializePath(next); path.setAttribute('d', d); ed.appliedD = d; }
        this.commit(svg);
        this.drawEdit();
      }
      return;
    }
    // Enter on a selected pen path starts editing it.
    if (e.key === 'Enter') {
      const sel = this.host.selected();
      const el = sel && !sel.startsWith('A') ? this.host.findElement(sel) : null;
      if (el && el.getAttribute('data-shape') === 'path') { eat(); this.enterEdit(sel!); }
    }
  };
}
