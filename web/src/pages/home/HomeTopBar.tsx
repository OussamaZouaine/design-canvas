import { Link } from '@tanstack/react-router';
import { Keyboard, MessageSquare, Moon, Plug, Sun, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Connection } from '@/hooks/useLiveReload';
import { ConnectionPill } from '@/ui/AppHeader';
import { Tip } from '@/ui/Tip';
import { useUi } from '@/store/ui';

interface Props {
  inTrash: boolean;
  onTrash: () => void;
  trashCount: number;
  openComments: number;
  connection: Connection;
  onImport: () => void;
}

// Quiet text links look like plain muted text until hovered (hover gated to real pointers by the variant).
const LINK = 'text-[13px] font-normal text-muted-foreground pointer-hover:text-foreground';

// Home top bar (no sidebar): brand on the left; Comments / Connect agents / Shortcuts as text links, then the small
// utilities (Import, Trash, connection, theme) as tooltip icon buttons on the right.
export function HomeTopBar({ inTrash, onTrash, trashCount, openComments, connection, onImport }: Props) {
  const { theme, toggleTheme } = useUi();
  const ui = useUi.getState;
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span aria-hidden className="grid size-7 place-items-center rounded-md bg-brand font-display text-[13px] text-brand-ink">D</span>
      <Link to="/" className="mr-auto text-sm font-semibold" title="All projects">Design Canvas</Link>

      <nav aria-label="Home" className="flex flex-wrap items-center gap-1">
        {/* Real anchor (middle-click, new tab); Button's render prop keeps the shadcn look. */}
        <Button variant="ghost" size="32" className={LINK} render={<Link to="/comments" />}>
          <MessageSquare />Comments
          {openComments > 0 && <span className="tnum rounded-full bg-amber-500/20 px-1.5 text-[11px] font-bold text-amber-600 dark:text-amber-300">{openComments}</span>}
        </Button>
        <Button variant="ghost" size="32" className={LINK} onClick={() => ui().setConnectOpen(true)}><Plug />Connect agents</Button>
        <Button variant="ghost" size="32" className={LINK} onClick={() => ui().setShortcutsOpen(true)}><Keyboard />Shortcuts</Button>
      </nav>

      <div className="flex items-center gap-1">
        <Tip label="Import project"><Button variant="ghost" size="icon-lg" aria-label="Import project" onClick={onImport}><Upload /></Button></Tip>
        <Tip label={inTrash ? 'Back to projects' : 'Trash'}>
          <Button variant="ghost" size="icon-lg" aria-label="Trash" aria-pressed={inTrash} onClick={onTrash} className="relative aria-pressed:bg-muted aria-pressed:text-foreground">
            <Trash2 />
            {trashCount > 0 && <span className="tnum absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-muted px-1 text-center text-[10px] text-foreground">{trashCount}</span>}
          </Button>
        </Tip>
        <Tip label={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
          <Button variant="ghost" size="icon-lg" aria-label="Toggle theme" onClick={toggleTheme}>{theme === 'dark' ? <Sun /> : <Moon />}</Button>
        </Tip>
        <ConnectionPill connection={connection} />
      </div>
    </header>
  );
}
