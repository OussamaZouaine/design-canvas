import test from 'node:test';
import assert from 'node:assert/strict';
import { agentList, mcpUrl, originOf, cursorDeeplink, vscodeInstallLink, EXAMPLE_PROMPTS } from '../web/src/lib/agents.ts';

const BASE = 'http://localhost:3777';

test('originOf strips a trailing slash and a /mcp suffix', () => {
  assert.equal(originOf('http://localhost:3777/'), BASE);
  assert.equal(originOf('http://localhost:3777/mcp'), BASE);
  assert.equal(mcpUrl(BASE, 'codex'), `${BASE}/mcp?agent=codex`);
  assert.equal(mcpUrl(BASE), `${BASE}/mcp`);
});

test('every agent has a unique id, an agent-tagged URL and a manual snippet', () => {
  const list = agentList(BASE);
  assert.equal(new Set(list.map((a) => a.id)).size, list.length);
  for (const a of list) {
    assert.ok(a.manual.length > 0, a.id);
    assert.ok(a.manual.some((s) => s.text.includes(`/mcp?agent=${a.id}`)), `${a.id} snippet names the client`);
  }
});

test('JSON snippets parse and use each vendor key', () => {
  const get = (id) => agentList(BASE).find((a) => a.id === id);
  const parse = (id, i = 0) => JSON.parse(get(id).manual[i].text);
  assert.equal(parse('cursor').mcpServers['design-canvas'].url, `${BASE}/mcp?agent=cursor`);
  assert.equal(parse('vscode').servers['design-canvas'].type, 'http');
  assert.equal(parse('opencode').mcp['design-canvas'].type, 'remote');
  assert.equal(parse('gemini-cli').mcpServers['design-canvas'].httpUrl, `${BASE}/mcp?agent=gemini-cli`);
  assert.equal(parse('antigravity').mcpServers['design-canvas'].serverUrl, `${BASE}/mcp?agent=antigravity`);
  assert.equal(parse('claude-desktop').mcpServers['design-canvas'].env.DESIGN_CANVAS_URL, `${BASE}/mcp?agent=claude-desktop`);
});

test('codex toml and commands', () => {
  const codex = agentList(BASE).find((a) => a.id === 'codex');
  assert.match(codex.manual[0].text, /^\[mcp_servers\.design-canvas\]\nurl = "http:\/\/localhost:3777\/mcp\?agent=codex"$/);
  assert.equal(codex.command.text, `codex mcp add design-canvas --url ${BASE}/mcp?agent=codex`);
  const cc = agentList(BASE).find((a) => a.id === 'claude-code');
  assert.match(cc.command.text, /^claude mcp add --transport http --scope user design-canvas /);
});

test('desktop command carries a non-default port', () => {
  const d = (b) => agentList(b).find((a) => a.id === 'claude-desktop').command.text;
  assert.equal(d(BASE), 'node scripts/setup-mcp.mjs --apply --target desktop');
  assert.match(d('http://localhost:4000'), /--port 4000$/);
});

test('cursor deeplink round-trips to {url}; vscode link to the full entry', () => {
  const url = mcpUrl(BASE, 'cursor');
  const link = new URL(cursorDeeplink(url));
  assert.equal(link.searchParams.get('name'), 'design-canvas');
  assert.deepEqual(JSON.parse(Buffer.from(link.searchParams.get('config'), 'base64').toString()), { url });
  const v = vscodeInstallLink(url);
  assert.ok(v.startsWith('vscode:mcp/install?'));
  assert.deepEqual(JSON.parse(decodeURIComponent(v.split('?')[1])), { name: 'design-canvas', type: 'http', url });
});

test('three example prompts', () => assert.equal(EXAMPLE_PROMPTS.length, 3));
