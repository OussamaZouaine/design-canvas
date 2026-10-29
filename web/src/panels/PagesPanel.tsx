import { Check, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { canvasAction } from '@/api/projects';
import { pagesOf } from '@/canvas/engine';
import { RenameInput } from '@/panels/LayersPanel';
import { cn } from '@/lib/utils';
import { useCanvas } from '@/store/canvas';
import { useProject } from '@/store/project';
import { toast } from '@/store/toast';
import { Tip } from '@/ui/Tip';

// "Pages" section at the top of the left sidebar (the only page switcher: the old header select is gone).
// The engine owns which page is visible and remembers it per project; this list mirrors `activePage` and drives
// `engine.setPage`. Create and rename go through the same `page-create` / `page-update` canvas actions as MCP.
export function PagesPanel({ projectId }: { projectId: string }) {
  const doc = useProject((s) => s.doc);
  const engine = useCanvas((s) => s.engine);
  const active = useCanvas((s) => s.activePage);
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState<string | null>(null);
  if (!doc) return null;
  const list = pagesOf(doc);
  const current = active ?? list[0].id;

  const add = async () => {
    if (!engine) return;
    // markUserEdit: the user's own edit must not trigger the "Claude is designing" reveal / camera follow.
    engine.markUserEdit();
    try {
      const r = await canvasAction(projectId, 'page-create', { name: `Page ${list.length + 1}` });
      const id = (r.result as { id: string }).id;
      setOpen(true);
      engine.setPageWhenReady(id); // the doc event carrying the new page may arrive after this response
      setRenaming(id); // like Paper: a new page starts in rename mode
    } catch (e) { toast((e as Error).message || 'Could not add a page'); }
  };

  const rename = (id: string, name: string | null) => {
    setRenaming(null);
    if (!name || name === list.find((p) => p.id === id)?.name) return;
    engine?.markUserEdit();
    canvasAction(projectId, 'page-update', { id, name }).catch((e: Error) => toast(e.message || 'Could not rename the page'));
  };

  return (
    <section aria-label="Pages" className="border-b pb-1">
      <div className="flex h-9 items-center gap-1 px-2">
        <button
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex flex-1 items-center gap-1 rounded-sm px-1 text-left text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? <ChevronDown className="size-3 text-muted-foreground" /> : <ChevronRight className="size-3 text-muted-foreground" />}
          Pages
        </button>
        <Tip label="Add a page"><button
          aria-label="Add a page" onClick={add}
          className="grid size-6 place-items-center rounded-md text-muted-foreground outline-none transition-[color,background-color,scale] duration-150 active:scale-96 pointer-hover:bg-muted pointer-hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
        >
          <Plus />
        </button></Tip>
      </div>
      {open && (
        <ul className="max-h-40 overflow-auto">
          {list.map((p) => (
            <li key={p.id}>
              {renaming === p.id ? (
                <div className="mx-1.5 flex h-7 items-center px-1.5"><RenameInput label="Page name" initial={p.name} onDone={(n) => rename(p.id, n)} /></div>
              ) : (
                <button
                  aria-current={p.id === current ? 'page' : undefined}
                  onClick={() => engine?.setPage(p.id)}
                  onDoubleClick={() => setRenaming(p.id)}
                  className={cn(
                    // Same inset pill rows as the Layers list below, so the sidebar reads as one list style.
                    'mx-1.5 flex h-7 w-[calc(100%-0.75rem)] items-center gap-2 rounded-md px-1.5 text-left text-xs outline-none transition-colors duration-150 focus-visible:bg-muted',
                    p.id === current ? 'bg-selection-soft font-medium' : 'text-muted-foreground pointer-hover:bg-muted pointer-hover:text-foreground',
                  )}
                >
                  {/* React escapes the name, so an untrusted page name is safe here. */}
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.id === current && <Check className="size-3.5 shrink-0 stroke-[1.5]" />}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
