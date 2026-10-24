# Progress log

Newest first inside each section. Update this file at the end of every work session (what changed, what is next).
Stable knowledge lives in `CLAUDE.md`; this file is the history and the to-do list.

## Current state (as of 2026-10-20)
- App works end to end: projects home, canvas, MCP tools, comments, history, tokens, generation animation, follow camera.
- Sprig design system project has 46 artboards (light + dark): foundations, components, 14 pages, 9 system sheets
  (buttons, forms, feedback, navigation, data display, states, icons, theme & tokens, data table density).
- Plan status: every phase of the build plan that fits the Node stack is done (see `docs/ROADMAP.md`). Tools, panels (Layers,
  Design, Theme, MCP), pages, components, references, token sync, normalization, lint, export are all in. 86 unit tests pass.
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
   (server fetches and caches woff2, embedded for screenshots, Phase E), merged house style. Recommended order: A (done), C (done), D (done), B (done), F, E (done); what is left is the F baseline runs. Restart Claude Code to see `use_font` / `list_fonts`, and restart the server for `src/` changes. Phase A leftover: user hand-edits do not auto-grow a fit board (add a ResizeObserver in the engine).
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
8. Other ideas: more Sprig pages, keep comment ids stable across rebuilds, tests for store / sanitizer / tokens extraction.

## How to resume in a new session
0. Testing tip: run a scratch server with `PORT=3790 node src/server.mjs` (the user's own server may be on 3777), create a throwaway
   project through MCP/HTTP, open it in a browser tab, and delete + purge it afterwards. Never leave scratch projects in `data/`.
1. Read `CLAUDE.md` and this file. 2. `git log --oneline | head -20` and `git status`. 3. `pnpm start`, open
http://localhost:3777. 4. Ask the user what to do next if the request is not clear.
