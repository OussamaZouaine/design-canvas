import { useRef } from 'react';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { canvasAction } from '@/api/projects';
import { pageOfBoard, pagesOf } from '@/canvas/engine';
import { useCanvas } from '@/store/canvas';
import { useProject } from '@/store/project';
import { toast } from '@/store/toast';
import { useUi } from '@/store/ui';

// Confirms deleting a page. The boards go with it (one undo step on the server), so the dialog says how many;
// the Undo toast afterwards is the safety net. Opened through `useUi.deletePageId` from the Pages panel, its
// context menu and the command palette.
export function DeletePageDialog({ projectId }: { projectId: string }) {
  const id = useUi((s) => s.deletePageId);
  const close = () => useUi.getState().setDeletePageId(null);
  const doc = useProject((s) => s.doc);
  const engine = useCanvas((s) => s.engine);
  const active = useCanvas((s) => s.activePage);
  const list = doc ? pagesOf(doc) : [];
  const idx = list.findIndex((p) => p.id === id);
  const page = list[idx];
  const boards = page && doc ? doc.artboards.filter((a) => pageOfBoard(doc, a) === page.id).length : 0;

  // The page is gone from the doc while the dialog fades out; keep what it last showed so the text doesn't flash empty.
  const shown = useRef({ name: '', boards: 0 });
  if (page) shown.current = { name: page.name, boards };
  const { name, boards: count } = shown.current;

  const remove = async () => {
    if (!page || !engine || list.length < 2) return close();
    const wasCurrent = (active ?? list[0].id) === page.id;
    const neighbour = list[idx + 1] ?? list[idx - 1]; // next page, or the previous one when deleting the last
    close();
    engine.markUserEdit(); // the user's own edit must not trigger the "Claude is designing" reveal
    try {
      await canvasAction(projectId, 'page-delete', { id: page.id });
      if (wasCurrent) engine.setPageWhenReady(neighbour.id);
      toast(`Deleted page “${page.name}”`, 'Undo', () => {
        engine.markUserEdit();
        canvasAction(projectId, 'undo').then(() => engine.setPageWhenReady(page.id)).catch((e: Error) => toast(e.message || 'Nothing to undo'));
      });
    } catch (e) { toast((e as Error).message || 'Could not delete the page'); }
  };

  return (
    <AlertDialog open={!!page} onOpenChange={(o) => { if (!o) close(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete page “{name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            {count === 0 ? 'This page is empty.' : `This also deletes its ${count} ${count === 1 ? 'board' : 'boards'}.`} You can undo this right after.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={remove}>Delete page</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
