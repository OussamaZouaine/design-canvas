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

interface Props {
  project: ProjectSummary;
  inTrash: boolean;
  index: number;
  // Only the very first paint animates; live refreshes while Claude edits must not replay it.
  animateIn: boolean;
  actions: CardActions;
}

// Hover lift only on real pointers (touch devices would stick the hover state).
const HOVER_LIFT = '[@media(hover:hover)_and_(pointer:fine)]:hover:-translate-y-0.5 [@media(hover:hover)_and_(pointer:fine)]:hover:shadow-lg';

export function ProjectCard({ project: p, inTrash, index, animateIn, actions }: Props) {
  const [renaming, setRenaming] = useState(false);
  // "Delete forever" is two-step without a blocking dialog: the first click arms it.
  const [armed, setArmed] = useState(false);

  const finishRename = (value: string) => {
    setRenaming(false);
    if (value.trim() && value.trim() !== p.name) actions.rename(p, value);
  };

  return (
    <div
      className={cn(
        'relative w-[320px] overflow-hidden rounded-xl border bg-card',
        'transition-[box-shadow,transform] duration-200 ease-[var(--ease-out)] motion-reduce:transition-none',
        !inTrash && HOVER_LIFT,
        inTrash && 'opacity-80',
        animateIn && index < 8 && 'animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards',
      )}
      style={animateIn ? { animationDelay: `${index * 45}ms` } : undefined}
    >
      <CoverThumb cover={p.cover} />
      <div className="px-4 pt-3 pb-4">
        {renaming ? (
          <Input
            autoFocus
            defaultValue={p.name}
            maxLength={80}
            aria-label="Project name"
            className="relative z-10 h-7 w-[calc(100%-28px)] font-semibold"
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => finishRename(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') finishRename(e.currentTarget.value);
              // Escape cancels: the input unmounts first, but it can still blur, so mark the value unchanged.
              if (e.key === 'Escape') { e.currentTarget.value = p.name; setRenaming(false); }
            }}
          />
        ) : inTrash ? (
          <div className="truncate pr-7 text-sm font-semibold">{p.name}</div>
        ) : (
          // Stretched-link pattern: the ::after covers the whole card so it is all clickable, while the menu button
          // (z-10) sits above it. Avoids nesting a button inside an anchor.
          <Link to="/p/$id" params={{ id: p.id }} className="block truncate pr-7 text-sm font-semibold after:absolute after:inset-0 after:content-['']">
            {p.name}
          </Link>
        )}
        <div className="mt-1 h-5 truncate text-xs text-muted-foreground">{p.description || ' '}</div>
        <div className="tnum mt-2.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          {p.artboardCount} artboard{p.artboardCount === 1 ? '' : 's'} · {inTrash ? `deleted ${ago(p.deletedAt ?? p.updatedAt)}` : `edited ${ago(p.updatedAt)}`}
          {p.active && !inTrash && (
            <span title="The project Claude will use unless told otherwise" className="rounded-full bg-[color-mix(in_oklch,var(--selection)_16%,transparent)] px-2 py-px font-semibold text-[var(--selection)]">
              Claude is here
            </span>
          )}
        </div>
      </div>

      <DropdownMenu onOpenChange={(open) => { if (!open) setArmed(false); }}>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Actions for ${p.name}`} className="absolute top-[204px] right-2 z-10" />}>
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
    </div>
  );
}
