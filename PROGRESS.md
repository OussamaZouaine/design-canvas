# Progress log

Newest first inside each section. Update this file at the end of every work session (what changed, what is next).
Stable knowledge lives in `CLAUDE.md`; this file is the history and the to-do list.

## Current state (as of 2026-10-20)
- App works end to end: projects home, canvas, MCP tools, comments, history, tokens, generation animation, follow camera.
- Sprig design system project has 46 artboards (light + dark): foundations, components, 14 pages, 9 system sheets
  (buttons, forms, feedback, navigation, data display, states, icons, theme & tokens, data table density).
- Plan status: every phase of the build plan that fits the Node stack is done (see `docs/ROADMAP.md`). Tools, panels (Layers,
  Design, Theme, MCP), pages, components, references, token sync, normalization, lint, export are all in. 207 unit tests pass.
- Dev server is **stopped** (restart it to load `src/` changes); run `pnpm build:web` then `pnpm start`. No git remote configured, nothing pushed.
- Git history is on `main`, small commits per concern (`git log --oneline`).

## What was built, in order
1. Installed the REA tool (morluto/rea 6.7.0) and registered its MCP + skill for Claude Code (unrelated to the app code).
2. Design canvas from scratch: MCP server + infinite canvas, artboards as sanitized HTML in shadow DOM, live updates over SSE,
   screenshots by browser rasterization, atomic JSON persistence.
3. Sprig Home screenshot analysed; design system + pages generated from it (`examples/sprig`).
4. Projects: Claude names projects, home page with live previews, search/sort, trash, import/export, persisted in `data/`.
5. Features: design-token extraction (`get_design_tokens`, Tokens tab), prompt/activity history (`log_prompt`, Activity tab,
   auto-snapshots + Versions tab), element comments (pins, replies, resolve; MCP `get_comments`/`reply_comment`/`resolve_comment`).
6. Generation animation (comet ring, shimmer, staggered reveal) using the user's animate / make-interfaces-feel-better /
   find-animation-opportunities skills; OKLCH adopted for all colours.
7. More Sprig pages (Behavior, Events, Attributes, Study results, Settings, Upgrade).
8. Expanded design system (8 sheets) and a full dark mode; contrast audit found light status text below AA.
9. Data-table density sheet; live "Designing <artboard>" pill; performance pass (level of detail, delta sync, rAF coalescing).
10. Git initialised with a proper `.gitignore` (data/, node_modules/) and per-area commits.
11. Zoomed-out boards show cached bitmap snapshots (IndexedDB) instead of names; Follow Claude camera toggle.
12. Dark "Theme & tokens" sheet (was light-only) after a user comment.
13. AA-safe `successInk/warnInk/dangerInk/infoInk` tokens applied across the Sprig sheets and docs.
14. `/comments` page: all comments across projects with status tabs, filters, replies, resolve/reopen/delete,
    deep link `/p/<id>?comment=<id>`; open-comment badge on the home header.

## Home page redesign (2026-10-21)
Home is now Paper-style: left sidebar (`web/src/pages/home/HomeSidebar.tsx`: workspace row, search, Recents / Trash / Comments / Import,
connection pill + theme toggle in the footer) and a main area with a "Recents"/"Trash" heading, sort select, New project button and a
grid/list toggle (remembered in localStorage `dc-home-view`). `ProjectCard` shows title + "Edited N ago" above the preview; `CoverThumb`
takes `width`/`height`. `AppHeader` is still used by the Comments page. Not yet checked with real covers on a populated project.

## UI round 2026-10-21 (merged into main, verified in the browser)
- Home page restyled like Paper (`web/src/pages/home/HomeSidebar.tsx`, `ProjectCard.tsx`): sidebar, Recents grid, New project, grid/list toggle.
- Left sidebar has a collapsible Pages section with "+" (`web/src/panels/PagesPanel.tsx`): create, rename, switch.
- Design tab Font row is a picker (`web/src/ui/FontField.tsx`): real family name in its own face, project fonts + system fonts.
- Gotchas: locked nodes/boards (e.g. generated Foundations) disable the whole inspector (`pointer-events-none`), which looks like a broken picker.
  Base UI menus ignore synthetic JS click events; test them with a real click.
- Not checked: the list view of the home page, and "New page" on a project with many pages.

## UI upgrade (2026-10-24)
Graphite tinted tokens, translucent grouped toolbar, one-row icon tabs, grouped top bar, filled fields, inset list rows,
theme-switch transition suppression, and fixes for press/hover motion that never animated (v4 `scale`/`translate`). Details: `docs/notes/ui-system.md`.

## Known issues / caveats
- Rebuilding Sprig sheets recreates artboards with new ids, which orphans comments pinned to them.
- One blank screenshot of a freshly built artboard was seen after live delta updates; a reload fixed it and it did not
  reproduce. If it recurs, suspect the client refill of `html: null` in the `doc` SSE handler (`public/app.js`) and the
  per-client `sent` map in `sendDoc` (`src/server.mjs`).
- Zoomed-out snapshots are slightly soft on high-DPI screens below 30% zoom (`LIVE_K`, snapshot scale cap 0.5).
- `elementLabel` in `public/app.js` mounts an artboard to read an element's text; acceptable, could be avoided.
- `lint` on Sprig (grid 2) still reports ~50 light-theme items, mostly faded calendar days, the lilac logo tile and a few
  half-step paddings; `lineStrong` is decorative (1.4:1 light). Run `lint` with `grid: 2` per artboard to see them.
- New tools (`get_tree`, `lint`, `undo`, `get_changes`, `export_react`...) need a Claude Code restart to appear in a session started earlier.
- The MCP `create_artboard` x/y arguments need a Claude Code restart to appear in a session started before they were added.

15. Build-plan adoption (2026-10-19): `get_tree`, write modes + `<x-clone>`, locked nodes, `undo`, `get_changes`, `lint`,
    lean screenshots + `get_computed_styles`, `finish_working` highlight, token metering + `/api/status`, Origin check,
    `export_react`, Claude Code plugin + skill, unit tests. Details and what is left: `docs/ROADMAP.md`.

16. Plan leftovers closed (2026-10-19): opt-in HTML normalization per project (`meta.normalize`, on for new projects),
    lint spacing grid parameter (default 4, Sprig uses 2), and the Sprig contrast/size findings fixed at the source
    (`ink3` darkened, status text on `*Ink`, 12px minimum, disabled states marked) and rebuilt.

17. Theme (2026-10-19): per-project tokens with modes, MCP tab and Theme tab in the side panel, `create_foundations`,
    `lint` resolving `var()`.

18. Components (2026-10-19): `set_component` / `insert_component`, instances re-expanded when the master changes, generated
    Components sheet.

19. Layers (2026-10-19): Layers panel, `move_node`, `set_flags`, hidden/locked toggles, Esc selects parent.

20. Manual editing (2026-10-19): Design tab inspector, in-place text, undo/redo shortcuts and redo stack.

21. Token sync (2026-10-19): `link_repo`, `import_tokens`, `export_tokens`, node-scoped `get_design_tokens`.

22. Pages (2026-10-19): pages per project, page selector, per-page background, follow Claude across pages; overlay boxes
    now redraw when the camera glide ends. The page list moved from the header select to a "Pages" section at the top of the
    left sidebar (`PagesPanel.tsx`, add + inline rename); no new server logic, reuses `page-create` / `page-update`.

23. References (2026-10-19): reference images (tool, paste, drop), compare_to_reference with diff image; fixed a regression that
    broke all screenshots (hidden rule), threshold 6%.

24. Canvas editing (2026-10-19): resize handles, drag absolute nodes, node copy / paste. Normalization now covers inputs and spans.

## Next work, split into sessions (start a fresh session per area; each one reads CLAUDE.md + this file)
Order is a suggestion; the user decides.
0. **Generation quality (Phases A, B, C, D, F built 2026-10-21; F baseline runs still to do via `examples/evals/run.mjs`; Phase E fonts built 2026-10-21; turn-cutting change made, eval re-run `turns-cut` pending):** follow `docs/PAPER-QUALITY-PLAN.md`
   (stop frame clipping with fit-height boards + measured overflow report, taste guide served by the MCP, skill rewrite, evals).
   Decisions answered 2026-10-21 (section 5): auto-grow boards by default, soft brief reminder, system + Google Fonts
   (server fetches and caches woff2, embedded for screenshots, Phase E), merged house style. Recommended order: A (done), C (done), D (done), B (done), F, E (done); what is left is the F baseline runs. Restart Claude Code to see `use_font` / `list_fonts`, and restart the server for `src/` changes. (Phase A leftover fixed 2026-10-26: user edits regrow fit boards through a ResizeObserver, see item 12.)
1. **Use it for real** (no code): run Claude Code against the canvas on a real task (Trove), note what is slow, token-hungry or
   wrong, then turn that into issues here. The plan itself said to stop after Phase 3 and do this.
2. **React rewrite: APPROVED 2026-10-20, in progress.** Follow `docs/REACT-REWRITE.md` (phases 0-8, one session per phase;
   React 19 + React Compiler + Vite, Figma/Paper-like UI, canvas stays imperative, server unchanged). Do this before items 4-6. Phases 0-8 done (cut-over 2026-10-21: web/dist served at /, public/ deleted; Phase 7 leftovers rulers, Layers menu and profiler pass done 2026-10-21, see its log). Zoomed-out selection/hover via a rect index done 2026-10-21 (`web/src/canvas/rects.ts`, see the REACT-REWRITE log); follow-up: make context menu / comment mode use it too.
3. **Desktop app (later)**: the Go/Wails path from the plan only makes sense if the server is rewritten in Go. Otherwise wrap the
   Node server (Electron or Tauri, or Wails with a Node sidecar). Open question for the user: is the Go rewrite itself a goal?
4. **Roadmap leftovers** (`docs/ROADMAP.md`): insert toolbar (frame/text/image/component), canvas drag-reorder inside flex parents,
   image upload to `assets/`, per-side padding + colour picker, extra shortcuts, "commit version" button, 50+ board performance.
   `capture_url` is done (2026-10-22, `src/capture.mjs`; known gaps: table colspan/rowspan, web fonts, rgb colours, no oklch conversion).
5. **Verification debts**: real Ctrl+V of a copied layer (automation does not fire paste events; logic tested via a dispatched
   paste event); look at all 46 Sprig boards after the contrast/size fixes (only Studies was viewed); Sprig lint `grid: 2` leftovers.
6. **Ideas from the Paper desktop analysis (2026-10-22, `docs/PAPER-QUALITY-PLAN.md` 1.1b):** DONE 2026-10-22: headless render worker
   (`src/headless.mjs`, see CLAUDE.md "Browser round-trips"), `capture_url`, `find_nodes`, `get_jsx`, `export` (PNG) and
   `scripts/setup-mcp.mjs` + stdio shim (restart Claude Code to see the new tools). MCP tool descriptions still say "needs a browser tab":
   reword on the next schema change. Still open: PDF export; per-MCP-session project binding + agent identity/presence;
   make `askBrowser` handlers work in hidden tabs.
7. **MCP token/turn optimization (branch `perf/mcp-tokens`, A, B and C done 2026-10-24, not merged to main):** plan and numbers in
   `docs/notes/mcp-token-optimization.md`. Group C merged low-traffic tools into action-enum tools: `pages`, `components`, `references`, `project`,
   `tokens`, `history`, `export_code` (get_tree_summary dropped); 64 -> 46 tools, tools/list 9.41k -> 8.40k tokens. **Restart Claude Code to see the new tools.**
   Open: run the evals (`examples/evals`) A/B on the branch before merging; D and E ideas in the plan.
8. **Agent visibility: DONE (phases 0-6).** See an MCP agent's work live and in history, cheaply. Summary + open items in `docs/notes/agent-visibility-plan.md`.
   Phase 6 (several agents on one project): `src/claims.mjs` (soft board claims ~60 s, per project; user pause per agent id), notes appended in the `registerTool` wrapper (`mcp.mjs`, AsyncLocalStorage scratch), `others` in `get_changes`/`start` (marker `Session.seen`), SSE `claims`, `POST /api/agents/pause`, `GET /api/p/<id>/claims`; UI outline `engine.setClaims`, pause/resume in `AgentsPanel`. Tests `test/claims.test.mjs`.
9. **Vector support (SVG), 3 sessions:** session 1 DONE 2026-10-24: `src/svg.mjs` (SVG sanitizer called from `Doc._prepare`: drops style/script/foreignObject/
   animate-href, only in-document `url(#id)`/`#href`, `data:image` raster only), MCP tools `set_attrs` (Doc.setAttrs, allowlist of geometry/paint attributes) and
   `import_svg` (markup or a file inside the linked repo; goes through `writeWithNotes` so fit boards grow), `get_tree` names svg shapes by tag with d/fill/stroke,
   guide topic `svg`. Tests `test/svg.test.mjs`. **Restart Claude Code + the server to see the tools.** Session 2 DONE 2026-10-24: toolbar tools Rectangle (R), Ellipse (O), Line (L) (`engine.drawShape`, `CanvasEditor.addShape`, markup in `web/src/canvas/shapes.ts`); a shape is
   one absolutely positioned `<svg data-shape>` with paint on the svg root (the engine selects the root when an inner shape is clicked); Inspector `Vector` section (fill, stroke, width,
   cap, join, dash) sends the `attrs` canvas action (-> `Doc.setAttrs`); SVG elements are now selectable/draggable/in Layers (`isNodeEl` in `lib/htmlTree.ts`: they are not HTMLElements);
   normalize keeps `overflow:visible` on svg. Session 3 DONE 2026-10-24: Pen tool (P) + path edit mode.
   Click = corner anchor, click-drag = symmetric handles, click first anchor / Enter / double-click finishes (closed / open), Esc cancels, Backspace drops the last point; live
   rubber band in `.dc-pathsvg.pen`. Output is one `<svg data-shape="path">` with a single `<path>` (`shapes.pathHtml`). Double-click or Enter on a selected path = edit mode
   (anchors, handles, click a segment adds a point, Delete removes the selected anchor, double-click an anchor toggles corner/smooth, Alt = independent handle, Esc/Enter/click away exits).
   Drags patch `d` live and send ONE `vector` canvas action (`Doc.editVector`: d + viewBox + left/top/width/height, one undo step); `get_tree` shows `path:<id> d:...` on the svg line.
   Code: `web/src/canvas/pen.ts` (`PathTools`), pure maths `web/src/canvas/path.ts` + `test/path.test.mjs`. Verified on a scratch server with synthetic pointer events (draw open/closed,
   drag, undo/redo, insert, delete, smooth). Not covered: arcs / multi-subpath `d` (edit mode refuses with a toast), rotated svgs, snapping, shift-constrain.
   Later: boolean ops. Vectors stay plain inline `<svg>` in board HTML (no separate vector model).
10. **Ideas from the doop analysis (2026-10-25, `docs/DOOP-ANALYSIS.md`, AGPL: ideas only, no code), (a), (b), (c), (d) DONE 2026-10-26, rest not started:** (a) port the taste doctrine, mood-from-a-scene
    colour method and one-exemplar brief ritual into `src/guide.mjs` (DONE: brief topic got scene-derived palette, cliche list, hero device, one-exemplar rule, skip-if-styled; review topic got a hero checkpoint + end checklist); (b) DONE: `write_html` `stream: start|next|end` (src/heal.mjs `healHtml` closes/trims a cut-off run, each call rewrites the run from its healed prefix in one undo step; ids final at "end"; restart Claude Code for the schema); (c) DONE: new unresolved USER comments are appended once per MCP session as a `HUMAN FEEDBACK` block (max 3, 200 chars each; `src/feedback.mjs`, wired in the `registerTool` wrapper; again after a newer user reply or 20 min unresolved; never for the anonymous session) and optional `status` (80 chars) on `start` / `write_html` shows in the Agents tab, cleared by `finish_working`; restart Claude Code for the schema; (d) DONE: per-project design memory (`src/memory.mjs`, `memory.json`): one `memory` tool (add_rule / add_decision / list / remove), `start` returns rules + latest 5 decisions as `memory`, Memory section atop the Tokens tab, `/api/p/<id>/memory`; restart Claude Code for the new tool. TODO later: a model-based "distiller" that proposes rules from the activity/comments history, and auto-recording a decision when a comment thread is resolved (skipped: agent replies are not reliably decisions); (e) `search_icons` / `search_logos` /
    `search_images` tools; (f) optional CSS-pruned mode for `capture_url`. Suggested order a, b, c, d, e, f.
11. Other ideas: more Sprig pages, keep comment ids stable across rebuilds, tests for store / sanitizer / tokens extraction.
12. **Element manipulation (Figma/Paper-style): DONE, all 5 phases (selection model; drag reorder / reparent `Doc.moveNodes`; snapping / guides / nudge `snap.ts`; Design tab `panels/inspector/*`; group / ungroup / add auto layout `Doc.wrapNodes`, `structure.ts`, drag hints, shortcuts dialog, fit regrow) 2026-10-25/26:** `docs/notes/element-manipulation-plan.md`. Phases, one session each:
    1 selection model (multi-select, context scoping, marquee, keyboard nav), 2 drag reorder/reparent in flow (`moveNodes`), 3 snapping + smart guides + nudge + better resize,
    4 Design tab redesign (Fixed/Hug/Fill, 3x3 align grid, scrub fields, Mixed values, OKLCH picker), 5 group/ungroup + polish. Nothing left except the "not exercised" notes in the plan (real mouse drags, touch, cross-board drags).

## How to resume in a new session
0. Testing tip: run a scratch server with `PORT=3790 node src/server.mjs` (the user's own server may be on 3777), create a throwaway
   project through MCP/HTTP, open it in a browser tab, and delete + purge it afterwards. Never leave scratch projects in `data/`.
1. Read `CLAUDE.md` and this file. 2. `git log --oneline | head -20` and `git status`. 3. `pnpm start`, open
http://localhost:3777. 4. Ask the user what to do next if the request is not clear.
