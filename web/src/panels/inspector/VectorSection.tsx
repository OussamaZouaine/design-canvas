import { sendEdit } from '@/lib/htmlTree';
import { ColorField } from '@/ui/ColorField';
import { NumberField } from '@/ui/NumberField';
import { PLAIN_NUM, rowLabel, Section, SelectField, TextField, tokenName } from './controls';
import { colorTokens } from './PaintSections';

// Paint of an SVG node: fill, stroke and its details. Values are the element's own attributes; an empty field means
// "inherit" (a shape drawn with the shape tools keeps its paint on the <svg> root and the inner shape inherits it).
// Inside an <svg>, fill and stroke are attributes, so they go through the `attrs` action (same allowlist as the
// set_attrs MCP tool) instead of `style`.
export function VectorSection({ projectId, id, el, locked, tokens }: { projectId: string; id: string; el: HTMLElement; locked: boolean; tokens: Record<string, string> }) {
  const setAttr = (attr: string, value: string) => sendEdit(projectId, 'attrs', { ids: [id], attrs: { [attr]: value.trim() || null } });
  const attr = (a: string) => el.getAttribute(a) ?? '';
  const color = (a: 'fill' | 'stroke', label: string) => {
    const value = attr(a);
    const tok = tokenName(value);
    return (
      <div key={`${id}:${a}:${value}`} className="flex items-center gap-1">
        <span className={rowLabel}>{label}</span>
        <ColorField className="flex-1" label={label} value={value} preview={tok && tok in tokens ? tokens[tok] : value} list="dl-color" tokens={colorTokens(tokens)} onChange={(v) => setAttr(a, v)} />
      </div>
    );
  };
  const width = attr('stroke-width');
  return (
    <Section title="Vector" off={locked}>
      {color('fill', 'Fill')}
      {color('stroke', 'Stroke')}
      {(width === '' || PLAIN_NUM.test(width))
        ? <NumberField key={`${id}:sw:${width}`} label="Width" title="stroke-width" value={width === '' ? 0 : parseFloat(width)} step={0.5} min={0} onChange={(n) => setAttr('stroke-width', String(n))} />
        : <TextField key={`${id}:sw:${width}`} label="Width" title="stroke-width" value={width} onCommit={(v) => setAttr('stroke-width', v)} />}
      <SelectField key={`${id}:cap:${attr('stroke-linecap')}`} label="Cap" value={attr('stroke-linecap')} options={['butt', 'round', 'square']} onCommit={(v) => setAttr('stroke-linecap', v)} />
      <SelectField key={`${id}:join:${attr('stroke-linejoin')}`} label="Join" value={attr('stroke-linejoin')} options={['miter', 'round', 'bevel']} onCommit={(v) => setAttr('stroke-linejoin', v)} />
      <TextField key={`${id}:dash:${attr('stroke-dasharray')}`} label="Dash" title="stroke-dasharray" value={attr('stroke-dasharray')} onCommit={(v) => setAttr('stroke-dasharray', v)} />
    </Section>
  );
}
