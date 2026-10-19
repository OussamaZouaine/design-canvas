// Project home: lists every project as a card with a live preview of its cover artboard.
// Names/descriptions can come from Claude, so they are always inserted with textContent
// (never innerHTML) to keep them from injecting markup.
const $ = (s) => document.querySelector(s);
const grid = $('#grid');

let live = []; // projects
let trashed = []; // projects in Trash
let inTrash = false;
let firstRender = true;

const postJson = (url, body = {}) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText); return r.json(); });

const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 14) return `${Math.round(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString();
};

// ---- Data ----------------------------------------------------------------

async function load() {
  [live, trashed] = await Promise.all([
    fetch('/api/projects').then((r) => r.json()),
    fetch('/api/projects?deleted=1').then((r) => r.json()),
  ]);
  render();
  // Open-comment count on the Comments link (cheap: one small request per reload)
  fetch('/api/comments').then((r) => r.json()).then((cs) => {
    const n = cs.filter((c) => !c.resolved).length;
    const badge = $('#c-open');
    badge.textContent = n;
    badge.hidden = !n;
  }).catch(() => {});
}

// Reload shortly after a burst of changes (Claude can fire many edits per second).
let reloadTimer;
const reloadSoon = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(load, 300); };

// ---- Rendering -------------------------------------------------------------

function visible() {
  const q = $('#search').value.trim().toLowerCase();
  const sort = $('#sort').value;
  const list = (inTrash ? trashed : live).filter((p) => !q || `${p.name} ${p.description}`.toLowerCase().includes(q));
  const by = { recent: (a, b) => b.updatedAt - a.updatedAt, created: (a, b) => b.createdAt - a.createdAt, name: (a, b) => a.name.localeCompare(b.name) };
  return list.sort(by[sort]);
}

// Scaled-down live preview of the cover artboard. The artboard HTML is rendered at its
// real size inside a shadow root, then shrunk with a CSS transform to fit the 320px card.
function thumb(p) {
  const el = document.createElement('div');
  el.className = 'thumb';
  if (!p.cover) {
    el.innerHTML = '<div class="none">Empty project</div>';
    return el;
  }
  const frame = document.createElement('div');
  frame.className = 'frame';
  frame.style.width = p.cover.width + 'px';
  frame.style.height = p.cover.height + 'px';
  frame.style.transform = `scale(${320 / p.cover.width})`;
  frame.attachShadow({ mode: 'open' }).innerHTML =
    `<style>:host{all:initial;display:block;font-family:system-ui,sans-serif}</style><div style="position:relative;width:100%;height:100%">${p.cover.html}</div>`;
  el.append(frame);
  return el;
}

function card(p) {
  const c = document.createElement('div');
  c.className = 'card' + (inTrash ? ' trashed' : '');
  const body = document.createElement('div');
  body.className = 'body';
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = p.name;
  const desc = document.createElement('div');
  desc.className = 'desc';
  desc.textContent = p.description || ' ';
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${p.artboardCount} artboard${p.artboardCount === 1 ? '' : 's'} · ${inTrash ? 'deleted ' + ago(p.deletedAt) : 'edited ' + ago(p.updatedAt)}`;
  if (p.active && !inTrash) {
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent = 'Claude is here';
    pill.title = 'The project Claude will use unless told otherwise';
    meta.append(pill);
  }
  body.append(name, desc, meta);

  const more = document.createElement('button');
  more.className = 'more';
  more.textContent = '⋯';
  more.setAttribute('aria-label', `Actions for ${p.name}`);
  more.onclick = (e) => { e.stopPropagation(); openMenu(more, p, name); };

  c.append(thumb(p), body, more);
  if (!inTrash) c.onclick = () => (location.href = `/p/${p.id}`);
  return c;
}

function render() {
  $('#n-all').textContent = live.length || '';
  $('#n-trash').textContent = trashed.length || '';
  $('#tab-all').classList.toggle('on', !inTrash);
  $('#tab-trash').classList.toggle('on', inTrash);
  const list = visible();
  grid.replaceChildren(...list.map(card));
  if (firstRender && list.length) {
    // Only the first paint animates; live refreshes (Claude editing in the background) must not replay it.
    firstRender = false;
    [...grid.children].slice(0, 8).forEach((c, i) => { c.style.setProperty('--i', i); c.classList.add('in'); });
  }

  const empty = $('#empty');
  empty.hidden = list.length > 0;
  if (list.length) return;
  if ($('#search').value) empty.innerHTML = '<h2>No matches</h2>Try a different search.';
  else if (inTrash) empty.innerHTML = '<h2>Trash is empty</h2>Deleted projects stay here until you remove them for good.';
  else {
    empty.innerHTML = '<h2>No projects yet</h2>Create one here, or ask Claude to design something and it will create a project for you.<code>claude mcp add --transport http design-canvas http://localhost:3777/mcp</code>';
  }
}

// ---- Card menu + actions -----------------------------------------------------

const menu = $('#menu');
function openMenu(anchor, p, nameEl) {
  const items = inTrash
    ? [['Restore', () => act(p, 'restore', 'Restored')], ['Delete forever', null, 'danger']]
    : [['Open', () => (location.href = `/p/${p.id}`)], ['Rename', () => startRename(p, nameEl)], ['Duplicate', () => act(p, 'duplicate', 'Duplicated')],
       ['Export', () => (location.href = `/api/projects/${p.id}/export`)], ['Move to Trash', () => trash(p), 'danger']];
  menu.replaceChildren(...items.map(([label, fn, cls]) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.onclick = (e) => {
      e.stopPropagation();
      if (label === 'Delete forever') {
        // Two-step confirm without a blocking dialog: first click arms it.
        if (b.dataset.armed) { menu.hidden = true; return act(p, 'purge', 'Deleted forever'); }
        b.dataset.armed = '1';
        b.textContent = 'Click again to confirm';
        return;
      }
      menu.hidden = true;
      fn();
    };
    return b;
  }));
  const r = anchor.getBoundingClientRect();
  menu.hidden = false;
  menu.style.top = Math.min(r.bottom + 4, innerHeight - menu.offsetHeight - 8) + 'px';
  menu.style.left = Math.min(r.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8) + 'px';
}
document.addEventListener('click', () => (menu.hidden = true));

async function act(p, action, message) {
  try { await postJson(`/api/projects/${p.id}/${action}`); toast(message); } catch (e) { toast(e.message); }
  load();
}

// Soft delete with an Undo link instead of a confirmation dialog.
async function trash(p) {
  await postJson(`/api/projects/${p.id}/delete`);
  toast(`“${p.name}” moved to Trash`, 'Undo', async () => { await postJson(`/api/projects/${p.id}/restore`); load(); });
  load();
}

// Inline rename: swap the title for an input; Enter saves, Esc cancels.
function startRename(p, nameEl) {
  const input = document.createElement('input');
  input.className = 'name-input';
  input.value = p.name;
  input.maxLength = 80;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  input.onclick = (e) => e.stopPropagation();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    if (save && input.value.trim() && input.value.trim() !== p.name) {
      try { await postJson(`/api/projects/${p.id}/rename`, { name: input.value }); } catch (e) { toast(e.message); }
    }
    load();
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
  input.onblur = () => finish(true);
}

// ---- Toast -------------------------------------------------------------------

let toastTimer;
function toast(msg, actionLabel, onAction) {
  const t = $('#toast');
  t.replaceChildren(document.createTextNode(msg));
  if (actionLabel) {
    const b = document.createElement('button');
    b.textContent = actionLabel;
    b.onclick = () => { t.classList.remove('show'); onAction(); };
    t.append(b);
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), actionLabel ? 7000 : 3000);
}

// ---- Toolbar -----------------------------------------------------------------

$('#search').oninput = render;
$('#sort').onchange = render;
$('#tab-all').onclick = () => { inTrash = false; render(); };
$('#tab-trash').onclick = () => { inTrash = true; render(); };

const dlg = $('#dlg');
$('#new').onclick = () => { dlg.hidden = false; $('#f-name').value = ''; $('#f-desc').value = ''; $('#f-name').focus(); };
$('#f-cancel').onclick = () => (dlg.hidden = true);
dlg.onclick = (e) => { if (e.target === dlg) dlg.hidden = true; };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dlg.hidden = true; });
$('#form').onsubmit = async (e) => {
  e.preventDefault();
  const p = await postJson('/api/projects', { name: $('#f-name').value, description: $('#f-desc').value });
  location.href = `/p/${p.id}`;
};

// Import a previously exported .dcproject.json
$('#import').onclick = () => $('#file').click();
$('#file').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const p = await postJson('/api/projects/import', JSON.parse(await f.text()));
    toast(`Imported “${p.name}”`);
  } catch (err) { toast('Import failed: ' + err.message); }
  load();
};

// ---- Live updates ------------------------------------------------------------

const events = new EventSource('/events'); // reconnects automatically
events.onopen = () => { $('#status').textContent = 'connected'; $('#status').className = ''; };
events.onerror = () => { $('#status').textContent = 'disconnected'; $('#status').className = 'off'; };
events.addEventListener('projects', reloadSoon);
