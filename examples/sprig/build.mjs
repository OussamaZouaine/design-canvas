// Builds the Sprig-style design system and pages on the local canvas via its MCP endpoint.
import { T, I, btn, badge, avatar, input, card, toggle, tabs, shell, pageTitle, table, THEME, themeSuffix } from './ds.mjs';
const C = T.c;

let rid = 0;
// Stateless MCP call: one JSON-RPC request, response arrives as an SSE "data:" line.
async function tool(name, args) {
  const res = await fetch('http://localhost:3777/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method: 'tools/call', params: { name, arguments: args } }),
  });
  const line = (await res.text()).split('\n').find((l) => l.startsWith('data:'));
  const out = JSON.parse(line.slice(5)).result;
  if (out.isError) throw new Error(`${name}: ${out.content[0].text}`);
  return out.content[0].text;
}
// Where each artboard lives on the canvas. The dark build mirrors the light layout in its own
// region far below (OY), so the two themes never overlap.
const OY = THEME === 'dark' ? 6600 : 0;
const POS = { 'DS · Foundations': [0, 0], 'DS · Components': [1560, 0], Home: [3120, 0], Studies: [4680, 0], Dashboards: [6240, 0], Users: [7800, 0], 'Create a study': [9360, 0], Integrations: [10920, 0] };
const P = JSON.parse(await tool('list_projects', {})).projects.find((p) => p.name === 'Sprig design system').project_id;

async function artboard(name, width, height, html) {
  const full = name + themeSuffix;
  // Re-runnable: replace only this build's artboard of the same name (never touches other pages)
  const old = JSON.parse(await tool('get_basic_info', { project_id: P })).artboards.filter((a) => a.name === full);
  if (old.length) await tool('delete_nodes', { project_id: P, ids: old.map((a) => a.id) });
  const [x, y] = POS[name];
  const { id } = JSON.parse(await tool('create_artboard', { project_id: P, name: full, width, height, x, y: y + OY }));
  await tool('write_html', { project_id: P, target_id: id, html });
  console.log('built', full, id);
}

const h2 = (t) => `<div style="font-size:18px;font-weight:500;margin:0 0 4px">${t}</div>`;
const cap = (t) => `<div style="font-size:13px;color:${C.ink2};margin-bottom:16px;line-height:18px">${t}</div>`;
const sec = (title, sub, inner) => `<div style="margin-bottom:48px">${h2(title)}${cap(sub)}${inner}</div>`;
const doc = (title, sub, inner, w, h) =>
  `<div style="width:${w}px;height:${h}px;background:${C.surface};font-family:${T.font};color:${C.ink};padding:56px 64px;box-sizing:border-box;overflow:hidden"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${C.accent};font-weight:600;margin-bottom:8px">Sprig design system</div><div style="font-size:36px;font-weight:500;letter-spacing:-.8px;margin-bottom:6px">${title}</div><div style="font-size:15px;color:${C.ink2};margin-bottom:40px;max-width:760px;line-height:22px">${sub}</div>${inner}</div>`;

// ---------- Foundations ------------------------------------------------------
const swatch = (name, hex, note = '') =>
  `<div style="width:168px"><div style="height:64px;border-radius:12px;background:${hex};border:1px solid ${C.line}"></div><div style="font-size:13px;font-weight:500;margin-top:8px">${name}</div><div style="font-size:12px;color:${C.ink2};font-family:Consolas,monospace">${hex}</div>${note ? `<div style="font-size:12px;color:${C.ink3}">${note}</div>` : ''}</div>`;
const row = (...n) => `<div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:20px">${n.join('')}</div>`;

const colors =
  row(swatch('Surface', C.bg, 'Page + cards'), swatch('Sidebar', C.sidebar, 'Warm off-white'), swatch('Border', C.line, 'Hairlines'), swatch('Border strong', C.lineStrong, 'Toggles, inputs on focus'), swatch('Nav active', C.navActive, 'Selected item')) +
  row(swatch('Ink', C.ink, 'Headings, labels'), swatch('Ink 2', C.ink2, 'Descriptions'), swatch('Ink 3', C.ink3, 'Placeholders'), swatch('Primary', C.primary, 'Buttons, toggles on'), swatch('Chip', C.chip, 'Step badges, avatars')) +
  row(swatch('AI surface', C.aiBg, 'AI banner'), swatch('AI border', C.aiBorder), swatch('Accent', C.accent, 'Icons in AI area'), swatch('Accent soft', C.accentSoft, 'Illustration tile'), swatch('Yellow', C.yellow, 'Illustration tile')) +
  row(swatch('Mint', C.mint, 'Illustration tile'), swatch('Orange', C.orange, 'Chat bubble'), swatch('Free badge', C.freeBg), swatch('Success', C.success, 'bg ' + C.successBg), swatch('Warning', C.warn, 'bg ' + C.warnBg)) +
  row(swatch('Danger', C.danger, 'bg ' + C.dangerBg), swatch('Info', C.info, 'bg ' + C.infoBg));

const typeRow = (label, spec, size, weight, lh, sample) =>
  `<div style="display:flex;align-items:baseline;gap:24px;padding:14px 0;border-top:1px solid ${C.line}"><div style="width:180px;flex-shrink:0"><div style="font-size:13px;font-weight:500">${label}</div><div style="font-size:12px;color:${C.ink2}">${spec}</div></div><div style="font-size:${size}px;font-weight:${weight};line-height:${lh}px;letter-spacing:${size >= 28 ? '-0.4px' : '0'}">${sample}</div></div>`;
const typography =
  typeRow('Display', '36 / 44 · 500', 36, 500, 44, 'Welcome to Sprig, Alex') +
  typeRow('Page title', '28 / 36 · 500', 28, 500, 36, 'Welcome to Sprig, Alex') +
  typeRow('Section title', '18 / 26 · 500', 18, 500, 26, 'Explore Sprig') +
  typeRow('Card title', '18 / 26 · 500', 18, 500, 26, 'Install the SDK') +
  typeRow('Body', '15 / 22 · 400', 15, 400, 22, 'Create a Replay, Heatmap, Survey, or Feedback study from scratch.') +
  typeRow('Body muted', '15 / 22 · 400 · Ink 2', 15, 400, 22, `<span style="color:${C.ink2}">Choose from popular installation methods such as JS SDK and Segment.</span>`) +
  typeRow('Label', '13 / 18 · 500', 13, 500, 18, 'Last updated · Status · Responses') +
  typeRow('Caption', '12 / 16 · 400', 12, 400, 16, 'brian.brava@email.com · 15 clicks · 14 min ago');

const spaceRow = [4, 8, 12, 16, 20, 24, 32, 40, 48].map((s) => `<div style="display:flex;align-items:center;gap:12px;width:200px;margin-bottom:8px"><div style="width:${s}px;height:16px;background:${C.accentSoft};border-radius:3px"></div><span style="font-size:13px;color:${C.ink2}">${s}px</span></div>`).join('');
const radii = [['XS · 6', 6, 'Chips'], ['SM · 8', 8, 'Buttons, inputs, nav'], ['MD · 12', 12, 'Tiles, swatches'], ['LG · 16', 16, 'Cards'], ['XL · 24', 24, 'AI banner'], ['Pill', 999, 'Badges, toggles']]
  .map(([n, r, u]) => `<div style="width:132px"><div style="height:64px;border:1.5px solid ${C.ink};border-radius:${r}px;background:${C.surface}"></div><div style="font-size:13px;font-weight:500;margin-top:8px">${n}</div><div style="font-size:12px;color:${C.ink2}">${u}</div></div>`).join('');
const elev = [['Flat', 'none', 'Cards use a border, not a shadow'], ['Raised', '0 1px 2px rgba(31,31,31,.06)', 'Hovered cards'], ['Popover', '0 8px 24px rgba(31,31,31,.12)', 'Menus, tooltips'], ['Modal', '0 24px 64px rgba(31,31,31,.20)', 'Dialogs']]
  .map(([n, s, u]) => `<div style="width:200px"><div style="height:72px;border-radius:12px;background:${C.surface};border:1px solid ${C.line};box-shadow:${s}"></div><div style="font-size:13px;font-weight:500;margin-top:10px">${n}</div><div style="font-size:12px;color:${C.ink2}">${u}</div></div>`).join('');

const foundations = doc('Foundations', 'A calm, content-first product UI: warm neutrals, a near-black primary, hairline borders instead of shadows, and one soft lavender reserved for AI. Colour is used sparingly; illustration tiles carry the personality.',
  sec('Colour', 'Neutrals do 90% of the work. Purple is only for AI surfaces; yellow, mint and orange appear in illustration tiles and the chat bubble.', colors) +
  sec('Typography', 'Inter (fallback Segoe UI / system-ui). Weight 500 for headings, never bold; 400 for everything else. Sizes in px.', typography) +
  `<div style="display:flex;gap:64px"><div>${sec('Spacing', '4px base grid. Page padding 32/40, card padding 20–24, gaps 8–16.', spaceRow)}</div><div style="flex:1">${sec('Radius', 'Rounder for larger surfaces.', `<div style="display:flex;gap:14px;flex-wrap:wrap">${radii}</div>`)}</div></div>` +
  sec('Elevation', 'Mostly flat. Depth comes from borders and tonal surfaces.', `<div style="display:flex;gap:24px">${elev}</div>`) +
  sec('Layout', 'Fixed 240px sidebar, fluid content area, 32px top / 40px side padding. Content blocks stack with 24px gaps; page title row is 36px tall with actions right-aligned.', `<div style="display:flex;gap:0;border:1px dashed ${C.lineStrong};border-radius:12px;height:120px;overflow:hidden"><div style="width:120px;background:${C.sidebar};border-right:1px solid ${C.line};display:flex;align-items:center;justify-content:center;font-size:12px;color:${C.ink2}">Sidebar 240</div><div style="flex:1;display:flex;align-items:center;justify-content:center;font-size:12px;color:${C.ink2}">Content · padding 32 / 40 · max width fluid</div></div>`),
  1440, 2500);

// ---------- Components -------------------------------------------------------
const demo = (label, inner) => `<div style="margin-bottom:28px"><div style="font-size:12px;color:${C.ink2};margin-bottom:10px;font-weight:500">${label}</div>${inner}</div>`;
const flex = (...n) => `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">${n.join('')}</div>`;
const stepCard = (n, title, desc, cta, tile, tileBg) =>
  `<div style="display:flex;background:${C.surface};border:1px solid ${C.line};border-radius:16px;overflow:hidden;height:150px"><div style="width:200px;background:${tileBg};flex-shrink:0;display:flex;align-items:center;justify-content:center">${tile}</div><div style="padding:20px 24px;flex:1"><div style="display:flex;align-items:center;gap:12px;margin-bottom:8px"><div style="width:28px;height:28px;border-radius:50%;background:${C.chip};display:flex;align-items:center;justify-content:center;font-size:13px;color:${C.ink2}">${n}</div><div style="font-size:18px;font-weight:500">${title}</div></div><div style="font-size:15px;color:${C.ink2};margin-bottom:14px">${desc}</div>${btn(cta, 'secondary')}</div></div>`;
const tile = `<div style="width:56px;height:56px;border-radius:14px;background:${C.surface};display:flex;align-items:center;justify-content:center;color:${C.accent}">${I.sparkle(28)}</div>`;

const components = doc('Components', 'Every component below is composed from the foundation tokens. Copy the pattern, not the pixels: radius, border and type size are what make it feel like Sprig.',
  `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 64px">
  <div>
    ${sec('Buttons', 'Height 40, radius 8, 15px / 450. One primary per view.',
      demo('Primary · Secondary · Ghost · Danger', flex(btn('New Study', 'primary', I.plus(18)), btn('Create a study', 'secondary'), btn('Cancel', 'ghost'), btn('Delete', 'danger'))) +
      demo('AI action', flex(btn('Generate Ideas', 'primary', I.sparkle(18)))))}
    ${sec('Inputs', 'Same 40px height and 8px radius as buttons so they align in a row.',
      demo('Text input · Search', `<div style="display:flex;flex-direction:column;gap:12px;max-width:420px">${input("What are my user's primary use cases?")}${input('Search studies', I.search(18))}</div>`) +
      demo('Toggle · Off / On', flex(toggle(false), toggle(true))))}
    ${sec('Badges & avatars', 'Pills 22px tall, tinted background with matching ink.',
      demo('Status', flex(badge('Free', 'free'), badge('Live', 'success'), badge('Draft'), badge('Paused', 'warn'), badge('Error', 'danger'), badge('New', 'info'), badge('AI', 'ai'))) +
      demo('Avatars', flex(avatar('AS', 28), avatar('JP', 32, C.infoBg, C.info), avatar('MK', 40, C.successBg, C.success))))}
    ${sec('Tabs', 'Underline style, 2px ink indicator.', demo('', tabs(['All', 'Surveys', 'Replays', 'Heatmaps'], 0)))}
  </div>
  <div>
    ${sec('Navigation', '40px rows, 8px radius, 20px icon, active state is a flat grey fill.',
      `<div style="width:224px;background:${C.sidebar};border:1px solid ${C.line};border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:4px">
        <div style="display:flex;align-items:center;gap:12px;height:40px;padding:0 12px;border-radius:8px;background:${C.navActive};font-weight:500;font-size:15px">${I.home(20)}Home (active)</div>
        <div style="display:flex;align-items:center;gap:12px;height:40px;padding:0 12px;font-size:15px">${I.studies(20)}Studies</div>
        <div style="display:flex;align-items:center;gap:12px;height:40px;padding:0 12px;font-size:15px">${I.users(20)}Users</div></div>`)}
    ${sec('AI banner', 'Lavender surface, 24px radius, centred copy; suggestion chips are white cards with a purple icon.',
      `<div style="background:${C.aiBg};border:1px solid ${C.aiBorder};border-radius:24px;padding:24px;text-align:center"><div style="font-size:15px;font-weight:500;margin-bottom:6px">Instantly generate studies for your goal</div><div style="font-size:13px;color:${C.ink2};margin-bottom:16px">Share your product goal and let AI draft ideas.</div><div style="display:flex;gap:10px;justify-content:center;margin-bottom:16px">${input('What are my user’s primary use cases?', '', '260px')}${btn('Generate', 'primary', I.sparkle(18))}</div><div style="display:flex;gap:10px"><div style="flex:1;background:${C.surface};border:1px solid ${C.aiBorder};border-radius:12px;padding:12px;text-align:left;font-size:13px;display:flex;gap:8px;color:${C.ink}"><span style="color:${C.accent}">${I.compass(16)}</span>Primary use cases?</div><div style="flex:1;background:${C.surface};border:1px solid ${C.aiBorder};border-radius:12px;padding:12px;text-align:left;font-size:13px;display:flex;gap:8px"><span style="color:${C.accent}">${I.chart(16)}</span>Where do users drop?</div></div></div>`)}
    ${sec('Step card', 'Illustration tile (200px, tinted) + numbered title, muted description, secondary CTA. Border, no shadow.', stepCard(1, 'Install the SDK', 'Choose from popular installation methods.', 'View install guides', tile, C.accentSoft))}
  </div></div>
  ${sec('Table', 'Header row on sidebar tint, 60px body rows, hairline separators, 16px radius container.',
    table('2fr 1fr 1fr 1fr', ['Name', 'Type', 'Status', 'Responses'], [
      [`<div style="font-weight:500">Onboarding survey</div>`, 'Survey', badge('Live', 'success'), '1,284'],
      [`<div style="font-weight:500">Checkout replay</div>`, 'Replay', badge('Paused', 'warn'), '312'],
    ]))}`,
  1440, 1560);

// ---------- Pages ------------------------------------------------------------
const suggestion = (icon) => `<div style="flex:1;background:${C.surface};border:1px solid ${C.aiBorder};border-radius:12px;padding:16px;display:flex;gap:12px;font-size:15px;line-height:22px"><span style="color:${C.accent};margin-top:1px">${icon}</span><span>What are my user's primary use cases?</span></div>`;
const homeMain = `<div style="font-size:28px;font-weight:500;letter-spacing:-.4px;margin-bottom:28px">Welcome to Sprig, Alex</div>
<div style="background:${C.aiBg};border-radius:24px;padding:32px 40px;margin-bottom:32px">
  <div style="text-align:center;font-size:17px;font-weight:500;margin-bottom:6px">Instantly generate Sprig studies that are customized to your unique product goal.</div>
  <div style="text-align:center;font-size:15px;color:${C.ink};margin-bottom:22px">Share your product goal and let Sprig AI draft study ideas for you. Be specific about what you want to learn, the audience, and any business context.</div>
  <div style="display:flex;gap:16px;justify-content:center;margin-bottom:22px"><div style="width:560px">${input("What are my user's primary use cases?")}</div>${btn('Generate Ideas', 'primary', I.sparkle(18))}</div>
  <div style="display:flex;gap:16px">${suggestion(I.compass(18))}${suggestion(I.phone(18))}${suggestion(I.chart(18))}${suggestion(I.person(18))}</div>
</div>
<div style="font-size:18px;font-weight:500;margin-bottom:16px">Explore Sprig</div>
<div style="display:flex;flex-direction:column;gap:16px">
 ${[
   [1, 'Install the SDK', 'Choose from popular installation methods such as JS SDK, Segment, and Google Tag Manager.', 'View install guides', C.accentSoft,
    `<div style="display:flex;gap:14px;align-items:center"><div style="width:52px;height:52px;border-radius:12px;background:#F7DF1E;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:22px">JS</div><div style="width:52px;height:52px;border-radius:12px;background:#2BC27C"></div><div style="width:52px;height:52px;border-radius:12px;background:${C.surface};color:#4A86F7;display:flex;align-items:center;justify-content:center">${I.sparkle(28)}</div></div>`],
   [2, 'Create a study', 'Create a Replay, Heatmap, Survey, or Feedback study from scratch or with our customizable templates.', 'Create a study', C.yellow,
    `<div style="width:170px;background:${C.surface};border-radius:10px;padding:12px;font-size:11px;box-shadow:0 1px 3px rgba(0,0,0,.1)"><b>Replays</b><div style="color:${C.ink2};margin:6px 0">brian.brava@email.com</div><div style="color:${C.ink2}">User 6701fba721</div></div>`],
   [3, 'Add events and attributes', 'Target your study at the right users at the right time in your product with events and attributes.', 'Add events', C.mint,
    `<div style="background:${C.surface};border:1px solid ${C.line};border-radius:8px;padding:10px 14px;font-size:12px">Completed Onboarding</div>`],
 ].map(([n, t, d, cta, bg, art]) => `<div style="display:flex;background:${C.surface};border:1px solid ${C.line};border-radius:20px;overflow:hidden;height:150px"><div style="width:232px;flex-shrink:0;background:${bg};display:flex;align-items:center;justify-content:center">${art}</div><div style="padding:20px 32px"><div style="display:flex;align-items:center;gap:12px;margin-bottom:8px"><div style="width:28px;height:28px;border-radius:50%;background:${C.chip};display:flex;align-items:center;justify-content:center;font-size:13px;color:${C.ink2}">${n}</div><div style="font-size:18px;font-weight:500">${t}</div></div><div style="font-size:15px;color:${C.ink2};margin-bottom:14px">${d}</div>${btn(cta, 'secondary')}</div></div>`).join('')}
</div>
<div style="position:absolute;right:-40px;top:420px;width:38px;height:100px;background:${C.primary};color:${C.onPrimary};border-radius:12px 0 0 12px;writing-mode:vertical-rl;transform:rotate(180deg);display:flex;align-items:center;justify-content:center;font-size:13px">Feedback</div>
<div style="position:absolute;right:-20px;bottom:-12px;width:58px;height:58px;border-radius:50%;background:${C.orange};display:flex;align-items:center;justify-content:center;color:${C.ink}">${I.message(26)}</div>`;

const studiesMain = pageTitle('Studies', btn('New Study', 'primary', I.plus(18))) +
  tabs(['All studies', 'Surveys', 'Replays', 'Heatmaps', 'Feedback'], 0) +
  `<div style="display:flex;gap:12px;margin:20px 0">${input('Search studies', I.search(18), '360px')}${btn('Status', 'secondary', I.filter(18))}${btn('Created by', 'secondary')}</div>` +
  table('2.4fr 1fr 1fr 1fr 1fr 40px', ['Name', 'Type', 'Status', 'Responses', 'Updated', ''], [
    ['Onboarding satisfaction', 'Survey', badge('Live', 'success'), '1,284', '2 hours ago', I.more(18)],
    ['Checkout abandonment', 'Replay', badge('Live', 'success'), '312', 'Yesterday', I.more(18)],
    ['Pricing page clicks', 'Heatmap', badge('Paused', 'warn'), '9,870', '3 days ago', I.more(18)],
    ['In-app feedback widget', 'Feedback', badge('Live', 'success'), '86', '5 days ago', I.more(18)],
    ['Feature discovery', 'Survey', badge('Draft'), '–', 'Last week', I.more(18)],
    ['Churn exit survey', 'Survey', badge('Ended', 'info'), '540', 'Last month', I.more(18)],
    ['Mobile nav replay', 'Replay', badge('Draft'), '–', 'Last month', I.more(18)],
  ].map((r) => [`<div style="font-weight:500">${r[0]}</div>`, ...r.slice(1)]));

const kpi = (label, val, delta, up = true) => card(`<div style="font-size:13px;color:${C.ink2};margin-bottom:8px">${label}</div><div style="font-size:30px;font-weight:500;letter-spacing:-.5px;margin-bottom:6px">${val}</div><div style="font-size:13px;color:${up ? C.successInk : C.dangerInk}">${up ? '▲' : '▼'} ${delta} <span style="color:${C.ink3}">vs last 30 days</span></div>`);
const bars = [42, 58, 51, 74, 66, 88, 79, 94, 72, 85, 97, 90].map((h, i) => `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:8px"><div style="width:100%;height:${h * 2}px;background:${i === 10 ? C.primary : C.lineStrong};border-radius:6px 6px 0 0"></div><span style="font-size:11px;color:${C.ink3}">${['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'][i]}</span></div>`).join('');
const dashMain = pageTitle('Dashboards', btn('Last 30 days', 'secondary') + btn('New dashboard', 'primary', I.plus(18))) +
  `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:16px">${kpi('Responses', '12,480', '12.4%')}${kpi('Completion rate', '68%', '3.1%')}${kpi('Avg. satisfaction', '4.3 / 5', '0.2')}${kpi('Drop-off', '21%', '1.8%', false)}</div>
<div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">
 ${card(`<div style="display:flex;justify-content:space-between;margin-bottom:20px"><div style="font-size:18px;font-weight:500">Responses over time</div>${badge('Monthly')}</div><div style="display:flex;align-items:flex-end;gap:10px;height:230px;border-bottom:1px solid ${C.line}">${bars}</div>`, 24)}
 ${card(`<div style="font-size:18px;font-weight:500;margin-bottom:16px">Top studies</div>${[['Onboarding satisfaction', 82], ['Checkout abandonment', 61], ['Pricing page clicks', 47], ['Feedback widget', 22]].map(([n, v]) => `<div style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:6px"><span>${n}</span><span style="color:${C.ink2}">${v}%</span></div><div style="height:8px;border-radius:999px;background:${C.chip}"><div style="height:8px;width:${v}%;border-radius:999px;background:${C.primary}"></div></div></div>`).join('')}`, 24)}
</div>
<div style="margin-top:16px">${card(`<div style="font-size:18px;font-weight:500;margin-bottom:12px">Latest responses</div>${[['brian.brava@email.com', 'Onboarding satisfaction', '5 / 5', '14 min ago'], ['jennyspaziano951@email.com', 'Checkout abandonment', '3 / 5', '1 hour ago'], ['User 6701fba721', 'Pricing page clicks', '4 / 5', '3 hours ago']].map(([u, s, r, t]) => `<div style="display:flex;align-items:center;gap:14px;padding:12px 0;border-top:1px solid ${C.line};font-size:15px"><div style="flex:1.2;font-weight:500">${u}</div><div style="flex:1;color:${C.ink2}">${s}</div><div style="width:80px">${r}</div><div style="width:110px;color:${C.ink3};text-align:right">${t}</div></div>`).join('')}`, 24)}</div>`;

const person = (init, name, email, plan, last, bg, fg) => [
  `<div style="display:flex;align-items:center;gap:12px">${avatar(init, 32, bg, fg)}<div><div style="font-weight:500;line-height:18px">${name}</div><div style="font-size:13px;color:${C.ink2}">${email}</div></div></div>`,
  badge(plan, plan === 'Pro' ? 'info' : 'neutral'), last, badge('Onboarded', 'success'), I.more(18)];
const usersMain = pageTitle('Users', btn('Export', 'secondary') + btn('Add attribute', 'primary', I.plus(18))) +
  `<div style="display:flex;gap:12px;margin-bottom:20px">${input('Search by name, email or user ID', I.search(18), '420px')}${btn('Attributes', 'secondary', I.filter(18))}</div>` +
  table('2.2fr 1fr 1.2fr 1fr 40px', ['User', 'Plan', 'Last seen', 'Segment', ''], [
    person('BB', 'Brian Brava', 'brian.brava@email.com', 'Pro', '14 minutes ago', C.infoBg, C.info),
    person('JS', 'Jenny Spaziano', 'jennyspaziano951@email.com', 'Free', '1 hour ago', C.successBg, C.success),
    person('U6', 'User 6701fba721', 'No email', 'Free', '3 hours ago', C.chip, C.ink2),
    person('MK', 'Maya Khan', 'maya@northwind.io', 'Pro', 'Yesterday', C.warnBg, C.warn),
    person('LT', 'Leo Tran', 'leo@tran.dev', 'Pro', '2 days ago', C.aiBg, C.accent),
    person('U7', 'User a7ceed82f6', 'No email', 'Free', '1 week ago', C.chip, C.ink2),
    person('SO', 'Sara Okafor', 'sara@acme.co', 'Pro', '2 weeks ago', C.dangerBg, C.danger),
  ]);

const typeCard = (icon, title, desc, tint) => card(`<div style="width:44px;height:44px;border-radius:12px;background:${tint};display:flex;align-items:center;justify-content:center;margin-bottom:16px">${icon}</div><div style="font-size:18px;font-weight:500;margin-bottom:6px">${title}</div><div style="font-size:15px;color:${C.ink2};line-height:22px">${desc}</div>`, 24);
const thumbBg = { Survey: C.accentSoft, Replay: C.yellow, Heatmap: C.mint, Feedback: C.freeBg };
const tpl = (title, tag) => `<div style="border:1px solid ${C.line};border-radius:16px;overflow:hidden;background:${C.surface}"><div style="height:96px;background:${thumbBg[tag]};display:flex;align-items:center;justify-content:center"><div style="width:150px;background:${C.surface};border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:7px"><div style="height:7px;width:70%;background:${C.line};border-radius:4px"></div><div style="height:7px;width:95%;background:${C.chip};border-radius:4px"></div><div style="height:7px;width:55%;background:${C.chip};border-radius:4px"></div></div></div><div style="padding:16px"><div style="font-weight:500;margin-bottom:6px">${title}</div>${badge(tag)}</div></div>`;
const createMain = pageTitle('Create a study', btn('Cancel', 'ghost')) +
  `<div style="font-size:15px;color:${C.ink2};margin:-12px 0 24px">Pick a study type to start from scratch, or begin with a template.</div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:36px">
 ${typeCard(I.survey(22), 'Survey', 'Ask in-product questions at the right moment.', C.accentSoft)}${typeCard(I.replay(22), 'Replay', 'Watch real sessions to see where users struggle.', C.yellow)}${typeCard(I.heat(22), 'Heatmap', 'See where users click, scroll and hover.', C.mint)}${typeCard(I.message(22), 'Feedback', 'Let users tell you what they think, anywhere.', '#FDE7BC')}
</div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><div style="font-size:18px;font-weight:500">Templates</div>${tabs(['Popular', 'Onboarding', 'Retention', 'Pricing'], 0).replace('border-bottom:1px solid ' + C.line, 'border-bottom:none')}</div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">${tpl('NPS survey', 'Survey')}${tpl('Concept test', 'Survey')}${tpl('Checkout replay', 'Replay')}${tpl('Page heatmap', 'Heatmap')}${tpl('Feature request', 'Feedback')}${tpl('Churn exit survey', 'Survey')}${tpl('Onboarding CSAT', 'Survey')}${tpl('Bug report', 'Feedback')}</div>`;

const integ = (name, desc, on, color) => card(`<div style="display:flex;align-items:center;gap:14px;margin-bottom:14px"><div style="width:44px;height:44px;border-radius:12px;background:${color};flex-shrink:0"></div><div style="flex:1"><div style="font-size:17px;font-weight:500">${name}</div></div>${toggle(on)}</div><div style="font-size:15px;color:${C.ink2};line-height:22px;margin-bottom:16px">${desc}</div>${on ? badge('Connected', 'success') : btn('Connect', 'secondary')}`, 24);
const integMain = pageTitle('Integrations') + tabs(['All', 'Connected', 'Analytics', 'Messaging', 'Data'], 0) +
  `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:24px">
 ${integ('Segment', 'Send Sprig events and responses to your CDP.', true, '#2BC27C')}${integ('Slack', 'Get notified when new responses come in.', true, '#4A154B')}${integ('Google Tag Manager', 'Install the Sprig SDK without a deploy.', false, '#4A86F7')}
 ${integ('Amplitude', 'Sync survey answers as user properties.', false, '#1E61F0')}${integ('Mixpanel', 'Create cohorts from study responses.', false, '#7856FF')}${integ('Webhooks', 'Push raw data to any endpoint in real time.', false, C.ink)}</div>`;

// ---------- Run --------------------------------------------------------------
await artboard('DS · Foundations', 1440, 2500, foundations);
await artboard('DS · Components', 1440, 1560, components);
await artboard('Home', 1440, 900, shell('Home', `<div style="position:relative;height:100%">${homeMain}</div>`));
await artboard('Studies', 1440, 900, shell('Studies', studiesMain));
await artboard('Dashboards', 1440, 900, shell('Dashboards', dashMain));
await artboard('Users', 1440, 900, shell('Users', usersMain));
await artboard('Create a study', 1440, 900, shell('Studies', createMain));
await artboard('Integrations', 1440, 900, shell('Integrations', integMain));
console.log('done', THEME);
