import { useEffect } from 'react';
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import { Kbd } from '@/components/ui/kbd';
import { formatKeys, type Action } from '@/lib/actions';
import { isMac } from '@/lib/platform';
import { useUi } from '@/store/ui';
import { useActions } from '@/shell/useActions';

// Ctrl/Cmd+K palette: every registry action, page and board, searchable, with its shortcut. shadcn Command (cmdk)
// does the filtering and arrow-key navigation; the list itself comes from lib/actions.ts so it matches the menus.
export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const set = useUi((s) => s.setPaletteOpen);

  // Ctrl/Cmd+K toggles it from anywhere, even inside a text field (the browsers' own Ctrl+K is "search" and is not wanted here).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      set(!useUi.getState().paletteOpen);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [set]);

  return (
    <CommandDialog open={open} onOpenChange={set} title="Command palette" description="Search actions, tools, pages and boards" className="shadow-overlay sm:max-w-lg">
      {open && <PaletteBody close={() => set(false)} />}
    </CommandDialog>
  );
}

// cmdk's default matcher is fuzzy (typing "rect" finds "Toggle inspector"), which is noise in a list this size:
// match whole substrings only, and rank labels that start with the query first.
const match = (_id: string, search: string, words?: string[]) => {
  const q = search.trim().toLowerCase();
  if (!q) return 1;
  const label = (words?.[0] ?? '').toLowerCase();
  if (label.startsWith(q)) return 1;
  return (words ?? []).some((w) => w.toLowerCase().includes(q)) ? 0.5 : 0;
};

// Mounted only while open, so the registry (and the enabled getters) are read fresh each time the palette appears.
function PaletteBody({ close }: { close: () => void }) {
  const actions = useActions();
  // Group headings in registry order (Tools first, then Edit...); pages and boards come last.
  const groups = [...new Set(actions.map((a) => a.group))];
  const run = (a: Action) => { close(); a.run(); };
  return (
    <Command filter={match}>
      <CommandInput placeholder="Search actions, pages and boards" />
      <CommandList className="max-h-80">
        <CommandEmpty>No matches.</CommandEmpty>
        {groups.map((g) => (
          <CommandGroup key={g} heading={g}>
            {actions.filter((a) => a.group === g).map((a) => (
              // value = id (unique even when two boards share a name); label and keywords are what the search matches.
              <CommandItem key={a.id} value={a.id} keywords={[a.label, ...(a.keywords ?? [])]} disabled={!!a.enabled && !a.enabled()} onSelect={() => run(a)}>
                <span className="truncate">{a.label}</span>
                {a.keys && <CommandShortcut><Kbd>{formatKeys(a.keys[0], isMac)}</Kbd></CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
}
