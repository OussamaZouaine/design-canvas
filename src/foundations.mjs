// Generates the "Foundations" artboard from a project's tokens: colour swatches, type specimens,
// spacing, radius and shadow samples. Everything visual references var(--token), so it reflects
// the live theme; the text labels are regenerated whenever the tokens change (see Doc.setTokens).
import { toCssDeclarations } from './theme.mjs';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const byFamily = (tokens, family) => Object.entries(tokens).filter(([k]) => k.split('-')[0] === family);
// Scales read best smallest to largest, and token names don't sort that way (size-2xl < size-sm),
// so order by the numeric part of the value.
const numeric = ([, a], [, b]) => parseFloat(a) - parseFloat(b);

const WIDTH = 1200;
const PAD = 48;

const heading = (t) => `<h3 data-name="${esc(t)} heading" style="margin: 40px 0 16px; font: 600 13px/16px var(--font-sans, system-ui, sans-serif); letter-spacing: .08em; text-transform: uppercase; color: var(--color-muted, #666)">${esc(t)}</h3>`;

function colourBlock(tokens, scope = '') {
  const colours = byFamily(tokens, 'color');
  if (!colours.length) return { html: '', h: 0 };
  const rows = Math.ceil(colours.length / 4);
  const html = `<div ${scope} style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px">${colours.map(([name, value]) =>
    `<div data-name="${esc(name)}" style="border: 1px solid var(--color-border, #ddd); border-radius: 12px; overflow: hidden; background: var(--color-surface, #fff)"><div style="height: 64px; background: var(--${esc(name)})"></div><div style="padding: 10px 12px"><div style="font: 500 13px/18px var(--font-sans, system-ui, sans-serif); color: var(--color-fg, #111)">${esc(name)}</div><div style="font: 12px/16px ui-monospace, Consolas, monospace; color: var(--color-muted, #666)">${esc(value)}</div></div></div>`).join('')}</div>`;
  return { html, h: rows * 136 };
}

export function foundationsHtml(theme) {
  const { tokens, modes } = theme;
  const parts = [];
  let height = PAD * 2 + 36;

  parts.push(`<h1 data-name="Title" style="margin: 0; font: 600 var(--size-2xl, 32px)/1.2 var(--font-sans, system-ui, sans-serif); color: var(--color-fg, #111)">Foundations</h1>`);

  const colours = colourBlock(tokens);
  if (colours.html) { parts.push(heading('Colour'), colours.html); height += colours.h + 72; }

  // One extra swatch grid per mode, with that mode's values declared inline so it previews even
  // though the canvas is showing the base mode.
  for (const [mode, overrides] of Object.entries(modes)) {
    const merged = { ...tokens, ...overrides };
    const scope = `data-name="${esc(mode)} mode" `;
    const block = colourBlock(merged, `${scope}`);
    if (!block.html) continue;
    const decls = esc(toCssDeclarations(merged));
    parts.push(heading(`Colour · ${mode}`), `<div data-name="${esc(mode)} preview" style="${decls}; background: var(--color-bg); padding: 24px; border-radius: 16px; border: 1px solid var(--color-border, #ddd)">${block.html}</div>`);
    height += block.h + 72 + 48;
  }

  const sizes = byFamily(tokens, 'size').sort(numeric);
  if (sizes.length) {
    parts.push(heading('Type'), `<div data-name="Type scale" style="display: flex; flex-direction: column; gap: 14px">${sizes.map(([name, value]) =>
      `<div style="display: flex; align-items: baseline; gap: 24px"><span style="width: 140px; flex: none; font: 12px/16px ui-monospace, Consolas, monospace; color: var(--color-muted, #666)">${esc(name)} · ${esc(value)}</span><span style="font: var(--weight-medium, 500) var(--${esc(name)})/1.3 var(--font-sans, system-ui, sans-serif); color: var(--color-fg, #111)">The quick brown fox jumps over the lazy dog</span></div>`).join('')}</div>`);
    height += sizes.length * 44 + 72;
  }

  const spaces = byFamily(tokens, 'space').sort(numeric);
  if (spaces.length) {
    parts.push(heading('Spacing'), `<div data-name="Spacing scale" style="display: flex; flex-direction: column; gap: 10px">${spaces.map(([name, value]) =>
      `<div style="display: flex; align-items: center; gap: 24px"><span style="width: 140px; flex: none; font: 12px/16px ui-monospace, Consolas, monospace; color: var(--color-muted, #666)">${esc(name)} · ${esc(value)}</span><div style="height: 12px; width: var(--${esc(name)}); background: var(--color-primary, #55f); border-radius: 3px"></div></div>`).join('')}</div>`);
    height += spaces.length * 26 + 72;
  }

  const radii = byFamily(tokens, 'radius').sort(numeric);
  const shadows = byFamily(tokens, 'shadow');
  if (radii.length || shadows.length) {
    const sample = (name, value, style) => `<div style="display: flex; flex-direction: column; gap: 8px; align-items: flex-start"><div style="width: 96px; height: 64px; background: var(--color-surface, #fff); border: 1px solid var(--color-border, #ddd); ${style}"></div><span style="font: 12px/16px ui-monospace, Consolas, monospace; color: var(--color-muted, #666)">${esc(name)} · ${esc(value)}</span></div>`;
    parts.push(heading('Radius and shadow'), `<div data-name="Radius and shadow" style="display: flex; flex-wrap: wrap; gap: 32px">${radii.map(([n, v]) => sample(n, v, `border-radius: var(--${esc(n)})`)).join('')}${shadows.map(([n, v]) => sample(n, v, `border-radius: var(--radius-md, 10px); box-shadow: var(--${esc(n)})`)).join('')}</div>`);
    height += 96 + 72;
  }

  const html = `<div data-name="Foundations" data-locked style="box-sizing: border-box; width: ${WIDTH}px; padding: ${PAD}px; background: var(--color-bg, #fff); font-family: var(--font-sans, system-ui, sans-serif)">${parts.join('')}</div>`;
  return { html, height: Math.min(10000, Math.max(400, Math.round(height))) };
}
