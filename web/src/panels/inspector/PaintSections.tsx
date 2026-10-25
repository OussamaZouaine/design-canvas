import { Eye, EyeOff, Minus, Plus, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { MIXED, isSimpleShadow, parseShadow, parseStroke, shadowCss, splitShadows, strokeCss, toPx, type Shadow, type Stroke } from '@/lib/inspect';
import { ColorField } from '@/ui/ColorField';
import { NumberField } from '@/ui/NumberField';
import { IconBtn, rowLabel, Section, SegBtn, Segmented, TextField, TokenChip, tokenName } from './controls';
import type { Model } from './model';

// Colour tokens (names starting with `color-`) for the picker and the Detach chip.
export const colorTokens = (tokens: Record<string, string>) => Object.fromEntries(Object.entries(tokens).filter(([k]) => k.split('-')[0] === 'color'));

const NEW_FILL = 'oklch(0.9 0 0)';
const NEW_STROKE: Stroke = { width: '1px', style: 'solid', color: 'oklch(0.3 0 0 / 0.25)' };
const NEW_SHADOW = '0px 4px 12px 0px oklch(0 0 0 / 0.15)';
// Where a hidden fill is parked so the eye toggle can bring it back. CSS has no per-fill visibility, and deleting
// the value would make "hide" a destructive edit.
const HIDDEN_FILL = '--dc-hidden-fill';

// A colour row: label, picker field (with live preview while a slider moves). `write` builds the patch for a value.
export function ColorRow({ m, label, value, mixed, write, extra }: { m: Model; label: string; value: string; mixed?: boolean; write: (v: string) => Record<string, string | null>; extra?: ReactNode }) {
  const tok = tokenName(value);
  const resolved = tok && tok in m.tokens ? m.tokens[tok] : value;
  return (
    <div>
    <div className="flex items-center gap-1">
      <span className={rowLabel}>{label}</span>
      <ColorField
        // No value in the key: a commit from the open picker must not remount the field and close the popover.
        key={`${m.entries.map((e) => e.id).join()}:${label}`}
        className="flex-1" label={label} value={mixed ? '' : value} mixed={mixed} preview={resolved} list="dl-color" tokens={colorTokens(m.tokens)}
        onPreview={(v) => m.preview(v === null ? null : write(v))}
        onChange={(v) => m.patch(write(v))}
      />
      {extra}
    </div>
    {!mixed && <div className="pl-12"><TokenChip value={value} tokens={m.tokens} onDetach={(r) => m.patch(write(r))} /></div>}
    </div>
  );
}

export function FillSection({ m }: { m: Model }) {
  const bg = m.get('background');
  const hidden = m.get(HIDDEN_FILL);
  const mixed = bg === MIXED;
  const has = mixed || bg !== '' || (hidden !== '' && hidden !== MIXED);
  const off = !mixed && bg === '' && hidden !== '';
  const write = (v: string) => ({ background: v || null, 'background-color': null, [HIDDEN_FILL]: null });
  return (
    <Section title="Fill" action={!has && <IconBtn label="Add fill" onClick={() => m.patch(write(NEW_FILL))}><Plus className="size-3.5" /></IconBtn>}>
      {has && (
        <ColorRow
          m={m} label="Fill" value={off ? hidden : bg} mixed={mixed} write={write}
          extra={
            <>
              <IconBtn label={off ? 'Show fill' : 'Hide fill'} onClick={() => m.patch(off ? write(hidden) : { background: null, 'background-color': null, [HIDDEN_FILL]: bg })}>
                {off ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </IconBtn>
              <IconBtn label="Remove fill" onClick={() => m.patch(write(''))}><Minus className="size-3.5" /></IconBtn>
            </>
          }
        />
      )}
    </Section>
  );
}

// Stroke is the `border` shorthand (inside) or `outline` (outside, takes no layout space). Per-side borders are not
// modelled here; they stay reachable as raw rows under "Other styles".
export function StrokeSection({ m }: { m: Model }) {
  const border = m.get('border');
  const outline = m.get('outline');
  if (border === MIXED || outline === MIXED) {
    return <Section title="Stroke"><TextField label="Border" value="" mixed onCommit={(v) => m.patch({ border: v || null, outline: null })} /></Section>;
  }
  const outside = border === '' && outline !== '';
  const raw = outside ? outline : border;
  const has = raw !== '' && raw !== 'none';
  const st = parseStroke(raw);
  // Write the stroke back to whichever property is active, clearing the other so the two never stack.
  const write = (s: Stroke, out = outside) => (out ? { outline: strokeCss(s), border: null, 'outline-offset': '0px' } : { border: strokeCss(s), outline: null, 'outline-offset': null });
  return (
    <Section title="Stroke" action={!has && <IconBtn label="Add stroke" onClick={() => m.patch(write(NEW_STROKE, false))}><Plus className="size-3.5" /></IconBtn>}>
      {has && (
        <>
          <ColorRow
            m={m} label="Stroke" value={st.color} write={(v) => write({ ...st, color: v })}
            extra={<IconBtn label="Remove stroke" onClick={() => m.patch({ border: null, outline: null, 'outline-offset': null })}><Minus className="size-3.5" /></IconBtn>}
          />
          <div className="grid grid-cols-2 gap-1.5">
            <NumberField
              key={`${raw}`} label={<span className="text-[10px]">W</span>} title="stroke width" min={0} step={1}
              value={parseFloat(st.width) || 1}
              onPreview={(x) => m.preview(x === null ? null : write({ ...st, width: toPx(x) }))}
              onChange={(x) => m.patch(write({ ...st, width: toPx(x) }))}
            />
            <label className="flex h-7 min-w-0 items-center rounded-md bg-field text-xs transition-colors duration-150 pointer-hover:bg-field-hover focus-within:ring-1 focus-within:ring-selection">
              <select aria-label="Stroke style" value={st.style || 'solid'} onChange={(e) => m.patch(write({ ...st, style: e.target.value }))} className="min-w-0 flex-1 bg-transparent px-2 outline-none [&>option]:bg-popover">
                {['solid', 'dashed', 'dotted', 'double'].map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
              </select>
            </label>
          </div>
          <Segmented>
            <SegBtn label="Stroke inside" on={!outside} onClick={() => m.patch(write(st, false))}>Inside</SegBtn>
            <SegBtn label="Stroke outside" on={outside} onClick={() => m.patch(write(st, true))}>Outside</SegBtn>
          </Segmented>
        </>
      )}
    </Section>
  );
}

// Effects: the box-shadow list, one editable row per layer. A layer the row cannot model (a var(--shadow-md) token)
// shows as plain text, so nothing is lost or rewritten.
export function EffectsSection({ m }: { m: Model }) {
  const v = m.get('box-shadow');
  if (v === MIXED) return <Section title="Effects"><TextField label="Shadow" value="" mixed list="dl-shadow" onCommit={(t) => m.patch({ 'box-shadow': t || null })} /></Section>;
  const layers = v && v !== 'none' ? splitShadows(v) : [];
  const set = (next: string[]) => m.patch({ 'box-shadow': next.length ? next.join(', ') : null });
  const swap = (i: number, layer: string | null) => set(layers.flatMap((l, j) => (j === i ? (layer === null ? [] : [layer]) : [l])));
  const prev = (i: number, layer: string) => m.preview({ 'box-shadow': layers.map((l, j) => (j === i ? layer : l)).join(', ') });
  return (
    <Section title="Effects" action={<IconBtn label="Add shadow" onClick={() => set([...layers, NEW_SHADOW])}><Plus className="size-3.5" /></IconBtn>}>
      {layers.map((layer, i) => {
        const key = `${m.entries.map((e) => e.id).join()}:sh${i}:${layer}`;
        if (!isSimpleShadow(layer) || parseShadow(layer).color.startsWith('var(')) {
          return (
            <div key={key} className="flex items-center gap-1">
              <div className="min-w-0 flex-1"><TextField label="Shadow" value={layer} list="dl-shadow" onCommit={(t) => swap(i, t || null)} /></div>
              <IconBtn label="Remove shadow" onClick={() => swap(i, null)}><X className="size-3" /></IconBtn>
            </div>
          );
        }
        const s = parseShadow(layer);
        const field = (k: 'x' | 'y' | 'blur' | 'spread', label: string) => (
          <NumberField
            key={`${key}:${k}`} label={<span className="text-[10px]">{label}</span>} title={`shadow ${k}`} min={k === 'blur' ? 0 : undefined}
            value={parseFloat(s[k]) || 0}
            onPreview={(x) => x === null ? m.preview(null) : prev(i, shadowCss({ ...s, [k]: toPx(x) } as Shadow))}
            onChange={(x) => swap(i, shadowCss({ ...s, [k]: toPx(x) } as Shadow))}
          />
        );
        return (
          <div key={key} className="flex flex-col gap-1.5 rounded-md">
            <ColorRow
              m={m} label={s.inset ? 'Inner' : 'Shadow'} value={s.color} write={(c) => ({ 'box-shadow': layers.map((l, j) => (j === i ? shadowCss({ ...s, color: c }) : l)).join(', ') })}
              extra={
                <>
                  <IconBtn label="Inner shadow" on={s.inset} onClick={() => swap(i, shadowCss({ ...s, inset: !s.inset }))}><span className="text-[10px] font-semibold">In</span></IconBtn>
                  <IconBtn label="Remove shadow" onClick={() => swap(i, null)}><Minus className="size-3.5" /></IconBtn>
                </>
              }
            />
            <div className="grid grid-cols-4 gap-1.5">{field('x', 'X')}{field('y', 'Y')}{field('blur', 'B')}{field('spread', 'S')}</div>
          </div>
        );
      })}
    </Section>
  );
}
