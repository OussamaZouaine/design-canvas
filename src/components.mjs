// Components: a master (one HTML root per variant) that instances are copied from. Instances are
// stored *expanded* in the artboard HTML, marked with data-component / data-variant, so every
// other feature (outline, lint, screenshots, export) keeps working on plain HTML. Editing a master
// re-expands its instances in place, which is how "edit the button, every button updates" works.
//
// Text that differs per instance lives in slots: an element inside the master carrying
// data-slot="label" holds the default text, and an instance overrides it by name.
import { parse, HTMLElement } from 'node-html-parser';

const NAME_RE = /^[a-z][a-z0-9-]{0,30}$/;

export const checkName = (name, what = 'Component') => {
  if (!NAME_RE.test(name)) throw new Error(`${what} name "${name}" must be lowercase letters, digits and dashes, starting with a letter`);
};

const escapeText = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A master must be exactly one element (the instance root). The caller has already sanitized it.
export function checkMaster(html, name, variant) {
  const root = parse(html, { comment: false });
  const els = root.childNodes.filter((n) => n instanceof HTMLElement);
  const stray = root.childNodes.some((n) => !(n instanceof HTMLElement) && n.rawText.trim());
  if (els.length !== 1 || stray) throw new Error(`Variant "${variant}" of ${name} must be a single root element`);
  if (html.length > 20_000) throw new Error(`Variant "${variant}" of ${name} is too large (20 KB max)`);
}

// Slot names present in a master, with their default text: { label: 'Button' }.
export function slotsOf(html) {
  const out = {};
  for (const el of parse(html, { comment: false }).querySelectorAll('[data-slot]')) out[el.getAttribute('data-slot')] = el.text.trim();
  return out;
}

// Build one instance. `slots` maps slot name -> plain text (escaped here); `rawSlots` maps to
// already-escaped HTML (used when carrying an existing instance's text across a master update).
export function expand(masterHtml, name, variant, { slots = {}, rawSlots = {}, pid } = {}) {
  const root = parse(masterHtml, { comment: false });
  const el = root.childNodes.find((n) => n instanceof HTMLElement);
  el.setAttribute('data-component', name);
  el.setAttribute('data-variant', variant);
  if (!el.getAttribute('data-name')) el.setAttribute('data-name', name);
  if (pid) el.setAttribute('data-pid', pid);
  for (const slot of [el, ...el.querySelectorAll('[data-slot]')]) {
    const key = slot.getAttribute?.('data-slot');
    if (!key) continue;
    if (key in rawSlots) slot.set_content(rawSlots[key]);
    else if (key in slots) slot.set_content(escapeText(slots[key]));
  }
  return el.toString();
}

// What an existing instance currently shows in each slot (escaped HTML, ready for rawSlots).
export function readSlots(instanceEl) {
  const out = {};
  for (const s of instanceEl.querySelectorAll('[data-slot]')) out[s.getAttribute('data-slot')] = s.innerHTML;
  return out;
}

// The default variant is "default" when present, else the first one defined.
export const defaultVariant = (comp) => ('default' in comp.variants ? 'default' : Object.keys(comp.variants)[0]);

// ---- The generated "Components" sheet -----------------------------------------------------

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mono = 'font: 12px/16px ui-monospace, Consolas, monospace; color: var(--color-muted, #666)';

// One section per component, one cell per variant, each cell an expanded instance with a caption.
// Returns { html, height } like foundationsHtml; the caller gives the nodes ids.
export function componentsSheetHtml(components) {
  const names = Object.keys(components);
  let height = 48 * 2 + 36;
  const sections = names.map((name) => {
    const variants = Object.entries(components[name].variants);
    const slots = Object.keys(slotsOf(variants[0][1]));
    const rows = Math.ceil(variants.length / 3);
    height += 100 + rows * 120;
    const cells = variants.map(([vname, html]) =>
      `<div data-name="${esc(name)} ${esc(vname)}" style="display: flex; flex-direction: column; align-items: flex-start; gap: 12px; padding: 16px; border: 1px solid var(--color-border, #ddd); border-radius: 12px; background: var(--color-surface, #fff)">${expand(html, name, vname)}<span style="${mono}">${esc(vname)}</span></div>`).join('');
    return `<h3 data-name="${esc(name)} heading" style="margin: 40px 0 4px; font: 600 16px/22px var(--font-sans, system-ui, sans-serif); color: var(--color-fg, #111)">${esc(name)}</h3><div style="${mono}; margin-bottom: 16px">${slots.length ? `slots: ${esc(slots.join(', '))}` : 'no slots'}</div><div style="display: flex; flex-wrap: wrap; gap: 16px">${cells}</div>`;
  });
  const html = `<div data-name="Components" data-locked style="box-sizing: border-box; width: 1200px; padding: 48px; background: var(--color-bg, #fff); font-family: var(--font-sans, system-ui, sans-serif)"><h1 data-name="Title" style="margin: 0; font: 600 32px/1.2 var(--font-sans, system-ui, sans-serif); color: var(--color-fg, #111)">Components</h1>${sections.join('')}</div>`;
  return { html, height: Math.min(10000, Math.max(400, Math.round(height))) };
}
