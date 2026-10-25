import { useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useUi } from '@/store/ui';

// Every shortcut of the canvas, grouped. One list so the dialog cannot drift from the context menu hints; when a
// shortcut is added in canvas/edit.ts or Shell.tsx, add it here too.
const GROUPS: { title: string; rows: [string, string][] }[] = [
  { title: 'Select', rows: [
    ['Click', 'Select a layer at the current level'], ['Double-click', 'Go into a layer (or edit text)'], ['Ctrl+click', 'Select the deepest layer'],
    ['Shift+click', 'Add or remove from the selection'], ['Drag on empty space', 'Marquee select'], ['Ctrl+A', 'Select everything at this level'],
    ['Enter / Shift+Enter', 'Go into / select the parent'], ['Tab / Shift+Tab', 'Next / previous sibling'], ['Esc', 'Up one level, then deselect'],
  ] },
  { title: 'Move and resize', rows: [
    ['Drag a layer in a flow', 'Reorder or move into another container'], ['Alt+drag', 'Copy while dragging'], ['Arrows', 'Nudge 1 px (reorder in a flow)'],
    ['Shift+arrows', 'Nudge 10 px'], ['Ctrl while dragging', 'Turn snapping off'], ['Shift while dragging', 'Lock the axis / keep the ratio'],
    ['Alt while resizing', 'Resize from the centre'], ['Alt+hover', 'Measure distances to the hovered layer'],
  ] },
  { title: 'Structure', rows: [
    ['Ctrl+G', 'Group the selection'], ['Ctrl+Shift+G or Ctrl+Alt+G', 'Ungroup'], ['Shift+A', 'Add auto layout (wrap in a flex container)'],
    ['Ctrl+D', 'Duplicate'], ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copy / cut / paste'], ['Delete', 'Delete'], ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
  ] },
  { title: 'Tools and view', rows: [
    ['V H F R O L P T I C', 'Move, Hand, Frame, Rectangle, Ellipse, Line, Pen, Text, Image, Comment'], ['Space+drag', 'Pan'], ['Shift+R', 'Rulers'], ['?', 'This list'],
  ] },
];

// Opened from the top bar, the context menu or the ? key. Hint text uses <kbd> so screen readers read key names.
export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen);
  const set = useUi((s) => s.setShortcutsOpen);
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
          {GROUPS.map((g) => (
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
