// Normalization pass applied to every HTML fragment written into a project that has it switched
// on (new projects do; older ones such as Sprig keep their markup untouched). It mirrors how Paper
// treats pasted HTML: only inline styles survive, and redundant declarations are stripped, so
// two ways of writing the same thing end up as the same stored markup.
import { parse, HTMLElement } from 'node-html-parser';
import { parseStyle, styleToString } from './css.mjs';

// Declarations that only mean something on a flex or grid container.
const FLEX_ONLY = ['flex-direction', 'flex-wrap', 'justify-content', 'align-content'];
const GRID_OR_FLEX = ['gap', 'row-gap', 'column-gap', 'align-items', 'justify-items'];

// Values equal to the CSS initial value of a property that is NOT inherited, so dropping them
// can never change what renders. (font-weight or color are inherited: a "default" there can be
// an override, so they are deliberately left alone.)
const DEFAULTS = { position: 'static', opacity: '1', float: 'none', 'z-index': 'auto', overflow: 'visible' };

// Properties whose result depends on box-sizing. Only elements that use one of them need it.
const BOX_PROPS = ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'padding', 'border'];
const hasBoxProp = (st) => [...st.keys()].some((k) => BOX_PROPS.some((p) => k === p || k.startsWith(p + '-')));

export function normalizeElement(el) {
  // Class names and selector CSS are not part of the stored design; inline styles are.
  el.removeAttribute('class');

  const st = parseStyle(el.getAttribute('style'));
  const display = st.get('display') || '';
  const isFlex = /flex/.test(display);
  const isGrid = /grid/.test(display);

  for (const p of FLEX_ONLY) if (!isFlex) st.delete(p);
  for (const p of GRID_OR_FLEX) if (!isFlex && !isGrid) st.delete(p);
  // overflow:visible is the CSS default except on a nested <svg> (the browser's own sheet clips it), where it is the
  // one thing that stops a stroke from being cut in half at the edge of the box, so it must stay.
  const isSvg = el.tagName?.toLowerCase() === 'svg';
  for (const [p, v] of Object.entries(DEFAULTS)) if (st.get(p) === v && !(isSvg && p === 'overflow')) st.delete(p);
  if (isFlex && st.get('flex-direction') === 'row') st.delete('flex-direction'); // row is the default
  if (isFlex && st.get('flex-wrap') === 'nowrap') st.delete('flex-wrap');

  // Make sizes mean the same thing everywhere: width includes padding and border.
  if (hasBoxProp(st) && !st.has('box-sizing')) st.set('box-sizing', 'border-box');

  if (st.size) el.setAttribute('style', styleToString(st));
  else el.removeAttribute('style');
}

const escapeText = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Form controls become plain frames with a text child (like Paper's paste): the design shows what the
// field looks like, and no live control (which could submit or take focus) ends up on the canvas.
function inputToFrame(input) {
  const type = (input.getAttribute('type') || 'text').toLowerCase();
  if (type === 'hidden') { input.remove(); return; }
  const frame = parse('<div></div>').firstChild;
  frame.setAttribute('data-name', input.getAttribute('data-name') || 'Input');
  const st = parseStyle(input.getAttribute('style'));
  if (!st.has('display')) { st.set('display', 'inline-flex'); if (!st.has('align-items')) st.set('align-items', 'center'); }
  frame.setAttribute('style', styleToString(st));
  // What the field shows: its value, else its placeholder; checkboxes and radios have no text.
  const text = ['checkbox', 'radio'].includes(type) ? '' : input.getAttribute('value') || input.getAttribute('placeholder') || '';
  frame.set_content(escapeText(text));
  input.replaceWith(frame);
}

// Remove <style> blocks (selector CSS) from a parsed fragment, then normalize every element.
export function normalizeTree(root) {
  root.querySelectorAll('style').forEach((n) => n.remove());
  root.querySelectorAll('input').forEach(inputToFrame);
  root.querySelectorAll('textarea').forEach((t) => {
    const frame = parse('<div></div>').firstChild;
    frame.setAttribute('data-name', t.getAttribute('data-name') || 'Textarea');
    if (t.getAttribute('style')) frame.setAttribute('style', t.getAttribute('style'));
    frame.set_content(escapeText(t.text || t.getAttribute('placeholder') || ''));
    t.replaceWith(frame);
  });
  // A <span> with no real attributes only wraps text: unwrap it so a text block is one text node. Spans that
  // carry a style or other attribute keep their formatting (that would be lost by flattening).
  for (const span of root.querySelectorAll('span').reverse()) {
    // (Normalization runs before ids are stamped, but an x-clone copy can still carry none either way.)
    if (Object.keys(span.attributes).every((a) => a === 'data-pid')) span.replaceWith(...span.childNodes);
  }
  const walk = (el) => {
    for (const child of el.childNodes) {
      if (!(child instanceof HTMLElement)) continue;
      normalizeElement(child);
      walk(child);
    }
  };
  walk(root);
}
