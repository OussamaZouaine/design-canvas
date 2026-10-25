// Human feedback on tool results + agent status. Pure helpers (no store, no I/O) so they are unit-tested in
// test/feedback.test.mjs; the registerTool wrapper in mcp.mjs wires them to a Session.
//
// Why: an agent only learned about new comments when it called start / get_comments. A user who types a note while
// the agent is mid-run was ignored until the next request. Appending a short block to the next tool result makes the
// feedback land inside the agent's own loop without a poll tool and without costing anything when there is none.

export const MAX_ITEMS = 3; // comments shown per block; the rest are counted, never listed
export const MAX_TEXT = 200; // chars of one comment
export const REMIND_MS = 20 * 60_000; // an unresolved comment is shown again after this long
export const STATUS_MAX = 80;

// Comment text is untrusted (the user's, but anything could be pasted in): one line, capped.
const oneLine = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

// A status is one present-tense line shown beside the agent's name. Clamp rather than reject so a long one still works.
export function clampStatus(s) {
  if (s == null) return null;
  const t = oneLine(s, STATUS_MAX);
  return t || null;
}

// Which comments should reach this session now. `delivered` is the session's Map(commentId -> time shown).
// Only the user's open comments count (the agent's own replies must not echo back). A comment returns when it is
// new, when the user replied on its thread after it was shown, or when it stayed unresolved for REMIND_MS.
export function pendingFeedback(comments, delivered, now = Date.now()) {
  return comments.filter((c) => {
    if (c.author !== 'user' || c.resolved) return false;
    const at = delivered.get(c.id);
    if (at == null) return true;
    if ((c.replies ?? []).some((r) => r.author === 'user' && r.createdAt > at)) return true;
    return now - at >= REMIND_MS;
  });
}

// The block appended to a result, or null when there is nothing. `anchor(c)` may add a human label for the target
// (e.g. the board name); it must return a short slug-like string or ''.
export function formatFeedback(list, anchor = () => '') {
  if (!list.length) return null;
  const lines = list.slice(0, MAX_ITEMS).map((c) => {
    const a = anchor(c);
    return `- ${c.id} on ${c.targetId}${a ? ` (${a})` : ''}: ${oneLine(c.text, MAX_TEXT)}`;
  });
  const more = list.length > MAX_ITEMS ? `\n+${list.length - MAX_ITEMS} more (get_comments)` : '';
  return `HUMAN FEEDBACK (${list.length} new comment${list.length > 1 ? 's' : ''}). Address before continuing, then reply_comment with resolve:true.\n${lines.join('\n')}${more}`;
}

// Record the shown comments (only the ones actually listed, so the overflow is delivered on a later call).
export function markDelivered(delivered, list, now = Date.now()) {
  for (const c of list.slice(0, MAX_ITEMS)) delivered.set(c.id, now);
}
