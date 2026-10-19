// Inspector: edit the selected layer's styles with form fields instead of asking Claude.
// Every field maps one-to-one onto an inline CSS property, so an edit is just "set this property".
// Fields offer the project's design tokens first (datalist suggestions like var(--space-4)); a
// value that is a token shows a chip with a Detach button that swaps in the resolved value.
//
// Values are put into inputs with .value (never innerHTML), and the server validates and
// sanitizes the style write like any other.

const SECTIONS = [
  { title: 'Layout', fields: [
    ['width', 'W', 'size'], ['height', 'H', 'size'], ['position', 'Position', 'select:static,relative,absolute,fixed'],
    ['left', 'Left', 'size'], ['top', 'Top', 'size'],
  ] },
  { title: 'Auto layout', fields: [
    ['display', 'Display', 'select:block,flex,inline-flex,grid,inline-block,none'],
    ['flex-direction', 'Direction', 'select:row,column,row-reverse,column-reverse'],
    ['gap', 'Gap', 'space'], ['padding', 'Padding', 'space'],
    ['align-items', 'Align', 'select:stretch,flex-start,center,flex-end,baseline'],
    ['justify-content', 'Justify', 'select:flex-start,center,flex-end,space-between,space-around'],
    ['flex-wrap', 'Wrap', 'select:nowrap,wrap'],
  ] },
  { title: 'Appearance', fields: [['opacity', 'Opacity', 'plain'], ['border-radius', 'Radius', 'radius'], ['overflow', 'Overflow', 'select:visible,hidden,auto,scroll']] },
  { title: 'Fill', fields: [['background', 'Fill', 'color']] },
  { title: 'Stroke', fields: [['border', 'Border', 'plain']] },
  { title: 'Shadow', fields: [['box-shadow', 'Shadow', 'shadow']] },
  { title: 'Typography', fields: [
    ['font-family', 'Font', 'font'], ['font-size', 'Size', 'size-text'], ['font-weight', 'Weight', 'weight'],
    ['line-height', 'Line', 'leading'], ['letter-spacing', 'Tracking', 'tracking'], ['color', 'Color', 'color'],
    ['text-align', 'Align', 'select:left,center,right,justify'],
  ] },
];
const HANDLED = new Set([...SECTIONS.flatMap((s) => s.fields.map((f) => f[0])), 'background-color']);

// Which token family a field kind suggests (size has no family: sizes are free-form).
const FAMILY = { color: 'color', space: 'space', radius: 'radius', shadow: 'shadow', font: 'font', weight: 'weight', leading: 'leading', tracking: 'tracking', 'size-text': 'size' };

function parseStyle(str = '') {
  const map = new Map();
  for (const decl of str.split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) map.set(decl.slice(0, i).trim().toLowerCase(), decl.slice(i + 1).trim());
  }
  return map;
}

export function initInspector({ h, getSelected, getDoc, nodeOf, post, api, toast, markUserEdit, getMode, getPages, getPage }) {
  const pane = document.querySelector('[data-pane="design"]');

  async function send(path, body) {
    markUserEdit();
    const r = await post(`${api}/${path}`, body);
    if (!r.ok) toast((await r.json().catch(() => ({}))).error || 'That change was not allowed');
  }

  // Tokens of this project for the current mode (base values plus that mode's overrides).
  const tokens = () => {
    const t = getDoc().theme ?? { tokens: {}, modes: {} };
    const mode = getMode();
    return { ...t.tokens, ...(mode === 'base' ? {} : t.modes?.[mode] ?? {}) };
  };
  const tokenName = (v) => /^var\(--([a-z0-9-]+)\s*(?:,.*)?\)$/i.exec(v ?? '')?.[1] ?? null;

  function field(id, style, [prop, label, kind]) {
    // A node styled with background-color (rather than the background shorthand) still shows in Fill.
    const value = style.get(prop) ?? (prop === 'background' ? style.get('background-color') : undefined) ?? '';
    const name = tokenName(value);
    let input;
    if (kind.startsWith('select:')) {
      input = h('select', { class: 'in-sel', 'aria-label': label }, ['', ...kind.slice(7).split(',')].map((o) => h('option', { value: o }, o || '—')));
      if (value && ![...input.options].some((o) => o.value === value)) input.append(h('option', { value }, value));
      input.value = value;
      input.onchange = () => send('style', { ids: [id], styles: { [prop]: input.value || null } });
    } else {
      input = h('input', { class: 'tok-in', 'aria-label': label, spellcheck: 'false', placeholder: '—' });
      input.value = value;
      const fam = FAMILY[kind];
      if (fam) input.setAttribute('list', `dl-${fam}`);
      input.onchange = () => send('style', { ids: [id], styles: { [prop]: input.value.trim() || null } });
      input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); e.stopPropagation(); };
    }
    // A swatch for colours, resolved through the tokens so var(--color-primary) shows its colour.
    const resolved = name && name in tokens() ? tokens()[name] : value;
    const sw = kind === 'color' && value && CSS.supports('color', resolved) ? h('i', { class: 'tok-sw', style: `background:${resolved}` }) : null;
    const chip = name
      ? h('button', { class: 'chip-token', title: `Detach: replace var(--${name}) with its value`, onclick: () => name in tokens() && send('style', { ids: [id], styles: { [prop]: tokens()[name] } }) }, `${name} ✕`)
      : null;
    return h('label', { class: 'frow' }, h('span', { class: 'flabel' }, label), sw, input, chip);
  }

  function datalists() {
    const all = tokens();
    return Object.entries(FAMILY).map(([, fam]) => fam).filter((f, i, a) => a.indexOf(f) === i).map((fam) =>
      h('datalist', { id: `dl-${fam}` }, Object.keys(all).filter((k) => k.split('-')[0] === fam).map((k) => h('option', { value: `var(--${k})` }, all[k]))));
  }

  // Nothing selected: the page itself (name and canvas background).
  function renderPage() {
    const page = getPage();
    const name = h('input', { class: 'tok-in', 'aria-label': 'Page name', maxlength: '60' });
    name.value = page.name;
    name.onchange = () => name.value.trim() && send('page-update', { id: page.id, name: name.value.trim() });
    const bg = h('input', { class: 'tok-in', 'aria-label': 'Page background', placeholder: 'default', spellcheck: 'false' });
    bg.value = page.background ?? '';
    bg.setAttribute('list', 'dl-color');
    bg.onchange = () => send('page-update', { id: page.id, background: bg.value.trim() });
    for (const i of [name, bg]) i.onkeydown = (e) => { if (e.key === 'Enter') i.blur(); e.stopPropagation(); };
    const sw = page.background && CSS.supports('color', page.background) ? h('i', { class: 'tok-sw', style: `background:${page.background}` }) : null;
    pane.replaceChildren(h('div', { class: 'tk' }, ...datalists(),
      h('h4', {}, 'Page'),
      h('label', { class: 'frow' }, h('span', { class: 'flabel' }, 'Name'), name),
      h('label', { class: 'frow' }, h('span', { class: 'flabel' }, 'Canvas'), sw, bg),
      h('div', { class: 'empty' }, 'Select a layer on the canvas or in the Layers panel to edit its styles.')));
  }

  function renderArtboard(ab) {
    const num = (label, key, action) => {
      const input = h('input', { class: 'tok-in', 'aria-label': label, inputmode: 'numeric' });
      input.value = String(Math.round(ab[key]));
      input.onchange = () => {
        const n = Number(input.value);
        if (!Number.isFinite(n)) { input.value = String(ab[key]); return; }
        const next = { ...ab, [key]: n };
        send(action, action === 'move' ? { id: ab.id, x: next.x, y: next.y } : { id: ab.id, width: next.width, height: next.height });
      };
      input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); e.stopPropagation(); };
      return h('label', { class: 'frow' }, h('span', { class: 'flabel' }, label), input);
    };
    const name = h('input', { class: 'tok-in', 'aria-label': 'Artboard name', maxlength: '80' });
    name.value = ab.name;
    name.onchange = () => name.value.trim() && send('rename', { id: ab.id, name: name.value.trim() });
    name.onkeydown = (e) => { if (e.key === 'Enter') name.blur(); e.stopPropagation(); };
    pane.replaceChildren(h('div', { class: 'tk' },
      h('h4', {}, 'Artboard'), h('label', { class: 'frow' }, h('span', { class: 'flabel' }, 'Name'), name),
      // Which page the board lives on; changing it moves the board (it then disappears from this page).
      (() => {
        const sel = h('select', { class: 'in-sel', 'aria-label': 'Page' }, getPages().map((p) => h('option', { value: p.id }, p.name)));
        sel.value = ab.page ?? getPages()[0].id;
        sel.onchange = () => send('move-to-page', { ids: [ab.id], page: sel.value });
        return h('label', { class: 'frow' }, h('span', { class: 'flabel' }, 'Page'), sel);
      })(),
      num('W', 'width', 'resize'), num('H', 'height', 'resize'), num('X', 'x', 'move'), num('Y', 'y', 'move')));
  }

  function render() {
    const id = getSelected();
    const doc = getDoc();
    if (!id) { renderPage(); return; }
    const board = doc.artboards.find((a) => a.id === id);
    if (board) { renderArtboard(board); return; }
    const el = nodeOf(id);
    if (!el) { pane.replaceChildren(h('div', { class: 'empty' }, 'That layer is not available.')); return; }
    const style = parseStyle(el.getAttribute('style') ?? '');
    const locked = el.closest('[data-locked]');
    const other = [...style].filter(([k]) => !HANDLED.has(k));

    pane.replaceChildren(h('div', { class: 'tk' },
      ...datalists(),
      h('div', { class: 'insp-head' }, h('b', {}, el.dataset.name || el.tagName.toLowerCase()), h('small', {}, id)),
      locked ? h('div', { class: 'tok-hint' }, 'This layer is locked: unlock it in the Layers panel to edit.') : null,
      ...SECTIONS.map((s) => h('div', { class: locked ? 'insp-sec off' : 'insp-sec' }, h('h4', {}, s.title), s.fields.map((f) => field(id, style, f)))),
      // CSS the inspector has no control for (added by Claude or by hand): editable as raw rows.
      other.length ? h('div', { class: locked ? 'insp-sec off' : 'insp-sec' }, h('h4', {}, 'Other styles'), other.map(([prop, value]) => {
        const input = h('input', { class: 'tok-in', 'aria-label': prop, spellcheck: 'false' });
        input.value = value;
        input.onchange = () => send('style', { ids: [id], styles: { [prop]: input.value.trim() || null } });
        input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); e.stopPropagation(); };
        return h('div', { class: 'frow' }, h('span', { class: 'flabel', title: prop }, prop), input,
          h('button', { class: 'icon tok-del', 'aria-label': `Remove ${prop}`, onclick: () => send('style', { ids: [id], styles: { [prop]: null } }) }, '×'));
      })) : null,
    ));
  }

  // Redraw after selection or document changes, but not while someone is typing in a field.
  const refresh = () => { if (!pane.contains(document.activeElement)) render(); };
  return { render, refresh };
}
