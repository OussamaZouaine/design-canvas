import { canvasAction } from '@/api/projects';
import type { Comment, DocData } from '@/api/types';
import { useCanvas } from '@/store/canvas';
import { useComments } from '@/store/comments';
import { toast } from '@/store/toast';
import { findNode } from './htmlTree';

// Short description of what a comment is pinned to ("button “Save”"). Reads the stored HTML (like the
// Layers panel) instead of mounting the board, so listing comments never wakes an unmounted artboard.
export function elementLabel(doc: DocData | null, targetId: string): string {
  if (!doc) return 'element';
  if (targetId.startsWith('A')) return `artboard “${doc.artboards.find((a) => a.id === targetId)?.name ?? '?'}”`;
  const hit = findNode(doc, targetId, useCanvas.getState().engine?.boardOf(targetId));
  if (!hit) return 'element removed';
  const t = (hit.el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  return `${hit.el.tagName.toLowerCase()}${t ? ` “${t}”` : ''}`;
}

// Comments are numbered by creation order, which stays stable while others are resolved or deleted.
export const numberOf = (comments: Comment[], c: { id: string }) => comments.findIndex((x) => x.id === c.id) + 1;

// Server mutations. Errors become toasts; the new state comes back over SSE (`comments` event), so only success is returned.
export async function commentAction(
  projectId: string,
  action: 'comment-add' | 'comment-reply' | 'comment-resolve' | 'comment-delete',
  body: unknown,
): Promise<boolean> {
  try {
    await canvasAction(projectId, action, body);
    return true;
  } catch (e) {
    toast((e as Error).message || 'That did not work');
    return false;
  }
}

// Jump to a comment's element and open its thread. From the zoomed-out overview we zoom in first
// (about the centre) so the pin is readable, then pan the element to the middle.
export function focusComment(c: Comment) {
  const engine = useCanvas.getState().engine;
  if (!engine) return;
  engine.ensureZoom(0.6);
  if (!engine.panTo(c.targetId)) { toast('That element no longer exists.'); return; }
  // panTo moved the world; wait a frame so the board has mounted and laid out before measuring.
  requestAnimationFrame(() => {
    const r = engine.rectOf(c.targetId);
    if (r) useComments.getState().openThread(c.id, r.left + r.width, r.top);
  });
}
