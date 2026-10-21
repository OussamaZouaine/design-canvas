// Generation-quality evals: run fixed briefs through fresh Claude Code sessions and record numbers.
//
//   node examples/evals/run.mjs run <label> [--only id,id] [--repeat n] [--no-open]   run the briefs, save results/<label>.json
//   node examples/evals/run.mjs report <labelA> <labelB> ...             side-by-side table of saved runs
//
// Needs the server running (pnpm start) and `design-canvas` registered in Claude Code. Each brief gets its own
// throwaway-named project, so the run never touches real work (delete them afterwards from the home page).
// Runs go one at a time on purpose: the server's token meter is global, so overlapping runs would mix their numbers.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { meterDelta } from '../../src/evalmetrics.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.DC_URL || 'http://localhost:3777';
const RESULTS = path.join(HERE, 'results');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (p, body) => {
  const res = await fetch(BASE + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
  return res.json();
};

// The agent measures nothing here: it just designs. The wording asks for the normal workflow so the eval
// exercises the same path a user gets (guide, brief, review loop) instead of a special eval mode.
const promptFor = (brief, projectId) =>
  `Use the design-canvas MCP server. Work in project ${projectId}: it is a NEW, EMPTY project made for this task (do not create another one; there are no existing boards or comments to read).` +
  `Follow the server's guide. Brief: ${brief.prompt}\nWork autonomously, do not ask questions, and call finish_working when done.`;

// `claude -p` reads the prompt from stdin, which avoids shell-quoting the brief on Windows.
// shell: true is needed there because `claude` is a .cmd shim; the arguments are all fixed strings.
function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--output-format', 'json', '--allowedTools', 'mcp__design-canvas__*', '--max-turns', '60'], { shell: true, stdio: ['pipe', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('close', () => { try { resolve(JSON.parse(out)); } catch { resolve({ error: 'unparseable output', raw: out.slice(0, 500) }); } });
    child.stdin.end(prompt);
  });
}

function openInBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}

// check_layout needs a tab on the project. Open one and wait (up to 60 s) until the server sees it.
async function ensureTab(projectId, open) {
  const url = `${BASE}/p/${projectId}`;
  if (open) openInBrowser(url);
  else console.log(`  open this in a browser tab: ${url}`);
  for (let i = 0; i < 30; i++) {
    if ((await api(`/api/p/${projectId}/eval`)).tabOpen) return true;
    await sleep(2000);
  }
  return false;
}

async function run(label, only, open, repeat) {
  const briefs = JSON.parse(fs.readFileSync(path.join(HERE, 'briefs.json'), 'utf8')).filter((b) => !only || only.includes(b.id));
  if (!briefs.length) throw new Error('no briefs selected');
  fs.mkdirSync(RESULTS, { recursive: true });
  const results = [];
  // Repeats go one after another (never in parallel: the token meter is global). Each gets its own project.
  const jobs = briefs.flatMap((b) => Array.from({ length: repeat }, (_, i) => ({ brief: b, n: i + 1 })));
  for (const { brief, n } of jobs) {
    console.log(`\n== ${brief.id} #${n}: ${brief.title}`);
    const project = await api('/api/projects', { name: `eval ${label} ${brief.id} ${n}` });
    const projectId = project.id;
    const tab = await ensureTab(projectId, open);
    if (!tab) console.log('  no browser tab connected: layout will not be measured');
    const before = (await api('/api/status')).meter;
    const t0 = Date.now();
    const agent = await runClaude(promptFor(brief, projectId));
    const seconds = Math.round((Date.now() - t0) / 1000);
    const after = (await api('/api/status')).meter;
    const quality = await api(`/api/p/${projectId}/eval`);
    const r = {
      id: brief.id, repeat: n, projectId, seconds,
      turns: agent.num_turns ?? null,
      // Real token use from the CLI (the server meter only sees tool results, not the HTML the agent writes or the context it re-reads).
      inputTokens: agent.usage?.input_tokens ?? null, outputTokens: agent.usage?.output_tokens ?? null,
      cacheReadTokens: agent.usage?.cache_read_input_tokens ?? null, cacheWriteTokens: agent.usage?.cache_creation_input_tokens ?? null,
      costUsd: agent.total_cost_usd ?? null, agentError: agent.is_error || agent.error || null,
      ...meterDelta(before, after), ...quality,
    };
    results.push(r);
    console.log(`  ${seconds}s, boards ${r.boards}, overflow boards ${r.overflowBoards ?? '?'}, lint ${r.lintIssues}, screenshots ${r.screenshots}, tool tokens ${r.toolTokens}`);
  }
  const file = path.join(RESULTS, `${label}.json`);
  fs.writeFileSync(file, JSON.stringify({ label, at: new Date().toISOString(), results }, null, 2));
  console.log(`\nSaved ${file}. Look at the boards side by side for the taste check, then delete the eval projects.`);
}

// One row per brief, one column group per saved run, for the before / after comparison.
function report(labels) {
  const runs = labels.map((l) => JSON.parse(fs.readFileSync(path.join(RESULTS, `${l}.json`), 'utf8')));
  const cols = [['turns', 'turns'], ['costUsd', 'usd'], ['outputTokens', 'out'], ['cacheReadTokens', 'cache-read'], ['overflowBoards', 'overflow'], ['overflowNodes', 'nodes'], ['lintIssues', 'lint'], ['screenshots', 'shots'], ['fixRounds', 'fixes'], ['toolTokens', 'tokens'], ['brief', 'brief']];
  const ids = [...new Set(runs.flatMap((r) => r.results.map((x) => x.id)))];
  const lines = [`| brief | run | ${cols.map((c) => c[1]).join(' | ')} |`, `|${'---|'.repeat(cols.length + 2)}`];
  for (const id of ids) {
    for (const run of runs) {
      // With --repeat a brief has several results: average the numbers (one run alone is too noisy to compare).
      const xs = run.results.filter((r) => r.id === id);
      const avg = (k) => {
        const v = xs.map((x) => x[k]).filter((n) => typeof n === 'number');
        if (!v.length) return xs.length ? xs[0][k] ?? '?' : '-'; // non-numbers such as `brief`
        return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100;
      };
      lines.push(`| ${id} | ${run.label} (x${xs.length}) | ${cols.map(([k]) => avg(k)).join(' | ')} |`);
    }
  }
  console.log(lines.join('\n'));
}

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(name); return i < 0 ? null : rest[i + 1]; };
if (cmd === 'run' && rest[0] && !rest[0].startsWith('--')) {
  const repeat = Math.max(1, Math.min(5, parseInt(flag('--repeat') ?? '1', 10) || 1));
  await run(rest[0], flag('--only')?.split(','), !rest.includes('--no-open'), repeat);
} else if (cmd === 'report' && rest.length) {
  report(rest);
} else {
  console.log('usage: run.mjs run <label> [--only id,id] [--repeat n] [--no-open] | run.mjs report <label> [<label>...]');
  process.exit(1);
}
