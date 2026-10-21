import { Check, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { canvasAction } from '@/api/projects';
import { pagesOf } from '@/canvas/engine';
import { RenameInput } from '@/panels/LayersPanel';
import { cn } from '@/lib/utils';
import { useCanvas } from '@/store/canvas';
import { useProject } from '@/store/project';
import { toast } from '@/store/toast';

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
    <section aria-label="Pages" className="border-b">
      <div className="flex h-8 items-center gap-1 px-2">
        <button
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex flex-1 items-center gap-1 rounded-sm text-left text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          Pages
        </button>
        <button
          aria-label="Add a page" title="Add a page" onClick={add}
          className="grid size-5 place-items-center rounded text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
        >
          <Plus />
        </button>
      </div>
      {open && (
        <ul className="max-h-40 overflow-auto pb-1">
          {list.map((p) => (
            <li key={p.id}>
              {renaming === p.id ? (
                <div className="flex h-7 items-center px-3"><RenameInput label="Page name" initial={p.name} onDone={(n) => rename(p.id, n)} /></div>
              ) : (
                <button
                  aria-current={p.id === current ? 'page' : undefined}
                  onClick={() => engine?.setPage(p.id)}
                  onDoubleClick={() => setRenaming(p.id)}
                  className={cn(
                    'flex h-7 w-full items-center gap-2 px-3 text-left text-[11px] outline-none focus-visible:bg-muted',
                    p.id === current ? 'font-medium' : 'text-muted-foreground',
                  )}
                >
                  {/* React escapes the name, so an untrusted page name is safe here. */}
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.id === current && <Check className="size-3.5 shrink-0" />}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
