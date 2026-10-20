# React rewrite plan (public/ -> web/)

Decided 2026-10-20 with the user. Read `CLAUDE.md` and `PROGRESS.md` first, then this file.
**Each phase is one session.** At the end of a phase: run `pnpm test`, tick the phase below, add notes under "Phase log",
update `PROGRESS.md`, commit. A new session continues from the first unticked phase.

## Decisions (do not re-ask)
- **Stack:** React 19.x (latest), Vite 8, `@vitejs/plugin-react` 6 + **React Compiler** (`babel-plugin-react-compiler` 1.x,
  enabled in the Vite config; no manual `useMemo`/`useCallback`), TypeScript, Zustand for shared state, **TanStack Router** (code-based, user choice 2026-10-20; not React Router) (store is selector-based, works with the
  compiler). **shadcn/ui + Tailwind CSS v4** for components and styling (added 2026-10-20 at the user's request; shadcn requires Tailwind,
  so this replaces the earlier "plain CSS" idea). Theme the shadcn CSS variables with the existing OKLCH palette (shadcn v4 is OKLCH already).
  Use `pnpm dlx shadcn@latest init` / `add` inside `web/`; components are copied into `web/src/components/ui/` and may be edited freely.
  Restyle them to the dense Figma-like look (small type, 28px controls, 1px hairlines) through the theme variables, not per-use overrides.
  Custom pieces shadcn lacks (scrub NumberField, OKLCH ColorField, layer tree, floating toolbar) are built on Base UI primitives (`@base-ui/react`).
  Check current shadcn docs with the context7 tools before init (CLI flags change).
- **Server unchanged.** `/api`, `/events` (SSE), `/mcp`, `/reply` keep their contracts. The React app is a new client in `web/`.
- **Canvas stays imperative.** Shadow-DOM frames, transforms, level-of-detail, thumbnails, overlays, rasterizing live in
  `web/src/canvas/` as plain TS classes/modules behind ONE `<Canvas>` React component with a ref API. React must never render artboard HTML.
  The compiler is for panels and chrome; do not fight it inside the canvas engine (keep engine files outside React rules).
- **UI target:** look and feel as close as practical to Figma / Paper (see "UI direction").
- **Cut-over:** `public/` stays working until Phase 8. Server serves `web/dist` when it exists AND `?legacy` is absent;
  until cut-over the new app is served at `/next/*` so both run side by side. Delete `public/` only in Phase 8.
- **Desktop app:** deferred, not part of this rewrite.

## UI direction (Figma / Paper feel)
- Chrome: top bar slim (40px) with project name, page tabs, zoom; **left** icon rail + Layers panel; **right** inspector with
  Design / Comment / Activity / Versions / Theme / Tokens / MCP tabs (Figma-style, 240-280px, sections with collapsible headers).
- **Bottom-center floating toolbar** (move, frame, text, image, comment, hand) like Figma/Paper; keyboard shortcuts V, F, T, C, H, Space-pan.
- Dense 11-12px UI type, 4px grid, 1px hairline borders, neutral grey canvas (dark by default, light supported),
  selection blue handles with 8 squares, rulers/size label under the selection ("W x H"), cursor labels for Claude.
- Inspector fields: scrub-to-change number inputs (drag the label), linked colour swatch + OKLCH/hex input, segmented controls
  for alignment/direction. Right-click context menu on canvas and layers.
- Keep all motion rules from `CLAUDE.md` (eases, transform/opacity only, reduced-motion, hover gating, no `transition: all`).

## Layout of the new app
```
web/                      Vite app (own package.json or workspace; dev server proxies /api /events /mcp to :3777)
  src/main.tsx            TanStack router (basepath /next until Phase 8): /, /p/$id, /comments
  src/api/                typed fetch client + SSE hook (one EventSource per project, reconnect) + shared types
  src/store/              zustand: doc, selection, view (pan/zoom), ui (panels, tool), comments, theme
  src/canvas/             imperative engine (port of public/app.js) + <Canvas> wrapper
  src/panels/             Layers, Inspector, Comments, Activity, Versions, Theme, Tokens, Mcp
  src/pages/              Home, Project, Comments
  components/ui/          shadcn components (button, tabs, select, popover, dropdown/context-menu, tooltip, input, slider, toggle-group, scroll-area...)
  src/ui/                 our own primitives built on them: NumberField (scrub), ColorField (OKLCH), Toolbar, LayerRow
  src/styles/             globals.css (Tailwind v4 import, theme variables in OKLCH, motion rules)
```

## Phases
- [x] **Phase 0 - Scaffold (short).** Create `web/` with Vite + React 19 + TS + React Compiler (verify it is active: build output
  contains compiler runtime `react/compiler-runtime`; add `eslint-plugin-react-hooks` compiler rules). Dev proxy to 3777.
  Server serves `web/dist` at `/next/` (add route + SPA fallback, keep Host allowlist and no-cache). `pnpm dev:web`, `pnpm build:web` scripts.
  Run shadcn init (Tailwind v4, OKLCH theme variables, dark/light) and add the base components. Port the design tokens to `styles/`. Hello-world route renders and talks to `/api/projects`. Done = page loads at `/next/`.
- [x] **Phase 1 - Data layer + shell.** Typed API client, SSE hook (doc delta refill from previous doc, `html: null` = unchanged,
  active-project claim via `/activate`), zustand stores, router, app chrome (top bar, left rail, right panel frames, floating toolbar skeleton),
  shadcn components restyled for the Figma-like density, plus our NumberField/ColorField, dark/light theme. Done = project page shows live artboard names + status pill.
- [x] **Phase 2 - Home and Comments pages.** Port `home.js` + `comments.js` (cards with live previews, search/sort, trash, import/export,
  all-comments page with filters, deep link `?comment=`). Easiest full pages, proves the data layer. Done = parity with `/` and `/comments`.
- [x] **Phase 3 - Canvas engine core.** Port from `public/app.js`: world transform pan/zoom/fit, shadow-DOM frames, `pidIndex`,
  level of detail (`LIVE_K`), IndexedDB thumbnails, delta render, pages, Claude-designing ring/reveal/follow camera, hover/selection overlays.
  `<Canvas>` ref API: `select`, `fit`, `panTo`, events out through the store. Done = same boards render, zoom smoothly, 46 Sprig boards ok.
- [x] **Phase 4 - Canvas editing.** Selection, resize handles, drag-move absolute nodes, in-place text edit, copy/paste, undo/redo,
  keyboard shortcuts, artboard create/move, rasterize + `get_screenshot`/`get_computed_styles` replies over `/reply`, `compareToReference`,
  reference drop/paste. Done = screenshots from MCP work against the new app and edits round-trip.
- [ ] **Phase 5 - Layers + Inspector.** Port `layers.js` (tree, search, rename, hide/lock, drag-move) and `inspector.js` (style fields,
  token suggestions) as React panels with the Figma-style sections and scrub number fields, colour field (OKLCH), per-side padding.
- [ ] **Phase 6 - Side panels.** Comments (pins, popovers, threads, comment mode) + Activity, Versions, Theme (modes), Tokens, MCP tabs.
- [ ] **Phase 7 - Figma/Paper polish.** Floating toolbar tools wired (frame, text, image, comment, hand), context menus, rulers/size label,
  empty states, loading skeletons, a11y pass (focus, roles, `inert`), reduced-motion, 50+ board performance check with the React profiler.
- [ ] **Phase 8 - Cut-over and cleanup.** Serve the new app at `/`, `/p/:id`, `/comments`; remove `public/` and `?legacy`; update
  `CLAUDE.md` layout/run sections, `README`, plugin skill if UI names changed; run full manual pass; tag the commit.

## Rules for every phase
- Behaviour parity first; restyle only inside the phase that owns that UI. Do not change server contracts without noting it here.
- Comments explain the *why* (project rule). Tailwind is now in use: never write a literal Tailwind class containing brackets (arbitrary value or variant) in a comment or any text outside a real className; Tailwind scans all source text and it breaks the build.
- Test through a scratch server (`PORT=3790 node src/server.mjs`), delete scratch projects afterwards. Never leave them in `data/`.
- Keep the session short: finish the phase, update this file, commit, then tell the user to start a new session.

## Phase log
**Phase 0 (2026-10-20):** `web/` created by hand (Vite 8, React 19.3, TS 7, Tailwind 4, React Compiler via `@rolldown/plugin-babel` +
`reactCompilerPreset()`; plugin-react 6 has no inline babel option). Compiler verified active (`memo_cache_sentinel` in the build).
shadcn init ran with `-t vite -b base -p mira` (compact preset; style `base-mira`). **Primitives are Base UI (`@base-ui/react`), not Radix** (user choice 2026-10-20); re-running init resets the icon library, so keep `iconLibrary` = **lucide** in `components.json`.
Server: `/next/*` serves `web/dist` with SPA fallback (`src/server.mjs`). Scripts: `pnpm build:web`, `pnpm dev:web` (Vite on 5173,
base `/next/`, proxies /api /events /mcp /reply to 3777). Smoke page at `/next/` lists projects: works, no console errors.
Notes for later phases:
- shadcn's `cn` comes from the `cn` npm package re-exported in `src/lib/utils.ts` (what the CLI generated); fine to keep.
- Generated `button.tsx` uses `transition-all`, which breaks our motion rule: replace with explicit transform/opacity/colour transitions
  when restyling in Phase 1 (apply to every shadcn component you add).
- shadcn dark mode is the `.dark` class (custom variant in globals.css), not a media query: Phase 1 adds the theme toggle + `localStorage`.
- Vite dev: open `http://localhost:5173/next/` with the Node server also running on 3777.
- To test against the built output use a scratch server: `PORT=3790 node src/server.mjs` (shares `data/`, read-only use is fine).

**Phase 1 (2026-10-20):** Data layer + shell done.
- `web/src/api/`: `types.ts`, `projects.ts` (fetch wrapper; `projectAction`, `canvasAction`, `activateProject`), `useProjectEvents.ts`
  (one EventSource per project page; claims "active" on load/visibility, not on reconnect).
- `web/src/store/project.ts` (meta, doc, comments, connection, agentIds; `applyDocDelta` refills `html: null` from the previous doc)
  and `store/ui.ts` (tool, panel tab, panels, theme persisted in localStorage, dark default).
- `web/src/shell/Shell.tsx`: TopBar + status pill, LeftPanel (artboard names; real tree in Phase 5), RightPanel tab frames, FloatingToolbar skeleton.
- `web/src/ui/NumberField.tsx` (drag-label scrub) and `ColorField.tsx` (text is source of truth; hex-to-OKLCH picker deferred to Phase 5).
- Router is **TanStack Router**, code-based, in `main.tsx` (basepath `/next`). Routes: `/`, `/p/$id`. `/comments` comes in Phase 2.
- Button restyled: explicit transitions, 0.96 press scale, reduced-motion. Only Button exists from shadcn so far; apply the same to each new one.
- globals.css: `--ease-*`, `--selection`, `--canvas` vars; removed the prefers-color-scheme block (the app owns the theme).
- Gotcha: a long-running server on 3777 started before Phase 0 has no `/next/` route; restart it. Verified on a scratch server (3790): 19 live artboards, connected pill.


**Phase 2 (2026-10-20):** Home (`/next/`) and Comments (`/next/comments`) ported with parity: search/sort, Projects/Trash tabs, live cover
previews, card menu (open, inline rename, duplicate, export, trash with Undo toast, restore, two-step delete forever), New project dialog,
import, open-comment badge, comments filters (project/author/status/search), reply toggle, resolve/reopen, two-step delete, live refresh.
- New shared pieces: `hooks/useLiveReload.ts` (global `/events`, debounced per event, `useEffectEvent`), `ui/AppHeader.tsx` (+ConnectionPill),
  `store/toast.ts` + `ui/Toaster.tsx` (call `toast(msg, actionLabel?, onAction?)` anywhere), `lib/time.ts` (`ago`), `pages/home/*`.
- shadcn added: input, dialog, dropdown-menu, select, tabs, badge (explicit transitions instead of `transition-all`). Base UI `Select` needs
  the `items` prop on the root or the trigger shows the raw value. When running `shadcn add`, answer **n** to the button.tsx overwrite prompt.
- List pages scroll inside their own `h-full overflow-y-auto` wrapper because `body` is `overflow: hidden` (the canvas page needs that).
- `/p/$id` route now validates `?comment=<id>` (the Comments page links to it); the canvas opens that thread in Phase 6.
- (Phase 2, continued) Checked in the browser (scratch server): home grid, card menu, arming delete-forever, new-project create + navigate, comments list and
  deep link. Trash/restore/rename mutations use the same endpoints as legacy but were not clicked through (the browser pane was hidden).

**Phase 3 (2026-10-20):** Canvas engine core done; the project page now shows the real boards.
- `web/src/canvas/engine.ts` = `CanvasEngine` class (port of the render half of `public/app.js`): world transform, wheel pan + ctrl/pinch zoom,
  drag-pan on empty space, `fit`/`zoomBy`/`focusBoard`/`panTo`, shadow-DOM frames, `pidIndex`, level of detail (`LIVE_K` 0.3), snapshot queue,
  delta render (skips boards whose HTML did not change), pages (`setPage`, `setPageWhenReady`, auto-switch when Claude draws elsewhere),
  Claude ring/shimmer/reveal/follow camera, selection + hover + agent overlays, theme decls (`setThemeMode`). `raster.ts` = hash, IndexedDB
  cache (same db/store name as legacy, so snapshots are shared) and `rasterizeCanvas` (reused by Phase 4 screenshots). `canvas.css` = its styles.
- `Canvas.tsx` renders an empty div; effects create/destroy the engine, push `doc` and `agentIds` in, and engine events go to `store/canvas.ts`
  (`engine`, `zoom`, `selected`, `live`, `activePage`, `follow`). Chrome reads those: page switcher, zoom/fit/follow controls, `LivePill` (Shell.tsx).
- Per-board state is a `Board` object in a Map (no expando props on DOM nodes). Overlays are positioned in viewport coordinates (`relRect`).
- Selecting posts `/selection` so MCP `get_selection` works. NOT yet ported (Phase 4): artboard label drag, resize handles, node drag, text edit,
  shortcuts (Delete, undo, copy), `screenshot`/`computed`/`compare` SSE replies, comment mode, reference drop. Pins/comments are Phase 6.
- Verified on a scratch server with Sprig (46 boards): all boards render as snapshots at 3 percent, go live when zoomed in, click selects with
  the box, a created board shows ring + shimmer + live pill + follow camera, Add page switches pages. Scratch project removed.
- Gotcha: a CSS `position: relative` in `canvas.css` beat the Tailwind `absolute` utility and collapsed the viewport to 0 height; the element is
  positioned by its class only.
- **Open idea (user, 2026-10-20): Paper stays smooth and lets you select elements even when zoomed far out.** Researched below; **proposal only,
  no engine code changed yet.** Our gap: below `LIVE_K` boards are plain bitmaps (`<img.thumb>`), so `onPointerDown` (`composedPath` -> `data-pid`) finds nothing.

### Research: how Paper renders and hit-tests (2026-10-20)
Evidence: static read of the shipped artifacts only, nothing executed or measured. Desktop app `Paper.exe` is an Electron shell whose `app.asar`
(`src/window/paper-tab.ts`, `load-url.ts`) just does `loadURL(APP_URL + route)`; the editor is the web app at `app.paper.design`, bundle
`assets/main-BqJp0QF7.js` (4 MB, minified; names below are minified class names, so they will change per build). Raw copies and notes are in the
session scratchpad / side-session notes, not in the repo.
- **Rendering = real DOM, not canvas/WebGL.** Nodes are HTML/SVG elements inside one `div.paper-camera` (`transform-origin: top left`,
  `backface-visibility: hidden`, `pointer-events: none`) in a `contain: strict` viewport; pan/zoom is a transform on that one element. WebGL2 appears
  only in "Paper Shaders" fills and colour pickers; `OffscreenCanvas`/`createImageBitmap` only for image-alpha sniffing. No tiling, no bitmap snapshots,
  no CanvasKit/Skia/wasm found in the bundle (`grep` for them: zero hits). So the "stays smooth zoomed out" comes from doing **less DOM work**, not from bitmaps.
- **Culling (`CullingState`, `data-culled`).** Top-level nodes are grouped into "units" (a plan limited to ~4000 descendants per unit, at most 500 units).
  A unit whose `subtreeBounds` leaves a viewport inflated by 1.0x is marked `data-culled`, and revealed again inside an inflated 0.5x (my reading of the
  constants `smt=1`, `imt=.5`; the inflate helper `cZ` was not read). CSS: `.paper-camera [data-culled], [data-lod-hidden] { visibility: hidden }`.
  Culled nodes stay in the tree and keep their model data. Hides and reveals are metered by a per-frame **restyle budget** (`ymt`: 1500 hides, then 800
  reveals per tick; reveals go nearest-to-viewport-centre first) so a big zoom never restyles thousands of nodes in one frame.
- **Level of detail (`LodState`, `data-lod-hidden`, `data-lod-fx`).** Only on pages with >= 15000 nodes. Leaf nodes (no children) are bucketed by size
  (`max(width,height)`, text uses `fontSize*0.7`, text >= 20px never hidden) in half-octave buckets; a table maps zoom to a minimum world size:
  scale < 0.4 hides leaves under 7.5 px, < 0.2: 15, < 0.1: 30, < 0.05: 60, < 0.025: 120. They get `visibility:hidden`, so layout stays and containers
  still paint. Below scale 0.3 (or while zooming, 150 ms settle) `filter`/`backdrop-filter` are forced off via `data-lod-fx` once there are >= 32 such nodes.
- **Hit-testing is a JS walk over a world-space model, never `elementFromPoint`.** `HitTester.fromPoint(worldPoint, tolerance)`, tolerance =
  4 screen px x `1/scale`. It walks `rootNode.children`, skips invisible/locked/dragged nodes, tests `ze.intersectsRect(node, rect)` against model rects
  (`x,y,width,height` kept in the node tree), and recurses through `childrenIntersecting`, which filters by each child's cached `subtreeBounds`
  (union of own paint bounds and visible children, stops at `clipsContent`). Only SVG shapes get a precise `isPointInFill/Stroke` test. Artboard title
  labels are tested against their last drawn rect. Result: `{node, location: body|label, isEnclosed}` list, outermost to innermost; the select tool then picks
  from that list (the pick policy in `calculateNodeAtPoint` was not read). Because the model exists regardless of what is painted, **selection works at any
  zoom and is independent of culling/LOD**; selection and hover boxes are drawn by a separate HUD layer (`hudState`) from model rects.
- **Cost (reasoned from the code, not measured):** a hit-test is O(depth x siblings-per-level) with bounds pruning, no layout reads, so it is cheap enough
  per pointermove. The real costs Paper pays are memory (every node is a live DOM element plus a JS node object with layout fields) and style recalc, which
  it bounds with culling, the restyle budget and LOD. Paper still needs the whole document's DOM mounted, which is why it has the 15000-node LOD gate.

### Proposal: per-board rect index so hover/select works at any zoom (not implemented)
Idea: copy Paper's *separation of model from paint* but keep our cheaper paint (snapshot bitmaps). Our "model" is the HTML string, so we derive
a small **rect index** from it once per HTML version and hit-test against that.
1. **Data.** `BoardIndex = { hash, nodes: Float32Array/arrays of {pid, parentIdx, depth, x, y, w, h} }` in board-local px at scale 1, roots first.
   Store in `Board` (`b.index`), cache in IndexedDB next to the thumbnail (same key `${project}:${ab.id}:${hash}`, new store `rects`), so a reload is instant
   and only changed boards are re-measured. Cap at nodes with `data-pid` and size >= 1 px; typical board = a few hundred entries.
2. **Extraction.** SVG foreignObject rasterizing yields an opaque image, so rects need real layout. In `buildThumb`'s idle queue add `measureBoard(b)`:
   mount the HTML in one reusable off-screen shadow host (`position:fixed; left:-100000px; visibility:hidden; contain:strict`, board width, same theme decls),
   `querySelectorAll('[data-pid]')`, `getBoundingClientRect()` minus the root rect, unmount. One forced layout per board, one board at a time, same
   "wait until the user stops dragging" gate as snapshots. When a board is already live, refresh `b.index` from its mounted DOM on the same debounce
   (free layout) and use it so the two sources agree. Re-measure after fonts/images settle (`document.fonts.ready`, image `load`) because they shift layout.
3. **Hit-test API** in `engine.ts`: `pickAt(clientX, clientY): {pid, abId} | null`. Convert to world once, find the board (linear over boards is fine for
   hundreds; use `rbush` only if boards > ~2000), convert to board-local, then walk the index with a descent: take the children containing the point
   (tolerance `4/k` world px) while the child is "pickable" at this zoom. Pickable rule borrowed from Paper's LOD table: skip a node whose on-screen
   `max(w,h)*k` is under ~6 px, so far out you grab frames/sections and zooming in reveals smaller targets. Use it from `onPointerDown` and a
   rAF-throttled `pointermove` hover; the live-DOM `composedPath` path stays as is for `k >= LIVE_K` (exact, handles contenteditable) with the index as fallback.
4. **Overlays.** Selection/hover boxes already come from `relRect`; add a branch that builds the rect from the index when the node's board is a snapshot
   (no DOM to measure). Also keep `selected` valid when the board unmounts (today the box would lose its element).
5. **Invalidation.** `b.index` is stale as soon as `b.html` changes; keep serving the old index (rects move little) until the debounced re-measure lands,
   and drop it if the pid disappeared. Delta sync already tells us which boards changed (`html: null` = unchanged), so only those re-measure.
6. **Cost estimate (unmeasured, verify):** measure ~5-30 ms per typical board (one layout), done once per HTML version and cached; memory ~40 bytes x
   nodes (46 Sprig boards x ~500 nodes ~ 1 MB); hit-test microseconds. No change to snapshot cost. Worst case is a huge board (thousands of nodes): cap
   the index (e.g. 5000 nodes, depth-first, largest first) and report the cap.
7. **Later, optional (Paper-style, only if snapshots stop being enough):** instead of swapping to bitmaps, keep boards as live DOM and add Paper's three
   levers: `visibility:hidden` culling with hysteresis and a per-frame restyle budget, size-bucketed LOD that hides tiny leaves by zoom, and effects off while
   zooming. That removes bitmap blur and the snapshot queue, but costs a mounted DOM for every board, so it needs a perf experiment on Sprig (46 boards)
   before committing. Recommendation: build steps 1-5 first; they are additive and do not touch the render path.
Test plan: unit-test the index walk + pickable rule with a fake index (pure function in `canvas/pick.ts`); manual check on Sprig at 3 % and 10 % zoom
(hover box follows the cursor, click selects, `get_selection` returns the pid, selecting survives a board edit).

**Phase 4 (2026-10-21):** Canvas editing and MCP replies ported; screenshots and edits round-trip against the new app.
- `canvas/replies.ts`: `screenshot`, `computedStyles`, `compareToReference` + `answer()` (POSTs `/screenshot` or `/reply` by request id).
  `useProjectEvents` listens for the `screenshot` / `computed` / `compare` SSE events and calls `engine.replyHost()`; no engine yet = error reply.
- `canvas/edit.ts`: `CanvasEditor` (plain class, gets an `EditHost` from the engine): 8 resize handles (`.dc-handle` inside the selection box; boards
  all 8, absolute nodes 8, flowing nodes e/s/se, locked none), drag boards by label, drag absolute nodes (under 3 px = click), dblclick text edit
  (contenteditable plaintext-only), Delete, Escape (up one level), Ctrl+Z/Y, Ctrl+C/V/D, image paste/drop as a reference board.
  Previews write straight to the element; the server doc event replaces them on release. Changes go out through `canvasAction`; errors become toasts.
- Frame tool in the floating toolbar = "new artboard" until Phase 7 wires real tools (`engine.createArtboard()`).
- Fixed a Phase 3 bug: `fit()` on a viewport with no size gave a NEGATIVE zoom; it now waits (`fitPending`) for the ResizeObserver.
- Verified on a scratch server (3790, project purged afterwards): select, drag, SE resize, text edit, undo, duplicate, copy/paste, delete all
  persisted correctly; MCP `get_screenshot` (args `artboard_id`) and `get_computed_styles` (`node_ids`, `props`) answered by the new app.
  NOT clicked through: `compare_to_reference` (code is a straight port), reference drop/paste, label drag of boards, Layers-driven selection.
- Testing tip: the browser pane's screenshot frame is scaled vs `innerWidth`; compute click coordinates from `getBoundingClientRect() * 800 / innerWidth`.
