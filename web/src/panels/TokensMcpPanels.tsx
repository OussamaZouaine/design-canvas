import { Palette } from 'lucide-react';
import { Fragment } from 'react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { useJson } from '@/hooks/useJson';
import { ago } from '@/lib/time';
import { useNow } from '@/panels/AgentsPanel';
import { EfficiencyPanel } from '@/panels/EfficiencyPanel';
import { Section } from '@/panels/inspector/controls';
import { MemorySection } from '@/panels/MemorySection';
import { useAgents } from '@/store/agents';
import { useProject } from '@/store/project';
import { toast } from '@/store/toast';

// Clipboard can be blocked (permissions, insecure context), so failure tells the user to select the text instead.
async function copy(text: string, what: string) {
  try { await navigator.clipboard.writeText(text); toast(`Copied ${what}`); } catch { toast('Copy failed: select it manually'); }
}

const KV = ({ k, v }: { k: React.ReactNode; v: React.ReactNode }) => <div className="flex items-center justify-between gap-2 py-0.5"><span>{k}</span><span className="text-muted-foreground">{v}</span></div>;

interface Swatch { name: string; oklch: string; value: string; count: number }
interface TokenScan {
  summary: { styledElements: number; spacingBase?: number | null };
  colors: Swatch[]; overlays: Swatch[];
  fontFamilies: { name: string; value: string; count: number }[];
  fontSizes: { value: string }[]; fontWeights: { value: string }[];
  radii: { value: string }[];
  spacing: { value: string; count: number; onGrid?: boolean }[];
  shadows: { value: string; count: number }[];
  outputs: { css: string; json: string; tailwind: string };
}

function Swatches({ list }: { list: Swatch[] }) {
  return (
    <div className="grid grid-cols-2 gap-1">
      {list.map((c) => (
        <button key={c.name + c.oklch} title={`${c.oklch}\n${c.value} · used ${c.count}×`} onClick={() => copy(c.oklch, c.name)} className="flex items-center gap-1.5 rounded-md p-1 text-left pointer-hover:hover:bg-field-hover">
          <i className="size-5 shrink-0 rounded border" style={{ background: c.oklch }} />
          <span className="min-w-0"><b className="block truncate font-medium">{c.name}</b><small className="text-muted-foreground">{c.value.startsWith('#') ? c.value : ''} ×{c.count}</small></span>
        </button>
      ))}
    </div>
  );
}

// Tokens tab: READS what the designs already use (colours, type, spacing...). Not the Theme tab, which edits tokens.
// Refetches when the document changes, since the scan is computed server-side from the boards.
export function TokensPanel({ projectId }: { projectId: string }) {
  const doc = useProject((s) => s.doc);
  const { data: t, failed } = useJson<TokenScan>(`/api/p/${projectId}/tokens`, doc);
  // Memory is project data, not scan output, so it shows even while the scan is loading or empty.
  if (!t) return <><MemorySection projectId={projectId} /><p className="px-3 py-3 text-muted-foreground">{failed ? 'Could not read tokens.' : 'Loading…'}</p></>;
  if (!t.summary.styledElements) {
    return (
      <>
        <MemorySection projectId={projectId} />
        <Empty className="py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Palette /></EmptyMedia>
            <EmptyTitle className="font-display text-base tracking-[-0.03em]">Nothing to scan yet</EmptyTitle>
            <EmptyDescription>Tokens appear once there is a design to scan.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );
  }
  const maxSpace = Math.max(...t.spacing.map((s) => s.count), 1);
  return (
    <>
      <MemorySection projectId={projectId} />
      <Section title={`Colour (${t.colors.length}, OKLCH)`}><Swatches list={t.colors} /></Section>
      {t.overlays.length > 0 && <Section title="Overlays"><Swatches list={t.overlays} /></Section>}
      <Section title="Type">
        <div>
          {t.fontFamilies.map((f) => <KV key={f.name} k={<span style={{ fontFamily: f.value }}>{f.name}</span>} v={`×${f.count}`} />)}
          <KV k="Sizes" v={t.fontSizes.map((s) => s.value.replace('px', '')).join(', ')} />
          <KV k="Weights" v={t.fontWeights.map((w) => w.value).join(', ')} />
        </div>
      </Section>
      <Section title="Radius">
        <div className="flex flex-wrap gap-1">{t.radii.map((r) => <span key={r.value} className="rounded-full bg-field px-2 py-0.5 text-[11px]">{r.value}</span>)}</div>
      </Section>
      <Section title={t.summary.spacingBase ? `Spacing (${t.summary.spacingBase}px grid)` : 'Spacing (no consistent grid)'}>
        <div>
          {t.spacing.map((s) => (
            <div key={s.value} className="flex items-center gap-2 py-0.5">
              <span className="tnum w-10">{s.value}</span>
              {/* Faded bar = off the detected grid. */}
              <div className="h-2 rounded-sm bg-[var(--selection)]" style={{ width: Math.max(4, (s.count / maxSpace) * 120), opacity: s.onGrid === false ? 0.4 : 1 }} />
              <span className="text-muted-foreground">×{s.count}</span>
            </div>
          ))}
        </div>
      </Section>
      {t.shadows.length > 0 && (
        <Section title="Shadows">
          {t.shadows.map((s) => (
            <div key={s.value} className="flex items-center justify-between py-1">
              <span className="rounded-lg bg-[oklch(0.93_0.003_285)] px-3.5 py-2.5"><i className="block h-7 w-14 rounded-md bg-white" style={{ boxShadow: s.value }} /></span>
              <span className="text-muted-foreground">×{s.count}</span>
            </div>
          ))}
        </Section>
      )}
      <div className="flex gap-1 px-3 py-3">
        <Button size="sm" onClick={() => copy(t.outputs.css, 'CSS variables')}>Copy CSS</Button>
        <Button size="sm" variant="outline" onClick={() => copy(t.outputs.json, 'JSON tokens')}>Copy JSON</Button>
        <Button size="sm" variant="outline" onClick={() => copy(t.outputs.tailwind, 'Tailwind config')}>Copy Tailwind</Button>
      </div>
    </>
  );
}

interface Status { tabs: number }

// MCP tab: is an agent talking to this server, how to connect it, and which tools cost the most tokens in this project.
// Fed by the live call log (SSE `call` events in the agents store), so there is no polling; only the tab count is
// fetched, once, because nothing pushes it and it rarely changes.
export function McpPanel({ projectId }: { projectId: string }) {
  const calls = useAgents((s) => s.calls);
  const { data: s } = useJson<Status>('/api/status');
  const now = useNow();
  const setup = `claude mcp add --transport http design-canvas ${location.origin}/mcp --scope user`;
  // Aggregate per tool from the stored calls (newest 300). Tokens are the server's estimate of each tool result.
  const byTool = new Map<string, { name: string; tokens: number; calls: number; errors: number }>();
  for (const c of calls) {
    const t = byTool.get(c.tool) ?? { name: c.tool, tokens: 0, calls: 0, errors: 0 };
    t.tokens += c.tokens; t.calls++; if (!c.ok) t.errors++;
    byTool.set(c.tool, t);
  }
  const tools = [...byTool.values()].sort((a, b) => b.tokens - a.tokens);
  const total = tools.reduce((n, t) => n + t.tokens, 0), maxTok = Math.max(...tools.map((t) => t.tokens), 1);
  const last = calls[0]?.t, recent = !!last && now - last < 120_000;
  return (
    <>
      <Section title="Status">
        <div>
          <KV k="Server" v={s ? `running, ${s.tabs} tab${s.tabs === 1 ? '' : 's'} open` : 'running'} />
          <KV k="Agents" v={last ? `${recent ? 'active' : 'idle'}, last call ${ago(last)}` : 'no calls yet'} />
        </div>
      </Section>
      <Section title="Connect">
        <pre className="rounded-md bg-field p-2 text-[11px] break-all whitespace-pre-wrap">{setup}</pre>
        <Button size="sm" className="self-start" onClick={() => copy(setup, 'setup command')}>Copy command</Button>
      </Section>
      <Section title={`Tool results (~${total.toLocaleString()} tokens)`}>
        {tools.length === 0 && <p className="text-muted-foreground">No tool calls yet. Estimates: text bytes ÷ 4, images by 28px patches.</p>}
        {tools.map((t) => (
          <Fragment key={t.name}>
            <div className="flex items-center gap-2 py-0.5">
              <span className="w-28 shrink-0 truncate" title={t.name}>{t.name}</span>
              <div className="h-2 rounded-sm bg-[var(--selection)]" style={{ width: Math.max(4, (t.tokens / maxTok) * 60) }} />
              <span className="tnum text-muted-foreground">{t.tokens.toLocaleString()} · ×{t.calls}{t.errors ? ` · ${t.errors} err` : ''}</span>
            </div>
          </Fragment>
        ))}
      </Section>
      <EfficiencyPanel projectId={projectId} />
    </>
  );
}
