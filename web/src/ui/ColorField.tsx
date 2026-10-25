import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatOklch, hexToOklch, parseOklch, toHex, type Oklch } from '@/lib/color';
import { cn } from '@/lib/utils';

interface Props {
  value: string; // any CSS colour; stored/edited as given, project rule is oklch()
  onChange: (v: string) => void;
  // Live value while a picker slider is dragged (no server write); null = the popover closed without a change.
  onPreview?: (v: string | null) => void;
  // What the swatch paints when `value` is not directly paintable (a var(--token) resolved by the caller).
  preview?: string;
  list?: string; // id of a <datalist> offering token suggestions
  tokens?: Record<string, string>; // colour tokens (name -> value) listed in the picker
  mixed?: boolean; // several selected nodes disagree: show "Mixed" and no swatch
  label?: string;
  className?: string;
}

// A background that is valid CSS but not a plain colour (gradient, url) still paints in the swatch.
const paintable = (v: string) => typeof CSS !== 'undefined' && CSS.supports('background', v);

// Swatch + text input. The text is the source of truth (so oklch(...) and var(--token) both survive);
// the swatch opens an OKLCH picker popover (L, C, H, alpha sliders + the project's colour tokens).
export function ColorField({ value, onChange, onPreview, preview, list, tokens, mixed, label = 'Colour', className }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const swatch = useRef<HTMLButtonElement>(null);
  const commit = () => {
    // An emptied field means "remove this property", so it is committed too.
    if (draft !== null && (mixed || draft.trim() !== value)) onChange(draft.trim());
    setDraft(null);
  };
  const paint = preview ?? value;
  return (
    <div className={cn('flex h-7 min-w-0 items-center gap-2 rounded-md bg-field px-1.5 text-xs transition-colors duration-150 pointer-hover:bg-field-hover focus-within:bg-field focus-within:ring-1 focus-within:ring-selection', className)}>
      <button
        ref={swatch}
        type="button"
        aria-label={`${label} picker`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="dc-checker relative size-4 shrink-0 overflow-hidden rounded-sm outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
      >
        {/* The inline background is a runtime value, which Tailwind cannot generate ahead of time. */}
        {!mixed && <span className="absolute inset-0" style={{ background: paintable(paint) ? paint : 'transparent' }} />}
      </button>
      <input
        aria-label={label}
        list={list}
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
        value={draft ?? (mixed ? '' : value)}
        placeholder={mixed ? 'Mixed' : '—'}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); }
        }}
        spellCheck={false}
      />
      {open && (
        <ColorPopover
          anchor={swatch.current}
          start={paint}
          tokens={tokens}
          onClose={() => { setOpen(false); onPreview?.(null); }}
          onPreview={onPreview}
          onCommit={onChange}
        />
      )}
    </div>
  );
}

// Starting parts for the sliders: the value itself when it is OKLCH, else its hex form, else a neutral mid grey.
function partsOf(css: string): Oklch {
  const direct = parseOklch(css);
  if (direct) return direct;
  const hex = toHex(css);
  const conv = hex ? parseOklch(hexToOklch(hex) ?? '') : null;
  return conv ?? { l: 0.7, c: 0.1, h: 250, a: 1 };
}

function ColorPopover({ anchor, start, tokens, onClose, onPreview, onCommit }: {
  anchor: HTMLElement | null; start: string; tokens?: Record<string, string>;
  onClose: () => void; onPreview?: (v: string | null) => void; onCommit: (v: string) => void;
}) {
  const [p, setP] = useState<Oklch>(() => partsOf(start));
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Place the popover beside the swatch: the Design tab sits at the right edge, so it opens to the left, and is
  // clamped to the viewport. useLayoutEffect so it never paints once at the wrong spot.
  useLayoutEffect(() => {
    if (!anchor || !box.current) return;
    const a = anchor.getBoundingClientRect(), b = box.current.getBoundingClientRect();
    const left = a.left - b.width - 12 >= 8 ? a.left - b.width - 12 : Math.min(a.right + 12, window.innerWidth - b.width - 8);
    setPos({ left, top: Math.max(8, Math.min(a.top - 8, window.innerHeight - b.height - 8)) });
  }, [anchor]);

  // Close on an outside press or Escape. Pointerdown (not click) so a drag that starts outside also closes it.
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key, true); };
  }, [anchor, onClose]);

  const css = formatOklch(p);
  // Sliders preview on every input (canvas follows, no server write) and commit on release: one undo step per drag.
  const slide = (key: keyof Oklch, v: number) => { const next = { ...p, [key]: v }; setP(next); onPreview?.(formatOklch(next)); };
  const settle = () => onCommit(css);
  const track = (k: keyof Oklch) => {
    const { l, c, h } = p;
    if (k === 'l') return `linear-gradient(to right, oklch(0 ${c} ${h}), oklch(0.5 ${c} ${h}), oklch(1 ${c} ${h}))`;
    if (k === 'c') return `linear-gradient(to right, oklch(${l} 0 ${h}), oklch(${l} 0.4 ${h}))`;
    if (k === 'h') return `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map((x) => `oklch(${l} ${c} ${x})`).join(', ')})`;
    return `linear-gradient(to right, oklch(${l} ${c} ${h} / 0), oklch(${l} ${c} ${h}))`;
  };
  const rows: { k: keyof Oklch; name: string; max: number; step: number }[] = [
    { k: 'l', name: 'L', max: 1, step: 0.001 }, { k: 'c', name: 'C', max: 0.4, step: 0.001 },
    { k: 'h', name: 'H', max: 360, step: 0.1 }, { k: 'a', name: 'A', max: 1, step: 0.01 },
  ];
  const colourTokens = Object.entries(tokens ?? {});

  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label="Colour picker"
      // Same entrance as the context menu (120ms fade + scale, off for reduced motion); fixed so panel scrolling can't detach it.
      className="ctx-menu material shadow-float fixed z-50 flex w-56 flex-col gap-2 rounded-xl p-3 text-xs text-popover-foreground"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0 }}
    >
      <div className="dc-checker h-9 overflow-hidden rounded-md outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10">
        <div className="size-full" style={{ background: css }} />
      </div>
      {rows.map(({ k, name, max, step }) => (
        <label key={k} className="flex items-center gap-2">
          <span className="w-3 shrink-0 text-muted-foreground">{name}</span>
          <input
            type="range" aria-label={name === 'A' ? 'Alpha' : name === 'L' ? 'Lightness' : name === 'C' ? 'Chroma' : 'Hue'}
            className={cn('dc-range min-w-0 flex-1', k === 'a' && 'dc-checker')}
            min={0} max={max} step={step} value={p[k]}
            style={k === 'a' ? { backgroundImage: `${track(k)}, repeating-conic-gradient(oklch(0.8 0 0) 0% 25%, oklch(1 0 0) 0% 50%)`, backgroundSize: 'auto, 8px 8px' } : { background: track(k) }}
            onChange={(e) => slide(k, parseFloat(e.target.value))}
            onPointerUp={settle}
            onKeyUp={settle}
          />
          <span className="tnum w-9 shrink-0 text-right text-muted-foreground">{k === 'h' ? p.h.toFixed(0) : k === 'a' ? `${Math.round(p.a * 100)}%` : p[k].toFixed(2)}</span>
        </label>
      ))}
      {colourTokens.length > 0 && (
        <div className="mt-1 flex flex-col gap-1">
          <span className="text-muted-foreground">Tokens</span>
          <div className="grid max-h-28 grid-cols-6 gap-1 overflow-y-auto">
            {colourTokens.map(([name, val]) => (
              <button
                key={name} type="button" title={`${name}: ${val}`} aria-label={`Use token ${name}`}
                onClick={() => { onCommit(`var(--${name})`); onClose(); }}
                className="dc-checker relative size-7 overflow-hidden rounded-md outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
              >
                <span className="absolute inset-0" style={{ background: paintable(val) ? val : 'transparent' }} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
