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
- [ ] **Phase 4 - Canvas editing.** Selection, resize handles, drag-move absolute nodes, in-place text edit, copy/paste, undo/redo,
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
- **Open idea (user, 2026-10-20): Paper stays smooth and lets you select elements even when zoomed far out.** Not researched yet (own session).
  Our gap: below `LIVE_K` boards are plain bitmaps, so there is no hit-testing. Likely fix: keep a cheap per-board rect index (node id, box, depth)
  extracted when a snapshot is built, hit-test against it for hover/select at any zoom, and later tile/GPU-draw. Investigate how Paper does it first.
