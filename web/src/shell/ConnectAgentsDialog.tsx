import { useState } from 'react';
import { Check, ChevronRight, Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { agentList, EXAMPLE_PROMPTS, type Snippet } from '@/lib/agents';
import { cn } from '@/lib/utils';
import { toast } from '@/store/toast';
import { useUi } from '@/store/ui';

// The address an agent must use. In Vite dev the page is on 5173 (which proxies /mcp), but an agent outside the
// browser has to talk to the real server on 3777; in production the page and the server share one origin.
const serverOrigin = () => (import.meta.env.DEV ? 'http://localhost:3777' : location.origin);

// Clipboard can be blocked (permissions, insecure context), so failure tells the user to select the text instead.
async function copy(text: string, what: string) {
  try { await navigator.clipboard.writeText(text); toast(`Copied ${what}`); } catch { toast('Copy failed: select it manually'); }
}

// One line of copyable text with its button. The text is selectable, so manual copying still works if the clipboard is blocked.
function CopyLine({ text, what, className }: { text: string; what: string; className?: string }) {
  return (
    <div className={cn('flex items-start gap-2 rounded-lg bg-field px-3 py-2', className)}>
      <code className="min-w-0 flex-1 text-[12px] leading-relaxed break-all whitespace-pre-wrap select-all">{text}</code>
      <button
        type="button" aria-label={`Copy ${what}`} title={`Copy ${what}`} onClick={() => copy(text, what)}
        className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-[background-color,color,scale] duration-150 outline-none active:scale-96 focus-visible:ring-2 focus-visible:ring-ring/50 pointer-hover:bg-foreground/8 pointer-hover:text-foreground motion-reduce:transition-none"
      ><Copy className="size-3.5" /></button>
    </div>
  );
}

// Numbered step with the Paper-style check: all three are "done" in the sense that the page you are looking at is
// proof step 1 happened, and the others are instructions, so the check marks the step as ready to follow.
function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-[1.25rem_1fr] gap-x-3">
      <span aria-hidden className="mt-0.5 grid size-5 place-items-center rounded-full bg-selection text-white"><Check className="size-3" strokeWidth={3} /></span>
      <h3 className="text-[13px] font-semibold">{title}</h3>
      <div className="col-start-2 mt-2 grid gap-2">{children}</div>
    </section>
  );
}

function SnippetBlock({ s }: { s: Snippet }) {
  return (
    <div className="grid gap-1">
      <span className="text-[11px] text-muted-foreground">{s.file}</span>
      <CopyLine text={s.text} what={s.lang === 'text' ? 'text' : s.lang.toUpperCase()} />
    </div>
  );
}

// Opened from the canvas header and the projects home. Config text comes from the pure `lib/agents.ts`, so this file
// only lays it out; add or fix an agent there, not here.
export function ConnectAgentsDialog() {
  const open = useUi((s) => s.connectOpen);
  const set = useUi((s) => s.setConnectOpen);
  const [id, setId] = useState('claude-code');
  const [manualOpen, setManualOpen] = useState(false);
  const agents = agentList(serverOrigin());
  const agent = agents.find((a) => a.id === id) ?? agents[0];

  return (
    <Dialog open={open} onOpenChange={set}>
      <DialogContent className="max-h-[85vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-5 py-4"><DialogTitle className="text-sm font-semibold">Connect your agent</DialogTitle></DialogHeader>
        <div className="grid min-h-0 grid-rows-[auto_1fr] overflow-hidden md:h-[26rem] md:grid-cols-[11rem_1fr] md:grid-rows-1">
          {/* Agent list: a vertical rail on desktop, a scrollable chip row on a phone. */}
          <div role="tablist" aria-label="Agents" aria-orientation="vertical" className="flex gap-1 overflow-x-auto border-b p-2 md:flex-col md:overflow-x-visible md:overflow-y-auto md:border-r md:border-b-0">
            {agents.map((a) => (
              <button
                key={a.id} type="button" role="tab" aria-selected={a.id === agent.id}
                onClick={() => { setId(a.id); setManualOpen(false); }}
                className={cn(
                  'h-8 shrink-0 rounded-md px-2.5 text-left text-[13px] whitespace-nowrap text-muted-foreground transition-[background-color,color,scale] duration-150 outline-none active:scale-96 focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none pointer-hover:bg-foreground/6 pointer-hover:text-foreground',
                  a.id === agent.id && 'bg-field text-foreground',
                )}
              >{a.label}</button>
            ))}
          </div>

          <div role="tabpanel" className="grid content-start gap-5 overflow-y-auto p-5">
            <Step title="Start the canvas">
              <p className="text-muted-foreground">You are looking at it, so this one is done. If it ever stops, run <code className="rounded bg-field px-1">pnpm start</code> in the design-canvas folder.</p>
            </Step>

            <Step title={`Connect to ${agent.label}`}>
              {agent.link && (
                <a
                  href={agent.link.href}
                  className="inline-flex h-8 w-fit items-center gap-1.5 rounded-lg bg-selection px-3 text-[13px] font-medium text-white outline-none transition-[opacity,scale] duration-150 active:scale-96 focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none pointer-hover:opacity-90"
                ><ExternalLink className="size-3.5" />{agent.link.label}</a>
              )}
              {agent.command && (
                <div className="grid gap-1">
                  <CopyLine text={agent.command.text} what="command" />
                  {agent.command.hint && <span className="text-[11px] text-muted-foreground">{agent.command.hint}</span>}
                </div>
              )}
              <div className="rounded-lg border">
                <button
                  type="button" aria-expanded={manualOpen} onClick={() => setManualOpen(!manualOpen)}
                  className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <ChevronRight aria-hidden className={cn('size-3.5 text-muted-foreground transition-[rotate] duration-150 motion-reduce:transition-none', manualOpen && 'rotate-90')} />
                  Or, install manually
                </button>
                {manualOpen && <div className="grid gap-3 px-3 pb-3">{agent.manual.map((s) => <SnippetBlock key={s.file} s={s} />)}</div>}
              </div>
              <ul className="grid gap-1 text-[12px] text-muted-foreground">
                {agent.notes.map((n) => <li key={n}>{n}</li>)}
                <li>Keep a project open in a browser tab: screenshots are rendered by the tab.</li>
              </ul>
            </Step>

            <Step title="Run your first prompt">
              <p className="text-muted-foreground">Paste one of these into {agent.label} to test the connection:</p>
              {EXAMPLE_PROMPTS.map((p) => (
                <button
                  key={p} type="button" onClick={() => copy(p, 'prompt')}
                  className="flex items-start gap-2 rounded-lg bg-field px-3 py-2 text-left text-[12px] outline-none transition-[background-color,scale] duration-150 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none pointer-hover:bg-field-hover"
                ><Copy aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />{p}</button>
              ))}
            </Step>
          </div>
        </div>
        <DialogFooter className="items-center border-t px-5 py-3 sm:justify-between">
          <span className="text-[12px] text-muted-foreground">Restart the agent after adding it.</span>
          <Button onClick={() => set(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
