# UI system: "Atelier" (chrome tokens, components, patterns)

How the React chrome is built after the 2026-10 luxury redesign (done; the plan was collapsed into `luxury-redesign-plan.md`). Tokens live in `web/src/styles/globals.css`, all OKLCH.

## Colour roles (never mixed)
- **Warm obsidian (dark, flagship) / bone paper (light)** neutrals, hue ~70 at chroma 0.003-0.01. Surfaces step back to front: `--canvas` < `--background` (panels) < `--field` (inputs, segmented tracks; `--field-hover`) < `--popover`.
- **Signal blue** `--selection` / `--selection-soft`: selection, active tool, active tab badge, focus rings, Follow. Blue used as TEXT must be `text-selection-ink` (`--selection-ink`): the fill blue is only 3.3:1 on light surfaces.
- **Champagne** `--brand` / `--brand-ink` (`bg-brand`, Button `variant="brand"`): brand moments only (logo mark, the ONE primary button per area, live glow). Never for state.
- **Agent colours**: `--dc-glow-*` in `canvas.css` plus each agent's own colour; agent activity only.
- Destructive text/tints are `--destructive` (dark value lifted to 0.75 so it passes 4.5:1 on its own 20% tint).

## Type
Inter Variable for all UI (12px base, 11px meta, 13px section titles, `tnum` for numbers). `font-display` = Bricolage Grotesque 500 (`@fontsource/bricolage-grotesque/500.css`) for TITLES ONLY: home hero (64px, `HomeTopBar` + hero + card grid, no sidebar), project card titles, dialog titles, empty-state titles; tight tracking (-0.03em). No serif. Labels are sentence case, never all-caps, no middle-dot meta strings.

## Elevation and material
Three levels: flat (panels, no shadow), `shadow-float` (toolbar, pills; `--elevation-float`), `shadow-overlay` (menus, tooltips, toasts, dialogs; `--elevation-overlay`). `.material` = translucent blurred surface for floating things; under `prefers-reduced-transparency` it goes solid, and one global rule also removes every `backdrop-blur-*` (dialog scrims, home badge).
Concentric radii: inner + padding = outer (toolbar buttons 8 + 4 = 12; card cover 8 + 4 = 12; dialogs 18). Images, covers and swatches get a pure black/white 10% outline.

## Components (shadcn Base UI first, library second, custom last)
- Button sizes `24` / `28` / `32` plus old names; variants incl. `brand`. `ButtonGroup` for zoom and align bars.
- `ui/Tip.tsx` (`<Tip label keys side>`) wraps every icon button instead of `title=`; one `TooltipProvider` (delay 400) in `main.tsx`; keep `aria-label`.
- `Section` (`panels/inspector/controls.tsx`) is the ONE panel section: shadcn `Collapsible`, title row 13px/600 with chevron, optional trailing action, 12px body with `gap-2`, hairline below, no open/close animation. Used by the Inspector, Agents (Working here, Call log), Theme, Tokens, Memory, MCP and Efficiency. Panel bodies are bare Sections (no outer padding).
- `Empty` (shadcn) for every empty state: icon media, `font-display` title, one-line description (layers, comments, agents, theme, tokens, home, comments page).
- Dialogs: `components/ui/dialog.tsx` / `alert-dialog.tsx` own overlay elevation, 18px radius, `font-display` title; primary = brand button. Delete page = `panels/DeletePageDialog.tsx`.
- Toasts: `toast(message, actionLabel?, onAction?)` from `store/toast.ts` (sonner adapter, one at a time, 72px above bottom). `CanvasEditor.undoToast` shows Deleted / Pasted / Ungrouped with Undo.
- Kept custom on purpose: `ui/ColorField.tsx` (OKLCH), `ui/NumberField.tsx` (scrub, expressions, Mixed), `ui/FontField.tsx`.
- Right panel = `Tabs` segmented control Design / Comments / Agents; `useUi.panelView` (`history` | `styles`) swaps in a secondary view from `shell/PanelViews.tsx` (History from Agents + main menu; Styles from the Design page view). `setPanelTab` clears the view; clicking the already-active tab does too (Shell.tsx `onClick`).
- Top bar: 3-column grid (logo menu + breadcrumb | agent chips + status | zoom, Follow, ONE brand Export, panel toggle). Toolbar: 6 slots, Move/Hand and Shapes are `SplitSlot` split buttons.
- List rows (Pages, Layers): 28px, inset `mx-1.5 rounded-md`, selected = `bg-selection-soft`. Page rows show a hover trash button when more than one page exists.

## Action registry (`web/src/lib/actions.ts`, tested)
ONE list of actions (`buildActions(ctx)`: tools, edit, structure, view, panels, export, project, help, plus a row per page and board). `keys` are display data only; real handlers stay in `canvas/edit.ts` and `Shell.tsx`, so changing a key means changing both. `shell/useActions.ts` binds it; readers are `CommandPalette.tsx` (Ctrl/Cmd+K, shadcn `command`), the main menu, `ShortcutsDialog.tsx` and context-menu hints. New action: add it in `buildActions`. The palette Image action re-fires the `i` key (the file input lives in the toolbar).

## Motion and accessibility
Motion rules are in CLAUDE.md. Reduced motion: `.ctx-menu`/`.sk`/`.agent-pulse` and every shadcn `data-open`/`data-closed` animation are switched off in `globals.css`. Contrast (checked in both themes with a scripted audit of all panels, menus, dialogs, home, comments): text 4.5:1, focus rings `ring-ring/90` (3:1). Tab order follows visual order; Esc closes every overlay; icon buttons show their tooltip on keyboard focus.

## Gotchas
- `pointer-hover:` custom variant already contains `&:hover` on the element itself, so `pointer-hover:group-hover:...` never matches. For reveal-on-row-hover use `[@media(hover:hover)_and_(pointer:fine)]:group-hover/name:opacity-100` (this hid the page trash and layer action buttons until Phase 6).
- Tailwind v4 `scale-*` / `translate-*` set the `scale` / `translate` properties, not `transform`: name those in `transition-[...]`.
- `applyTheme` (store/ui.ts) disables transitions for the flip with `.theme-switching` and clears it with a timeout, not rAF (rAF never fires in background tabs).
- Headless pane screenshots lag one action behind and can catch a theme transition half way; retake after 2 s. Synthetic key events miss some Base UI handlers: use real key presses for Esc/Tab checks.
- Agents filters use shadcn `select` (`AgentSelect`, "all" sentinel because Base UI has no empty value) and `checkbox`; a native control is a gap.
