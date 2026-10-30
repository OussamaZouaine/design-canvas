import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceBetween, AlignStartHorizontal,
  AlignStartVertical, AlignVerticalSpaceBetween, ArrowDown, ArrowRight, Minus, MoveHorizontal, MoveVertical, Plus, RotateCw, WrapText,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  alignDeltas, distributeDeltas, flowAlign, gridCell, gridPatch, MIXED, px, rotationOf, shorthandOf, sidesOf, sizeCss, sizeMode, toPx,
  type AlignOp, type Axis, type Box, type SizeMode, type StyleMap,
} from '@/lib/inspect';
import { cn } from '@/lib/utils';
import { toast } from '@/store/toast';
import { NumberField } from '@/ui/NumberField';
import { chrome, IconBtn, LengthField, Section, SegBtn, Segmented, SelectField, TextField, withPx } from './controls';
import type { Entry, Model, StylePatch } from './model';

const isAbs = (e: Entry) => e.style.position === 'absolute' || e.style.position === 'fixed';
const roundPx = (n: number) => Math.round(n * 100) / 100;

// ---- Align bar -----------------------------------------------------------------------------------------------

const ALIGN: { op: AlignOp; label: string; icon: typeof AlignStartVertical }[] = [
  { op: 'left', label: 'Align left', icon: AlignStartVertical },
  { op: 'hcenter', label: 'Align horizontal centres', icon: AlignCenterVertical },
  { op: 'right', label: 'Align right', icon: AlignEndVertical },
  { op: 'top', label: 'Align top', icon: AlignStartHorizontal },
  { op: 'vcenter', label: 'Align vertical centres', icon: AlignCenterHorizontal },
  { op: 'bottom', label: 'Align bottom', icon: AlignEndHorizontal },
];

// Absolute nodes get new left / top; flow children get flex properties instead (they cannot take left / top):
// cross-axis ops set the child's align-self, main-axis ops set the parent's justify-content.
function runAlign(m: Model, op: AlignOp) {
  if (m.entries.every(isAbs)) {
    const boxes: (Box | null)[] = m.entries.map((e) => { const r = m.measure(e.id); return r && { x: r.x, y: r.y, w: r.w, h: r.h }; });
    if (boxes.some((b) => !b)) return toast('Zoom in so the layers are drawn, then align');
    const bs = boxes as Box[];
    // One layer aligns to its parent; several align to their shared bounding box (Figma's rule).
    const first = m.measure(m.primary.id)!;
    const container: Box = bs.length === 1
      ? { x: 0, y: 0, w: first.pw, h: first.ph }
      : { x: Math.min(...bs.map((b) => b.x)), y: Math.min(...bs.map((b) => b.y)), w: 0, h: 0 };
    if (bs.length > 1) {
      container.w = Math.max(...bs.map((b) => b.x + b.w)) - container.x;
      container.h = Math.max(...bs.map((b) => b.y + b.h)) - container.y;
    }
    const d = alignDeltas(bs, op, container);
    m.patchEach((e) => {
      const i = m.entries.indexOf(e);
      const p: StylePatch = {};
      if (Math.abs(d[i].dx) > 0.01) p.left = toPx((px(e.style.left) ?? bs[i].x) + d[i].dx);
      if (Math.abs(d[i].dy) > 0.01) p.top = toPx((px(e.style.top) ?? bs[i].y) + d[i].dy);
      return Object.keys(p).length ? p : null;
    });
    return;
  }
  if (m.entries.some(isAbs)) return toast('Select only absolute layers or only auto-layout children to align');
  const extra: Record<string, StylePatch> = {};
  const self = new Map<string, StylePatch>();
  for (const e of m.entries) {
    const f = flowAlign(op, e.parent);
    if (!f) return toast('The parent is not an auto layout: switch it on first, or make the layer absolute');
    if (f.target === 'self') self.set(e.id, { [f.prop]: f.value });
    else if (e.parentId) extra[e.parentId] = { [f.prop]: f.value };
    else return toast('Top-level layers can only align across the board: use the other axis, or make the layer absolute');
  }
  m.patchEach((e) => self.get(e.id) ?? null, extra);
}

function runDistribute(m: Model, axis: 'x' | 'y') {
  if (m.entries.length >= 3 && m.entries.every(isAbs)) {
    const boxes = m.entries.map((e) => m.measure(e.id));
    if (boxes.some((b) => !b)) return toast('Zoom in so the layers are drawn, then distribute');
    const d = distributeDeltas(boxes as Box[], axis);
    m.patchEach((e) => {
      const i = m.entries.indexOf(e);
      const key = axis === 'x' ? 'left' : 'top';
      const dv = axis === 'x' ? d[i].dx : d[i].dy;
      return Math.abs(dv) > 0.01 ? { [key]: toPx((px(e.style[key]) ?? (boxes[i] as Box)[axis]) + dv) } : null;
    });
    return;
  }
  // In a flex parent "distribute" is space-between along the main axis.
  const parentId = m.primary.parentId;
  const same = parentId && m.entries.every((e) => e.parentId === parentId && !isAbs(e));
  if (m.entries.length >= 2 && same && m.primary.parent.flex && m.primary.parent.column === (axis === 'y')) {
    m.patchEach(() => null, { [parentId]: { 'justify-content': 'space-between' } });
    return;
  }
  toast('Distribute needs three absolute layers, or several children of an auto layout along its direction');
}

export function AlignBar({ m }: { m: Model }) {
  const n = m.entries.length;
  const canDistribute = n >= 3 || (n >= 2 && m.primary.parent.flex);
  return (
    <div className="flex items-center justify-between border-b px-2 py-1.5">
      {ALIGN.map(({ op, label, icon: Icon }) => <IconBtn key={op} label={label} onClick={() => runAlign(m, op)}><Icon className="size-3.5" /></IconBtn>)}
      <span className="mx-0.5 h-4 w-px bg-border" />
      <IconBtn label="Distribute horizontally" disabled={!canDistribute} onClick={() => runDistribute(m, 'x')}><AlignHorizontalSpaceBetween className="size-3.5" /></IconBtn>
      <IconBtn label="Distribute vertically" disabled={!canDistribute} onClick={() => runDistribute(m, 'y')}><AlignVerticalSpaceBetween className="size-3.5" /></IconBtn>
    </div>
  );
}

// ---- Position ------------------------------------------------------------------------------------------------

// X / Y edit left / top and are live only for absolute nodes; for flow nodes they show where the node sits (greyed)
// and the toggle turns it absolute at that exact offset ("ignore auto layout" in Figma).
export function PositionSection({ m }: { m: Model }) {
  const abs = m.entries.every(isAbs);
  const anyAbs = m.entries.some(isAbs);
  const key = (p: string) => `${m.entries.map((e) => e.id).join()}:${p}:${m.get(p)}`;

  const coord = (prop: 'left' | 'top', label: string) => {
    const v = m.get(prop);
    if (abs && v !== MIXED && v !== '' && px(v) === null) return <TextField key={key(prop)} label={label} title={prop} value={v} onCommit={(t) => m.patch({ [prop]: withPx(t) || null })} />;
    const mixed = abs && v === MIXED;
    const measured = m.entries.map((e) => { const r = m.measure(e.id); return r ? (prop === 'left' ? r.x : r.y) : null; });
    const vals = m.entries.map((e, i) => (abs ? px(e.style[prop]) ?? measured[i] : measured[i]));
    const same = vals.every((x) => x !== null && Math.abs(x - (vals[0] as number)) < 0.5);
    return (
      <NumberField
        key={key(prop) + measured.join()} label={label} title={prop === 'left' ? 'x' : 'y'} disabled={!abs}
        value={same ? roundPx(vals[0] as number) : null} mixed={mixed || !same}
        onPreview={(x) => m.preview(x === null ? null : { [prop]: toPx(x) })}
        onChange={(x) => m.patch({ [prop]: toPx(x) })}
      />
    );
  };

  const rot = m.getBy((e) => e.style.rotate ?? '');
  const rotN = rot === MIXED ? null : rotationOf(rot);

  const toggleAbsolute = () => {
    if (abs) {
      // Back into the flow: drop the offsets too, they mean nothing there.
      m.patch({ position: null, left: null, top: null, right: null, bottom: null });
      return;
    }
    const meas = m.entries.map((e) => m.measure(e.id));
    if (meas.some((r) => !r)) return toast('Zoom in so the layers are drawn, then switch to absolute');
    const extra: Record<string, StylePatch> = {};
    // An absolute child positions against its nearest positioned ancestor; make the parent one so the offset we
    // measured is the offset it gets (a static parent would silently use a further-out ancestor).
    for (const e of m.entries) if (e.parentId && !['relative', 'absolute', 'fixed'].includes(e.parentStyle?.position ?? '')) extra[e.parentId] = { position: 'relative' };
    m.patchEach((e) => {
      const r = m.measure(e.id)!;
      // Keep the size the node has now: an absolute box without a width would shrink to its content.
      const p: StylePatch = { position: 'absolute', left: toPx(r.x), top: toPx(r.y) };
      if (sizeMode('width', e.style, e.parent) !== 'fixed') p.width = toPx(r.w);
      if (sizeMode('height', e.style, e.parent) !== 'fixed') p.height = toPx(r.h);
      p.flex = null;
      p['align-self'] = null; // stretch / flex-start only mean something for in-flow children
      return p;
    }, extra);
  };

  return (
    <Section title="Position">
      <div className="grid grid-cols-2 gap-1.5">{coord('left', 'X')}{coord('top', 'Y')}</div>
      <div className="grid grid-cols-2 gap-1.5">
        <NumberField
          key={key('rotate')} label={<RotateCw className="size-3" />} title="rotation" unit="°" step={1}
          value={rotN} mixed={rot === MIXED} min={-360} max={360}
          onPreview={(x) => m.preview(x === null ? null : { rotate: `${x}deg` })}
          onChange={(x) => m.patch({ rotate: x === 0 ? null : `${x}deg` })}
        />
        <button
          type="button" aria-pressed={abs}
          title="Absolute position: take the layer out of the auto layout, keeping its offset"
          onClick={toggleAbsolute}
          className={cn(chrome, 'justify-center gap-1.5 px-2 text-muted-foreground transition-[background-color,color,scale] active:scale-[0.96] pointer-hover:hover:text-foreground', abs && 'bg-selection-soft text-selection-ink', !abs && anyAbs && 'opacity-70')}
        >
          Absolute
        </button>
      </div>
    </Section>
  );
}

// ---- Size ------------------------------------------------------------------------------------------------------

const MODES: SizeMode[] = ['fixed', 'hug', 'fill'];
const MODE_NAME: Record<string, string> = { fixed: 'Fixed', hug: 'Hug', fill: 'Fill' };

function AxisRow({ m, axis, label }: { m: Model; axis: Axis; label: string }) {
  const modes = m.entries.map((e) => sizeMode(axis, e.style, e.parent));
  const mode = modes.every((x) => x === modes[0]) ? modes[0] : MIXED;
  const nums = m.entries.map((e) => px(e.style[axis]) ?? (axis === 'width' ? m.measure(e.id)?.w : m.measure(e.id)?.h) ?? null);
  const same = nums.every((x) => x !== null && Math.abs(x - (nums[0] as number)) < 0.5);
  const cur = (e: Entry) => (axis === 'width' ? m.measure(e.id)?.w : m.measure(e.id)?.h) ?? px(e.style[axis]) ?? 0;
  const setNum = (x: number) => m.patchEach((e) => sizeCss(axis, 'fixed', e.style, e.parent, x));
  return (
    <div className="flex gap-1.5">
      <NumberField
        key={`${m.entries.map((e) => e.id).join()}:${axis}:${m.getBy((e) => (e.style[axis] ?? '') + (e.style.flex ?? '') + (e.style['align-self'] ?? ''))}`}
        className="min-w-0 flex-1" label={label} title={axis} min={0}
        value={same ? roundPx(nums[0] as number) : null} mixed={!same}
        onPreview={(x) => (x === null ? m.preview(null) : m.previewEach((e) => sizeCss(axis, 'fixed', e.style, e.parent, x)))}
        onChange={setNum}
      />
      <label className={cn(chrome, 'w-[4.75rem] shrink-0')}>
        <select
          aria-label={`${axis} mode`} value={mode}
          onChange={(e) => e.target.value !== MIXED && m.patchEach((n) => sizeCss(axis, e.target.value as SizeMode, n.style, n.parent, cur(n)))}
          className="min-w-0 flex-1 bg-transparent px-1.5 outline-none [&>option]:bg-popover"
        >
          {mode === MIXED && <option value={MIXED}>Mixed</option>}
          {MODES.map((x) => <option key={x} value={x}>{MODE_NAME[x]}</option>)}
        </select>
      </label>
    </div>
  );
}

export function SizeSection({ m }: { m: Model }) {
  const [more, setMore] = useState(false);
  return (
    <Section title="Size" action={<IconBtn label="Min / max size" on={more} onClick={() => setMore(!more)}><Plus className="size-3.5" /></IconBtn>}>
      <AxisRow m={m} axis="width" label="W" />
      <AxisRow m={m} axis="height" label="H" />
      {more && (
        <div className="grid grid-cols-2 gap-1.5">
          <LengthField m={m} prop="min-width" unsetAsText label="Min W" min={0} />
          <LengthField m={m} prop="max-width" unsetAsText label="Max W" min={0} />
          <LengthField m={m} prop="min-height" unsetAsText label="Min H" min={0} />
          <LengthField m={m} prop="max-height" unsetAsText label="Max H" min={0} />
        </div>
      )}
    </Section>
  );
}

// ---- Sides: padding and radius ------------------------------------------------------------------------------

// One or two sides of a four-value shorthand (padding, border-radius). Each node's own shorthand is split, the chosen
// sides replaced, and joined back, so nodes with different padding keep their other sides when several are edited.
export function SidesField({ m, prop, idx, label, title }: { m: Model; prop: 'padding' | 'border-radius'; idx: number[]; label: ReactNode; title: string }) {
  const pick = (e: Entry) => { const s = sidesOf(e.style[prop] ?? ''); return idx.every((i) => s[i] === s[idx[0]]) ? s[idx[0]] : MIXED; };
  const v = m.getBy(pick);
  const mixed = v === MIXED;
  const next = (e: Entry, text: string) => { const s = [...sidesOf(e.style[prop] ?? '')]; for (const i of idx) s[i] = text; return { [prop]: shorthandOf(s) }; };
  const key = `${m.entries.map((e) => e.id).join()}:${prop}:${idx.join()}:${m.get(prop)}`;
  const n = px(v === '' ? '0' : v);
  if (!mixed && n === null) return <TextField key={key} label={label} title={title} value={v} list="dl-space" onCommit={(t) => m.patchEach((e) => next(e, withPx(t)))} />;
  return (
    <NumberField
      key={key} label={label} title={title} min={0} value={mixed ? null : n} mixed={mixed}
      onPreview={(x) => (x === null ? m.preview(null) : m.previewEach((e) => next(e, toPx(x))))}
      onChange={(x) => m.patchEach((e) => next(e, toPx(x)))}
    />
  );
}

// ---- Auto layout --------------------------------------------------------------------------------------------

// 3x3 grid of dots: the lit one is the current justify-content x align-items pair; clicking sets both together.
function AlignGrid({ m, style }: { m: Model; style: StyleMap }) {
  const cell = gridCell(style);
  return (
    <div role="group" aria-label="Alignment" className="grid size-[4.5rem] shrink-0 grid-cols-3 grid-rows-3 rounded-md bg-field p-0.5">
      {[0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => {
        const on = cell?.col === col && cell.row === row;
        return (
          <button
            key={`${col}${row}`} type="button" aria-label={`Align ${['top', 'middle', 'bottom'][row]} ${['left', 'centre', 'right'][col]}`} aria-pressed={on}
            onClick={() => m.patchEach((e) => gridPatch({ col, row }, e.style))}
            className="group grid place-items-center rounded-[5px] outline-none focus-visible:ring-1 focus-visible:ring-selection"
          >
            <span className={cn('rounded-full transition-[scale,background-color] duration-150', on ? 'size-2 bg-selection' : 'size-1 bg-muted-foreground/60 group-hover:scale-150 motion-reduce:transition-none')} />
          </button>
        );
      }))}
    </div>
  );
}

export function AutoLayoutSection({ m }: { m: Model }) {
  const display = m.get('display');
  const isFlex = display === 'flex' || display === 'inline-flex';
  const isGrid = display === 'grid';
  const [four, setFour] = useState(false);
  // Shared view of the layout props; a MIXED entry makes gridCell return null, so nothing lights up.
  const s: StyleMap = Object.fromEntries(['flex-direction', 'justify-content', 'align-items', 'flex-wrap'].map((p) => [p, m.get(p)]));
  const dir = s['flex-direction'];
  const between = s['justify-content'] === 'space-between';

  const toggle = (
    <IconBtn label={isFlex ? 'Remove auto layout' : 'Add auto layout'} onClick={() => m.patch(isFlex ? { display: 'block' } : { display: 'flex' })}>
      {isFlex ? <Minus className="size-3.5" /> : <Plus className="size-3.5" />}
    </IconBtn>
  );
  const padding = (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        {four
          ? <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
              <SidesField m={m} prop="padding" idx={[0]} label="T" title="padding-top" />
              <SidesField m={m} prop="padding" idx={[1]} label="R" title="padding-right" />
              <SidesField m={m} prop="padding" idx={[2]} label="B" title="padding-bottom" />
              <SidesField m={m} prop="padding" idx={[3]} label="L" title="padding-left" />
            </div>
          : <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
              <SidesField m={m} prop="padding" idx={[1, 3]} label={<MoveHorizontal className="size-3" />} title="padding horizontal" />
              <SidesField m={m} prop="padding" idx={[0, 2]} label={<MoveVertical className="size-3" />} title="padding vertical" />
            </div>}
        <IconBtn label="Padding per side" on={four} onClick={() => setFour(!four)} className="self-start"><span className="text-[10px] font-semibold">4</span></IconBtn>
      </div>
    </div>
  );

  return (
    <Section title="Auto layout" action={toggle}>
      {isFlex && (
        <>
          <div className="flex gap-1.5">
            <Segmented className="flex-1">
              <SegBtn label="Horizontal" on={dir === '' || dir === 'row'} onClick={() => m.patch({ 'flex-direction': 'row' })}><ArrowRight className="size-3.5" /></SegBtn>
              <SegBtn label="Vertical" on={dir === 'column'} onClick={() => m.patch({ 'flex-direction': 'column' })}><ArrowDown className="size-3.5" /></SegBtn>
            </Segmented>
            <IconBtn label="Wrap" on={s['flex-wrap'] === 'wrap'} onClick={() => m.patch({ 'flex-wrap': s['flex-wrap'] === 'wrap' ? null : 'wrap' })} className="bg-field"><WrapText className="size-3.5" /></IconBtn>
          </div>
          <div className="flex gap-1.5">
            <AlignGrid m={m} style={s} />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <LengthField m={m} prop="gap" label={<span className="text-[10px]">Gap</span>} title="gap" family="space" min={0} />
              <button
                type="button" aria-pressed={between}
                title="Space between: spread the children along the main axis"
                onClick={() => m.patch({ 'justify-content': between ? 'flex-start' : 'space-between' })}
                className={cn(chrome, 'justify-center px-2 text-muted-foreground transition-[background-color,color,scale] active:scale-[0.96] pointer-hover:hover:text-foreground', between && 'bg-selection-soft text-selection-ink')}
              >
                Space between
              </button>
            </div>
          </div>
        </>
      )}
      {isGrid && <LengthField m={m} prop="gap" label={<span className="text-[10px]">Gap</span>} title="gap" family="space" min={0} />}
      {!isFlex && !isGrid && display !== MIXED && <SelectField label="Display" value={display} options={['block', 'flex', 'inline-flex', 'grid', 'inline-block', 'none']} onCommit={(v) => m.patch({ display: v || null })} />}
      {padding}
    </Section>
  );
}

// ---- Appearance -------------------------------------------------------------------------------------------------

export function AppearanceSection({ m }: { m: Model }) {
  const [corners, setCorners] = useState(false);
  const op = m.get('opacity');
  const opN = op === MIXED ? null : op === '' ? 100 : Math.round(parseFloat(op) * 1000) / 10;
  const clip = m.get('overflow') === 'hidden';
  return (
    <Section title="Appearance">
      <div className="grid grid-cols-2 gap-1.5">
        <NumberField
          key={`${m.entries.map((e) => e.id).join()}:op:${op}`} label={<span className="text-[10px]">Op</span>} title="opacity" unit="%" min={0} max={100}
          value={Number.isFinite(opN as number) ? opN : null} mixed={op === MIXED}
          onPreview={(x) => m.preview(x === null ? null : { opacity: String(x / 100) })}
          onChange={(x) => m.patch({ opacity: x >= 100 ? null : String(x / 100) })}
        />
        <div className="flex gap-1.5">
          <SidesField m={m} prop="border-radius" idx={[0, 1, 2, 3]} label={<span className="text-[10px]">R</span>} title="radius" />
          <IconBtn label="Radius per corner" on={corners} onClick={() => setCorners(!corners)}><span className="text-[10px] font-semibold">4</span></IconBtn>
        </div>
      </div>
      {corners && (
        <div className="grid grid-cols-2 gap-1.5">
          <SidesField m={m} prop="border-radius" idx={[0]} label="TL" title="top-left radius" />
          <SidesField m={m} prop="border-radius" idx={[1]} label="TR" title="top-right radius" />
          <SidesField m={m} prop="border-radius" idx={[3]} label="BL" title="bottom-left radius" />
          <SidesField m={m} prop="border-radius" idx={[2]} label="BR" title="bottom-right radius" />
        </div>
      )}
      <label className="flex h-7 cursor-pointer items-center gap-2 px-1.5 text-xs">
        <input type="checkbox" checked={clip} ref={(el) => { if (el) el.indeterminate = m.get('overflow') === MIXED; }} onChange={() => m.patch({ overflow: clip ? null : 'hidden' })} className="size-3.5 accent-[var(--selection)]" />
        Clip content
      </label>
    </Section>
  );
}
