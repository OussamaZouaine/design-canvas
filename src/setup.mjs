// Pure helpers for scripts/setup-mcp.mjs: registering the design-canvas MCP endpoint in client config.
// Kept separate from the CLI so the "never touch unrelated config" rule is unit-tested.
import os from 'node:os';
import path from 'node:path';

export const SERVER_NAME = 'design-canvas';

// Claude Desktop only launches stdio servers, so its entry runs our stdio shim (scripts/mcp-stdio.mjs)
// which forwards to the HTTP endpoint. Claude Code speaks HTTP directly (`claude mcp add`).
export function desktopEntry(shimPath, port = 3777) {
  return { command: process.execPath, args: [shimPath], env: { DESIGN_CANVAS_URL: `http://localhost:${port}/mcp` } };
}

export function desktopConfigPath(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'win32') return path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  return path.join(env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'Claude', 'claude_desktop_config.json');
}

// Returns the new file text with ONLY mcpServers["design-canvas"] set; every other key is kept as is.
// Throws on invalid JSON rather than overwriting a file we cannot understand.
export function mergeServer(existingText, entry) {
  let cfg = {};
  if (existingText?.trim()) {
    try { cfg = JSON.parse(existingText); } catch (e) { throw new Error(`Existing config is not valid JSON (${e.message}); fix or move it first.`); }
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('Existing config is not a JSON object.');
  }
  if (cfg.mcpServers != null && (typeof cfg.mcpServers !== 'object' || Array.isArray(cfg.mcpServers))) throw new Error('"mcpServers" in the existing config is not an object.');
  const before = cfg.mcpServers?.[SERVER_NAME];
  const same = before && JSON.stringify(before) === JSON.stringify(entry);
  cfg.mcpServers = { ...(cfg.mcpServers ?? {}), [SERVER_NAME]: entry };
  return { text: JSON.stringify(cfg, null, 2) + '\n', changed: !same, replaced: before && !same ? before : null };
}

export const claudeCodeCommand = (port = 3777) => ['claude', 'mcp', 'add', '--transport', 'http', '--scope', 'user', SERVER_NAME, `http://localhost:${port}/mcp`];
