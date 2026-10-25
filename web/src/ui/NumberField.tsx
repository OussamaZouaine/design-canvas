import { useEffect, useRef, useState, type ReactNode } from 'react';
import { evalExpr, roundTo, stepFactor } from '@/lib/inspect';
import { cn } from '@/lib/utils';

interface Props {
  label: ReactNode;
  value: number | null; // null = no number to show (mixed across a selection)
  // Called once per finished edit (typing + Enter/blur, a burst of arrow keys, or the END of a scrub). Every call is a
  // server write and an undo step in this app, so it must not fire for each pointer move.
  onChange: (v: number) => void;
  // Live value while scrubbing / stepping, so the canvas can follow without a server write. null = cancelled, put it back.
  // After onChange the caller's edit replaces the preview, so there is no "committed" preview call.
  onPreview?: (v: number | null) => void;
  mixed?: boolean;
  disabled?: boolean;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  title?: string;
  className?: string;
}

const STEP_IDLE_MS = 450; // arrow-key burst: one commit after the last press, so holding a key is one undo step

// Figma-style number input: drag the label sideways to scrub (Shift x10, Alt /10), arrow keys step the same way, and
// the text accepts simple arithmetic ("16*2"). Pointer capture keeps a drag alive when the cursor leaves the label.
export function NumberField({ label, value, onChange, onPreview, mixed, disabled, step = 1, min = -Infinity, max = Infinity, unit, title, className }: Props) {
  const [draft, setDraft] = useState<string | null>(null); // text while typing; null = show the real value
  const [live, setLive] = useState<number | null>(null); // value while scrubbing / stepping, before the commit
  const drag = useRef<{ x: number; acc: number; moved: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<number | null>(null);
  // The latest callbacks, so the unmount flush below never calls a stale closure.
  const cb = useRef({ onChange, onPreview });
  cb.current = { onChange, onPreview };

  const decimals = Math.max(0, (String(step).split('.')[1] ?? '').length);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const round = (v: number) => clamp(roundTo(v, Math.max(decimals, 2)));
  const base = value ?? 0;
  const canAdjust = !disabled && !mixed && value !== null;

  const flush = () => {
    window.clearTimeout(timer.current);
    if (pending.current !== null) {
      const v = pending.current;
      pending.current = null;
      if (v !== value) cb.current.onChange(v);
      else cb.current.onPreview?.(null);
    }
    setLive(null);
  };
  // Leaving the field mid-burst (blur, unmount from a doc update) must not drop the pending value.
  useEffect(() => () => { if (pending.current !== null) cb.current.onChange(pending.current); window.clearTimeout(timer.current); }, []);

  const commitDraft = () => {
    if (draft === null) return;
    const n = evalExpr(draft);
    setDraft(null);
    if (n !== null && (mixed || round(n) !== value)) onChange(round(n));
  };

  const shown = draft ?? (mixed ? '' : String(roundTo(live ?? base, 3)));

  return (
    <label
      title={title}
      className={cn('flex h-7 min-w-0 items-center rounded-md bg-field text-xs transition-colors duration-150 pointer-hover:bg-field-hover focus-within:bg-field focus-within:ring-1 focus-within:ring-selection', disabled && 'pointer-events-none opacity-50', className)}
    >
      <span
        className={cn('flex min-w-6 shrink-0 select-none items-center justify-center px-1.5 text-muted-foreground touch-none', canAdjust && 'cursor-ew-resize')}
        onPointerDown={(e) => {
          if (!canAdjust || e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, acc: base, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          if (!d.moved && Math.abs(e.clientX - d.x) < 3) return; // a click on the label should only focus the input
          d.moved = true;
          // Incremental (movementX), so pressing Shift / Alt mid-drag changes the speed from here on instead of jumping.
          d.acc += e.movementX * step * stepFactor(e);
          const v = round(d.acc);
          setLive(v);
          onPreview?.(v);
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (!d?.moved) return;
          const v = round(d.acc);
          setLive(null);
          if (v !== value) onChange(v);
          else onPreview?.(null);
        }}
        onPointerCancel={() => { drag.current = null; setLive(null); onPreview?.(null); }}
        // The label sits inside a <label>, so without this a scrub would also focus the input on release.
        onClick={(e) => { if (drag.current?.moved) e.preventDefault(); }}
      >
        {label}
      </span>
      <input
        disabled={disabled}
        className="tnum min-w-0 flex-1 bg-transparent pr-1 outline-none placeholder:text-muted-foreground"
        value={shown}
        placeholder={mixed ? 'Mixed' : undefined}
        inputMode="decimal"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { commitDraft(); flush(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setDraft(null); pending.current = null; setLive(null); onPreview?.(null); e.currentTarget.blur(); }
          // Arrow keys step by one (Shift 10, Alt 0.1) like design tools; a burst is one undo step.
          if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && canAdjust) {
            e.preventDefault();
            const from = pending.current ?? value ?? 0;
            const v = round(from + (e.key === 'ArrowUp' ? 1 : -1) * step * stepFactor(e));
            pending.current = v;
            setDraft(null);
            setLive(v);
            onPreview?.(v);
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(flush, STEP_IDLE_MS);
          }
        }}
      />
      {unit && <span className="pr-2 text-muted-foreground">{unit}</span>}
    </label>
  );
}
