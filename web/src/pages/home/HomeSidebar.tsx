import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Clock, MessageSquare, Moon, Plug, Sun, Trash2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Connection } from '@/hooks/useLiveReload';
import { ConnectionPill } from '@/ui/AppHeader';
import { useUi } from '@/store/ui';

interface Props {
  inTrash: boolean;
  onSection: (trash: boolean) => void;
  liveCount: number;
  trashCount: number;
  openComments: number;
  connection: Connection;
  onImport: () => void;
  onConnect: () => void;
}

// Shared look for every nav row. Hover colour is gated to real pointers so touch screens do not keep it stuck.
const ROW = 'flex h-8 shrink-0 items-center whitespace-nowrap md:w-full gap-2.5 rounded-md px-2.5 text-left text-[13px] text-muted-foreground transition-colors duration-150 pointer-hover:bg-muted/60 pointer-hover:text-foreground';

function NavRow({ icon, active, count, children, ...rest }: { icon: ReactNode; active?: boolean; count?: ReactNode; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-current={active ? 'page' : undefined} className={cn(ROW, active && 'bg-muted text-foreground')} {...rest}>
      <span className="size-4 shrink-0 [&>svg]:size-4">{icon}</span>
      <span className="truncate md:flex-1">{children}</span>
      {count}
    </button>
  );
}

// Paper-style left rail: workspace row, navigation, and a footer for the small status controls. Recents vs Trash
// is picked here; search lives in the page's sticky topbar so it stays next to the list it filters.
export function HomeSidebar({ inTrash, onSection, liveCount, trashCount, openComments, connection, onImport, onConnect }: Props) {
  const { theme, toggleTheme } = useUi();
  return (
    <aside className="flex shrink-0 flex-col border-b bg-background md:h-full md:w-60 md:border-r md:border-b-0">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <span aria-hidden className="grid size-7 place-items-center rounded-md bg-brand font-display text-[13px] text-brand-ink">D</span>
        <Link to="/" className="truncate text-sm font-semibold" title="All projects">Design Canvas</Link>
      </div>

      {/* Below md the rail sits above the list, so the nav becomes one horizontally scrolling row instead of a
          tall stack that would eat a third of a phone screen. */}
      <nav className="flex gap-0.5 overflow-x-auto px-3 pb-3 md:flex-col" aria-label="Projects">
        <NavRow icon={<Clock />} active={!inTrash} onClick={() => onSection(false)} count={<span className="tnum text-xs opacity-70">{liveCount || ''}</span>}>Recents</NavRow>
        <NavRow icon={<Trash2 />} active={inTrash} onClick={() => onSection(true)} count={<span className="tnum text-xs opacity-70">{trashCount || ''}</span>}>Trash</NavRow>
        {/* Link styled like a row so the whole line is a real anchor (middle-click, open in new tab). */}
        <Link to="/comments" className={ROW}>
          <MessageSquare className="size-4 shrink-0" />
          <span className="md:flex-1">Comments</span>
          {openComments > 0 && <span className="tnum rounded-full bg-amber-500/20 px-1.5 text-[11px] font-bold text-amber-600 dark:text-amber-300">{openComments}</span>}
        </Link>
        <NavRow icon={<Upload />} title="Import a .dcproject.json file" onClick={onImport}>Import project</NavRow>
        <NavRow icon={<Plug />} title="Connect Claude, Codex, Cursor and other agents" onClick={onConnect}>Connect agents</NavRow>
      </nav>

      <div className="mt-auto hidden items-center gap-2 px-4 py-3 md:flex">
        <ConnectionPill connection={connection} />
        <button
          type="button"
          aria-label="Toggle theme"
          onClick={toggleTheme}
          className="ml-auto grid size-7 place-items-center rounded-md text-muted-foreground transition-transform duration-150 active:scale-96 pointer-hover:text-foreground"
        >
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </div>
    </aside>
  );
}
