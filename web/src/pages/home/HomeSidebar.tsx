import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Clock, MessageSquare, Moon, Plug, Sun, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Connection } from '@/hooks/useLiveReload';
import { ConnectionPill } from '@/ui/AppHeader';
import { useUi } from '@/store/ui';

interface Props {
  section: 'recents' | 'trash' | 'comments';
  // Project counts are only known on the home page; elsewhere the rows show none.
  liveCount?: number;
  trashCount?: number;
  openComments: number;
  connection: Connection;
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

// Same look as NavRow for navigation; `search` is passed through so Recents and Trash can share the "/" route.
function NavLink({ to, search, icon, active, count, children }: { to: '/' | '/comments'; search?: { trash: 1 }; icon: ReactNode; active: boolean; count?: ReactNode; children: ReactNode }) {
  return (
    // exact: otherwise the router counts "/" as active on "/?trash=1" too and both rows get aria-current.
    <Link to={to} search={search ?? {}} activeOptions={{ exact: true }} aria-current={active ? 'page' : undefined} className={cn(ROW, active && 'bg-muted text-foreground')}>
      <span className="size-4 shrink-0 [&>svg]:size-4">{icon}</span>
      <span className="truncate md:flex-1">{children}</span>
      {count}
    </Link>
  );
}

// Paper-style left rail shared by the home and Comments pages: workspace row, navigation, and a footer for the small
// status controls. Sections are real links (Trash is /?trash=1), so they work from either page; search lives in each
// page's sticky bar so it stays next to the list it filters.
export function HomeSidebar({ section, liveCount, trashCount, openComments, connection, onConnect }: Props) {
  const { theme, toggleTheme } = useUi();
  return (
    <aside className="flex shrink-0 flex-col md:h-full md:w-60">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <span aria-hidden className="grid size-7 place-items-center rounded-md bg-brand font-display text-[13px] text-brand-ink">D</span>
        <Link to="/" className="truncate text-sm font-semibold" title="All projects">Design Canvas</Link>
      </div>

      {/* Below md the rail sits above the list, so the nav becomes one horizontally scrolling row instead of a
          tall stack that would eat a third of a phone screen. */}
      <nav className="flex gap-0.5 overflow-x-auto px-3 pb-3 md:flex-col" aria-label="Projects">
        {/* Links styled like rows so each whole line is a real anchor (middle-click, open in new tab). */}
        <NavLink to="/" icon={<Clock />} active={section === 'recents'} count={<span className="tnum text-xs opacity-70">{liveCount || ''}</span>}>Recents</NavLink>
        <NavLink to="/" search={{ trash: 1 }} icon={<Trash2 />} active={section === 'trash'} count={<span className="tnum text-xs opacity-70">{trashCount || ''}</span>}>Trash</NavLink>
        <NavLink to="/comments" icon={<MessageSquare />} active={section === 'comments'} count={openComments > 0 && <span className="tnum rounded-full bg-amber-500/20 px-1.5 text-[11px] font-bold text-amber-600 dark:text-amber-300">{openComments}</span>}>Comments</NavLink>
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
