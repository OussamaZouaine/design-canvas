// Imperative canvas engine (port of the render half of public/app.js).
// React never renders artboard HTML: it only owns the chrome around the canvas. This class owns the
// DOM inside the viewport element it is given, so none of React's rules (or the compiler) apply here.
//
// Structure inside the viewport:
//   .dc-world      one element carrying the pan/zoom transform; artboards are absolutely placed inside it
//   .dc-overlay    selection / hover / "Claude is working here" boxes, in screen pixels (never scaled)
import { canvasAction } from '@/api/projects';
import { isNodeEl } from '@/lib/htmlTree';
import { PathTools } from './pen';
import { toast } from '@/store/toast';
import type { Artboard, DocData, Page, ProjectFont } from '@/api/types';
import { hashStr, rasterizeCanvas, thumbGet, thumbPut } from './raster';
import { CanvasEditor } from './edit';
import { measureBoard, pickRect, type RectEntry } from './rects';
import { fontsSignature, setProjectFonts } from './fonts';
import { BOARD_CSS, boardRoot, boardRootStyle } from './contract';
import type { ReplyHost } from './replies';

// ---- Tunables (see "Level of detail" below) -------------------------------------------
const LIVE_K = 0.3;          // below this zoom a board is drawn from its snapshot
const MOUNT_MARGIN = 500;    // screen px around the viewport inside which boards get mounted
const UNMOUNT_MARGIN = 1600; // boards only unmount well past that, so small back-and-forth pans don't thrash
const MIN_K = 0.05, MAX_K = 4;

export interface EngineEvents {
  onZoom: (k: number) => void;
  onSelect: (id: string | null) => void;
  // Claude is writing to a board (name) or has stopped (null): drives the header pill.
  onLive: (live: { id: string; name: string } | null) => void;
  // The visible page changed (user switched, a page was deleted, or Claude drew on another one).
  onPage: (id: string) => void;
  // Pan/zoom/render settled (rAF-coalesced): comment pins re-measure their elements here.
  onView: () => void;
  // Comment mode click: the node (or artboard) id under the pointer, plus where the click landed.
  onCommentPick: (targetId: string, x: number, y: number) => void;
  // A drawing tool finished its one job (frame drawn, text added): chrome switches back to Move.
  onToolDone: () => void;
  // Right-click: viewport coordinates plus the node (or artboard) under the pointer, null on empty space.
  onContextMenu: (x: number, y: number, targetId: string | null) => void;
}

export type CanvasTool = 'move' | 'frame' | 'rect' | 'ellipse' | 'line' | 'pen' | 'text' | 'image' | 'comment' | 'hand';

// Everything the engine tracks per artboard. Kept in one object instead of expando properties on the DOM.
interface Board {
  ab: Artboard;
  el: HTMLDivElement;
  frame: HTMLDivElement;
  shadow: ShadowRoot;
  img: HTMLImageElement;
  labelName: HTMLElement;
  lodName: HTMLElement;
  html: string | null;      // HTML last handed to us (even if not mounted)
  shown: string | null;     // HTML currently inside the shadow root; null = unmounted (level of detail)
  oldHtml: string;          // what was shown before the last mount, to diff for the reveal animation
  hash: string | null;      // cache key of html + theme
  thumbKey: string | null;  // key of the snapshot currently displayed
  thumbReady: boolean;
  pinUntil: number;         // Claude drew here recently: keep it mounted until this time
  index: RectEntry[] | null; // node boxes for picking while only the snapshot is drawn (see rects.ts)
  indexKey: string;         // html + theme the index was measured from; a mismatch means re-measure
  genTimer?: number;
  thumbTimer?: number;
}

export const pagesOf = (doc: DocData | null): Page[] => (doc?.pages?.length ? doc.pages : [{ id: 'P1', name: 'Page 1' }]);
export const pageOfBoard = (doc: DocData, ab: Artboard) => ab.page ?? pagesOf(doc)[0].id;

const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };

function div(cls: string, ...kids: (Node | string)[]) {
  const el = document.createElement('div');
  el.className = cls;
  el.append(...kids);
  return el;
}

export class CanvasEngine {
  private world = div('dc-world');
  private overlay = div('dc-overlay');
  private selBox = div('dc-sel dc-hide');
  private hoverBox = div('dc-hover dc-hide');
  private agentHost = div('dc-agent');
  private claimHost = div('dc-claims'); // coloured outlines of boards an agent claimed (soft claims, see src/claims.mjs)
  private claims: { board: string; agent: { id: string; name: string; color: string } }[] = [];
  private boards = new Map<string, Board>();
  private pidIndex = new Map<string, string>(); // node id (data-pid) -> artboard id, so lookups never scan every shadow root

  private doc: DocData = { counter: 0, artboards: [] };
  private view = { x: 80, y: 90, k: 0.5 };
  private selected: string | null = null;
  private hoverId: string | null = null;
  private agentIds: string[] = [];
  private agent: { id: string; name: string; color: string } | null = null; // who wrote them (tints boxes + ring)
  private followAgent: string | null = null; // null = follow whoever writes
  private activePage: string | null;
  private pendingPage: string | null = null;
  private themeMode = 'base'; // a view setting, not saved in the doc
  private appliedTheme = '';
  private firstDoc = true; // the first load must not animate (it would flash)
  private userEditUntil = 0;
  private lastTouch = 0;   // last user pan/zoom/click; the follow camera and snapshot queue back off after it
  private follow = lsGet('dc-follow') !== '0';
  private liveBoard: Board | null = null;
  private viewRaf = 0;
  private glideT?: number;
  private followAt = 0;
  private reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private abort = new AbortController(); // one signal removes every listener on destroy
  private editor: CanvasEditor;
  private paths: PathTools; // pen tool + path edit mode
  private commentMode = false;
  private tool: CanvasTool = 'move';
  private spaceDown = false;  // holding Space turns any tool into a temporary hand
  private draft = div('dc-draft dc-hide'); // rubber-band rectangle while the frame tool drags
  private sizeLabel = div('dc-size');      // "W x H" pill under the selection
  private fitPending = false; // fit() was asked for before the viewport had a size

  constructor(private viewport: HTMLElement, private projectId: string, private events: EngineEvents) {
    this.activePage = lsGet(`dc-page:${projectId}`);
    this.overlay.append(this.claimHost, this.agentHost, this.hoverBox, this.selBox, this.draft);
    this.selBox.append(this.sizeLabel);
    viewport.append(this.world, this.overlay);
    this.applyView();

    const sig = { signal: this.abort.signal };
    this.editor = new CanvasEditor({
      viewport,
      projectId,
      selBox: this.selBox,
      zoom: () => this.view.k,
      selected: () => this.selected,
      select: (id) => this.select(id),
      board: (id) => this.doc.artboards.find((a) => a.id === id),
      boardsHere: () => this.boardsHere(),
      boardEl: (id) => this.boards.get(id)?.el,
      findElement: (id) => this.findElement(id),
      boardOf: (id) => this.pidIndex.get(id),
      redraw: () => this.drawSelection(),
      markUserEdit: () => this.markUserEdit(),
      activePage: () => this.activePage,
    }, this.abort.signal);
    this.paths = new PathTools({
      viewport,
      overlay: this.overlay,
      projectId,
      zoom: () => this.view.k,
      frameRect: (id) => { const b = this.boards.get(id); return b ? this.relRect(b.frame) : null; },
      rectOf: (el) => this.relRect(el),
      findElement: (id) => this.findElement(id),
      selected: () => this.selected,
      select: (id) => this.select(id),
      markUserEdit: () => this.markUserEdit(),
      done: () => this.events.onToolDone(),
      addPath: (boardId, model) => this.editor.addPath(boardId, model),
      selectWhenReady: (id) => this.selectWhenReady(id),
      hideSel: () => this.selBox.classList.add('dc-hide'),
      remove: (id) => this.editor.remove(id),
    }, this.abort.signal);
    // Remember when the user last touched the canvas; capture phase so nothing can stop it first.
    for (const type of ['pointerdown', 'wheel']) viewport.addEventListener(type, () => { this.lastTouch = Date.now(); }, { capture: true, passive: true, ...sig });
    viewport.addEventListener('wheel', this.onWheel, { passive: false, ...sig });
    viewport.addEventListener('pointerdown', this.onPointerDown, sig);
    viewport.addEventListener('pointermove', this.onPointerMove, { passive: true, ...sig });
    viewport.addEventListener('contextmenu', this.onContextMenu, sig);
    window.addEventListener('keydown', this.onSpace, sig);
    window.addEventListener('keyup', this.onSpace, sig);
    window.addEventListener('blur', () => this.setSpace(false), sig);
    // The camera glide is a CSS transition, so no JS runs while it moves: overlay boxes measured at its
    // start would be left behind. Redraw them when it finishes.
    this.world.addEventListener('transitionend', (e) => { if (e.target === this.world) this.afterView(); }, sig);
    // Resizing the viewport (panels opening) changes which boards are near the screen.
    const ro = new ResizeObserver(() => { if (this.fitPending) this.fit(); this.scheduleAfterView(); });
    ro.observe(viewport);
    this.abort.signal.addEventListener('abort', () => ro.disconnect());
  }

  destroy() {
    this.abort.abort();
    cancelAnimationFrame(this.viewRaf);
    clearTimeout(this.glideT);
    for (const b of this.boards.values()) { clearTimeout(b.genTimer); clearTimeout(b.thumbTimer); }
    this.thumbQueue.clear();
    this.world.remove();
    this.overlay.remove();
    this.boards.clear();
  }

  // ---- Public API -----------------------------------------------------------------
  setFollow(on: boolean) { this.follow = on; lsSet('dc-follow', on ? '1' : '0'); }

  // Doc changes arriving shortly after this came from the user's own edit: no "Claude is designing" effects.
  markUserEdit() { this.userEditUntil = Date.now() + 1500; }

  // Highlight boxes for the nodes an agent touched. `agent` tints them and the comet ring in that agent's colour; it
  // is kept after the highlight clears so the ring that is still fading does not flip back to violet.
  setAgentIds(ids: string[], agent?: { id: string; name: string; color: string } | null) {
    if (agent) {
      this.agent = agent;
      this.viewport.style.setProperty('--dc-glow-a', agent.color);
      this.viewport.style.setProperty('--dc-glow-b', agent.color);
    }
    this.agentIds = ids;
    this.drawAgent();
  }
  // Boards an agent claimed in the last ~60 s (server pushes the list, also when a claim lapses).
  setClaims(claims: { board: string; agent: { id: string; name: string; color: string } }[]) {
    this.claims = claims;
    this.drawClaims();
  }
  // Follow camera: only glide for writes by this agent (null = anyone). The doc delta that triggers a glide
  // arrives just before the `agent` event naming its author, so the check uses the previous author for the
  // first write after a switch; it is correct from the second write on.
  setFollowAgent(id: string | null) { this.followAgent = id; }
  setHover(id: string | null) { this.hoverId = id; this.drawHover(); }
  setThemeMode(mode: string) { this.themeMode = mode; this.applyTheme(); }

  getActivePage() { return this.activePage; }

  // Comment mode: a click pins a comment instead of selecting (see onPointerDown).
  setCommentMode(on: boolean) {
    this.commentMode = on;
    this.viewport.classList.toggle('commenting', on);
    if (on) this.select(null);
  }

  // Active toolbar tool. Comment mode keeps its own switch (the comments layer owns that flow).
  setTool(tool: CanvasTool) {
    this.tool = tool;
    this.viewport.dataset.tool = tool;
    this.paths.toolChanged(tool);
    if (tool !== 'move' && tool !== 'comment') this.select(null);
  }

  // Menu / toolbar actions that need the editor.
  duplicate(id: string) { this.editor.duplicate(id); }
  remove(id: string) { this.editor.remove(id); }
  copy(id: string) { this.editor.copy(id); }
  paste() { this.editor.pasteNode(); }
  get canPaste() { return this.editor.canPaste; }
  addImageFile(file: File) { return this.editor.addReferenceFile(file); }
  selectNode(id: string | null) { this.select(id); }
  parentOf(id: string) {
    if (id.startsWith('A')) return null;
    return this.findElement(id)?.parentElement?.closest<HTMLElement>('[data-pid]')?.dataset.pid ?? this.pidIndex.get(id) ?? null;
  }

  // Space held = temporary hand tool (Figma/Paper habit). Ignored while typing.
  private onSpace = (e: KeyboardEvent) => {
    if (e.code !== 'Space') return;
    if (e.type === 'keydown' && e.target instanceof Element && e.target.closest('input, textarea, select, button, [contenteditable]')) return;
    if (e.type === 'keydown') e.preventDefault(); // otherwise the page scrolls
    this.setSpace(e.type === 'keydown');
  };

  private setSpace(on: boolean) {
    this.spaceDown = on;
    this.viewport.classList.toggle('space-pan', on);
  }

  // Zoom in about the viewport centre (used before jumping to a comment from the zoomed-out overview,
  // so the pin is readable). Only ever zooms in, never out.
  ensureZoom(k: number) {
    if (this.view.k >= k) return;
    this.zoomAt(this.viewport.clientWidth / 2, this.viewport.clientHeight / 2, k);
    this.applyView();
  }

  // Viewport-relative box of a node that is currently drawn, else null (unmounted board / removed node).
  rectOf(id: string) {
    const el = this.findElement(id);
    if (!el) return this.indexRect(id);
    const r = this.relRect(el);
    return r.width || r.height ? r : null;
  }

  // ---- Picking on snapshot boards ---------------------------------------------------
  // A zoomed-out board is a bitmap, so there is no element under the cursor. We hit-test the board's
  // measured rect index instead (rects.ts). Live boards keep using the real DOM, which is exact.
  private boardIndex(b: Board): RectEntry[] {
    const key = (b.html ?? '') + '\u0000' + this.themeDecls() + '\u0000' + fontsSignature(); // a web font changes line breaks
    if (!b.index || b.indexKey !== key) {
      b.index = measureBoard(b.html ?? '', b.ab.width, b.ab.height, this.themeDecls(), b.ab.heightMode === 'fit');
      b.indexKey = key;
    }
    return b.index;
  }

  // Node id under a viewport point, from the index of the (unmounted) board there; null when it is a live board or empty.
  private pickAt(clientX: number, clientY: number): string | null {
    const v = this.viewport.getBoundingClientRect(), { x, y, k } = this.view;
    const wx = (clientX - v.left - x) / k, wy = (clientY - v.top - y) / k;
    for (const b of this.boards.values()) {
      const { ab } = b;
      if (b.shown != null || !this.inPage(ab) || !b.html) continue;
      if (wx < ab.x || wy < ab.y || wx > ab.x + ab.width || wy > ab.y + ab.height) continue;
      return pickRect(this.boardIndex(b), wx - ab.x, wy - ab.y, k)?.pid ?? null;
    }
    return null;
  }

  // Viewport-relative box of a node on an unmounted board, from the index. Null if the board is live or the node is unknown.
  private indexRect(id: string) {
    const b = this.boards.get(this.pidIndex.get(id) ?? '');
    if (!b || b.shown != null || !b.html) return null;
    const e = this.boardIndex(b).find((n) => n.pid === id);
    if (!e) return null;
    const { x, y, k } = this.view;
    return { left: x + (b.ab.x + e.x) * k, top: y + (b.ab.y + e.y) * k, width: e.w * k, height: e.h * k };
  }

  // Artboard id that owns a node id (panels use it to find the node's HTML without scanning every board).
  boardOf(id: string) { return this.pidIndex.get(id); }

  // Header / toolbar "new artboard".
  createArtboard() { return this.editor.createArtboard(); }

  // Switch pages. `fitView` is false when the switch is automatic (Claude drew on another page).
  setPage(id: string, { fitView = true } = {}) {
    if (id === this.activePage) return;
    this.activePage = id;
    lsSet(`dc-page:${this.projectId}`, id);
    this.select(null);
    this.events.onPage(id);
    this.syncPage();
    if (fitView) this.fit();
  }

  // A page was just created: switch to it as soon as a doc that contains it arrives.
  setPageWhenReady(id: string) {
    if (pagesOf(this.doc).some((p) => p.id === id)) this.setPage(id);
    else this.pendingPage = id;
  }

  select(id: string | null) {
    this.selected = id;
    this.paths.selectionChanged(id);
    this.events.onSelect(id);
    canvasAction(this.projectId, 'selection', { ids: id ? [id] : [] }).catch(() => {}); // lets Claude's get_selection see it
    this.drawSelection();
    for (const b of this.boards.values()) b.el.querySelector('.dc-label')?.classList.toggle('sel', b.ab.id === id);
  }

  // Read-only copy of the camera (screen = world * k + x/y). The rulers use it; they must not mutate the engine's own object.
  getView() { return { ...this.view }; }

  // Zoom/pan so every artboard on the page is visible.
  fit() {
    const here = this.boardsHere();
    if (!here.length) return;
    const minX = Math.min(...here.map((a) => a.x));
    const minY = Math.min(...here.map((a) => a.y)) - 30; // room for the labels above the boards
    const maxX = Math.max(...here.map((a) => a.x + a.width));
    const maxY = Math.max(...here.map((a) => a.y + a.height));
    const w = this.viewport.clientWidth, h = this.viewport.clientHeight;
    // A viewport that is not laid out yet (hidden pane, first paint) would give a negative zoom. Wait for the
    // ResizeObserver to report a real size, then fit.
    if (w < 200 || h < 200) { this.fitPending = true; return; }
    this.fitPending = false;
    this.view.k = Math.min(1, Math.max(MIN_K, Math.min((w - 80) / (maxX - minX), (h - 80) / (maxY - minY))));
    this.view.x = (w - (maxX - minX) * this.view.k) / 2 - minX * this.view.k;
    this.view.y = (h - (maxY - minY) * this.view.k) / 2 - minY * this.view.k;
    this.applyView();
  }

  // Zoom around the viewport centre (zoom buttons / shortcuts). Animated: it is a deliberate action.
  zoomBy(factor: number) {
    const w = this.viewport.clientWidth, h = this.viewport.clientHeight;
    this.zoomAt(w / 2, h / 2, this.view.k * factor);
    this.glide(220);
    this.applyView();
  }

  // Frame one artboard in the middle of the screen (used by the live pill).
  focusBoard(id: string) {
    const ab = this.doc.artboards.find((a) => a.id === id);
    if (!ab) return;
    const w = this.viewport.clientWidth, h = this.viewport.clientHeight;
    this.view.k = Math.min(1, (w - 120) / ab.width, (h - 120) / ab.height);
    this.view.x = (w - ab.width * this.view.k) / 2 - ab.x * this.view.k;
    this.view.y = (h - ab.height * this.view.k) / 2 - ab.y * this.view.k;
    this.glide(420);
    this.applyView();
  }

  // Pan so a node sits in the middle of the viewport (comments list, layers). Wakes an unmounted board.
  panTo(id: string) {
    const el = this.findElement(id, { mount: true });
    if (!el) return false;
    const r = this.relRect(el);
    this.view.x += this.viewport.clientWidth / 2 - (r.left + r.width / 2);
    this.view.y += this.viewport.clientHeight / 2 - (r.top + r.height / 2);
    this.applyView();
    return true;
  }

  // What replies.ts needs from the engine to answer screenshot / computed / compare requests from Claude.
  replyHost(): ReplyHost {
    return {
      projectId: this.projectId,
      themeDecls: () => this.themeDecls(),
      findBoard: (id) => this.doc.artboards.find((a) => a.id === id),
      findElement: (id, opts) => this.findElement(id, opts),
      frameOf: (id) => this.boards.get(id.startsWith('A') ? id : this.pidIndex.get(id) ?? '')?.frame ?? null,
      reference: (refId) => (this.doc.references as { id: string; width: number; height: number }[] | undefined)?.find((r) => r.id === refId),
    };
  }

  // ---- Document -------------------------------------------------------------------
  private boardsHere() { return this.doc.artboards.filter((a) => this.inPage(a)); }
  private inPage(ab: Artboard) { return pageOfBoard(this.doc, ab) === this.activePage; }

  private themeDecls() {
    const t = this.doc.theme ?? { tokens: {}, modes: {} };
    const merged = { ...t.tokens, ...(this.themeMode === 'base' ? {} : t.modes?.[this.themeMode] ?? {}) };
    return Object.entries(merged).map(([k, v]) => `--${k}: ${v}`).join('; ');
  }

  // Called with every doc the store receives (delta already refilled). Diffs against what is on screen.
  setDoc(doc: DocData) {
    const hadBoards = this.doc.artboards.length > 0;
    this.doc = doc;
    // The page we show may have been deleted, never chosen, or just created.
    const pages = pagesOf(doc);
    if (this.pendingPage && pages.some((p) => p.id === this.pendingPage)) {
      this.activePage = this.pendingPage;
      lsSet(`dc-page:${this.projectId}`, this.activePage);
      this.pendingPage = null;
    }
    if (!pages.some((p) => p.id === this.activePage)) this.activePage = pages[0].id;
    this.events.onPage(this.activePage!);
    this.syncPage();

    this.render({ animate: !this.firstDoc });
    this.applyTheme();
    // Fit on load, and again when the first artboard ever appears (an empty doc has nothing to fit).
    if (this.firstDoc || (!hadBoards && doc.artboards.length)) { this.firstDoc = false; this.fit(); }
  }

  // Page background + which boards are visible. Off-page boards cost nothing (display:none, unmounted).
  private syncPage() {
    const page = pagesOf(this.doc).find((p) => p.id === this.activePage);
    this.viewport.style.background = page?.background || '';
    for (const b of this.boards.values()) b.el.classList.toggle('offpage', !this.inPage(b.ab));
    this.updateVisibility();
    this.drawSelection();
  }

  private makeBoard(ab: Artboard): Board {
    const labelName = document.createElement('span');
    labelName.className = 'name';
    const status = document.createElement('span');
    status.className = 'status';
    status.append(document.createElement('i'), 'Designing');
    const label = div('dc-label', labelName, status);
    const ring = div('dc-ring', div('dc-ring-spin'));
    const frame = div('dc-frame');
    const shadow = frame.attachShadow({ mode: 'open' }); // style encapsulation: design CSS and ours cannot leak into each other
    const img = document.createElement('img');
    img.className = 'dc-thumb';
    img.alt = '';
    img.draggable = false;
    const lodName = div('dc-lod-name');
    const el = div('dc-artboard lod', label, ring, frame, img, lodName, div('dc-shimmer', 'Claude is designing…'));
    el.dataset.ab = ab.id;
    this.world.appendChild(el);
    return { ab, el, frame, shadow, img, labelName, lodName, html: null, shown: null, oldHtml: '', hash: null, thumbKey: null, thumbReady: false, pinUntil: 0, index: null, indexKey: '' };
  }

  private render({ animate }: { animate: boolean }) {
    const seen = new Set<string>();
    // If a lot of artboards change at once it is a restore/import, not Claude drawing: stay calm.
    const changed = this.doc.artboards.filter((ab) => this.boards.get(ab.id)?.html !== ab.html);
    // Edits the user just made themselves are not "Claude designing": no reveal, no camera follow.
    const showGen = animate && changed.length <= 3 && Date.now() > this.userEditUntil;
    // Claude is drawing on a page we are not looking at: follow it there.
    if (showGen) {
      const away = changed.find((a) => !this.inPage(a));
      if (away) { this.activePage = pageOfBoard(this.doc, away); lsSet(`dc-page:${this.projectId}`, this.activePage); this.select(null); this.events.onPage(this.activePage); this.syncPage(); }
    }

    for (const ab of this.doc.artboards) {
      seen.add(ab.id);
      let b = this.boards.get(ab.id);
      const isNew = !b;
      if (!b) {
        b = this.makeBoard(ab);
        this.boards.set(ab.id, b);
        if (showGen) {
          b.el.classList.add('enter');
          b.el.addEventListener('animationend', () => b!.el.classList.remove('enter'), { once: true });
        }
      }
      // fit_artboard / a manual resize can flip the height mode without touching the HTML, so restyle the live root.
      if (b.ab.heightMode !== ab.heightMode) b.shadow.querySelector('[data-board-root]')?.setAttribute('style', boardRootStyle(ab.heightMode === 'fit'));
      b.ab = ab;
      Object.assign(b.el.style, { left: ab.x + 'px', top: ab.y + 'px', width: ab.width + 'px', height: ab.height + 'px' });
      b.el.classList.toggle('empty', !ab.html.trim());
      b.el.classList.toggle('offpage', !this.inPage(ab));
      b.labelName.textContent = ab.name; // textContent: names are untrusted
      b.lodName.textContent = ab.name;
      b.el.querySelector('.dc-label')!.classList.toggle('sel', this.selected === ab.id);

      // Skip the re-parse when nothing changed so dragging stays smooth.
      if (b.html !== ab.html) {
        b.html = ab.html;
        b.hash = null;
        this.indexPids(ab);
        this.scheduleThumb(b);
        if (showGen) {
          // Claude is writing here: mount it (even if tiny/offscreen) so the reveal can play.
          b.pinUntil = Date.now() + 4000;
          this.mountFrame(b);
          this.touchGen(b);
          const fresh = !isNew || ab.html ? this.revealNew(b.shadow, b.oldHtml) : [];
          this.followTo(b, fresh.at(-1) ?? null);
        } else if (b.shown != null) {
          this.mountFrame(b); // already on screen: refresh in place
        }
      }
    }
    for (const [id, b] of this.boards) {
      if (seen.has(id)) continue;
      clearTimeout(b.genTimer); clearTimeout(b.thumbTimer);
      if (this.liveBoard === b) this.clearLive();
      b.el.remove();
      this.boards.delete(id);
    }
    this.updateVisibility();
    this.drawSelection();
  }

  // node id -> artboard id. Built from the HTML text, so it also works for unmounted artboards.
  private indexPids(ab: Artboard) {
    for (const [pid, abId] of this.pidIndex) if (abId === ab.id) this.pidIndex.delete(pid);
    for (const m of ab.html.matchAll(/data-pid="([^"]+)"/g)) this.pidIndex.set(m[1], ab.id);
  }

  // ---- Level of detail -------------------------------------------------------------
  // With dozens of artboards the browser would lay out and paint tens of thousands of nodes per frame.
  // Figma avoids this with a GPU renderer that draws cached tiles when zoomed out. The DOM can't do
  // that, but the idea carries over: each artboard keeps a cached bitmap snapshot (an <img>: one cheap
  // texture). Zoomed out we show it; zoomed in we mount the real HTML so text stays sharp and
  // elements stay selectable.
  //   live DOM    : zoom >= LIVE_K and the board is near the viewport (or Claude is drawing in it)
  //   snapshot    : zoomed out, any board that has a snapshot
  //   placeholder : zoomed out and the snapshot is not ready yet (the board name)
  private mountFrame(b: Board) {
    if (b.shown === b.html) return;
    b.oldHtml = b.shown ?? '';
    b.shadow.innerHTML = `<style>:host{all:initial;display:block;font-family:system-ui,sans-serif}${BOARD_CSS}</style><style data-theme>:host{${this.themeDecls()}}</style>${boardRoot(b.ab.heightMode === 'fit', b.html ?? '')}`;
    b.shown = b.html;
    b.el.classList.remove('lod');
  }

  private unmountFrame(b: Board) {
    if (b.shown == null) return;
    b.shadow.replaceChildren();
    b.shown = null;
    b.el.classList.add('lod');
  }

  private updateVisibility() {
    const vw = this.viewport.clientWidth, vh = this.viewport.clientHeight, now = Date.now();
    const { x, y, k } = this.view;
    const zoomedOut = k < LIVE_K;
    for (const b of this.boards.values()) {
      const { ab } = b;
      if (!this.inPage(ab)) { this.unmountFrame(b); continue; } // other pages cost nothing
      // Screen-space rectangle computed from the data, so it needs no layout read.
      const left = x + ab.x * k, top = y + ab.y * k, w = ab.width * k, h = ab.height * k;
      const near = (m: number) => left < vw + m && left + w > -m && top < vh + m && top + h > -m;
      const pinned = b.pinUntil > now; // Claude is drawing here right now: keep it live
      // Zoomed out we prefer the snapshot, but keep a live board mounted until its snapshot exists.
      const wantLive = pinned || (near(MOUNT_MARGIN) && (!zoomedOut || !b.thumbReady));
      if (wantLive) this.mountFrame(b);
      else if (b.shown != null && (zoomedOut || !near(UNMOUNT_MARGIN))) this.unmountFrame(b);
    }
    // Placeholder names are counter-scaled so they stay ~15 screen px at any zoom.
    this.world.style.setProperty('--lod-size', `${Math.min(260, 15 / k)}px`);
  }

  // ---- Snapshot cache ----------------------------------------------------------------
  // Snapshot = the artboard HTML drawn through an SVG foreignObject onto a canvas. Rendering is queued
  // and runs one at a time in idle time so it never competes with panning. Results are keyed by a hash
  // of the HTML and kept in IndexedDB, so a reload shows every board instantly and only changed boards
  // are redrawn.
  private thumbQueue = new Map<string, string>(); // artboard id -> key still to render
  private thumbBusy = false;

  // Re-snapshot a changed board a moment after the last write (a burst of writes = one render).
  private scheduleThumb(b: Board) {
    clearTimeout(b.thumbTimer);
    b.thumbTimer = window.setTimeout(() => this.wantThumb(b), b.thumbKey ? 700 : 0);
  }

  private wantThumb(b: Board) {
    // The font set is part of the key: a snapshot drawn with the fallback font must not be reused once the real one exists.
    b.hash ??= hashStr((b.html ?? '') + this.themeDecls() + fontsSignature());
    const key = `${this.projectId}:${b.ab.id}:${b.hash}`;
    if (b.thumbKey === key) return;
    this.thumbQueue.set(b.ab.id, key);
    this.pumpThumbs();
  }

  private pumpThumbs() {
    if (this.thumbBusy || !this.thumbQueue.size) return;
    this.thumbBusy = true;
    const run = async () => {
      // Do the board closest to the middle of the screen first.
      const cx = (this.viewport.clientWidth / 2 - this.view.x) / this.view.k;
      const cy = (this.viewport.clientHeight / 2 - this.view.y) / this.view.k;
      let best: Board | null = null, bestKey = '', bd = Infinity;
      for (const [id, key] of this.thumbQueue) {
        const b = this.boards.get(id);
        if (!b) { this.thumbQueue.delete(id); continue; }
        const d = Math.hypot(b.ab.x + b.ab.width / 2 - cx, b.ab.y + b.ab.height / 2 - cy);
        if (d < bd) { bd = d; best = b; bestKey = key; }
      }
      if (best) {
        this.thumbQueue.delete(best.ab.id);
        try { await this.buildThumb(best, bestKey); } catch { /* an unrenderable board just keeps its placeholder */ }
      }
      this.thumbBusy = false;
      this.pumpThumbs();
    };
    // Wait for an idle moment, and for the user to stop dragging.
    const go = () => (Date.now() - this.lastTouch < 250 ? setTimeout(go, 250) : void run());
    if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 1500 }); else setTimeout(go, 50);
  }

  private async buildThumb(b: Board, key: string) {
    let blob = await thumbGet(key);
    if (!blob) {
      // ~0.7M pixels max (about 2.8 MB decoded) and never above half size: plenty for zoom < 30%.
      const { ab } = b;
      const scale = Math.min(0.5, Math.sqrt(700000 / (ab.width * ab.height)));
      const canvas = await rasterizeCanvas(this.projectId, { ...ab, html: b.html ?? '' }, scale, this.themeDecls());
      blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.82));
      if (blob) void thumbPut(key, blob);
    }
    // The board may have changed or vanished while we were drawing: drop stale results.
    if (!blob || this.boards.get(b.ab.id) !== b || `${this.projectId}:${b.ab.id}:${b.hash}` !== key) return;
    const old = b.img.src;
    b.img.src = URL.createObjectURL(blob);
    if (old.startsWith('blob:')) b.img.decode().catch(() => {}).finally(() => URL.revokeObjectURL(old));
    b.thumbKey = key;
    b.thumbReady = true;
    b.el.classList.add('has-thumb');
    this.updateVisibility(); // a board that was kept live while waiting can now switch to its snapshot
  }

  // The project's Google Fonts changed (use_font, or first load): install them for the live boards and redraw
  // every snapshot, since the old bitmaps were drawn with the fallback font.
  setFonts(fonts: ProjectFont[] | undefined) {
    if (!setProjectFonts(fonts)) return;
    for (const b of this.boards.values()) {
      b.hash = null;
      this.scheduleThumb(b);
    }
  }

  // Push the current tokens into every mounted board and redraw snapshots made with old values.
  // Runs on each doc and does nothing unless the tokens (or the mode) actually changed.
  private applyTheme() {
    const decls = this.themeDecls();
    if (decls === this.appliedTheme) return;
    this.appliedTheme = decls;
    for (const b of this.boards.values()) {
      const style = b.shadow.querySelector('style[data-theme]');
      if (style) style.textContent = `:host{${decls}}`;
      b.hash = null;
      this.scheduleThumb(b);
    }
  }

  // ---- "Claude is designing" -----------------------------------------------------------
  // Keep the ring ~3 screen px wide whatever the zoom.
  private sizeRing(b: Board) {
    const ring = b.el.querySelector<HTMLElement>('.dc-ring')!;
    const t = 3 / this.view.k;
    ring.style.inset = `-${t}px`;
    ring.style.borderRadius = `${6 / this.view.k}px`;
    ring.style.setProperty('--d', Math.hypot(b.ab.width + 2 * t, b.ab.height + 2 * t) + 'px');
  }

  // Each new change restarts the timer: the ring stays on while Claude keeps writing and fades ~1.8s after the last write.
  private touchGen(b: Board) {
    b.el.classList.add('gen');
    this.sizeRing(b);
    this.liveBoard = b;
    this.events.onLive({ id: b.ab.id, name: b.ab.name });
    clearTimeout(b.genTimer);
    b.genTimer = window.setTimeout(() => { b.el.classList.remove('gen'); if (this.liveBoard === b) this.clearLive(); }, 1800);
  }

  private clearLive() { this.liveBoard = null; this.events.onLive(null); }

  // Reveal newly written elements with a short stagger. Diff element ids against the previous HTML, find
  // the roots of the new subtrees, then animate those roots' children (down to 2 levels) so one giant
  // wrapper doesn't fade in as a single lump.
  private revealNew(shadow: ShadowRoot, oldHtml: string): HTMLElement[] {
    const oldIds = new Set(oldHtml.match(/data-pid="N\d+"/g) || []);
    const all = [...shadow.querySelectorAll<HTMLElement>('[data-pid]')];
    const fresh = new Set(all.filter((n) => !oldIds.has(`data-pid="${n.dataset.pid}"`)));
    if (!fresh.size || fresh.size > 250) return []; // nothing new, or a bulk restore/import: don't animate
    const targets: HTMLElement[] = [];
    const pick = (el: HTMLElement, depth: number) => {
      const kids = ([...el.children] as HTMLElement[]).filter((c) => fresh.has(c));
      const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
      if (depth >= 2 || !kids.length || hasOwnText) { targets.push(el); return; }
      kids.forEach((k) => pick(k, depth + 1));
    };
    for (const n of fresh) {
      const parent = n.parentElement?.closest<HTMLElement>('[data-pid]');
      if (!parent || !fresh.has(parent)) pick(n, 0);
    }
    const move = !this.reduceMotion.matches;
    targets.forEach((el, i) => {
      el.animate(
        [{ opacity: 0, transform: move ? 'translateY(10px)' : 'none' }, { opacity: 1, transform: 'none' }],
        // ease-out entrance; stagger capped so a long list never takes more than ~0.5s to arrive
        { duration: 280, delay: Math.min(i, 12) * 45, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'backwards' },
      );
    });
    return targets;
  }

  // ---- Follow Claude -------------------------------------------------------------------
  // When Claude writes to an artboard the camera glides there. For a board taller than the screen it
  // centres on the newest content, so a long page is followed section by section. It backs off for a
  // few seconds whenever the user pans, zooms or clicks.
  private followTo(b: Board, focusEl: HTMLElement | null) {
    const now = Date.now();
    if (!this.follow || now - this.lastTouch < 2500 || now - this.followAt < 500) return;
    if (this.followAgent && this.agent && this.agent.id !== this.followAgent) return;
    const { ab } = b;
    const w = this.viewport.clientWidth, vh = this.viewport.clientHeight;
    // Zoom so the artboard's width fits, but cap at 40%: at 100% a long board fills the screen and you only
    // see a sliver. 0.4 stays above LIVE_K (0.3), so the board remains live HTML, not a bitmap.
    const k = Math.min(0.4, Math.max(0.2, (w - 160) / ab.width));
    let cy = ab.y + ab.height / 2; // short board: centre it
    if (ab.height * k > vh - 80) { // tall board: centre on the newest content, else keep the current spot
      cy = (vh / 2 - this.view.y) / this.view.k;
      if (focusEl) { const r = this.relRect(focusEl); cy = (r.top + r.height / 2 - this.view.y) / this.view.k; }
      cy = Math.min(ab.y + ab.height, Math.max(ab.y, cy));
    }
    const nx = w / 2 - (ab.x + ab.width / 2) * k, ny = vh / 2 - cy * k;
    // Already framing it well? Don't nudge the camera for every small write.
    if (Math.abs(this.view.k - k) / k < 0.3 && Math.abs(this.view.x - nx) < w * 0.2 && Math.abs(this.view.y - ny) < vh * 0.2) return;
    this.followAt = now;
    Object.assign(this.view, { k, x: nx, y: ny });
    this.glide(560);
    this.applyView();
  }

  // ---- View transform -------------------------------------------------------------------
  // Pan/zoom hot path. The transform is written immediately (one cheap style write); the work that reads
  // layout or touches many nodes is coalesced into one requestAnimationFrame, so a burst of wheel events
  // costs one pass per frame instead of one per event.
  private applyView() {
    this.world.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.k})`;
    this.scheduleAfterView();
  }

  private scheduleAfterView() { if (!this.viewRaf) this.viewRaf = requestAnimationFrame(() => this.afterView()); }

  private afterView = () => {
    this.viewRaf = 0;
    this.events.onZoom(this.view.k);
    this.events.onView();
    for (const b of this.boards.values()) if (b.el.classList.contains('gen')) this.sizeRing(b);
    this.updateVisibility();
    this.drawSelection();
  };

  // Animate the next view change (ease-in-out: on-screen movement). The transition is removed afterwards so
  // normal panning and zooming stay instant; repeated calls retarget smoothly.
  private glide(ms: number) {
    if (this.reduceMotion.matches) return;
    this.world.style.transition = `transform ${ms}ms cubic-bezier(0.77, 0, 0.175, 1)`;
    clearTimeout(this.glideT);
    this.glideT = window.setTimeout(() => (this.world.style.transition = ''), ms + 40);
  }

  // Zoom keeping the world point under (px, py) fixed.
  private zoomAt(px: number, py: number, nextK: number) {
    const k = Math.min(MAX_K, Math.max(MIN_K, nextK));
    this.view.x = px - ((px - this.view.x) / this.view.k) * k;
    this.view.y = py - ((py - this.view.y) / this.view.k) * k;
    this.view.k = k;
  }

  // ---- Overlays -------------------------------------------------------------------------
  // Overlay boxes live in the viewport's own coordinate space; getBoundingClientRect is in page space and
  // already includes the world transform, so subtract the viewport origin.
  private relRect(el: Element) {
    const r = el.getBoundingClientRect(), v = this.viewport.getBoundingClientRect();
    return { left: r.left - v.left, top: r.top - v.top, width: r.width, height: r.height };
  }

  private place(box: HTMLElement, r: { left: number; top: number; width: number; height: number }) {
    Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  }

  // Look an element up through the pid index instead of scanning every shadow root.
  // `mount: true` (user asked to jump somewhere) wakes an unmounted artboard.
  findElement(id: string, { mount = false } = {}): HTMLElement | null {
    if (id.startsWith('A')) return this.boards.get(id)?.frame ?? null;
    const abId = this.pidIndex.get(id);
    const b = abId ? this.boards.get(abId) : undefined;
    if (!b) return null;
    if (b.shown == null) {
      if (!mount) return null;
      b.pinUntil = Date.now() + 4000;
      this.mountFrame(b);
    }
    return b.shadow.querySelector<HTMLElement>(`[data-pid="${id}"]`);
  }

  private drawSelection() {
    this.drawSelectionBox();
    this.paths.redraw(); // pen preview and path edit overlay; edit mode hides the selection box
  }

  private drawSelectionBox() {
    this.drawAgent(); // piggybacks on every selection redraw (pan, zoom, render)
    this.drawClaims();
    this.drawHover();
    const target = this.selected ? this.findElement(this.selected) : null;
    // No element (board is a snapshot): fall back to the rect index, box only, no resize handles.
    const rect = target ? this.relRect(target) : this.selected ? this.indexRect(this.selected) : null;
    if (!rect) { this.selBox.classList.add('dc-hide'); return; }
    this.place(this.selBox, rect);
    // On-screen size divided by zoom = design pixels, what the inspector shows.
    this.sizeLabel.textContent = `${Math.round(rect.width / this.view.k)} × ${Math.round(rect.height / this.view.k)}`;
    this.selBox.classList.remove('dc-hide');
    if (target) this.editor.showHandles(target); else this.editor.hideHandles();
  }

  private drawHover() {
    const el = this.hoverId ? this.findElement(this.hoverId) : null;
    const rect = el ? this.relRect(el) : this.hoverId ? this.indexRect(this.hoverId) : null;
    if (!rect) { this.hoverBox.classList.add('dc-hide'); return; }
    this.place(this.hoverBox, rect);
    this.hoverBox.classList.remove('dc-hide');
  }

  // Hover highlight on snapshot boards (live boards get none today). rAF-throttled: one pick per frame at most.
  private hoverRaf = 0;
  private onPointerMove = (e: PointerEvent) => {
    if (e.buttons || this.tool !== 'move' || this.commentMode || this.hoverRaf) return;
    const { clientX, clientY } = e;
    this.hoverRaf = requestAnimationFrame(() => {
      this.hoverRaf = 0;
      const id = this.pickAt(clientX, clientY);
      if (id !== this.hoverId) this.setHover(id);
    });
  };

  // Dashed boxes around the nodes Claude is reading or writing right now. Boxes are reused to avoid DOM churn.
  private drawAgent() {
    const rects = this.agentIds.map((id) => this.findElement(id)).filter((e): e is HTMLElement => !!e).map((e) => this.relRect(e));
    while (this.agentHost.children.length > rects.length) this.agentHost.lastChild!.remove();
    rects.forEach((r, i) => {
      const box = (this.agentHost.children[i] as HTMLElement) || this.agentHost.appendChild(document.createElement('i'));
      if (this.agent) box.style.setProperty('--c', this.agent.color);
      // Name tag on the first box only (like a multiplayer cursor label); textContent because names are untrusted.
      let tag = box.firstElementChild as HTMLElement | null;
      if (i === 0 && this.agent) {
        if (!tag) tag = box.appendChild(document.createElement('b'));
        if (tag.textContent !== this.agent.name) tag.textContent = this.agent.name;
      } else tag?.remove();
      this.place(box, r);
    });
  }

  // One outline per claimed board, in the claiming agent's colour, with its name above the top-left corner. Boxes are
  // reused like the agent boxes; names are untrusted so they go in as textContent. Boards on another page are hidden
  // (zero-size rect), so they get no outline.
  private drawClaims() {
    const shown = this.claims.map((c) => ({ c, f: this.boards.get(c.board)?.frame })).filter((x): x is { c: typeof x.c; f: HTMLDivElement } => !!x.f && x.f.isConnected)
      .map((x) => ({ c: x.c, r: this.relRect(x.f) })).filter((x) => x.r.width > 0);
    while (this.claimHost.children.length > shown.length) this.claimHost.lastChild!.remove();
    shown.forEach(({ c, r }, i) => {
      const box = (this.claimHost.children[i] as HTMLElement) || this.claimHost.appendChild(document.createElement('i'));
      box.style.setProperty('--c', c.agent.color);
      let tag = box.firstElementChild as HTMLElement | null;
      if (!tag) tag = box.appendChild(document.createElement('b'));
      if (tag.textContent !== c.agent.name) tag.textContent = c.agent.name;
      this.place(box, r);
    });
  }

  // ---- Input: wheel pans, ctrl/pinch zooms, drag pans, click selects -------------------
  // Wheel pans; ctrl/cmd+wheel (and trackpad pinch, which sends ctrlKey) zooms toward the cursor.
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const v = this.viewport.getBoundingClientRect();
      this.zoomAt(e.clientX - v.left, e.clientY - v.top, this.view.k * Math.exp(-e.deltaY * 0.01));
    } else {
      this.view.x -= e.deltaX;
      this.view.y -= e.deltaY;
    }
    this.applyView();
  };

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const path = e.composedPath(); // pierces the shadow root to find the real clicked element
    const hit = path.find(isNodeEl);
    // A shape made with the shape tools is one object: a click on its inner <rect> picks the whole <svg>.
    const node = hit?.closest<HTMLElement>('svg[data-shape]') ?? hit;
    const abEl = target.closest<HTMLElement>('.dc-artboard');
    const onLabel = !!target.closest('.dc-label');
    if (node?.isContentEditable) return; // clicking inside text being edited just moves the caret

    if (this.commentMode) {
      e.preventDefault(); // keep focus/selection where it was; the popover focuses its own textarea
      const targetId = node ? node.dataset.pid! : abEl ? abEl.dataset.ab! : null;
      if (targetId) this.events.onCommentPick(targetId, e.clientX, e.clientY);
      return;
    }

    // Pressing anywhere outside the anchors (they stop propagation) leaves path edit mode.
    if (this.paths.editing) this.paths.leaveEdit();
    // Hand tool / held Space: always pan, even over elements.
    if (this.tool === 'hand' || this.spaceDown) { this.panFrom(e); return; }
    if (this.tool === 'frame') { this.drawFrame(e); return; }
    if (this.tool === 'rect' || this.tool === 'ellipse' || this.tool === 'line') {
      const boardId = abEl && !onLabel ? abEl.dataset.ab : undefined;
      if (boardId) { e.preventDefault(); this.drawShape(e, boardId, this.tool); }
      else toast('Draw inside an artboard');
      return;
    }
    if (this.tool === 'pen') {
      const boardId = abEl && !onLabel ? abEl.dataset.ab : undefined;
      this.paths.penDown(e, boardId);
      return;
    }
    if (this.tool === 'text') {
      const id = node ? node.dataset.pid! : abEl && !onLabel ? abEl.dataset.ab! : null;
      if (id) { e.preventDefault(); void this.editor.addText(id).finally(() => this.events.onToolDone()); }
      return;
    }

    this.editor.noteDown(node ?? null);
    if (onLabel && abEl) { this.select(abEl.dataset.ab!); this.editor.dragBoard(e, abEl.dataset.ab!); return; }
    if (node) { this.select(node.dataset.pid!); this.editor.dragNode(e, node); return; }
    // Zoomed out the board is a bitmap: pick from the rect index. Dragging then pans (moving needs live DOM).
    const picked = this.pickAt(e.clientX, e.clientY);
    if (picked) { this.select(picked); this.panFrom(e); return; }
    this.select(null);
    this.panFrom(e);
  };

  // Pan with the pointer. Capture keeps the drag alive when the cursor leaves the viewport.
  private panFrom(e: PointerEvent) {
    const sx = e.clientX, sy = e.clientY, ox = this.view.x, oy = this.view.y;
    this.viewport.setPointerCapture(e.pointerId);
    this.viewport.classList.add('panning');
    const move = (ev: PointerEvent) => { this.view.x = ox + ev.clientX - sx; this.view.y = oy + ev.clientY - sy; this.applyView(); };
    const up = () => {
      this.viewport.classList.remove('panning');
      this.viewport.removeEventListener('pointermove', move);
      this.viewport.removeEventListener('pointerup', up);
    };
    this.viewport.addEventListener('pointermove', move);
    this.viewport.addEventListener('pointerup', up);
  }

  // Frame tool: drag a rectangle, release to create an artboard of that size at that world position.
  // A click without a drag (under 8 px) makes the default 1440 x 900 board at the click.
  private drawFrame(e: PointerEvent) {
    const v = this.viewport.getBoundingClientRect();
    const sx = e.clientX - v.left, sy = e.clientY - v.top;
    let cx = sx, cy = sy;
    this.viewport.setPointerCapture(e.pointerId);
    this.draft.classList.remove('dc-hide');
    const box = () => ({ left: Math.min(sx, cx), top: Math.min(sy, cy), width: Math.abs(cx - sx), height: Math.abs(cy - sy) });
    const move = (ev: PointerEvent) => { cx = ev.clientX - v.left; cy = ev.clientY - v.top; this.place(this.draft, box()); };
    const finish = (create: boolean) => {
      this.viewport.removeEventListener('pointermove', move);
      this.viewport.removeEventListener('pointerup', up);
      this.viewport.removeEventListener('pointercancel', cancel);
      this.draft.classList.add('dc-hide');
      if (!create) return;
      const b = box();
      const dragged = b.width > 8 && b.height > 8;
      const px = dragged ? b.left : sx, py = dragged ? b.top : sy;
      const at = { x: Math.round((px - this.view.x) / this.view.k), y: Math.round((py - this.view.y) / this.view.k) };
      const size = dragged ? { width: Math.max(40, Math.round(b.width / this.view.k)), height: Math.max(40, Math.round(b.height / this.view.k)) } : {};
      this.editor.createArtboard({ ...at, ...size })
        .then((r) => { const id = (r.result as { id?: string } | undefined)?.id; if (id) this.selectWhenReady(id); })
        .catch((err: Error) => toast(err.message || 'Could not create the artboard'))
        .finally(() => this.events.onToolDone());
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    this.viewport.addEventListener('pointermove', move);
    this.viewport.addEventListener('pointerup', up);
    this.viewport.addEventListener('pointercancel', cancel);
  }

  // Shape tools (rectangle, ellipse, line): drag a box inside a board, release to write it as an <svg>. The
  // rubber band is the same draft rectangle the frame tool uses. A click without a drag (under 4 screen px)
  // makes a 100 px shape at the click, so the tool is useful on a trackpad without precise dragging.
  private drawShape(e: PointerEvent, boardId: string, kind: 'rect' | 'ellipse' | 'line') {
    const b = this.boards.get(boardId);
    if (!b) return;
    const v = this.viewport.getBoundingClientRect();
    // The frame's top-left is the origin of the board's coordinates; k converts screen px to design px.
    const f = this.relRect(b.frame);
    const sx = e.clientX - v.left, sy = e.clientY - v.top;
    let cx = sx, cy = sy;
    this.viewport.setPointerCapture(e.pointerId);
    this.draft.classList.remove('dc-hide');
    const box = () => ({ left: Math.min(sx, cx), top: Math.min(sy, cy), width: Math.abs(cx - sx), height: Math.abs(cy - sy) });
    const move = (ev: PointerEvent) => { cx = ev.clientX - v.left; cy = ev.clientY - v.top; this.place(this.draft, box()); };
    const finish = (create: boolean) => {
      this.viewport.removeEventListener('pointermove', move);
      this.viewport.removeEventListener('pointerup', up);
      this.viewport.removeEventListener('pointercancel', cancel);
      this.draft.classList.add('dc-hide');
      if (!create) { this.events.onToolDone(); return; }
      const r = box();
      const dragged = r.width > 4 || r.height > 4;
      const k = this.view.k;
      const shape = dragged
        ? { x: (r.left - f.left) / k, y: (r.top - f.top) / k, w: r.width / k, h: r.height / k, flipX: cx < sx, flipY: cy < sy }
        : { x: (sx - f.left) / k, y: (sy - f.top) / k, w: 100, h: kind === 'line' ? 1 : 100 };
      void this.editor.addShape(boardId, kind, shape)
        .then((id) => { if (id) this.selectWhenReady(id); })
        .finally(() => this.events.onToolDone());
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    this.viewport.addEventListener('pointermove', move);
    this.viewport.addEventListener('pointerup', up);
    this.viewport.addEventListener('pointercancel', cancel);
  }

  // A new board only exists after the doc event redraws; select it as soon as it does.
  private selectWhenReady(id: string, tries = 40) {
    if (this.findElement(id)) { this.select(id); return; }
    if (tries > 0) requestAnimationFrame(() => this.selectWhenReady(id, tries - 1));
  }

  private onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    const node = e.composedPath().find(isNodeEl);
    const abEl = (e.target as HTMLElement).closest<HTMLElement>('.dc-artboard');
    const id = node ? node.dataset.pid! : abEl ? abEl.dataset.ab! : null;
    if (id) this.select(id); // right-click selects, like every design tool
    this.events.onContextMenu(e.clientX, e.clientY, id);
  };
}
