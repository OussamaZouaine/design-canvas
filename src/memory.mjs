// Per-project design memory: durable style RULES (one line each) and short dated DECISIONS. Pure helpers (no store,
// no I/O) so they are unit-tested in test/memory.test.mjs; ProjectStore keeps the list in memory.json.
//
// Why: the brief (meta.brief) is written once per design and agents forget everything between sessions. A rule like
// "one accent colour, oklch hue 150" or a decision like "cards have no borders, shadow only" has to survive, and has
// to be cheap to load: start() appends a capped block, so agents get it without a new call.

export const MAX_RULES = 30;
export const MAX_DECISIONS = 60; // older decisions are dropped; rules are never dropped silently
export const RULE_CHARS = 200;
export const DECISION_CHARS = 300;
export const SHOWN_RULES = 12; // in the block delivered by start
export const SHOWN_DECISIONS = 5;
export const SHOWN_CHARS = 160; // one decision, as delivered
export const BLOCK_CHARS = 1800; // hard cap on the whole block

const oneLine = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

// Build a clean entry from untrusted input (MCP args or an HTTP body); throws a readable error for the caller.
// `agent` is a free label ("user" for the UI); `targetId` anchors a decision to a board/node and must look like our ids.
export function makeEntry(input, id, now = Date.now()) {
  const kind = input.kind === 'rule' ? 'rule' : input.kind === 'decision' ? 'decision' : null;
  if (!kind) throw new Error('kind must be "rule" or "decision"');
  const text = oneLine(input.text, kind === 'rule' ? RULE_CHARS : DECISION_CHARS);
  if (!text) throw new Error('text is required');
  const e = { id, kind, text, at: now };
  const agent = oneLine(input.agent, 40);
  if (agent) e.agent = agent;
  // Ids are short slugs (A1, n_3f...); anything else is dropped rather than stored, so a bad anchor never breaks a save.
  const target = String(input.targetId ?? '');
  if (kind === 'decision' && /^[\w-]{1,40}$/.test(target)) e.targetId = target;
  return e;
}

// Append an entry and enforce the caps. Returns the new list (the caller replaces its array contents).
// A rule beyond MAX_RULES is refused: the user should prune, silently dropping a standing rule would be worse.
// An exact duplicate (same kind and text, ignoring case) is not stored twice.
export function addEntry(list, entry) {
  const dup = list.find((x) => x.kind === entry.kind && x.text.toLowerCase() === entry.text.toLowerCase());
  if (dup) return list;
  if (entry.kind === 'rule' && list.filter((x) => x.kind === 'rule').length >= MAX_RULES) {
    throw new Error(`At most ${MAX_RULES} rules. Remove one first (memory action remove).`);
  }
  const out = [...list, entry];
  const decisions = out.filter((x) => x.kind === 'decision');
  if (decisions.length <= MAX_DECISIONS) return out;
  const drop = new Set(decisions.slice(0, decisions.length - MAX_DECISIONS).map((x) => x.id));
  return out.filter((x) => !drop.has(x.id));
}

// The block start() appends, or null when there is nothing to say. Rules first (they bind), then the newest decisions.
export function formatMemory(list) {
  const rules = list.filter((x) => x.kind === 'rule').slice(-SHOWN_RULES);
  const decisions = list.filter((x) => x.kind === 'decision').slice(-SHOWN_DECISIONS).reverse();
  if (!rules.length && !decisions.length) return null;
  const parts = [];
  if (rules.length) parts.push('RULES (follow these):\n' + rules.map((r) => `- ${r.text}`).join('\n'));
  if (decisions.length) {
    const day = (t) => new Date(t).toISOString().slice(0, 10);
    parts.push('RECENT DECISIONS (newest first):\n' + decisions.map((d) => `- ${day(d.at)}${d.targetId ? ` ${d.targetId}` : ''}: ${oneLine(d.text, SHOWN_CHARS)}`).join('\n'));
  }
  const all = list.length - rules.length - decisions.length;
  const s = parts.join('\n') + (all > 0 ? `\n(+${all} older: memory action list)` : '');
  return s.length > BLOCK_CHARS ? s.slice(0, BLOCK_CHARS - 1) + '…' : s;
}
