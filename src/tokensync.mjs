// Token sync with a codebase: import CSS custom properties from a stylesheet in the linked repo,
// and export the project's tokens back as CSS / Tailwind / JSON text.
//
// Importing maps each `--name: value` to a project token name. Names that already start with a
// known family (`color-primary`, `space-4`) are kept; others are classified from the name and the
// value (`--brand: oklch(...)` -> `color-brand`). Whatever cannot be classified is reported, never
// guessed, so nothing lands in the theme under a wrong name.
import fs from 'node:fs';
import path from 'node:path';
import { FAMILIES, checkToken } from './theme.mjs';

const MAX_BYTES = 200_000;
const COLOR_FN = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(.*\)|transparent|currentcolor)$/i;
const LENGTH = /^-?[\d.]+(px|rem|em|%|vw|vh|ch)$/i;

// Read a file that must live inside `repo`. Resolving both paths and comparing prefixes stops
// `../` tricks and absolute paths from reaching outside the linked folder.
export function readInsideRepo(repo, file) {
  if (!repo) throw new Error('No repo linked. Call link_repo with the path of your code folder first.');
  const root = path.resolve(repo);
  const full = path.resolve(root, file);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('That file is outside the linked repo');
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error(`File not found in the repo: ${file}`);
  if (fs.statSync(full).size > MAX_BYTES) throw new Error('That file is too large to import (200 KB max)');
  return fs.readFileSync(full, 'utf8');
}

// Pull `--name: value` pairs out of CSS. `selector` limits it to rules whose selector contains
// that text (e.g. ".dark" for dark-mode overrides); the default reads :root and html.
export function parseCustomProperties(css, selector = ':root') {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = {};
  for (const rule of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = rule[1].trim();
    const wanted = selector === ':root' ? /(^|,)\s*(:root|html)\s*(,|$)/.test(sel) : sel.includes(selector);
    if (!wanted) continue;
    for (const d of rule[2].matchAll(/--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);?/g)) out[d[1].toLowerCase().replace(/_/g, '-')] = d[2].trim();
  }
  return out;
}

// Decide the project token name for one imported property, or null if it cannot be classified.
export function classify(name, value) {
  if (FAMILIES.includes(name.split('-')[0])) return name;
  const v = value.trim();
  if (COLOR_FN.test(v)) return `color-${name}`;
  if (/(^|-)(radius|rounded)(-|$)/.test(name) && LENGTH.test(v)) return `radius-${name.replace(/(^|-)(radius|rounded)(-|$)/, '$3').replace(/^-|-$/g, '') || 'base'}`;
  if (/(^|-)(space|spacing|gap|padding|margin)(-|$)/.test(name) && LENGTH.test(v)) return `space-${name.replace(/(^|-)(space|spacing|gap|padding|margin)(-|$)/, '$3').replace(/^-|-$/g, '') || 'base'}`;
  if (/(^|-)(font-size|text|size)(-|$)/.test(name) && LENGTH.test(v)) return `size-${name.replace(/(^|-)(font-size|text|size)(-|$)/, '$3').replace(/^-|-$/g, '') || 'base'}`;
  if (/font/.test(name) && /[a-z]/i.test(v) && !LENGTH.test(v) && !/^\d/.test(v)) return `font-${name.replace(/^font-?/, '') || 'sans'}`;
  if (/shadow/.test(name)) return `shadow-${name.replace(/shadow-?/, '') || 'base'}`;
  return null;
}

// Map a whole property set to project tokens. Returns what to set and what was skipped (with why).
export function mapProperties(props) {
  const tokens = {};
  const skipped = [];
  for (const [name, value] of Object.entries(props)) {
    const token = classify(name, value);
    if (!token) { skipped.push(`--${name}: ${value}`); continue; }
    try { checkToken(token, value); } catch (e) { skipped.push(`--${name}: ${e.message}`); continue; }
    tokens[token] = value;
  }
  return { tokens, skipped };
}

// ---- Export ------------------------------------------------------------------------------

export function exportTokens(theme, format) {
  const base = theme?.tokens ?? {};
  const modes = theme?.modes ?? {};
  if (format === 'json') return JSON.stringify({ tokens: base, modes }, null, 2);
  if (format === 'css') {
    const blocks = [`:root {\n${Object.entries(base).map(([k, v]) => `  --${k}: ${v};`).join('\n')}\n}`];
    for (const [mode, t] of Object.entries(modes)) blocks.push(`[data-theme="${mode}"] {\n${Object.entries(t).map(([k, v]) => `  --${k}: ${v};`).join('\n')}\n}`);
    return blocks.join('\n\n') + '\n';
  }
  // Tailwind v4 style: an @theme block exposes the variables as utilities (bg-color-primary, p-space-4...).
  if (format === 'tailwind') {
    const lines = Object.entries(base).map(([k, v]) => `  --${k}: ${v};`).join('\n');
    return `@theme {\n${lines}\n}\n`;
  }
  throw new Error('format must be css, tailwind or json');
}
