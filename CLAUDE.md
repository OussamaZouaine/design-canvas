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
- MCP endpoint: `http://localhost:3777/mcp` (StreamableHTTP, stateful sessions: `src/sessions.mjs`; a session id gets an agent identity from `clientInfo` / `?agent=<name>` / `start({agent})` and a bound project; unknown/expired ids (server restart, idle TTL) are served statelessly under a revived Session with the same id, never 404, because SDK clients do not re-initialize; requests with no session fall back to the active project). Registered in Claude Code as `design-canvas`.
  After changing MCP tool schemas, Claude Code must be restarted to see them.
- A project must be open in a browser tab for `get_screenshot` to work (the browser rasterizes the artboard).
- Pages: `/` projects home, `/p/<id>` canvas, `/comments` all comments.

## Layout
- `src/sessions.mjs` `Session` (agent identity, OKLCH colour, `projectId` binding) + `SessionMap` (30 min idle TTL). `DC_DATA=<dir>` runs a second instance on its own data folder.
- `src/server.mjs` HTTP routes, SSE (`/events`, `/events?project=<id>`), delta doc sync, comments API.
- `src/mcp.mjs` MCP tools (get_guide, projects, design editing, comments, tokens). Read the GUIDE text there. Low-traffic families are single action-enum tools
  (flat schema, per-action `need()` checks): `pages`, `components` (+ separate `insert_component`), `references`, `project`, `tokens`, `history`, `export_code`; the
  edit tools also live in the `edits` map shared with `batch`. Activity/log names stay the old per-operation ones (`create_page`...). Keep new tools out unless hot.
- `src/store.mjs` `ProjectStore`: projects, snapshots (versions), activity log, comments, active project.
- `src/doc.mjs` `Doc`: one project's artboards; sanitizes HTML, assigns `data-pid` ids, atomic debounced saves.
- `src/guide.mjs` the design guide served by `get_guide({topic})` (start, brief, type, layout, review, mobile). The process and taste rules
  live here so any MCP client gets them; the skill only points at it. `log_prompt.brief` is stored in `meta.brief`.
- `src/agentlog.mjs` `CallLog`: one entry per MCP tool call (`{id,t,ms,tool,project,ok,error?,tokens,args}`, args summarized, never HTML), ring of 500 per project + `calls.jsonl`; recorded in the `registerTool` wrapper, emitted as store/SSE `call` (+ `call-start` for slow tools), read at `GET /api/p/<id>/calls?since=<t>`. Adds nothing to tool results.
- `src/efficiency.mjs` pure cost/efficiency report from the call log (per agent, per prompt, waste hints; `GET /api/p/<id>/efficiency`, fixed costs via `measureFixed` in server.mjs); UI `web/src/panels/EfficiencyPanel.tsx` (MCP tab). Turns are estimated from call timing.
- `src/feedback.mjs` (pure, `test/feedback.test.mjs`): `HUMAN FEEDBACK` block appended to tool results for new unresolved user comments (`Session.delivered`, once per session, skipped for the `anon` session and comment tools; `appendFeedback` in mcp.mjs) + `clampStatus` for the optional `status` param on `start`/`write_html` (`Session.status`, carried on each call's `agent` snapshot, shown in `AgentsPanel`, cleared by `finish_working`).
- `src/claims.mjs` `Claims`: soft board claims (an agent's write claims the board for 60 s; another agent's write gets a one-line `note:` appended to its result, never an error) + the user's per-agent pause (`POST /api/agents/pause`; paused agents' writes return a polite error). Pushed as SSE `claims`; UI outline is `engine.setClaims`, controls are in `AgentsPanel`. `get_changes`/`start` add `others` (what other agents changed since this session's last read, `Session.seen`).
- `src/heal.mjs` `healHtml` (pure, `test/heal.test.mjs`) + `write_html` `stream: start|next|end` in mcp.mjs: streamed runs keep the raw text per `project:target` (`streams` map), heal the prefix, and `Doc.writeHtml(..., {drop})` swaps the run's previous nodes in the same undo step.
- `src/stepdiff.mjs` per-step diffs for Activity (bounded spans, reverse patch); `Doc.captureStep/revertStep` + `ProjectStore.listActivity({since})/revertStep` back the Activity tab (runs by prompt+agent, steps, Revert, incremental `?since=`).
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
- `src/svg.mjs` vectors are plain inline `<svg>` in board HTML. `sanitizeSvg` (run in `Doc._prepare`) strips style/script/foreignObject/external hrefs and remote `url()`;
  `Doc.setAttrs` + tool `set_attrs` edit geometry/paint attributes (allowlist `SVG_ATTRS`); `import_svg` places a file/markup; guide topic `svg`.
  UI: shape tools (R/O/L) write `<svg data-shape=...>` via `web/src/canvas/shapes.ts`; Inspector `Vector` section posts the `attrs` canvas action. Use `isNodeEl` (not `instanceof HTMLElement`) for anything that finds nodes: SVG elements are SVGElement.
- Pen tool + path edit (`web/src/canvas/pen.ts` `PathTools`, engine owns it): tool P draws `<svg data-shape="path">` (via `shapes.pathHtml` + `CanvasEditor.addPath`, `paste` action);
  double-click / Enter on a selected path shows anchors + handles (overlay svgs `.dc-pathsvg`), drags patch the DOM live and send ONE `vector` canvas action on release
  (`Doc.editVector`: `d` on the child path + viewBox/left/top/width/height on the svg, one undo step; the box is refitted by `fitToBox`). Pure maths (parse/serialize/insert/
  bounds...) is DOM-free `web/src/canvas/path.ts`, unit-tested by `test/path.test.mjs` (Node strips the types; keep it import-free and erasable-TS only). Arcs/multi-subpath `d` is not editable.
- Selection (`web/src/canvas/selection.ts`, pure, tested by `test/selection.test.mjs`): `engine.selected` is an ordered id array (last = primary), `context` is derived from the
  primary's parent; Figma-style picking (click = context child, dblclick enters, Ctrl = deepest, Shift toggles), marquee, keyboard nav. Details: `docs/notes/element-manipulation-plan.md`.
- Drag in flow (`web/src/canvas/dragflow.ts` pure + `CanvasEditor.dragFlow` in `edit.ts`): dragging a non-absolute node reorders it among siblings or reparents it (ghost, insertion line,
  150 ms dwell, Alt = copy, Esc cancels, arrows reorder), one `move-nodes` canvas action -> `Doc.moveNodes` (one undo step). Tests `test/dragflow.test.mjs`; details in `docs/notes/element-manipulation-plan.md`.
- Snapping / guides (`web/src/canvas/snap.ts` pure + `guides.ts` overlay drawer, tested by `test/snap.test.mjs`): `CanvasEditor.dragNode` / `dragBoard` / `beginResize` snap edges + centres to siblings and the parent (5 screen px, equal spacing),
  Ctrl = no snap, Shift = axis lock (move) / aspect ratio (resize), Alt = from centre (resize) and Alt+hover = measure; arrows nudge absolute nodes (`nudge`, one undo step per key burst). Multi-node moves/resizes/nudges send ONE canvas `style`
  action with `perId` (`Doc.updateStyles(ids, styles, perId)`). Details: `docs/notes/element-manipulation-plan.md`.
- Group / ungroup / add auto layout (Ctrl+G, Ctrl+Shift+G, Shift+A): `Doc.wrapNodes` / `unwrapNode` (one undo step, canvas actions `wrap` / `unwrap`), styles decided by pure `web/src/canvas/structure.ts` (tests `test/structure.test.mjs`);
  `CanvasEditor.wrap/unwrap` measure and send. Drag in flow draws `.dc-hints`; fit boards regrow after user edits (`Board.growObs`, canvas action `grow`). Shortcut list: `web/src/shell/ShortcutsDialog.tsx` (keep in sync). Notes: `docs/notes/element-manipulation-plan.md`.
- `src/find.mjs` `find_nodes` search; `nodeToReact` in `src/export.mjs` backs `export_code` format `jsx`; the `export` tool (PNG only, no PDF: the render round-trip yields bitmaps) writes to `data/exports/<id>/`.
- `scripts/setup-mcp.mjs` (dry run by default, `--apply`) registers the endpoint in Claude Code (`claude mcp add`) and Claude Desktop (merges only the `design-canvas` key, writes a .bak); `scripts/mcp-stdio.mjs` is the stdio->HTTP shim Desktop launches; pure logic in `src/setup.mjs`.
- `src/tokens.mjs` design-token extraction (OKLCH) with css/json/tailwind output.
- Agent feed (UI): `web/src/store/agents.ts` holds the MCP call log from SSE `call`/`call-start` (presence, kinds, filters, follow-agent); `panels/AgentsPanel.tsx` is the Agents tab; chips + pills are in `shell/Shell.tsx`; the engine tints highlight boxes/ring per agent (`setAgentIds`). Presence is derived from calls, never from SSE clients (headless worker is one).
- `web/` React 19 + Vite + Tailwind v4 + shadcn (Base UI) client: `src/canvas/` imperative engine + editor, `src/panels/`, `src/shell/`, `src/pages/`, `src/store/` (zustand), `src/api/`.
- `examples/sprig/` scripts that build the "Sprig design system" project through the MCP endpoint (see below).
- `data/` runtime data (gitignored): `projects/<id>/{doc,meta,activity,comments}.json`, `snapshots/`, `state.json`.

## Fonts (easy to get wrong)
The sanitizer strips `<link>`/`<style>`, boards are shadow roots (which ignore `@font-face`) and bitmaps go through SVG foreignObject (which loads nothing). So: live DOM uses a document-head `<style id=dc-project-fonts>`; screenshots and snapshots embed the used faces as data: URIs (`embeddedFontCss`). Agents must call `use_font` before using a Google family; `lint` flags any family that is neither system nor loaded.

## Conventions (follow these)
- **Colours are OKLCH everywhere** (UI CSS, generated designs, tokens). Hex only as authored input that gets converted.
- **Chrome UI tokens and patterns** (graphite surfaces, `bg-field`, `.material`, `shadow-float`, `pointer-hover:` variant, signal blue = selection only): `docs/notes/ui-system.md`.
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
  Hand edits inside an instance are replaced by the master on the next master edit; `components` action `detach` opts out.
- **References:** pictures live in `data/projects/<id>/refs/R<n>.<ext>` (bytes validated by magic number in `src/images.mjs`), metadata in
  `doc.data.references`, shown on a locked board (`generated: 'reference'`, served from `/api/p/<id>/ref/<R#>`). The SVG rasterizer
  cannot load http images, so reference boards are drawn directly; `compare_to_reference` runs in the browser (`compareToReference`).
- **Pages:** `doc.data.pages` is stored only once a second page exists (before that the first page is implicit and boards
  carry no `page`). The browser shows one page at a time (`activePage`, remembered per project); off-page boards are
  `display:none` and unmounted. Claude's default target page is `ui.currentPage` (`pages` action `set`), not document data.
  The only page switcher is `web/src/panels/PagesPanel.tsx`, the top section of the left sidebar (`LeftPanel` in Shell.tsx): click to switch,
  "+" creates a page (canvas action `page-create`) and starts inline rename (`page-update`), double-click renames. There is no header select any more.
- **Token sync:** `meta.repo` is the linked code folder; `src/tokensync.mjs` only reads files inside it (path check) and maps
  CSS custom properties onto token names, reporting what it cannot classify instead of guessing.
- **Inspector (Design tab):** `web/src/panels/InspectorPanel.tsx` picks the page / artboard / node view; the node view is `panels/inspector/*`: `model.ts` (`useModel`: the whole selection,
  `get` = shared value or `MIXED`, `patch` / `patchEach` = ONE `style` action with `ids` / `perId`, `preview` = live write to the element without a server write, `measure`),
  `LayoutSections.tsx` (align bar, Position, Size Fixed/Hug/Fill, Auto layout with 3x3 grid, Appearance), `PaintSections.tsx` (Fill, Stroke, Effects), `TypographySection.tsx`,
  `VectorSection.tsx` (single svg, `attrs` action), shared bits in `controls.tsx`. Pure logic (size modes, grid, align / distribute, expressions, shorthand, stroke / shadow parsing)
  is `web/src/lib/inspect.ts`, tested by `test/inspect.test.mjs`. Fields: `ui/NumberField.tsx` (scrub label, arrows, expressions, Mixed, `onPreview`), `ui/ColorField.tsx` (OKLCH popover).
  Fill / Stroke / Effects read `background`, `border` (inside) / `outline` (outside), `box-shadow`; a hidden fill is parked in `--dc-hidden-fill`.
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
