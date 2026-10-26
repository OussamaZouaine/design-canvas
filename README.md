# Design Canvas

A small, local, Paper-like design canvas that **AI agents drive over MCP**. An agent writes HTML designs onto an infinite
pan/zoom canvas, you watch them appear live, leave comments on any element, and the agent reads and answers those comments.

Everything runs on your machine. There is no database and no cloud service: projects are plain JSON files in `data/`.

## Contents
- [What you get](#what-you-get)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Connect your agent](#connect-your-agent)
- [Your first prompts](#your-first-prompts)
- [Using the app](#using-the-app)
- [MCP tools](#mcp-tools)
- [Design tokens](#design-tokens)
- [Data and backups](#data-and-backups)
- [Security](#security)
- [Project layout](#project-layout)
- [Example: the Sprig design system](#example-the-sprig-design-system)
- [Conventions](#conventions)
- [Troubleshooting](#troubleshooting)
- [More documentation](#more-documentation)

## What you get
| Area | Highlights |
| --- | --- |
| Canvas | Infinite pan/zoom, pages, artboards as sanitized HTML in shadow-DOM frames, live "agent is designing" feedback with a Follow camera |
| Editing by hand | Select, move, resize, snap guides, drag to reorder in a flow, group / auto layout, pen and shape tools, Layers panel, Design (Inspector) tab, undo / redo |
| Comments | Pin a comment on any element; the agent reads, replies and resolves; one page lists them all |
| Design system | OKLCH tokens (extract, edit, export as CSS / JSON / Tailwind), components with variants, Google Fonts, icons and logos, reference images |
| Quality checks | Lint (contrast, spacing, undefined tokens), layout check with fit-height boards, screenshots the agent can look at |
| Agent visibility | Agents panel (who is connected, what each call did), per-agent pause, soft board claims, call log and efficiency report |
| History | Activity log with per-step revert, saved versions, per-project design memory |
| Output | Standalone HTML, React + Tailwind or JSX, PNG, project bundles |

## How it works
```
AI agent  --MCP (HTTP)-->  Node server (127.0.0.1:3777)  --SSE-->  Browser canvas
                                |                                       |
                           data/*.json  <----- comments, edits ---------+
```
- **Artboards** are sanitized HTML. Each one renders inside a shadow-DOM frame so designs never leak styles into the app.
- **Live updates** flow from the server to the browser over Server-Sent Events (SSE); only artboards whose HTML changed are sent.
- **Screenshots** (`get_screenshot`) are rasterized by the browser. With no tab open the server starts a headless Chrome/Edge
  for you; otherwise keep the project open in a tab.
- **Persistence** is debounced and atomic (write a temp file, then rename) so a crash never leaves a half-written project.

## Requirements
- Node.js 18 or newer (ES modules, `.mjs`) and [pnpm](https://pnpm.io).
- A modern Chromium-based browser or Firefox for the canvas.
- An MCP client that speaks StreamableHTTP (Claude, Codex, Cursor, VS Code / Copilot, OpenCode, Gemini CLI, ...). See
  [Connect your agent](#connect-your-agent).

## Quick start
1. Install and build the UI once (rebuild after any change in `web/`):
   ```
   pnpm install
   pnpm build:web
   ```
2. Start the server (serves http://localhost:3777):
   ```
   pnpm start
   ```
3. Open http://localhost:3777 in a browser.
4. Connect an agent: click the plug button, or follow [Connect your agent](#connect-your-agent). For Claude Code:
   ```
   claude mcp add --transport http --scope user design-canvas http://localhost:3777/mcp?agent=claude
   ```
5. Restart the agent and ask it to design something ([first prompts](#your-first-prompts)).

Set `PORT` to use another port, e.g. `PORT=4000 pnpm start`, and use the matching MCP URL. Stop the server with a normal
kill (Ctrl+C) so it can flush pending writes to `data/`. After the MCP tool schemas change, restart the agent so it sees the
new arguments. UI development with hot reload: `pnpm dev:web` (Vite on http://localhost:5173, proxies to the running server).

### Pages
| URL | What it is |
| --- | --- |
| `/` | Projects home: live previews, search, sort, rename, duplicate, export, trash, import |
| `/p/<id>` | A project's canvas (Save version, History, Tokens, Export) |
| `/comments` | Every comment across all projects, with filters and replies |
| `/mcp` | The MCP endpoint (StreamableHTTP, stateful sessions) |

## Connect your agent
The easiest way is the built-in dialog: click the **plug button** ("Connect agents") in the canvas header, or the same
button in the projects home sidebar. Pick your agent on the left; the dialog shows the exact command (copy button) or an
install link, a "manual install" config snippet, and notes. Everything below is generated from the same source
([`web/src/lib/agents.ts`](web/src/lib/agents.ts)), so it matches the dialog. Doc sources and open gaps:
[docs/notes/connect-agents.md](docs/notes/connect-agents.md).

**Basics for every agent**
- MCP URL: `http://localhost:3777/mcp` (change the port if you set `PORT`).
- Add `?agent=<name>` (e.g. `?agent=codex`) so the client shows up by name in the **Agents** panel. The dialog already does this.
- The server must be running, and you must **restart the agent** (or start a new session) after adding the server.
- Keep a project open in a browser tab for `get_screenshot`; without one the server falls back to a headless browser.

| Agent | Add it with |
| --- | --- |
| [Claude](#claude-code-and-claude-desktop) | `claude mcp add` (Code) or `node scripts/setup-mcp.mjs` (Desktop) |
| [Codex](#codex) | `codex mcp add` |
| [Cursor](#cursor) | "Add to Cursor" link in the dialog, or `mcp.json` |
| [OpenCode](#opencode) | edit `opencode.json` |
| [VS Code / Copilot](#vs-code--copilot) | install link, `code --add-mcp`, or `mcp.json` |
| [Gemini CLI](#gemini-cli) | `gemini mcp add` |
| [Antigravity](#antigravity) | edit `mcp_config.json` |
| [Other agents](#other-agents) | URL, or the stdio shim |

### Claude Code and Claude Desktop
Claude Code (speaks HTTP directly):
```
claude mcp add --transport http --scope user design-canvas http://localhost:3777/mcp?agent=claude
```
Or put this in `.mcp.json` at the project root:
```json
{
  "mcpServers": {
    "design-canvas": {
      "type": "http",
      "url": "http://localhost:3777/mcp?agent=claude"
    }
  }
}
```
Claude Desktop cannot call an HTTP server, so it runs a small stdio shim ([scripts/mcp-stdio.mjs](scripts/mcp-stdio.mjs)) that
forwards to the canvas. Run this inside the design-canvas folder, then quit and reopen Claude Desktop (add `--port <n>` if you changed the port):
```
node scripts/setup-mcp.mjs --apply --target desktop
```
Or edit `claude_desktop_config.json` (Settings > Developer > Edit config) by hand:
```json
{
  "mcpServers": {
    "design-canvas": {
      "command": "node",
      "args": [
        "<design-canvas folder>/scripts/mcp-stdio.mjs"
      ],
      "env": {
        "DESIGN_CANVAS_URL": "http://localhost:3777/mcp?agent=claude"
      }
    }
  }
}
```
`scripts/setup-mcp.mjs` is a **dry run by default** (it prints what it would change); `--apply` does it. `--target code|desktop|both`
(default `both`). For Desktop it only writes the `design-canvas` key and saves a `.bak` copy first.

### Codex
```
codex mcp add design-canvas --url http://localhost:3777/mcp?agent=codex
```
Or in `~/.codex/config.toml` (or `.codex/config.toml` in a trusted project):
```toml
[mcp_servers.design-canvas]
url = "http://localhost:3777/mcp?agent=codex"
```
Check it with `codex mcp list`.

### Cursor
Use the **Add to Cursor** link in the dialog (Cursor asks you to confirm). Or in `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):
```json
{
  "mcpServers": {
    "design-canvas": {
      "url": "http://localhost:3777/mcp?agent=cursor"
    }
  }
}
```

### OpenCode
OpenCode has no add command for this; edit `opencode.json` (project root, or your global OpenCode config):
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "design-canvas": {
      "type": "remote",
      "url": "http://localhost:3777/mcp?agent=opencode",
      "enabled": true
    }
  }
}
```

### VS Code / Copilot
Use the **Install in VS Code** link in the dialog, or add it to your user profile from a shell (bash / zsh quoting):
```
code --add-mcp '{"name":"design-canvas","type":"http","url":"http://localhost:3777/mcp?agent=vscode"}'
```
Or in `.vscode/mcp.json` (workspace) or your user-profile `mcp.json`. VS Code uses a `servers` key, not `mcpServers`:
```json
{
  "servers": {
    "design-canvas": {
      "type": "http",
      "url": "http://localhost:3777/mcp?agent=vscode"
    }
  }
}
```
Use Agent mode in Copilot Chat to see the tools.

### Gemini CLI
```
gemini mcp add --transport http design-canvas http://localhost:3777/mcp?agent=gemini-cli
```
That saves it for the current project. For all projects use `~/.gemini/settings.json` (or `.gemini/settings.json`). Gemini CLI
calls the streamable HTTP field `httpUrl`; plain `url` means the older SSE transport:
```json
{
  "mcpServers": {
    "design-canvas": {
      "httpUrl": "http://localhost:3777/mcp?agent=gemini-cli"
    }
  }
}
```

### Antigravity
In `~/.gemini/config/mcp_config.json` (or `.agents/mcp_config.json` in a workspace). The field is `serverUrl`; `httpUrl` is not
supported there. Type `/mcp` in the CLI to reload and check the server.
```json
{
  "mcpServers": {
    "design-canvas": {
      "serverUrl": "http://localhost:3777/mcp?agent=antigravity"
    }
  }
}
```

### Other agents
Most clients accept the URL as a "streamable HTTP" or "remote" server. Replace `other` with your client name so it shows up in the Agents panel:
```
http://localhost:3777/mcp?agent=other
```
A client that can only launch commands (stdio) uses the bundled shim:
```json
{
  "mcpServers": {
    "design-canvas": {
      "command": "node",
      "args": [
        "<design-canvas folder>/scripts/mcp-stdio.mjs"
      ],
      "env": {
        "DESIGN_CANVAS_URL": "http://localhost:3777/mcp?agent=other"
      }
    }
  }
}
```

### Claude Code plugin
The repo is also a Claude Code plugin (`.claude-plugin/`, `skills/design-canvas/`, `.mcp.json`): it adds a short skill that points the agent at `get_guide` and registers the same endpoint (without `?agent=`). The server must still be running.

### If the connection fails
| Symptom | Check |
| --- | --- |
| "connection refused" / server shows as failed | Is `pnpm start` running? Open http://localhost:3777 to confirm |
| Wrong port | The port in the MCP URL must equal `PORT` (default 3777); re-run the command with the right URL |
| `403 Forbidden host` | The server accepts only `localhost:<PORT>` and `127.0.0.1:<PORT>` as Host (DNS-rebinding protection). Use `localhost`, not a LAN IP or a custom hostname or a proxy |
| Tools missing | Restart the agent or start a new session; in Claude Code run `claude mcp list` |
| Desktop shows nothing | Quit and reopen Claude Desktop; check the path in `args` points at `scripts/mcp-stdio.mjs` |
| 503 on the web page | Run `pnpm build:web` first |

## Your first prompts
Open a project in the browser, then try these (they are also in the dialog's "first prompt" step):

1. `Create a new Design Canvas project called "Hello" with one mobile artboard that says Hello World.`
2. `In Design Canvas, create 3 colour tokens (primary, surface, text) and a swatch board that shows them.`
3. `Design a landing page hero in Design Canvas with a headline, a subline and a call-to-action button.`

Then pin a comment on something with `C` and tell the agent "answer my comments"; it reads them, changes the design and replies.
Agents call `get_guide` first, which returns the design rules for this canvas (workflow, type, layout, review).

## Using the app

### Projects
The agent calls `start` (find or create the project, log the request, open the first board) or `list_projects` /
`create_project` / `project` and passes `project_id` on later calls. Each MCP session is bound to a project, so two agents
can work on two projects. Deleted projects go to **Trash** first, so they can be restored.

### Canvas
- Pan and zoom the infinite canvas; click an artboard or element to select it. Pages are in the top of the left sidebar.
- **Level of detail:** artboards are mounted as live HTML only when zoomed in (>= 30%) and near the viewport. Zoomed out, a
  cached bitmap snapshot is shown instead, which keeps big projects smooth.
- **Generation animation:** while an agent writes to an artboard it gets an orbiting ring and a "Designing" pill, and new
  elements fade in with a short stagger. The **Follow** toggle glides the camera to the artboard being written (it backs
  off for a moment when you pan or zoom yourself).
- **Editing by hand:** Design tab (`I`) for styles with token suggestions, Layers panel (`L`), double-click text to edit,
  drag handles to resize, drag to move or reorder, `Ctrl+Z` / `Ctrl+Shift+Z`.

### Keyboard shortcuts
Press `?` in the app for the full list (source: [web/src/shell/ShortcutsDialog.tsx](web/src/shell/ShortcutsDialog.tsx)). The ones to know first:

| Key | Action |
| --- | --- |
| `V` `H` `F` `R` `O` `L` `P` `T` `I` `C` | Move, Hand, Frame, Rectangle, Ellipse, Line, Pen, Text, Image, Comment |
| `Space` + drag | Pan |
| `Ctrl/Cmd + G`, `Shift + A` | Group, add auto layout |
| `Ctrl/Cmd + D` | Duplicate |
| `Delete` / `Backspace` | Delete the selection |
| `Ctrl/Cmd + Z` / `Shift + Z` | Undo / redo |
| `Esc` | Up one level, then deselect |
| `Ctrl/Cmd + Enter` | Send a comment or reply |

### Comments
Press `C`, click an element, and write a note. Pins stay attached to the element. The agent reads them with `get_comments`
(new ones also arrive attached to its next tool result) and answers with `reply_comment` / `resolve_comment`. The `/comments`
page lists everything across projects with status tabs, filters, replies, resolve/reopen/delete, and deep links
(`/p/<id>?comment=<id>`).

> Artboard ids change when artboards are deleted and recreated (build scripts do this), which orphans comments pinned to
> the old ids. They show up as "replaced or deleted" on `/comments`.

### History and versions
- **Activity** (History button, or `log_prompt`): each request is logged with what it changed, step by step. **Revert** restores
  a step or a whole request.
- **Versions:** snapshots are saved automatically and on demand (`project` action `save_version`, or the Save version button).

### Agents panel
Shows who is connected (named by `?agent=`), what each call did, and cost per request. You can pause an agent; its writes then
return a polite error. Concurrent agents see soft claims on boards.

### Export
Export a project as a bundle from the home page, or call `export_code` / `export` for code and PNG. Exported projects can be
imported again from the home page.

## MCP tools
The server exposes about 50 tools. Low-traffic families are single tools with an `action` argument. Call `get_guide` for the
method; the list below is grouped by family (real names from [src/mcp.mjs](src/mcp.mjs)).

| Family | Tools |
| --- | --- |
| Start and guide | `get_guide`, `start` (one-call opening: project, logged prompt, first board, open comments), `log_prompt` |
| Projects | `list_projects`, `create_project`, `project` (open / update / save_version / delete), `pages`, `memory` (rules and decisions kept per project) |
| Reading the design | `get_basic_info`, `get_selection`, `get_tree`, `get_node_info`, `find_nodes`, `get_changes` (what the user edited by hand), `get_computed_styles` |
| Creating and editing | `create_artboard`, `write_html` (append / prepend / replace / before / after, streaming, `<x-clone node-id>`), `update_styles`, `set_text_content`, `set_attrs`, `rename_nodes`, `duplicate_nodes`, `delete_nodes`, `move_node`, `set_flags`, `batch` |
| Components | `components` (set / detach / delete / sheet), `insert_component` |
| Tokens and fonts | `tokens` (extract / export / import / link_repo), `get_design_system`, `set_tokens`, `create_foundations`, `list_fonts`, `use_font` |
| Assets and references | `assets` (icons, logos, insert), `import_svg`, `references`, `capture_url`, `compare_to_reference` |
| Verifying | `lint`, `check_layout`, `fit_artboard`, `get_screenshot` (crop with `node_id`), `finish_working` |
| Comments | `get_comments`, `reply_comment`, `resolve_comment` |
| History | `history` (undo / redo) |
| Output | `export_code` (react / html / jsx), `export` (PNG) |

Typical flow: `start` -> `write_html` / `update_styles` (new lint issues come back in the result) -> `get_screenshot` ->
`finish_working`, then `get_comments` and reply. After tool schemas change, restart the agent.

## Design tokens
The **Tokens** tab (or `tokens` action `extract`) scans a project and lists the colours, type, radii, spacing and shadows
actually used. Colours are reported in **OKLCH**. Output formats: CSS variables, W3C design-token JSON, or a Tailwind config.
Linking a code folder (`tokens` action `link_repo`) lets tokens sync with the CSS custom properties in that repo.

## Data and backups
Runtime data lives in `data/` (gitignored):
```
data/
  state.json                  active project
  projects/<id>/
    doc.json                  the artboards
    meta.json                 name, timestamps, brief, fonts
    activity.json             prompt/activity log
    comments.json             comments and replies
    memory.json               per-project design rules and decisions
    refs/                     reference images
  snapshots/                  saved versions
  fonts/, assets/, exports/   cached fonts, icons, exported PNGs
```
Back up by copying the `data/` folder. Project ids look like `p_a1b2c3d4`. `DC_DATA=<dir>` runs a second instance on its own folder.

## Security
- The server binds to `127.0.0.1` only and rejects foreign `Host` headers (DNS-rebinding protection).
- Requests carrying a foreign `Origin` header are refused (a web page cannot drive the API through your browser).
- POST bodies must be JSON; project ids are validated against `^p_[a-f0-9]{8}$`.
- Generated HTML is stripped of scripts, iframes, forms and event handlers before it is stored or rendered.
- Untrusted text (project names, comments) is rendered with `textContent`, never `innerHTML`.
- `capture_url` only fetches public http(s) pages unless `allow_private` is set.

## Project layout
```
src/
  server.mjs     HTTP routes, SSE, delta doc sync, comments API
  mcp.mjs        MCP tools
  guide.mjs      the design guide served by get_guide
  sessions.mjs   MCP sessions (agent identity, project binding)
  store.mjs      ProjectStore: projects, snapshots, activity, comments, active project
  doc.mjs        Doc: one project's artboards, HTML sanitizing, data-pid ids, atomic saves, undo, change journal
  lint.mjs       static design lint (WCAG contrast incl. OKLCH, spacing, size checks)
  export.mjs     artboard -> React + Tailwind
  tokens.mjs     OKLCH design-token extraction (css / json / tailwind)
web/                        React client (Vite): src/canvas engine, panels, pages, stores; built to web/dist
scripts/                    setup-mcp.mjs (register with Claude), mcp-stdio.mjs (stdio shim)
examples/sprig/             scripts that build the Sprig design system
test/                       node:test unit tests (`pnpm test`)
skills/, .claude-plugin/, .mcp.json   Claude Code plugin: design skill + MCP config
docs/                       ROADMAP.md, REACT-REWRITE.md, notes/ (per-feature plans)
data/                       runtime data (gitignored)
```
The full module list with the reasons behind each is in [CLAUDE.md](CLAUDE.md).

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
- Comments in code explain the **why**; commits are small and focused, one concern each. Run `pnpm test` before committing.

## Troubleshooting
For connection problems see [If the connection fails](#if-the-connection-fails).
- **`get_screenshot` fails with "Open the project in a browser tab first":** open `/p/<id>`; the headless fallback needs Chrome or Edge and `pnpm build:web` (`DC_BROWSER=<exe>` picks the browser, `DC_HEADLESS=0` disables it).
- **An artboard looks blank:** reload the page (delta sync refills from the server).
- **Agent does not see new tool arguments:** restart the agent after changing MCP schemas.
- **Port already in use:** stop the other process or start with a different `PORT`.
- **UI edits do not show:** run `pnpm build:web` (or use `pnpm dev:web`); restart the server for `src/` changes.

## More documentation
- [CLAUDE.md](CLAUDE.md): conventions and architecture notes that are easy to get wrong.
- [PROGRESS.md](PROGRESS.md): history, known issues and next steps.
- [docs/ROADMAP.md](docs/ROADMAP.md): build plan and status.
- [docs/REACT-REWRITE.md](docs/REACT-REWRITE.md): how the React client was built.
- [docs/notes/connect-agents.md](docs/notes/connect-agents.md): agent config sources and gaps.
- [docs/notes/ui-system.md](docs/notes/ui-system.md): UI tokens and patterns.
- [examples/sprig/DESIGN-SYSTEM.md](examples/sprig/DESIGN-SYSTEM.md): the Sprig design-system spec.
