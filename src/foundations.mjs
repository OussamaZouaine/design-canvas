// Generates the "Foundations" artboard from a project's tokens: colour swatches, type specimens,
// spacing, radius and shadow samples. Everything visual references var(--token), so it reflects
// the live theme; the text labels are regenerated whenever the tokens change (see Doc.setTokens).
import { toCssDeclarations } from './theme.mjs';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const byFamily = (tokens, family) => Object.entries(tokens).filter(([k]) => k.split('-')[0] === family);
// Scales read best smallest to largest, and token names don't sort that way (size-2xl < size-sm),
// so order by the numeric part of the value.
const numeric = ([, a], [, b]) => parseFloat(a) - parseFloat(b);

// The generated boards' own chrome (page, cards, labels) uses the starter preset's role names. A theme that
// names its roles differently (ink/ground) may define only some of them, and mixing a themed dark surface with
// a fallback dark label made the labels invisible. So the themed roles are used only as a set, when the theme
// defines the text role; otherwise every role falls back to one fixed light palette that always contrasts.
const FALLBACK = { bg: 'oklch(1 0 0)', surface: 'oklch(1 0 0)', fg: 'oklch(0.2 0 0)', muted: 'oklch(0.45 0 0)', border: 'oklch(0.88 0 0)', primary: 'oklch(0.55 0.2 265)' };
export function chromeColours(tokens = {}) {
  const themed = 'color-fg' in tokens;
  return Object.fromEntries(Object.entries(FALLBACK).map(([role, v]) => [role, themed ? `var(--color-${role}, ${v})` : v]));
}

const WIDTH = 1200;
const PAD = 48;

const heading = (t, c) => `<h3 data-name="${esc(t)} heading" style="margin: 40px 0 16px; font: 600 13px/16px var(--font-sans, system-ui, sans-serif); letter-spacing: .08em; text-transform: uppercase; color: ${c.muted}">${esc(t)}</h3>`;

function colourBlock(tokens, c, scope = '') {
  const colours = byFamily(tokens, 'color');
  if (!colours.length) return { html: '', h: 0 };
  const rows = Math.ceil(colours.length / 4);
  const html = `<div ${scope} style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px">${colours.map(([name, value]) =>
    `<div data-name="${esc(name)}" style="border: 1px solid ${c.border}; border-radius: 12px; overflow: hidden; background: ${c.surface}"><div style="height: 64px; background: var(--${esc(name)})"></div><div style="padding: 10px 12px"><div style="font: 500 13px/18px var(--font-sans, system-ui, sans-serif); color: ${c.fg}">${esc(name)}</div><div style="font: 12px/16px ui-monospace, Consolas, monospace; color: ${c.muted}">${esc(value)}</div></div></div>`).join('')}</div>`;
  return { html, h: rows * 136 };
}

export function foundationsHtml(theme) {
  const { tokens, modes } = theme;
  const c = chromeColours(tokens);
  const parts = [];
  let height = PAD * 2 + 36;

  parts.push(`<h1 data-name="Title" style="margin: 0; font: 600 var(--size-2xl, 32px)/1.2 var(--font-sans, system-ui, sans-serif); color: ${c.fg}">Foundations</h1>`);

  const colours = colourBlock(tokens, c);
  if (colours.html) { parts.push(heading('Colour', c), colours.html); height += colours.h + 72; }

  // One extra swatch grid per mode, with that mode's values declared inline so it previews even
  // though the canvas is showing the base mode.
  for (const [mode, overrides] of Object.entries(modes)) {
    const merged = { ...tokens, ...overrides };
    const scope = `data-name="${esc(mode)} mode" `;
    // Inside a mode preview the merged mode tokens decide the chrome, as they do for the swatches.
    const block = colourBlock(merged, chromeColours(merged), `${scope}`);
    if (!block.html) continue;
    const decls = esc(toCssDeclarations(merged));
    parts.push(heading(`Colour · ${mode}`, c), `<div data-name="${esc(mode)} preview" style="${decls}; background: var(--color-bg); padding: 24px; border-radius: 16px; border: 1px solid ${c.border}">${block.html}</div>`);
    height += block.h + 72 + 48;
  }

  const sizes = byFamily(tokens, 'size').sort(numeric);
  if (sizes.length) {
    parts.push(heading('Type', c), `<div data-name="Type scale" style="display: flex; flex-direction: column; gap: 14px">${sizes.map(([name, value]) =>
      `<div style="display: flex; align-items: baseline; gap: 24px"><span style="width: 140px; flex: none; font: 12px/16px ui-monospace, Consolas, monospace; color: ${c.muted}">${esc(name)} · ${esc(value)}</span><span style="font: var(--weight-medium, 500) var(--${esc(name)})/1.3 var(--font-sans, system-ui, sans-serif); color: ${c.fg}">The quick brown fox jumps over the lazy dog</span></div>`).join('')}</div>`);
    height += sizes.length * 44 + 72;
  }

  const spaces = byFamily(tokens, 'space').sort(numeric);
  if (spaces.length) {
    parts.push(heading('Spacing', c), `<div data-name="Spacing scale" style="display: flex; flex-direction: column; gap: 10px">${spaces.map(([name, value]) =>
      `<div style="display: flex; align-items: center; gap: 24px"><span style="width: 140px; flex: none; font: 12px/16px ui-monospace, Consolas, monospace; color: ${c.muted}">${esc(name)} · ${esc(value)}</span><div style="height: 12px; width: var(--${esc(name)}); background: ${c.primary}; border-radius: 3px"></div></div>`).join('')}</div>`);
    height += spaces.length * 26 + 72;
  }

  const radii = byFamily(tokens, 'radius').sort(numeric);
  const shadows = byFamily(tokens, 'shadow');
  if (radii.length || shadows.length) {
    const sample = (name, value, style) => `<div style="display: flex; flex-direction: column; gap: 8px; align-items: flex-start"><div style="width: 96px; height: 64px; background: ${c.surface}; border: 1px solid ${c.border}; ${style}"></div><span style="font: 12px/16px ui-monospace, Consolas, monospace; color: ${c.muted}">${esc(name)} · ${esc(value)}</span></div>`;
    parts.push(heading('Radius and shadow', c), `<div data-name="Radius and shadow" style="display: flex; flex-wrap: wrap; gap: 32px">${radii.map(([n, v]) => sample(n, v, `border-radius: var(--${esc(n)})`)).join('')}${shadows.map(([n, v]) => sample(n, v, `border-radius: var(--radius-md, 10px); box-shadow: var(--${esc(n)})`)).join('')}</div>`);
    height += 96 + 72;
  }

  const html = `<div data-name="Foundations" data-locked style="box-sizing: border-box; width: ${WIDTH}px; padding: ${PAD}px; background: ${c.bg}; font-family: var(--font-sans, system-ui, sans-serif)">${parts.join('')}</div>`;
  return { html, height: Math.min(10000, Math.max(400, Math.round(height))) };
}
