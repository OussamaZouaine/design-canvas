# Connect agents

Single source of truth for every agent's MCP config: `web/src/lib/agents.ts` (`agentList(base)`, `mcpUrl`, `EXAMPLE_PROMPTS`).
The dialog `web/src/shell/ConnectAgentsDialog.tsx` only lays it out; the README should quote the module, not copy snippets.
Each URL gets `?agent=<id>` so the Agents panel names the client. Base URL: `http://localhost:3777` in Vite dev (agents must not
use the proxy port 5173), `location.origin` otherwise.

Formats checked against vendor docs on 2026-10-26:
| Agent | Command | File / format | Source |
|---|---|---|---|
| Claude (Code + Desktop, one entry) | `claude mcp add --transport http --scope user` | `.mcp.json` `type: http` | existing `src/setup.mjs` |
| | `node scripts/setup-mcp.mjs --apply --target desktop` | stdio shim in `claude_desktop_config.json` | `scripts/setup-mcp.mjs` |
| Codex | `codex mcp add <name> --url <url>` | `~/.codex/config.toml` `[mcp_servers.x] url` | learn.chatgpt.com/docs/extend/mcp (old developers.openai.com/codex/mcp redirects) |
| Cursor | deeplink `cursor://anysphere.cursor-deeplink/mcp/install?name=&config=<base64 of {url}>` | `~/.cursor/mcp.json` `mcpServers.x.url` | cursor.com/docs/context/mcp (+ /install-links) |
| OpenCode | none | `opencode.json` `mcp.x {type: remote, url, enabled}` | opencode.ai/docs/mcp-servers |
| VS Code | `code --add-mcp '{"name","type":"http","url"}'`, link `vscode:mcp/install?<urlencoded json>` | `.vscode/mcp.json` `servers.x {type: http, url}` | code.visualstudio.com/docs/agents/reference/mcp-configuration, /api/extension-guides/ai/mcp |
| Gemini CLI | `gemini mcp add --transport http <name> <url>` (project scope by default) | `~/.gemini/settings.json` `mcpServers.x.httpUrl` | geminicli.com/docs/tools/mcp-server |
| Antigravity | none | `~/.gemini/config/mcp_config.json` `mcpServers.x.serverUrl` | antigravity.google/docs/mcp |

Icons: brand SVGs from svgl.app (api.svgl.app?search=<name>) in `web/src/assets/agents`, wired in `ConnectAgentsDialog.tsx` (`ICONS`; dark file swapped via the dark variant).

Not doc-confirmed (extrapolated from the stdio example, flagged for a real-world check): the `code --add-mcp` HTTP JSON form.
GitHub Copilot has no separate entry: Copilot in VS Code uses the VS Code config; Copilot CLI was not verified, so it is left out.
