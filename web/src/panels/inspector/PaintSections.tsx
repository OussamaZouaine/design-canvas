import { Blend, Eye, EyeOff, Image, Minus, Plus, Square, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { formatGradient, formatOklch, mixOklch, parseGradient, type Gradient } from '@/lib/color';
import { MIXED, isSimpleShadow, parseShadow, parseStroke, shadowCss, splitShadows, strokeCss, toPx, type Shadow, type Stroke } from '@/lib/inspect';
import { ColorField } from '@/ui/ColorField';
import { partsOf } from '@/ui/ColorPicker';
import { NumberField } from '@/ui/NumberField';
import { FieldSelect, IconBtn, rowLabel, Section, SegBtn, Segmented, TextField, TokenChip, tokenName } from './controls';
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

// Image fills are `url(...)` cover-fitted; the URL is the only thing the row edits.
const imageCss = (url: string) => `url("${url.replace(/["\\]/g, '')}") center / cover no-repeat`;
const imageUrl = (bg: string) => /url\(\s*["']?([^"')]*)["']?\s*\)/i.exec(bg)?.[1] ?? '';
type FillKind = 'solid' | 'gradient' | 'image';
const kindOf = (v: string): FillKind => (/url\(/i.test(v) ? 'image' : /gradient\(/i.test(v) ? 'gradient' : 'solid');

export function FillSection({ m }: { m: Model }) {
  const bg = m.get('background');
  const hidden = m.get(HIDDEN_FILL);
  const mixed = bg === MIXED;
  const has = mixed || bg !== '' || (hidden !== '' && hidden !== MIXED);
  const off = !mixed && bg === '' && hidden !== '';
  const value = off ? hidden : bg;
  // Picking "Image" before there is a URL shows the empty URL field; nothing is written until a URL is entered.
  const [wantImage, setWantImage] = useState(false);
  const kind = wantImage ? 'image' : kindOf(value);
  const write = (v: string) => ({ background: v || null, 'background-color': null, [HIDDEN_FILL]: null });
  // Switching type keeps the colour: solid -> gradient fades that colour to a lighter/darker version of itself,
  // gradient -> solid keeps the first stop.
  const switchTo = (k: FillKind) => {
    setWantImage(k === 'image' && kind !== 'image');
    if (k === kind || k === 'image') return;
    const tok = tokenName(value);
    const resolved = tok && tok in m.tokens ? m.tokens[tok] : value;
    const g = parseGradient(value);
    if (k === 'solid') return m.patch(write(g ? g.stops[0].color : NEW_FILL));
    const base = kind === 'solid' ? value || NEW_FILL : NEW_FILL;
    const o = partsOf(kind === 'solid' ? resolved || NEW_FILL : NEW_FILL);
    const end = formatOklch({ ...o, l: o.l > 0.5 ? o.l - 0.3 : o.l + 0.3 });
    m.patch(write(formatGradient({ kind: 'linear', angle: 180, shape: '', stops: [{ color: base, pos: 0 }, { color: end, pos: 1 }] })));
  };
  return (
    <Section title="Fill" action={!has && <IconBtn label="Add fill" onClick={() => m.patch(write(NEW_FILL))}><Plus className="size-3.5" /></IconBtn>}>
      {has && !mixed && (
        <Segmented className="w-28">
          <SegBtn label="Solid" on={kind === 'solid'} onClick={() => switchTo('solid')}><Square className="size-3.5" /></SegBtn>
          <SegBtn label="Gradient" on={kind === 'gradient'} onClick={() => switchTo('gradient')}><Blend className="size-3.5" /></SegBtn>
          <SegBtn label="Image" on={kind === 'image'} onClick={() => switchTo('image')}><Image className="size-3.5" /></SegBtn>
        </Segmented>
      )}
      {has && kind === 'image' && (
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <TextField
              key={`${m.entries.map((e) => e.id).join()}:img:${value}`} label={<Image className="size-3" />} title="Image URL"
              value={imageUrl(value)} onCommit={(u) => { if (u) { setWantImage(false); m.patch(write(imageCss(u))); } }}
            />
          </div>
          <IconBtn label="Remove fill" onClick={() => { setWantImage(false); m.patch(write('')); }}><Minus className="size-3.5" /></IconBtn>
        </div>
      )}
      {has && kind !== 'image' && (
        <ColorRow
          m={m} label="Fill" value={value} mixed={mixed} write={write}
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
      {has && !mixed && !off && kind === 'gradient' && <GradientStops m={m} value={value} write={write} />}
    </Section>
  );
}

// Paper-style stop list under a gradient Fill: one row per stop (swatch + colour, position %, remove) and "+" to add.
// Rows are sorted by position but keyed by the stop's index in the CSS, so a stop moving past another reorders the row
// instead of remounting it (which would close an open picker). The gradient popover on the Fill row still edits all of it.
function GradientStops({ m, value, write }: { m: Model; value: string; write: (v: string) => Record<string, string | null> }) {
  const g = parseGradient(value);
  if (!g) return null; // a gradient the editor cannot model stays plain text in the Fill row
  const ids = m.entries.map((e) => e.id).join();
  const resolve = (css: string) => partsOf(css, m.tokens);
  const out = (next: Gradient) => write(formatGradient(next));
  const withStop = (i: number, s: Partial<Gradient['stops'][number]>) => ({ ...g, stops: g.stops.map((x, j) => (j === i ? { ...x, ...s } : x)) });
  const sorted = g.stops.map((s, i) => ({ ...s, i })).sort((a, b) => a.pos - b.pos);
  // "+" fills the widest gap with the colour the gradient already shows there, so adding a stop never changes the picture.
  const add = () => {
    let k = 0;
    for (let j = 1; j < sorted.length - 1; j++) if (sorted[j + 1].pos - sorted[j].pos > sorted[k + 1].pos - sorted[k].pos) k = j;
    const a = sorted[k], b = sorted[k + 1];
    const pos = +((a.pos + b.pos) / 2).toFixed(3);
    m.patch(out({ ...g, stops: [...g.stops, { color: formatOklch(mixOklch(resolve(a.color), resolve(b.color), 0.5)), pos }] }));
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">Stops</span>
        <IconBtn label="Add stop" onClick={add}><Plus className="size-3.5" /></IconBtn>
      </div>
      {sorted.map((s) => {
        const tok = tokenName(s.color);
        return (
          <div key={`${ids}:stop${s.i}`}>
            <div className="flex items-center gap-1">
              <NumberField
                // Value in the key so an edit from the popover or canvas refreshes the field.
                key={`${s.pos}`} className="w-16 shrink-0" label={<span className="text-[10px]">%</span>} title="stop position" min={0} max={100} step={1}
                value={Math.round(s.pos * 1000) / 10}
                onPreview={(x) => m.preview(x === null ? null : out(withStop(s.i, { pos: x / 100 })))}
                onChange={(x) => m.patch(out(withStop(s.i, { pos: Math.min(1, Math.max(0, x / 100)) })))}
              />
              <ColorField
                className="flex-1" label={`Stop ${s.i + 1}`} value={s.color} preview={tok && tok in m.tokens ? m.tokens[tok] : s.color}
                list="dl-color" tokens={colorTokens(m.tokens)}
                onPreview={(v) => m.preview(v === null ? null : out(withStop(s.i, { color: v })))}
                onChange={(v) => v && m.patch(out(withStop(s.i, { color: v })))}
              />
              <IconBtn label="Remove stop" disabled={g.stops.length <= 2} onClick={() => m.patch(out({ ...g, stops: g.stops.filter((_, j) => j !== s.i) }))}><Minus className="size-3.5" /></IconBtn>
            </div>
            <div className="pl-17"><TokenChip value={s.color} tokens={m.tokens} onDetach={(r) => m.patch(out(withStop(s.i, { color: r })))} /></div>
          </div>
        );
      })}
    </div>
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
            <FieldSelect label="Stroke style" value={st.style || 'solid'} items={['solid', 'dashed', 'dotted', 'double'].map((x) => ({ value: x, label: x[0].toUpperCase() + x.slice(1) }))} onCommit={(v) => m.patch(write({ ...st, style: v }))} />
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
