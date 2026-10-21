import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Clock, MessageSquare, Moon, Search, Sun, Trash2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Connection } from '@/hooks/useLiveReload';
import { ConnectionPill } from '@/ui/AppHeader';
import { useUi } from '@/store/ui';

interface Props {
  query: string;
  onQuery: (q: string) => void;
  inTrash: boolean;
  onSection: (trash: boolean) => void;
  liveCount: number;
  trashCount: number;
  openComments: number;
  connection: Connection;
  onImport: () => void;
}

// Shared look for every nav row. Hover colour is gated to real pointers so touch screens do not keep it stuck.
const ROW = 'flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-muted-foreground transition-colors duration-150 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/60 [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground';

function NavRow({ icon, active, count, children, ...rest }: { icon: ReactNode; active?: boolean; count?: ReactNode; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-current={active ? 'page' : undefined} className={cn(ROW, active && 'bg-muted text-foreground')} {...rest}>
      <span className="size-4 shrink-0 [&>svg]:size-4">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
      {count}
    </button>
  );
}

// Paper-style left rail: workspace row, search, navigation, and a footer for the small status controls. The
// project-list filters (search, Recents vs Trash) live here; the page body only shows the result.
export function HomeSidebar({ query, onQuery, inTrash, onSection, liveCount, trashCount, openComments, connection, onImport }: Props) {
  const { theme, toggleTheme } = useUi();
  return (
    <aside className="flex shrink-0 flex-col border-b bg-background md:h-full md:w-60 md:border-r md:border-b-0">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <span aria-hidden className="grid size-6 place-items-center rounded-full bg-[color-mix(in_oklch,var(--selection)_30%,transparent)] text-xs font-semibold">D</span>
        <Link to="/" className="truncate text-sm font-semibold" title="All projects">Design Canvas</Link>
      </div>

      <div className="px-3">
        <label className="flex h-8 items-center gap-2 rounded-md border bg-muted/40 px-2.5 text-muted-foreground focus-within:border-ring">
          <Search className="size-3.5 shrink-0" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search projects"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
      </div>

      <nav className="flex flex-col gap-0.5 px-3 pt-3 pb-3" aria-label="Projects">
        <NavRow icon={<Clock />} active={!inTrash} onClick={() => onSection(false)} count={<span className="tnum text-xs opacity-70">{liveCount || ''}</span>}>Recents</NavRow>
        <NavRow icon={<Trash2 />} active={inTrash} onClick={() => onSection(true)} count={<span className="tnum text-xs opacity-70">{trashCount || ''}</span>}>Trash</NavRow>
        {/* Link styled like a row so the whole line is a real anchor (middle-click, open in new tab). */}
        <Link to="/comments" className={ROW}>
          <MessageSquare className="size-4 shrink-0" />
          <span className="flex-1">Comments</span>
          {openComments > 0 && <span className="tnum rounded-full bg-amber-500/20 px-1.5 text-[11px] font-bold text-amber-600 dark:text-amber-300">{openComments}</span>}
        </Link>
        <NavRow icon={<Upload />} title="Import a .dcproject.json file" onClick={onImport}>Import project</NavRow>
      </nav>

      <div className="mt-auto hidden items-center gap-2 px-4 py-3 md:flex">
        <ConnectionPill connection={connection} />
        <button
          type="button"
          aria-label="Toggle theme"
          onClick={toggleTheme}
          className="ml-auto grid size-7 place-items-center rounded-md text-muted-foreground transition-transform duration-150 active:scale-[0.96] [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground"
        >
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </div>
    </aside>
  );
}
