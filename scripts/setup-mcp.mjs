#!/usr/bin/env node
// Register the design-canvas MCP endpoint in Claude Code and/or Claude Desktop.
//   node scripts/setup-mcp.mjs                 show what would change (dry run, changes nothing)
//   node scripts/setup-mcp.mjs --apply         do it
//   options: --target code|desktop|both (default both)  --port 3777  --config <desktop config path>
// Desktop: only the "design-canvas" key under mcpServers is written, a .bak copy is made first.
// Code: runs `claude mcp add` (Claude Code owns its own config file, so we never edit it by hand).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { claudeCodeCommand, desktopConfigPath, desktopEntry, mergeServer } from '../src/setup.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const apply = flag('apply');
const target = opt('target', 'both');
const port = Number(opt('port', 3777));
const shim = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'mcp-stdio.mjs');
console.log(apply ? 'Applying:' : 'Dry run (add --apply to make these changes):');

if (target === 'code' || target === 'both') {
  const cmd = claudeCodeCommand(port);
  console.log(`\n[Claude Code] ${cmd.join(' ')}`);
  if (apply) {
    const r = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', shell: process.platform === 'win32' });
    console.log(r.status === 0 ? '  done' : '  failed (is the claude CLI on PATH? "design-canvas" may already be registered)');
  }
}

if (target === 'desktop' || target === 'both') {
  const file = opt('config', desktopConfigPath());
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  try {
    const { text, changed, replaced } = mergeServer(existing, desktopEntry(shim, port));
    console.log(`\n[Claude Desktop] ${file}`);
    if (!changed) console.log('  already up to date');
    else {
      console.log(replaced ? '  replaces the existing "design-canvas" entry:\n  ' + JSON.stringify(replaced) : '  adds mcpServers["design-canvas"] (nothing else is touched):');
      console.log('  ' + JSON.stringify(desktopEntry(shim, port)));
      if (apply) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (existing) fs.copyFileSync(file, file + '.bak');
        fs.writeFileSync(file, text);
        console.log(`  written${existing ? ` (backup: ${file}.bak)` : ''}; restart Claude Desktop`);
      }
    }
  } catch (e) {
    console.error(`\n[Claude Desktop] skipped: ${e.message}`);
    process.exitCode = 1;
  }
}
