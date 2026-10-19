# Design Canvas

A small, local, Paper-like design canvas that **Claude drives over MCP**. Claude writes HTML designs onto an infinite
pan/zoom canvas, you watch them appear live, leave comments on any element, and Claude reads and answers those comments.

Everything runs on your machine. There is no database and no cloud service: projects are plain JSON files in `data/`.

## Contents
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Using the app](#using-the-app)
- [Working with Claude (MCP)](#working-with-claude-mcp)
- [Design tokens](#design-tokens)
- [Data and backups](#data-and-backups)
- [Security](#security)
- [Project layout](#project-layout)
- [Example: the Sprig design system](#example-the-sprig-design-system)
- [Conventions](#conventions)
- [Troubleshooting](#troubleshooting)
- [More documentation](#more-documentation)

## How it works
```
Claude Code  --MCP (HTTP)-->  Node server (127.0.0.1:3777)  --SSE-->  Browser canvas
                                   |                                       |
                              data/*.json  <----- comments, edits ---------+
```
- **Artboards** are sanitized HTML. Each one renders inside a shadow-DOM frame so designs never leak styles into the app.
- **Live updates** flow from the server to the browser over Server-Sent Events (SSE); only artboards whose HTML changed are sent.
- **Screenshots** (`get_screenshot`) are rasterized by the browser, so a project must be open in a tab for Claude to see it.
- **Persistence** is debounced and atomic (write a temp file, then rename) so a crash never leaves a half-written project.

## Requirements
- Node.js 18 or newer (the project uses ES modules, `.mjs`).
- A modern Chromium-based browser or Firefox for the canvas.
- [Claude Code](https://claude.com/claude-code) to drive the canvas (any MCP client that speaks StreamableHTTP also works).

## Quick start
```
pnpm install
pnpm start                      # serves http://localhost:3777
claude mcp add --transport http design-canvas http://localhost:3777/mcp
```
Then open http://localhost:3777 in a browser and ask Claude to design something. Set `PORT` to use a different port, e.g.
`PORT=4000 pnpm start` (register the matching MCP URL too).

Stop the server with a normal kill (Ctrl+C) so it can flush pending writes to `data/`. After the MCP tool schemas change,
restart Claude Code so it sees the new arguments.

### Pages
| URL | What it is |
| --- | --- |
| `/` | Projects home: live previews, search, sort, rename, duplicate, export, trash, import |
| `/p/<id>` | A project's canvas (Save version, History, Tokens, Export) |
| `/comments` | Every comment across all projects, with filters and replies |
| `/mcp` | The MCP endpoint (StreamableHTTP, stateless) |

## Using the app

### Projects
Claude calls `list_projects`, then `open_project` or `create_project` (named after what it is building) and passes
`project_id` on later calls. Deleted projects go to **Trash** first, so they can be restored.

### Canvas
- Pan and zoom the infinite canvas; click an artboard or element to select it.
- **Level of detail:** artboards are mounted as live HTML only when zoomed in (>= 30%) and near the viewport. Zoomed out, a
  cached bitmap snapshot is shown instead, which keeps big projects smooth.
- **Generation animation:** while Claude writes to an artboard it gets an orbiting ring and a "Designing" pill, and new
  elements fade in with a short stagger. The **Follow** toggle glides the camera to the artboard being written (it backs
  off for a moment when you pan or zoom yourself).

### Keyboard shortcuts
| Key | Action |
| --- | --- |
| `C` | Toggle comment mode, then click an element to pin a comment |
| `Delete` / `Backspace` | Delete the selected element |
| `Ctrl/Cmd + D` | Duplicate the selected element |
| `Esc` | Deselect, or close the open popover |
| `Ctrl/Cmd + Enter` | Send a comment or reply |

### Comments
Press `C`, click an element, and write a note. Pins stay attached to the element. Claude reads them with `get_comments`
and answers with `reply_comment` / `resolve_comment`. The `/comments` page lists everything across projects with status
tabs, filters, replies, resolve/reopen/delete, and deep links (`/p/<id>?comment=<id>`).

> Artboard ids change when artboards are deleted and recreated (build scripts do this), which orphans comments pinned to
> the old ids. They show up as "replaced or deleted" on `/comments`.

### History and versions
- **Activity** (History button, or `log_prompt`): each request Claude is given is logged with what it changed. **Undo**
  restores the project to just before that request.
- **Versions:** snapshots are saved automatically and on demand (`save_version`, or the Save version button).

### Export
Export a project as a bundle from the home page, or call `export_html` to get an artboard as standalone HTML. Exported
projects can be imported again from the home page.

## Working with Claude (MCP)
Claude should call `get_guide` first; it returns the design rules for this canvas. Tools by area:

| Area | Tools |
| --- | --- |
| Guide | `get_guide` |
| Projects | `list_projects`, `create_project`, `open_project`, `rename_project`, `delete_project` |
| History | `save_version`, `log_prompt` |
| Comments | `get_comments`, `reply_comment`, `resolve_comment` |
| Tokens | `get_design_tokens` |
| Reading the design | `get_basic_info`, `get_selection`, `get_tree` (compact outline + search), `get_tree_summary`, `get_node_info`, `get_changes` (what the user edited by hand) |
| Editing | `create_artboard`, `write_html` (append / prepend / replace / before / after, `<x-clone node-id>`), `update_styles`, `set_text_content`, `rename_nodes`, `duplicate_nodes`, `delete_nodes`, `undo` |
| Verifying | `lint` (contrast, small text, spacing, overflow), `get_screenshot` (1x JPEG, crop with `node_id`), `get_computed_styles`, `finish_working` |
| Output | `export_html`, `export_react` (JSX + Tailwind arbitrary-property classes) |

Typical flow: `list_projects` -> `create_project` -> `create_artboard` -> `write_html` -> `get_screenshot` (check the
result) -> refine with `update_styles` / `set_text_content` -> `get_comments` and reply.

## Design tokens
The **Tokens** tab (or `get_design_tokens`) scans a project and lists the colours, type, radii, spacing and shadows
actually used. Colours are reported in **OKLCH**. Output formats: CSS variables, W3C design-token JSON, or a Tailwind config.

## Data and backups
Runtime data lives in `data/` (gitignored):
```
data/
  state.json                  active project
  projects/<id>/
    doc.json                  the artboards
    meta.json                 name, timestamps
    activity.json             prompt/activity log
    comments.json             comments and replies
  snapshots/                  saved versions
```
Back up by copying the `data/` folder. Project ids look like `p_a1b2c3d4`.

## Security
- The server binds to `127.0.0.1` only and rejects foreign `Host` headers (DNS-rebinding protection).
- Requests carrying a foreign `Origin` header are refused (a web page cannot drive the API through your browser).
- POST bodies must be JSON; project ids are validated against `^p_[a-f0-9]{8}$`.
- Generated HTML is stripped of scripts, iframes, forms and event handlers before it is stored or rendered.
- Untrusted text (project names, comments) is rendered with `textContent`, never `innerHTML`.

## Project layout
```
src/
  server.mjs     HTTP routes, SSE, delta doc sync, comments API
  mcp.mjs        MCP tools and the guide text
  store.mjs      ProjectStore: projects, snapshots, activity, comments, active project
  doc.mjs        Doc: one project's artboards, HTML sanitizing, data-pid ids, atomic saves, undo, change journal
  lint.mjs       static design lint (WCAG contrast incl. OKLCH, spacing, size checks)
  export.mjs     artboard -> React + Tailwind
  meter.mjs      per-tool token estimates (served at /api/status)
  tokens.mjs     OKLCH design-token extraction (css / json / tailwind)
public/
  index.html + home.*       projects home
  canvas.html + app.js + style.css   the canvas
  comments.*                all-comments page
examples/sprig/             scripts that build the Sprig design system
test/                       node:test unit tests (`pnpm test`)
skills/, .claude-plugin/, .mcp.json   Claude Code plugin: design skill + MCP config
docs/ROADMAP.md             build plan adapted to this codebase, with status
data/                       runtime data (gitignored)
```

## Example: the Sprig design system
`examples/sprig/` builds a full design system (foundations, components, 14 pages, light and dark) through the running
server. The scripts are idempotent: they delete same-named artboards and recreate them.
```
cd examples/sprig
node build.mjs && node build-more.mjs && node build-system.mjs && node build-density.mjs        # light
THEME=dark node build.mjs && THEME=dark node build-more.mjs && THEME=dark node build-system.mjs && THEME=dark node build-density.mjs
```
The server must be running and the `Sprig design system` project must exist. See `examples/sprig/DESIGN-SYSTEM.md` for the spec.

## Conventions
- **Colours are OKLCH** everywhere (UI CSS, generated designs, tokens).
- **Motion:** custom ease curves, animate transform/opacity only, never `transition: all`, hover styles gated behind
  `(hover:hover) and (pointer:fine)`, and a `prefers-reduced-motion` variant for every animation.
- Comments in code explain the **why**; commits are small and focused, one concern each.

## Troubleshooting
- **`get_screenshot` fails with "Open the project in a browser tab first":** open `/p/<id>` in a browser tab.
- **An artboard looks blank:** reload the page (delta sync refills from the server).
- **Claude does not see new tool arguments:** restart Claude Code after changing MCP schemas.
- **Port already in use:** stop the other process or start with a different `PORT`.
- **UI edits do not show:** static files are served `no-cache`, so a reload is enough; restart the server for `src/` changes.

## More documentation
- `CLAUDE.md`: conventions and architecture notes that are easy to get wrong.
- `PROGRESS.md`: history, known issues and next steps.
- `examples/sprig/DESIGN-SYSTEM.md`: the Sprig design-system spec.
