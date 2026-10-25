import { AlignCenter, AlignJustify, AlignLeft, AlignRight } from 'lucide-react';
import { parseStyle } from '@/lib/htmlTree';
import { MIXED } from '@/lib/inspect';
import { useProject } from '@/store/project';
import { FontField } from '@/ui/FontField';
import { LengthField, Section, SegBtn, Segmented, TextField, tokenName } from './controls';
import type { Model } from './model';
import { ColorRow } from './PaintSections';

// The font-family in effect for a node: its own inline value, else the nearest ancestor's (CSS inherits it),
// with a var(--token) swapped for the token's stack so the picker can name and draw the real family.
function effectiveFamily(el: HTMLElement, tokens: Record<string, string>): string {
  let raw = parseStyle(el.getAttribute('style') ?? '').get('font-family') ?? '';
  for (let n: HTMLElement | null = el.parentElement; !raw && n; n = n.parentElement) raw = parseStyle(n.getAttribute('style') ?? '').get('font-family') ?? '';
  const tok = tokenName(raw);
  return tok && tok in tokens ? tokens[tok] : raw;
}

const ALIGNS = [
  ['left', 'Align text left', AlignLeft], ['center', 'Align text centre', AlignCenter],
  ['right', 'Align text right', AlignRight], ['justify', 'Justify text', AlignJustify],
] as const;

export function TypographySection({ m }: { m: Model }) {
  const projectFonts = useProject((s) => s.meta?.fonts) ?? [];
  const font = m.get('font-family');
  const align = m.get('text-align');
  const key = (p: string) => `${m.entries.map((e) => e.id).join()}:${p}:${m.get(p)}`;
  const text = (prop: string, label: string, title: string, family: string) => (
    <TextField key={key(prop)} label={label} title={title} value={m.get(prop) === MIXED ? '' : m.get(prop)} mixed={m.get(prop) === MIXED} list={`dl-${family}`} onCommit={(v) => m.patch({ [prop]: v || null })} />
  );
  return (
    <Section title="Typography">
      <div key={key('font-family')} className="flex flex-col gap-1.5">
        <FontField value={font === MIXED ? '' : font} resolved={font === MIXED ? '' : effectiveFamily(m.primary.el, m.tokens)} projectFonts={projectFonts} onChange={(v) => m.patch({ 'font-family': v || null })} />
        <TextField label="Stack" title="font-family" value={font === MIXED ? '' : font} mixed={font === MIXED} list="dl-font" onCommit={(v) => m.patch({ 'font-family': v || null })} />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <LengthField m={m} prop="font-size" unsetAsText label="Size" family="size" min={1} />
        {text('font-weight', 'Wt', 'font-weight', 'weight')}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {text('line-height', 'Line', 'line-height', 'leading')}
        {text('letter-spacing', 'Track', 'letter-spacing', 'tracking')}
      </div>
      <Segmented>
        {ALIGNS.map(([v, label, Icon]) => <SegBtn key={v} label={label} on={align === v} onClick={() => m.patch({ 'text-align': v })}><Icon className="size-3.5" /></SegBtn>)}
      </Segmented>
      <ColorRow m={m} label="Color" value={m.get('color') === MIXED ? '' : m.get('color')} mixed={m.get('color') === MIXED} write={(v) => ({ color: v || null })} />
    </Section>
  );
}
