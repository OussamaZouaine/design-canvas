# MCP token and turn optimization (analysis 2026-10-24)

A1-A3 are done (marked below); the rest is not implemented yet. Numbers come from a measurement script run against a copy of `data/` (Sprig project, 46 boards)
and from `examples/evals/results/turns-cut.json`. Token counts are bytes/4 estimates.

## Where the cost actually is
Average eval run (`turns-cut`, 6 briefs): ~23 turns, ~640k cache-read, ~50k cache-write, ~12k output, but only ~3.3k tokens of tool results.
- **Turns are the multiplier.** Each turn re-reads the whole context (~30k). One turn saved is about 30k cache-read tokens. Any result
  token returned at turn 5 of 20 is also re-read about 15 more times.
- **Output (the HTML Claude writes) costs about as much as all the cache reads**, because output is priced about 5x input and
  cache reads about 0.1x.
- **turns minus toolCalls = 2 to 8 per run.** These are mostly ToolSearch round trips: Claude Code defers MCP tool schemas and loads them
  on demand, one search per turn.
- **The meter undercounts screenshots by about 10x.** `imageSize` in `src/meter.mjs` reads only PNG headers. JPEG (the default) falls back to
  bytes/750, but an image really costs about width*height/750 tokens. A 1000x2000 JPEG is about 2.7k tokens, not about 100. So screenshots are
  probably the largest tool-result cost, and the evals cannot see it.

## Measured sizes
| Item | Tokens | Note |
|---|---|---|
| tools/list, 62 tools | 9.6k | 3.1k descriptions, 5.0k schemas |
| `$schema` key on every inputSchema | 0.87k | 14 x 62, useless to the model |
| `project_id` prop on 59 tools | 1.36k | 23 each |
| `get_guide()` | 2.3k | mandatory first call, its own turn |
| `get_node_info` (top node) | 5.1k | always returns the full subtree HTML |
| `get_design_tokens` summary | 4.7k | |
| `get_tree` (no node_id, 46 boards) | 3.6k | |
| `get_basic_info` | 2.0k | 1.2k as compact JSON (pretty print = +39%) |
| `list_projects` (18 projects) | 1.0k | url + description per project |
| `export_react` (one board) | 5.8k | |

## Recommendations, highest value per effort first
### A. Quick wins (small, low risk)
1. **Done.** **Compact JSON**: `text()` in `src/mcp.mjs` uses `JSON.stringify(t, null, 2)`. Drop the indent: about 35-40% less on every JSON result.
   Done: `text()` and the `compare_to_reference` JSON are compact; the HTTP project export (`/api/projects/<id>/export`) stays pretty (a file for people).
2. **Done.** **Fix the meter for JPEG**: parse the SOF0/SOF2 marker for the size, so evals see the real screenshot cost.
   Done: `imageSize` walks the JPEG segment chain (decoding more base64 as needed, EXIF can be KBs) to SOF0/1/2; both formats use w*h/750. Older eval meter numbers undercount images.
3. **Done.** **Lean screenshot defaults**: max_width 800 (from 1000) and a height cap, with a note that the image was cropped and `node_id` shows the rest.
   Tokens scale with pixels, so 800 instead of 1000 is about 36% less.
   Done: browser default maxWidth 800 (`web/src/canvas/replies.ts`), new `max_height` (default 1600) cuts the crop at the bottom; the reply is still a plain
   data URL, so the server detects the cut from the image height (via `imageSize`) and adds a text note. Checked live with the headless worker (1200x3000 board -> 800x1600 + note).
4. **One ToolSearch for the core set**: add a line to `INSTRUCTIONS` that lists the ~10 core tools to load in one
   `select:` query (the Claude in Chrome server does exactly this). That cuts the 2-8 extra ToolSearch turns per run.
5. **First turn in parallel**: the instructions say "get_guide before any other tool", which forces a serial turn. Say instead
   "call get_guide and list_projects together in your first turn".
6. **Trim the heavy readers**: `get_node_info` leaves out `html` unless `include_html: true` (or caps it at about 2k chars).
   `get_tree` with no node_id and more than about 8 boards returns one line per board. `list_projects` drops `url`, drops `description`, limits to 15.
   `get_basic_info` leaves out empty `pages`/`references`.
7. **Strip `$schema`** from the tools/list output and shorten the `project_id` description to "Default: active project". That is about 1.5k off the
   schema, which is paid on every ToolSearch load.
8. **`reply_comment` takes `resolve: true`**: one call per comment instead of two.
9. **Fix the stale skill line**: `SKILL.md` "Hard rules" still says "system font stacks only (custom fonts are not loaded yet)", which
   contradicts `use_font`. Also shrink the skill to a pointer, because its workflow duplicates `get_guide` (~1.5k tokens loaded twice).

### B. Fewer turns (medium effort, the biggest lever)
1. **`create_artboard` accepts `html`**: create and first write in one call.
2. **Auto-lint in the write result**: `write_html` / `update_styles` already add a `layout` line only when something is wrong. Do the same with
   lint (only new issues, max 5 lines). The separate `lint` turn then goes away.
3. **`review` tool, or `get_screenshot({lint:true})`**: lint text + layout check + screenshot in one call, as one review step.
4. **`finish_working({screenshot:true})`**: the final look and finish in one turn.
5. **`batch` tool**: `batch({ops:[{tool, args}, ...]})` runs several edits (update_styles, set_text_content, rename...) in one call, with one result line
   per op. The handlers are already registered, so it can dispatch to them internally. Anthropic's guidance is to consolidate operations that are always chained.
6. **`start` shortcut**: `start({project_name|project_id, prompt, brief, artboard})` = list/create + log_prompt + create_artboard. Saves 2-3 turns
   on every new design.

### C. Fewer tools (medium effort; mostly cuts ToolSearch noise and the schemas loaded)
62 tools could become about 30 by merging into action enums: pages (5 tools to 1), components (5 to 2), undo/redo (2 to 1), exports (export_react,
export_html, get_jsx, export to 1 with `format`), references (3 to 1), tokens (get_design_tokens/get_design_system/export_tokens), and
`get_tree_summary` folded into `get_tree`. Keep the hot path (write_html, update_styles, get_tree, get_screenshot) as separate, well-described tools.
Trade-off: an action-enum tool has one shared description, so the edge-case wording gets thinner. Measure it with the evals.

### D. Less output (experiments; check against evals)
- Push `insert_component` and `<x-clone>` harder in the guide. They are the only real cut to output tokens.
- Style shorthands in write_html (for example `row gap:8 p:16`), expanded server-side. This would save a lot of output, but it is a new dialect the model
  must learn. Run it as an eval A/B experiment, not as a default.
- Note that `var(--space-4)` is longer than `16px`. Tokens cost output tokens, so the guide could suggest tokens for colours and raw px for spacing.

### E. Bigger ideas (later)
- **Code mode** (Anthropic "code execution with MCP", Cloudflare "Code Mode"): one `run_script` tool that runs JS against the Doc API, so
  loops ("restyle every card") happen in one call and only the summary comes back. Gotcha: Node `vm` is not a security sandbox,
  and captured pages can carry prompt injection. `batch` gets most of the benefit with no new attack surface.
- **Per-MCP-session project binding** (already in PROGRESS "Next work" 6): `project_id` could then leave most schemas.
- **`response_format: concise|detailed`** on the readers (get_tree, get_comments, get_design_tokens), as Anthropic's tool-writing guide suggests.

## How to verify
Run `node examples/evals/run.mjs run <label>` before and after each group (A, B, C), then `report turns-cut <label>`. Fix the meter (A2) first,
or the screenshot savings are invisible. Compare turns, cache-read and output, not only `toolTokens`.

## How this is being executed (orchestration rules from the user)
- One session per task (A1-A3, A4-A9, B1+B2, B3+B4, B5, B6, C), strictly one at a time, all on branch `perf/mcp-tokens`, no pushes.
- New sessions start on Sonnet 5.5 (`model: claude-sonnet-5-5`); session 1 (A1-A3) was started before this choice.
- Progress is recorded by each session as one-line "done" marks next to the items above.
