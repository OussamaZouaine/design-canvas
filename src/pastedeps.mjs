// What a design pasted from ANOTHER project needs to render the same: the tokens its CSS reads (`var(--x)`), the Google
// Fonts it uses, and the component masters its instances came from. Pure: the server reads both projects and applies
// the plan. Only what the target lacks is added, nothing is ever overwritten.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function collectDeps(htmls) {
  const vars = new Set();
  const components = new Set();
  for (const h of htmls) {
    for (const m of h.matchAll(/var\(\s*--([a-z][a-z0-9-]*)/g)) vars.add(m[1]);
    for (const m of h.matchAll(/ data-component="([^"]+)"/g)) components.add(m[1]);
  }
  return { vars, components };
}

// src / dst: { theme: {tokens, modes}, components: {name: master}, fonts: [{family,...}] }.
export function planAdopt(htmls, src, dst) {
  const { vars, components } = collectDeps(htmls);
  const srcTokens = src.theme?.tokens ?? {};
  const modes = src.theme?.modes ?? {};
  // A token can read another one (`var(--color-primary)` inside a gradient), so follow the references.
  const wanted = new Set();
  const queue = [...vars];
  while (queue.length) {
    const name = queue.pop();
    if (wanted.has(name)) continue;
    wanted.add(name);
    for (const v of [srcTokens[name], ...Object.values(modes).map((m) => m?.[name])]) {
      if (typeof v === 'string') for (const m of v.matchAll(/var\(\s*--([a-z][a-z0-9-]*)/g)) queue.push(m[1]);
    }
  }
  const have = dst.theme?.tokens ?? {};
  const tokens = {};
  const modeTokens = {};
  for (const name of wanted) {
    if (name in have || !(name in srcTokens || Object.values(modes).some((m) => m && name in m))) continue;
    if (name in srcTokens) tokens[name] = srcTokens[name];
    for (const [mode, vals] of Object.entries(modes)) if (vals && name in vals) (modeTokens[mode] ??= {})[name] = vals[name];
  }
  const masters = {};
  for (const name of components) if (src.components?.[name] && !dst.components?.[name]) masters[name] = src.components[name];

  // Fonts: a family counts as used when the markup or an adopted token value names it.
  const text = [...htmls, ...Object.values(tokens), ...Object.values(modeTokens).flatMap((m) => Object.values(m))].join('\n');
  const loaded = new Set((dst.fonts ?? []).map((f) => f.family));
  const fonts = (src.fonts ?? []).filter((f) => f?.family && !loaded.has(f.family) && new RegExp(`(^|[^A-Za-z0-9])${esc(f.family)}([^A-Za-z0-9]|$)`).test(text));

  const parts = [];
  const nTok = Object.keys(tokens).length + Object.values(modeTokens).reduce((n, m) => n + Object.keys(m).length, 0);
  if (Object.keys(tokens).length) parts.push(`${Object.keys(tokens).length} token${Object.keys(tokens).length > 1 ? 's' : ''}`);
  if (fonts.length) parts.push(fonts.map((f) => f.family).join(', '));
  if (Object.keys(masters).length) parts.push(`${Object.keys(masters).length} component${Object.keys(masters).length > 1 ? 's' : ''}`);
  return { tokens, modeTokens, masters, fonts, summary: parts.join(', '), empty: !nTok && !fonts.length && !Object.keys(masters).length };
}
