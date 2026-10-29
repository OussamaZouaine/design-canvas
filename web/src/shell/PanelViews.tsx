import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ActivityPanel, VersionsPanel } from '@/panels/HistoryPanels';
import { ThemePanel } from '@/panels/ThemePanel';
import { TokensPanel } from '@/panels/TokensMcpPanels';
import { useUi } from '@/store/ui';

// Secondary right-panel views. They replace the tab content (a Back button returns to it) instead of being tabs,
// which is how eight tabs became three. Each view is a title row plus a small segmented control over its panels.
// shadcn TabsContent only mounts the active panel, which matters because these panels fetch on mount.
function View({ title, tabs, children }: { title: string; tabs: [string, string][]; children: (tab: string) => ReactNode }) {
  const closeView = useUi((s) => s.closeView);
  return (
    <Tabs defaultValue={tabs[0][0]} className="gap-0">
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <Button variant="ghost" size="icon" aria-label="Back" onClick={closeView}><ChevronLeft /></Button>
        <h2 className="text-[13px] font-semibold">{title}</h2>
      </div>
      <div className="p-2 pb-0">
        <TabsList className="w-full bg-field">
          {tabs.map(([id, label]) => <TabsTrigger key={id} value={id} className="data-active:bg-background data-active:shadow-sm">{label}</TabsTrigger>)}
        </TabsList>
      </div>
      {tabs.map(([id]) => <TabsContent key={id} value={id}>{children(id)}</TabsContent>)}
    </Tabs>
  );
}

// History: what you and agents changed (Activity, with per-step revert) and saved snapshots (Versions).
export function HistoryView({ projectId }: { projectId: string }) {
  return (
    <View title="History" tabs={[['activity', 'Activity'], ['versions', 'Versions']]}>
      {(t) => (t === 'activity' ? <ActivityPanel projectId={projectId} /> : <VersionsPanel projectId={projectId} />)}
    </View>
  );
}

// Styles: edit the project's tokens (Theme) or read what the designs use, with the design memory on top (Tokens).
export function StylesView({ projectId }: { projectId: string }) {
  return (
    <View title="Styles" tabs={[['theme', 'Theme'], ['tokens', 'Tokens and memory']]}>
      {(t) => (t === 'theme' ? <ThemePanel projectId={projectId} /> : <TokensPanel projectId={projectId} />)}
    </View>
  );
}
