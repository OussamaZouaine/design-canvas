# Progress log

Newest first inside each section. Update this file at the end of every work session (what changed, what is next).
Stable knowledge lives in `CLAUDE.md`; this file is the history and the to-do list.

## Current state (as of 2026-10-19)
- App works end to end: projects home, canvas, MCP tools, comments, history, tokens, generation animation, follow camera.
- Sprig design system project has 46 artboards (light + dark): foundations, components, 14 pages, 9 system sheets
  (buttons, forms, feedback, navigation, data display, states, icons, theme & tokens, data table density).
- Dev server is **stopped**; start with `pnpm start`. No git remote configured, nothing pushed.
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

## Next ideas (none are committed to; ask the user)
- Follow `docs/ROADMAP.md` ("Not done, in suggested order"): MCP panel UI, theme editor, components, layers panel.
- More Sprig pages: Replay viewer, onboarding, empty states, modals; a mobile page set.
- Per-user density preference demo, responsive previews, static-site export, pick-the-cover for a project.
- Keep comment ids stable across rebuilds (re-target by artboard name) so rebuilds do not orphan comments.
- Tests: `pnpm test` covers doc, lint, export and meter; the store, sanitizer and tokens extraction are still untested.

## How to resume in a new session
1. Read `CLAUDE.md` and this file. 2. `git log --oneline | head -20` and `git status`. 3. `pnpm start`, open
http://localhost:3777. 4. Ask the user what to do next if the request is not clear.
