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
- Right panel tabs are one row of icon tabs (label in a `Tip` and `aria-label`); top bar groups: breadcrumb | agents + status | view controls | theme + panel.
- Floating toolbar: tools grouped navigate / draw / content / review with hairlines; active tool is solid `bg-selection`.
- Concentric radii: outer = inner + padding (toolbar 8px buttons + 4px pad = 12px; project card 8px cover + 4px = 12px).
- Images/covers/swatches get a pure black/white 10% outline (`outline-black/10 dark:outline-white/10`), never a tinted one.

## Primitives (Phase 1)
- shadcn added: tooltip, kbd, button-group, toggle(-group), collapsible, popover, sonner, empty, separator, scroll-area (all in `web/src/components/ui`).
- Button sizes `24` / `28` / `32` (by pixel) plus the old names; `variant="brand"` is champagne.
- Tooltips: wrap an icon button in `ui/Tip.tsx` (`<Tip label keys side>`) instead of `title=`; one `TooltipProvider` (delay 400) in `main.tsx`. Keep `aria-label` on the button. Field labels that name a CSS property still use native `title` (Phase 3 revisits).
- Toasts: `toast(message, actionLabel?, onAction?)` from `store/toast.ts` is now a thin sonner adapter (one toast at a time, id `dc-toast`); `components/ui/sonner.tsx` mounts it with the bottom 72px offset and reads the theme from the ui store.

## Gotchas
- Tailwind v4 `scale-*` / `translate-*` set the `scale` / `translate` properties, not `transform`: name those in `transition-[...]` or the motion snaps.
- `applyTheme` (store/ui.ts) disables transitions for the flip with `.theme-switching` and clears it with a timeout, not rAF (rAF never fires in background tabs, which left transitions off for good).
- The toast sits 72px (`bottom-18`) above the bottom to clear the canvas toolbar; sonner does not render its list until the first toast.
