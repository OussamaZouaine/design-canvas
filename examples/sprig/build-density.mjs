// Data-table density sheet: compact / comfortable / spacious tables, cell types, row states and
// the toolbar that switches density.
//   node build-density.mjs                 (light)
//   THEME=dark node build-density.mjs      (dark)
// Needs the canvas server running. Re-runnable: it replaces only its own artboard.
process.env.PART = 'none'; // importing build-system must not rebuild the other sheets
const { tool, toOklch, grid, sk, muted } = await import('./build-system.mjs');
const { T, I, THEME, themeSuffix, badge, avatar, btn, iconBtn, sheet, section, demo } = await import('./ds.mjs');

const C = T.c;
const mono = T.mono;
const dark = THEME === 'dark';
const P = JSON.parse(await tool('list_projects', {})).projects.find((p) => p.name === 'Sprig design system').project_id;

// One density = one set of numbers. Everything in a table reads from here, so changing
// density never means restyling cells one by one.
const D = {
  compact: { row: 36, head: 36, px: 12, gap: 12, fs: 13, av: 20, chk: 16, label: 'Compact' },
  comfortable: { row: 48, head: 44, px: 16, gap: 16, fs: 14, av: 28, chk: 18, label: 'Comfortable' },
  spacious: { row: 64, head: 52, px: 20, gap: 20, fs: 15, av: 36, chk: 20, label: 'Spacious' },
};

const chk = (d, st) => `<div style="width:${d.chk}px;height:${d.chk}px;border-radius:5px;box-sizing:border-box;flex:none;border:1.5px solid ${st ? C.primary : C.lineStrong};display:flex;align-items:center;justify-content:center;${st ? `background:${C.primary};color:${C.onPrimary}` : `background:${C.surface}`}">${st === 'on' ? I.check(d.chk - 5) : st === 'mix' ? `<div style="width:8px;height:2px;background:currentColor"></div>` : ''}</div>`;
const sortH = (t, dir) => `<span style="display:inline-flex;gap:4px;align-items:center">${t}<span style="color:${dir ? C.ink : C.ink3};display:flex">${dir === 'up' ? I.arrowUp(14) : I.chevron(14)}</span></span>`;
const bar = (pct, tone) => `<div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:6px;border-radius:3px;background:${C.chip};overflow:hidden"><div style="width:${pct}%;height:100%;background:${tone}"></div></div><span style="font-size:12px;${muted};font-variant-numeric:tabular-nums;width:30px;text-align:right">${pct}%</span></div>`;
const spark = (pts, color) => { const w = 64, h = 20; const p = pts.map((v, i) => `${Math.round((i / (pts.length - 1)) * w)},${Math.round(h - (v / 100) * (h - 4) - 2)}`).join(' '); return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block"><polyline points="${p}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`; };
const tag = (t) => `<span style="font-size:12px;padding:1px 8px;border-radius:10px;background:${C.chip};color:${C.ink2};white-space:nowrap">${t}</span>`;
const more = `<span style="color:${C.ink3};display:flex;justify-content:flex-end">${I.more(16)}</span>`;

const ROWS = [
  ['Onboarding satisfaction', 'AS', 'Alex Stone', 'Live', 'success', '1,284', 82, [30, 42, 38, 55, 50, 68, 74, 88], 'Survey'],
  ['Checkout abandonment', 'MK', 'Maya Khan', 'Paused', 'warn', '312', 41, [60, 55, 58, 40, 44, 38, 30, 28], 'Replay'],
  ['Pricing page clicks', 'JS', 'Jenny Spaziano', 'Draft', 'neutral', '–', 0, [10, 10, 10, 10, 10, 10, 10, 10], 'Heatmap'],
  ['Mobile navigation test with a very long study name that must truncate', 'BB', 'Brian Brava', 'Error', 'danger', '47', 12, [20, 30, 22, 18, 25, 15, 12, 10], 'Survey'],
  ['Feature request intake', 'AS', 'Alex Stone', 'Live', 'success', '9,031', 96, [40, 50, 62, 70, 76, 84, 90, 96], 'Survey'],
];

// Build a table at a given density. opts: selected row indexes, hover, focus, disabled, zebra,
// group (adds a group header row), wide (adds Completion / Trend / Type columns), rows (count).
function tbl(key, o = {}) {
  const d = D[key];
  const cols = o.wide ? `${d.chk + 2}px 2.4fr 1.3fr 0.9fr 0.8fr 1.3fr 90px 0.8fr 32px` : `${d.chk + 2}px 2.6fr 1.3fr 0.9fr 0.9fr 32px`;
  const cell = (c) => `<div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c}</div>`;
  const row = (cells, st = {}, head) => `<div style="display:grid;grid-template-columns:${cols};align-items:center;gap:${d.gap}px;padding:0 ${d.px}px;height:${head ? d.head : d.row}px;box-sizing:border-box;font-size:${d.fs}px;${head ? `background:${C.sidebar};font-size:${Math.max(12, d.fs - 1)}px;font-weight:500;color:${C.ink2}` : `border-top:1px solid ${C.line};${st.sel ? `background:${C.aiBg};` : st.hover ? `background:${C.navActive};` : o.zebra && st.i % 2 ? `background:${C.sidebar};` : ''}${st.focus ? `box-shadow:inset 0 0 0 2px ${C.accent};` : ''}${st.dis ? 'opacity:.5;' : ''}`}">${cells.map(cell).join('')}</div>`;
  const R = (v, i) => {
    const st = { i, sel: o.selected?.includes(i), hover: o.hover === i, focus: o.focus === i, dis: o.disabled === i };
    const tone = v[4] === 'danger' ? C.danger : C.primary;
    const cells = [
      chk(d, st.sel ? 'on' : ''),
      `<span style="font-weight:500">${v[0]}</span>`,
      `<div style="display:flex;gap:8px;align-items:center;min-width:0">${avatar(v[1], d.av)}${key === 'compact' ? '' : `<span style="overflow:hidden;text-overflow:ellipsis">${v[2]}</span>`}</div>`,
      badge(v[3], v[4], { dot: key !== 'compact' }),
      `<span style="display:block;text-align:right;font-variant-numeric:tabular-nums">${v[5]}</span>`,
    ];
    if (o.wide) cells.push(bar(v[6], tone), spark(v[7], tone), tag(v[8]));
    cells.push(more);
    return row(cells, st);
  };
  const head = [chk(d, o.selected?.length ? 'mix' : ''), sortH('Name', 'up'), sortH('Owner'), sortH('Status'), `<span style="display:block;text-align:right">${sortH('Responses')}</span>`];
  if (o.wide) head.push('Completion', 'Trend', 'Type');
  head.push('');
  const body = ROWS.slice(0, o.rows ?? 5).map(R);
  if (o.group) body.splice(2, 0, `<div style="padding:0 ${d.px}px;height:${Math.max(28, d.row - 12)}px;display:flex;align-items:center;gap:8px;background:${C.sidebar};border-top:1px solid ${C.line};font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${C.ink2}">${I.chevronDown(14)}Paused &amp; drafts<span style="font-weight:400;color:${C.ink3}">2</span></div>`);
  return `<div style="border:1px solid ${C.line};border-radius:14px;overflow:hidden;background:${C.surface}">${row(head, {}, true)}${body.join('')}</div>`;
}

// The toolbar owns the density control (a segmented control), next to search and filters.
const seg = (active) => `<div style="display:inline-flex;padding:3px;border-radius:10px;background:${C.chip};gap:2px">${Object.entries(D).map(([k, d]) => `<span style="height:28px;padding:0 12px;border-radius:7px;font-size:13px;display:flex;align-items:center;${k === active ? `background:${C.surface};color:${C.ink};font-weight:500;box-shadow:0 1px 2px oklch(0 0 0 / ${dark ? 0.5 : 0.12})` : `color:${C.ink2}`}">${d.label}</span>`).join('')}</div>`;
const toolbar = (active) => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><div style="display:flex;align-items:center;gap:8px;height:36px;padding:0 12px;border:1px solid ${C.line};border-radius:8px;background:${C.surface};width:260px;box-sizing:border-box;color:${C.ink3};font-size:14px">${I.search(16)}Search studies</div>${btn('Status', 'secondary', '', { size: 'sm' })}${btn('Owner', 'secondary', '', { size: 'sm' })}<span style="flex:1"></span>${seg(active)}</div>`;

// ---- Sections ------------------------------------------------------------------------------
const specRows = [
  ['Compact', '36px', '12px', '13px', '20px', 'Power users scanning hundreds of rows; owner shows the avatar only and badges drop their dot.'],
  ['Comfortable', '48px', '16px', '14px', '28px', 'Default. Fits about 12 rows in a 720px viewport with room for a toolbar.'],
  ['Spacious', '64px', '20px', '15px', '36px', 'Touch devices, or tables of rich rows (avatar plus two lines plus actions).'],
];
const spec = `<div style="border:1px solid ${C.line};border-radius:14px;overflow:hidden;background:${C.surface}">${[['Density', 'Row', 'Cell padding', 'Text', 'Avatar', 'Use when'], ...specRows].map((r, i) => `<div style="display:grid;grid-template-columns:1.1fr .6fr .9fr .6fr .6fr 4fr;gap:16px;align-items:center;padding:0 20px;height:${i ? 52 : 40}px;${i ? `border-top:1px solid ${C.line};font-size:14px` : `background:${C.sidebar};font-size:13px;font-weight:500;color:${C.ink2}`}">${r.map((c, j) => `<div style="${i && j === 0 ? 'font-weight:500' : i && j > 0 && j < 5 ? `font-family:${mono};font-size:13px` : i ? `color:${C.ink2}` : ''}">${c}</div>`).join('')}</div>`).join('')}</div>`;

const sec1 = section('Density scale', 'Three densities share one set of rules: only row height, horizontal padding, gap, type size and avatar size change. Column widths, alignment (numbers right, text left) and badge/progress geometry never do. Stored per user, per table.', spec);
const sec2 = section('Same data, three densities', 'The toolbar owns the control. Switching density is instant (no animation): it is a frequent preference change, and animated row heights would make the table jump.',
  ['compact', 'comfortable', 'spacious'].map((k) => demo(`${D[k].label} · ${D[k].row}px rows`, toolbar(k) + tbl(k, { selected: k === 'comfortable' ? [0] : [], rows: k === 'spacious' ? 4 : 5 }))).join(''));
const sec3 = section('Cell types', 'Every cell type survives all three densities. Numbers are tabular and right-aligned, long text truncates with an ellipsis (full text in a tooltip), empty values show an en dash, and trend cells never exceed the row height.',
  tbl('comfortable', { wide: true, rows: 5 }));
const sec4 = section('Row states', 'Hover and selection are background-only so row height never shifts. Keyboard focus draws an inset 2px ring (an outer ring would be clipped by the table edge). Disabled rows stay readable at 50%.',
  grid('1fr 1fr', demo('Hover row 2 · selected row 1', tbl('comfortable', { hover: 1, selected: [0], rows: 3 })) +
    demo('Keyboard focus on row 2 · disabled row 3', tbl('comfortable', { focus: 1, disabled: 2, rows: 3 })) +
    demo('Zebra option (dense data only)', tbl('compact', { zebra: true, rows: 4 })) +
    demo('Grouped rows with collapsible headers', tbl('comfortable', { group: true, rows: 4 }))));

const loadRow = (d, i) => `<div style="display:flex;gap:${d.gap}px;align-items:center;padding:0 ${d.px}px;height:${d.row}px;${i ? `border-top:1px solid ${C.line}` : ''}">${sk(`${d.chk}px`, d.chk, 5)}${sk('28%', 12)}${sk('14%', 12)}${sk('56px', 20, 10)}${sk('8%', 12)}</div>`;
const sec5 = section('Loading at each density', 'Skeleton rows use the row height of the density in force, so the table does not resize when data arrives.',
  grid('1fr 1fr 1fr', ['compact', 'comfortable', 'spacious'].map((k) => demo(D[k].label, `<div style="border:1px solid ${C.line};border-radius:14px;overflow:hidden;background:${C.surface}">${[0, 1, 2, 3].map((i) => loadRow(D[k], i)).join('')}</div>`)).join('')));

const name = 'DS · Data table density' + themeSuffix;
const OY = dark ? 6600 : 0;
const old = JSON.parse(await tool('get_basic_info', { project_id: P })).artboards.filter((a) => a.name === name);
if (old.length) await tool('delete_nodes', { project_id: P, ids: old.map((a) => a.id) });
const H = 3300;
// Sits at the end of the system row (the eight earlier sheets occupy columns 0-7)
const { id } = JSON.parse(await tool('create_artboard', { project_id: P, name, width: 1440, height: H, x: 3120 + 8 * 1560, y: 2400 + OY }));
const root = JSON.parse(await tool('write_html', { project_id: P, target_id: id, html: toOklch(sheet('Data table density', 'Compact, comfortable and spacious tables, the cell types they must support, row states, grouping and loading, with one control to switch between them.', '', { h: H })) })).created[0];
for (const s of [sec1, sec2, sec3, sec4, sec5]) await tool('write_html', { project_id: P, target_id: root, html: toOklch(s) });
await tool('log_prompt', { project_id: P, prompt: `Add data-table density modes to the Sprig design system${dark ? ' (dark build)' : ''}` });
console.log('built', name, id);
