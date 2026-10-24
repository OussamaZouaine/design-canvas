// Per-step diffs for the Activity panel: what one write changed, small enough to keep in activity.json,
// and exact enough to reverse that one step later without touching the steps around it.
//
// A "step" is one logged tool write. Doc takes an undo checkpoint right before it, so the checkpoint is the
// "before" state and the live document is the "after" state. We never store whole boards: only the span of
// HTML that differs (common prefix and suffix trimmed) plus a little context to find it again.

export const SNIPPET_CAP = 3000; // a changed span longer than this is shown clipped and cannot be patch-reverted
export const CONTEXT = 40; // chars of surrounding HTML kept so the span can be located in a later version
export const MAX_BOARDS = 3; // boards listed per step (a batch can touch more; the rest are counted)
export const DISPLAY_CAP = 500; // what the panel receives per side

const clip = (s, n) => (s.length > n ? s.slice(0, n) : s);

const DELIM = /[\s<>";]/;

// The differing middle of two strings, plus context. Trimming from both ends keeps a one-attribute change
// down to a few dozen characters even in a 100 kB board.
export function spanDiff(a, b) {
  const max = Math.min(a.length, b.length);
  let p = 0;
  while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let s = 0;
  while (s < max - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  // Widen the span to whole tokens (space, tag or attribute delimiters) so a changed colour reads as
  // "oklch(0.5 0.2 25)" instead of "5 0.2 2". The cut-off ends are identical in both strings, so the patch stays exact.
  while (p > 0 && !DELIM.test(a[p - 1])) p--;
  while (s > 0 && !DELIM.test(a[a.length - s])) s--;
  const before = a.slice(p, a.length - s);
  const after = b.slice(p, b.length - s);
  return {
    pre: a.slice(Math.max(0, p - CONTEXT), p),
    before, after,
    post: a.slice(a.length - s, a.length - s + CONTEXT),
  };
}

const rest = ({ html, ...r }) => JSON.stringify(r); // board settings other than the markup (name, size, page...)

// Compare the undo checkpoint (`prev`) with the live document data.
// Returns { boards: [...], more, other: [...] } or null when nothing changed.
export function diffStates(prev, data) {
  const boards = [];
  const other = new Set();
  const old = new Map(prev.artboards.map((a) => [a.id, a]));
  const now = new Map(data.artboards.map((a) => [a.id, a]));
  for (const [id, a] of now) {
    const o = old.get(id);
    if (!o) { boards.push({ id, name: a.name, kind: 'added', before: '', after: clip(a.html, SNIPPET_CAP), full: true }); continue; }
    if (rest(o) !== rest(a)) other.add('board settings');
    if (o.html === a.html) continue;
    const d = spanDiff(o.html, a.html);
    const full = d.before.length <= SNIPPET_CAP && d.after.length <= SNIPPET_CAP;
    boards.push({ id, name: a.name, kind: 'changed', ...d, before: clip(d.before, SNIPPET_CAP), after: clip(d.after, SNIPPET_CAP), full });
  }
  for (const [id, o] of old) {
    // A deleted board's markup is not kept (it can be huge); only undo can bring it back, and only while it is the latest step.
    if (!now.has(id)) boards.push({ id, name: o.name, kind: 'removed', before: clip(o.html, DISPLAY_CAP), after: '', full: false });
  }
  for (const k of ['theme', 'components', 'pages', 'references']) {
    if (JSON.stringify(prev[k] ?? null) !== JSON.stringify(data[k] ?? null)) other.add(k);
  }
  if (!boards.length && !other.size) return null;
  return { boards: boards.slice(0, MAX_BOARDS), more: Math.max(0, boards.length - MAX_BOARDS), other: [...other] };
}

// Can this stored diff be undone on its own (without Doc.undo)? Every touched board must have an exact, complete patch,
// and nothing outside the markup may have changed (theme, components... have no patch).
export function patchable(diff) {
  return Boolean(diff) && !diff.more && !diff.other.length && diff.boards.length > 0
    && diff.boards.every((b) => b.kind === 'added' || (b.kind === 'changed' && b.full));
}

const count = (hay, needle) => {
  let n = 0;
  for (let i = hay.indexOf(needle); i !== -1 && n < 2; i = hay.indexOf(needle, i + 1)) n++;
  return n;
};

// Reverse one board's change inside the CURRENT html, or return null when it can't be located exactly once
// (a later step edited the same spot). Strict match first (with context), then the changed text alone when it is long
// enough to be unambiguous by itself.
export function reversePatch(html, b) {
  const tries = [[b.pre + b.after + b.post, b.pre + b.before + b.post]];
  if (b.after.length >= 12) tries.push([b.after, b.before]);
  for (const [from, to] of tries) {
    if (from && count(html, from) === 1) return html.replace(from, () => to); // fn form: `$` in markup must stay literal
  }
  return null;
}

// What the panel gets: short clipped text, no context fields, never the stored full spans.
export function displayDiff(diff) {
  if (!diff) return undefined;
  return {
    boards: diff.boards.map((b) => ({ id: b.id, name: b.name, kind: b.kind, before: clip(b.before, DISPLAY_CAP), after: clip(b.after, DISPLAY_CAP), clipped: b.before.length > DISPLAY_CAP || b.after.length > DISPLAY_CAP || !b.full })),
    more: diff.more,
    other: diff.other,
  };
}
