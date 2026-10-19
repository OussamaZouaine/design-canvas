# Roadmap: the build plan, adapted to this codebase

The original plan ("Local Design Canvas — Build Plan", written against Paper's docs on 2026-10-18) assumed a
Go backend and a Vite + React frontend. This project already runs on **Node (plain ES modules) with a
vanilla-JS frontend**, with projects, comments, history and a large example design system built. We keep that stack
and take the plan's *ideas*, not its rewrite. Status below is as of 2026-10-19.

## Adaptations (plan -> here)

| Plan | Here | Why |
| --- | --- | --- |
| Go server, `chromedp` screenshots | Node server; the open browser tab rasterizes (`askBrowser` over SSE) | Already works, no Chrome dependency. Cost: a tab must be open |
| `data-node-id` | `data-pid` (`A#` artboards, `N#` nodes) | Already used everywhere |
| One HTML file per artboard + `project.json` | One `doc.json` per project in `data/` | Works, atomic saves, snapshots. Revisit only if Git-friendly files are wanted |
| `theme.json` tokens authored by hand | Tokens *extracted* from the styles in use (`get_design_tokens`) | Keeps the "OKLCH, colour roles" approach of the Sprig system |
| Pages inside a project | Not yet: one canvas per project, rows by `y` | See "Not done" |
| WebSocket | SSE (`/events`) | One-way push is enough; POSTs go the other way |
| `canvas mcp` stdio shim | HTTP MCP, plus a plugin `.mcp.json` | Stdio shim only matters if the app is closed when Claude starts |
| Vite + React + Zustand | Vanilla JS | No build step; switch only if the UI outgrows it |

## Done (from the plan)

- Compact outline `get_tree` with `query` search (plan: `get_tree`).
- `write_html` modes append / prepend / replace / before / after and `<x-clone node-id>` expansion.
- `data-locked` honoured on edits; `hidden` kept as an ordinary attribute.
- `undo` (in-memory, 50 steps) and a change journal with `get_changes` (what the *user* changed since Claude looked).
- `lint` v1: WCAG contrast (hex / rgb / OKLCH against the nearest painted background), text under 12px, odd pixel
  spacing, boxes wider than the artboard, negative absolute offsets, images without alt, lorem ipsum.
- Token-lean `get_screenshot` (1x JPEG, 1000px max, crop by `node_id`) and `get_computed_styles`.
- `finish_working` plus a dashed highlight on nodes Claude is editing.
- Per-tool token estimates (`/api/status`), an MCP tab in the side panel (server state, setup command, tokens per tool), and short server `instructions`.
- `Origin` check on every request (DNS rebinding was already covered by the Host check).
- `export_react` (JSX + Tailwind arbitrary-property classes).
- Claude Code plugin: `.claude-plugin/`, `.mcp.json`, `skills/design-canvas/SKILL.md`.
- Design tokens: stored per project with modes, `set_tokens` / `get_design_system`, live Theme tab, `create_foundations`
  (generated, locked, self-refreshing), `lint` resolves `var()` per mode, exports declare the tokens.
- Components: `set_component` (variants + `data-slot` text), `insert_component`, `detach_component`, `delete_component`,
  `create_components_sheet`. Instances are stored expanded and re-expanded in place when the master changes (ids and slot
  text kept), shown as one line in `get_tree`.
- Layers panel (left drawer, `L`): tree of boards and nodes, search, select (canvas selection reveals the row), hover
  highlight, rename, hide, lock, drag to reorder / reparent (`move_node`, `set_flags` for Claude), Esc selects the parent.
- Inspector (Design tab, `I`): style fields grouped as Layout, Auto layout, Appearance, Fill, Stroke, Shadow and Typography,
  token suggestions and a Detach chip, an "Other styles" list for CSS with no control, artboard fields. In-place text
  editing (double-click), Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z, and a redo stack.
- Opt-in HTML normalization on write (`src/normalize.mjs`), switched per project with `rename_project`.
- Unit tests (`pnpm test`) for the doc model, lint, normalization, export and meter.

## Not done, in suggested order

1. **Theme, remaining parts**: `extract_tokens` from a node or a repo CSS file (today `get_design_tokens` scans the whole project).
2. **Manual editing, remaining parts**: resize handles and dragging absolutely positioned nodes on the canvas, drag-reorder
   inside flex parents on the canvas, copy / paste, a toolbar for inserting frames, text, images and components, image upload
   into `assets/`, per-side padding fields and a colour picker. Style fields, in-place text and undo / redo are done.
3. **Pages** inside a project, `navigate`, dashboard tabs.
4. **References**: `capture_url` (needs a headless browser; the open tab cannot fetch cross-origin pages),
   `add_reference_image`, `compare_to_reference` (pixel diff, would live in the browser).
5. **Normalization, remaining parts**: flattening text blocks into one text node and turning inputs into frames. The
   class/`<style>` drop, redundant-style stripping and border-box are done (opt-in per project).
6. **Token sync with a repo path** (`extract_tokens` from a CSS file, `repo` in project meta, export tokens to CSS /
   Tailwind theme and import them back).
10. Polish: keyboard shortcuts, 50+ board performance (cached thumbnails already exist), "commit version" button,
    Wails desktop wrapper (the plan's Go/Wails path does not apply; Electron or Tauri would be the equivalent).

## Deliberate differences to revisit

- `lint` spacing defaults to the plan's 4px grid; pass `grid: 2` for designs with deliberate half-steps (Sprig).
- Normalization is per project: new projects have it on, existing ones (Sprig), imports and their copies keep it off.
- `lint` cannot see layout; overflow and clipping still need a screenshot or `get_computed_styles`.
- Undo does not cover user drags/resizes in the browser, and is lost when the server restarts.
