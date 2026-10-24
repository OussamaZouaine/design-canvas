// Cost + efficiency numbers for the dashboard and the evals, derived ONLY from the call log
// (src/agentlog.mjs), i.e. from calls the agent already makes: the model pays zero extra tokens for this.
// Pure functions, no I/O, so the heuristics are unit-tested without a server.
//
// Vocabulary: a "session" here is one agent (call-log entries carry `agent`); its calls are split into
// "prompts" at each `start` / `log_prompt` call that carries a prompt, which is how a user request enters the log.

// Same effect classes as web/src/store/agents.ts (kept in sync by hand: the UI needs them for icons, the server
// for the heuristics). Anything unlisted is a read.
const WRITE = new Set([
  'write_html', 'update_styles', 'set_attrs', 'import_svg', 'set_text_content', 'create_artboard', 'delete_nodes', 'duplicate_nodes', 'move_node',
  'rename_nodes', 'set_flags', 'insert_component', 'batch', 'set_tokens', 'use_font', 'create_foundations', 'fit_artboard',
  'create_project', 'reply_comment', 'resolve_comment', 'start', 'log_prompt', 'capture_url',
]);
const REVIEW = new Set(['get_screenshot', 'lint', 'check_layout', 'compare_to_reference', 'finish_working']);
const ACTION_TOOLS = new Set(['pages', 'components', 'references', 'project', 'tokens', 'history', 'export_code']);
const READ_ACTION = /^(list|get|show|info|read|find|preview|export|check)/;

export function kindOf(tool, args = {}) {
  if (REVIEW.has(tool)) return 'review';
  if (WRITE.has(tool)) return 'write';
  if (ACTION_TOOLS.has(tool)) return typeof args.action === 'string' && !READ_ACTION.test(args.action) ? 'write' : 'read';
  return 'read';
}

// Calls whose start is within this many ms of the previous call's end belong to the same model turn: a model
// emitting several tool_use blocks at once runs them back to back, while the next turn only starts after the model
// has read the results and generated again (seconds). Stays an estimate: the server never sees the model's turns.
export const TURN_GAP_MS = 150;
// Image tokens ~ width*height/750 (src/meter.mjs), so a screenshot's pixels can be recovered from its token count.
const PIXELS_PER_TOKEN = 750;
const SLOWEST = 3;

const sig = (c) => `${c.tool}:${JSON.stringify(c.args ?? {})}`;
const isPrompt = (c) => (c.tool === 'start' || c.tool === 'log_prompt') && typeof c.args?.prompt === 'string' && c.args.prompt.trim() !== '';
const startOf = (c) => c.t - (c.ms ?? 0);

// Group time-ordered calls into model turns (see TURN_GAP_MS). Returns the number of turns and tags each call.
export function countTurns(calls) {
  let turns = 0;
  let end = -Infinity;
  for (const c of calls) {
    if (startOf(c) > end + TURN_GAP_MS) turns++;
    end = Math.max(end, c.t);
  }
  return turns;
}

// --- heuristics -----------------------------------------------------------------------------------------------
// Each returns a hint { id, title, detail, count, callIds } or null. They only look at one agent's calls in order,
// and only flag a pattern once it repeats enough that it is plausibly waste, not a single sensible check.

// The same read-only call twice in a row: the second answer cannot differ (nothing wrote in between).
function repeatedReads(calls) {
  const ids = [];
  for (let i = 1; i < calls.length; i++) {
    const k = kindOf(calls[i].tool, calls[i].args);
    if (k !== 'write' && calls[i].ok && sig(calls[i]) === sig(calls[i - 1])) ids.push(calls[i].id);
  }
  return ids.length ? { id: 'repeat-read', title: 'Same read repeated back to back', detail: 'The result cannot have changed, so the repeat only costs a turn and its tokens.', count: ids.length, callIds: ids } : null;
}

// A screenshot after (almost) every write: each one costs a turn plus ~1-2k image tokens; the guide asks for one
// screenshot per design pass.
function screenshotPerWrite(calls) {
  let writes = 0, shot = 0, shots = 0;
  const ids = [];
  let pendingWrite = false;
  for (const c of calls) {
    const k = kindOf(c.tool, c.args);
    if (c.tool === 'get_screenshot') { shots++; if (pendingWrite) { shot++; pendingWrite = false; ids.push(c.id); } }
    else if (k === 'write' && c.tool !== 'start' && c.tool !== 'log_prompt') { writes++; pendingWrite = true; }
  }
  return writes >= 3 && shots >= 3 && shot / writes >= 0.75
    ? { id: 'screenshot-per-write', title: 'Screenshot after nearly every write', detail: `${shot} of ${writes} writes were followed by a screenshot. One screenshot per pass is enough; write results already report layout and lint.`, count: shot, callIds: ids }
    : null;
}

// lint -> write -> lint -> write...: write results already carry new lint issues, so a separate lint call between
// edits mostly repeats information the agent already has.
function lintWriteLoop(calls) {
  const ids = [];
  let lastLint = null;
  for (const c of calls) {
    if (c.tool === 'lint') lastLint = c;
    else if (kindOf(c.tool, c.args) === 'write' && c.tool !== 'start' && c.tool !== 'log_prompt') {
      if (lastLint) { ids.push(lastLint.id); lastLint = null; }
    }
  }
  return ids.length >= 3 ? { id: 'lint-write-loop', title: 'Lint then write, repeatedly', detail: 'write_html / update_styles already return new lint issues; call lint once at the end instead of between edits.', count: ids.length, callIds: ids } : null;
}

// Several turns in a row that each make one small edit: `batch` runs them in one call (one turn instead of N).
const SMALL_EDITS = new Set(['update_styles', 'set_attrs','set_text_content', 'rename_nodes', 'set_flags', 'move_node', 'delete_nodes']);
function unbatchedEdits(calls) {
  // Walk turns, collecting runs of single-call turns that are small edits.
  const turns = [];
  let end = -Infinity;
  for (const c of calls) {
    if (startOf(c) > end + TURN_GAP_MS) turns.push([c]); else turns.at(-1).push(c);
    end = Math.max(end, c.t);
  }
  let run = [], best = [];
  for (const t of turns) {
    if (t.length === 1 && SMALL_EDITS.has(t[0].tool)) { run.push(t[0]); if (run.length > best.length) best = run.slice(); } else run = [];
  }
  return best.length >= 4 ? { id: 'unbatched-edits', title: 'Many one-edit turns in a row', detail: `${best.length} consecutive turns each made a single small edit. Putting them in one batch call (or several tool calls in one message) saves a turn each.`, count: best.length, callIds: best.map((c) => c.id) } : null;
}

// A failed call repeated with the same arguments: either a retry that cannot succeed or an agent ignoring the error.
function retries(calls) {
  const ids = [];
  for (let i = 1; i < calls.length; i++) if (!calls[i - 1].ok && sig(calls[i]) === sig(calls[i - 1])) ids.push(calls[i].id);
  return ids.length ? { id: 'retry', title: 'Failed call retried unchanged', detail: 'Same tool and arguments right after an error.', count: ids.length, callIds: ids } : null;
}

export const HEURISTICS = [repeatedReads, screenshotPerWrite, lintWriteLoop, unbatchedEdits, retries];
export const hintsFor = (calls) => HEURISTICS.map((h) => h(calls)).filter(Boolean);

// --- aggregation ------------------------------------------------------------------------------------------------

// Numbers for one run of calls (a whole session or one prompt's worth).
export function summarize(calls) {
  const byTool = new Map();
  let tokens = 0, errors = 0, screenshots = 0, screenshotTokens = 0, ms = 0;
  for (const c of calls) {
    tokens += c.tokens ?? 0; ms += c.ms ?? 0;
    if (!c.ok) errors++;
    if (c.tool === 'get_screenshot' && c.ok) { screenshots++; screenshotTokens += c.tokens ?? 0; }
    const t = byTool.get(c.tool) ?? { tool: c.tool, calls: 0, tokens: 0, errors: 0 };
    t.calls++; t.tokens += c.tokens ?? 0; if (!c.ok) t.errors++;
    byTool.set(c.tool, t);
  }
  let retryCount = 0;
  for (let i = 1; i < calls.length; i++) if (!calls[i - 1].ok && sig(calls[i]) === sig(calls[i - 1])) retryCount++;
  const slowest = [...calls].sort((a, b) => b.ms - a.ms).slice(0, SLOWEST)
    .map((c) => ({ id: c.id, tool: c.tool, action: c.args?.action ?? null, ms: c.ms, tokens: c.tokens ?? 0, ok: c.ok }));
  return {
    calls: calls.length,
    turns: countTurns(calls),
    tokens, errors, retries: retryCount,
    screenshots, screenshotTokens, screenshotPixels: screenshotTokens * PIXELS_PER_TOKEN,
    ms,
    tools: [...byTool.values()].sort((a, b) => b.tokens - a.tokens),
    slowest,
    hints: hintsFor(calls),
  };
}

// Split one agent's time-ordered calls into prompts: a prompt call starts a new segment and belongs to it.
export function splitPrompts(calls) {
  const out = [];
  let cur = null;
  for (const c of calls) {
    if (isPrompt(c) || !cur) {
      cur = { prompt: isPrompt(c) ? c.args.prompt : null, t: c.t, calls: [] };
      out.push(cur);
    }
    cur.calls.push(c);
  }
  return out;
}

// The whole dashboard payload for one project. `calls` is the call-log ring (oldest first, newest last).
// `fixed` is passed in (the server measures tools/list and the guide once), so this stays pure.
export function analyze(calls, { fixed = null, limit = null } = {}) {
  const byAgent = new Map();
  for (const c of calls) {
    const key = c.agent?.id ?? '_unknown';
    if (!byAgent.has(key)) byAgent.set(key, { agent: c.agent ?? { id: key, name: 'unknown', color: '' }, calls: [] });
    byAgent.get(key).calls.push(c);
  }
  const sessions = [...byAgent.values()].map(({ agent, calls: list }) => ({
    agent,
    firstT: list[0].t, lastT: list.at(-1).t,
    ...summarize(list),
    prompts: splitPrompts(list).map((p) => ({ prompt: p.prompt, t: p.t, ...summarize(p.calls) })),
  })).sort((a, b) => b.lastT - a.lastT);
  const total = summarize(calls);
  return {
    // The ring holds only the newest entries; when it is full the numbers cover "the last N calls", not the project's lifetime.
    window: { calls: calls.length, truncated: limit != null && calls.length >= limit },
    total: { ...total, hintCount: sessions.reduce((n, s) => n + s.hints.length, 0) },
    fixed,
    sessions,
  };
}

// Compact numbers for the eval harness (GET /api/p/<id>/eval): same names as examples/evals/run.mjs results where
// they overlap, so the two can be compared directly.
export function evalSummary(calls) {
  const s = summarize(calls);
  return {
    loggedCalls: s.calls, loggedTurns: s.turns, loggedTokens: s.tokens, loggedScreenshots: s.screenshots,
    loggedScreenshotPixels: s.screenshotPixels, loggedErrors: s.errors, loggedRetries: s.retries,
    hints: s.hints.map((h) => h.id),
  };
}

// Fixed costs an agent pays regardless of the task. ~4 bytes per token like the rest of the meter.
export const textTokens = (s) => Math.ceil(Buffer.byteLength(s) / 4);
export function fixedCosts({ tools, instructions, guide }) {
  const toolsListTokens = textTokens(JSON.stringify(tools));
  const instructionsTokens = textTokens(instructions ?? '');
  const guideTokens = textTokens(guide ?? '');
  return { toolCount: tools.length, toolsListTokens, instructionsTokens, guideTokens, total: toolsListTokens + instructionsTokens + guideTokens };
}
