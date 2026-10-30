import { Section } from '@/panels/inspector/controls';
import { useEffect, useState } from 'react';
import { useJson } from '@/hooks/useJson';
import { useAgents } from '@/store/agents';

// Cost + efficiency dashboard (the lower half of the MCP tab). Everything comes from GET /api/p/<id>/efficiency,
// which the server derives from the call log: the model pays nothing for it. All strings (agent names, prompts,
// tool names) are untrusted, so they are rendered as React text only.

interface Hint { id: string; title: string; detail: string; count: number }
interface ToolRow { tool: string; calls: number; tokens: number; errors: number }
interface Slow { id: string; tool: string; action: string | null; ms: number; tokens: number; ok: boolean }
interface Stats {
  calls: number; turns: number; tokens: number; errors: number; retries: number; screenshots: number; screenshotPixels: number;
  ms: number; tools: ToolRow[]; slowest: Slow[]; hints: Hint[];
}
interface Prompt extends Stats { prompt: string | null; t: number }
interface Session extends Stats { agent: { id: string; name: string; color: string }; prompts: Prompt[] }
interface Report {
  window: { calls: number; truncated: boolean };
  total: Stats;
  fixed: { toolCount: number; toolsListTokens: number; instructionsTokens: number; guideTokens: number; total: number } | null;
  sessions: Session[];
}

const n = (x: number) => x.toLocaleString();
const secs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const mpx = (px: number) => `${(px / 1e6).toFixed(1)} Mpx`;

// A bar scaled to the largest sibling. One hue (the app's selection colour) because the bars show one measure.
function Bar({ value, max }: { value: number; max: number }) {
  return <div className="h-1.5 rounded-sm bg-[var(--selection)]" style={{ width: `${Math.max(2, (value / Math.max(max, 1)) * 100)}%` }} />;
}

// Small number tiles; the label stays visible (no colour-only meaning) and errors turn red only when non-zero.
function Tiles({ s }: { s: Stats }) {
  const items: [string, string, boolean?][] = [
    ['calls', n(s.calls)], ['turns', n(s.turns)], ['tokens', n(s.tokens)],
    ['shots', s.screenshots ? `${s.screenshots} · ${mpx(s.screenshotPixels)}` : '0'],
    ['errors', `${s.errors}${s.retries ? ` (${s.retries} retried)` : ''}`, s.errors > 0],
  ];
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {items.map(([k, v, bad]) => (
        <div key={k} className="rounded-md bg-muted px-2 py-1">
          <div className="text-[10px] text-muted-foreground">{k}</div>
          <div className={`tnum text-[12px] font-medium ${bad ? 'text-destructive' : ''}`}>{v}</div>
        </div>
      ))}
    </div>
  );
}

// Waste hints use a warm tint set as CSS variables on the panel root (OKLCH, with a dark-mode variant).
function Hints({ hints }: { hints: Hint[] }) {
  if (!hints.length) return null;
  return (
    <ul className="mt-1.5 space-y-1">
      {hints.map((h) => (
        <li key={h.id} className="rounded-md border border-[var(--hint-border)] bg-[var(--hint-bg)] px-2 py-1 text-[11px]">
          <span className="font-medium">{h.title}</span> <span className="tnum text-muted-foreground">×{h.count}</span>
          <div className="text-muted-foreground">{h.detail}</div>
        </li>
      ))}
    </ul>
  );
}

function Detail({ s }: { s: Stats }) {
  const max = Math.max(...s.tools.map((t) => t.tokens), 1);
  return (
    <div className="mt-1.5">
      {s.tools.slice(0, 6).map((t) => (
        <div key={t.tool} className="py-0.5">
          <div className="flex justify-between gap-2"><span className="truncate" title={t.tool}>{t.tool}</span><span className="tnum shrink-0 text-muted-foreground">{n(t.tokens)} · ×{t.calls}{t.errors ? ` · ${t.errors} err` : ''}</span></div>
          <Bar value={t.tokens} max={max} />
        </div>
      ))}
      {s.slowest.length > 0 && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Slowest: {s.slowest.map((c) => `${c.tool}${c.action ? ` · ${c.action}` : ''} ${secs(c.ms)}`).join(', ')}
        </p>
      )}
      <Hints hints={s.hints} />
    </div>
  );
}

export function EfficiencyPanel({ projectId }: { projectId: string }) {
  // Refetch shortly after the call log changes. The debounce matters: an agent emits calls in bursts and every
  // refetch recomputes the report server-side.
  const lastId = useAgents((s) => s.calls[0]?.id);
  const [key, setKey] = useState(lastId);
  useEffect(() => { const t = setTimeout(() => setKey(lastId), 800); return () => clearTimeout(t); }, [lastId]);
  const { data: r, failed } = useJson<Report>(`/api/p/${projectId}/efficiency`, key);

  if (!r) return <p className="px-3 py-3 text-muted-foreground">{failed ? 'Cost numbers unavailable.' : 'Loading…'}</p>;
  const maxPrompt = Math.max(...r.sessions.flatMap((s) => s.prompts.map((p) => p.tokens)), 1);
  return (
    <div className="efficiency">
      {r.fixed && (
        <Section title={`Fixed cost per session (~${n(r.fixed.total)} tokens)`}>
          <div>
            {([['tools/list', `${r.fixed.toolCount} tools`, r.fixed.toolsListTokens], ['instructions', 'sent on connect', r.fixed.instructionsTokens], ['get_guide()', 'default topic', r.fixed.guideTokens]] as const).map(([k, note, v]) => (
              <div key={k} className="flex items-center justify-between gap-2 py-0.5"><span>{k} <span className="text-muted-foreground">{note}</span></span><span className="tnum text-muted-foreground">{n(v)}</span></div>
            ))}
          </div>
        </Section>
      )}
      <Section title={`This project (${n(r.window.calls)} logged calls)`}>
      {r.window.calls === 0 ? <p className="text-muted-foreground">No tool calls yet.</p> : <Tiles s={r.total} />}
      {r.window.truncated && <p className="text-[11px] text-muted-foreground">Only the newest 500 calls are kept, so older work is not counted.</p>}
      {r.sessions.map((s) => (
        <section key={s.agent.id} className="mt-3">
          <div className="mb-1 flex items-center gap-1.5 font-medium">
            <i className="size-2 shrink-0 rounded-full" style={{ background: s.agent.color }} /><span className="truncate">{s.agent.name}</span>
          </div>
          <Tiles s={s} />
          <Hints hints={s.hints} />
          {s.prompts.map((p) => (
            <details key={p.t} className="mt-1.5 rounded-md border border-border px-2 py-1">
              <summary className="cursor-pointer list-none">
                <div className="flex justify-between gap-2">
                  <span className="truncate" title={p.prompt ?? undefined}>{p.prompt ?? '(before the first prompt)'}</span>
                  <span className="tnum shrink-0 text-muted-foreground">{p.turns} turns · {n(p.tokens)}</span>
                </div>
                <Bar value={p.tokens} max={maxPrompt} />
              </summary>
              <Detail s={p} />
            </details>
          ))}
        </section>
      ))}
      </Section>
    </div>
  );
}
