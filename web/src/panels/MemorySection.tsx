import { X } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { useProject } from '@/store/project';
import { toast } from '@/store/toast';
import { Tip } from '@/ui/Tip';

const H = ({ children }: { children: React.ReactNode }) => <h4 className="mb-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{children}</h4>;

// Design memory (src/memory.mjs): standing rules agents must follow plus the decisions they recorded. Agents receive both
// in `start`, so the user edits them here. Entries arrive over SSE (`memory`), so a rule an agent adds appears live.
// All text goes through React text nodes (never innerHTML): agent-written text is untrusted.
export function MemorySection({ projectId }: { projectId: string }) {
  const memory = useProject((s) => s.memory);
  const [draft, setDraft] = useState('');
  const rules = memory.filter((m) => m.kind === 'rule');
  const decisions = memory.filter((m) => m.kind === 'decision').slice().reverse();

  // No local state to update on success: the server echoes the new list over SSE.
  const call = async (url: string, init: RequestInit) => {
    try {
      const r = await fetch(url, init);
      if (!r.ok) toast(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Could not save memory');
      return r.ok;
    } catch { toast('Could not reach the server'); return false; }
  };
  const addRule = async () => {
    const text = draft.trim();
    if (!text) return;
    if (await call(`/api/p/${projectId}/memory`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'rule', text }) })) setDraft('');
  };
  const remove = (id: string) => void call(`/api/p/${projectId}/memory?id=${id}`, { method: 'DELETE' });

  const row = (m: (typeof memory)[number]) => (
    <li key={m.id} className="group flex items-start gap-1.5 py-0.5">
      <span className="min-w-0 flex-1 break-words">
        {m.text}
        {m.kind === 'decision' && <small className="ml-1 text-muted-foreground">{new Date(m.at).toLocaleDateString()}{m.agent ? ` · ${m.agent}` : ''}</small>}
      </span>
      <Tip label="Remove"><button aria-label="Remove" onClick={() => remove(m.id)} className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground transition-colors duration-150 active:scale-[0.96] pointer-hover:hover:bg-field-hover pointer-hover:hover:text-foreground">
        <X className="size-3" />
      </button></Tip>
    </li>
  );

  return (
    <section className="mb-4">
      <H>Memory · rules agents follow</H>
      {rules.length === 0 && <p className="mb-1 text-muted-foreground">No rules yet. Add a one-line rule, e.g. “one accent colour, hue 150”.</p>}
      <ul>{rules.map(row)}</ul>
      <form className="mt-1.5" onSubmit={(e) => { e.preventDefault(); void addRule(); }}>
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={200} placeholder="Add a rule and press Enter" className="h-7 text-xs" />
      </form>
      {decisions.length > 0 && (
        <>
          <h4 className="mt-3 mb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Decisions</h4>
          <ul>{decisions.slice(0, 8).map(row)}</ul>
          {decisions.length > 8 && <p className="text-muted-foreground">+{decisions.length - 8} older (memory list)</p>}
        </>
      )}
    </section>
  );
}
