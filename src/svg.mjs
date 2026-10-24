// SVG safety + attribute editing. Vectors live in the board HTML as plain inline <svg>, so they go through the
// same sanitizer as everything else; this file adds the SVG-specific rules the HTML sanitizer does not know.
import { HTMLElement } from 'node-html-parser';

// Elements that can run code, load another document, or rewrite hrefs over time. <style> is dropped because a
// stylesheet inside a shadow root could restyle the whole board (and the project convention is inline styles).
const DROP_TAGS = new Set(['script', 'foreignobject', 'style', 'set', 'iframe', 'object', 'embed', 'video', 'audio', 'canvas']);

// href-like attributes; a link that leaves the file is the way SVG pulls in outside content.
const HREF_ATTRS = new Set(['href', 'xlink:href', 'src']);

// Raster data URIs are fine (self-contained). image/svg+xml is excluded: a nested SVG document would skip these checks.
const SAFE_DATA_URI = /^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;

// Any url(...) must point at an in-document id (gradients, clip paths, filters). A remote url() is a tracking pixel at best.
function hasExternalUrl(value) {
  for (const m of value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    if (!m[2].trim().startsWith('#') && !SAFE_DATA_URI.test(m[2].trim())) return true;
  }
  return /@import|expression\s*\(|javascript:/i.test(value);
}

// Returns true when the attribute may stay on the element.
function attrAllowed(tag, name, value) {
  const n = name.toLowerCase();
  if (n.startsWith('on')) return false;
  if (HREF_ATTRS.has(n)) {
    const v = value.trim();
    if (v.startsWith('#')) return true;
    if (tag === 'image') return SAFE_DATA_URI.test(v);
    // Plain links on <a> may go to the web, but never to script or data documents.
    return tag === 'a' && /^https?:\/\//i.test(v);
  }
  return !hasExternalUrl(value);
}

// <animate>/<animateTransform> are harmless visually, but an animate that targets href could swap in a bad link later.
function animatesHref(el) {
  return /href/i.test(el.getAttribute('attributeName') || '');
}

// Sanitizes every <svg> subtree under `root` in place.
export function sanitizeSvg(root) {
  for (const svg of root.querySelectorAll('svg')) {
    const walk = (el) => {
      for (const child of [...el.childNodes]) {
        if (!(child instanceof HTMLElement)) continue;
        const tag = child.tagName.toLowerCase();
        if (DROP_TAGS.has(tag) || (tag.startsWith('animate') && animatesHref(child))) {
          child.remove();
          continue;
        }
        for (const [name, value] of Object.entries(child.attributes)) {
          if (!attrAllowed(tag, name, value)) child.removeAttribute(name);
        }
        walk(child);
      }
    };
    // The <svg> element itself can carry a style/href too, so check it before descending.
    for (const [name, value] of Object.entries(svg.attributes)) {
      if (!attrAllowed('svg', name, value)) svg.removeAttribute(name);
    }
    walk(svg);
  }
}

// Attributes set_attrs may touch: geometry and paint only. Anything else (ids, hrefs, handlers, data-*) stays out of reach.
export const SVG_ATTRS = new Set([
  'd', 'points', 'viewBox', 'preserveAspectRatio', 'width', 'height', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry',
  'x1', 'y1', 'x2', 'y2', 'transform', 'fill', 'fill-opacity', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width',
  'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'offset', 'stop-color', 'stop-opacity', 'gradientTransform', 'gradientUnits', 'vector-effect',
  'text-anchor', 'dominant-baseline', 'font-size', 'font-family', 'font-weight',
]);

// True when `el` is an <svg> or sits inside one.
export function isSvgNode(el) {
  for (let n = el; n instanceof HTMLElement; n = n.parentNode) if (n.tagName?.toLowerCase() === 'svg') return true;
  return false;
}

// Validates a set_attrs map and returns the cleaned entries ([name, string|null]); throws with a useful message.
export function checkAttrs(attrs) {
  const out = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (!SVG_ATTRS.has(k)) throw new Error(`set_attrs: "${k}" is not an editable SVG attribute (allowed: ${[...SVG_ATTRS].join(', ')})`);
    if (v === null || v === '') { out.push([k, null]); continue; }
    const s = String(v);
    if (hasExternalUrl(s)) throw new Error(`set_attrs: ${k} may only reference in-document ids like url(#grad)`);
    out.push([k, s]);
  }
  return out;
}

// Cap for imported files: a hand-made icon is a few KB, an exported illustration a few hundred.
export const MAX_SVG_BYTES = 1_000_000;

// Pulls the <svg>...</svg> element out of a file's text (drops XML prolog, doctype, comments, trailing junk).
export function extractSvg(text) {
  const m = /<svg[\s>][\s\S]*<\/svg>/i.exec(text);
  if (!m) throw new Error('import_svg: no <svg> element found');
  return m[0];
}
