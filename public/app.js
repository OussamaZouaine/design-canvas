// Browser side of a project: renders the document on an infinite pan/zoom canvas, plays the
// "Claude is designing" animation, handles comment pins, and drives the side drawer
// (comments, activity, versions, tokens). Everything user-visible that Claude or a
// collaborator wrote is inserted with textContent / DOM nodes, never innerHTML.
import { initLayers } from '/layers.js';
const $ = (s) => document.querySelector(s);
const viewport = $('#viewport');
const world = $('#world');
const selBox = $('#sel');

// The canvas lives at /p/<projectId>; every API call is scoped to that project.
const projectId = location.pathname.split('/')[2];
const api = `/api/p/${projectId}`;
const papi = `/api/projects/${projectId}`;

let doc = { artboards: [] };
let userEditUntil = 0; // doc changes arriving before this time came from the user's own edit
const markUserEdit = () => { userEditUntil = Date.now() + 1500; };
let layers = null; // the Layers panel controller, created once everything it needs exists (bottom of this file)

// ---- Theme (design tokens) ----------------------------------------------------
// Tokens are CSS custom properties. Setting them on each artboard's shadow host (and on the
// screenshot wrapper) makes var(--color-primary) resolve inside the design, and custom
// properties inherit through shadow boundaries, so one edit restyles every board at once.
let themeMode = 'base'; // 'base' or a mode name from doc.theme.modes (a view setting, not saved)
const themeDecls = () => {
  const t = doc.theme ?? { tokens: {}, modes: {} };
  const merged = { ...t.tokens, ...(themeMode === 'base' ? {} : t.modes?.[themeMode] ?? {}) };
  return Object.entries(merged).map(([k, v]) => `--${k}: ${v}`).join('; ');
};
let comments = [];
let view = { x: 80, y: 90, k: 0.5 }; // pan offset + zoom factor (k)
let selected = null; // id of the selected node or artboard
let commentMode = false;
let firstDoc = true; // the first document load must not animate (feels like a flash otherwise)

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let lastTouch = 0; // last time the user panned/zoomed/clicked the canvas
for (const type of ['pointerdown', 'wheel']) viewport.addEventListener(type, () => { lastTouch = Date.now(); }, { capture: true, passive: true });
const post = (url, body = {}) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Tiny DOM builder: h('div', {class: 'x', onclick: fn}, 'text', child...)
const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat(Infinity).filter((x) => x != null && x !== false));
  return el;
};

const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};

// Non-blocking message (we avoid alert(), which freezes the page). Fades/slides in and out.
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ---- Rendering -------------------------------------------------------------

// Pan/zoom hot path. The transform is written immediately (one cheap style write), but the
// work that reads layout or touches many nodes is coalesced into one requestAnimationFrame
// callback, so a burst of wheel events costs one pass per frame instead of one per event.
let viewRaf = 0;
function applyView() {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
  if (!viewRaf) viewRaf = requestAnimationFrame(afterView);
}
function afterView() {
  viewRaf = 0;
  $('#zoom').textContent = Math.round(view.k * 100) + '%';
  // Keep the "designing" ring a constant ~3 screen px wide whatever the zoom.
  for (const el of world.querySelectorAll('.artboard.gen')) sizeRing(el);
  updateVisibility();
  drawSelection();
  schedulePins();
}

// ---- Level of detail --------------------------------------------------------
// With dozens of artboards the browser has to lay out and paint tens of thousands of nodes
// every frame. Figma avoids this with a GPU renderer that draws cached tiles when zoomed out.
// We can't do that with the DOM, but we can use the same idea: each artboard keeps a cached
// bitmap snapshot ("thumbnail"). Zoomed out, we show the snapshot (an <img>: one cheap texture);
// zoomed in, we mount the real HTML so text stays sharp and elements stay selectable.
//   live DOM  : zoom >= LIVE_K and the board is near the viewport (or Claude is drawing in it)
//   snapshot  : zoomed out, any board that has a snapshot
//   placeholder (name only): zoomed out and the snapshot is not ready yet
const LIVE_K = 0.3;          // below this zoom a board is drawn from its snapshot
const MOUNT_MARGIN = 500;    // screen px around the viewport inside which boards get mounted
const UNMOUNT_MARGIN = 1600; // boards only unmount well past that, so small back-and-forth pans don't thrash
const abEls = new Map();     // artboard id -> its DOM element
const pidIndex = new Map();  // node id (data-pid) -> artboard id, so lookups don't scan every shadow root

function mountFrame(el, ab) {
  const frame = el.querySelector('.frame');
  if (frame._shown === ab.html) return false;
  const oldHtml = frame._shown ?? '';
  frame.shadowRoot.innerHTML = `<style>:host{all:initial;display:block;font-family:system-ui,sans-serif}[hidden]{display:none !important}</style><style data-theme>:host{${themeDecls()}}</style><div style="position:relative;width:100%;height:100%">${ab.html}</div>`;
  frame._shown = ab.html;
  el.classList.remove('lod');
  frame._oldHtml = oldHtml;
  return true;
}
function unmountFrame(el) {
  const frame = el.querySelector('.frame');
  if (frame._shown == null) return;
  frame.shadowRoot.replaceChildren();
  frame._shown = null;
  el.classList.add('lod');
}

function updateVisibility() {
  const vw = viewport.clientWidth, vh = viewport.clientHeight, now = Date.now();
  const zoomedOut = view.k < LIVE_K;
  for (const ab of doc.artboards) {
    const el = abEls.get(ab.id);
    if (!el) continue;
    // Screen-space rectangle computed from the data (no layout read, so it's free).
    const left = view.x + ab.x * view.k, top = view.y + ab.y * view.k;
    const w = ab.width * view.k, ht = ab.height * view.k;
    const dist = (m) => left < vw + m && left + w > -m && top < vh + m && top + ht > -m;
    const mounted = el.querySelector('.frame')._shown != null;
    const pinned = el._pin > now; // Claude is drawing here right now: keep it live
    // Zoomed out we prefer the snapshot, but keep a live board mounted until its snapshot exists.
    const wantLive = pinned || (dist(MOUNT_MARGIN) && (!zoomedOut || !el._thumbReady));
    if (wantLive) mountFrame(el, ab);
    else if (mounted && (zoomedOut || !dist(UNMOUNT_MARGIN))) unmountFrame(el);
  }
  // Placeholder names are counter-scaled so they stay ~15 screen px at any zoom.
  world.style.setProperty('--lod-size', `${Math.min(260, 15 / view.k)}px`);
}

// ---- Snapshot cache -----------------------------------------------------------
// Snapshot = the artboard HTML drawn through an SVG <foreignObject> onto a canvas (the same
// trick the screenshot tool uses). Rendering is queued and runs one at a time in idle time so
// it never competes with panning. Results are keyed by a hash of the HTML and kept in
// IndexedDB, so a reload shows every board instantly and only changed boards are redrawn.
const hashStr = (str) => { // FNV-1a: a fast non-cryptographic hash, good enough as a cache key
  let hsh = 2166136261;
  for (let i = 0; i < str.length; i++) { hsh ^= str.charCodeAt(i); hsh = Math.imul(hsh, 16777619); }
  return (hsh >>> 0).toString(36) + str.length.toString(36);
};
let thumbDb = null;
const idb = () => thumbDb ??= new Promise((resolve) => {
  try {
    const rq = indexedDB.open('design-canvas-thumbs', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('t');
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => resolve(null);
  } catch { resolve(null); } // private mode etc.: just run without the persistent cache
});
const idbGet = async (key) => { const db = await idb(); if (!db) return null; return new Promise((r) => { const q = db.transaction('t').objectStore('t').get(key); q.onsuccess = () => r(q.result ?? null); q.onerror = () => r(null); }); };
const idbPut = async (key, blob) => { const db = await idb(); if (db) try { db.transaction('t', 'readwrite').objectStore('t').put(blob, key); } catch { /* quota: ignore */ } };

const thumbQueue = new Map(); // artboard id -> key still to render
let thumbBusy = false;
function wantThumb(ab) {
  const el = abEls.get(ab.id);
  const frame = el.querySelector('.frame');
  frame._hash ??= hashStr(ab.html + themeDecls());
  const key = `${projectId}:${ab.id}:${frame._hash}`;
  if (el._thumbKey === key) return;
  thumbQueue.set(ab.id, key);
  pumpThumbs();
}
function pumpThumbs() {
  if (thumbBusy || !thumbQueue.size) return;
  thumbBusy = true;
  const run = async () => {
    // Do the board closest to the middle of the screen first.
    const cx = (viewport.clientWidth / 2 - view.x) / view.k, cy = (viewport.clientHeight / 2 - view.y) / view.k;
    let best = null, bd = Infinity;
    for (const [id, key] of thumbQueue) {
      const ab = doc.artboards.find((a) => a.id === id);
      if (!ab) { thumbQueue.delete(id); continue; }
      const d = Math.hypot(ab.x + ab.width / 2 - cx, ab.y + ab.height / 2 - cy);
      if (d < bd) { bd = d; best = [ab, key]; }
    }
    if (best) {
      const [ab, key] = best;
      thumbQueue.delete(ab.id);
      try { await buildThumb(ab, key); } catch { /* an unrenderable board just keeps its placeholder */ }
    }
    thumbBusy = false;
    pumpThumbs();
  };
  // Wait for an idle moment, and for the user to stop dragging.
  const go = () => (Date.now() - lastTouch < 250 ? setTimeout(go, 250) : run());
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 1500 }); else setTimeout(go, 50);
}
async function buildThumb(ab, key) {
  const el = abEls.get(ab.id);
  if (!el) return;
  let blob = await idbGet(key);
  if (!blob) {
    // ~0.7M pixels max (about 2.8 MB decoded) and never above half size: plenty for zoom < 30%.
    const scale = Math.min(0.5, Math.sqrt(700000 / (ab.width * ab.height)));
    const canvas = await rasterizeCanvas(ab, scale);
    blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.82));
    if (blob) idbPut(key, blob);
  }
  if (!blob || !abEls.has(ab.id)) return;
  // The board may have changed while we were drawing: drop stale results.
  const frame = el.querySelector('.frame');
  if (`${projectId}:${ab.id}:${frame._hash}` !== key) return;
  const img = el.querySelector('.thumb');
  const old = img.src;
  img.src = URL.createObjectURL(blob);
  if (old.startsWith('blob:')) img.decode().finally(() => URL.revokeObjectURL(old)).catch(() => {});
  el._thumbKey = key;
  el._thumbReady = true;
  el.classList.add('has-thumb');
  updateVisibility(); // a board that was kept live while waiting can now switch to its snapshot
}

function sizeRing(el) {
  const ring = el.querySelector('.ring');
  const t = 3 / view.k;
  ring.style.inset = `-${t}px`;
  ring.style.borderRadius = `${6 / view.k}px`;
  ring.style.setProperty('--d', Math.hypot(el.offsetWidth + 2 * t, el.offsetHeight + 2 * t) + 'px');
}

// Mark an artboard as "being designed". Each new change restarts the timer, so the ring
// stays on for as long as Claude keeps writing and fades out ~1.8s after the last write.
function touchGen(el) {
  el.classList.add('gen');
  sizeRing(el);
  setLive(el);
  clearTimeout(el._genT);
  el._genT = setTimeout(() => { el.classList.remove('gen'); if (liveEl === el) clearLive(); }, 1800);
}

// Header pill (top right) that says which artboard Claude is writing to. The artboard's own
// label is unreadable when zoomed out over dozens of boards, so this is the always-visible cue.
// Clicking it glides the view to that artboard.
const live = $('#live');
let liveEl = null;
function setLive(el) {
  liveEl = el;
  live.querySelector('b').textContent = el.querySelector('.name').textContent; // textContent: names are untrusted
  live.hidden = false;
  requestAnimationFrame(() => live.classList.add('on')); // next frame so the transition runs from the hidden state
}
function clearLive() {
  liveEl = null;
  live.classList.remove('on');
  setTimeout(() => { if (!liveEl) live.hidden = true; }, 220); // after the fade-out finishes
}
live.onclick = () => {
  if (!liveEl) return;
  const ab = doc.artboards.find((a) => a.id === liveEl.dataset.ab);
  if (!ab) return;
  const w = viewport.clientWidth, h2 = viewport.clientHeight;
  view.k = Math.min(1, (w - 120) / ab.width, (h2 - 120) / ab.height);
  view.x = (w - ab.width * view.k) / 2 - ab.x * view.k;
  view.y = (h2 - ab.height * view.k) / 2 - ab.y * view.k;
  glide(420);
  applyView();
};

// Reveal newly written elements with a short stagger. We diff element ids against the
// previous HTML, find the roots of the new subtrees, then animate those roots' children
// (down to 2 levels) so a single giant wrapper doesn't fade in as one lump.
function revealNew(shadow, oldHtml) {
  const oldIds = new Set(oldHtml.match(/data-pid="N\d+"/g) || []);
  const fresh = new Set([...shadow.querySelectorAll('[data-pid]')].filter((n) => !oldIds.has(`data-pid="${n.dataset.pid}"`)));
  if (!fresh.size || fresh.size > 250) return []; // nothing new, or a bulk restore/import: don't animate
  const targets = [];
  const pick = (el, depth) => {
    const kids = [...el.children].filter((c) => fresh.has(c));
    const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (depth >= 2 || !kids.length || hasOwnText) { targets.push(el); return; }
    kids.forEach((k) => pick(k, depth + 1));
  };
  for (const n of fresh) if (!n.parentElement?.closest('[data-pid]') || !fresh.has(n.parentElement.closest('[data-pid]'))) pick(n, 0);

  const move = !reduceMotion.matches;
  targets.forEach((el, i) => {
    el.animate(
      [{ opacity: 0, transform: move ? 'translateY(10px)' : 'none' }, { opacity: 1, transform: 'none' }],
      // ease-out entrance; stagger capped so a long list never takes more than ~0.5s to arrive
      { duration: 280, delay: Math.min(i, 12) * 45, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'backwards' },
    );
  });
  return targets;
}

// Each artboard's HTML goes in a shadow root so the design's CSS (and our UI's)
// can't leak into each other. Shadow DOM = style encapsulation built into the browser.
function render({ animate = false } = {}) {
  const seen = new Set();
  // If a lot of artboards change at once it is a restore/import, not Claude drawing: stay calm.
  const changed = doc.artboards.filter((ab) => {
    const el = abEls.get(ab.id);
    return !el || el.querySelector('.frame')._html !== ab.html;
  });
  // Edits the user just made themselves (layers panel, theme tab) are not "Claude designing": no reveal animation, no camera follow.
  const showGen = animate && changed.length <= 3 && Date.now() > userEditUntil;

  for (const ab of doc.artboards) {
    seen.add(ab.id);
    let el = abEls.get(ab.id);
    const isNew = !el;
    if (!el) {
      el = h('div', { class: 'artboard lod', 'data-ab': ab.id },
        h('div', { class: 'label' }, h('span', { class: 'name' }), h('span', { class: 'status' }, h('i'), 'Designing')),
        h('div', { class: 'ring' }, h('div', { class: 'ring-spin' })),
        h('div', { class: 'frame' }),
        h('img', { class: 'thumb', alt: '', draggable: 'false' }),
        h('div', { class: 'lod-name' }),
        h('div', { class: 'shimmer' }, 'Claude is designing…'));
      el.querySelector('.frame').attachShadow({ mode: 'open' });
      world.appendChild(el);
      abEls.set(ab.id, el);
      if (showGen) {
        el.classList.add('enter');
        el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true });
      }
    }
    Object.assign(el.style, { left: ab.x + 'px', top: ab.y + 'px', width: ab.width + 'px', height: ab.height + 'px' });
    el.classList.toggle('empty', !ab.html.trim());
    const label = el.querySelector('.label');
    label.querySelector('.name').textContent = ab.name;
    el.querySelector('.lod-name').textContent = ab.name;
    label.classList.toggle('sel', selected === ab.id);

    const frame = el.querySelector('.frame');
    // Skip the re-parse when nothing changed so dragging stays smooth.
    if (frame._html !== ab.html) {
      frame._html = ab.html;
      frame._hash = null;
      indexPids(ab);
      scheduleThumb(ab);
      if (showGen) {
        // Claude is writing here: mount it (even if tiny/offscreen) so the reveal can play.
        el._pin = Date.now() + 4000;
        mountFrame(el, ab);
        touchGen(el);
        const fresh = !isNew || ab.html ? revealNew(frame.shadowRoot, frame._oldHtml ?? '') : [];
        followTo(ab, fresh.at(-1));
      } else if (frame._shown != null) {
        mountFrame(el, ab); // already on screen: refresh in place
      }
    }
  }
  for (const [id, el] of abEls) if (!seen.has(id)) { el.remove(); abEls.delete(id); }
  updateVisibility();
  drawSelection();
  schedulePins();
}

// Re-snapshot a changed board a moment after the last write (a burst of writes = one render).
function scheduleThumb(ab) {
  const el = abEls.get(ab.id);
  clearTimeout(el._thumbT);
  el._thumbT = setTimeout(() => { const cur = doc.artboards.find((a) => a.id === ab.id); if (cur) wantThumb(cur); }, el._thumbKey ? 700 : 0);
}

// node id -> artboard id. Built from the HTML text, so it also works for unmounted artboards.
function indexPids(ab) {
  for (const [pid, abId] of pidIndex) if (abId === ab.id) pidIndex.delete(pid);
  for (const m of ab.html.matchAll(/data-pid="([^"]+)"/g)) pidIndex.set(m[1], ab.id);
}

// ---- Follow Claude ------------------------------------------------------------
// When Claude writes to an artboard the camera glides there, so you watch the design appear
// without hunting for it. For a board taller than the screen it centres on the newest content
// instead of the board's middle, so a long page is followed section by section.
// It backs off for a few seconds whenever you pan, zoom or click, and can be turned off.
let follow = true;
try { follow = localStorage.getItem('dc-follow') !== '0'; } catch { /* storage blocked: default on */ }
const followBtn = $('#follow');
followBtn.setAttribute('aria-pressed', String(follow));
followBtn.onclick = () => {
  follow = !follow;
  followBtn.setAttribute('aria-pressed', String(follow));
  try { localStorage.setItem('dc-follow', follow ? '1' : '0'); } catch { /* ignore */ }
};

let followAt = 0;
function followTo(ab, focusEl) {
  const now = Date.now();
  if (!follow || now - lastTouch < 2500 || now - followAt < 500) return;
  const w = viewport.clientWidth - (panelOpen() ? 340 : 0), vh = viewport.clientHeight;
  // Zoom so the artboard's width fits, but cap at 40%: at 100% a long board fills the screen and you
  // only see a sliver of it. 0.4 stays above LIVE_K (0.3), so the board remains live HTML, not a bitmap.
  const k = Math.min(0.4, Math.max(0.2, (w - 160) / ab.width));
  const curCy = (vh / 2 - view.y) / view.k;
  let cy = ab.y + ab.height / 2; // short board: centre it
  if (ab.height * k > vh - 80) { // tall board: centre on the newest content, else keep the current spot
    cy = curCy;
    if (focusEl) {
      const r = focusEl.getBoundingClientRect(); // screen -> world (the viewport starts 44px below the top)
      cy = (r.top + r.height / 2 - 44 - view.y) / view.k;
    }
    cy = Math.min(ab.y + ab.height, Math.max(ab.y, cy));
  }
  const cx = ab.x + ab.width / 2;
  const nx = w / 2 - cx * k, ny = vh / 2 - cy * k;
  // Already framing it well? Don't nudge the camera for every small write.
  if (Math.abs(view.k - k) / k < 0.3 && Math.abs(view.x - nx) < w * 0.2 && Math.abs(view.y - ny) < vh * 0.2) return;
  followAt = now;
  view.k = k; view.x = nx; view.y = ny;
  glide(560);
  applyView();
}

// Animate the next view change (ease-in-out for on-screen movement). The transition is removed
// afterwards so normal panning and zooming stay instant; repeated calls retarget smoothly.
let glideT;
function glide(ms) {
  if (reduceMotion.matches) return;
  world.style.transition = `transform ${ms}ms cubic-bezier(0.77, 0, 0.175, 1)`;
  clearTimeout(glideT);
  glideT = setTimeout(() => (world.style.transition = ''), ms + 40);
}

// Outline the selected element. getBoundingClientRect already accounts for the
// world transform, so the box lands in the right place at any pan/zoom.
// Thin box for the layer the pointer is over in the Layers panel (same rect maths as the selection box).
let hoverId = null;
function drawHover() {
  const box = $('#hover');
  const el = hoverId && findElement(hoverId);
  if (!el) { box.hidden = true; return; }
  const r = el.getBoundingClientRect();
  Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  box.hidden = false;
}

function drawSelection() {
  drawAgent(); // piggybacks on every selection redraw (pan, zoom, render)
  drawHover();
  const target = selected && findElement(selected);
  if (!target) { selBox.hidden = true; return; }
  const r = target.getBoundingClientRect();
  Object.assign(selBox.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  selBox.hidden = false;
}

// Dashed boxes around the nodes Claude is working on. Same trick as the selection box: read the
// on-screen rect, so it stays right at any pan/zoom. Boxes are reused to avoid DOM churn.
let agentIds = [];
function drawAgent() {
  const host = $('#agent');
  const rects = agentIds.map((id) => findElement(id)?.getBoundingClientRect()).filter(Boolean);
  while (host.children.length > rects.length) host.lastChild.remove();
  rects.forEach((r, i) => {
    const box = host.children[i] || host.appendChild(document.createElement('i'));
    Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  });
}

// Look an element up through the pid index instead of scanning every shadow root.
// `mount: true` (used when the user asks to jump somewhere) wakes an unmounted artboard.
function findElement(id, { mount = false } = {}) {
  if (id.startsWith('A')) return abEls.get(id)?.querySelector('.frame') ?? null;
  const abId = pidIndex.get(id);
  const el = abId && abEls.get(abId);
  if (!el) return null;
  const frame = el.querySelector('.frame');
  if (frame._shown == null) {
    if (!mount) return null;
    el._pin = Date.now() + 4000;
    mountFrame(el, doc.artboards.find((a) => a.id === abId));
  }
  return frame.shadowRoot.querySelector(`[data-pid="${id}"]`);
}

function select(id) {
  selected = id;
  layers?.reveal(id); // open the tree down to it and scroll it into view
  post(`${api}/selection`, { ids: id ? [id] : [] });
  render();
}

// ---- Pan, zoom, select, drag ----------------------------------------------

// Wheel pans; ctrl/cmd+wheel (and trackpad pinch, which sends ctrlKey) zooms toward the cursor.
viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const k = Math.min(4, Math.max(0.05, view.k * Math.exp(-e.deltaY * 0.01)));
    const px = e.clientX, py = e.clientY - 44;
    // Keep the world point under the cursor fixed while zooming.
    view.x = px - ((px - view.x) / view.k) * k;
    view.y = py - ((py - view.y) / view.k) * k;
    view.k = k;
  } else {
    view.x -= e.deltaX;
    view.y -= e.deltaY;
  }
  applyView();
}, { passive: false });

viewport.addEventListener('mousedown', (e) => { if (commentMode) e.preventDefault(); });
viewport.addEventListener('pointerdown', (e) => {
  const label = e.target.closest('.label');
  const path = e.composedPath(); // pierces the shadow root to find the real clicked element
  const node = path.find((n) => n.dataset && n.dataset.pid);
  const abEl = e.target.closest('.artboard');
  if (node?.isContentEditable) return; // clicking inside text that is being edited just moves the caret

  // Comment mode: a click pins a comment on the element under the pointer (or the artboard).
  if (commentMode) {
    const targetId = node ? node.dataset.pid : abEl ? abEl.dataset.ab : null;
    if (targetId) openNewComment(targetId, e.clientX, e.clientY);
    return;
  }
  closePop();

  if (label) { // drag an artboard by its label
    const ab = doc.artboards.find((a) => a.id === abEl.dataset.ab);
    select(ab.id);
    startDrag(e, (dx, dy) => {
      ab.x = ab._x + dx; ab.y = ab._y + dy;
      abEl.style.left = ab.x + 'px'; abEl.style.top = ab.y + 'px';
      drawSelection();
      schedulePins();
    }, () => { ab._x = ab.x; ab._y = ab.y; }, () => post(`${api}/move`, { id: ab.id, x: ab.x, y: ab.y }), view.k);
    return;
  }
  if (node) { select(node.dataset.pid); return; }
  select(null);
  // Empty space: pan with the mouse.
  startDrag(e, (dx, dy) => { view.x = view._x + dx; view.y = view._y + dy; applyView(); },
    () => { view._x = view.x; view._y = view.y; }, () => {});
});

// Generic pointer drag. `scale` converts screen px into the unit being moved:
// artboards live in world units (divide by zoom), panning is already in screen px.
function startDrag(e, onMove, onStart, onEnd, scale = 1) {
  const sx = e.clientX, sy = e.clientY;
  onStart();
  viewport.classList.add('panning');
  viewport.setPointerCapture(e.pointerId);
  const move = (ev) => onMove((ev.clientX - sx) / scale, (ev.clientY - sy) / scale);
  const up = () => {
    viewport.classList.remove('panning');
    viewport.removeEventListener('pointermove', move);
    viewport.removeEventListener('pointerup', up);
    onEnd();
  };
  viewport.addEventListener('pointermove', move);
  viewport.addEventListener('pointerup', up);
}

// Keyboard shortcuts never animate: they are repeated all day.
window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, [contenteditable]')) return; // typing is not a shortcut
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
    post(`${api}/delete`, { ids: [selected] });
    select(null);
  }
  if (e.key === 'Escape') {
    if (!$('#pop').hidden) closePop();
    else if (commentMode) setCommentMode(false);
    else if (selected && !selected.startsWith('A') && layers?.parentOf(selected)) select(layers.parentOf(selected)); // up one level
    else select(null);
  }
  if (e.key.toLowerCase() === 'l' && !e.metaKey && !e.ctrlKey && !e.altKey) layers?.toggle();
  if (e.key.toLowerCase() === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey && $('#pop').hidden) setCommentMode(!commentMode);
  // Undo / redo go through the server so they cover Claude's changes and the theme too.
  if ((e.metaKey || e.ctrlKey) && !e.altKey && ['z', 'y'].includes(e.key.toLowerCase())) {
    e.preventDefault();
    const redo = e.key.toLowerCase() === 'y' || e.shiftKey;
    markUserEdit();
    post(`${api}/${redo ? 'redo' : 'undo'}`).then(async (r) => { if (!r.ok) toast((await r.json().catch(() => ({}))).error || 'Nothing to do'); });
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'd' && selected) { e.preventDefault(); post(`${api}/duplicate`, { ids: [selected] }); }
});

// Edit text in place: double-click a text element, type, click away or press Enter to save
// (Escape cancels). Only leaf elements qualify: setting text on a node with children would replace them.
// The element is edited right inside its shadow root with contenteditable, a browser feature that
// turns any element into a text field; plaintext-only keeps pasted formatting out.
viewport.addEventListener('dblclick', (e) => {
  if (commentMode) return;
  const el = e.composedPath().find((n) => n.dataset && n.dataset.pid);
  if (!el || el.children.length || !el.textContent.trim() || el.isContentEditable) return;
  startTextEdit(el);
});
function startTextEdit(el) {
  const id = el.dataset.pid, before = el.textContent;
  let cancelled = false;
  try { el.contentEditable = 'plaintext-only'; } catch { el.contentEditable = 'true'; }
  if (!el.isContentEditable) el.contentEditable = 'true'; // browsers without plaintext-only ignore it silently
  el.focus();
  getSelection().selectAllChildren(el);
  const onKey = (ev) => {
    ev.stopPropagation(); // typing must never reach the canvas shortcuts (L, C, Delete...)
    if (ev.key === 'Escape') { cancelled = true; ev.preventDefault(); el.blur(); }
    else if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); el.blur(); }
  };
  el.addEventListener('keydown', onKey);
  el.addEventListener('blur', () => {
    el.removeEventListener('keydown', onKey);
    el.removeAttribute('contenteditable');
    const text = el.textContent;
    if (cancelled || text === before) { el.textContent = before; return; }
    markUserEdit();
    post(`${api}/text`, { id, text }).then(async (r) => {
      if (!r.ok) { el.textContent = before; toast((await r.json().catch(() => ({}))).error || 'Could not save the text'); }
    });
  }, { once: true });
}

$('#new').onclick = () => post(`${api}/create`, { name: 'Artboard', width: 1440, height: 900 });
$('#fit').onclick = fit;

// Zoom/pan so every artboard is visible.
function fit() {
  if (!doc.artboards.length) return;
  const minX = Math.min(...doc.artboards.map((a) => a.x));
  const minY = Math.min(...doc.artboards.map((a) => a.y)) - 30;
  const maxX = Math.max(...doc.artboards.map((a) => a.x + a.width));
  const maxY = Math.max(...doc.artboards.map((a) => a.y + a.height));
  const w = viewport.clientWidth, h2 = viewport.clientHeight;
  view.k = Math.min(1, (w - 80) / (maxX - minX), (h2 - 80) / (maxY - minY));
  view.x = (w - (maxX - minX) * view.k) / 2 - minX * view.k;
  view.y = (h2 - (maxY - minY) * view.k) / 2 - minY * view.k;
  applyView();
}

// Pan so an element sits in the middle of the free canvas area (used by the comments list).
function panTo(id) {
  const el = findElement(id, { mount: true });
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const freeW = innerWidth - ($('#panel').classList.contains('open') ? 340 : 0);
  view.x += freeW / 2 - (r.left + r.width / 2);
  view.y += 44 + (innerHeight - 44) / 2 - (r.top + r.height / 2);
  applyView();
  return true;
}

// ---- Server connection -----------------------------------------------------

const events = new EventSource(`/events?project=${projectId}`); // auto-reconnects on its own
events.onopen = () => { $('#status').textContent = 'connected'; $('#status').className = ''; };
events.onerror = () => { $('#status').textContent = 'disconnected'; $('#status').className = 'off'; };
events.addEventListener('doc', (e) => {
  const hadArtboards = doc.artboards.length > 0;
  const prev = new Map(doc.artboards.map((a) => [a.id, a.html]));
  doc = JSON.parse(e.data);
  // The server only sends HTML that changed (html:null = unchanged); fill the rest from our copy.
  for (const ab of doc.artboards) if (ab.html === null) ab.html = prev.get(ab.id) ?? '';
  $('#count').textContent = `${doc.artboards.length} artboard${doc.artboards.length === 1 ? '' : 's'}`;
  render({ animate: !firstDoc });
  layers?.refresh();
  applyTheme();
  refreshTheme();
  $('#hint').hidden = doc.artboards.length > 0;
  // Fit on load, and again when the first artboard ever appears (an empty doc has nothing to fit).
  if (firstDoc || (!hadArtboards && doc.artboards.length)) { firstDoc = false; fit(); }
  if (panelTab === 'tokens' && panelOpen()) refreshSoon('tokens');
});
events.addEventListener('agent', (e) => { agentIds = JSON.parse(e.data).ids; drawAgent(); });
events.addEventListener('screenshot', async (e) => {
  const { id, artboardId, ...opts } = JSON.parse(e.data);
  try {
    await post(`${api}/screenshot`, { id, dataUrl: await rasterize(artboardId, opts) });
  } catch (err) {
    await post(`${api}/screenshot`, { id, error: String(err.message || err) });
  }
});

// Push the current tokens into every mounted board and redraw bitmaps that were drawn with old
// values. Runs on each doc event but does nothing unless the tokens (or the mode) actually changed.
let appliedTheme = '';
function applyTheme() {
  const decls = themeDecls();
  if (decls === appliedTheme) return;
  appliedTheme = decls;
  for (const ab of doc.artboards) {
    const el = abEls.get(ab.id);
    if (!el) continue;
    const frame = el.querySelector('.frame');
    const style = frame.shadowRoot.querySelector('style[data-theme]');
    if (style) style.textContent = `:host{${decls}}`;
    frame._hash = null;
    scheduleThumb(ab);
  }
}

// Claude asked for computed styles. Only a laid-out DOM knows real values (resolved colours,
// used widths), so read them from the live node, mounting its board first if needed.
events.addEventListener('computed', async (e) => {
  const { id, nodeIds, props } = JSON.parse(e.data);
  try {
    const result = {};
    for (const nid of nodeIds) {
      const el = findElement(nid, { mount: true });
      if (!el) { result[nid] = 'not rendered'; continue; }
      const cs = getComputedStyle(el);
      result[nid] = Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
    }
    await post(`${api}/reply`, { id, result });
  } catch (err) {
    await post(`${api}/reply`, { id, error: String(err.message || err) });
  }
});

// Turn an artboard's HTML into a PNG: wrap it in an SVG <foreignObject>, load that as an
// image, then draw the image onto a canvas. Limit: only inline styles and data: images
// survive, since the SVG is rendered in isolation.
async function rasterizeCanvas(ab, scale, crop = { x: 0, y: 0, w: ab.width, h: ab.height }) {
  const holder = document.createElement('div');
  holder.innerHTML = ab.html;
  const xhtml = '<style>[hidden]{display:none !important}</style>' + new XMLSerializer().serializeToString(holder); // HTML -> well-formed XML, required by SVG
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ab.width}" height="${ab.height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${ab.width}px;height:${ab.height}px;background:#fff;overflow:hidden;font-family:system-ui,sans-serif;${themeDecls().replace(/"/g, '&quot;')}">${xhtml.replace(/^<div[^>]*>|<\/div>$/g, '')}</div></foreignObject></svg>`;
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(crop.w * scale));
  canvas.height = Math.max(1, Math.round(crop.h * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // JPEG has no alpha: without this, transparent areas turn black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.drawImage(img, -crop.x, -crop.y); // shifting the origin is how the crop is taken
  return canvas;
}

// Token-lean defaults (an image costs one token per 28x28 px patch): 1x, at most 1000 px wide,
// JPEG at quality 0.8 (heavier compression blurs small text). Callers can ask for more.
// With nodeId the picture is cropped to that node's box, measured in artboard units from the
// live DOM (the node must be laid out, so we mount the board if it was showing a bitmap).
async function rasterize(artboardId, { nodeId, scale = 1, maxWidth = 1000, format = 'jpeg' } = {}) {
  const ab = doc.artboards.find((a) => a.id === artboardId);
  if (!ab) throw new Error('Artboard not found');
  let crop;
  if (nodeId) {
    const el = findElement(nodeId, { mount: true });
    const frame = abEls.get(abOf(nodeId))?.querySelector('.frame');
    if (!el || !frame) throw new Error('Node not found on the canvas');
    const f = frame.getBoundingClientRect(), r = el.getBoundingClientRect();
    const k = f.width / ab.width; // on-screen pixels per artboard unit (the current zoom)
    crop = { x: (r.left - f.left) / k, y: (r.top - f.top) / k, w: r.width / k, h: r.height / k };
  }
  const w = crop?.w ?? ab.width;
  const eff = Math.min(scale, maxWidth / w); // never exceed maxWidth, whatever scale was asked
  const canvas = await rasterizeCanvas(ab, eff, crop);
  return format === 'png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.8);
}
const abOf = (id) => (id.startsWith('A') ? id : pidIndex.get(id));

// ---- Project header: name, export ------------------------------------------

const nameInput = $('#pname');
let savedName = '';
events.addEventListener('meta', (e) => {
  const meta = JSON.parse(e.data);
  savedName = meta.name;
  // Don't overwrite what the user is typing if a rename arrives from elsewhere.
  if (document.activeElement !== nameInput) nameInput.value = meta.name;
  document.title = `${meta.name} · Design Canvas`;
});
const commitName = () => {
  const v = nameInput.value.trim();
  if (v && v !== savedName) post(`${papi}/rename`, { name: v });
  else nameInput.value = savedName;
};
nameInput.addEventListener('blur', commitName);
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') nameInput.blur();
  if (e.key === 'Escape') { nameInput.value = savedName; nameInput.blur(); }
});
$('#export').href = `${papi}/export`;
$('#save').onclick = async () => {
  await post(`${papi}/snapshot`, { label: 'Saved version' });
  toast('Version saved');
  if (panelOpen() && panelTab === 'versions') loadVersions();
};

// ---- Side drawer ------------------------------------------------------------

const panel = $('#panel');
let panelTab = 'activity';
const panelOpen = () => panel.classList.contains('open');

function openPanel(tab) {
  panelTab = tab || panelTab;
  panel.classList.add('open');
  panel.inert = false;
  for (const b of panel.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === panelTab));
  for (const p of panel.querySelectorAll('.pane')) p.classList.toggle('on', p.dataset.pane === panelTab);
  loaders[panelTab]();
}
function closePanel() { panel.classList.remove('open'); panel.inert = true; }
for (const b of panel.querySelectorAll('.tabs button')) b.onclick = () => openPanel(b.dataset.tab);
$('#panel-close').onclick = closePanel;
$('#hist').onclick = () => (panelOpen() && ['activity', 'versions'].includes(panelTab) ? closePanel() : openPanel(['activity', 'versions'].includes(panelTab) ? panelTab : 'activity'));
$('#open-tokens').onclick = () => (panelOpen() && panelTab === 'tokens' ? closePanel() : openPanel('tokens'));

// Reload a tab shortly after a burst of changes.
const timers = {};
function refreshSoon(tab) {
  clearTimeout(timers[tab]);
  timers[tab] = setTimeout(() => { if (panelOpen() && panelTab === tab) loaders[tab](); }, 500);
}
const pane = (name) => panel.querySelector(`[data-pane="${name}"]`);

async function loadVersions() {
  const list = await (await fetch(`${papi}/snapshots`)).json();
  pane('versions').replaceChildren(...(list.length ? list.map((s) => h('div', { class: 'snap' },
    h('div', {}, h('b', {}, s.label), h('small', {}, `${ago(s.createdAt)} · ${s.artboards} artboard${s.artboards === 1 ? '' : 's'}`)),
    h('button', { class: 'sm', onclick: async () => { await post(`${papi}/restore-snapshot`, { snapshotId: s.id }); toast('Restored. The previous state is saved too.'); loadVersions(); } }, 'Restore'),
  )) : [h('div', { class: 'empty' }, 'No versions yet. They are saved automatically while you work.')]));
}

const TOOL_LABEL = { create_artboard: 'Created artboard', write_html: 'Wrote HTML', update_styles: 'Updated styles', set_text_content: 'Edited text', delete_nodes: 'Deleted', duplicate_nodes: 'Duplicated', rename_nodes: 'Renamed', set_tokens: 'Changed tokens', undo: 'Undid a change' };
async function loadActivity() {
  const runs = await (await fetch(`${api}/activity`)).json();
  pane('activity').replaceChildren(...(runs.length ? runs.map((r) => h('div', { class: 'run' },
    h('div', { class: 'body', style: 'min-width:0;flex:1' },
      h('div', { class: 'q' }, r.prompt ? `“${r.prompt}”` : 'Edits'),
      h('small', {}, ago(r.t)),
      h('div', { class: 'chips' }, r.actions.map((a) => h('span', { class: 'chip' },
        `${TOOL_LABEL[a.tool] || a.tool}${a.count > 1 ? ` ×${a.count}` : ''}${a.artboards.length ? ` · ${a.artboards.slice(0, 2).join(', ')}${a.artboards.length > 2 ? '…' : ''}` : ''}`)))),
    r.restorable ? h('button', { class: 'sm', title: 'Restore the project to how it was before this request', onclick: async () => { await post(`${papi}/restore-snapshot`, { snapshotId: r.snapshotId }); toast('Undid this request. Redo it from the Versions tab.'); } }, 'Undo') : null,
  )) : [h('div', { class: 'empty' }, 'Nothing yet. Requests you give Claude and the changes it makes will appear here.')]));
}
events.addEventListener('activity', () => { if (panelTab === 'activity') refreshSoon('activity'); });

let tokenData = null;
async function loadTokens() {
  const box = pane('tokens');
  let t;
  try { t = tokenData = await (await fetch(`${api}/tokens`)).json(); } catch { box.textContent = 'Could not read tokens.'; return; }
  if (!t.summary.styledElements) { box.replaceChildren(h('div', { class: 'empty' }, 'No styled elements yet. Tokens appear once there is a design to scan.')); return; }
  const copy = async (text, what) => {
    try { await navigator.clipboard.writeText(text); toast(`Copied ${what}`); } catch { toast('Copy failed: select it manually'); }
  };
  const swatch = (c) => h('button', { class: 'sw', title: `${c.oklch}\n${c.value} · used ${c.count}×`, onclick: () => copy(c.oklch, c.name) },
    h('i', { style: `background:${c.oklch}` }), h('b', {}, c.name), h('small', {}, `${c.value.startsWith('#') ? c.value : ''} ×${c.count}`));
  const maxSpace = Math.max(...t.spacing.map((s) => s.count), 1);
  box.replaceChildren(h('div', { class: 'tk' },
    h('h4', {}, `Colour · OKLCH (${t.colors.length})`),
    h('div', { class: 'sw-grid' }, t.colors.map(swatch)),
    t.overlays.length ? [h('h4', {}, 'Overlays'), h('div', { class: 'sw-grid' }, t.overlays.map(swatch))] : null,
    h('h4', {}, 'Type'),
    t.fontFamilies.map((f) => h('div', { class: 'kv' }, h('span', { style: `font-family:${f.value.replace(/[;"<>]/g, '')}` }, f.name), h('span', {}, `×${f.count}`))),
    h('div', { class: 'kv' }, h('span', {}, 'Sizes'), h('span', {}, t.fontSizes.map((s) => s.value.replace('px', '')).join(' · '))),
    h('div', { class: 'kv' }, h('span', {}, 'Weights'), h('span', {}, t.fontWeights.map((w) => w.value).join(' · '))),
    h('h4', {}, 'Radius'),
    h('div', { class: 'chips' }, t.radii.map((r) => h('span', { class: 'chip' }, r.value))),
    h('h4', {}, t.summary.spacingBase ? `Spacing · ${t.summary.spacingBase}px grid` : 'Spacing · no consistent grid'),
    t.spacing.map((s) => h('div', { class: 'kv', style: 'align-items:center' }, h('span', { style: 'width:42px' }, s.value), h('div', { class: 'bar', style: `width:${Math.max(4, (s.count / maxSpace) * 150)}px;opacity:${s.onGrid === false ? 0.4 : 1}` }), h('span', {}, `×${s.count}`))),
    t.shadows.length ? [h('h4', {}, 'Shadows'), t.shadows.map((s) => h('div', { class: 'kv' }, h('span', { style: 'padding:10px 14px;border-radius:8px;background:oklch(0.93 0.003 285)' }, h('i', { style: `display:block;width:56px;height:28px;border-radius:6px;background:oklch(1 0 0);box-shadow:${s.value.replace(/[;<>]/g, '')}` })), h('span', {}, `×${s.count}`)))] : null,
    h('div', { class: 'exports' },
      h('button', { class: 'sm primary', onclick: () => copy(t.outputs.css, 'CSS variables') }, 'Copy CSS'),
      h('button', { class: 'sm', onclick: () => copy(t.outputs.json, 'JSON tokens') }, 'Copy JSON'),
      h('button', { class: 'sm', onclick: () => copy(t.outputs.tailwind, 'Tailwind config') }, 'Copy Tailwind')),
  ));
}

// MCP tab: is Claude talking to this server, how to connect it, and which tools cost the most
// tokens this session (estimates from the server's meter). Polled while the tab is open because
// tool calls come from Claude Code, not from this page, so there is no event to wait for.
let mcpPoll;
async function loadMcp() {
  clearInterval(mcpPoll);
  mcpPoll = setInterval(() => { if (panelOpen() && panelTab === 'mcp') loadMcp(); else clearInterval(mcpPoll); }, 3000);
  let s;
  try { s = await (await fetch('/api/status')).json(); } catch { pane('mcp').textContent = 'Server not reachable.'; return; }
  const setup = `claude mcp add --transport http design-canvas ${location.origin}/mcp --scope user`;
  const m = s.meter, maxTok = Math.max(...m.tools.map((t) => t.tokens), 1);
  const recent = m.lastCallAt && Date.now() - m.lastCallAt < 120_000;
  pane('mcp').replaceChildren(h('div', { class: 'tk' },
    h('div', { class: 'kv' }, h('span', {}, 'Server'), h('span', {}, `running · ${s.tabs} tab${s.tabs === 1 ? '' : 's'} open`)),
    h('div', { class: 'kv' }, h('span', {}, 'Claude'), h('span', {}, m.lastCallAt ? `${recent ? 'active' : 'idle'} · last call ${ago(m.lastCallAt)}` : 'no calls yet')),
    h('h4', {}, 'Connect'),
    h('div', { class: 'code' }, setup),
    h('div', { class: 'exports' }, h('button', { class: 'sm primary', onclick: async () => { try { await navigator.clipboard.writeText(setup); toast('Copied setup command'); } catch { toast('Copy failed: select it manually'); } } }, 'Copy command')),
    h('h4', {}, `Tool results this session · ~${m.totalTokens.toLocaleString()} tokens`),
    m.tools.length ? m.tools.map((t) => h('div', { class: 'kv', style: 'align-items:center' },
      h('span', { style: 'width:130px;overflow:hidden;text-overflow:ellipsis' }, t.name),
      h('div', { class: 'bar', style: `width:${Math.max(4, (t.tokens / maxTok) * 110)}px` }),
      h('span', {}, `${t.tokens.toLocaleString()} · ×${t.calls}${t.errors ? ` · ${t.errors} err` : ''}`)))
      : h('div', { class: 'empty' }, 'No tool calls yet. Estimates: text bytes ÷ 4, images by 28px patches.'),
  ));
}

// Theme tab: edit the project's design tokens. Every edit goes to the server (one undo step,
// visible to Claude through get_design_system) and comes back through the doc event, which
// restyles the boards. Not to be confused with the Tokens tab, which only *reads* what the
// designs already use.
async function postTheme(body) {
  markUserEdit();
  const r = await post(`${api}/theme`, body);
  if (!r.ok) toast((await r.json().catch(() => ({}))).error || 'Could not save the token');
}
const modeArg = () => (themeMode === 'base' ? undefined : themeMode);

function loadTheme() {
  const box = pane('theme');
  const t = doc.theme ?? { tokens: {}, modes: {} };
  if (!Object.keys(t.tokens).length) {
    box.replaceChildren(h('div', { class: 'empty' }, 'No tokens yet. Tokens are CSS variables (var(--color-primary)) that every board can share, so one edit restyles the whole design.'),
      h('div', { class: 'exports' }, h('button', { class: 'sm primary', onclick: () => postTheme({ preset: 'starter' }) }, 'Load starter scale')));
    return;
  }
  const modes = Object.keys(t.modes ?? {});
  if (themeMode !== 'base' && !modes.includes(themeMode)) themeMode = 'base';
  const seg = ['base', ...modes].map((m) => h('button', { class: `sm${m === themeMode ? ' primary' : ''}`, onclick: () => { themeMode = m; applyTheme(); loadTheme(); } }, m === 'base' ? 'Base' : m));
  if (!modes.includes('dark')) {
    // Seed the new mode with the colour tokens so there is something to edit.
    const colours = Object.fromEntries(Object.entries(t.tokens).filter(([k]) => k.startsWith('color-')));
    seg.push(h('button', { class: 'sm', title: 'Add a dark mode that overrides the colour tokens', onclick: () => postTheme({ tokens: colours, mode: 'dark' }) }, '+ dark'));
  }

  const overrides = themeMode === 'base' ? {} : t.modes[themeMode] ?? {};
  const row = (name) => {
    const base = t.tokens[name];
    const inherited = themeMode !== 'base' && !(name in overrides);
    const input = h('input', { class: 'tok-in', 'aria-label': name, spellcheck: 'false' });
    input.value = inherited ? '' : (themeMode === 'base' ? base : overrides[name]); // .value, never innerHTML
    if (inherited) input.placeholder = base;
    input.onchange = () => {
      const v = input.value.trim();
      // Empty in a mode view means "stop overriding"; empty in the base view is ignored.
      if (!v && themeMode === 'base') { input.value = base; return; }
      postTheme({ tokens: { [name]: v || null }, mode: modeArg() });
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); };
    const shown = inherited ? base : input.value;
    const sw = name.startsWith('color-') && CSS.supports('color', shown) ? h('i', { class: 'tok-sw', style: `background:${shown}` }) : h('i', { class: 'tok-sw none' });
    const del = themeMode === 'base' ? h('button', { class: 'icon tok-del', 'aria-label': `Delete ${name}`, title: 'Delete token', onclick: () => postTheme({ tokens: { [name]: null } }) }, '×') : null;
    return h('div', { class: 'tok' }, sw, h('span', { class: 'tok-name', title: `var(--${name})` }, name), input, del);
  };

  const byFamily = new Map();
  for (const name of Object.keys(t.tokens)) {
    const f = name.split('-')[0];
    byFamily.set(f, [...(byFamily.get(f) ?? []), name]);
  }
  const addName = h('input', { class: 'tok-in', placeholder: 'color-accent', 'aria-label': 'New token name', spellcheck: 'false' });
  const addValue = h('input', { class: 'tok-in', placeholder: 'oklch(0.7 0.15 30)', 'aria-label': 'New token value', spellcheck: 'false' });
  const add = () => { if (addName.value.trim() && addValue.value.trim()) postTheme({ tokens: { [addName.value.trim()]: addValue.value.trim() } }); };
  addValue.onkeydown = (e) => { if (e.key === 'Enter') add(); };

  box.replaceChildren(h('div', { class: 'tk' },
    h('div', { class: 'exports', style: 'margin:0 0 8px' }, seg),
    themeMode !== 'base' ? h('small', { class: 'tok-hint' }, 'Only tokens you fill in are overridden in this mode; empty ones inherit the base value.') : null,
    [...byFamily].map(([f, names]) => [h('h4', {}, f), names.map(row)]),
    themeMode === 'base' ? [h('h4', {}, 'Add token'), h('div', { class: 'tok-add' }, addName, addValue, h('button', { class: 'sm primary', onclick: add }, 'Add'))] : null,
  ));
}
// A Theme tab that is open must follow edits made by Claude, but never rebuild while someone is typing in it.
const refreshTheme = () => { if (panelOpen() && panelTab === 'theme' && !pane('theme').contains(document.activeElement)) loadTheme(); };

const loaders = { comments: () => renderCommentList(), activity: loadActivity, versions: loadVersions, tokens: loadTokens, mcp: loadMcp, theme: loadTheme };

// ---- Comments ---------------------------------------------------------------

let showResolved = false;
const numberOf = (c) => comments.findIndex((x) => x.id === c.id) + 1; // stable: order of creation
const elementLabel = (c) => {
  const el = findElement(c.targetId, { mount: true });
  if (!el) return 'element removed';
  const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  return `${c.targetId.startsWith('A') ? 'artboard' : el.tagName.toLowerCase()}${t ? ` “${t}”` : ''}`;
};

function setCommentMode(on) {
  commentMode = on;
  viewport.classList.toggle('commenting', on);
  $('#comment-mode').setAttribute('aria-pressed', String(on));
  if (on) { select(null); } else closePop();
}
$('#comment-mode').onclick = () => { setCommentMode(!commentMode); if (commentMode) toast('Click an element to pin a comment. Esc to stop.'); };

// /p/<id>?comment=<commentId> (from the Comments page): jump to that comment once everything has loaded.
let deepLink = new URLSearchParams(location.search).get('comment');
events.addEventListener('comments', (e) => {
  comments = JSON.parse(e.data);
  const target = deepLink && doc.artboards.length && comments.find((x) => x.id === deepLink);
  if (target) { deepLink = null; setTimeout(() => focusComment(target), 500); }
  const open = comments.filter((c) => !c.resolved).length;
  $('#c-badge').hidden = !open;
  $('#c-badge').textContent = open;
  schedulePins();
  if (panelOpen() && panelTab === 'comments') renderCommentList();
  if (popFor) { const c = comments.find((x) => x.id === popFor); c ? openThread(c.id, true) : closePop(); }
});

function renderCommentList() {
  const list = comments.filter((c) => showResolved || !c.resolved);
  const filter = h('div', { class: 'filter' },
    h('button', { class: 'sm', 'aria-pressed': String(!showResolved), onclick: () => { showResolved = false; renderCommentList(); } }, 'Open'),
    h('button', { class: 'sm', 'aria-pressed': String(showResolved), onclick: () => { showResolved = true; renderCommentList(); } }, 'All'));
  pane('comments').replaceChildren(filter, ...(list.length ? list.map((c) => h('div', { class: 'cm' + (c.resolved ? ' resolved' : ''), onclick: () => focusComment(c) },
    h('span', { class: 'num' }, numberOf(c)),
    h('div', { class: 'body' }, h('p', {}, c.text),
      h('small', {}, `${c.author === 'claude' ? 'Claude' : 'You'} · ${ago(c.createdAt)} · ${elementLabel(c)}${c.replies.length ? ` · ${c.replies.length} repl${c.replies.length === 1 ? 'y' : 'ies'}` : ''}${c.resolved ? ' · resolved' : ''}`)),
  )) : [h('div', { class: 'empty' }, showResolved ? 'No comments yet.' : 'No open comments. Press C, then click an element to leave one. Claude reads them and replies.')]));
}

function focusComment(c) {
  if (view.k < 0.3) { // from the zoomed-out overview: zoom in about the screen centre first, so the pin is readable
    const w = viewport.clientWidth, vh = viewport.clientHeight, k = 0.6;
    view.x = w / 2 - ((w / 2 - view.x) / view.k) * k;
    view.y = vh / 2 - ((vh / 2 - view.y) / view.k) * k;
    view.k = k;
    applyView();
    world.style.transition = ''; // the style write above is applied synchronously, so panTo can measure it
  }
  if (panTo(c.targetId)) setTimeout(() => openThread(c.id), 0);
  else toast('That element no longer exists.');
}

// Pins: one button per visible comment, positioned over its element. Buttons are reused
// between frames (only left/top change) so panning is cheap and the pop-in only plays once.
let pinRaf = 0;
const pinEls = new Map();
function schedulePins() { if (!pinRaf) pinRaf = requestAnimationFrame(() => { pinRaf = 0; layoutPins(); }); }
function layoutPins() {
  const layer = $('#pins');
  const live = new Set();
  const perTarget = new Map();
  for (const c of comments) {
    if (c.resolved && !showResolved) continue;
    const el = findElement(c.targetId);
    if (!el) continue; // orphaned comments stay reachable from the Comments tab
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    live.add(c.id);
    const slot = perTarget.get(c.targetId) ?? 0; // several comments on one element fan out leftwards
    perTarget.set(c.targetId, slot + 1);
    let pin = pinEls.get(c.id);
    if (!pin) {
      pin = h('button', { class: 'pin', 'aria-label': 'Open comment', onpointerdown: (e) => e.stopPropagation(), onclick: () => openThread(c.id) });
      layer.append(pin);
      pinEls.set(c.id, pin);
    }
    pin.textContent = numberOf(c);
    pin.classList.toggle('resolved', c.resolved);
    pin.style.left = `${Math.min(r.right, innerWidth - 16) - slot * 28}px`;
    pin.style.top = `${Math.max(r.top, 44) - 44}px`;
  }
  for (const [id, pin] of pinEls) if (!live.has(id)) { pin.remove(); pinEls.delete(id); }
}
addEventListener('resize', schedulePins);

// Popover (new comment or thread). Position near the anchor; scale-in grows from that point.
let popFor = null; // id of the comment whose thread is open
function placePop(x, y) {
  const pop = $('#pop');
  pop.hidden = false;
  const w = 300, hgt = pop.offsetHeight;
  const left = Math.max(8, Math.min(x + 14, innerWidth - w - 8));
  const top = Math.max(52, Math.min(y - 8, innerHeight - hgt - 8));
  Object.assign(pop.style, { left: left + 'px', top: top + 'px', transformOrigin: `${x - left}px ${y - top}px` });
}
function closePop() { $('#pop').hidden = true; popFor = null; }
document.addEventListener('pointerdown', (e) => { if (!$('#pop').hidden && !e.target.closest('#pop, .pin, .cm')) closePop(); }, true);

function openNewComment(targetId, x, y) {
  const pop = $('#pop');
  popFor = null;
  const ta = h('textarea', { placeholder: 'What should change? Claude will read this.', 'aria-label': 'Comment' });
  const send = async () => {
    if (!ta.value.trim()) return;
    const r = await post(`${api}/comment-add`, { targetId, text: ta.value });
    if (!r.ok) { toast('Could not add the comment'); return; }
    closePop();
    setCommentMode(false);
    toast('Comment pinned. Ask Claude to address it.');
  };
  ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); if (e.key === 'Escape') { e.stopPropagation(); closePop(); } };
  pop.replaceChildren(
    h('div', { class: 'target-tag' }, `On ${elementLabel({ targetId })}`), ta,
    h('div', { class: 'pop-actions' }, h('span', { class: 'grow' }), h('button', { class: 'sm', onclick: closePop }, 'Cancel'), h('button', { class: 'sm primary', onclick: send }, 'Comment')));
  pop.style.animation = 'none'; void pop.offsetWidth; pop.style.animation = ''; // replay the entrance
  placePop(x, y);
  // A real click moves focus to the page *after* this handler runs, which would steal it back
  // from the textarea. Focusing on the next tick wins that race.
  setTimeout(() => ta.focus(), 0);
}

function openThread(id, keepPosition = false) {
  const c = comments.find((x) => x.id === id);
  if (!c) return;
  const pop = $('#pop');
  const sameOpen = popFor === id && !pop.hidden;
  popFor = id;
  const msg = (author, text, t) => h('div', { class: 'msg' }, h('b', { class: author === 'claude' ? 'claude' : '' }, author === 'claude' ? 'Claude' : 'You'), h('small', {}, ago(t)), h('p', {}, text));
  const ta = h('textarea', { placeholder: 'Reply…', 'aria-label': 'Reply' });
  const reply = async () => { if (ta.value.trim()) { await post(`${api}/comment-reply`, { commentId: id, text: ta.value }); } };
  ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) reply(); };
  pop.replaceChildren(
    h('div', { class: 'target-tag' }, `#${numberOf(c)} · ${elementLabel(c)}`),
    msg(c.author, c.text, c.createdAt), ...c.replies.map((r) => msg(r.author, r.text, r.createdAt)), ta,
    h('div', { class: 'pop-actions' },
      h('button', { class: 'sm danger', onclick: async () => { await post(`${api}/comment-delete`, { commentId: id }); closePop(); } }, 'Delete'),
      h('span', { class: 'grow' }),
      h('button', { class: 'sm', onclick: async () => { await post(`${api}/comment-resolve`, { commentId: id, resolved: !c.resolved }); if (!c.resolved) closePop(); } }, c.resolved ? 'Reopen' : 'Resolve'),
      h('button', { class: 'sm primary', onclick: reply }, 'Reply')));
  if (keepPosition && sameOpen) { pop.hidden = false; return; } // live update while open: don't move or re-animate
  pop.style.animation = 'none'; void pop.offsetWidth; pop.style.animation = '';
  const pin = pinEls.get(id);
  const r = pin ? pin.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
  placePop(r.left + r.width / 2, r.top + r.height / 2);
}

// ---- Viewing a project makes it the active one -------------------------------
// We claim it when the tab loads or becomes visible (not on every stream reconnect), so a
// stale background tab can't steal the "active project" from the one you are looking at.
const claimActive = () => { if (document.visibilityState === 'visible') post(`${papi}/activate`, {}); };
claimActive();
document.addEventListener('visibilitychange', claimActive);

// ---- Layers panel ---------------------------------------------------------------
layers = initLayers({
  h, markUserEdit, getDoc: () => doc, getSelected: () => selected, select, post, api, toast, abOf,
  onHover: (id) => { hoverId = id; drawHover(); },
});
$('#open-layers').onclick = () => layers.toggle();
