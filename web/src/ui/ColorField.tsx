import { useState } from 'react';
import { hexToOklch, toHex } from '@/lib/color';
import { cn } from '@/lib/utils';

interface Props {
  value: string; // any CSS colour; stored/edited as given, project rule is oklch()
  onChange: (v: string) => void;
  // What the swatch paints when `value` is not directly paintable (a var(--token) resolved by the caller).
  preview?: string;
  list?: string; // id of a <datalist> offering token suggestions
  label?: string;
  className?: string;
}

// Swatch + text input. The text is the source of truth (so oklch(...) and var(--token) both survive);
// the swatch is a live preview that also opens the native picker, whose hex result is converted to OKLCH.
export function ColorField({ value, onChange, preview, list, label = 'Colour', className }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    // An emptied field means "remove this property", so it is committed too.
    if (draft !== null && draft.trim() !== value) onChange(draft.trim());
    setDraft(null);
  };
  const paint = preview ?? value;
  return (
    <div className={cn('flex h-7 min-w-0 items-center gap-2 rounded-md bg-muted/60 px-1.5 text-xs focus-within:ring-2 focus-within:ring-ring/40', className)}>
      {/* The swatch is a button over a transparent native colour input: clicking it opens the OS picker. */}
      <span className="relative size-4 shrink-0 overflow-hidden rounded-sm border border-border">
        {/* The inline background is a runtime value, which Tailwind cannot generate ahead of time. */}
        <span className="absolute inset-0" style={{ background: CSS.supports('color', paint) ? paint : 'transparent' }} />
        <input
          type="color"
          aria-label={`${label} picker`}
          value={toHex(paint) ?? '#000000'}
          onChange={(e) => onChange(hexToOklch(e.target.value) ?? e.target.value)}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </span>
      <input
        aria-label={label}
        list={list}
        className="min-w-0 flex-1 bg-transparent outline-none"
        value={draft ?? value}
        placeholder="—"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); }
        }}
        spellCheck={false}
      />
    </div>
  );
}
