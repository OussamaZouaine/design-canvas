import { ChevronDown, ChevronRight, Diamond, Eye, EyeOff, Hexagon, Image as ImageIcon, Lock, Square, Type, Unlock, Frame, Layers } from 'lucide-react';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { pageOfBoard } from '@/canvas/engine';
import { rangeIds, toggleId } from '@/canvas/selection';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { ancestorsOf, kidsOf, kindOf, labelOf, sendEdit, snippetOf, treeOf, type Kind } from '@/lib/htmlTree';
import { cn } from '@/lib/utils';
import { useCanvas } from '@/store/canvas';
import { useProject } from '@/store/project';
import { Tip } from '@/ui/Tip';

const MAX_ROWS = 400; // a board with thousands of nodes must not freeze the panel

const KIND_ICON: Record<Kind, ReactNode> = {
  artboard: <Frame />, frame: <Square />, text: <Type />, image: <ImageIcon />, svg: <Hexagon />, component: <Diamond />,
};

interface RowData {
  id: string;
  depth: number;
  kind: Kind;
  name: string;
  text: string;
  hasKids: boolean;
  hidden: boolean;
  locked: boolean;
  isBoard: boolean;
  boardName?: string; // set in search mode, where rows are flat and need their artboard for context
}

type Drop = 'before' | 'after' | 'inside';

// The document as a tree (artboards > frames > text), like a design tool's layer list. The tree is read from the
// artboards' stored HTML; every edit (rename, hide, lock, reorder) goes to the server and the doc event redraws it.
export function LayersPanel({ projectId }: { projectId: string }) {
  const doc = useProject((s) => s.doc);
  const page = useCanvas((s) => s.activePage);
  const selectedIds = useCanvas((s) => s.selected);
  const selected = selectedIds.at(-1) ?? null; // primary: the one the tree scrolls to
  const anchor = useRef<string | null>(null);  // row a Shift-click range starts from
  const engine = useCanvas((s) => s.engine);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; over: string | null; pos: Drop } | null>(null);

  // A selection made on the canvas must show up in the tree, so open its ancestors once per selection change.
  // Done during render ("adjust state when a prop changes") instead of in an effect to avoid a second paint.
  const [seenSel, setSeenSel] = useState<string | null>(null);
  if (selected !== seenSel) {
    setSeenSel(selected);
    if (selected && doc) setExpanded(new Set([...expanded, ...selectedIds.flatMap((id) => ancestorsOf(doc, id))]));
  }

  if (!doc) return null;
  const q = query.trim().toLowerCase();
  const rows: RowData[] = [];
  const full = () => rows.length >= MAX_ROWS;
  const rowOf = (el: HTMLElement, depth: number, boardName?: string): RowData => ({
    id: el.dataset.pid!, depth, kind: kindOf(el), name: labelOf(el), text: snippetOf(el),
    hasKids: !el.dataset.component && kidsOf(el).length > 0,
    hidden: el.hasAttribute('hidden'), locked: el.hasAttribute('data-locked'), isBoard: false, boardName,
  });
  const walk = (root: Element, depth: number) => {
    for (const el of kidsOf(root)) {
      if (full()) return;
      rows.push(rowOf(el, depth));
      if (!el.dataset.component && expanded.has(el.dataset.pid!)) walk(el, depth + 1);
    }
  };
  const matches = (el: HTMLElement) => `${labelOf(el)} ${el.textContent}`.toLowerCase().includes(q);

  // Only the boards on the visible page are listed, matching what the canvas shows.
  for (const ab of doc.artboards.filter((a) => pageOfBoard(doc, a) === page)) {
    if (full()) break;
    if (q) {
      // Search mode: a flat list of the innermost layers whose name or text matches, tagged with their artboard.
      for (const el of treeOf(ab).querySelectorAll<HTMLElement>('[data-pid]')) {
        if (full()) break;
        if (matches(el) && !kidsOf(el).some(matches)) rows.push(rowOf(el, 0, ab.name));
      }
      continue;
    }
    rows.push({ id: ab.id, depth: 0, kind: 'artboard', name: ab.name, text: '', hasKids: !!ab.html.trim(), hidden: false, locked: false, isBoard: true });
    if (expanded.has(ab.id)) walk(treeOf(ab), 1);
  }

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (!next.delete(id)) next.add(id);
    setExpanded(next);
  };
  const send = (action: string, body: unknown) => sendEdit(projectId, action, body);

  // The pointer's height inside the row decides before / inside / after (boards only accept "inside").
  const dropAt = (e: DragEvent<HTMLElement>, isBoard: boolean): Drop => {
    if (isBoard) return 'inside';
    const r = e.currentTarget.getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    return f < 0.28 ? 'before' : f > 0.72 ? 'after' : 'inside';
  };

  return (
    <>
      <div className="px-2 pb-1">
        <Input type="search" aria-label="Search layers" placeholder="Search layers" value={query} onChange={(e) => setQuery(e.target.value)} className="border-transparent bg-field dark:bg-field focus-visible:border-transparent focus-visible:ring-1 focus-visible:ring-selection" />
      </div>
      <ul className="flex-1 overflow-auto py-1" onMouseLeave={() => engine?.setHover(null)}>
        {rows.map((r) => (
          <li
            key={r.id + (q ? ':q' : '')}
            data-id={r.id}
            // A row is also the drag source; boards cannot be dragged (their position is on the canvas).
            draggable={!r.isBoard && renaming !== r.id}
            onDragStart={(e) => { setDrag({ id: r.id, over: null, pos: 'inside' }); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', r.id); }}
            onDragEnd={() => setDrag(null)}
            onDragOver={(e) => {
              if (!drag || drag.id === r.id) return;
              e.preventDefault(); // allows the drop
              const pos = dropAt(e, r.isBoard);
              if (drag.over !== r.id || drag.pos !== pos) setDrag({ ...drag, over: r.id, pos });
            }}
            onDragLeave={() => { if (drag?.over === r.id) setDrag({ ...drag, over: null }); }}
            onDrop={(e) => {
              e.preventDefault();
              const pos = dropAt(e, r.isBoard);
              const moving = drag?.id;
              setDrag(null);
              if (moving && moving !== r.id) send('move-node', { id: moving, target: r.id, position: pos === 'inside' ? 'end' : pos });
            }}
            onMouseEnter={() => engine?.setHover(r.id)}
            // Plain click selects the row, Ctrl/Cmd toggles it, Shift selects the range from the last clicked row.
            onClick={(e) => {
              if (!engine) return;
              if (e.shiftKey && anchor.current) engine.selectIds(rangeIds(rows.map((x) => x.id), anchor.current, r.id));
              else if (e.ctrlKey || e.metaKey) { engine.selectIds(toggleId(selectedIds, r.id)); anchor.current = r.id; }
              else { engine.selectIds([r.id]); anchor.current = r.id; }
            }}
            // Same menu as the canvas, plus the row-only actions. Selecting first so Copy/Duplicate/Delete hit this row.
            onContextMenu={(e) => {
              e.preventDefault();
              if (!selectedIds.includes(r.id)) engine?.selectIds([r.id]); // right-click on a member keeps the set
              useCanvas.getState().setMenu({
                x: e.clientX, y: e.clientY, id: r.id,
                extra: [
                  { label: 'Rename', run: () => setRenaming(r.id) },
                  ...(r.isBoard ? [] : [
                    { label: r.hidden ? 'Show' : 'Hide', run: () => send('flags', { ids: [r.id], hidden: !r.hidden }) },
                    { label: r.locked ? 'Unlock' : 'Lock', run: () => send('flags', { ids: [r.id], locked: !r.locked }) },
                  ]),
                ],
              });
            }}
            style={{ paddingLeft: 6 + r.depth * 14 }}
            className={cn(
              // Rows are inset with rounded ends, so the selection reads as a soft pill instead of a full-bleed stripe.
              'group relative mx-1.5 flex h-7 cursor-default items-center gap-1 rounded-md pr-1.5 text-xs select-none',
              selectedIds.includes(r.id) ? 'bg-selection-soft text-foreground' : 'pointer-hover:bg-muted',
              drag?.over === r.id && drag.pos === 'inside' && 'outline outline-1 -outline-offset-1 outline-[var(--selection)]',
              drag?.over === r.id && drag.pos === 'before' && 'before:absolute before:inset-x-1.5 before:top-0 before:h-0.5 before:bg-[var(--selection)]',
              drag?.over === r.id && drag.pos === 'after' && 'after:absolute after:inset-x-1.5 after:bottom-0 after:h-0.5 after:bg-[var(--selection)]',
            )}
          >
            <button
              tabIndex={-1}
              aria-label={expanded.has(r.id) ? 'Collapse' : 'Expand'}
              className={cn('grid size-4 shrink-0 place-items-center text-muted-foreground [&_svg]:size-3.5', !r.hasKids && 'invisible')}
              onClick={(e) => { e.stopPropagation(); toggle(r.id); }}
            >
              {expanded.has(r.id) ? <ChevronDown /> : <ChevronRight />}
            </button>
            <span className="grid size-4 shrink-0 place-items-center text-muted-foreground [&_svg]:size-3.5 [&_svg]:stroke-[1.5]">{KIND_ICON[r.kind]}</span>
            {renaming === r.id ? (
              <RenameInput
                initial={r.name}
                onDone={(name) => {
                  setRenaming(null);
                  if (name && name !== r.name) send('rename', { id: r.id, name });
                }}
              />
            ) : (
              <span
                className={cn('min-w-0 truncate', r.hidden && 'opacity-45')}
                onDoubleClick={(e) => { e.stopPropagation(); setRenaming(r.id); }}
              >
                {r.name}
                {(r.text || r.boardName) && <span className="ml-1.5 text-muted-foreground">{r.text || r.boardName}</span>}
              </span>
            )}
            {!r.isBoard && (
              <span className="ml-auto flex shrink-0">
                <FlagButton on={r.hidden} onLabel="Show layer" offLabel="Hide layer" onIcon={<EyeOff />} offIcon={<Eye />} onClick={() => send('flags', { ids: [r.id], hidden: !r.hidden })} />
                <FlagButton on={r.locked} onLabel="Unlock layer" offLabel="Lock layer" onIcon={<Lock />} offIcon={<Unlock />} onClick={() => send('flags', { ids: [r.id], locked: !r.locked })} />
              </span>
            )}
          </li>
        ))}
        {full() && <li className="px-3 py-2 text-muted-foreground">Showing the first {MAX_ROWS} layers. Collapse some boards or search.</li>}
        {!rows.length && (
          <li>
            <Empty className="p-4">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Layers /></EmptyMedia>
                <EmptyTitle className="font-display">{q ? 'No layers match' : 'No layers yet'}</EmptyTitle>
                <EmptyDescription>{q ? 'Try another name or text.' : 'Layers appear here once Claude or you add a frame.'}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </li>
        )}
      </ul>
    </>
  );
}

// Eye / lock toggle. Hidden until the row is hovered or focused, but a button that is ON stays visible so state is readable.
function FlagButton({ on, onLabel, offLabel, onIcon, offIcon, onClick }: {
  on: boolean; onLabel: string; offLabel: string; onIcon: ReactNode; offIcon: ReactNode; onClick: () => void;
}) {
  return (
    <Tip label={on ? onLabel : offLabel}><button
      aria-label={on ? onLabel : offLabel}
      aria-pressed={on}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn(
        'grid size-5 place-items-center rounded text-muted-foreground transition-opacity [&_svg]:size-3.5 [&_svg]:stroke-[1.5] focus-visible:opacity-100 group-focus-within:opacity-100',
        on ? 'opacity-100' : 'opacity-0 pointer-hover:group-hover:opacity-100',
      )}
    >
      {on ? onIcon : offIcon}
    </button></Tip>
  );
}

// Rename in place: Enter or blur saves, Escape cancels. Keys are stopped here so Delete/Backspace
// typed into the field can never reach the canvas shortcuts.
// Shared with PagesPanel (pages are renamed the same way), hence the exported name and the `label` prop.
export function RenameInput({ initial, onDone, label = 'Layer name' }: { initial: string; onDone: (name: string | null) => void; label?: string }) {
  const [value, setValue] = useState(initial);
  const [done, setDone] = useState(false); // blur fires after Enter unmounts the field; finish only once
  const finish = (save: boolean) => {
    if (done) return;
    setDone(true);
    onDone(save ? value.trim() : null);
  };
  return (
    <input
      autoFocus
      aria-label={label}
      maxLength={80}
      value={value}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
      className="h-5 min-w-0 flex-1 rounded border border-ring bg-background px-1 outline-none"
    />
  );
}
