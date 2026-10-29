# UI system (chrome tokens and patterns)

Visual language of the React chrome, set in the 2026-10-24 UI upgrade. Tokens live in `web/src/styles/globals.css`.

## Direction
Warm obsidian (dark, flagship) / bone paper (light) chrome that recedes so the canvas and agent activity carry the colour. Chromatic colours:
- **Signal blue** `--selection` (+ `--selection-soft`): selection, active tool, active tab badge, focus rings, the Follow toggle.
- **Champagne** `--brand` / `--brand-ink` (`bg-brand`, Button `variant="brand"`): brand moments only (logo, the one primary button per area, live glow). Never for state.
- **Claude violet/blue** (`--dc-glow-*` in `canvas.css`, plus each agent's own colour): agent activity only.

## Tokens (light + dark, all OKLCH, neutrals tinted warm hue ~70 "Atelier", Phase 1 of `luxury-redesign-plan.md`)
- Surfaces step back to front: `--canvas` < `--background` (panels) < `--field` (inputs) < `--popover`.
- `--field` / `--field-hover`: filled inspector/search fields, no border at rest, `ring-1 ring-selection` on focus.
- `--material` / `--material-edge` + `.material` class: translucent blurred floating surface (toolbar, live pills). Falls back to solid under `prefers-reduced-transparency`.
- `--elevation-float` (`shadow-float`): toolbar, pills. `--elevation-overlay` (`shadow-overlay`): menus, tooltips, toasts, dialogs. Panels are flat (no shadow).
- Fonts: Inter Variable for UI; `font-display` = Bricolage Grotesque 500 (`@fontsource/bricolage-grotesque/500.css`) for titles only (home hero, card titles, empty states), tight tracking. No serif.
- Tailwind colours: `bg-brand`, `text-brand-ink`, `bg-field`, `bg-field-hover`, `bg-selection`, `bg-selection-soft`, `text-selection`, `bg-canvas`.

## Patterns
- `pointer-hover:` custom variant = hover only on a fine pointer (project motion rule). Use it instead of the long media-query arbitrary variant.
- List rows (Pages, Layers) are inset (`mx-1.5 rounded-md`) so selection reads as a pill.
- Top bar (Phase 2) is a 3-column grid: left = champagne logo mark (main menu: Projects, Connect agents, History, Rulers, Theme, Keyboard shortcuts; no Settings screen exists yet) + layers toggle + breadcrumb; centre = agent chips + status; right = zoom `ButtonGroup`, Follow, the ONE brand `Export` button (`openExport`, works with or without a selection), panel toggle.
- Right panel = shadcn `Tabs` as a segmented control: Design, Comments, Agents. `useUi.panelView` (`history` | `styles`, `openView` / `closeView`) swaps in a secondary view from `shell/PanelViews.tsx`: History (Activity + Versions) from the Agents tab and the main menu; Styles (Theme + Tokens and memory) from the button in the Design page view. MCP is a collapsed section at the bottom of Agents. `setPanelTab` always clears the view.
- Floating toolbar = 6 slots: Move/Hand and Shapes (Rectangle, Ellipse, Line, Pen) are split buttons (`SplitSlot`: main button = last used, chevron opens a dropdown-menu list with keys), then Frame, Text, Image, Comment. Single-letter shortcuts unchanged; active tool is solid `bg-selection`.
- Concentric radii: outer = inner + padding (toolbar 8px buttons + 4px pad = 12px; project card 8px cover + 4px = 12px).
- Images/covers/swatches get a pure black/white 10% outline (`outline-black/10 dark:outline-white/10`), never a tinted one.

- Inspector `Section` (`panels/inspector/controls.tsx`) is the one section component: shadcn `Collapsible` + title row (13px/600, chevron) + optional trailing action, 12px body, hairline below, `gap-2`. No open/close animation (frequent action). Pages and Layers rows: 28px, 12px text, Lucide 14px at 1.5 stroke, selected = `bg-selection-soft`, hover `pointer-hover:`.
- Empty states use shadcn `Empty` (icon media, `font-display` title, description): no layers, no comments, nothing selected. Labels sentence case, no middle-dot meta strings.
- Light theme was re-checked in Phase 3 (top bar, main menu, shortcuts dialog, panels, inspector): no fixes needed. Headless pane screenshots can catch a theme transition half way; wait 2 s and retake.

## Action registry and command palette (Phase 4)
- `web/src/lib/actions.ts` (pure, `test/actions.test.mjs`) is the ONE list of actions: `buildActions(ctx)` returns `{id, label, group, keys, keywords, run, enabled}` for tools, edit, structure, view, panels, export, project, help, plus one action per page and per board of the active page. `keys` are display data only ('mod+shift+e'; `formatKeys` gives Ctrl/Shift or the Mac glyphs); real key handlers stay in `canvas/edit.ts` and `Shell.tsx`, so changing a key means changing it in both places. `TOOL_DEFS` (id, label, key) is shared with the toolbar; icons stay in Shell.tsx. `GESTURES` holds the mouse rows of the shortcuts dialog.
- `shell/useActions.ts` binds the registry to the engine and stores. Readers: `shell/CommandPalette.tsx` (Ctrl/Cmd+K, shadcn `command` in a dialog, substring match instead of cmdk's fuzzy, disabled actions greyed), main menu (`MainMenu` in Shell.tsx), `ShortcutsDialog.tsx` (rows generated by `shortcutRows`) and the canvas context-menu hints. Add a new action in `buildActions` and it shows up everywhere.
- Undo toasts: `CanvasEditor.undoToast` (edit.ts) shows "Deleted", "Pasted" and "Ungrouped" with an Undo button (server undo, same as Ctrl+Z). A cut says "Cut" only.
- The palette Image action re-fires the `i` key because the file input belongs to the toolbar. Zoom in/out have no keyboard shortcut (the old Fit tooltip claimed Shift+1; that never existed and was removed).

## Primitives (Phase 1)
- shadcn added: tooltip, kbd, button-group, toggle(-group), collapsible, popover, sonner, empty, separator, scroll-area (all in `web/src/components/ui`).
- Button sizes `24` / `28` / `32` (by pixel) plus the old names; `variant="brand"` is champagne.
- Tooltips: wrap an icon button in `ui/Tip.tsx` (`<Tip label keys side>`) instead of `title=`; one `TooltipProvider` (delay 400) in `main.tsx`. Keep `aria-label` on the button. Field labels that name a CSS property still use native `title` (Phase 3 revisits).
- Toasts: `toast(message, actionLabel?, onAction?)` from `store/toast.ts` is now a thin sonner adapter (one toast at a time, id `dc-toast`); `components/ui/sonner.tsx` mounts it with the bottom 72px offset and reads the theme from the ui store.

## Gotchas
- Tailwind v4 `scale-*` / `translate-*` set the `scale` / `translate` properties, not `transform`: name those in `transition-[...]` or the motion snaps.
- `applyTheme` (store/ui.ts) disables transitions for the flip with `.theme-switching` and clears it with a timeout, not rAF (rAF never fires in background tabs, which left transitions off for good).
- The toast sits 72px (`bottom-18`) above the bottom to clear the canvas toolbar; sonner does not render its list until the first toast.
