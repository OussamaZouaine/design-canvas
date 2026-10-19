---
name: design-canvas
description: Design screens and design systems on the local Design Canvas (MCP server design-canvas). Use when asked to design, mock up, restyle or review UI, or to work from comments the user pinned on the canvas.
---

# Designing on the Design Canvas

The canvas server must be running (`pnpm start`, http://localhost:3777). Claude writes HTML
artboards; the user watches them appear live and can pin comments on elements.

## Workflow (one task per session keeps token cost down)

1. **Orient.** `list_projects` (reuse a matching project, else `create_project`), `log_prompt`,
   `get_comments` and `get_changes` (what the user pinned or edited by hand), `get_basic_info`.
2. **Read cheaply.** `get_tree` first (one line per node). Use `get_node_info` only on the node you
   will change. Call `get_design_tokens` before adding to an existing design and reuse its values.
3. **Build in small steps.** `create_artboard`, then `write_html` one visual group at a time
   (header, hero, card row). Repeat blocks with `<x-clone node-id="N5"></x-clone>` instead of
   resending markup. Refine with `update_styles` / `set_text_content`, not a rewrite.
4. **Verify.** `lint` (text, cheap) -> fix -> one `get_screenshot` (crop with `node_id` when only one
   part changed) -> `get_computed_styles` if a size or colour looks wrong. Stop after 3 rounds or
   when lint says `clean`.
5. **Finish.** `reply_comment` + `resolve_comment` for each comment handled, then `finish_working`.
   A bad change can be reverted with `undo`.

## Design rules

- **Colour:** OKLCH only, `oklch(L C H)`. Hold C and H, step L for ramps. Text contrast at least
  4.5:1 (3:1 for 24px+ or 18.66px+ bold). Status text uses the darker `*Ink` tokens, not the fills.
- **Type:** one family, about 7 sizes. Hierarchy through size and weight before colour. Never
  under 12px. 8-12 words per line of UI copy.
- **Spacing:** a consistent rhythm on an even-pixel grid (4/8/16/24/32 are the usual stops).
  Flex layouts with gaps rather than absolute positioning; use explicit widths on containers.
- **Content:** real copy and plausible data, never lorem ipsum. One primary action per screen.
- **States:** every screen needs empty, loading, error and a mobile variant. Name them
  `Screen · state` / `Screen · mobile` so they sort together.
- **Names:** give frames a `data-name` so the layer outline reads like a design file.
- **Locked nodes:** `data-locked` means the user does not want it touched; leave it alone.

## Gotchas

- Rebuilding artboards by deleting and recreating them changes ids and orphans comments.
  Edit in place instead.
- Screenshots need the project open in a browser tab.
- Inline styles only; `<script>`, `<link>`, event handlers and forms are stripped.
