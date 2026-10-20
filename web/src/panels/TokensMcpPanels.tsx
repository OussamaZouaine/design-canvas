import { Fragment } from 'react';
import { Button } from '@/components/ui/button';
import { useJson } from '@/hooks/useJson';
import { ago } from '@/lib/time';
import { useProject } from '@/store/project';
import { toast } from '@/store/toast';

// Clipboard can be blocked (permissions, insecure context), so failure tells the user to select the text instead.
async function copy(text: string, what: string) {
  try { await navigator.clipboard.writeText(text); toast(`Copied ${what}`); } catch { toast('Copy failed: select it manually'); }
}

const H = ({ children }: { children: React.ReactNode }) => <h4 className="mt-4 mb-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{children}</h4>;
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
        <button key={c.name + c.oklch} title={`${c.oklch}\n${c.value} · used ${c.count}×`} onClick={() => copy(c.oklch, c.name)} className="flex items-center gap-1.5 rounded-md p-1 text-left hover:bg-muted">
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
  if (!t) return <p className="p-3 text-muted-foreground">{failed ? 'Could not read tokens.' : 'Loading…'}</p>;
  if (!t.summary.styledElements) return <p className="p-3 text-muted-foreground">No styled elements yet. Tokens appear once there is a design to scan.</p>;
  const maxSpace = Math.max(...t.spacing.map((s) => s.count), 1);
  return (
    <div className="p-3">
      <H>Colour · OKLCH ({t.colors.length})</H>
      <Swatches list={t.colors} />
      {t.overlays.length > 0 && <><H>Overlays</H><Swatches list={t.overlays} /></>}
      <H>Type</H>
      {t.fontFamilies.map((f) => <KV key={f.name} k={<span style={{ fontFamily: f.value }}>{f.name}</span>} v={`×${f.count}`} />)}
      <KV k="Sizes" v={t.fontSizes.map((s) => s.value.replace('px', '')).join(' · ')} />
      <KV k="Weights" v={t.fontWeights.map((w) => w.value).join(' · ')} />
      <H>Radius</H>
      <div className="flex flex-wrap gap-1">{t.radii.map((r) => <span key={r.value} className="rounded-full bg-muted px-2 py-0.5 text-[10px]">{r.value}</span>)}</div>
      <H>{t.summary.spacingBase ? `Spacing · ${t.summary.spacingBase}px grid` : 'Spacing · no consistent grid'}</H>
      {t.spacing.map((s) => (
        <div key={s.value} className="flex items-center gap-2 py-0.5">
          <span className="tnum w-10">{s.value}</span>
          {/* Faded bar = off the detected grid. */}
          <div className="h-2 rounded-sm bg-[var(--selection)]" style={{ width: Math.max(4, (s.count / maxSpace) * 120), opacity: s.onGrid === false ? 0.4 : 1 }} />
          <span className="text-muted-foreground">×{s.count}</span>
        </div>
      ))}
      {t.shadows.length > 0 && (
        <>
          <H>Shadows</H>
          {t.shadows.map((s) => (
            <div key={s.value} className="flex items-center justify-between py-1">
              <span className="rounded-lg bg-[oklch(0.93_0.003_285)] px-3.5 py-2.5"><i className="block h-7 w-14 rounded-md bg-white" style={{ boxShadow: s.value }} /></span>
              <span className="text-muted-foreground">×{s.count}</span>
            </div>
          ))}
        </>
      )}
      <div className="mt-4 flex gap-1">
        <Button size="sm" onClick={() => copy(t.outputs.css, 'CSS variables')}>Copy CSS</Button>
        <Button size="sm" variant="outline" onClick={() => copy(t.outputs.json, 'JSON tokens')}>Copy JSON</Button>
        <Button size="sm" variant="outline" onClick={() => copy(t.outputs.tailwind, 'Tailwind config')}>Copy Tailwind</Button>
      </div>
    </div>
  );
}

interface Status { tabs: number; meter: { lastCallAt?: number; totalTokens: number; tools: { name: string; tokens: number; calls: number; errors?: number }[] } }

// MCP tab: is Claude talking to this server, how to connect it, and which tools cost the most tokens this session.
// Polled every 3 s because tool calls come from Claude Code, not this page, so no event announces them.
export function McpPanel() {
  const { data: s, failed } = useJson<Status>('/api/status', 0, 3000);
  if (!s) return <p className="p-3 text-muted-foreground">{failed ? 'Server not reachable.' : 'Loading…'}</p>;
  const setup = `claude mcp add --transport http design-canvas ${location.origin}/mcp --scope user`;
  const m = s.meter, maxTok = Math.max(...m.tools.map((t) => t.tokens), 1);
  const recent = !!m.lastCallAt && Date.now() - m.lastCallAt < 120_000;
  return (
    <div className="p-3">
      <KV k="Server" v={`running · ${s.tabs} tab${s.tabs === 1 ? '' : 's'} open`} />
      <KV k="Claude" v={m.lastCallAt ? `${recent ? 'active' : 'idle'} · last call ${ago(m.lastCallAt)}` : 'no calls yet'} />
      <H>Connect</H>
      <pre className="rounded-md bg-muted p-2 text-[11px] break-all whitespace-pre-wrap">{setup}</pre>
      <Button size="sm" className="mt-2" onClick={() => copy(setup, 'setup command')}>Copy command</Button>
      <H>Tool results this session · ~{m.totalTokens.toLocaleString()} tokens</H>
      {m.tools.length === 0 && <p className="text-muted-foreground">No tool calls yet. Estimates: text bytes ÷ 4, images by 28px patches.</p>}
      {m.tools.map((t) => (
        <Fragment key={t.name}>
          <div className="flex items-center gap-2 py-0.5">
            <span className="w-28 shrink-0 truncate" title={t.name}>{t.name}</span>
            <div className="h-2 rounded-sm bg-[var(--selection)]" style={{ width: Math.max(4, (t.tokens / maxTok) * 60) }} />
            <span className="tnum text-muted-foreground">{t.tokens.toLocaleString()} · ×{t.calls}{t.errors ? ` · ${t.errors} err` : ''}</span>
          </div>
        </Fragment>
      ))}
    </div>
  );
}
