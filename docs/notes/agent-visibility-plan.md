# Agent visibility + MCP work plan (analysis 2026-10-24)

Goal: see what Claude (or any MCP agent) does on the canvas, live and afterwards, and keep its work cheap in tokens and turns.
One phase per session, in order. Each phase ends with tests (`pnpm test`), a live check, and a line in `PROGRESS.md`.

## 1. How an agent touches the app today
- **Transport:** `POST /mcp` in `src/server.mjs` is *stateless*: every request builds a fresh `createMcpServer` + transport.
  So the server has no idea which client or session a call came from. `clientInfo` (sent once on `initialize`) is thrown away.
- **Tools:** `src/mcp.mjs`, 46 tools. Every tool goes through the wrapped `server.registerTool`, which only feeds the `Meter`.
- **What is recorded:** only *write* tools call `log()` -> `store.logAction` (Activity list, `activity.json`) + `doc.record('claude', ...)`
  (journal behind `get_changes`) + `highlight()` (SSE `agent` event with node ids, cleared after 10 s or `finish_working`).
  Reads (`get_tree`, `get_screenshot`, `lint`, `get_comments`, `find_nodes`...) leave no trace at all.
- **What the user sees:** the "Designing <board>" pill + comet ring (driven by doc changes in `engine.ts touchGen`), highlight
  boxes on touched nodes, Follow camera, the Activity tab (runs grouped by prompt, chips like "Updated styles x4"), the MCP tab
  (global per-tool token bars, polled every 3 s from `/api/status`).
- **Gaps:**
  1. No identity: every change is "claude". Two agents (or Claude Code subagents) are indistinguishable.
  2. No timeline: you cannot see *the sequence* of calls, their duration, errors, or which ones were reads.
  3. No "what is it doing right now" beyond writes; a 15 s screenshot round-trip looks like nothing happening.
  4. The meter is global since server start, not per project / per session / per request.
  5. Activity is coarse (merged by tool), has no per-action diff or undo, and the panel refetches the whole list on every action.
  6. The browser-side `agent` highlight has no name or colour, so multiple agents would blur together.

## 2. Token verdict
Good already. Branch `perf/mcp-tokens` did groups A, B, C (`docs/notes/mcp-token-optimization.md`): compact JSON, lean screenshots,
`start`, `batch`, auto-lint in write results, 64 -> 46 tools, tools/list 9.4k -> 8.4k. Turns are the real multiplier (~30k cache-read
per turn), then output HTML, then screenshots. What is still left:
- **Not verified:** the eval A/B for the branch was never run, and it is not merged.
- `project_id` sits on ~40 schemas (~1k tokens of tools/list) only because the server is stateless. Session binding (phase 2) removes it.
- Group D (output: push `insert_component`/`<x-clone>`) and E (`response_format`, code mode) are still ideas.
- **Rule for every phase below:** visibility must cost the model zero tokens. Everything is derived server-side from calls it already
  makes; never ask the agent to "report" what it does, never add result fields for the UI.

## 3. Phases

### Phase 0: Land the token branch (small, do first)
- Run `node examples/evals/run.mjs run tools-c` (and baseline if missing), `report turns-cut tools-c`. Compare turns, cache-read, output.
- Fix the open items from the live test: `components` schema says names are kebab-case; tool descriptions still say "needs a browser tab".
- Merge `perf/mcp-tokens` into `main` if the evals are no worse. Done = merged, numbers in the token notes.

### Phase 1: Server-side call log (foundation, no UI yet) — DONE 2026-10-24
Implemented as specified; ring is per project; `t` is strictly increasing so `since` is exact; `project` is `project_id` arg else the active project (calls with neither are not logged). `test/agentlog.test.mjs`; SSE + endpoint checked live.
- In the `registerTool` wrapper (`src/mcp.mjs`), record every call: `{ id, t, ms, tool, project, ok, error?, tokens, args }`.
  `args` is a *summary*: ids, action, sizes (`html: 27k chars`), never full HTML or prompt text beyond ~120 chars.
- New `src/agentlog.mjs`: in-memory ring (last ~500 calls) + per-project append to `data/projects/<id>/calls.jsonl` (debounced,
  capped like activity). Emit store event `call` -> SSE `call` to that project's tabs (plus `call-start` for slow tools, so a
  pending screenshot shows as "in progress").
- `GET /api/p/<id>/calls?since=<t>` for incremental reads. Keep `logAction`/Activity as is (it becomes a view later).
- Done = unit test for the summary (no HTML leaks), SSE event seen in the browser devtools.

### Phase 2: Agent identity and sessions — DONE 2026-10-24
Implemented in `src/sessions.mjs` + `/mcp` in `src/server.mjs`. Call-log entries now carry `agent: {id,name,color}`; journal actor and the SSE `agent` event (`{ids, agent}`) use the agent id. `project_id` left every schema except `project` (the register wrapper makes other schemas passthrough, so an explicit id still works). tools/list 33.7k -> 32.1k chars. Not verified: a real Claude Code restart re-initializing (the server answers 404 per spec; SDK clients do not auto-retry). Two clients on one project verified live over HTTP (`claude-code-<sid4>` vs `reviewer`). `test/sessions.test.mjs`.
- Make `/mcp` stateful: `sessionIdGenerator: randomUUID`, keep `Map<sessionId, {transport, server, agent}>`, idle TTL ~30 min,
  answer 404 for unknown ids (the spec makes the client re-initialize; check Claude Code does after a server restart).
- Identity per session = `clientInfo.name/version` from `initialize` + optional `agent` label: `start({agent:"reviewer"})` or
  `/mcp?agent=<name>` in the registration (useful because Claude Code subagents share one MCP connection). Give each agent a stable colour.
- **Per-session project binding:** `start` / `project open` binds the session's project; `project_id` stays optional but drops
  from most descriptions (token win, also stops two agents fighting over the global `store.activeId`).
- Thread the agent id through `log()`, `doc.record(agent, ...)`, the call log and the `agent` highlight event.
- Done = two Claude Code sessions on the same project show two distinct agents in `/api/p/<id>/calls`; tools/list size measured again.

### Phase 3: Live agent feed in the UI — DONE 2026-10-24
Built in `web/`: `store/agents.ts` (call feed from SSE `call`/`call-start` + seed from `/calls`, presence, read/write/review kinds), `panels/AgentsPanel.tsx` (Agents tab, filters, follow-agent select, `usePresence`), header chips + tinted pill + "Waiting for screenshot" pill in `shell/Shell.tsx`, engine boxes/ring tinted per agent with a name tag (`setAgentIds(ids, agent)`). McpPanel no longer polls (token bars come from the stored calls). Server: `call-start` now carries the agent. Presence comes from the call log, so the headless worker never shows. Follow-agent is approximate on the first write after a switch (doc delta arrives just before the `agent` event). **Finding:** after a server restart an SDK MCP client gets `404 Session not found` on every call and does NOT re-initialize (verified with the SDK client against a scratch server); Claude Code itself was not restarted-tested. Needs a fix before relying on sessions: serve unknown session ids statelessly (anonymous session) instead of 404.
- **Presence:** header chips for each agent active on this project (colour, name, current tool, idle after 2 min). Replace the
  3 s `/api/status` poll in `McpPanel` with the SSE `call` events.
- **Agents tab** (or rebuilt MCP tab): live timeline of calls, newest first: icon read/write/review, tool label, board name,
  duration, ~tokens, error in red. Click a row -> select + focus its nodes (`engine.focusBoard`). Filter by agent, writes only.
- **Canvas:** highlight boxes and the live pill tinted per agent with a small name tag (like multiplayer cursors). "Waiting for
  screenshot..." state while a browser round-trip is pending. Follow camera picks which agent to follow.
- Motion rules from CLAUDE.md apply (no animation on frequent updates; reduced-motion variant). Render agent names with text, not HTML.
- Done = verified in the browser with a real Claude Code run, light + dark.

### Phase 4: Activity history you can act on
- Activity runs grouped by prompt *and* agent, expandable to the individual calls (from the call log).
- Per-write diff: store the journal's before/after node HTML (or snapshot ids) so a row shows what changed, and "revert this step"
  works through `Doc` undo for the latest steps or a snapshot restore for older ones.
- Incremental loading (`since`) instead of refetching all runs on each `activity` tick.
- Done = revert one step of a multi-step run without losing the others (test in `test/`).

### Phase 5: Cost and efficiency dashboard
- Per session / per prompt: turns (calls between prompts), tool-result tokens, screenshot count + pixels, errors, retries,
  slowest calls. Flag patterns that waste turns: same read twice in a row, `get_screenshot` after every write, lint then write loops.
- Show the fixed costs too: tools/list size, `get_guide` size. Export the numbers so `examples/evals` can read them.
- Done = dashboard matches an eval run's meter numbers within ~10%.

### Phase 6: Several agents on one project
- Soft claims: an agent writing to a board claims it for ~60 s; another agent's write gets a one-line note (`board X is being
  edited by <agent>`), not an error. Shown on the canvas as a coloured board outline.
- `get_changes` / `start` report other agents' changes since this agent's last read (journal already has the author).
- Optional: user "pause agent" button that makes that session's writes return a polite error until resumed.
- Done = two agents editing different boards at once without overwrites; same board gets the note.

## 4. Gotchas to keep in mind
- Stateful sessions die on server restart; make sure re-init works before relying on bound projects (fallback: active project).
- Claude Code subagents reuse the parent's MCP connection, so session id alone cannot tell them apart; the `agent` label can.
- Never log full HTML, image data or long prompts into `calls.jsonl` (size + privacy); everything in the UI is untrusted text.
- The headless render worker is also an SSE client: it must not count as a "viewer" for presence.
