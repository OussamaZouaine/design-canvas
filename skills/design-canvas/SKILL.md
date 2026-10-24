---
name: design-canvas
description: Design screens and design systems on the local Design Canvas (MCP server design-canvas). Use when asked to design, mock up, restyle or review UI, or to work from comments the user pinned on the canvas.
---

# Designing on the Design Canvas

The canvas server must be running (`pnpm start`, http://localhost:3777). Claude writes HTML artboards; the user watches
them appear live and can pin comments on elements.

The whole method (workflow, brief, type, layout, review, hard rules) lives in the MCP, so every client gets the same text
and it is tested. This skill deliberately does not repeat it:

1. In your first turn call `get_guide()` and `start({prompt, project, ...})` together, then follow the guide. `get_guide({topic: "mobile"})`
   is the only separate topic (phone screens).
2. If MCP tools are deferred, load the core set in one ToolSearch `select:` query: get_guide, start, list_projects, log_prompt,
   create_artboard, write_html, update_styles, get_tree, lint, get_screenshot, finish_working.

If this file and the guide ever disagree, the guide wins.

## Not in the guide's main path

- **Rebuild from a picture:** `add_reference_image` (absolute path) puts it on a locked board; build your own artboard at the same
  width next to it, then loop `compare_to_reference` and fix the worst areas (3 rounds, or stop under about 5% different).
  `capture_url` copies a live public page into an artboard plus a reference screenshot.
- **Fonts:** `list_fonts`, then `use_font` before using a Google family (system stacks need no loading).
- **Comments:** `get_comments`, fix, then `reply_comment` with `resolve: true`.

## Optional skills that help (none is required)

`frontend-design` (aesthetic direction at the brief step), `emil-design-eng` / `make-interfaces-feel-better` / `better-ui`
(polish through `update_styles`, keep the project motion rules), `apple-design` (mobile), `break-ui` (worst-case content on a
copy of a board), `web-design-guidelines` (audit of the exported HTML).

## Gotchas

- Screenshots need the project open in a browser tab (or Chrome/Edge installed for the headless fallback).
- Inline styles only; `<script>`, `<link>`, event handlers and forms are stripped.
- After `src/mcp.mjs` tool schema changes, Claude Code must be restarted to see them.
