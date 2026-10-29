import { useEffect } from 'react';
import { Kbd } from '@/components/ui/kbd';
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
              {/* Description left, key chip right-aligned; rows are 32px like the menus. */}
              <dl>
                {g.rows.map(([k, d]) => (
                  <div key={k} className="flex h-8 items-center justify-between gap-4 text-[13px]">
                    <dd className="order-1 min-w-0 truncate">{d}</dd>
                    <dt className="order-2 shrink-0"><Kbd className="h-5 px-1.5 text-[11px]">{k}</Kbd></dt>
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
