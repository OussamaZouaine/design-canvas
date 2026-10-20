import { useState } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  value: string; // any CSS colour; stored/edited as given, project rule is oklch()
  onChange: (v: string) => void;
  className?: string;
}

// Swatch + text input. The text is the source of truth (so oklch(...) and var(--token) both survive);
// the swatch is just a live preview, and the native picker (hex only) is a convenience that converts to hex.
// Phase 5 swaps hex-to-OKLCH conversion in once the inspector needs it.
export function ColorField({ value, onChange, className }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft.trim()) onChange(draft.trim());
    setDraft(null);
  };
  return (
    <div className={cn('flex h-7 items-center gap-2 rounded-md bg-muted/60 px-1.5 text-xs focus-within:ring-2 focus-within:ring-ring/40', className)}>
      {/* The swatch's inline style is a runtime value, which Tailwind cannot generate ahead of time. */}
      <span className="size-4 shrink-0 rounded-sm border border-border" style={{ background: value }} />
      <input
        className="min-w-0 flex-1 bg-transparent outline-none"
        value={draft ?? value}
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
