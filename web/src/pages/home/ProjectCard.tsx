import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ago } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { ProjectSummary } from '@/api/projects';
import { CoverThumb } from './CoverThumb';

export interface CardActions {
  rename: (p: ProjectSummary, name: string) => void;
  duplicate: (p: ProjectSummary) => void;
  trash: (p: ProjectSummary) => void;
  restore: (p: ProjectSummary) => void;
  purge: (p: ProjectSummary) => void;
}

export type View = 'grid' | 'list';

interface Props {
  project: ProjectSummary;
  inTrash: boolean;
  view: View;
  index: number;
  // Only the very first paint animates; live refreshes while Claude edits must not replay it.
  animateIn: boolean;
  actions: CardActions;
}

// Grid thumbnail box (card is 256 wide with 4px padding inside a 1px border: 248 usable).
const GRID_W = 248;
const GRID_H = 164;

// Hover lift only on real pointers (touch devices would stick the hover state).
const HOVER_LIFT = '[@media(hover:hover)_and_(pointer:fine)]:hover:-translate-y-0.5 [@media(hover:hover)_and_(pointer:fine)]:hover:shadow-lg';

// One project, as a Paper-style card (title + "Edited" line above the preview) or, in list view, as a row.
export function ProjectCard({ project: p, inTrash, view, index, animateIn, actions }: Props) {
  const [renaming, setRenaming] = useState(false);
  // "Delete forever" is two-step without a blocking dialog: the first click arms it.
  const [armed, setArmed] = useState(false);
  const list = view === 'list';

  const finishRename = (value: string) => {
    setRenaming(false);
    if (value.trim() && value.trim() !== p.name) actions.rename(p, value);
  };

  const title = renaming ? (
    <Input
      autoFocus
      defaultValue={p.name}
      maxLength={80}
      aria-label="Project name"
      className="relative z-10 h-7 w-full font-semibold"
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => finishRename(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finishRename(e.currentTarget.value);
        // Escape cancels: the input unmounts first, but it can still blur, so mark the value unchanged.
        if (e.key === 'Escape') { e.currentTarget.value = p.name; setRenaming(false); }
      }}
    />
  ) : inTrash ? (
    <div className="truncate text-sm font-medium">{p.name}</div>
  ) : (
    // Stretched-link pattern: the ::after covers the whole card so it is all clickable, while the menu button
    // (z-10) sits above it. Avoids nesting a button inside an anchor. The overlay needs z-[1]: the preview wrapper
    // below is `relative` and comes later in the DOM, so without an explicit z-index it would paint over the overlay
    // and swallow clicks on the thumbnail.
    <Link to="/p/$id" params={{ id: p.id }} className="block truncate text-sm font-medium after:absolute after:inset-0 after:z-[1] after:content-['']">
      {p.name}
    </Link>
  );

  // In grid view the badge sits on the preview (the subtitle line is too narrow for it); in list view it follows the text.
  const badge = p.active && !inTrash && (
    <span title="The project Claude will use unless told otherwise" className="shrink-0 rounded-full bg-[color-mix(in_oklch,var(--selection)_16%,transparent)] px-2 py-px text-[11px] font-semibold text-[var(--selection)] backdrop-blur-sm">
      Claude is here
    </span>
  );

  const subtitle = (
    <div className="tnum flex items-center gap-2 truncate text-xs text-muted-foreground" title={p.description || undefined}>
      <span className="truncate">
        {inTrash ? `Deleted ${ago(p.deletedAt ?? p.updatedAt)}` : `Edited ${ago(p.updatedAt)}`} · {p.artboardCount} artboard{p.artboardCount === 1 ? '' : 's'}
      </span>
      {list && badge}
    </div>
  );

  const menu = (
    <DropdownMenu onOpenChange={(open) => { if (!open) setArmed(false); }}>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Actions for ${p.name}`} className="relative z-10 shrink-0" />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {inTrash ? (
          <>
            <DropdownMenuItem onClick={() => actions.restore(p)}>Restore</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              // The arming click must keep the menu open so the label can change to "Click again".
              closeOnClick={armed}
              onClick={() => { if (armed) actions.purge(p); else setArmed(true); }}
            >
              {armed ? 'Click again to confirm' : 'Delete forever'}
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem render={<Link to="/p/$id" params={{ id: p.id }} />}>Open</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setRenaming(true)}>Rename</DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.duplicate(p)}>Duplicate</DropdownMenuItem>
            <DropdownMenuItem render={<a href={`/api/projects/${p.id}/export`} />}>Export</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => actions.trash(p)}>Move to Trash</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border bg-card',
        'transition-[box-shadow,transform] duration-200 ease-[var(--ease-out)] motion-reduce:transition-none',
        list ? 'flex w-full items-center gap-3 p-2 pr-2' : 'w-[256px] p-1',
        !inTrash && !list && HOVER_LIFT,
        inTrash && 'opacity-80',
        animateIn && index < 8 && 'animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards',
      )}
      style={animateIn ? { animationDelay: `${index * 45}ms` } : undefined}
    >
      {list ? (
        <>
          <CoverThumb cover={p.cover} width={96} height={60} className="rounded-md" />
          <div className="min-w-0 flex-1">{title}{subtitle}</div>
          {menu}
        </>
      ) : (
        <>
          <div className="flex items-start gap-1 px-2.5 pt-2 pb-2.5">
            <div className="min-w-0 flex-1">{title}{subtitle}</div>
            {/* -mt/-mr pull the 32px icon button into the padding so the title row stays compact. */}
            <div className="-mt-1 -mr-1.5">{menu}</div>
          </div>
          <div className="relative">
            <CoverThumb cover={p.cover} width={GRID_W} height={GRID_H} className="rounded-lg" />
            {badge && <div className="absolute bottom-2 left-2">{badge}</div>}
          </div>
        </>
      )}
    </div>
  );
}
