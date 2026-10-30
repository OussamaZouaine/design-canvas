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

// Grid preview height from the mock "Atelier · Home" (200px); the width fills the column.
const GRID_H = 200;

// Hover lift only on real pointers (touch devices would stick the hover state); the lift uses the shared layered
// float shadow so a hovered card matches the toolbar and popovers instead of a one-off grey blur.
// Grid menu button sits on the preview: hidden until hover/focus (always shown on touch or while its menu is open).
const MENU_REVEAL = 'absolute top-3 right-3 border bg-card opacity-0 shadow-sm group-hover:opacity-100 group-focus-within:opacity-100 aria-expanded:opacity-100 [@media(hover:none)]:opacity-100';
const HOVER_LIFT = 'pointer-hover:-translate-y-0.5 pointer-hover:shadow-float';

// One project: a raised preview card with the title and "N boards, edited X ago" underneath (as in the mock), or in
// list view a compact row.
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
    <div className="truncate font-display text-base tracking-[-0.01em]">{p.name}</div>
  ) : (
    // Stretched-link pattern: the ::after covers the whole card so it is all clickable, while the menu button
    // (z-10) sits above it. Avoids nesting a button inside an anchor. The overlay needs z-[1]: the preview wrapper
    // below is `relative` and comes later in the DOM, so without an explicit z-index it would paint over the overlay
    // and swallow clicks on the thumbnail.
    <Link to="/p/$id" params={{ id: p.id }} className="block truncate font-display text-base tracking-[-0.01em] after:absolute after:inset-0 after:z-[1] after:content-['']">
      {p.name}
    </Link>
  );

  // In grid view the badge sits on the preview (the subtitle line is too narrow for it); in list view it follows the text.
  const badge = p.active && !inTrash && (
    <span title="The project Claude will use unless told otherwise" className="shrink-0 rounded-full bg-[color-mix(in_oklch,var(--selection)_16%,transparent)] px-2 py-px text-[11px] font-semibold text-selection-ink backdrop-blur-sm">
      Claude is here
    </span>
  );

  const n = p.artboardCount;
  const subtitle = (
    <div className="tnum flex items-center gap-2 truncate text-[13px] text-muted-foreground" title={p.description || undefined}>
      <span className="truncate">{n} board{n === 1 ? '' : 's'}, {inTrash ? `deleted ${ago(p.deletedAt ?? p.updatedAt)}` : `edited ${ago(p.updatedAt)}`}</span>
      {list && badge}
    </div>
  );

  const menu = (
    <DropdownMenu onOpenChange={(open) => { if (!open) setArmed(false); }}>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Actions for ${p.name}`} className={cn('relative z-10 shrink-0', !list && MENU_REVEAL)} />}>
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
        'group relative',
        list ? 'flex w-full items-center gap-3 rounded-[12px] border bg-card p-2' : 'flex flex-col gap-3',
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
          {/* Concentric radii: 8px preview + 8px padding = 16px card corner. */}
          <div className={cn('relative rounded-2xl border bg-card p-2 transition-[box-shadow,translate] duration-200 ease-[var(--ease-out)] motion-reduce:transition-none', !inTrash && HOVER_LIFT)}>
            <CoverThumb cover={p.cover} height={GRID_H} className="w-full rounded-lg" />
            {badge && <div className="absolute bottom-4 left-4">{badge}</div>}
            {menu}
          </div>
          <div className="px-1">{title}{subtitle}</div>
        </>
      )}
    </div>
  );
}
