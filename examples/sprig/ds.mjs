// Sprig-style design system: tokens + small HTML helper functions shared by every artboard.
// Everything is inline-styled because the canvas only supports inline CSS.
//
// Theming: two palettes (light, dark). Components read colours from `T.c` when they are
// *called*, so a build script picks a theme once (THEME=dark node build.mjs) and every
// helper renders with that palette. Light values are hex (measured from the Sprig home
// screenshot); dark values are authored in OKLCH. Build scripts convert leftover hex to
// OKLCH on the way out, so the canvas stores OKLCH either way.

export const LIGHT = {
  // surfaces
  bg: '#FFFFFF', surface: '#FFFFFF', sidebar: '#FAF9F7', overlay: 'oklch(0.2 0 0 / 0.45)',
  // borders
  line: '#ECEAE6', lineStrong: '#DAD7D2',
  // text
  ink: '#1F1F1F', ink2: '#5F5E5B', ink3: '#8E8D89', onPrimary: '#FFFFFF',
  // interactive
  navActive: '#E9E7E4', primary: '#2A2A2A', primaryHover: '#000000', chip: '#EFEEEC',
  focus: 'oklch(0.62 0.19 262)', link: 'oklch(0.5 0.19 262)',
  // AI + illustration
  aiBg: '#F7F2FC', aiBorder: '#EBE1F6', accent: '#5B3FD0', accentSoft: '#A59CE0',
  yellow: '#FBD95A', mint: '#D6F5EE', orange: '#FBB62E', freeBg: '#FDE7BC', freeInk: '#7A4F00',
  // status (foreground + tinted background)
  success: '#1E9E6A', successBg: '#E3F6EE', warn: '#B87400', warnBg: '#FDF1D6',
  danger: '#D64545', dangerBg: '#FCE8E8', info: '#3B6FE0', infoBg: '#E6EEFD',
  // AA-safe text variants (>= 4.8:1 on the tint and on white). Use these for any text or icon at 12-16px;
  // the plain status colours stay for fills, borders, dots and large text.
  successInk: '#177851', warnInk: '#955E00', dangerInk: '#B63B3B', infoInk: '#3462C5',
};

// Dark keeps the warm neutral hue (~80) and lifts accents so they stay readable on dark surfaces.
export const DARK = {
  bg: 'oklch(0.19 0.004 80)', surface: 'oklch(0.225 0.005 80)', sidebar: 'oklch(0.155 0.004 80)', overlay: 'oklch(0.05 0 0 / 0.6)',
  line: 'oklch(0.3 0.005 80)', lineStrong: 'oklch(0.4 0.006 80)',
  ink: 'oklch(0.96 0.004 80)', ink2: 'oklch(0.76 0.008 80)', ink3: 'oklch(0.6 0.008 80)', onPrimary: 'oklch(0.2 0.005 80)',
  navActive: 'oklch(0.28 0.006 80)', primary: 'oklch(0.95 0.004 80)', primaryHover: 'oklch(1 0 0)', chip: 'oklch(0.28 0.006 80)',
  focus: 'oklch(0.72 0.15 262)', link: 'oklch(0.76 0.13 262)',
  aiBg: 'oklch(0.255 0.045 305)', aiBorder: 'oklch(0.34 0.06 305)', accent: 'oklch(0.76 0.14 285)', accentSoft: 'oklch(0.52 0.11 290)',
  yellow: 'oklch(0.78 0.13 95)', mint: 'oklch(0.45 0.05 180)', orange: 'oklch(0.76 0.15 75)', freeBg: 'oklch(0.32 0.06 80)', freeInk: 'oklch(0.86 0.1 85)',
  success: 'oklch(0.76 0.15 155)', successBg: 'oklch(0.29 0.06 155)', warn: 'oklch(0.82 0.14 80)', warnBg: 'oklch(0.31 0.06 80)',
  danger: 'oklch(0.72 0.17 25)', dangerBg: 'oklch(0.3 0.07 25)', info: 'oklch(0.77 0.12 255)', infoBg: 'oklch(0.29 0.06 255)',
  // dark status colours already pass AA, so the ink variants are the same values
  successInk: 'oklch(0.76 0.15 155)', warnInk: 'oklch(0.82 0.14 80)', dangerInk: 'oklch(0.72 0.17 25)', infoInk: 'oklch(0.77 0.12 255)',
};

export const THEME = process.env.THEME === 'dark' ? 'dark' : 'light';
export const T = {
  theme: THEME,
  c: { ...(THEME === 'dark' ? DARK : LIGHT) },
  font: "Inter, 'Segoe UI', system-ui, -apple-system, sans-serif",
  mono: "Consolas, 'SF Mono', Menlo, monospace",
};
const C = T.c;
export const themeSuffix = THEME === 'dark' ? ' · Dark' : '';

// ---- Colour maths (used by the contrast table) -------------------------------------
const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const unlin = (c) => 255 * Math.max(0, Math.min(1, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
export function toRgb(str) {
  let m = String(str).match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = String(str).match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (!m) throw new Error('Unsupported colour ' + str);
  const [L, Ch, H] = [+m[1], +m[2], +m[3]];
  const a = Ch * Math.cos((H * Math.PI) / 180), b = Ch * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * mm + 1.7076147010 * s].map(unlin);
}
const luminance = (rgb) => { const [r, g, b] = rgb.map((v) => lin(v / 255)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
// WCAG 2.x contrast ratio between two colour strings
export function contrast(a, b) {
  const [x, y] = [luminance(toRgb(a)), luminance(toRgb(b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// ---- Icons (24px grid, 1.75 stroke, currentColor) ----------------------------------
const ic = (d, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">${d}</svg>`;
const defs = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  studies: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><path d="M10 6.5h4a3 3 0 013 3V14"/>',
  behavior: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  dashboards: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 010 6.8"/><path d="M18 14.8c1.9.7 3.2 2.4 3.5 5.2"/>',
  events: '<path d="M4 4h16v9"/><path d="M4 4v14h8"/><path d="M14 14l7 3-3 1.5L16.5 22z"/>',
  attributes: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M5.5 16c.5-1.4 1.8-2 3.5-2s3 .6 3.5 2"/><path d="M15 10h3M15 14h3"/>',
  plug: '<path d="M9 3v5M15 3v5"/><path d="M6 8h12v3a6 6 0 01-12 0z"/><path d="M12 17v4"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  dollar: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9c-.4-1-1.4-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.2 0-2.2-.6-2.5-1.6M12 6v1.5M12 16.5V18"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1-1.5 2"/><path d="M12 17v.01"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sparkle: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-6"/>',
  person: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18c1-2.2 3-3 5.5-3s4.5.8 5.5 3"/>',
  chevron: '<path d="M7 9l5-5 5 5M7 15l5 5 5-5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  arrowUp: '<path d="M7 17L17 7M9 7h8v8"/>',
  survey: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  replay: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l5 3.5-5 3.5z"/>',
  heat: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  message: '<path d="M4 5h16v11H9l-5 4z"/>',
  // added for the expanded system
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 6.2A9.9 9.9 0 0112 6c6.4 0 10 6 10 6a17 17 0 01-3.2 3.9M6.6 7.6C3.6 9.5 2 12 2 12s3.6 7 10 7c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 004.2 4.2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h8"/>',
  edit: '<path d="M4 20h4l10-10-4-4L4 16v4zM13.5 6.5l4 4"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
  alert: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18v.01"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  xCircle: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  bell: '<path d="M6 9a6 6 0 0112 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 004 0"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  folder: '<path d="M3 6a2 2 0 012-2h4l2 2h7a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V6z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/>',
  code: '<path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  logout: '<path d="M9 4H5a2 2 0 00-2 2v12a2 2 0 002 2h4M16 8l4 4-4 4M20 12H9"/>',
  command: '<path d="M9 6a3 3 0 10-3 3h12a3 3 0 10-3-3v12a3 3 0 103-3H6a3 3 0 103 3V6z"/>',
};
export const I = Object.fromEntries(Object.entries(defs).map(([name, d]) => [name, (s) => ic(d, s)]));
export const ICON_NAMES = Object.keys(defs);

// ---- Primitives ---------------------------------------------------------------------
export const btn = (label, kind = 'primary', icon = '', opts = {}) => {
  const { size = 'md', disabled = false, state = '', iconRight = '' } = opts;
  const h = { sm: 32, md: 40, lg: 48 }[size];
  const fs = { sm: 13, md: 15, lg: 16 }[size];
  const px = { sm: 12, md: 16, lg: 20 }[size];
  const k = {
    primary: `background:${state === 'hover' ? C.primaryHover : C.primary};color:${C.onPrimary};border:1px solid ${C.primary}`,
    secondary: `background:${state === 'hover' ? C.sidebar : C.surface};color:${C.ink};border:1px solid ${state === 'hover' ? C.lineStrong : C.line}`,
    ghost: `background:${state === 'hover' ? C.navActive : 'transparent'};color:${C.ink};border:1px solid transparent`,
    danger: `background:${C.surface};color:${C.dangerInk};border:1px solid ${C.dangerBg}`,
    'danger-solid': `background:${C.danger};color:${C.onPrimary === '#FFFFFF' ? '#FFFFFF' : C.bg};border:1px solid ${C.danger}`,
    link: `background:transparent;color:${C.link};border:1px solid transparent;text-decoration:underline`,
  }[kind];
  const ring = state === 'focus' ? `;box-shadow:0 0 0 2px ${C.surface},0 0 0 4px ${C.focus}` : '';
  const press = state === 'pressed' ? ';transform:scale(0.96)' : '';
  const dis = disabled ? ';opacity:.45' : '';
  return `<div style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:${h}px;padding:0 ${px}px;border-radius:8px;font-size:${fs}px;font-weight:450;white-space:nowrap;box-sizing:border-box;${k}${ring}${press}${dis}">${icon}${label}${iconRight}</div>`;
};
// Square icon-only button (same heights as text buttons so they line up in a row)
export const iconBtn = (icon, kind = 'secondary', size = 'md', label = '') => {
  const h = { sm: 32, md: 40, lg: 48 }[size];
  const k = { primary: `background:${C.primary};color:${C.onPrimary};border:1px solid ${C.primary}`, secondary: `background:${C.surface};color:${C.ink};border:1px solid ${C.line}`, ghost: `background:transparent;color:${C.ink2};border:1px solid transparent` }[kind];
  return `<div title="${label}" style="display:inline-flex;align-items:center;justify-content:center;width:${h}px;height:${h}px;border-radius:8px;box-sizing:border-box;${k}">${icon}</div>`;
};
export const badge = (label, tone = 'neutral', opts = {}) => {
  const t = {
    neutral: [C.chip, C.ink2], success: [C.successBg, C.successInk], warn: [C.warnBg, C.warnInk],
    danger: [C.dangerBg, C.dangerInk], info: [C.infoBg, C.infoInk], free: [C.freeBg, C.freeInk], ai: [C.aiBg, C.accent],
    solid: [C.primary, C.onPrimary],
  }[tone];
  const dot = opts.dot ? `<i style="display:inline-block;width:6px;height:6px;border-radius:50%;background:currentColor;margin-right:6px"></i>` : '';
  return `<span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:12px;font-weight:500;background:${t[0]};color:${t[1]}">${dot}${label}</span>`;
};
export const avatar = (initials, size = 32, bg = C.chip, fg = C.ink2) =>
  `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};color:${fg};display:flex;align-items:center;justify-content:center;font-size:${Math.max(10, Math.round(size * 0.38))}px;font-weight:500;flex-shrink:0">${initials}</div>`;
export const input = (placeholder, icon = '', width = '100%') =>
  `<div style="display:flex;align-items:center;gap:8px;height:40px;padding:0 14px;width:${width};box-sizing:border-box;background:${C.surface};border:1px solid ${C.line};border-radius:8px;font-size:15px;color:${C.ink3}">${icon}${placeholder}</div>`;
export const card = (inner, pad = 20, extra = '') =>
  `<div style="background:${C.surface};border:1px solid ${C.line};border-radius:16px;padding:${pad}px;${extra}">${inner}</div>`;
export const toggle = (on, disabled = false) =>
  `<div style="width:36px;height:20px;border-radius:999px;background:${on ? C.primary : C.lineStrong};position:relative;flex-shrink:0;${disabled ? 'opacity:.45' : ''}"><div style="position:absolute;top:2px;${on ? 'right' : 'left'}:2px;width:16px;height:16px;border-radius:50%;background:${on ? C.onPrimary : C.surface}"></div></div>`;
export const tabs = (items, active) =>
  `<div style="display:flex;gap:24px;border-bottom:1px solid ${C.line}">${items.map((t, i) =>
    `<div style="padding:10px 0;font-size:15px;color:${i === active ? C.ink : C.ink2};font-weight:${i === active ? 500 : 400};border-bottom:2px solid ${i === active ? C.ink : 'transparent'};margin-bottom:-1px">${t}</div>`).join('')}</div>`;

// ---- App shell ----------------------------------------------------------------------
const nav = (icon, label, active) =>
  `<div style="display:flex;align-items:center;gap:12px;height:40px;padding:0 12px;border-radius:8px;font-size:15px;color:${C.ink};${active ? `background:${C.navActive};font-weight:500` : ''}">${icon}${label}</div>`;

export function shell(active, main, { w = 1440, h = 900 } = {}) {
  const top = [['Home', I.home], ['Studies', I.studies], ['Behavior', I.behavior], ['Dashboards', I.dashboards]];
  const mid = [['Users', I.users], ['Events', I.events], ['Attributes', I.attributes], ['Integrations', I.plug]];
  const bot = [['Upgrade', I.bolt], ['Refer a Friend', I.dollar], ['Help', I.help], ['Settings', I.settings]];
  const group = (items) => items.map(([l, f]) => nav(f(20), l, l === active)).join('');
  return `<div style="display:flex;width:${w}px;height:${h}px;background:${C.bg};font-family:${T.font};color:${C.ink};overflow:hidden">
  <div style="width:240px;flex-shrink:0;height:100%;background:${C.sidebar};border-right:1px solid ${C.line};padding:24px 16px;display:flex;flex-direction:column;box-sizing:border-box">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:0 4px 20px">
      <div style="display:flex;align-items:center;gap:10px"><div style="font-size:22px;font-weight:600;letter-spacing:-0.5px">Sprig</div>${badge('Free', 'free')}</div>${I.list(18)}
    </div>
    <div style="margin-bottom:20px">${btn('New Study', 'primary', I.plus(18))}</div>
    <div style="display:flex;flex-direction:column;gap:4px">${group(top)}</div>
    <div style="height:1px;background:${C.line};margin:14px 0"></div>
    <div style="display:flex;flex-direction:column;gap:4px">${group(mid)}</div>
    <div style="flex:1"></div>
    <div style="display:flex;flex-direction:column;gap:4px">${group(bot)}</div>
    <div style="display:flex;align-items:center;gap:10px;padding:14px 12px 0;font-size:15px">${avatar('AS', 28)}<span style="flex:1">ASMobbin</span>${I.chevron(16)}</div>
  </div>
  <div style="flex:1;height:100%;overflow:hidden;box-sizing:border-box;padding:32px 40px">${main}</div>
</div>`;
}

export const pageTitle = (title, right = '') =>
  `<div style="display:flex;align-items:center;justify-content:space-between;min-height:44px;margin-bottom:24px"><div style="font-size:28px;font-weight:500;letter-spacing:-0.4px;line-height:36px">${title}</div><div style="display:flex;gap:10px;align-items:center">${right}</div></div>`;

// Table: header row + body rows, columns as CSS grid template. Each cell is wrapped so plain
// text becomes a real grid item (bare text nodes would be merged into one cell).
export const table = (cols, head, rows, opts = {}) => {
  const rowH = opts.dense ? 44 : 60;
  const row = (cells, isHead, selected) =>
    `<div style="display:grid;grid-template-columns:${cols};align-items:center;gap:16px;padding:0 20px;height:${isHead ? 44 : rowH}px;${isHead ? `background:${C.sidebar};font-size:13px;font-weight:500;color:${C.ink2}` : `border-top:1px solid ${C.line};font-size:15px;${selected ? `background:${C.aiBg}` : ''}`}">${cells.map((c) => `<div style="min-width:0">${c}</div>`).join('')}</div>`;
  return `<div style="border:1px solid ${C.line};border-radius:16px;overflow:hidden;background:${C.surface}">${row(head, true)}${rows.map((r, i) => row(r, false, opts.selected && opts.selected.includes(i))).join('')}</div>`;
};

// ---- Doc scaffolding for the system sheets -------------------------------------------
export const sheet = (title, sub, inner, { w = 1440, h = 1600, kicker = 'Sprig design system' } = {}) =>
  `<div style="width:${w}px;height:${h}px;background:${C.bg};font-family:${T.font};color:${C.ink};padding:56px 64px;box-sizing:border-box;overflow:hidden"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${C.accent};font-weight:600;margin-bottom:8px">${kicker}${THEME === 'dark' ? ' · Dark' : ''}</div><div style="font-size:36px;font-weight:500;letter-spacing:-.8px;margin-bottom:6px">${title}</div><div style="font-size:15px;color:${C.ink2};margin-bottom:36px;max-width:780px;line-height:22px">${sub}</div>${inner}</div>`;
export const section = (title, sub, inner) =>
  `<div style="margin-bottom:44px"><div style="font-size:18px;font-weight:500;margin:0 0 4px">${title}</div><div style="font-size:13px;color:${C.ink2};margin-bottom:16px;line-height:18px;max-width:760px">${sub}</div>${inner}</div>`;
export const demo = (label, inner) => `<div style="margin-bottom:22px"><div style="font-size:12px;color:${C.ink2};margin-bottom:10px;font-weight:500">${label}</div>${inner}</div>`;
export const flex = (inner, gap = 12) => `<div style="display:flex;align-items:center;gap:${gap}px;flex-wrap:wrap">${inner}</div>`;
