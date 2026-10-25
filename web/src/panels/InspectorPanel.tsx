import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Artboard, DocData, Page } from '@/api/types';
import { pagesOf } from '@/canvas/engine';
import { sendEdit } from '@/lib/htmlTree';
import { useCanvas } from '@/store/canvas';
import { useProject } from '@/store/project';
import { ColorField } from '@/ui/ColorField';
import { NumberField } from '@/ui/NumberField';
import { rowLabel, Section, SelectField, TextField, tokenName } from './inspector/controls';
import { AlignBar, AppearanceSection, AutoLayoutSection, PositionSection, SizeSection } from './inspector/LayoutSections';
import { tokensFor, useModel } from './inspector/model';
import { colorTokens, EffectsSection, FillSection, StrokeSection } from './inspector/PaintSections';
import { TypographySection } from './inspector/TypographySection';
import { VectorSection } from './inspector/VectorSection';

// The Design tab. Sections are Figma-style groups (Align, Position, Size, Auto layout, Appearance, Fill, Stroke,
// Effects, Typography) that each map onto inline CSS; anything they do not cover is still editable under "Other
// styles". Several selected nodes are edited together: shared values show as is, differing ones as "Mixed", and one
// edit is ONE `style` action (one undo step). Sections live in ./inspector/, shared fields in ui/.

// Datalist families for the plain text fields (an input takes one list, so weights are offered next to tokens).
const FAMILIES = ['space', 'radius', 'size', 'weight', 'leading', 'tracking', 'font', 'shadow', 'color'];

// Properties the sections cover; every other inline property shows under "Other styles".
const HANDLED = new Set([
  'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'position', 'left', 'top', 'rotate', 'display', 'flex-direction', 'flex-wrap',
  'gap', 'align-items', 'justify-content', 'padding', 'flex', 'flex-grow', 'align-self', 'opacity', 'border-radius', 'overflow', 'background', 'background-color',
  '--dc-hidden-fill', 'border', 'outline', 'outline-offset', 'box-shadow', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
  'text-align', 'color',
]);

export function InspectorPanel({ projectId }: { projectId: string }) {
  const doc = useProject((s) => s.doc);
  const ids = useCanvas((s) => s.selected);
  const page = useCanvas((s) => s.activePage);
  const mode = useCanvas((s) => s.mode);
  if (!doc) return null;

  const tokens = tokensFor(doc, mode);
  const lists = (
    <>
      {FAMILIES.map((fam) => (
        <datalist key={fam} id={`dl-${fam}`}>
          {fam === 'weight' && [100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={w} />)}
          {Object.keys(tokens).filter((k) => k.split('-')[0] === fam).map((k) => <option key={k} value={`var(--${k})`}>{tokens[k]}</option>)}
        </datalist>
      ))}
    </>
  );

  const primary = ids.at(-1) ?? null;
  if (!primary) return <PageInspector projectId={projectId} doc={doc} pageId={page} lists={lists} tokens={tokens} />;
  const board = doc.artboards.find((a) => a.id === primary);
  if (board) return <ArtboardInspector projectId={projectId} doc={doc} ab={board} />;
  return <NodeInspector projectId={projectId} doc={doc} ids={ids} lists={lists} tokens={tokens} />;
}

function NodeInspector({ projectId, doc, ids, lists, tokens }: { projectId: string; doc: DocData; ids: string[]; lists: ReactNode; tokens: Record<string, string> }) {
  const m = useModel(projectId, doc, ids, tokens);
  if (!m) return <p className="p-3 text-muted-foreground">That layer is not available.</p>;
  const { primary, entries } = m;
  const single = entries.length === 1;
  const isVector = entries.every((e) => !!e.el.closest('svg'));
  // A locked node (or one inside a locked parent) refuses edits server-side; dim the controls and say why.
  const off = m.locked;
  const other = single ? Object.entries(primary.style).filter(([k]) => !HANDLED.has(k)) : [];
  const set = (prop: string, value: string) => m.patch({ [prop]: value.trim() || null });

  return (
    <div>
      {lists}
      <div className="flex h-10 items-center justify-between gap-2 border-b px-3">
        <b className="min-w-0 truncate text-[13px] font-semibold tracking-[-0.005em]">
          {single ? primary.el.dataset.name || primary.el.tagName.toLowerCase() : `${entries.length} layers`}
        </b>
        {single && <small className="tnum shrink-0 rounded bg-field px-1.5 py-px text-[10px] text-muted-foreground">{primary.id}</small>}
      </div>
      {off && <p className="border-b px-3 py-2 text-muted-foreground">This layer is locked: unlock it in the Layers panel to edit.</p>}
      <div className={off ? 'pointer-events-none opacity-50' : undefined}>
        <AlignBar m={m} />
        <PositionSection m={m} />
        <SizeSection m={m} />
        {isVector && single && <VectorSection projectId={projectId} id={primary.id} el={primary.el} locked={off} tokens={tokens} />}
        {!isVector && (
          <>
            <AutoLayoutSection m={m} />
            <AppearanceSection m={m} />
            <FillSection m={m} />
            <StrokeSection m={m} />
            <EffectsSection m={m} />
            <TypographySection m={m} />
          </>
        )}
        {/* CSS the inspector has no dedicated control for (added by Claude or by hand): editable as raw rows. */}
        {other.length > 0 && (
          <Section title="Other styles">
            {other.map(([prop, value]) => (
              <div key={prop} className="flex items-center gap-1">
                <div className="min-w-0 flex-1"><TextField key={`${prop}:${value}`} label={prop.length > 8 ? prop.slice(0, 7) + '…' : prop} title={prop} value={value} onCommit={(v) => set(prop, v)} /></div>
                <button aria-label={`Remove ${prop}`} title={`Remove ${prop}`} onClick={() => set(prop, '')} className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted"><X className="size-3" /></button>
              </div>
            ))}
          </Section>
        )}
      </div>
    </div>
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
          <span className={rowLabel}>Canvas</span>
          <ColorField key={`${page.id}:${bg}`} className="flex-1" label="Page background" value={bg} preview={bgToken && bgToken in tokens ? tokens[bgToken] : bg} list="dl-color" tokens={colorTokens(tokens)} onChange={(v) => send({ background: v })} />
        </div>
      </Section>
      <p className="px-3 py-2 text-muted-foreground">Select a layer on the canvas or in the Layers panel to edit its styles.</p>
    </div>
  );
}
