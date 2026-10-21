// Design tokens stored with a project. A token is a CSS custom property: name `color-primary`
// becomes `--color-primary`, and designs reference it as `var(--color-primary)`. Editing the value
// restyles every artboard that uses it, which is the point of having tokens at all.
//
// Shape (saved inside the document):
//   theme: { tokens: { 'color-bg': 'oklch(...)', 'space-4': '16px' }, modes: { dark: { 'color-bg': '...' } } }
// A mode only lists the tokens it overrides; the rest fall back to the base tokens.

// Token families the plan calls for (colour, radius, spacing, container, breakpoint, font family,
// weight, size, line height, letter spacing) plus shadow. The prefix before the first dash is the family.
export const FAMILIES = ['color', 'radius', 'space', 'container', 'breakpoint', 'font', 'weight', 'size', 'leading', 'tracking', 'shadow'];

const NAME_RE = /^[a-z][a-z0-9-]{0,40}$/;

// Values end up inside a <style> element in the user's browser, so refuse anything that could
// close the rule, open a new one, or load something from outside.
const BAD_VALUE = /[;{}<>\\]|url\s*\(|@import|expression\s*\(/i;

export function checkToken(name, value) {
  if (!NAME_RE.test(name)) throw new Error(`Token name "${name}" must be lowercase letters, digits and dashes, starting with a letter (e.g. color-primary)`);
  if (!FAMILIES.includes(name.split('-')[0])) throw new Error(`Token "${name}": start the name with one of ${FAMILIES.join(', ')}`);
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || BAD_VALUE.test(value)) throw new Error(`Token "${name}" has an invalid value`);
}

export const emptyTheme = () => ({ tokens: {}, modes: {} });

// Merge a partial update into a theme (in place). `null` removes a token. With a mode the values
// go into that mode's overrides instead of the base tokens.
export function applyTokens(theme, partial, mode) {
  const target = mode ? (theme.modes[mode] ??= {}) : theme.tokens;
  if (mode && !/^[a-z][a-z0-9-]{0,20}$/.test(mode)) throw new Error('Mode names are lowercase letters, digits and dashes');
  for (const [name, value] of Object.entries(partial)) {
    if (value === null) { delete target[name]; continue; }
    checkToken(name, value);
    target[name] = value.trim();
  }
  if (mode && !Object.keys(target).length) delete theme.modes[mode];
  return theme;
}

// The effective tokens for a mode: base values with that mode's overrides on top.
export const resolveTokens = (theme, mode) => ({ ...(theme?.tokens ?? {}), ...((mode && theme?.modes?.[mode]) || {}) });

// "--a: b; --c: d" ready to drop in a style attribute or rule.
export const toCssDeclarations = (tokens) => Object.entries(tokens).map(([k, v]) => `--${k}: ${v}`).join('; ');

// `name: value` lines grouped by family, the compact form Claude reads (get_design_system).
export function describe(theme, section) {
  const lines = [];
  const base = theme?.tokens ?? {};
  for (const [name, value] of Object.entries(base).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
    if (!section || name.split('-')[0] === section) lines.push(`${name}: ${value}`);
  }
  for (const [mode, tokens] of Object.entries(theme?.modes ?? {})) {
    for (const [name, value] of Object.entries(tokens)) {
      if (!section || name.split('-')[0] === section) lines.push(`${name} [${mode}]: ${value}`);
    }
  }
  return lines.join('\n');
}

// A small, opinionated scale to start from (the plan's "foundations"): semantic colour roles,
// a 4px spacing scale, 3 radii, a type scale. All colours are OKLCH like the rest of the app.
export const STARTER = {
  tokens: {
    'color-bg': 'oklch(0.99 0.003 90)', 'color-surface': 'oklch(1 0 0)', 'color-fg': 'oklch(0.22 0.01 270)',
    'color-muted': 'oklch(0.5 0.01 270)', 'color-border': 'oklch(0.9 0.005 270)',
    'color-primary': 'oklch(0.55 0.2 275)', 'color-on-primary': 'oklch(1 0 0)', 'color-danger': 'oklch(0.52 0.19 25)',
    // A system stack: naming a font that is not loaded (use_font) would silently fall back. Swap it after use_font.
    'font-sans': 'system-ui, -apple-system, "Segoe UI", sans-serif',
    'size-sm': '13px', 'size-base': '15px', 'size-lg': '18px', 'size-xl': '24px', 'size-2xl': '32px',
    'weight-regular': '400', 'weight-medium': '500', 'weight-bold': '600',
    'leading-tight': '1.25', 'leading-normal': '1.5',
    'space-1': '4px', 'space-2': '8px', 'space-3': '12px', 'space-4': '16px', 'space-6': '24px', 'space-8': '32px',
    'radius-sm': '6px', 'radius-md': '10px', 'radius-lg': '16px',
    'shadow-sm': '0 1px 2px oklch(0 0 0 / 0.08)',
  },
  modes: {
    dark: {
      'color-bg': 'oklch(0.18 0.01 270)', 'color-surface': 'oklch(0.23 0.01 270)', 'color-fg': 'oklch(0.96 0.005 270)',
      'color-muted': 'oklch(0.72 0.01 270)', 'color-border': 'oklch(0.32 0.01 270)',
      'color-primary': 'oklch(0.72 0.15 275)', 'color-on-primary': 'oklch(0.18 0.01 270)', 'color-danger': 'oklch(0.72 0.17 25)',
    },
  },
};
