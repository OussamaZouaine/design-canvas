# UI system (chrome tokens and patterns)

Visual language of the React chrome, set in the 2026-10-24 UI upgrade. Tokens live in `web/src/styles/globals.css`.

## Direction
Graphite chrome that recedes so the canvas and agent activity carry the colour. Two chromatic colours only:
- **Signal blue** `--selection` (+ `--selection-soft`): selection, active tool, active tab badge, focus rings, the Follow toggle.
- **Claude violet/blue** (`--dc-glow-*` in `canvas.css`, plus each agent's own colour): agent activity only.

## Tokens (light + dark, all OKLCH, neutrals tinted hue 265)
- Surfaces step back to front: `--canvas` < `--background` (panels) < `--field` (inputs) < `--popover`.
- `--field` / `--field-hover`: filled inspector/search fields, no border at rest, `ring-1 ring-selection` on focus.
- `--material` / `--material-edge` + `.material` class: translucent blurred floating surface (toolbar, live pills). Falls back to solid under `prefers-reduced-transparency`.
- `--elevation-float` (Tailwind `shadow-float`): layered contact + ambient shadow for anything floating or lifted.
- Tailwind colours: `bg-field`, `bg-field-hover`, `bg-selection`, `bg-selection-soft`, `text-selection`, `bg-canvas`.

## Patterns
- `pointer-hover:` custom variant = hover only on a fine pointer (project motion rule). Use it instead of the long media-query arbitrary variant.
- List rows (Pages, Layers) are inset (`mx-1.5 rounded-md`) so selection reads as a pill.
- Right panel tabs are one row of icon tabs (label in `title`/`aria-label`); top bar groups: breadcrumb | agents + status | view controls | theme + panel.
- Floating toolbar: tools grouped navigate / draw / content / review with hairlines; active tool is solid `bg-selection`.
- Concentric radii: outer = inner + padding (toolbar 8px buttons + 4px pad = 12px; project card 8px cover + 4px = 12px).
- Images/covers/swatches get a pure black/white 10% outline (`outline-black/10 dark:outline-white/10`), never a tinted one.

## Gotchas
- Tailwind v4 `scale-*` / `translate-*` set the `scale` / `translate` properties, not `transform`: name those in `transition-[...]` or the motion snaps.
- `applyTheme` (store/ui.ts) disables transitions for the flip with `.theme-switching` and clears it with a timeout, not rAF (rAF never fires in background tabs, which left transitions off for good).
- The toast sits at `bottom-18` to clear the canvas toolbar.
