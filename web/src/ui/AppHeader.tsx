import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Connection } from '@/hooks/useLiveReload';
import { useUi } from '@/store/ui';

// Connection dot + label, shared by the Home and Comments headers (the project page has its own richer pill).
export function ConnectionPill({ connection }: { connection: Connection }) {
  return (
    <span className="flex h-6 items-center gap-1.5 rounded-full bg-muted px-2 text-[11px] text-muted-foreground">
      <span className={cn('size-1.5 rounded-full', connection === 'connected' ? 'bg-emerald-500' : connection === 'connecting' ? 'bg-muted-foreground' : 'bg-destructive')} />
      {connection === 'connecting' ? 'connecting…' : connection}
    </span>
  );
}

// Sticky top bar for the list-style pages. `children` holds the page's own filters/actions.
export function AppHeader({ crumb, connection, actions, children }: { crumb?: string; connection: Connection; actions?: ReactNode; children?: ReactNode }) {
  const { theme, toggleTheme } = useUi();
  return (
    <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b bg-background px-6">
      <Link to="/" className="mr-2 text-sm font-semibold" title="All projects">Design Canvas</Link>
      {crumb && <span className="mr-2 text-muted-foreground before:mr-2 before:opacity-50 before:content-['/']">{crumb}</span>}
      {children}
      <div className="ml-auto flex items-center gap-2">
        {actions}
        <ConnectionPill connection={connection} />
        <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={toggleTheme}>{theme === 'dark' ? <Sun /> : <Moon />}</Button>
      </div>
    </header>
  );
}
