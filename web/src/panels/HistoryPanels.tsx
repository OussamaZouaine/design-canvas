import { projectAction } from '@/api/projects';
import { Button } from '@/components/ui/button';
import { useJson } from '@/hooks/useJson';
import { ago } from '@/lib/time';
import { useProject } from '@/store/project';
import { toast } from '@/store/toast';

interface Run {
  t: number;
  prompt?: string;
  actions: { tool: string; count: number; artboards: string[] }[];
  restorable?: boolean;
  snapshotId?: string;
}
interface Snapshot { id: string; label: string; createdAt: number; artboards: number }

const TOOL_LABEL: Record<string, string> = {
  create_artboard: 'Created artboard', write_html: 'Wrote HTML', update_styles: 'Updated styles', set_text_content: 'Edited text',
  delete_nodes: 'Deleted', duplicate_nodes: 'Duplicated', rename_nodes: 'Renamed', set_tokens: 'Changed tokens', undo: 'Undid a change',
};

const restore = async (projectId: string, snapshotId: string, message: string) => {
  try {
    await projectAction(projectId, 'restore-snapshot', { snapshotId });
    toast(message);
  } catch (e) { toast((e as Error).message || 'Could not restore'); }
};

// Activity tab: one row per request given to Claude, with the kinds of change it made. Refetches on the
// server's `activity` event (counted in the project store).
export function ActivityPanel({ projectId }: { projectId: string }) {
  const tick = useProject((s) => s.activityTick);
  const { data: runs, failed } = useJson<Run[]>(`/api/p/${projectId}/activity`, tick);
  if (!runs) return <p className="p-3 text-muted-foreground">{failed ? 'Could not read the activity.' : 'Loading…'}</p>;
  if (!runs.length) return <p className="p-3 text-muted-foreground">Nothing yet. Requests you give Claude and the changes it makes will appear here.</p>;
  return (
    <div className="p-3">
      {runs.map((r, i) => (
        <div key={i} className="mb-3 flex items-start gap-2 border-b pb-3 last:border-b-0">
          <div className="min-w-0 flex-1">
            {/* Prompts are untrusted text: React escapes them. */}
            <div className="line-clamp-3 break-words font-medium">{r.prompt ? `“${r.prompt}”` : 'Edits'}</div>
            <small className="text-muted-foreground">{ago(r.t)}</small>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {r.actions.map((a, j) => (
                <span key={j} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                  {TOOL_LABEL[a.tool] || a.tool}{a.count > 1 ? ` ×${a.count}` : ''}
                  {a.artboards.length ? ` · ${a.artboards.slice(0, 2).join(', ')}${a.artboards.length > 2 ? '…' : ''}` : ''}
                </span>
              ))}
            </div>
          </div>
          {r.restorable && r.snapshotId && (
            <Button size="sm" variant="outline" title="Restore the project to how it was before this request"
              onClick={() => restore(projectId, r.snapshotId!, 'Undid this request. Redo it from the Versions tab.')}>Undo</Button>
          )}
        </div>
      ))}
    </div>
  );
}

// Versions tab: automatic and manual snapshots. Restoring saves the current state first (server side), so it is undoable.
export function VersionsPanel({ projectId }: { projectId: string }) {
  const tick = useProject((s) => s.activityTick);
  const { data: list, failed, reload } = useJson<Snapshot[]>(`/api/projects/${projectId}/snapshots`, tick);
  const save = async () => {
    try {
      await projectAction(projectId, 'snapshot', { label: 'Saved version' });
      toast('Version saved');
      reload();
    } catch (e) { toast((e as Error).message || 'Could not save a version'); }
  };
  return (
    <div className="p-3">
      <Button size="sm" className="mb-3" onClick={save}>Save version</Button>
      {!list && <p className="text-muted-foreground">{failed ? 'Could not read the versions.' : 'Loading…'}</p>}
      {list && !list.length && <p className="text-muted-foreground">No versions yet. They are saved automatically while you work.</p>}
      {list?.map((s) => (
        <div key={s.id} className="mb-2 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <b className="block truncate font-medium">{s.label}</b>
            <small className="text-muted-foreground">{ago(s.createdAt)} · {s.artboards} artboard{s.artboards === 1 ? '' : 's'}</small>
          </div>
          <Button size="sm" variant="outline" onClick={async () => { await restore(projectId, s.id, 'Restored. The previous state is saved too.'); reload(); }}>Restore</Button>
        </div>
      ))}
    </div>
  );
}
