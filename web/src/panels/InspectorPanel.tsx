import { ChevronDown, X } from 'lucide-react';
import { Fragment, useState, type ReactNode } from 'react';
import type { Artboard, DocData, Page } from '@/api/types';
import { pagesOf } from '@/canvas/engine';
import { findNode, parseStyle, sendEdit } from '@/lib/htmlTree';
import { cn } from '@/lib/utils';
import { useCanvas } from '@/store/canvas';
import { useProject } from '@/store/project';
import { ColorField } from '@/ui/ColorField';
import { FontField } from '@/ui/FontField';
import { NumberField } from '@/ui/NumberField';

// Every field maps one-to-one onto an inline CSS property, so an edit is just "set this property".
// Fields offer the project's design tokens as suggestions (a datalist per token family); a value that is a
// token shows a chip with a Detach button that swaps in the resolved value.
type Kind = 'length' | 'num' | 'text' | 'color' | 'select';
interface Field { prop: string; label: string; kind: Kind; family?: string; options?: string[]; title?: string; step?: number; min?: number; max?: number }
// A row is one full-width field or a pair sharing the row.
type Row = Field | [Field, Field];
interface SectionDef { title: string; rows: Row[]; padding?: boolean }

const sel = (prop: string, label: string, options: string[]): Field => ({ prop, label, kind: 'select', options });

const SECTIONS: SectionDef[] = [
  { title: 'Layout', rows: [
    [{ prop: 'width', label: 'W', kind: 'length', title: 'width' }, { prop: 'height', label: 'H', kind: 'length', title: 'height' }],
    sel('position', 'Position', ['static', 'relative', 'absolute', 'fixed']),
    [{ prop: 'left', label: 'X', kind: 'length', title: 'left' }, { prop: 'top', label: 'Y', kind: 'length', title: 'top' }],
  ] },
  { title: 'Auto layout', padding: true, rows: [
    sel('display', 'Display', ['block', 'flex', 'inline-flex', 'grid', 'inline-block', 'none']),
    sel('flex-direction', 'Direction', ['row', 'column', 'row-reverse', 'column-reverse']),
    { prop: 'gap', label: 'Gap', kind: 'length', family: 'space' },
    sel('align-items', 'Align', ['stretch', 'flex-start', 'center', 'flex-end', 'baseline']),
    sel('justify-content', 'Justify', ['flex-start', 'center', 'flex-end', 'space-between', 'space-around']),
    sel('flex-wrap', 'Wrap', ['nowrap', 'wrap']),
  ] },
  { title: 'Appearance', rows: [
    [{ prop: 'opacity', label: 'Opacity', kind: 'num', step: 0.05, min: 0, max: 1 }, { prop: 'border-radius', label: 'Radius', kind: 'length', family: 'radius' }],
    sel('overflow', 'Overflow', ['visible', 'hidden', 'auto', 'scroll']),
  ] },
  { title: 'Fill', rows: [{ prop: 'background', label: 'Fill', kind: 'color' }] },
  { title: 'Stroke', rows: [{ prop: 'border', label: 'Border', kind: 'text' }] },
  { title: 'Shadow', rows: [{ prop: 'box-shadow', label: 'Shadow', kind: 'text', family: 'shadow' }] },
  { title: 'Typography', rows: [
    { prop: 'font-family', label: 'Font', kind: 'text', family: 'font' },
    [{ prop: 'font-size', label: 'Size', kind: 'length', family: 'size' }, { prop: 'font-weight', label: 'Wt', kind: 'text', family: 'weight', title: 'font-weight' }],
    [{ prop: 'line-height', label: 'Line', kind: 'text', family: 'leading' }, { prop: 'letter-spacing', label: 'Track', kind: 'text', family: 'tracking' }],
    { prop: 'color', label: 'Color', kind: 'color' },
    sel('text-align', 'Align', ['left', 'center', 'right', 'justify']),
  ] },
];
// Properties the sections above (and the padding control) already cover; the rest show under "Other styles".
const HANDLED = new Set([...SECTIONS.flatMap((s) => s.rows.flat().map((f) => f.prop)), 'background-color', 'padding']);
const FAMILIES = [...new Set(SECTIONS.flatMap((s) => s.rows.flat().map((f) => f.family)).filter((f): f is string => !!f)), 'color'];

// Sections that mean nothing on an SVG node (it has no CSS fill/border/text): its own Vector section replaces them.
const NOT_FOR_SVG = new Set(['Auto layout', 'Fill', 'Stroke', 'Typography']);

// Filled field, Figma-style: no border at rest, a slightly darker fill on hover, a signal-blue ring when focused.
const chrome = 'flex h-7 min-w-0 items-center rounded-md bg-field text-xs transition-colors duration-150 pointer-hover:bg-field-hover focus-within:bg-field focus-within:ring-1 focus-within:ring-selection';
const labelCls = 'min-w-6 shrink-0 select-none px-1.5 text-center text-muted-foreground';
const tokenName = (v: string) => /^var\(--([a-z0-9-]+)\s*(?:,.*)?\)$/i.exec(v)?.[1] ?? null;
const PLAIN_PX = /^-?\d+(\.\d+)?(px)?$/;
const PLAIN_NUM = /^-?\d*\.?\d+$/;
// A bare number typed into a length field means pixels (a unitless width is invalid CSS).
const withPx = (v: string) => (PLAIN_NUM.test(v) ? `${v}px` : v);

// ---- Small controls -----------------------------------------------------------------------------

// Text input with a label chip. Edits are a draft until Enter/blur, so typing never posts per keystroke.
function TextField({ label, title, value, list, onCommit }: { label: string; title?: string; value: string; list?: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft.trim() !== value) onCommit(draft.trim());
    setDraft(null);
  };
  return (
    <label className={chrome} title={title ?? label}>
      <span className={labelCls}>{label}</span>
      <input
        aria-label={title ?? label}
        list={list}
        spellCheck={false}
        placeholder="—"
        className="min-w-0 flex-1 bg-transparent pr-1.5 outline-none"
        value={draft ?? value}
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

function SelectField({ label, value, options, names, onCommit }: { label: string; value: string; options: string[]; names?: Record<string, string>; onCommit: (v: string) => void }) {
  // A value outside the list (written by Claude) must still be shown rather than silently replaced.
  const all = ['', ...options, ...(value && !options.includes(value) ? [value] : [])];
  return (
    <label className={chrome}>
      <span className={cn(labelCls, 'w-14 text-left')}>{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onCommit(e.target.value)} className="min-w-0 flex-1 bg-transparent pr-1 outline-none [&>option]:bg-popover">
        {all.map((o) => <option key={o} value={o}>{names?.[o] ?? (o || '—')}</option>)}
      </select>
    </label>
  );
}

function Section({ title, off, children }: { title: string; off?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    // Hairline between sections (structure, so a border), title in semibold foreground with a muted chevron on the
    // trailing edge, so the eye scans titles down the left edge.
    <section className={cn('border-b px-3 pt-1 pb-3', off && 'pointer-events-none opacity-50')}>
      <button
        aria-expanded={open} onClick={() => setOpen(!open)}
        className="group/sec -mx-1 flex h-8 w-[calc(100%+0.5rem)] items-center justify-between rounded-md px-1 text-[11px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {title}
        <ChevronDown className={cn('size-3 text-muted-foreground transition-[rotate,opacity] duration-150 group-hover/sec:text-foreground', !open && '-rotate-90')} />
      </button>
      {open && <div className="flex flex-col gap-1.5">{children}</div>}
    </section>
  );
}

// ---- Padding: shorthand text, plus an expandable per-side editor --------------------------------

// Split a CSS value on spaces that are not inside parentheses (so var(--a, 1px) and calc(1px + 2px) stay whole).
function splitTop(v: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of v.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ' ' && depth === 0) { if (cur) out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

// CSS shorthand rules: 1 value = all, 2 = vertical/horizontal, 3 = top/horizontal/bottom, 4 = top/right/bottom/left.
function sidesOf(v: string): [string, string, string, string] {
  const p = splitTop(v);
  if (p.length === 0) return ['', '', '', ''];
  if (p.length === 1) return [p[0], p[0], p[0], p[0]];
  if (p.length === 2) return [p[0], p[1], p[0], p[1]];
  if (p.length === 3) return [p[0], p[1], p[2], p[1]];
  return [p[0], p[1], p[2], p[3]];
}
function shorthandOf([t, r, b, l]: string[]): string {
  const z = (s: string) => s || '0';
  [t, r, b, l] = [z(t), z(r), z(b), z(l)];
  if (t === r && r === b && b === l) return t;
  if (t === b && r === l) return `${t} ${r}`;
  return `${t} ${r} ${b} ${l}`;
}

function PaddingField({ value, onSet }: { value: string; onSet: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const sides = sidesOf(value);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        <div className="min-w-0 flex-1">
          <TextField key={value} label="Pad" title="padding" value={value} list="dl-space" onCommit={(v) => onSet(v.split(' ').map(withPx).join(' '))} />
        </div>
        <button
          aria-label="Padding per side"
          aria-pressed={open}
          title="Edit each side"
          onClick={() => setOpen(!open)}
          className={cn('h-7 shrink-0 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted', open && 'bg-muted text-foreground')}
        >
          4
        </button>
      </div>
      {open && (
        <div className="grid grid-cols-2 gap-1.5">
          {(['T', 'R', 'B', 'L'] as const).map((side, i) => (
            // The key includes the value so a doc update replaces the field's draft.
            <TextField
              key={`${side}:${sides[i]}`}
              label={side}
              title={['padding-top', 'padding-right', 'padding-bottom', 'padding-left'][i]}
              value={sides[i]}
              list="dl-space"
              onCommit={(v) => { const next = [...sides]; next[i] = withPx(v); onSet(shorthandOf(next)); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- The panel -----------------------------------------------------------------------------------

export function InspectorPanel({ projectId }: { projectId: string }) {
  const doc = useProject((s) => s.doc);
  // The primary node (last selected); editing several nodes at once comes with the Design tab rewrite.
  const selected = useCanvas((s) => s.selected.at(-1) ?? null);
  const page = useCanvas((s) => s.activePage);
  const mode = useCanvas((s) => s.mode);
  const engine = useCanvas((s) => s.engine);
  if (!doc) return null;

  // Tokens for the mode being viewed: base values plus that mode's overrides.
  const theme = doc.theme ?? { tokens: {}, modes: {} };
  const tokens: Record<string, string> = { ...theme.tokens, ...(mode === 'base' ? {} : theme.modes?.[mode] ?? {}) };
  const lists = (
    <>
      {FAMILIES.map((fam) => (
        <datalist key={fam} id={`dl-${fam}`}>
          {/* An input takes one list, so the plain numeric weights are offered next to any weight tokens. */}
          {fam === 'weight' && [100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={w} />)}
          {Object.keys(tokens).filter((k) => k.split('-')[0] === fam).map((k) => <option key={k} value={`var(--${k})`}>{tokens[k]}</option>)}
        </datalist>
      ))}
    </>
  );

  if (!selected) return <PageInspector projectId={projectId} doc={doc} pageId={page} lists={lists} tokens={tokens} />;
  const board = doc.artboards.find((a) => a.id === selected);
  if (board) return <ArtboardInspector projectId={projectId} doc={doc} ab={board} />;

  const hit = findNode(doc, selected, engine?.boardOf(selected));
  if (!hit) return <p className="p-3 text-muted-foreground">That layer is not available.</p>;
  return <NodeInspector projectId={projectId} id={selected} el={hit.el} lists={lists} tokens={tokens} />;
}

// The font-family in effect for a node: its own inline value, else the nearest ancestor's (CSS inherits it),
// with a var(--token) swapped for the token's stack so the picker can name and draw the real family.
function effectiveFamily(el: HTMLElement, tokens: Record<string, string>): { own: string; resolved: string } {
  const own = parseStyle(el.getAttribute('style') ?? '').get('font-family') ?? '';
  let raw = own;
  for (let n: HTMLElement | null = el.parentElement; !raw && n; n = n.parentElement) raw = parseStyle(n.getAttribute('style') ?? '').get('font-family') ?? '';
  const tok = tokenName(raw);
  return { own, resolved: tok && tok in tokens ? tokens[tok] : raw };
}

function NodeInspector({ projectId, id, el, lists, tokens }: { projectId: string; id: string; el: HTMLElement; lists: ReactNode; tokens: Record<string, string> }) {
  const style = parseStyle(el.getAttribute('style') ?? '');
  // A locked node (or one inside a locked parent) refuses edits server-side; dim the controls and say why.
  const locked = !!el.closest('[data-locked]');
  const set = (prop: string, value: string) => sendEdit(projectId, 'style', { ids: [id], styles: { [prop]: value.trim() || null } });
  const valueOf = (f: Field) => style.get(f.prop) ?? (f.prop === 'background' ? style.get('background-color') : undefined) ?? '';
  const other = [...style].filter(([k]) => !HANDLED.has(k));
  const projectFonts = useProject((s) => s.meta?.fonts) ?? [];
  const family = effectiveFamily(el, tokens);

  // Inside an <svg>, fill and stroke are attributes, so they go through the `attrs` action (same allowlist as the
  // set_attrs MCP tool) instead of `style`.
  const isVector = !!el.closest('svg');
  const setAttr = (attr: string, value: string) => sendEdit(projectId, 'attrs', { ids: [id], attrs: { [attr]: value.trim() || null } });

  const control = (f: Field) => {
    const value = valueOf(f);
    // The key carries the value so an outside change (Claude, undo) replaces any stale draft in the field.
    const key = `${id}:${f.prop}:${value}`;
    const name = tokenName(value);
    const list = f.family ? `dl-${f.family}` : undefined;
    let body: ReactNode;
    if (f.prop === 'font-family') {
      // Picker (name drawn in its own face) over a raw-stack field: the stack stays editable for fallbacks and tokens.
      body = (
        <div key={key} className="flex flex-col gap-1.5">
          <FontField value={value} resolved={family.resolved} projectFonts={projectFonts} onChange={(v) => set('font-family', v)} />
          <TextField label="Stack" title="font-family" value={value} list={list} onCommit={(v) => set('font-family', v)} />
        </div>
      );
    } else if (f.kind === 'select') {
      body = <SelectField key={key} label={f.label} value={value} options={f.options!} onCommit={(v) => set(f.prop, v)} />;
    } else if (f.kind === 'color') {
      const resolved = name && name in tokens ? tokens[name] : value;
      body = (
        <div key={key} className="flex items-center gap-1">
          <span className="w-11 shrink-0 px-1.5 text-xs text-muted-foreground">{f.label}</span>
          <ColorField className="flex-1" label={f.label} value={value} preview={resolved} list="dl-color" onChange={(v) => set(f.prop, v)} />
        </div>
      );
    } else if (f.kind === 'length' && PLAIN_PX.test(value)) {
      // A plain pixel value scrubs; anything else (var(), %, auto) falls back to the text field below.
      body = <NumberField key={key} label={f.label} title={f.title ?? f.label} value={parseFloat(value)} unit="px" onChange={(n) => set(f.prop, `${n}px`)} />;
    } else if (f.kind === 'num' && PLAIN_NUM.test(value)) {
      body = <NumberField key={key} label={f.label} title={f.title ?? f.label} value={parseFloat(value)} step={f.step} min={f.min} max={f.max} onChange={(n) => set(f.prop, String(n))} />;
    } else {
      body = <TextField key={key} label={f.label} title={f.title} value={value} list={list} onCommit={(v) => set(f.prop, f.kind === 'length' ? withPx(v) : v)} />;
    }
    return (
      <div key={f.prop} className="min-w-0">
        {body}
        {name && (
          <button
            title={`Detach: replace var(--${name}) with its value`}
            disabled={!(name in tokens)}
            onClick={() => name in tokens && set(f.prop, tokens[name])}
            className="mt-0.5 flex items-center gap-1 rounded bg-muted px-1.5 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {name} <X className="size-2.5" />
          </button>
        )}
      </div>
    );
  };

  return (
    <div>
      {lists}
      <div className="flex h-10 items-center justify-between gap-2 border-b px-3">
        <b className="min-w-0 truncate text-[13px] font-semibold tracking-[-0.005em]">{el.dataset.name || el.tagName.toLowerCase()}</b>
        <small className="tnum shrink-0 rounded bg-field px-1.5 py-px text-[10px] text-muted-foreground">{id}</small>
      </div>
      {locked && <p className="border-b px-3 py-2 text-muted-foreground">This layer is locked: unlock it in the Layers panel to edit.</p>}
      {SECTIONS.map((s, si) => (
        <Fragment key={s.title}>
        {si === 1 && isVector && <VectorSection id={id} el={el} locked={locked} tokens={tokens} setAttr={setAttr} />}
        {!(isVector && NOT_FOR_SVG.has(s.title)) && (
        <Section title={s.title} off={locked}>
          {s.rows.map((row, i) =>
            Array.isArray(row)
              ? <div key={i} className="grid grid-cols-2 gap-1.5">{row.map(control)}</div>
              : control(row))}
          {s.padding && <PaddingField key={`${id}:${style.get('padding') ?? ''}`} value={style.get('padding') ?? ''} onSet={(v) => set('padding', v)} />}
        </Section>
        )}
        </Fragment>
      ))}
      {/* CSS the inspector has no dedicated control for (added by Claude or by hand): editable as raw rows. */}
      {other.length > 0 && (
        <Section title="Other styles" off={locked}>
          {other.map(([prop, value]) => (
            <div key={prop} className="flex items-center gap-1">
              <div className="min-w-0 flex-1"><TextField key={`${prop}:${value}`} label={prop.length > 8 ? prop.slice(0, 7) + '…' : prop} title={prop} value={value} onCommit={(v) => set(prop, v)} /></div>
              <button aria-label={`Remove ${prop}`} title={`Remove ${prop}`} onClick={() => set(prop, '')} className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted"><X className="size-3" /></button>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

// Paint of an SVG node: fill, stroke and its details. Values are the element's own attributes; an empty field means
// "inherit" (a shape drawn with the shape tools keeps its paint on the <svg> root and the inner shape inherits it).
function VectorSection({ id, el, locked, tokens, setAttr }: { id: string; el: HTMLElement; locked: boolean; tokens: Record<string, string>; setAttr: (attr: string, value: string) => void }) {
  const attr = (a: string) => el.getAttribute(a) ?? '';
  const color = (a: 'fill' | 'stroke', label: string) => {
    const value = attr(a);
    const tok = tokenName(value);
    return (
      <div key={`${id}:${a}:${value}`} className="flex items-center gap-1">
        <span className="w-11 shrink-0 px-1.5 text-xs text-muted-foreground">{label}</span>
        <ColorField className="flex-1" label={label} value={value} preview={tok && tok in tokens ? tokens[tok] : value} list="dl-color" onChange={(v) => setAttr(a, v)} />
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

function ArtboardInspector({ projectId, doc, ab }: { projectId: string; doc: DocData; ab: Artboard }) {
  const pages = pagesOf(doc);
  const send = (action: string, body: unknown) => sendEdit(projectId, action, body);
  const geo = (key: 'x' | 'y' | 'width' | 'height', label: string, min?: number) => (
    <NumberField key={`${ab.id}:${key}:${ab[key]}`} label={label} title={key} value={Math.round(ab[key])} min={min}
      onChange={(n) => {
        const next = { ...ab, [key]: n };
        if (key === 'x' || key === 'y') send('move', { id: ab.id, x: next.x, y: next.y });
        else send('resize', { id: ab.id, width: next.width, height: next.height });
      }} />
  );
  return (
    <div>
      <Section title="Artboard">
        <TextField key={`${ab.id}:${ab.name}`} label="Name" value={ab.name} onCommit={(v) => v && send('rename', { id: ab.id, name: v })} />
        {pages.length > 1 && (
          // Changing the page moves the board (it then disappears from the page being viewed).
          <SelectField label="Page" value={ab.page ?? pages[0].id} options={pages.map((p) => p.id)} names={Object.fromEntries(pages.map((p) => [p.id, p.name]))} onCommit={(v) => send('move-to-page', { ids: [ab.id], page: v })} />
        )}
        <div className="grid grid-cols-2 gap-1.5">{geo('width', 'W', 1)}{geo('height', 'H', 1)}</div>
        <div className="grid grid-cols-2 gap-1.5">{geo('x', 'X')}{geo('y', 'Y')}</div>
      </Section>
    </div>
  );
}

// Nothing selected: the page itself (name and canvas background).
function PageInspector({ projectId, doc, pageId, lists, tokens }: { projectId: string; doc: DocData; pageId: string | null; lists: ReactNode; tokens: Record<string, string> }) {
  const pages = pagesOf(doc);
  const page: Page = pages.find((p) => p.id === pageId) ?? pages[0];
  const send = (body: Record<string, unknown>) => sendEdit(projectId, 'page-update', { id: page.id, ...body });
  const bg = page.background ?? '';
  const bgToken = tokenName(bg);
  return (
    <div>
      {lists}
      <Section title="Page">
        <TextField key={`${page.id}:${page.name}`} label="Name" value={page.name} onCommit={(v) => v && send({ name: v })} />
        <div className="flex items-center gap-1">
          <span className="w-11 shrink-0 px-1.5 text-xs text-muted-foreground">Canvas</span>
          <ColorField key={`${page.id}:${bg}`} className="flex-1" label="Page background" value={bg} preview={bgToken && bgToken in tokens ? tokens[bgToken] : bg} list="dl-color" onChange={(v) => send({ background: v })} />
        </div>
      </Section>
      <p className="px-3 py-2 text-muted-foreground">Select a layer on the canvas or in the Layers panel to edit its styles.</p>
    </div>
  );
}
