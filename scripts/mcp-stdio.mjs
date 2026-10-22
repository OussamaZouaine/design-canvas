#!/usr/bin/env node
// stdio -> HTTP shim for clients that only launch stdio MCP servers (Claude Desktop).
// Reads one JSON-RPC message per line on stdin, POSTs it to the stateless StreamableHTTP endpoint and
// prints each reply as one line on stdout. The server keeps no session, so no state is needed here.
import readline from 'node:readline';

const URL_ = process.env.DESIGN_CANVAS_URL ?? 'http://localhost:3777/mcp';
const log = (m) => process.stderr.write(`[design-canvas shim] ${m}\n`); // stdout is reserved for protocol messages

async function forward(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return log('ignored a non-JSON line'); }
  try {
    const res = await fetch(URL_, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: line,
    });
    const body = await res.text();
    if (!body.trim()) return; // 202 for notifications
    const type = res.headers.get('content-type') ?? '';
    // The endpoint answers either plain JSON or an SSE stream whose "data:" lines are the messages.
    const out = type.includes('text/event-stream')
      ? body.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean)
      : [body.trim()];
    for (const o of out) process.stdout.write(o + '\n');
  } catch (e) {
    log(`cannot reach ${URL_}: ${e.message} (is "pnpm start" running?)`);
    if (msg.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: `Design Canvas server unreachable at ${URL_}` } }) + '\n');
  }
}

// Requests are handled concurrently; each answer carries its own id so order does not matter.
readline.createInterface({ input: process.stdin }).on('line', (l) => { if (l.trim()) forward(l); });
