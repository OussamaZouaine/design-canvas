import { ChevronDown, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { MIXED, px, toPx } from '@/lib/inspect';
import { cn } from '@/lib/utils';
import { NumberField } from '@/ui/NumberField';
import type { Model } from './model';

// Filled field, Figma-style: no border at rest, a slightly darker fill on hover, a signal-blue ring when focused.
export const chrome = 'flex h-7 min-w-0 items-center rounded-md bg-field text-xs transition-colors duration-150 pointer-hover:bg-field-hover focus-within:bg-field focus-within:ring-1 focus-within:ring-selection';
export const labelCls = 'min-w-6 shrink-0 select-none px-1.5 text-center text-muted-foreground';
export const rowLabel = 'w-11 shrink-0 px-1.5 text-xs text-muted-foreground';
export const tokenName = (v: string) => /^var\(--([a-z0-9-]+)\s*(?:,.*)?\)$/i.exec(v)?.[1] ?? null;
export const PLAIN_NUM = /^-?\d*\.?\d+$/;
// A bare number typed into a length field means pixels (a unitless width is invalid CSS).
export const withPx = (v: string) => (PLAIN_NUM.test(v) ? `${v}px` : v);

// Text input with a label chip. Edits are a draft until Enter/blur, so typing never posts per keystroke.
export function TextField({ label, title, value, list, mixed, disabled, onCommit }: { label: ReactNode; title?: string; value: string; list?: string; mixed?: boolean; disabled?: boolean; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && (mixed || draft.trim() !== value)) onCommit(draft.trim());
    setDraft(null);
  };
  return (
    <label className={cn(chrome, disabled && 'pointer-events-none opacity-50')} title={title ?? (typeof label === 'string' ? label : undefined)}>
      <span className={labelCls}>{label}</span>
      <input
        aria-label={title ?? (typeof label === 'string' ? label : undefined)}
        list={list}
        spellCheck={false}
        placeholder={mixed ? 'Mixed' : '—'}
        className="min-w-0 flex-1 bg-transparent pr-1.5 outline-none placeholder:text-muted-foreground"
        value={draft ?? (mixed ? '' : value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); }
        }}
      />
    </label>
  );
}

export function SelectField({ label, value, options, names, mixed, onCommit }: { label: string; value: string; options: string[]; names?: Record<string, string>; mixed?: boolean; onCommit: (v: string) => void }) {
  // A value outside the list (written by Claude) must still be shown rather than silently replaced.
  const all = ['', ...options, ...(value && value !== MIXED && !options.includes(value) ? [value] : [])];
  return (
    <label className={chrome}>
      <span className={cn(labelCls, 'w-14 text-left')}>{label}</span>
      <select aria-label={label} value={mixed ? MIXED : value} onChange={(e) => e.target.value !== MIXED && onCommit(e.target.value)} className="min-w-0 flex-1 bg-transparent pr-1 outline-none [&>option]:bg-popover">
        {mixed && <option value={MIXED}>Mixed</option>}
        {all.map((o) => <option key={o} value={o}>{names?.[o] ?? (o || '—')}</option>)}
      </select>
    </label>
  );
}

// Title row with a chevron to collapse, and an optional trailing action (e.g. the + of Fill, the switch of Auto layout).
export function Section({ title, off, action, children }: { title: string; off?: boolean; action?: ReactNode; children?: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    // Hairline between sections (structure, so a border), title in semibold foreground with a muted chevron on the
    // trailing edge, so the eye scans titles down the left edge.
    <section className={cn('border-b px-3 pt-1 pb-3', off && 'pointer-events-none opacity-50')}>
      <div className="flex h-8 items-center gap-1">
        <button
          aria-expanded={open} onClick={() => setOpen(!open)}
          className="group/sec -mx-1 flex h-8 flex-1 items-center justify-between rounded-md px-1 text-[11px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {title}
          <ChevronDown className={cn('size-3 text-muted-foreground transition-[rotate,opacity] duration-150 group-hover/sec:text-foreground', !open && '-rotate-90')} />
        </button>
        {action}
      </div>
      {open && children && <div className="flex flex-col gap-1.5">{children}</div>}
    </section>
  );
}

// Small square icon button (align bar, toggles). `on` shows the pressed state; the label is always in title/aria-label.
export function IconBtn({ label, on, disabled, onClick, children, className }: { label: string; on?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button" title={label} aria-label={label} aria-pressed={on} disabled={disabled} onClick={onClick}
      className={cn(
        'grid h-7 min-w-7 place-items-center rounded-md px-1 text-muted-foreground transition-[background-color,color,scale] duration-150 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40 pointer-hover:hover:bg-field-hover pointer-hover:hover:text-foreground',
        on && 'bg-field text-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}

// Segmented group of icon buttons sharing one filled track (direction, text align, stroke position...).
export function Segmented({ children, className }: { children: ReactNode; className?: string }) {
  return <div role="group" className={cn('flex h-7 items-center gap-0.5 rounded-md bg-field p-0.5', className)}>{children}</div>;
}
export function SegBtn({ label, on, onClick, children }: { label: string; on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button" title={label} aria-label={label} aria-pressed={on} onClick={onClick}
      className={cn('grid h-6 flex-1 place-items-center rounded-[5px] px-1.5 text-muted-foreground transition-[background-color,color] duration-150 pointer-hover:hover:text-foreground', on && 'bg-background text-foreground shadow-sm')}
    >
      {children}
    </button>
  );
}

// Chip for a value that is a var(--token): names the token and swaps in its resolved value on click.
export function TokenChip({ value, tokens, onDetach }: { value: string; tokens: Record<string, string>; onDetach: (resolved: string) => void }) {
  const name = tokenName(value);
  if (!name) return null;
  return (
    <button
      type="button" title={`Detach: replace var(--${name}) with its value`} disabled={!(name in tokens)} onClick={() => name in tokens && onDetach(tokens[name])}
      className="mt-0.5 flex items-center gap-1 rounded bg-muted px-1.5 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
    >
      {name} <X className="size-2.5" />
    </button>
  );
}

// A pixel property as a number field with scrub / arrows / expressions / live preview / Mixed. A value that is not
// plain pixels (var(), %, calc) falls back to a text field so nothing is lost. `unit` suffix defaults to none.
export function LengthField({ m, prop, label, title, list, min, max, step, disabled, family, unsetAsText }: {
  m: Model; unsetAsText?: boolean; prop: string; label: ReactNode; title?: string; list?: string; min?: number; max?: number; step?: number; disabled?: boolean; family?: string;
}) {
  const v = m.get(prop);
  const mixed = v === MIXED;
  const n = px(v === '' ? '0' : v);
  const key = `${m.entries.map((e) => e.id).join()}:${prop}:${v}`;
  // An unset property (font-size, min/max) must not read as "0": show the empty text field instead.
  if (!mixed && (n === null || (unsetAsText && v === ''))) {
    return (
      <div className="min-w-0">
        <TextField key={key} label={label} title={title ?? prop} value={v} list={list ?? (family ? `dl-${family}` : undefined)} disabled={disabled} onCommit={(t) => m.patch({ [prop]: withPx(t) || null })} />
        <TokenChip value={v} tokens={m.tokens} onDetach={(r) => m.patch({ [prop]: r })} />
      </div>
    );
  }
  return (
    <NumberField
      key={key} label={label} title={title ?? prop} value={mixed ? null : n} mixed={mixed} disabled={disabled} min={min} max={max} step={step}
      onPreview={(x) => m.preview(x === null ? null : { [prop]: toPx(x) })}
      onChange={(x) => m.patch({ [prop]: toPx(x) })}
    />
  );
}
