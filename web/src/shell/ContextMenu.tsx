import { useEffect, useRef } from 'react';
import { useCanvas } from '@/store/canvas';
import { useComments } from '@/store/comments';

interface Item { label: string; hint?: string; run: () => void; disabled?: boolean; danger?: boolean }

// Right-click menu for the canvas. Hand-built (not a Base UI ContextMenu) because the trigger is the
// imperative canvas, which fires a `contextmenu` event from outside React; the engine reports it through
// the store and this renders at the pointer. Items are real buttons, so Tab, Enter and Space work for free;
// arrows move focus, Escape and any outside press close it.
export function CanvasContextMenu() {
  const menu = useCanvas((s) => s.menu);
  const engine = useCanvas((s) => s.engine);
  const close = () => useCanvas.getState().setMenu(null);
  const ref = useRef<HTMLDivElement>(null);

  // Focus the first enabled item when it opens so the keyboard can drive it straight away.
  useEffect(() => {
    if (menu) ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    // Capture phase: the canvas stops some pointer events, and the menu must still close.
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  if (!menu || !engine) return null;
  const { id } = menu;
  const isBoard = !!id?.startsWith('A');
  const fromLayers = !!menu.extra;
  const parent = id ? engine.parentOf(id) : null;
  const act = (fn: () => void) => () => { close(); fn(); };

  const items: (Item | 'sep')[] = [
    ...(id ? [
      // The comment popover is anchored to a canvas point, so it only makes sense from the canvas, not the Layers list.
      ...(fromLayers ? [] : [{ label: 'Add comment', run: () => useComments.getState().openNew(id, menu.x, menu.y) } as Item, 'sep' as const]),
      ...(menu.extra ?? []),
      ...(fromLayers && menu.extra?.length ? ['sep' as const] : []),
      { label: 'Select parent', hint: 'Esc', run: () => engine.selectNode(parent), disabled: !parent } as Item,
      { label: 'Copy', hint: 'Ctrl+C', run: () => engine.copy(id), disabled: isBoard } as Item,
    ] : []),
    { label: 'Paste', hint: 'Ctrl+V', run: () => engine.paste(), disabled: !engine.canPaste },
    ...(id ? [
      { label: 'Duplicate', hint: 'Ctrl+D', run: () => engine.duplicate(id) } as Item,
      'sep' as const,
      { label: isBoard ? 'Delete artboard' : 'Delete', hint: 'Del', run: () => engine.remove(id), danger: true } as Item,
    ] : []),
    ...(fromLayers ? [] : ['sep' as const, { label: 'Fit all artboards', run: () => engine.fit() } as Item]),
  ];

  // Arrow keys hop between enabled items (roving focus).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
  };

  // Clamp so the menu never opens half off-screen (about 190 x 260 px).
  const left = Math.min(menu.x, window.innerWidth - 200);
  const top = Math.min(menu.y, window.innerHeight - 270);

  return (
    <div
      ref={ref} role="menu" aria-label="Canvas actions" onKeyDown={onKeyDown} style={{ left, top }}
      className="ctx-menu fixed z-50 w-48 rounded-lg border bg-popover p-1 text-[12px] text-popover-foreground shadow-lg"
    >
      {items.map((it, i) => it === 'sep'
        ? <div key={i} role="separator" className="my-1 h-px bg-border" />
        : (
          <button
            key={it.label} role="menuitem" disabled={it.disabled} onClick={act(it.run)}
            className={`flex h-7 w-full items-center justify-between rounded-md px-2 text-left outline-none focus-visible:bg-accent enabled:hover:bg-accent disabled:opacity-40 ${it.danger ? 'text-destructive' : ''}`}
          >
            {it.label}
            {it.hint && <span className="text-[10px] text-muted-foreground">{it.hint}</span>}
          </button>
        ))}
    </div>
  );
}
