import { useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { GESTURES, shortcutRows } from '@/lib/actions';
import { isMac } from '@/lib/platform';
import { useActions } from '@/shell/useActions';
import { useUi } from '@/store/ui';

// Mouse gestures are static (lib/actions.ts GESTURES); keyboard rows are generated from the action registry, the same
// list the palette and the main menu read, so adding a key there updates this dialog too.

// Opened from the top bar, the context menu or the ? key. Hint text uses <kbd> so screen readers read key names.
export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen);
  const set = useUi((s) => s.setShortcutsOpen);
  const actions = useActions();
  const groups = [...GESTURES, ...shortcutRows(actions, isMac)];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
      set(!useUi.getState().shortcutsOpen);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [set]);
  return (
    <Dialog open={open} onOpenChange={set}>
      <DialogContent className="max-h-[80vh] overflow-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Keyboard shortcuts</DialogTitle></DialogHeader>
        <div className="grid gap-4">
          {groups.map((g) => (
            <section key={g.title} aria-label={g.title}>
              <h3 className="mb-1 text-[11px] font-semibold text-muted-foreground">{g.title}</h3>
              <dl className="grid grid-cols-[minmax(0,13rem)_1fr] gap-x-3 gap-y-1">
                {g.rows.map(([k, d]) => (
                  <div key={k} className="contents">
                    <dt><kbd className="rounded border bg-field px-1.5 py-0.5 text-[11px]">{k}</kbd></dt>
                    <dd className="py-0.5 text-muted-foreground">{d}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
