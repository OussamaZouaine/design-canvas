// Browser side of a project: renders the document on an infinite pan/zoom canvas, plays the
// "Claude is designing" animation, handles comment pins, and drives the side drawer
// (comments, activity, versions, tokens). Everything user-visible that Claude or a
// collaborator wrote is inserted with textContent / DOM nodes, never innerHTML.
const $ = (s) => document.querySelector(s);
const viewport = $('#viewport');
const world = $('#world');
const selBox = $('#sel');

// The canvas lives at /p/<projectId>; every API call is scoped to that project.
const projectId = location.pathname.split('/')[2];
const api = `/api/p/${projectId}`;
const papi = `/api/projects/${projectId}`;

let doc = { artboards: [] };
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
// every frame. We only keep an artboard's HTML mounted in its shadow root when it is (a) near
// the viewport and (b) big enough on screen to actually read. Everything else shows a cheap
// placeholder with the artboard's name. The document data is untouched; this is purely a
// rendering optimisation ("virtualisation" / level of detail).
const MOUNT_MARGIN = 500;    // screen px around the viewport inside which boards get mounted
const UNMOUNT_MARGIN = 1600; // boards only unmount well past that, so small back-and-forth pans don't thrash
const MIN_SCREEN_W = 150;    // narrower than this on screen = placeholder, unreadable anyway
const abEls = new Map();     // artboard id -> its DOM element
const pidIndex = new Map();  // node id (data-pid) -> artboard id, so lookups don't scan every shadow root

function mountFrame(el, ab) {
  const frame = el.querySelector('.frame');
  if (frame._shown === ab.html) return false;
  const oldHtml = frame._shown ?? '';
  frame.shadowRoot.innerHTML = `<style>:host{all:initial;display:block;font-family:system-ui,sans-serif}</style><div style="position:relative;width:100%;height:100%">${ab.html}</div>`;
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
  for (const ab of doc.artboards) {
    const el = abEls.get(ab.id);
    if (!el) continue;
    // Screen-space rectangle computed from the data (no layout read, so it's free).
    const left = view.x + ab.x * view.k, top = view.y + ab.y * view.k;
    const w = ab.width * view.k, ht = ab.height * view.k;
    const dist = (m) => left < vw + m && left + w > -m && top < vh + m && top + ht > -m;
    const readable = w >= MIN_SCREEN_W;
    const mounted = el.querySelector('.frame')._shown != null;
    const pinned = el._pin > now; // Claude is drawing here right now: keep it live
    if (pinned || (readable && dist(MOUNT_MARGIN))) mountFrame(el, ab);
    else if (mounted && (!readable || !dist(UNMOUNT_MARGIN))) unmountFrame(el);
  }
  // Placeholder names are counter-scaled so they stay ~15 screen px at any zoom.
  world.style.setProperty('--lod-size', `${Math.min(260, 15 / view.k)}px`);
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
  world.style.transition = 'transform 420ms cubic-bezier(0.77, 0, 0.175, 1)';
  setTimeout(() => (world.style.transition = ''), 460);
  applyView();
};

// Reveal newly written elements with a short stagger. We diff element ids against the
// previous HTML, find the roots of the new subtrees, then animate those roots' children
// (down to 2 levels) so a single giant wrapper doesn't fade in as one lump.
function revealNew(shadow, oldHtml) {
  const oldIds = new Set(oldHtml.match(/data-pid="N\d+"/g) || []);
  const fresh = new Set([...shadow.querySelectorAll('[data-pid]')].filter((n) => !oldIds.has(`data-pid="${n.dataset.pid}"`)));
  if (!fresh.size || fresh.size > 250) return; // nothing new, or a bulk restore/import: don't animate
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
}

// Each artboard's HTML goes in a shadow root so the design's CSS (and our UI's)
// can't leak into each other. Shadow DOM = style encapsulation built into the browser.
let pendingFollow = false;
function render({ animate = false } = {}) {
  const seen = new Set();
  // If a lot of artboards change at once it is a restore/import, not Claude drawing: stay calm.
  const changed = doc.artboards.filter((ab) => {
    const el = abEls.get(ab.id);
    return !el || el.querySelector('.frame')._html !== ab.html;
  });
  const showGen = animate && changed.length <= 3;

  for (const ab of doc.artboards) {
    seen.add(ab.id);
    let el = abEls.get(ab.id);
    const isNew = !el;
    if (!el) {
      el = h('div', { class: 'artboard lod', 'data-ab': ab.id },
        h('div', { class: 'label' }, h('span', { class: 'name' }), h('span', { class: 'status' }, h('i'), 'Designing')),
        h('div', { class: 'ring' }, h('div', { class: 'ring-spin' })),
        h('div', { class: 'frame' }),
        h('div', { class: 'lod-name' }),
        h('div', { class: 'shimmer' }, 'Claude is designing…'));
      el.querySelector('.frame').attachShadow({ mode: 'open' });
      world.appendChild(el);
      abEls.set(ab.id, el);
      if (showGen) {
        pendingFollow = true;
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
      indexPids(ab);
      if (showGen) {
        // Claude is writing here: mount it (even if tiny/offscreen) so the reveal can play.
        el._pin = Date.now() + 4000;
        mountFrame(el, ab);
        touchGen(el);
        if (!isNew || ab.html) revealNew(frame.shadowRoot, frame._oldHtml ?? '');
      } else if (frame._shown != null) {
        mountFrame(el, ab); // already on screen: refresh in place
      }
    }
  }
  for (const [id, el] of abEls) if (!seen.has(id)) { el.remove(); abEls.delete(id); }
  updateVisibility();
  drawSelection();
  schedulePins();
  if (pendingFollow) { pendingFollow = false; followNewArtboard(); }
}

// node id -> artboard id. Built from the HTML text, so it also works for unmounted artboards.
function indexPids(ab) {
  for (const [pid, abId] of pidIndex) if (abId === ab.id) pidIndex.delete(pid);
  for (const m of ab.html.matchAll(/data-pid="([^"]+)"/g)) pidIndex.set(m[1], ab.id);
}

// A new artboard that lands outside the visible area would be drawn where nobody can see it.
// Glide the view to fit everything, unless the user is actively driving the canvas.
function followNewArtboard() {
  if (Date.now() - lastTouch < 4000) return;
  const last = world.querySelector('.artboard:last-of-type');
  if (!last) return;
  const r = last.querySelector('.frame').getBoundingClientRect();
  const visible = r.left >= 0 && r.top >= 44 && r.right <= innerWidth - (panelOpen() ? 340 : 0) && r.bottom <= innerHeight;
  if (visible) return;
  if (!reduceMotion.matches) {
    // Moving something already on screen: ease-in-out, 420ms. The transition is removed afterwards
    // so normal panning and zooming stay instant.
    world.style.transition = 'transform 420ms cubic-bezier(0.77, 0, 0.175, 1)';
    setTimeout(() => (world.style.transition = ''), 460);
  }
  fit();
}

// Outline the selected element. getBoundingClientRect already accounts for the
// world transform, so the box lands in the right place at any pan/zoom.
function drawSelection() {
  const target = selected && findElement(selected);
  if (!target) { selBox.hidden = true; return; }
  const r = target.getBoundingClientRect();
  Object.assign(selBox.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  selBox.hidden = false;
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
    else select(null);
  }
  if (e.key.toLowerCase() === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey && $('#pop').hidden) setCommentMode(!commentMode);
  if ((e.metaKey || e.ctrlKey) && e.key === 'd' && selected) { e.preventDefault(); post(`${api}/duplicate`, { ids: [selected] }); }
});

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
  $('#hint').hidden = doc.artboards.length > 0;
  // Fit on load, and again when the first artboard ever appears (an empty doc has nothing to fit).
  if (firstDoc || (!hadArtboards && doc.artboards.length)) { firstDoc = false; fit(); }
  if (panelTab === 'tokens' && panelOpen()) refreshSoon('tokens');
});
events.addEventListener('screenshot', async (e) => {
  const { id, artboardId } = JSON.parse(e.data);
  try {
    await post(`${api}/screenshot`, { id, dataUrl: await rasterize(artboardId) });
  } catch (err) {
    await post(`${api}/screenshot`, { id, error: String(err.message || err) });
  }
});

// Turn an artboard's HTML into a PNG: wrap it in an SVG <foreignObject>, load that as an
// image, then draw the image onto a canvas. Limit: only inline styles and data: images
// survive, since the SVG is rendered in isolation.
async function rasterize(artboardId) {
  const ab = doc.artboards.find((a) => a.id === artboardId);
  if (!ab) throw new Error('Artboard not found');
  const holder = document.createElement('div');
  holder.innerHTML = ab.html;
  const xhtml = new XMLSerializer().serializeToString(holder); // HTML -> well-formed XML, required by SVG
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ab.width}" height="${ab.height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${ab.width}px;height:${ab.height}px;background:#fff;overflow:hidden;font-family:system-ui,sans-serif">${xhtml.replace(/^<div[^>]*>|<\/div>$/g, '')}</div></foreignObject></svg>`;
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const scale = Math.min(2, 2000 / ab.width); // 2x for sharpness, capped to keep payloads small
  const canvas = document.createElement('canvas');
  canvas.width = ab.width * scale;
  canvas.height = ab.height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL('image/png');
}

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

const TOOL_LABEL = { create_artboard: 'Created artboard', write_html: 'Wrote HTML', update_styles: 'Updated styles', set_text_content: 'Edited text', delete_nodes: 'Deleted', duplicate_nodes: 'Duplicated', rename_nodes: 'Renamed' };
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

const loaders = { comments: () => renderCommentList(), activity: loadActivity, versions: loadVersions, tokens: loadTokens };

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

events.addEventListener('comments', (e) => {
  comments = JSON.parse(e.data);
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
