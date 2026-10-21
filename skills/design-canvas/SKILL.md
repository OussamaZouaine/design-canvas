---
name: design-canvas
description: Design screens and design systems on the local Design Canvas (MCP server design-canvas). Use when asked to design, mock up, restyle or review UI, or to work from comments the user pinned on the canvas.
---

# Designing on the Design Canvas

The canvas server must be running (`pnpm start`, http://localhost:3777). Claude writes HTML
artboards; the user watches them appear live and can pin comments on elements.

The process and taste rules live in the MCP itself (`get_guide`), so every client gets them. This skill is the short
Claude Code version: it tells you the order and which guide topic to load at each step. If the two ever disagree, the
`get_guide` text wins (it is the one that is tested).

## Step 0: load the guide (always first)

Call `get_guide({topic: "start"})`, then load the topic for the step you are on: `brief` before a new design, `type` and
`layout` before the first write, `review` before the first screenshot, `mobile` for phone screens. Load a topic once per
session; they are small on purpose.

## Workflow (one task per session keeps token cost down)

1. **Orient.** `list_projects` (reuse a matching project, else `create_project`), `log_prompt`,
   `get_comments` and `get_changes` (what the user pinned or edited by hand), `get_basic_info`.
2. **Brief (new designs only, before any write).** Follow topic `brief`: three candidate moods, pick one that is not
   your first instinct, palette taken from a physical scene with a role per colour, a type ladder, a register, one
   sentence of direction. Post it in chat, then pass it as `log_prompt.brief` so later sessions inherit the intent.
   Skip it only when the project already has tokens or a brief: then reuse them.
3. **Tokens and components.** `get_design_system`: if the project has tokens, use `var(--color-primary)`,
   `var(--space-4)` etc. instead of raw values. With none and a new design system wanted, `set_tokens` with preset
   `starter`, then `create_foundations`. Compose screens from `insert_component` (with `slots`) rather than writing
   buttons, cards and inputs by hand; create missing ones with `set_component` and `create_components_sheet`.
4. **Read cheaply.** `get_tree` first (one line per node). `get_node_info` only on the node you will change.
5. **Build one visual group at a time** (header, hero, card row), not a whole page per call. `create_artboard`, then
   `write_html`. Repeat blocks with `<x-clone node-id="N5"></x-clone>`. Refine with `update_styles` /
   `set_text_content`, never a rewrite.
6. **Review after every group** (topic `review`): one `get_screenshot` (crop with `node_id`), then ONE line of verdict
   per checkpoint: spacing, typography, contrast, alignment, artboard fit, repetition. Fix what fails with a targeted
   edit on the parent id and continue. `lint` is the cheap text check before the screenshot. Stop after 3 fix rounds
   per section.
7. **Fit, never rebuild.** Boards grow with their content by default (`height_mode: fit`). A `layout` line in a write
   result, or `check_layout`, means something does not fit: use `fit_artboard` or narrower widths. Never delete and
   recreate a board for an overflow (it orphans comments).
8. **Finish.** `reply_comment` + `resolve_comment` for each comment handled, then `finish_working` (it refuses while
   content is clipped). A bad change can be reverted with `undo`.

## Rebuilding from a screenshot

`add_reference_image` (absolute path) puts the picture on a locked board. Build your own artboard at the same width next to it,
then loop: `compare_to_reference` -> fix the worst areas it lists (and look at the diff image) -> compare again. Stop after 3
rounds or when different is under about 5%. The user can also paste or drop an image on the canvas to add a reference.

## Hard rules (the full list is in the guide)

- **Colour:** OKLCH only, `oklch(L C H)`. Text contrast at least 4.5:1 (3:1 for 24px+ or 18.66px+ bold). Status text uses
  the darker `*Ink` tokens.
- **Type:** system font stacks only (custom fonts are not loaded yet). Two weights per board, never under 12px.
- **Layout:** flex + padding + gap, `box-sizing: border-box`, no margins, fixed-width slots for icons and trailing actions.
- **Content:** real copy and plausible data, never lorem ipsum. One primary action and one colour moment per screen.
- **States:** empty, loading, error and a mobile variant, named `Screen · state` / `Screen · mobile`.
- **Names:** give frames a `data-name`. `data-locked` means hands off.

## Other skills that help (optional, the guide works without them)

Use them if installed; none is required.
- `frontend-design`: pick a distinctive aesthetic direction at the brief step.
- `emil-design-eng`, `make-interfaces-feel-better`, `better-ui`: polish pass (radii, optical alignment, depth, hit areas).
  Apply the advice through `update_styles`, and keep the project motion rules.
- `apple-design`: mobile feel, type and materials for phone screens.
- `break-ui`: before finishing, test worst-case content (long names, empty lists, huge numbers) by editing a copy of a board.
- `web-design-guidelines`: final accessibility and UX audit of the exported HTML.

## Gotchas

- Screenshots need the project open in a browser tab.
- Inline styles only; `<script>`, `<link>`, event handlers and forms are stripped.
- After `src/mcp.mjs` tool schema changes, Claude Code must be restarted to see them.
