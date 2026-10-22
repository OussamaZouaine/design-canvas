// find_nodes: search a project's nodes by text, name, tag, component or style value.
// Returns short labels (id, tag, name, text) so an agent can pick edit targets without reading HTML.
import { HTMLElement } from 'node-html-parser';
import { parseStyle } from './css.mjs';

const MAX_LIMIT = 100;

// Filters combine with AND; `query` matches the node's data-name or its own text, case-insensitively.
// `style` is a substring of the inline style ("flex", "background" or "oklch(0.6" all work).
// `doc._artboardRoot` is the Doc's parser; going through it keeps one place that knows how HTML is stored.
export function findNodes(doc, { query, name, tag, component, style, artboard_id, page, limit = 30 } = {}) {
  if (![query, name, tag, component, style].some((v) => v)) throw new Error('Give at least one of: query, name, tag, component, style');
  const q = query?.toLowerCase();
  const n = name?.toLowerCase();
  const st = style?.toLowerCase();
  const t = tag?.toLowerCase();
  const max = Math.min(Math.max(limit, 1), MAX_LIMIT);
  const boards = doc.data.artboards.filter((a) => (!artboard_id || a.id === artboard_id) && (!page || doc.pageOf(a) === page));
  if (artboard_id && !boards.length) throw new Error(`Artboard ${artboard_id} not found`);
  const hits = [];
  let total = 0;
  for (const ab of boards) {
    for (const el of doc._artboardRoot(ab).querySelectorAll('[data-pid]')) {
      const elName = el.getAttribute('data-name') || '';
      // Own text only (direct text children), so a match names the node that really holds the words
      // instead of every ancestor up to the artboard.
      const own = el.childNodes.filter((c) => !(c instanceof HTMLElement)).map((c) => c.rawText).join(' ').replace(/\s+/g, ' ').trim();
      if (q && !`${elName} ${own}`.toLowerCase().includes(q)) continue;
      if (n && !elName.toLowerCase().includes(n)) continue;
      if (t && el.rawTagName.toLowerCase() !== t) continue;
      if (component && el.getAttribute('data-component') !== component) continue;
      if (st && !`${[...parseStyle(el.getAttribute('style'))].map(([k, v]) => `${k}: ${v}`).join('; ')}`.toLowerCase().includes(st)) continue;
      total++;
      if (hits.length < max) {
        hits.push({
          id: el.getAttribute('data-pid'),
          artboard: ab.id,
          tag: el.rawTagName.toLowerCase(),
          ...(elName && { name: elName }),
          ...(el.getAttribute('data-component') && { component: el.getAttribute('data-component') }),
          ...(own && { text: own.slice(0, 60) }),
        });
      }
    }
  }
  return { total, shown: hits.length, nodes: hits };
}
