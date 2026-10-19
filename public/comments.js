// Comments overview: every comment from every project, with its status. Comment text and
// project/artboard names can come from Claude or imported files, so everything is inserted
// with textContent / DOM nodes, never innerHTML.
const $ = (s) => document.querySelector(s);
const list = $('#list');

let all = [];
let status = 'all';
let firstRender = true;
const open = new Set(); // comment ids whose replies are expanded (kept across live refreshes)

const post = (url, body = {}) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
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
  if (s < 86400 * 14) return `${Math.round(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString();
};

async function load() {
  all = await fetch('/api/comments').then((r) => r.json());
  // keep the project filter in sync with the projects that actually have comments
  const sel = $('#project');
  const cur = sel.value;
  const projects = [...new Map(all.map((c) => [c.projectId, c.projectName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  sel.replaceChildren(h('option', { value: '' }, 'All projects'), ...projects.map(([id, name]) => h('option', { value: id }, name)));
  sel.value = projects.some(([id]) => id === cur) ? cur : '';
  render();
}

// Where the comment points, in words: "Home · button “Sign in”".
function where(c) {
  const target = c.orphaned
    ? h('span', { class: 'orphan' }, c.targetId.startsWith('A') ? 'artboard was replaced or deleted' : 'element was deleted')
    : c.element
      ? h('span', {}, `${c.element.tag}${c.element.text ? ` “${c.element.text}”` : ''}`)
      : h('span', {}, 'artboard');
  return h('div', { class: 'where' }, h('b', {}, c.projectName), c.artboardName ? ` · ${c.artboardName}` : '', ' · ', target);
}

function card(c, i) {
  const repliesOpen = open.has(c.id);
  const replies = h('div', { class: 'replies', hidden: !repliesOpen },
    c.replies.map((r) => h('div', { class: 'reply' }, h('span', { class: 'by' }, r.author === 'claude' ? 'Claude' : 'You'), r.text, h('small', {}, ago(r.createdAt)))));
  const toggle = c.replies.length
    ? h('button', {
        'aria-expanded': String(repliesOpen),
        onclick: () => { repliesOpen ? open.delete(c.id) : open.add(c.id); replies.hidden = repliesOpen; toggle.setAttribute('aria-expanded', String(!repliesOpen)); toggle.textContent = label(!repliesOpen); },
      }, label(repliesOpen))
    : null;
  function label(o) { return `${o ? 'Hide' : 'Show'} ${c.replies.length} repl${c.replies.length === 1 ? 'y' : 'ies'}`; }

  // Delete needs a second click: the first arms the button, and it disarms itself after 3s.
  const del = h('button', { class: 'danger', onclick: () => {
    if (!del.classList.contains('armed')) { del.classList.add('armed'); del.textContent = 'Click to confirm'; setTimeout(() => { del.classList.remove('armed'); del.textContent = 'Delete'; }, 3000); return; }
    post(`/api/p/${c.projectId}/comment-delete`, { commentId: c.id });
  } }, 'Delete');

  return h('article', { class: `cm${c.resolved ? ' resolved' : ''}${firstRender ? ' in' : ''}`, style: `--i:${Math.min(i, 10)}` },
    h('div', { class: 'cm-top' },
      h('span', { class: `badge ${c.resolved ? 'resolved' : 'open'}` }, c.resolved ? 'Resolved' : 'Open'),
      where(c),
      h('span', { class: 'when' }, ago(c.createdAt))),
    h('div', { class: 'text' }, h('span', { class: 'by' }, c.author === 'claude' ? 'Claude' : 'You'), c.text),
    replies,
    h('div', { class: 'cm-actions' },
      h('button', { onclick: () => post(`/api/p/${c.projectId}/comment-resolve`, { commentId: c.id, resolved: !c.resolved }) }, c.resolved ? 'Reopen' : 'Resolve'),
      h('a', { href: `/p/${c.projectId}?comment=${c.id}` }, 'Open on canvas'),
      toggle,
      h('span', { class: 'grow' }),
      del));
}

function render() {
  const q = $('#search').value.trim().toLowerCase();
  const proj = $('#project').value, who = $('#who').value;
  // Counts follow the project/author/search filters, so the tabs always match what you'd see.
  const base = all.filter((c) => (!proj || c.projectId === proj) && (!who || c.author === who)
    && (!q || `${c.text} ${c.projectName} ${c.artboardName ?? ''} ${c.replies.map((r) => r.text).join(' ')}`.toLowerCase().includes(q)));
  const nOpen = base.filter((c) => !c.resolved).length;
  $('#n-all').textContent = base.length;
  $('#n-open').textContent = nOpen;
  $('#n-resolved').textContent = base.length - nOpen;
  const shown = base.filter((c) => status === 'all' || (status === 'open') === !c.resolved);

  list.replaceChildren(...shown.map(card));
  const empty = $('#empty');
  empty.hidden = shown.length > 0;
  if (!shown.length) {
    empty.replaceChildren(
      h('h2', {}, all.length ? 'Nothing matches' : 'No comments yet'),
      all.length ? 'Try another filter.' : 'Open a project, press C and click an element to leave a comment. Claude reads open comments and replies.');
  }
  firstRender = false;
}

document.querySelectorAll('.tabs button').forEach((b) => {
  b.onclick = () => {
    status = b.dataset.st;
    document.querySelectorAll('.tabs button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
    render();
  };
});
for (const id of ['#search', '#project', '#who']) $(id).addEventListener('input', render);

// Live: any comment change anywhere (resolve here, Claude replying, a pin added) refreshes the list.
let t;
const events = new EventSource('/events');
events.onopen = () => { $('#status').textContent = 'connected'; $('#status').className = ''; };
events.onerror = () => { $('#status').textContent = 'disconnected'; $('#status').className = 'off'; };
events.addEventListener('comments-changed', () => { clearTimeout(t); t = setTimeout(load, 150); });
events.addEventListener('projects', () => { clearTimeout(t); t = setTimeout(load, 300); }); // renames / deletions
load();
