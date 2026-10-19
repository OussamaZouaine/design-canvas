# Design Canvas

A small local design canvas that Claude can draw on through MCP.

## Run
    npm install
    npm start                      # http://localhost:3777
    claude mcp add --transport http design-canvas http://localhost:3777/mcp

## Projects
- `/` lists every project (live preview, search, sort, rename, duplicate, export, trash, import).
- `/p/<id>` is a project's canvas, with Save version / History / Export.
- Claude calls `list_projects`, then `open_project` or `create_project` (named after what it is building), and passes `project_id` on later calls.
- Data lives in `data/` (one folder per project: `doc.json`, `meta.json`, `snapshots/`). Back it up by copying that folder.

## Safety
- Server listens on 127.0.0.1 only and rejects foreign Host headers.
- Generated HTML is stripped of scripts, iframes, forms and event handlers.
- Version history is saved automatically; deleted projects go to Trash first.

## Canvas features
- **Generation animation:** while Claude writes to an artboard it gets an orbiting ring and a "Designing" chip; new elements fade in with a short stagger; the view glides to fit a new artboard if it lands off-screen (unless you are panning).
- **Design tokens** (Tokens tab, or `get_design_tokens`): scans the project and lists the colours (as OKLCH), type, radii, spacing and shadows actually used. Export as CSS variables, W3C JSON or a Tailwind config.
- **Activity** (History button, or `log_prompt`): each request Claude is given is logged with what it changed; **Undo** restores the project to just before that request.
- **Comments** (press `C`, click an element): pins stay attached to the element; Claude reads them with `get_comments`, then `reply_comment` / `resolve_comment`.
- Colours throughout the app and the Claude guide are OKLCH.
