import { cn } from '@/lib/utils';
import type { Connection } from '@/hooks/useLiveReload';

// Connection dot + label, shared by the home sidebar (the project page has its own richer pill).
export function ConnectionPill({ connection }: { connection: Connection }) {
  return (
    <span className="flex h-6 items-center gap-1.5 rounded-full bg-muted px-2 text-[11px] text-muted-foreground">
      <span className={cn('size-1.5 rounded-full', connection === 'connected' ? 'bg-emerald-500' : connection === 'connecting' ? 'bg-muted-foreground' : 'bg-destructive')} />
      {connection === 'connecting' ? 'connecting…' : connection}
    </span>
  );
}
