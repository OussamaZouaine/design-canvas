import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeServer, desktopEntry, desktopConfigPath, claudeCodeCommand } from '../src/setup.mjs';

const entry = desktopEntry('/x/shim.mjs', 3790);

test('adds the server to an empty or missing config', () => {
  const r = mergeServer('', entry);
  assert.deepEqual(JSON.parse(r.text).mcpServers['design-canvas'], entry);
  assert.equal(r.changed, true);
});

test('keeps unrelated keys and other servers untouched', () => {
  const r = mergeServer(JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' } } }), entry);
  const cfg = JSON.parse(r.text);
  assert.equal(cfg.theme, 'dark');
  assert.deepEqual(cfg.mcpServers.other, { command: 'x' });
  assert.ok(cfg.mcpServers['design-canvas']);
});

test('reports no change when already registered, and shows what a replace overwrites', () => {
  const once = mergeServer('', entry).text;
  assert.equal(mergeServer(once, entry).changed, false);
  const r = mergeServer(once, desktopEntry('/y/shim.mjs'));
  assert.equal(r.changed, true);
  assert.deepEqual(r.replaced, entry);
});

test('refuses invalid or non-object config instead of overwriting it', () => {
  assert.throws(() => mergeServer('{oops', entry), /not valid JSON/);
  assert.throws(() => mergeServer('[]', entry), /not a JSON object/);
  assert.throws(() => mergeServer('{"mcpServers": []}', entry), /not an object/);
});

test('desktop path per platform and the claude command', () => {
  assert.match(desktopConfigPath('win32', { APPDATA: 'C:\\A' }, 'h'), /Claude[\\/]claude_desktop_config\.json$/);
  assert.match(desktopConfigPath('darwin', {}, '/h'), /Application Support/);
  assert.ok(claudeCodeCommand(3790).at(-1).endsWith(':3790/mcp'));
});
