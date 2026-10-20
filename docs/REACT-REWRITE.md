# React rewrite plan (public/ -> web/)

Decided 2026-10-20 with the user. Read `CLAUDE.md` and `PROGRESS.md` first, then this file.
**Each phase is one session.** At the end of a phase: run `pnpm test`, tick the phase below, add notes under "Phase log",
update `PROGRESS.md`, commit. A new session continues from the first unticked phase.

## Decisions (do not re-ask)
- **Stack:** React 19.x (latest), Vite 8, `@vitejs/plugin-react` 6 + **React Compiler** (`babel-plugin-react-compiler` 1.x,
  enabled in the Vite config; no manual `useMemo`/`useCallback`), TypeScript, Zustand for shared state (store is selector-based, works with the
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
  src/main.tsx            router: /, /p/:id, /comments
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
- [ ] **Phase 1 - Data layer + shell.** Typed API client, SSE hook (doc delta refill from previous doc, `html: null` = unchanged,
  active-project claim via `/activate`), zustand stores, router, app chrome (top bar, left rail, right panel frames, floating toolbar skeleton),
  shadcn components restyled for the Figma-like density, plus our NumberField/ColorField, dark/light theme. Done = project page shows live artboard names + status pill.
- [ ] **Phase 2 - Home and Comments pages.** Port `home.js` + `comments.js` (cards with live previews, search/sort, trash, import/export,
  all-comments page with filters, deep link `?comment=`). Easiest full pages, proves the data layer. Done = parity with `/` and `/comments`.
- [ ] **Phase 3 - Canvas engine core.** Port from `public/app.js`: world transform pan/zoom/fit, shadow-DOM frames, `pidIndex`,
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
