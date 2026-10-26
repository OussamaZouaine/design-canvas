// How to connect each AI agent to the design-canvas MCP endpoint. Pure data + string builders (no DOM, no imports,
// erasable TypeScript only) so `test/agents.test.mjs` can load it with Node and the README can quote it.
//
// Every format below was checked against the vendor docs on 2026-10-26 (see docs/notes/connect-agents.md for the
// sources). When a vendor changes its format, fix it here and the dialog follows; do not copy snippets elsewhere.

export const SERVER_NAME = 'design-canvas';

export type Snippet = {
  /** Where the text goes, e.g. `~/.codex/config.toml`. Shown above the code block. */
  file: string;
  lang: 'json' | 'toml' | 'text';
  text: string;
};

export type AgentConfig = {
  id: string;
  label: string;
  /** One-line command that registers the server (the "one-click" step in the dialog). */
  command?: { text: string; hint?: string };
  /** A deeplink the OS hands to the app (Cursor, VS Code); rendered as a button. */
  link?: { label: string; href: string };
  /** The "Or, install manually" part. */
  manual: Snippet[];
  notes: string[];
};

// Prompts shown for copying once an agent is connected. They name the tool surface (project, artboard) in plain words.
export const EXAMPLE_PROMPTS = [
  'Create a new Design Canvas project called "Hello" with one mobile artboard that says Hello World.',
  'In Design Canvas, create 3 colour tokens (primary, surface, text) and a swatch board that shows them.',
  'Design a landing page hero in Design Canvas with a headline, a subline and a call-to-action button.',
];

/** Normalises whatever the caller has (origin with or without slash, or a full /mcp URL) to `<origin>`. */
export function originOf(base: string): string {
  return base.trim().replace(/\/mcp\/?$/, '').replace(/\/+$/, '');
}

/**
 * The MCP URL for one client. `?agent=<id>` is read by the server (src/server.mjs) to name the client in the
 * Agents panel, so two agents on the same machine stay distinguishable.
 */
export function mcpUrl(base: string, agentId?: string): string {
  const u = `${originOf(base)}/mcp`;
  return agentId ? `${u}?agent=${encodeURIComponent(agentId)}` : u;
}

const json = (v: unknown) => JSON.stringify(v, null, 2);

// The shim env var: scripts/mcp-stdio.mjs forwards stdio to this URL (clients that cannot speak HTTP).
const shimEntry = (url: string) => ({
  command: 'node',
  args: ['<design-canvas folder>/scripts/mcp-stdio.mjs'],
  env: { DESIGN_CANVAS_URL: url },
});

// Cursor's install link carries base64(JSON of the server entry), without the outer server name (that is `name=`).
// btoa exists in browsers and in Node 16+; the payload is ASCII (a URL), so no UTF-8 detour is needed.
export function cursorDeeplink(url: string): string {
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER_NAME}&config=${encodeURIComponent(btoa(JSON.stringify({ url })))}`;
}

// VS Code's handler takes the whole entry (name included) as URL-encoded JSON in the path.
export function vscodeInstallLink(url: string): string {
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: SERVER_NAME, type: 'http', url }))}`;
}

const RESTART = 'Restart the agent (or start a new session) so it loads the new server.';

export function agentList(base: string): AgentConfig[] {
  const origin = originOf(base);
  const port = (() => { try { return new URL(origin).port || '3777'; } catch { return '3777'; } })();
  const u = (id: string) => mcpUrl(origin, id);

  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      command: { text: `claude mcp add --transport http --scope user ${SERVER_NAME} ${u('claude-code')}` },
      manual: [
        { file: 'Run in a terminal (same as above, project scope instead of user scope)', lang: 'text', text: `claude mcp add --transport http --scope project ${SERVER_NAME} ${u('claude-code')}` },
        { file: '.mcp.json (project root)', lang: 'json', text: json({ mcpServers: { [SERVER_NAME]: { type: 'http', url: u('claude-code') } } }) },
      ],
      notes: [RESTART],
    },
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      // Desktop only launches stdio servers, so the script registers our stdio shim (scripts/mcp-stdio.mjs).
      command: { text: `node scripts/setup-mcp.mjs --apply --target desktop${port === '3777' ? '' : ` --port ${port}`}`, hint: 'Run it inside the design-canvas folder.' },
      manual: [
        { file: 'claude_desktop_config.json (Settings > Developer > Edit config)', lang: 'json', text: json({ mcpServers: { [SERVER_NAME]: shimEntry(u('claude-desktop')) } }) },
      ],
      notes: ['Claude Desktop cannot call an HTTP server directly, so it runs a small stdio shim that forwards to the canvas.', 'Quit Claude Desktop completely and reopen it.'],
    },
    {
      id: 'codex',
      label: 'Codex',
      command: { text: `codex mcp add ${SERVER_NAME} --url ${u('codex')}` },
      manual: [
        { file: '~/.codex/config.toml (or .codex/config.toml in a trusted project)', lang: 'toml', text: `[mcp_servers.${SERVER_NAME}]\nurl = "${u('codex')}"` },
      ],
      notes: ['Check it with `codex mcp list`.', RESTART],
    },
    {
      id: 'cursor',
      label: 'Cursor',
      link: { label: 'Add to Cursor', href: cursorDeeplink(u('cursor')) },
      manual: [
        { file: '~/.cursor/mcp.json (or .cursor/mcp.json in a project)', lang: 'json', text: json({ mcpServers: { [SERVER_NAME]: { url: u('cursor') } } }) },
      ],
      notes: ['The link asks Cursor to confirm before it installs anything.'],
    },
    {
      id: 'opencode',
      label: 'OpenCode',
      manual: [
        { file: 'opencode.json (project root, or your global OpenCode config)', lang: 'json', text: json({ $schema: 'https://opencode.ai/config.json', mcp: { [SERVER_NAME]: { type: 'remote', url: u('opencode'), enabled: true } } }) },
      ],
      notes: ['OpenCode has no add command for this; edit the config file.', RESTART],
    },
    {
      id: 'vscode',
      label: 'VS Code / Copilot',
      link: { label: 'Install in VS Code', href: vscodeInstallLink(u('vscode')) },
      command: { text: `code --add-mcp '${JSON.stringify({ name: SERVER_NAME, type: 'http', url: u('vscode') })}'`, hint: 'Bash / zsh quoting; adds it to your user profile.' },
      manual: [
        { file: '.vscode/mcp.json (workspace) or your user-profile mcp.json', lang: 'json', text: json({ servers: { [SERVER_NAME]: { type: 'http', url: u('vscode') } } }) },
      ],
      notes: ['VS Code uses a `servers` key, not `mcpServers`.', 'Use Agent mode in Copilot Chat to see the tools.'],
    },
    {
      id: 'gemini-cli',
      label: 'Gemini CLI',
      command: { text: `gemini mcp add --transport http ${SERVER_NAME} ${u('gemini-cli')}`, hint: 'Saved for the current project; use the file below for all projects.' },
      manual: [
        { file: '~/.gemini/settings.json (all projects) or .gemini/settings.json', lang: 'json', text: json({ mcpServers: { [SERVER_NAME]: { httpUrl: u('gemini-cli') } } }) },
      ],
      notes: ['Gemini CLI calls the streamable HTTP field `httpUrl`; plain `url` means the older SSE transport.'],
    },
    {
      id: 'antigravity',
      label: 'Antigravity',
      manual: [
        { file: '~/.gemini/config/mcp_config.json (or .agents/mcp_config.json in a workspace)', lang: 'json', text: json({ mcpServers: { [SERVER_NAME]: { serverUrl: u('antigravity') } } }) },
      ],
      notes: ['Antigravity names the field `serverUrl`; `httpUrl` is not supported there.', 'Type /mcp in the CLI to reload and check the server.'],
    },
    {
      id: 'other',
      label: 'Other agents',
      manual: [
        { file: 'Endpoint for any client that supports streamable HTTP', lang: 'text', text: u('other') },
        { file: 'Client that only launches commands (stdio): use the bundled shim', lang: 'json', text: json({ mcpServers: { [SERVER_NAME]: shimEntry(u('other')) } }) },
      ],
      notes: ['Most clients accept the URL as a "streamable HTTP" or "remote" server.', 'Replace `other` in the URL with your client name so it shows up in the Agents panel.'],
    },
  ];
}
