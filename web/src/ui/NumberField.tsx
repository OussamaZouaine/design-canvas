import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  className?: string;
}

// Figma-style number input: drag the label sideways to scrub the value, or type into the field.
// Pointer capture keeps the drag alive when the cursor leaves the label (a common scrub bug otherwise).
export function NumberField({ label, value, onChange, step = 1, min = -Infinity, max = Infinity, unit, className }: Props) {
  const [draft, setDraft] = useState<string | null>(null); // text while typing; null = show the real value
  const drag = useRef<{ startX: number; startValue: number } | null>(null);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  // Round to the step's precision so scrubbing 0.1 steps never shows 0.30000000000000004.
  const round = (v: number) => Number(v.toFixed(Math.max(0, (String(step).split('.')[1] ?? '').length)));

  const commit = () => {
    if (draft === null) return;
    const n = parseFloat(draft);
    if (Number.isFinite(n)) onChange(clamp(round(n)));
    setDraft(null);
  };

  return (
    <label className={cn('flex h-7 items-center rounded-md bg-muted/60 text-xs focus-within:ring-2 focus-within:ring-ring/40', className)}>
      <span
        className="w-6 shrink-0 cursor-ew-resize select-none text-center text-muted-foreground touch-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { startX: e.clientX, startValue: value };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          // Shift = 10x faster, Alt = 10x finer, like Figma.
          const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
          onChange(clamp(round(drag.current.startValue + (e.clientX - drag.current.startX) * step * mult)));
        }}
        onPointerUp={() => { drag.current = null; }}
      >
        {label}
      </span>
      <input
        className="tnum min-w-0 flex-1 bg-transparent pr-1 outline-none"
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); }
          // Arrow keys nudge by one step (Shift = 10), matching design tools.
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            onChange(clamp(round(value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1))));
          }
        }}
      />
      {unit && <span className="pr-2 text-muted-foreground">{unit}</span>}
    </label>
  );
}
