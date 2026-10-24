# Design Canvas

A small local, Paper-like design canvas that Claude drives over MCP. Built from scratch (nothing decompiled).
Claude generates HTML designs onto an infinite pan/zoom canvas; the user watches them appear live, comments on
elements, and Claude reads and answers those comments. Local only, no database (JSON files).

**Read `PROGRESS.md` first** for what has been done, current state and what to do next (it has a "Next work, split into sessions"
list: pick one area per session, keep sessions short, and update PROGRESS.md / ROADMAP.md before ending a session).

**Paper (paper.design) research** is in `docs/PAPER-QUALITY-PLAN.md` (section 1.1b = desktop/MCP internals found with REA on 2026-10-22);
the improvement ideas it produced are item 6 of "Next work" in `PROGRESS.md` (headless render worker, hidden-tab fix, per-session project binding).

**The UI is a React app in `web/` (the rewrite of the old `public/` finished in Phase 8; plan and per-phase notes in `docs/REACT-REWRITE.md`).**

## Run
- `pnpm build:web` once (and after any `web/` change), then `pnpm start` (= `node src/server.mjs`) serves http://localhost:3777 (the server serves `web/dist`; without a build it answers 503). Stop it with a normal kill so it flushes `data/`.
- UI dev: `pnpm dev:web` (Vite on http://localhost:5173 with HMR, proxies /api /events /mcp /reply to the 3777 server, which must be running).
- MCP endpoint: `http://localhost:3777/mcp` (StreamableHTTP, stateless). Registered in Claude Code as `design-canvas`.
  After changing MCP tool schemas, Claude Code must be restarted to see them.
- A project must be open in a browser tab for `get_screenshot` to work (the browser rasterizes the artboard).
- Pages: `/` projects home, `/p/<id>` canvas, `/comments` all comments.

## Layout
- `src/server.mjs` HTTP routes, SSE (`/events`, `/events?project=<id>`), delta doc sync, comments API.
- `src/mcp.mjs` MCP tools (get_guide, projects, design editing, comments, tokens). Read the GUIDE text there.
- `src/store.mjs` `ProjectStore`: projects, snapshots (versions), activity log, comments, active project.
- `src/doc.mjs` `Doc`: one project's artboards; sanitizes HTML, assigns `data-pid` ids, atomic debounced saves.
- `src/guide.mjs` the design guide served by `get_guide({topic})` (start, brief, type, layout, review, mobile). The process and taste rules
  live here so any MCP client gets them; the skill only points at it. `log_prompt.brief` is stored in `meta.brief`.
- `src/dialect.mjs` layout-dialect check (margin, grid, inline, table): reported as a `dialect` line on `write_html` / `update_styles`
  for normalizing projects and as `lint` issues; never rewrites markup.
- `src/normalize.mjs` opt-in HTML normalization on write (`meta.normalize`: on for new projects, off for Sprig and imports).
- `src/lint.mjs` static lint (`lint` tool; spacing grid 4 by default, use `grid: 2` for Sprig); `src/export.mjs` React+Tailwind export; `src/meter.mjs` per-tool token estimates
  (`/api/status`). `test/` holds `node:test` tests: run `pnpm test` before committing.
- `examples/evals/` generation-quality evals (6 fixed briefs, `run.mjs run <label>` / `report <a> <b>`), fed by `src/evalmetrics.mjs`
  and `GET /api/p/<id>/eval`. Costs real Claude runs and needs a browser tab per project; results are gitignored.
- `skills/design-canvas/SKILL.md` + `.claude-plugin/` + `.mcp.json`: the Claude Code plugin (the skill is only a short pointer at `get_guide`).
- `docs/ROADMAP.md`: the build plan adapted to this Node codebase, with what is done and what is left.
- `src/capture.mjs` `capture_url`: spawns a throwaway headless Chrome/Edge with `--remote-debugging-port=0`, talks CDP over Node's global `WebSocket`, runs an in-page walker that bakes computed styles into flat div/span/img/svg markup (the sanitizer strips `<style>`/`<link>`), screenshots it as a reference board. Only public http(s): `checkTarget` + a `Fetch.requestPaused` gate re-check every request's host (redirects, images); `allow_private: true` opts out. One capture at a time. Known gaps: `colspan`/`rowspan`, pseudo-element icons that are not plain text, web fonts, colours stay rgb. `Doc.writeHtml(..., { normalize:false })` keeps the copy unnormalized.
- `src/fonts.mjs` Google Fonts: `use_font` / `list_fonts` fetch the latin woff2 once into `data/fonts/` (gitignored), served at `/api/fonts/<slug>/<file>`, recorded in `meta.fonts`; browser side is `web/src/canvas/fonts.ts`.
- `src/find.mjs` `find_nodes` search; `nodeToReact` in `src/export.mjs` backs `get_jsx`; the `export` tool (PNG only, no PDF: the render round-trip yields bitmaps) writes to `data/exports/<id>/`.
- `scripts/setup-mcp.mjs` (dry run by default, `--apply`) registers the endpoint in Claude Code (`claude mcp add`) and Claude Desktop (merges only the `design-canvas` key, writes a .bak); `scripts/mcp-stdio.mjs` is the stdio->HTTP shim Desktop launches; pure logic in `src/setup.mjs`.
- `src/tokens.mjs` design-token extraction (OKLCH) with css/json/tailwind output.
- `web/` React 19 + Vite + Tailwind v4 + shadcn (Base UI) client: `src/canvas/` imperative engine + editor, `src/panels/`, `src/shell/`, `src/pages/`, `src/store/` (zustand), `src/api/`.
- `examples/sprig/` scripts that build the "Sprig design system" project through the MCP endpoint (see below).
- `data/` runtime data (gitignored): `projects/<id>/{doc,meta,activity,comments}.json`, `snapshots/`, `state.json`.

## Fonts (easy to get wrong)
The sanitizer strips `<link>`/`<style>`, boards are shadow roots (which ignore `@font-face`) and bitmaps go through SVG foreignObject (which loads nothing). So: live DOM uses a document-head `<style id=dc-project-fonts>`; screenshots and snapshots embed the used faces as data: URIs (`embeddedFontCss`). Agents must call `use_font` before using a Google family; `lint` flags any family that is neither system nor loaded.

## Conventions (follow these)
- **Colours are OKLCH everywhere** (UI CSS, generated designs, tokens). Hex only as authored input that gets converted.
- **Motion rules:** curves `--ease-out cubic-bezier(0.23,1,0.32,1)`, `--ease-in-out cubic-bezier(0.77,0,0.175,1)`,
  `--ease-drawer cubic-bezier(0.32,0.72,0,1)`; animate transform/opacity only; never `transition: all`;
  press scale 0.96; hover styles gated by `(hover:hover) and (pointer:fine)`; always a `prefers-reduced-motion`
  variant; no animation for frequent actions (shortcuts, pan, zoom, selection).
- **Security:** bind 127.0.0.1 only, Host allowlist (DNS rebinding), JSON-only POSTs, project id regex `^p_[a-f0-9]{8}$`,
  sanitize all HTML, and render untrusted text (names, comments) with `textContent`, never `innerHTML`.
- The user's global rules apply: purposeful "why" comments in code; commit messages without any Claude attribution;
  small focused commits (one per concern, never one giant commit).

## Architecture notes that are easy to get wrong
- **Rendering / performance (web/src/canvas/engine.ts):** every artboard is a shadow-DOM frame. Level of detail: live HTML is
  mounted only when zoom >= `LIVE_K` (0.3) and the board is near the viewport (or Claude is drawing in it);
  below that a cached bitmap snapshot (`<img.thumb>`) is shown. Snapshots are rendered one at a time in idle time
  via SVG foreignObject and cached in IndexedDB keyed by a hash of the HTML. `pidIndex` maps node id -> artboard
  so lookups never scan every shadow root. Pan/zoom heavy work is coalesced in one rAF (`afterView`).
- **Delta sync:** the server sends each client only artboards whose HTML changed (`html: null` = unchanged); the
  client refills from its previous doc. If an artboard ever shows blank, a reload fixes it (one unexplained blank
  screenshot was seen once and not reproduced).
- **Live "Claude is designing":** `touchGen` ring + header pill `#live`; **Follow** toggle (`followTo`) glides the camera
  to the artboard being written (centres on newest content for tall boards); backs off 2.5s after user input.
- **Components:** masters live in `doc.data.components` (`src/components.mjs`). Instances are stored *expanded* in the artboard
  HTML with `data-component`/`data-variant`; `setComponent` re-expands them in place (root id and `data-slot` text kept).
  Hand edits inside an instance are replaced by the master on the next master edit; `detach_component` opts out.
- **References:** pictures live in `data/projects/<id>/refs/R<n>.<ext>` (bytes validated by magic number in `src/images.mjs`), metadata in
  `doc.data.references`, shown on a locked board (`generated: 'reference'`, served from `/api/p/<id>/ref/<R#>`). The SVG rasterizer
  cannot load http images, so reference boards are drawn directly; `compare_to_reference` runs in the browser (`compareToReference`).
- **Pages:** `doc.data.pages` is stored only once a second page exists (before that the first page is implicit and boards
  carry no `page`). The browser shows one page at a time (`activePage`, remembered per project); off-page boards are
  `display:none` and unmounted. Claude's default target page is `ui.currentPage` (`set_page`), not document data.
  The only page switcher is `web/src/panels/PagesPanel.tsx`, the top section of the left sidebar (`LeftPanel` in Shell.tsx): click to switch,
  "+" creates a page (canvas action `page-create`) and starts inline rename (`page-update`), double-click renames. There is no header select any more.
- **Token sync:** `meta.repo` is the linked code folder; `src/tokensync.mjs` only reads files inside it (path check) and maps
  CSS custom properties onto token names, reporting what it cannot classify instead of guessing.
- **Inspector:** `web/src/panels/InspectorPanel.tsx` (Design tab) reads the selected node's inline style from the parsed HTML and sends
  `style` actions (one property each, one undo step). Fields suggest `var(--token)` values from the theme.
- **Font picker:** the Typography Font row is `web/src/ui/FontField.tsx` (menu of project fonts from `meta.fonts` plus system fonts, each name drawn
  in its own face because the project-fonts style tag lives in the same document as the panels) over a raw "Stack" text field. The shown family is
  the node's own `font-family`, else the nearest ancestor's (inherited, dimmed), with `var(--token)` resolved via the theme (`effectiveFamily` in InspectorPanel).
- **Layers panel:** `web/src/panels/LayersPanel.tsx` (left drawer) builds the tree from each artboard's HTML with DOMParser and sends
  rename / flags / move-node actions. Edits the user makes there call `markUserEdit()` so the canvas does not play the
  "Claude is designing" reveal and camera follow for them. `hidden` works because the shadow root and screenshot wrapper
  add a `[hidden]` display:none rule (an inline display:flex would otherwise win).
- **Board contract + fit height (Phase A):** every board is wrapped in `[data-board-root]` (flex column, border-box) from one definition,
  `web/src/canvas/contract.ts` (server copy `src/contract.mjs`; a test keeps them equal). Boards with `heightMode: 'fit'` treat `height`
  as a minimum: the browser measures real layout (`measureLayout` in `rects.ts`, over SSE `measure`), `src/layout.mjs` formats the
  report and grows the board. Tools: `check_layout`, `fit_artboard`; `finish_working` gates on it. New MCP boards default to fit.
- **Doc history:** `Doc` keeps an in-memory undo stack (50 steps, not saved to disk) and a change journal (`record`,
  `changesSince`) that backs `get_changes`. Nodes with `data-locked` refuse edits. `write_html` expands `<x-clone node-id>`.
- **Browser round-trips:** screenshots and `get_computed_styles` need real layout, so the server asks an open tab over SSE
  (`askBrowser`) and the tab answers via POST `/reply`. With no tab open, `src/headless.mjs` (`HeadlessWorker`) spawns the machine's
  Chrome/Edge headless on `/p/<id>?headless=1` (own temp profile, killed after 2 min idle or on SIGINT/SIGTERM). That page is an
  ordinary SSE client flagged `headless` (it never claims the active project, and real tabs win in `askBrowser`). `DC_BROWSER=<exe>`
  picks the browser, `DC_HEADLESS=0` disables it. Needs `pnpm build:web`. A hard kill of the server (taskkill /F) orphans the browser.
- **Active project:** the browser claims it via POST `/activate` on load/visibility, not on SSE reconnect.
- **Artboard ids change when artboards are deleted and recreated** (build scripts do this). Comments pinned to the old
  ids become orphaned (shown as "replaced or deleted" on `/comments`).
- Static files are served `no-cache`, so a reload picks up UI edits. Restart the server for `src/` changes.

## Sprig design system project (`examples/sprig`)
Built from a user-supplied Sprig Home screenshot. Project name `Sprig design system` (id `p_aced47a7`, data is local
and not in git). Scripts talk to the running server and are idempotent (delete same-named artboards, then recreate):
```
node build.mjs && node build-more.mjs && node build-system.mjs && node build-density.mjs     # light
THEME=dark node build.mjs && THEME=dark node build-more.mjs && THEME=dark node build-system.mjs && THEME=dark node build-density.mjs
```
`ds.mjs` holds the `LIGHT`/`DARK` palettes, icons and component helpers (components read colour *roles*, never raw
values). Layout: light rows at y=0/1200/2400, dark mirror 6600px lower with a " · Dark" suffix. Spec in
`examples/sprig/DESIGN-SYSTEM.md`. Status text must use the `*Ink` tokens (AA-safe), not the plain status colours.
