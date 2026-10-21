# Plan: make Claude's designs on Design Canvas good and never clipped

Status: research done 2026-10-21. Phases A (stop clipping), C (taste guide), D (skill) and B (dialect report), F (evals, baseline runs pending) implemented 2026-10-21, see their sections; E not started. One phase per session.
Goal: (1) generations stay inside their frame, (2) generations have taste, (3) both hold for any agent, not only Claude Code.

## 1. Research: how Paper connects an agent to its canvas

Evidence: Paper's own MCP tool list and tool descriptions, the text returned by Paper's `get_guide` tool, the `[mcp-server]`
lines in `%APPDATA%\Paper\logs\main.log`, and an REA pass over the installed `app.asar` (v0.5.16).
REA limits: the asar's `paper.exe` failed ASAR integrity (expected for a signed binary, run with `record-and-continue`, bytes not
used). Plain-text search of `app.asar` and `paper.exe` found none of the guide strings, so the guide is probably compressed,
split, or served remotely. That is a bounded negative result, not proof. The guide text itself is what agents actually receive,
so it is the real artifact. We write our own text; we do not copy Paper's.

### 1.1 The architecture (observed)
- The MCP server lives inside the desktop app (main process). Log shows one session per client (`New session`, `DELETE received`,
  `Cleaning up session`, "N active"). So it talks straight to the live document the user is looking at, like our server does.
- Tools are file-scoped (`fileId`), and every result carries a file header with a token `contentHash`, so the agent notices when
  the user edited tokens mid-session.
- **No skill is involved.** Paper puts the "skill" inside the MCP: the server `instructions` say "you MUST call
  `get_guide("paper-mcp-instructions")` first", and the guide holds all the taste and process. It works for any MCP client.
  Other topics are loaded on demand: `mobile-status-bar`, `figma-import`, `image-generation`.

### 1.2 Why Paper's output stays inside the frame (the part that matters most)
1. **A constrained layout dialect.** write_html bans `margin`, `display:grid`, `display:inline`, tables; flex + padding + gap only;
   border-box everywhere. Predictable boxes mean predictable heights. Inert styles are dropped and reported (`ignoredStyles`).
2. **Artboards default to a flex column**, and the height is described as "a starting point". If content clips, the instruction is
   to switch the artboard to `height: fit-content` instead of guessing a pixel height. Never delete and restart for an overflow.
3. **A mandatory review loop.** After each section: screenshot, then a one-line verdict on six checkpoints (spacing, typography,
   contrast, alignment, **artboard fit**, repetition), fix, continue.
4. **Small writes.** One visual group per `write_html` call, so the user (and the agent) sees problems early.
5. **Fixed-width slots** (`width` + `flexShrink:0`) for icons and actions so columns align across rows.
6. **Paste-ready snippets** (the iOS status bar) instead of letting the model hand-draw fiddly things.
7. **Capability checks before styling:** `get_font_family_info` must be called before using a font, so no missing-font fallbacks.
8. **Structured tool feedback:** `move_nodes` returns `affectedParents`, `duplicate_nodes` returns `descendantIdMap`,
   `finish_working_on_nodes` is mandatory.

### 1.3 Where the "taste" comes from (observed in the guide)
- Brief before any mutation: mood candidates, one chosen mood (explicitly not the first instinct), palette with roles, type scale,
  one-sentence direction. The brief is posted in chat first.
- Colour is derived from a physical scene ("mineral" = limestone, slate, oxidized copper), not picked abstractly. A curated list of
  background x accent pairings that occur in real scenes, and a list of pairings to avoid (cliches).
- Neutrals rule: pure white is the normal ground; off-white only when the mood calls for it.
- Typography: Swiss-editorial contrast (heavy display + light labels), tight tracking on big type, open on tiny caps.
- Restraint: fewer elements, content on surfaces instead of cards, asymmetry and scale contrast, one intense colour moment.
- Register switch: clarity for product UI, impressiveness for portfolio/marketing, playful register for consumer brands.
- Realistic content only; contrast and min text size are "non-negotiable".

## 2. Why Design Canvas output gets cut off today (audited in this repo)

| # | Finding | Where |
|---|---------|-------|
| 1 | The frame clips: `.dc-frame { overflow: hidden }`, board has a fixed `height`. Anything taller or wider is silently cut. | `web/src/canvas/canvas.css:33`, `engine.ts:450` |
| 2 | The artboard root is not a flex column and the inner wrapper is `height:100%`, so children are not laid out like Paper's. | `engine.ts:504`, `raster.ts:85` |
| 3 | `create_artboard` has fixed 1440x900 (or whatever Claude guesses) and no "fit content" mode; nothing grows the board. | `src/mcp.mjs:204`, `doc.mjs:620` |
| 4 | `lint` is static and says so: "overflow/clipping still needs a screenshot". Only catches `width > artboard`. | `src/lint.mjs:3,153` |
| 5 | No tool tells the agent that content is clipped. The screenshot is the only check and the guide says "one get_screenshot". | `src/mcp.mjs` GUIDE |
| 6 | `write_html` allows margin, grid, tables, so heights and widths are harder to predict. Normalization is opt-in and does not remove them. | `src/normalize.mjs` |
| 7 | Guide and SKILL.md have workflow + hygiene rules but zero taste: no brief, no mood/palette method, no anti-patterns, no register. | `src/mcp.mjs` GUIDE, `skills/design-canvas/SKILL.md` |
| 8 | "Custom fonts are not loaded" but nothing tells the agent which fonts exist. | GUIDE tips |
| 9 | Server `instructions` are short (workflow only), so agents that skip `get_guide` skip all rules. | `src/mcp.mjs` |

## 3. Phases (each = one short session; commit per concern; run `pnpm test`)

### Phase A: Stop the clipping (highest value, do first) - DONE 2026-10-21
Built: `web/src/canvas/contract.ts` + `src/contract.mjs` (shared root wrapper, kept equal by `test/layout.test.mjs`); `heightMode: 'fit'`
on boards (`create_artboard` takes `height_mode`, default `fit`; a manual height resize turns it off); `measureLayout` in `rects.ts`
answers the new `measure` SSE request (server sends each board's html so it never races the doc sync); tools `check_layout`,
`fit_artboard`; `write_html` / `update_styles` add a `layout` line only when something does not fit; `finish_working` refuses while
touched boards are clipped (`ui.touched`). Deviations from the list below: `height_mode` param instead of `height:'fit'`; fit boards
only ever grow automatically (`fit_artboard` is the one call that shrinks); no live ResizeObserver, so a board the USER edits by hand
does not grow until the next MCP write or `check_layout`. Not covered yet: raster parity unit test (checked by eye in the browser).
Original list:
1. Artboard contract: root of every board is `display:flex; flex-direction:column; box-sizing:border-box`, in engine shadow root,
   `raster.ts`, `rects.ts` and `export_html` (one shared constant so they cannot drift).
2. Height modes: board has `heightMode: 'fixed' | 'fit'`. `create_artboard` gets `height: 'fit'` (min-height = given height, grows with content).
   New default = `fit` for mobile/desktop screens; fixed stays for posters/references. Engine measures content height (ResizeObserver) and
   the server stores the measured height so layout, screenshots and the next-board placement stay correct.
3. Measured overflow report: new browser round-trip `askBrowser('measure')` returning per board: content scroll size vs frame, plus the
   node ids whose box leaves the frame or whose `scrollWidth > clientWidth`. Surface it as `check_layout` tool and automatically in
   the `write_html` / `update_styles` result as one line ("2 nodes extend past the frame: N12, N31; board is fixed 900px, content 1184px.
   Fix: set height fit"). Falls back to "no browser open" note.
4. Auto-fix helper `fit_artboard` (or `update_styles` accepting `height:'fit-content'` on a board) so the cheap fix is one call.
5. `finish_working` gate: if measured overflow remains, return it instead of a plain ok.
6. Tests: overflow detection on fixtures (tall content, wide child, absolute child), fit growth, raster parity.

### Phase B: Layout dialect (predictable boxes) - DONE 2026-10-21 (reporting only)
Built: `src/dialect.mjs` (`dialectNote`, `dialectStylesNote`, `dialectKind`). `write_html` / `update_styles` add a `dialect` line
(counts of margin, grid, inline, table) only for projects with `meta.normalize`; nothing is rewritten. `lint` flags margin, tables,
inline boxes, a full-board absolute element, and non-shrinking fixed-width children wider than their flex row. `move_node` returns
`affectedParents`; `duplicate_nodes` returns `descendantIdMap` (`Doc.parentOf`, `duplicateNodes(ids, {withMap})`). Tests: `test/dialect.test.mjs`.
Not built: text with no wrap room, repeated rows without fixed icon slots, safe margin-to-padding rewriting.
Original list:
1. Extend normalization (always on for new projects): drop/convert `margin` to padding/gap hints, flag `display:grid`, tables, `inline`.
   Prefer reporting over silent rewriting at first (`ignoredStyles`-style list in the tool result), rewriting only the safe cases.
2. Lint additions: sibling fixed widths summing past parent width, text nodes with no wrap room, repeated rows without fixed icon slots,
   absolute element covering the whole board.
3. Return structured feedback like Paper: `affectedParents` on move_node, id maps on duplicate_nodes.

### Phase C: Taste guide served by the MCP (works for every agent) - DONE 2026-10-21
Built: `src/guide.mjs` (topics `start`, `brief`, `type`, `layout`, `review`, `mobile`; `get_guide({topic})`), server `instructions` gate,
`log_prompt.brief` stored in `meta.brief` + shown in the Activity tab ("Design brief"), soft `reminder` on `create_artboard` when no
brief is recorded, tests in `test/guide.test.mjs`. Not built: a separate snippet tool (the `mobile` topic carries the status bar /
device sizes as text instead). Needs a Claude Code restart to see the new `get_guide` / `log_prompt` schemas.
Original list:
1. New `get_guide` topics: `brief` (mood method, palette from scene objects, pairings and anti-pairings, neutrals), `type` (scale,
   contrast of weights, tracking), `layout` (flex dialect, fit height, slots), `review` (the checkpoint list), `mobile` (status bar snippet).
   All in OKLCH to match project rules. Original wording, adapted from the ideas above.
2. Server `instructions` become the gate: "call get_guide('start') before any other tool; post a brief before the first write".
3. Brief step is enforced softly: `create_artboard` in a project with no recorded brief returns a reminder; `log_prompt` accepts a
   `brief` field stored in project meta and shown in the Activity tab (this also gives later sessions the intent).
4. Snippet library tool/topic: iOS status bar, device sizes (390x844 phone, 768x1024 tablet, 1440x900 desktop), nav bars.

### Phase D: Skills (for Claude Code users) - DONE 2026-10-21
Built: `skills/design-canvas/SKILL.md` rewritten: step 0 loads `get_guide`, mandatory brief, per-group review with a one-line verdict
per checkpoint, fit-never-rebuild, and a short optional list of the user's other skills (the MCP guide stays self-sufficient).
Not built: the optional read-only `design-review` skill (do it with Phase F if wanted).
Original list:
1. Rewrite `skills/design-canvas/SKILL.md`: step 0 "load the taste guide", mandatory brief, review checkpoints with a one-line verdict
   per section, "fix with targeted edits, never rebuild a board for an overflow".
2. Point it at skills the user already has: `frontend-design` (aesthetic direction), `emil-design-eng` / `make-interfaces-feel-better`
   / `better-ui` (polish), `apple-design` (mobile feel), `break-ui` (worst-case content), `web-design-guidelines` (final audit).
   Keep the plugin self-sufficient: the MCP guide must work without them.
3. Optional second skill `design-review`: a read-only pass that screenshots every board, runs `lint` + `check_layout`, and writes a
   verdict list. Good for the Sprig project.

### Phase E: Fonts (system fonts + Google Fonts, decided 2026-10-21)
Why it is not just a `<link>`: the sanitizer strips `<link>`/`<style>`, boards live in shadow DOM, and screenshots / bitmap snapshots are
drawn through SVG foreignObject, which cannot load any external resource. So fonts must be fetched and embedded by us.
1. `use_font` tool (`family`, `weights`, `italic?`): the server (never the browser) fetches the CSS from `fonts.googleapis.com`
   (host allowlist: that host + `fonts.gstatic.com`; family name validated against a strict regex), downloads the woff2 files once into
   `data/fonts/<family>/<weight>.woff2` (gitignored), and records the family in project `meta.fonts`. Works offline after the first fetch.
2. Serve them from `/api/fonts/...` (same Host allowlist as the rest). The engine injects generated `@font-face` rules into every board's
   shadow root (next to the theme style) and calls `document.fonts.load` before taking snapshots.
3. Rasterizer: `raster.ts` embeds the used faces as base64 data URIs inside the SVG `<style>` (the only way foreignObject can use them), only
   for families the board actually references, to keep the snapshot cheap. Cache key of the IndexedDB snapshot must include the font set.
4. `list_fonts` tool: system stack list + project fonts + a short curated Google shortlist (so Claude does not guess names); `use_font`
   returns the exact `font-family` CSS value to paste. Missing / failed family returns an error instead of a silent fallback.
5. Guide rule: only system fonts or fonts returned by `use_font`/`list_fonts`. `lint` flags a `font-family` that is neither.
6. `export_react` / `export_html` list the Google families used (with the Google CSS URL for production).
Test: font-face generation, allowlist and regex rejection, raster embedding (unit), one real check that a screenshot shows the font.

### Phase F: Measure it (so we know it got better) - BUILT 2026-10-21, baseline runs not done yet
Built: `examples/evals/` (`briefs.json` with the 6 briefs, `run.mjs`), `src/evalmetrics.mjs`, read-only `GET /api/p/:id/eval`
(boards, lint totals, still-overflowing boards/nodes, whether a brief was recorded), tests in `test/evalmetrics.test.mjs`.
`node examples/evals/run.mjs run <label>` makes one project per brief, opens a tab on it (needed for measuring), runs `claude -p`,
diffs the server token meter, saves `examples/evals/results/<label>.json` (gitignored); `report <a> <b>` prints the comparison table.
Token follow-up (2026-10-21): the first run (`after-a-c-d-b`, $0.29-0.38 and 16-26 turns per brief) showed turns, not tool results, drive cost.
So `get_guide()` now returns the whole method in one call (was 3 calls), server `instructions` and the skill tell agents to batch independent
calls and skip `get_basic_info` / `get_tree` / `get_comments` in a new project, and `run.mjs` saves real CLI token usage. NOT re-run yet:
run `node examples/evals/run.mjs run turns-cut` and `report after-a-c-d-b turns-cut` to see the effect. Not done: schema trimming (~8.2k tokens/turn).
Not done: the actual before/after runs (needs the real server + a browser + paid Claude runs, user to start them), and no way to
check out the pre-Phase-A code automatically, so "before" is only possible by running on an old commit.
Original plan:
`examples/evals/`: 6 fixed briefs (landing page, dashboard, mobile onboarding, settings, pricing, empty state). Script runs each through
a fresh Claude Code session, then records: overflow count from `check_layout`, lint issues, number of screenshots/fix rounds, tokens (`/api/status`).
Compare before Phase A, after A, after C+D. Human taste check = screenshots side by side.

## 4. Order and cost
A (clipping) -> C (guide) -> D (skill) -> B (dialect) -> F (evals) -> E (fonts). A and C alone should remove most of what you see.
Rough size: A 1-2 sessions, B 1, C 1, D 0.5, E 0.5, F 1.

## 5. Decisions (answered by the user 2026-10-21)
1. New boards default to auto-grow height (`fit`). Fixed height only when asked or for device mockups that must be exactly 844px.
2. "Post a brief first" is a soft reminder (tools remind, never refuse).
3. Fonts: system fonts AND Google Fonts (see Phase E for the fetch-cache-embed design).
4. Taste rules: merge. Our own house style (OKLCH, project motion/colour rules) plus the useful ideas researched from Paper
   (mood-from-scene palettes, pairings to avoid, Swiss-editorial type, restraint), written in our own words.
