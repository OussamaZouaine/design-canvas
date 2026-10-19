// Adds six more pages to the "Sprig design system" project using the same tokens and
// components as the first batch (see ds.mjs). Colours are converted from the hex palette to
// OKLCH when the HTML is sent, so the canvas stores OKLCH while the look stays identical.
//   node build-more.mjs            (the canvas server must be running)
import { T, I, btn, badge, avatar, input, card, toggle, tabs, shell, pageTitle, table, THEME, themeSuffix } from './ds.mjs';
const C = T.c;

// ---- hex -> oklch --------------------------------------------------------------
const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
function hexToOklch(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(h.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const Ch = Math.hypot(A, B);
  const H = Ch < 0.004 ? 0 : (Math.atan2(B, A) * 180 / Math.PI + 360) % 360;
  return `oklch(${+L.toFixed(3)} ${+Ch.toFixed(3)} ${+H.toFixed(1)})`;
}
const toOklch = (html) => html.replace(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g, (m) => hexToOklch(m));

// ---- MCP plumbing ----------------------------------------------------------------
let rid = 0;
async function tool(name, args) {
  const res = await fetch('http://localhost:3777/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method: 'tools/call', params: { name, arguments: args } }),
  });
  const out = JSON.parse((await res.text()).split('\n').find((l) => l.startsWith('data:')).slice(5)).result;
  if (out.isError) throw new Error(`${name}: ${out.content[0].text}`);
  return out.content[0].text;
}

const projects = JSON.parse(await tool('list_projects', {})).projects;
const project = projects.find((p) => p.name === 'Sprig design system');
if (!project) throw new Error('Sprig design system project not found');
const P = project.project_id;

// Re-runnable: remove pages this script created before, then rebuild them.
const MINE = new Set(['Behavior', 'Events', 'Attributes', 'Study results', 'Settings', 'Upgrade'].map((n) => n + themeSuffix));
const existing = JSON.parse(await tool('get_basic_info', { project_id: P })).artboards.filter((a) => MINE.has(a.name));
if (existing.length) await tool('delete_nodes', { project_id: P, ids: existing.map((a) => a.id) });

// Second row under the first batch so the canvas stays organised.
let col = 0;
async function page(name, html) {
  const { id } = JSON.parse(await tool('create_artboard', { project_id: P, name: name + themeSuffix, width: 1440, height: 900, x: 3120 + col * 1560, y: 1200 + (THEME === 'dark' ? 6600 : 0) }));
  col++;
  await tool('write_html', { project_id: P, target_id: id, html: toOklch(html) });
  console.log('built', name, id);
}

// ---- shared bits -----------------------------------------------------------------
const mono = "font-family:Consolas,'SF Mono',monospace";
const muted = `color:${C.ink2}`;
const h18 = (t, extra = '') => `<div style="font-size:18px;font-weight:500;${extra}">${t}</div>`;
const chip = (t, bg = C.chip, fg = C.ink2) => `<span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:6px;font-size:12px;font-weight:500;background:${bg};color:${fg}">${t}</span>`;
const kpi = (label, val, delta, up = true) => card(`<div style="font-size:13px;${muted};margin-bottom:8px">${label}</div><div style="font-size:30px;font-weight:500;letter-spacing:-.5px;margin-bottom:6px">${val}</div><div style="font-size:13px;color:${up ? C.success : C.danger}">${up ? '▲' : '▼'} ${delta} <span style="color:${C.ink3}">vs last 30 days</span></div>`);

// ======================= 1. Behavior =============================================
const pts = [32, 38, 35, 46, 52, 49, 61, 58, 70, 66, 78, 74, 88, 84, 96];
const W = 560, H = 250;
const xy = pts.map((v, i) => [Math.round((i / (pts.length - 1)) * W), Math.round(H - (v / 100) * (H - 16) - 8)]);
const line = xy.map(([x, y]) => `${x},${y}`).join(' ');
const chart = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;overflow:visible">
  ${[0, 1, 2, 3].map((i) => `<line x1="0" x2="${W}" y1="${8 + i * ((H - 16) / 3)}" y2="${8 + i * ((H - 16) / 3)}" stroke="${C.line}" stroke-width="1"/>`).join('')}
  <polygon points="0,${H} ${line} ${W},${H}" fill="${C.accentSoft}" fill-opacity="0.28"/>
  <polyline points="${line}" fill="none" stroke="${C.primary}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${xy.at(-1)[0]}" cy="${xy.at(-1)[1]}" r="5" fill="${C.primary}" stroke="${C.surface}" stroke-width="2"/>
</svg>`;
const step = (label, pct, n, drop) => `<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:6px"><span>${label}</span><span style="${muted};font-variant-numeric:tabular-nums">${n} · ${pct}%</span></div><div style="height:24px;border-radius:8px;background:${C.chip}"><div style="height:24px;width:${pct}%;border-radius:8px;background:${C.primary}"></div></div>${drop ? `<div style="font-size:12px;color:${C.danger};margin-top:4px">−${drop}% drop-off</div>` : ''}</div>`;
const behavior = shell('Behavior',
  pageTitle('Behavior', btn('Last 30 days', 'secondary') + btn('Save view', 'secondary')) +
  tabs(['Overview', 'Funnels', 'Retention', 'User paths'], 0) +
  `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:20px 0 16px">${kpi('Sessions', '48,210', '9.6%')}${kpi('Active users', '9,310', '4.2%')}${kpi('Avg. session length', '4m 12s', '0.8%', false)}</div>
  <div style="display:grid;grid-template-columns:1.25fr 1fr;gap:16px">
    ${card(`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">${h18('Sessions over time')}${badge('Daily')}</div>${chart}`, 24)}
    ${card(`${h18('Onboarding funnel', 'margin-bottom:18px')}${step('Visited sign-up', 100, '9,310')}${step('Created account', 72, '6,703', 28)}${step('Completed onboarding', 51, '4,748', 21)}${step('Invited a teammate', 23, '2,141', 28)}`, 24)}
  </div>
  <div style="margin-top:16px">${table('2fr 1fr 1fr 1fr', ['Top events', 'Count', 'Users', 'Trend'], [
    ['<b style="font-weight:500">Completed Onboarding</b>', '4,748', '4,102', badge('+12%', 'success')],
    ['<b style="font-weight:500">Checkout Abandoned</b>', '1,284', '1,190', badge('+4%', 'warn')],
  ])}</div>`);

// ======================= 2. Events ===============================================
const code = `<div style="${mono};background:${C.primary};color:${C.onPrimary};border-radius:12px;padding:16px 20px;font-size:14px;line-height:22px"><span style="color:${C.accentSoft}">Sprig</span>(<span style="color:${C.yellow}">'track'</span>, <span style="color:${C.mint}">'Checkout Abandoned'</span>);</div>`;
const ev = (name, src, count, users, last, tone, label) => [`<div style="${mono};font-size:14px">${name}</div>`, src, count, users, last, badge(label, tone)];
const events = shell('Events',
  pageTitle('Events', btn('Add event', 'primary', I.plus(18))) +
  `<div style="background:${C.sidebar};border:1px solid ${C.line};border-radius:16px;padding:20px 24px;margin-bottom:20px;display:flex;gap:32px;align-items:center"><div style="flex:1"><div style="font-size:18px;font-weight:500;margin-bottom:6px">Track an event from your product</div><div style="font-size:15px;${muted}">Events let you target studies at the right moment, such as after a purchase or when a user abandons checkout.</div></div><div style="width:440px">${code}</div></div>` +
  `<div style="display:flex;gap:12px;margin-bottom:20px">${input('Search events', I.search(18), '360px')}${btn('Source', 'secondary', I.filter(18))}</div>` +
  table('2.2fr 1fr 1fr 1fr 1.2fr 1fr', ['Event', 'Source', 'Count (30d)', 'Users', 'Last seen', 'Status'], [
    ev('Completed Onboarding', 'SDK', '4,748', '4,102', '2 min ago', 'success', 'Live'),
    ev('Checkout Abandoned', 'SDK', '1,284', '1,190', '14 min ago', 'success', 'Live'),
    ev('Viewed Pricing', 'Segment', '8,902', '5,310', '1 hour ago', 'success', 'Live'),
    ev('Invited Teammate', 'SDK', '612', '540', 'Yesterday', 'success', 'Live'),
    ev('Exported Report', 'SDK', '98', '74', '5 days ago', 'warn', 'Idle'),
    ev('Upgraded Plan', 'Segment', '41', '41', '12 days ago', 'warn', 'Idle'),
    ev('Deleted Workspace', 'SDK', '0', '0', 'Never', 'neutral', 'Not seen'),
  ]));

// ======================= 3. Attributes ===========================================
const typeChip = (t) => ({ String: chip('String', C.infoBg, C.info), Number: chip('Number', C.successBg, C.success), Boolean: chip('Boolean', C.warnBg, C.warn), Date: chip('Date', C.aiBg, C.accent) })[t];
const at = (name, type, src, used, upd) => [`<div style="${mono};font-size:14px">${name}</div>`, typeChip(type), src, `${used} ${used === 1 ? 'study' : 'studies'}`, upd];
const attributes = shell('Attributes',
  pageTitle('Attributes', btn('Import', 'secondary') + btn('New attribute', 'primary', I.plus(18))) +
  tabs(['All', 'Custom', 'Sprig default'], 0) +
  `<div style="display:flex;gap:12px;margin:20px 0">${input('Search attributes', I.search(18), '360px')}${btn('Type', 'secondary', I.filter(18))}</div>` +
  table('2fr 1fr 1fr 1fr 1fr', ['Attribute', 'Type', 'Source', 'Used in', 'Updated'], [
    at('email', 'String', 'SDK', 6, '2 hours ago'),
    at('plan', 'String', 'Segment', 4, 'Yesterday'),
    at('signup_date', 'Date', 'SDK', 3, '3 days ago'),
    at('lifetime_value', 'Number', 'Segment', 2, '3 days ago'),
    at('is_admin', 'Boolean', 'SDK', 2, 'Last week'),
    at('company_size', 'Number', 'CSV import', 1, 'Last week'),
    at('last_login', 'Date', 'SDK', 5, 'Last month'),
    at('beta_tester', 'Boolean', 'SDK', 0, 'Last month'),
  ]));

// ======================= 4. Study results ========================================
const dist = [['5', 46], ['4', 31], ['3', 13], ['2', 6], ['1', 4]]
  .map(([n, p]) => `<div style="display:flex;align-items:center;gap:12px;margin-bottom:7px"><span style="width:14px;font-size:14px;${muted}">${n}</span><div style="flex:1;height:18px;border-radius:6px;background:${C.chip}"><div style="height:18px;width:${p * 2}%;border-radius:6px;background:${n >= 4 ? C.primary : C.lineStrong}"></div></div><span style="width:44px;text-align:right;font-size:14px;font-variant-numeric:tabular-nums">${p}%</span></div>`).join('');
const choice = [['Pricing was unclear', 38], ['Missing an integration', 27], ['Setup took too long', 21], ['Nothing, it was easy', 14]]
  .map(([t, p]) => `<div style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:4px"><span>${t}</span><span style="${muted}">${p}%</span></div><div style="height:8px;border-radius:999px;background:${C.chip}"><div style="height:8px;width:${p * 2}%;border-radius:999px;background:${C.accent}"></div></div></div>`).join('');
const quote = (init, who, text, when, bg, fg) => `<div style="display:flex;gap:12px;padding:14px 0;border-top:1px solid ${C.line}">${avatar(init, 32, bg, fg)}<div><div style="font-size:14px"><b style="font-weight:500">${who}</b> <span style="color:${C.ink3};font-size:12px">· ${when}</span></div><div style="font-size:14px;${muted};margin-top:3px;line-height:20px">${text}</div></div></div>`;
const results = shell('Studies',
  `<div style="font-size:13px;${muted};margin-bottom:6px">Studies / Survey</div>` +
  `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px"><div style="display:flex;align-items:center;gap:12px"><div style="font-size:28px;font-weight:500;letter-spacing:-.4px">Onboarding satisfaction</div>${badge('Live', 'success')}</div><div style="display:flex;gap:10px">${btn('Pause', 'secondary')}${btn('Share results', 'primary')}</div></div>` +
  tabs(['Results', 'Questions', 'Targeting', 'Settings'], 0) +
  `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:16px 0 16px">${kpi('Responses', '1,284', '12.4%')}${kpi('Completion', '68%', '3.1%')}${kpi('Avg. rating', '4.3', '0.2')}${kpi('Median time', '38s', '4s', false)}</div>
  <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:16px">
    <div style="display:flex;flex-direction:column;gap:16px">
      ${card(`<div style="font-size:13px;${muted};margin-bottom:4px">Question 1 · Rating</div>${h18('How satisfied are you with onboarding?', 'margin-bottom:14px')}${dist}`, 20)}
      ${card(`<div style="font-size:13px;${muted};margin-bottom:4px">Question 2 · Multiple choice</div>${h18('What nearly stopped you from finishing?', 'margin-bottom:14px')}${choice}`, 20)}
    </div>
    ${card(`${h18('Latest responses', 'margin-bottom:8px')}${quote('BB', 'Brian B.', 'Loved the setup flow, but pricing was hard to find.', '14 min ago', C.infoBg, C.info)}${quote('JS', 'Jenny S.', 'Segment integration saved us hours.', '1 hour ago', C.successBg, C.success)}${quote('MK', 'Maya K.', 'Needed Slack alerts, could not find where.', '3 hours ago', C.warnBg, C.warn)}${quote('LT', 'Leo T.', 'Smooth. Five stars.', 'Yesterday', C.aiBg, C.accent)}`, 24)}
  </div>`);

// ======================= 5. Settings =============================================
const subnav = ['General', 'Team', 'Billing', 'API keys', 'Notifications'].map((t, i) =>
  `<div style="height:40px;display:flex;align-items:center;padding:0 12px;border-radius:8px;font-size:15px;${i === 0 ? `background:${C.navActive};font-weight:500` : ''}">${t}</div>`).join('');
const field = (label, value, hint = '') => `<div style="margin-bottom:16px"><div style="font-size:13px;font-weight:500;margin-bottom:6px">${label}</div><div style="height:40px;border:1px solid ${C.line};border-radius:8px;display:flex;align-items:center;padding:0 14px;font-size:15px;box-sizing:border-box">${value}</div>${hint ? `<div style="font-size:12px;color:${C.ink3};margin-top:4px">${hint}</div>` : ''}</div>`;
const envRow = (name, id) => `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid ${C.line}"><div style="width:120px;font-size:14px">${name}</div><div style="${mono};font-size:13px;background:${C.chip};border-radius:6px;padding:4px 10px;flex:1">${id}</div>${btn('Copy', 'secondary')}</div>`;
const member = (init, name, email, role, tone, bg, fg) => `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid ${C.line}">${avatar(init, 32, bg, fg)}<div style="flex:1"><div style="font-size:14px;font-weight:500">${name}</div><div style="font-size:13px;${muted}">${email}</div></div>${badge(role, tone)}</div>`;
const settings = shell('Settings',
  pageTitle('Settings') +
  `<div style="display:flex;gap:32px"><div style="width:200px;flex-shrink:0;display:flex;flex-direction:column;gap:4px">${subnav}</div><div style="flex:1;display:flex;flex-direction:column;gap:16px">
    ${card(`${h18('Workspace', 'margin-bottom:16px')}<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">${field('Workspace name', 'ASMobbin')}${field('Default timezone', 'UTC−05:00 · New York')}</div>${field('Allowed domains', 'asmobbin.com', 'Studies only run on these domains.')}<div style="display:flex;align-items:center;justify-content:space-between;padding-top:4px"><div><div style="font-size:15px">Collect session replays</div><div style="font-size:13px;${muted}">Record anonymised sessions for Replay studies.</div></div>${toggle(true)}</div>`, 24)}
    ${card(`${h18('Environments', 'margin-bottom:8px')}${envRow('Production', 'env_prod_8f2a91c4d7')}${envRow('Development', 'env_dev_31b7e0a96c')}`, 24)}
    ${card(`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">${h18('Team')}${btn('Invite', 'secondary', I.plus(18))}</div>${member('AS', 'Alex Stone', 'alex@asmobbin.com', 'Owner', 'free', C.chip, C.ink2)}${member('JP', 'Jordan Park', 'jordan@asmobbin.com', 'Admin', 'info', C.infoBg, C.info)}`, 24)}
  </div></div>`);

// ======================= 6. Upgrade ==============================================
const feat = (t, on = true) => `<div style="display:flex;gap:10px;align-items:center;font-size:15px;margin-bottom:12px;${on ? '' : `color:${C.ink3}`}"><span style="color:${on ? C.success : C.ink3}">${I.check(18)}</span>${t}</div>`;
const plan = (name, price, sub, feats, cta, kind, opts = {}) => `<div style="flex:1;background:${C.surface};border:${opts.hi ? `2px solid ${C.primary}` : `1px solid ${C.line}`};border-radius:20px;padding:28px;position:relative;box-sizing:border-box">${opts.tag ? `<div style="position:absolute;top:-12px;left:28px">${badge(opts.tag, 'ai')}</div>` : ''}<div style="font-size:18px;font-weight:500">${name}</div><div style="display:flex;align-items:baseline;gap:6px;margin:12px 0 4px"><span style="font-size:40px;font-weight:500;letter-spacing:-1px">${price}</span><span style="${muted}">${sub}</span></div><div style="height:1px;background:${C.line};margin:20px 0"></div>${feats}<div style="margin-top:20px">${btn(cta, kind)}</div></div>`;
const upgrade = shell('Upgrade',
  `<div style="text-align:center;margin:8px 0 28px"><div style="font-size:36px;font-weight:500;letter-spacing:-.8px;margin-bottom:8px">Pick the plan that fits</div><div style="font-size:16px;${muted};margin-bottom:20px">Start free. Upgrade when you need more studies, replays and seats.</div><div style="display:inline-flex;align-items:center;gap:12px;font-size:14px"><span style="font-weight:500">Monthly</span>${toggle(true)}<span>Annual</span>${badge('Save 20%', 'success')}</div></div>
  <div style="display:flex;gap:20px;align-items:stretch">
   ${plan('Free', '$0', '/ month', feat('3 live studies') + feat('1,000 responses / month') + feat('Heatmaps and surveys') + feat('Session replays', false), 'Current plan', 'secondary')}
   ${plan('Pro', '$149', '/ month', feat('Unlimited studies') + feat('25,000 responses / month') + feat('Heatmaps, surveys, replays') + feat('Slack and Segment'), 'Upgrade to Pro', 'primary', { hi: true, tag: 'Most popular' })}
   ${plan('Enterprise', 'Custom', '', feat('Unlimited responses') + feat('SSO and audit logs') + feat('Dedicated support') + feat('Custom data retention'), 'Contact sales', 'secondary')}
  </div>
  <div style="margin-top:28px;background:${C.sidebar};border:1px solid ${C.line};border-radius:16px;padding:20px 28px;display:flex;align-items:center;justify-content:space-between"><div style="display:flex;gap:32px;font-size:15px"><span style="display:flex;gap:8px;align-items:center"><span style="color:${C.success}">${I.check(18)}</span>No credit card to start</span><span style="display:flex;gap:8px;align-items:center"><span style="color:${C.success}">${I.check(18)}</span>14-day Pro trial</span><span style="display:flex;gap:8px;align-items:center"><span style="color:${C.success}">${I.check(18)}</span>Cancel anytime</span></div>${btn('Compare all features', 'secondary')}</div>`);

// ---- run ----------------------------------------------------------------------
await page('Behavior', behavior);
await page('Events', events);
await page('Attributes', attributes);
await page('Study results', results);
await page('Settings', settings);
await page('Upgrade', upgrade);
console.log('done:', JSON.parse(await tool('get_basic_info', { project_id: P })).artboards.length, 'artboards');
