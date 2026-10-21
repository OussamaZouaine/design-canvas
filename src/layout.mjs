// Layout reports: the browser measures real boxes (only a browser knows), the server turns the numbers into
// one readable line per board and, for `fit` boards, grows the board to its content.
//
// A report from the browser (see measureLayout in web/src/canvas/rects.ts):
//   { id, width, height, fit, contentWidth, contentHeight, outside: [{ id, name, right, bottom }], clipped: [{ id, name }] }

const MAX_LISTED = 6;

// True when the content does not fit the board as it is now.
export function overflows(r) {
  return r.contentHeight > r.height + 1 || r.contentWidth > r.width + 1 || r.outside.length > 0 || r.clipped.length > 0;
}

const label = (n) => (n.name ? `${n.id} "${n.name}"` : n.id);
const list = (nodes) => nodes.slice(0, MAX_LISTED).map(label).join(', ') + (nodes.length > MAX_LISTED ? `, +${nodes.length - MAX_LISTED} more` : '');

// One line per board with a problem; empty string when everything fits.
export function describeReport(r, name) {
  if (!overflows(r)) return '';
  const parts = [];
  if (r.contentHeight > r.height + 1) {
    parts.push(r.fit
      ? `content is ${Math.round(r.contentHeight)}px tall, board grew from ${Math.round(r.height)}px`
      : `content is ${Math.round(r.contentHeight)}px tall but the board is fixed at ${Math.round(r.height)}px and clips the rest. Fix: fit_artboard`);
  }
  if (r.contentWidth > r.width + 1) parts.push(`content is ${Math.round(r.contentWidth)}px wide, board is ${Math.round(r.width)}px`);
  if (r.outside.length) parts.push(`${r.outside.length} node(s) extend past the frame: ${list(r.outside)}`);
  if (r.clipped.length) parts.push(`${r.clipped.length} node(s) clip their own content (overflow hidden/scroll with more inside): ${list(r.clipped)}`);
  return `${r.id}${name ? ` "${name}"` : ''}: ${parts.join('; ')}`;
}

// Grow `fit` boards to their content (never shrinks here; fit_artboard is the explicit way to shrink).
// Returns the ids that changed.
export function applyGrowth(doc, reports) {
  const grown = [];
  for (const r of reports) {
    const ab = doc.getArtboard(r.id);
    if (ab?.heightMode === 'fit' && doc.growArtboard(r.id, r.contentHeight)) grown.push(r.id);
  }
  return grown;
}

// The text a tool returns. `fixedBy` lists boards that `applyGrowth` already fixed, so the agent is told
// what happened and not asked to fix it again.
export function formatReports(reports, doc, grown = []) {
  const lines = reports
    .map((r) => {
      // A fit board that was just grown no longer overflows in height; report only what is left.
      const left = grown.includes(r.id) ? { ...r, height: Math.max(r.height, r.contentHeight) } : r;
      return describeReport(left, doc.getArtboard(r.id)?.name);
    })
    .filter(Boolean);
  const grownNote = grown.length ? `grew to fit: ${grown.map((id) => `${id} (${doc.getArtboard(id).height}px)`).join(', ')}` : '';
  const all = [...lines, grownNote].filter(Boolean);
  return all.length ? all.join('\n') : 'ok: everything fits inside its frame';
}
