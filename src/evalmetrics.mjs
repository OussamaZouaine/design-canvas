// Numbers for the generation-quality evals (examples/evals): how well did one project come out?
// Pure functions so they are unit-tested without a browser; the server feeds them the lint issues
// and the browser's layout reports (see layout.mjs for the report shape).

import { overflows } from './layout.mjs';

// Boards that were fitted to their content by hand (fit_artboard) or grown by the server do not
// overflow any more, so this counts what a user would still see clipped.
export function layoutMetrics(reports) {
  const bad = reports.filter(overflows);
  return {
    boardsMeasured: reports.length,
    overflowBoards: bad.length,
    // Nodes that stick out of the frame or hide their own content, summed over boards.
    overflowNodes: bad.reduce((n, r) => n + r.outside.length + r.clipped.length, 0),
  };
}

// Lint output is one string per issue; the part before the first colon names the rule
// closely enough to compare runs ("contrast", "spacing", ...) without a second lint format.
export function lintMetrics(issuesByBoard) {
  const all = Object.values(issuesByBoard).flat();
  return { lintIssues: all.length, lintBoards: Object.values(issuesByBoard).filter((l) => l.length).length };
}

// Difference between two meter snapshots (GET /api/status) = what one agent run cost.
// The meter is global to the server, so evals must run one at a time.
export function meterDelta(before, after) {
  const prev = new Map(before.tools.map((t) => [t.name, t]));
  const tools = after.tools
    .map((t) => {
      const p = prev.get(t.name) ?? { calls: 0, tokens: 0, errors: 0 };
      return { name: t.name, calls: t.calls - p.calls, tokens: t.tokens - p.tokens, errors: t.errors - p.errors };
    })
    .filter((t) => t.calls > 0);
  const calls = (name) => tools.find((t) => t.name === name)?.calls ?? 0;
  return {
    toolCalls: tools.reduce((n, t) => n + t.calls, 0),
    toolTokens: tools.reduce((n, t) => n + t.tokens, 0),
    screenshots: calls('get_screenshot'),
    // "Fix rounds": calls whose only purpose is repairing something the first write got wrong.
    fixRounds: calls('fit_artboard') + calls('update_styles') + calls('history'),
    layoutChecks: calls('check_layout'),
    tools,
  };
}
