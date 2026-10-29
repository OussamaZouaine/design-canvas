# Luxury redesign plan (UI/UX + design system)

Status: Phase 0 mock BUILT 2026-10-29 in Design Canvas project "Design Canvas UI" (p_5f9fde61, boards named "Atelier · ..." at y=1800 / 2800: Foundations, Editor Dark/Light, Components Dark/Light, Home Dark; Atelier tokens set there, light base + dark mode). Mock APPROVED by the user 2026-10-29 (display font Bricolage Grotesque 500 for titles, Inter for UI, icons added). Phase 1 DONE 2026-10-29 (tokens, Bricolage, shadcn primitives, Button brand + 24/28/32, `Tip` tooltips on icon buttons, sonner); Phase 2 (editor shell) DONE 2026-10-29; Phase 3 is next; the orchestrator runs one phase per session, one at a time, same branch. One phase per session, in order.

## Goal
A calm, premium editor in the Figma / Paper / Linear family: the canvas is the hero, the chrome is quiet, and every action is
obvious (a visible label or a styled tooltip with its shortcut, one clear primary action per area, nothing hidden behind a guess).

## What is unclear today (from `web/src/shell/Shell.tsx`, `docs/notes/ui-system.md`)
1. Right panel: 8 icon-only tabs (Design, Comments, Activity, Versions, Theme, Tokens, Agents, MCP). Names only in `title`; users must hover to learn them.
2. Top bar: 12 equal-weight icon buttons, no primary action, no main menu. Connect, Shortcuts, Theme sit next to Zoom as if they were as frequent.
3. Toolbar: 10 flat tools; Rectangle / Ellipse / Line / Pen are four slots for one idea ("draw a shape").
4. Tooltips are native `title` (delayed, unstyled, no shortcut chip). Feels cheap and slow.
5. No command palette, so features you cannot see you cannot find.
6. Look: cool graphite (hue 265) + Inter at 12px reads "competent tool", not "luxury". No brand moment anywhere.

## Design direction: "Atelier"
Quiet, warm, precise. Luxury comes from restraint, material and detail, not from gold everywhere.
- **Warm obsidian neutrals.** Shift neutrals from cool hue 265 to warm hue ~70 at very low chroma (0.003-0.008): reads as stone/paper instead of steel.
  Dark theme becomes the flagship (obsidian canvas, smoked-glass panels); light theme is "bone paper".
- **Two chromatic roles, never mixed** (keeps the existing rule):
  - Signal blue `--selection`: selection, active tool, focus. Stays blue: it is the Figma convention, so it is instantly understood.
  - Champagne `--brand` (new, about `oklch(0.80 0.07 80)`): brand moments only, never for state. Logo mark, the single primary
    button per screen, the "Claude is designing" glow, home hero. Max one champagne element visible per area.
  - Agent colours stay per agent (`--dc-glow-*`).
- **Material.** Panels are solid; floating things (toolbar, popovers, pills, palette) are smoked glass (`.material`) with a 1px inner top highlight
  and a hairline outer edge. Three elevation levels only: `flat` (panels), `float` (toolbar, pills), `overlay` (menus, dialogs, palette).
- **Type.** Inter Variable stays for UI (12px base, 11px meta, 13px panel titles, tabular numbers). NO serif (user rejected Instrument Serif, 2026-10-29). Titles (home hero, card titles, empty states)
  use Bricolage Grotesque 500 (Google Font, tight tracking -0.03em to -0.04em) on trial in the mock; UI text stays Inter. Needs `@fontsource/bricolage-grotesque` in Phase 1 if approved.
- **Detail.** 4px grid; concentric radii (6 inner / 10 control groups / 14 floating shells / 18 dialogs); hairlines at 6-8% alpha; icons lucide at
  1.5 stroke, 16px; motion uses the existing curves, 150 ms for state, 220 ms for enter, no animation on frequent actions (CLAUDE.md motion rules).

## Design system (tokens + components)
Tokens live in `web/src/styles/globals.css` (OKLCH only). New or changed:
| Token | Light | Dark | Use |
|---|---|---|---|
| `--canvas` | `oklch(0.955 0.004 75)` | `oklch(0.145 0.004 70)` | infinite canvas |
| `--background` | `oklch(0.99 0.003 80)` | `oklch(0.185 0.005 70)` | panels |
| `--field` | `oklch(0.955 0.005 75)` | `oklch(0.225 0.006 70)` | inputs, segmented controls |
| `--foreground` | `oklch(0.2 0.008 60)` | `oklch(0.95 0.006 80)` | text |
| `--muted-foreground` | `oklch(0.5 0.01 60)` | `oklch(0.72 0.01 70)` | meta text (AA checked) |
| `--brand` / `--brand-ink` | `oklch(0.72 0.09 75)` / `oklch(0.25 0.04 70)` | `oklch(0.82 0.07 82)` / `oklch(0.2 0.02 70)` | primary button, logo, live glow |
| `--elevation-overlay` | new | new | menus, dialogs, palette |
Exact values get tuned on the Phase 0 boards and contrast-checked (4.5:1 text, 3:1 icons/borders that carry meaning).

**Rule (user, 2026-10-29): shadcn first, then a well-maintained library, custom code last.** If shadcn has the component, add it with
`pnpm dlx shadcn@latest add <name>` (style `base-mira`, Base UI) and restyle it through tokens / its file in `web/src/components/ui`; never write our own
version. If shadcn lacks it but a maintained library does the job, use the library. Only canvas-specific behaviour stays custom.

Components, mapped to their source:
| Need | Use | Notes |
|---|---|---|
| Buttons (primary champagne, secondary, ghost, destructive; 24/28/32) | shadcn `button` (have) | add a `primary`/`brand` variant + sizes in its cva |
| Icon button + tooltip with shortcut (replaces every `title=`) | shadcn `tooltip` + `button` | Base UI tooltip provider gives the "instant after first" delay |
| Shortcut chip | shadcn `kbd` | platform-aware label is a tiny helper |
| Grouped buttons (zoom, align bar) | shadcn `button-group` | |
| Panel tabs, Fixed/Hug/Fill, toggles | shadcn `tabs` (have) / `toggle-group` | |
| Inspector section header + collapse | shadcn `collapsible` | thin wrapper only for the title row + `+` action |
| Menus, context menu, main menu | shadcn `dropdown-menu` (have), `context-menu`, `menubar` | replace `shell/ContextMenu.tsx` if feature parity holds |
| Shapes split button | shadcn `button-group` + `dropdown-menu` | |
| Dialogs, popovers | shadcn `dialog` (have), `popover` | |
| Command palette (Ctrl/Cmd+K) | shadcn `command` (built on `cmdk`) | only the action registry is ours |
| Toasts with Undo | shadcn `sonner` (`sonner` lib) | replaces `ui/Toaster.tsx`; keep `bottom-18` offset |
| Empty states | shadcn `empty` | serif title via a class |
| Scroll areas, separators, inputs, selects | shadcn `scroll-area`, `separator`, `input` (have), `select` (have) | |
| Colour picker | keep `ui/ColorField.tsx` (OKLCH; libraries are hex/rgb-first) | custom on purpose |
| Number scrub field | keep `ui/NumberField.tsx` (expressions, Mixed, scrub) | custom on purpose |
All restyling is tokens + each component's own file: overlay elevation, 14px radius, 32px menu rows, right-aligned `kbd`.

## UX changes (Figma-like, intuitive)
1. **Top bar = three zones.** Left: logo menu (main menu: Projects, Connect agents, Keyboard shortcuts, Theme, Settings) + breadcrumb.
   Centre: agents + status. Right: zoom group, Follow, then one **primary button "Export"**, then panel toggle. Rarely used icons leave the bar.
2. **Right panel = 3 labelled tabs** in a SegmentedControl: **Design · Comments · Agents**. The rest moves:
   Activity + Versions -> one "History" view opened from the Agents tab and the main menu; Theme + Tokens + Memory -> "Styles" view reachable from the
   page view of Design (like Figma's local styles); MCP -> inside Agents.
3. **Toolbar = 6 slots:** Move/Hand, Frame, Shapes (split button: Rectangle, Ellipse, Line, Pen; remembers the last one), Text, Image, Comment.
   Tooltip shows name + key; shortcuts unchanged.
4. **Command palette (Ctrl/Cmd+K):** search every action, tool, panel, page and board; shows shortcuts. One registry used by the palette, the
   menus and `ShortcutsDialog.tsx`, so they never drift.
5. **Feedback for every action:** toast with Undo for destructive or invisible actions (delete, paste, ungroup); pressed state 0.96 scale;
   focus rings on everything keyboard-reachable.
6. **Home page:** serif hero, project cards with larger covers and one "New project" primary button; empty state for first run.

## Phases (one session each; pick in order)
0. **Mock on the canvas (no code).** New project "Design Canvas UI" on Design Canvas itself: token board (light + dark), component sheet
   (buttons, tooltip, kbd, segmented, section, menu), editor screen light + dark, home screen. **User approves or comments before Phase 1.** ~1 h.
1. **Tokens + primitives.** Swap tokens in `globals.css` (keep names so existing classes keep working), add `--brand`, `--elevation-overlay`;
   `shadcn add` tooltip, kbd, button-group, toggle-group, collapsible, popover, sonner, empty, separator, scroll-area; Button variants.
   Replace `title=` usages and `ui/Toaster.tsx`. ~1.5 h.
2. **Editor shell.** Top bar zones + main menu + Export primary; right panel 3 tabs + moved views; toolbar Shapes split button
   (`web/src/shell/Shell.tsx`, `web/src/store/ui.ts` `PanelTab`). ~2 h.
3. **Inspector + left panel polish.** Section component across `panels/inspector/*`, Pages/Layers rows, empty states. ~1.5 h.
4. **Command palette + action registry.** shadcn `command` for the UI; new `web/src/lib/actions.ts` (pure, tested) feeding palette, menus, ShortcutsDialog. ~2 h.
5. **Home, dialogs, comments page.** Serif + cards + Connect agents dialog restyle. ~1.5 h.
6. **Verify + document.** Both themes, reduced motion / transparency, contrast, keyboard-only pass, screenshots; rewrite `docs/notes/ui-system.md`. ~1 h.

## Open decisions (defaults used unless the user says otherwise)
- Accent: champagne (default) vs no accent (pure monochrome luxury).
- Display font: DECIDED, Bricolage Grotesque 500 for titles, Inter for UI, no serif (user confirmed 2026-10-29). Hallmark rules also apply to the mock: labels are sentence case, untracked, no all-caps; no middle-dot meta strings.
- Default theme for new users: dark (default) vs follow system.
