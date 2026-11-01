import { useRef, useState } from 'react';
import { parseGradient } from '@/lib/color';
import { cn } from '@/lib/utils';
import { ColorPopover, paintable } from '@/ui/ColorPicker';

interface Props {
  value: string; // any CSS colour or gradient; stored/edited as given, project rule is oklch()
  onChange: (v: string) => void;
  // Live value while a picker control is dragged (no server write); null = the popover closed without a change.
  onPreview?: (v: string | null) => void;
  // What the swatch paints when `value` is not directly paintable (a var(--token) resolved by the caller).
  preview?: string;
  list?: string; // id of a <datalist> offering token suggestions
  tokens?: Record<string, string>; // colour tokens (name -> value) listed in the picker
  mixed?: boolean; // several selected nodes disagree: show "Mixed" and no swatch
  label?: string;
  className?: string;
}

// Swatch + text input. The text is the source of truth (so oklch(...) and var(--token) both survive); the swatch
// opens the picker popover (ui/ColorPicker.tsx). A gradient value shows as a "Linear" / "Radial" button instead of
// its long CSS, and opens the gradient editor.
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
  const grad = mixed ? null : parseGradient(value);
  // A gradient the editor cannot model, or an image, has no picker: opening it would replace the value with a colour.
  const pickable = mixed || !!grad || !/gradient\(|url\(/i.test(value);
  return (
    <div className={cn('flex h-7 min-w-0 items-center gap-2 rounded-md bg-field px-1.5 text-xs transition-colors duration-150 pointer-hover:bg-field-hover focus-within:bg-field focus-within:ring-1 focus-within:ring-selection', className)}>
      <button
        ref={swatch}
        type="button"
        aria-label={`${label} picker`}
        aria-expanded={open}
        disabled={!pickable}
        onClick={() => setOpen(!open)}
        className="dc-checker relative size-4 shrink-0 overflow-hidden rounded-sm outline-1 -outline-offset-1 outline-black/10 disabled:cursor-default dark:outline-white/10"
      >
        {/* The inline background is a runtime value, which Tailwind cannot generate ahead of time. */}
        {!mixed && <span className="absolute inset-0" style={{ background: paintable(paint) ? paint : 'transparent' }} />}
      </button>
      {grad ? (
        <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => setOpen(!open)}>
          {grad.kind === 'linear' ? 'Linear' : 'Radial'} <span className="text-muted-foreground">{grad.stops.length} stops</span>
        </button>
      ) : (
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
      )}
      {open && (
        <ColorPopover
          anchor={swatch.current}
          // A token value opens on its token text (so the picker can mark it) but resolves through `tokens`.
          start={mixed ? paint : value}
          resolved={paint}
          tokens={tokens}
          onClose={() => { setOpen(false); onPreview?.(null); }}
          onPreview={onPreview}
          onCommit={onChange}
        />
      )}
    </div>
  );
}
