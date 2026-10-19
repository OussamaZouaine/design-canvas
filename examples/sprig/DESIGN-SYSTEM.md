# Sprig-style design system

Reverse-read from a single Home screenshot. Source of truth is `ds.mjs` (tokens + components);
`build.mjs` pushes the system and six pages onto the canvas through the MCP endpoint.
Run it with the canvas server up: `node build.mjs` (it clears the canvas first).

## Principles
- Calm and content-first: warm neutrals, near-black primary, hairline borders instead of shadows.
- One soft lavender, used only for AI surfaces. Yellow / mint / lavender tiles carry personality.
- Weight 500 for headings (never bold), 400 for body.

## Colour
| Token | Hex | Use |
|---|---|---|
| surface | #FFFFFF | page, cards |
| sidebar | #FAF9F7 | sidebar, table header |
| line / lineStrong | #ECEAE6 / #DAD7D2 | borders, toggle off |
| ink / ink2 / ink3 | #1F1F1F / #5F5E5B / #8E8D89 | text, descriptions, placeholders |
| navActive | #E9E7E4 | selected nav row |
| primary | #2A2A2A | buttons, toggle on |
| aiBg / aiBorder / accent | #F7F2FC / #EBE1F6 / #5B3FD0 | AI banner |
| accentSoft / yellow / mint / orange | #A59CE0 / #FBD95A / #D6F5EE / #FBB62E | illustration tiles, chat bubble |
| success / warn / danger / info | #1E9E6A / #B87400 / #D64545 / #3B6FE0 | status (tinted bg for pills) |

## Type (Inter, fallback Segoe UI / system-ui)
Display 36/44 · Page title 28/36 · Section/Card title 18/26 · Body 15/22 · Label 13/18 (500) · Caption 12/16

## Space, radius, elevation
- 4px grid: 4 8 12 16 20 24 32 40 48. Page padding 32 top / 40 sides. Sidebar 240 wide.
- Radius: 6 chips · 8 buttons/inputs/nav · 12 tiles · 16 cards/tables · 24 AI banner · pill badges
- Elevation: flat (border only) / popover `0 8px 24px rgba(31,31,31,.12)` / modal `0 24px 64px rgba(31,31,31,.20)`

## Components
Button (primary, secondary, ghost, danger; 40px) · Input (40px) · Toggle · Badge (22px pill) · Avatar ·
Tabs (underline) · Nav item (40px, 20px icon) · Card · Table (60px rows) · Step card (tile + numbered title) ·
AI banner + suggestion chips · KPI card · Integration card · Template card.

## Pages generated
Home, Studies, Dashboards, Users, Create a study, Integrations.
Second batch (`build-more.mjs`, stored as OKLCH): Behavior, Events, Attributes, Study results, Settings, Upgrade.

## Expanded system (build-system.mjs + sheets2.mjs)
Eight sheets, each built per theme (the theme-token sheet is built once and shows both):
Buttons & actions · Forms · Feedback & overlays · Navigation · Data display · States & edge cases · Icons · Theme & tokens.
They cover: all button kinds/sizes/states, 8 field states, selection controls, date/file/OTP inputs, alerts/banners/toasts,
progress and skeletons, menus/tooltips/popovers, dialogs/drawers/command palette, breadcrumbs/tabs/pagination/steppers,
sidebar + rail + top bar, tables (selection, sorting, empty, loading), cards, tags/badges/avatars, charts, empty/error/permission
states, text overflow, RTL, numbers, responsive behaviour and a 60-icon set.

## Dark mode
`THEME=dark node build.mjs && THEME=dark node build-more.mjs && THEME=dark node build-system.mjs`
Dark artboards sit 6600px below the light ones with a " · Dark" suffix. Components read colour roles from `ds.mjs`
(`LIGHT` / `DARK` palettes), never raw values. Dark keeps the warm neutral hue (~80 in OKLCH), inverts the primary action
and lifts accents for contrast.

## Known accessibility gaps (from the computed contrast table)
- Light theme: status text on its tint (success, warning, danger, info) is 3.0 to 4.0:1: fine for large text, below AA for 12px badges.
  Suggested fix: add darker `*Ink` tokens for small status text.
- Tertiary text (`ink3`) is 3.3:1 on white: use for placeholders/disabled only.

## Data table density
`node build-density.mjs` (and `THEME=dark node build-density.mjs`) adds "DS · Data table density" at the end of the system row. Compact 36px / Comfortable 48px / Spacious 64px rows; only row height, padding, gap, type size and avatar size change. The sheet covers cell types, row states (hover, selected, focus, disabled, grouped, zebra) and skeletons per density.
