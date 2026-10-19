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
- Per-tool token estimates (`/api/status`) and short server `instructions`.
- `Origin` check on every request (DNS rebinding was already covered by the Host check).
- `export_react` (JSX + Tailwind arbitrary-property classes).
- Claude Code plugin: `.claude-plugin/`, `.mcp.json`, `skills/design-canvas/SKILL.md`.
- Unit tests (`pnpm test`) for the doc model, lint, export and meter.

## Not done, in suggested order

1. **MCP panel in the UI** showing `/api/status` (tabs connected, tokens per tool). The endpoint exists; no UI yet.
2. **Theme editor + modes**: edit tokens in the app and recompile CSS variables, light/dark modes, token names
   shown in the inspector. Needs a real `theme` object in the doc (today tokens are only extracted).
3. **Components**: masters with variants, `insert_component`, `create_component`; edit a master and every instance
   updates. Builds on `<x-clone>`, but live linking needs a `data-component` reference.
4. **Layers panel + canvas selection of nested nodes** (click / double-click / Esc to parent), drag to reorder,
   `move_node`, `search_nodes` (the outline search covers the read side).
5. **Manual editing**: inspector (layout, auto layout, radius, fill, stroke, typography), in-place text editing,
   resize handles, undo/redo shortcuts in the browser (undo exists only through MCP today).
6. **Pages** inside a project, `navigate`, dashboard tabs.
7. **References**: `capture_url` (needs a headless browser; the open tab cannot fetch cross-origin pages),
   `add_reference_image`, `compare_to_reference` (pixel diff, would live in the browser).
8. **Normalization on write** (flatten text blocks, drop classes, strip redundant styles). Left out on purpose: the
   Sprig boards rely on current markup and a destructive rewrite would change them. Needs an opt-in or a migration.
9. **Token sync with a repo path** (`extract_tokens` from a CSS file, `repo` in project meta, export tokens to CSS /
   Tailwind theme and import them back).
10. Polish: keyboard shortcuts, 50+ board performance (cached thumbnails already exist), "commit version" button,
    Wails desktop wrapper (the plan's Go/Wails path does not apply; Electron or Tauri would be the equivalent).

## Deliberate differences to revisit

- The lint's spacing rule is a 2px grid, not 4px: the Sprig system uses half-steps (6/10/14) on purpose.
- `lint` cannot see layout; overflow and clipping still need a screenshot or `get_computed_styles`.
- Undo does not cover user drags/resizes in the browser, and is lost when the server restarts.
