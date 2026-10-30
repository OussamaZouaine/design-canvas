import { Palette } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { sendEdit } from '@/lib/htmlTree';
import { Section } from '@/panels/inspector/controls';
import { useCanvas } from '@/store/canvas';
import { useProject } from '@/store/project';
import { Tip } from '@/ui/Tip';

// Theme tab: edit the project's design tokens (CSS variables every board can share). Each edit is one server write
// and one undo step, visible to Claude through get_design_system, and comes back in the doc, which restyles the boards.
// Not the Tokens tab, which only reads what the designs already use.
export function ThemePanel({ projectId }: { projectId: string }) {
  const theme = useProject((s) => s.doc?.theme) ?? { tokens: {}, modes: {} };
  const view = useCanvas((s) => s.mode);
  const setView = useCanvas((s) => s.setMode);
  const modes = Object.keys(theme.modes ?? {});
  // A mode that was deleted (by Claude, or undo) falls back to Base instead of showing a ghost.
  const mode = view === 'base' || modes.includes(view) ? view : 'base';
  useEffect(() => { if (mode !== view) setView('base'); }, [mode, view, setView]);

  const post = (body: object) => sendEdit(projectId, 'theme', body);
  const modeArg = mode === 'base' ? undefined : mode;
  const [name, setName] = useState('');
  const [value, setValue] = useState('');

  if (!Object.keys(theme.tokens).length) {
    return (
      <Empty className="py-10">
        <EmptyHeader>
          <EmptyMedia variant="icon"><Palette /></EmptyMedia>
          <EmptyTitle className="font-display text-base tracking-[-0.03em]">No tokens yet</EmptyTitle>
          <EmptyDescription>Tokens are CSS variables (var(--color-primary)) that every board can share, so one edit restyles the whole design.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent><Button size="sm" onClick={() => post({ preset: 'starter' })}>Load starter scale</Button></EmptyContent>
      </Empty>
    );
  }

  const overrides = mode === 'base' ? {} : theme.modes?.[mode] ?? {};
  // Group by the prefix before the first dash (color-, space-, radius-...), keeping insertion order.
  const families = new Map<string, string[]>();
  for (const n of Object.keys(theme.tokens)) {
    const f = n.split('-')[0];
    families.set(f, [...(families.get(f) ?? []), n]);
  }
  const addMode = () => {
    // Seed the new mode with the colour tokens so there is something to edit.
    const colours = Object.fromEntries(Object.entries(theme.tokens).filter(([k]) => k.startsWith('color-')));
    post({ tokens: colours, mode: 'dark' });
  };
  const add = () => {
    if (!name.trim() || !value.trim()) return;
    post({ tokens: { [name.trim()]: value.trim() } });
    setName(''); setValue('');
  };

  return (
    <>
      <div className="flex flex-wrap gap-1 border-b px-3 py-2">
        {['base', ...modes].map((m) => (
          <Button key={m} size="sm" variant={m === mode ? 'secondary' : 'ghost'} aria-pressed={m === mode} onClick={() => setView(m)}>{m === 'base' ? 'Base' : m}</Button>
        ))}
        {!modes.includes('dark') && <Tip label="Add a dark mode that overrides the colour tokens"><Button size="sm" variant="ghost" onClick={addMode}>+ dark</Button></Tip>}
      </div>
      {mode !== 'base' && <p className="border-b px-3 py-2 text-[11px] text-muted-foreground">Only tokens you fill in are overridden in this mode; empty ones inherit the base value.</p>}
      {[...families].map(([f, names]) => (
        <Section key={f} title={f[0].toUpperCase() + f.slice(1)}>
          <div>
          {names.map((n) => (
            <TokenRow
              // Keyed by the shown value so an outside change (Claude, undo) resets a half-typed draft.
              key={`${n}=${theme.tokens[n]}|${overrides[n] ?? ''}`}
              name={n} base={theme.tokens[n]} mode={mode} override={overrides[n]}
              onCommit={(v) => post({ tokens: { [n]: v }, mode: modeArg })}
              onDelete={() => post({ tokens: { [n]: null } })}
            />
          ))}
          </div>
        </Section>
      ))}
      {mode === 'base' && (
        <Section title="Add token">
          <div className="flex gap-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="color-accent" aria-label="New token name" spellCheck={false} />
            <Input value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} placeholder="oklch(0.7 0.15 30)" aria-label="New token value" spellCheck={false} />
            <Button size="sm" onClick={add}>Add</Button>
          </div>
        </Section>
      )}
    </>
  );
}

function TokenRow({ name, base, mode, override, onCommit, onDelete }: {
  name: string; base: string; mode: string; override?: string; onCommit: (v: string | null) => void; onDelete: () => void;
}) {
  const inherited = mode !== 'base' && override === undefined;
  const shown = inherited ? base : mode === 'base' ? base : override!;
  const [draft, setDraft] = useState(inherited ? '' : shown);
  const commit = () => {
    const v = draft.trim();
    if (v === (inherited ? '' : shown)) return; // unchanged: no server write, no undo step
    // Empty in a mode view means "stop overriding"; empty in the base view is ignored (a token needs a value).
    if (!v && mode === 'base') { setDraft(base); return; }
    onCommit(v || null);
  };
  const isColour = name.startsWith('color-') && CSS.supports('color', shown);
  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <i className={isColour ? 'size-4 shrink-0 rounded border' : 'size-4 shrink-0 rounded border border-dashed'} style={isColour ? { background: shown } : undefined} />
      <span className="w-24 shrink-0 truncate text-muted-foreground" title={`var(--${name})`}>{name}</span>
      <Input
        value={draft} placeholder={inherited ? base : undefined} aria-label={name} spellCheck={false}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      />
      {mode === 'base' && <Tip label="Delete token"><Button variant="ghost" size="icon" aria-label={`Delete ${name}`} onClick={onDelete}>×</Button></Tip>}
    </div>
  );
}
