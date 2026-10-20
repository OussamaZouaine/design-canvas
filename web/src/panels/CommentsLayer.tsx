import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Comment } from '@/api/types';
import { Button } from '@/components/ui/button';
import { commentAction, elementLabel, focusComment, numberOf } from '@/lib/comments';
import { ago } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useCanvas } from '@/store/canvas';
import { useComments } from '@/store/comments';
import { useProject } from '@/store/project';
import { toast } from '@/store/toast';
import { useUi } from '@/store/ui';

interface Pin { id: string; n: number; x: number; y: number; resolved: boolean }

const typing = (t: EventTarget | null) => t instanceof Element && !!t.closest('input, textarea, select, [contenteditable]');

// Everything comment-related that floats over the canvas: pins, the popover, the C / Esc shortcuts and the
// ?comment= deep link. Lives inside the (position: relative) canvas area, so its coordinates match the engine's.
export function CommentsLayer({ projectId, deepLink }: { projectId: string; deepLink?: string }) {
  const engine = useCanvas((s) => s.engine);
  const viewTick = useCanvas((s) => s.viewTick);
  const doc = useProject((s) => s.doc);
  const comments = useProject((s) => s.comments);
  const showResolved = useComments((s) => s.showResolved);
  const popover = useComments((s) => s.popover);
  const tool = useUi((s) => s.tool);

  // Tool <-> engine: the engine only needs to know whether clicks pin comments.
  useEffect(() => {
    engine?.setCommentMode(tool === 'comment');
    if (tool === 'comment') toast('Click an element to pin a comment. Esc to stop.');
    else useComments.getState().close();
  }, [engine, tool]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const ui = useUi.getState();
      if (e.key.toLowerCase() === 'c') ui.setTool(ui.tool === 'comment' ? 'move' : 'comment');
      if (e.key === 'Escape') {
        if (useComments.getState().popover) useComments.getState().close();
        else if (ui.tool === 'comment') ui.setTool('move');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Click anywhere outside the popover, a pin or a list row dismisses it (capture so nothing can stop the event first).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (useComments.getState().popover && !(e.target as Element).closest('[data-comment-ui]')) useComments.getState().close();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  // Pins: measured from the live elements after every view change. Several comments on one element fan out leftwards.
  const [pins, setPins] = useState<Pin[]>([]);
  useLayoutEffect(() => {
    if (!engine) return;
    const slots = new Map<string, number>();
    const next: Pin[] = [];
    for (const c of comments) {
      if (c.resolved && !showResolved) continue;
      const r = engine.rectOf(c.targetId); // null for orphaned comments: they stay reachable from the tab
      if (!r) continue;
      const slot = slots.get(c.targetId) ?? 0;
      slots.set(c.targetId, slot + 1);
      next.push({ id: c.id, n: numberOf(comments, c), x: r.left + r.width - slot * 28, y: Math.max(r.top, 0), resolved: !!c.resolved });
    }
    setPins(next);
  }, [engine, comments, showResolved, viewTick, doc]);

  // Deep link from the Comments page: open that thread once the doc and comments have arrived (once only).
  const linked = useRef(false);
  useEffect(() => {
    if (!deepLink || linked.current || !engine || !doc?.artboards.length) return;
    const c = comments.find((x) => x.id === deepLink);
    if (!c) return;
    linked.current = true;
    setTimeout(() => focusComment(c), 500); // let the first render and fit settle
  }, [deepLink, engine, doc, comments]);

  return (
    <>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {pins.map((p) => (
          // Outer div moves (transform only, so panning stays cheap); the inner button plays the pop-in once.
          <div key={p.id} className="absolute top-0 left-0" style={{ transform: `translate3d(${p.x}px, ${p.y}px, 0)` }}>
            <button
              data-comment-ui
              aria-label={`Open comment ${p.n}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => useComments.getState().openThread(p.id, p.x, p.y)}
              className={cn('dc-pin pointer-events-auto', p.resolved && 'resolved')}
            >{p.n}</button>
          </div>
        ))}
      </div>
      {popover?.kind === 'new' && <NewComment key={`${popover.targetId}:${popover.x}:${popover.y}`} projectId={projectId} {...popover} />}
      {popover?.kind === 'thread' && <Thread key={popover.id} projectId={projectId} {...popover} />}
    </>
  );
}

// Positions the 300px popover next to the anchor, kept inside the canvas area. Measures itself after layout.
function PopShell({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + 14, top: y - 8 });
  useLayoutEffect(() => {
    const el = ref.current!, host = el.parentElement!;
    const left = Math.max(8, Math.min(x + 14, host.clientWidth - 308));
    const top = Math.max(8, Math.min(y - 8, host.clientHeight - el.offsetHeight - 8));
    setPos({ left, top });
  }, [x, y]);
  return (
    <div
      ref={ref}
      data-comment-ui
      role="dialog"
      className="dc-pop absolute z-20 w-[300px] rounded-xl border bg-popover p-3 text-popover-foreground shadow-xl"
      // The entrance grows out of the anchor point instead of the popover centre.
      style={{ left: pos.left, top: pos.top, transformOrigin: `${x - pos.left}px ${y - pos.top}px` }}
    >
      {children}
    </div>
  );
}

function Textarea({ ref, ...p }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      ref={ref}
      {...p}
      className="mt-2 min-h-16 w-full resize-y rounded-md border border-input bg-input/20 p-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
    />
  );
}

function NewComment({ projectId, targetId, x, y }: { projectId: string; targetId: string; x: number; y: number }) {
  const doc = useProject((s) => s.doc);
  const [text, setText] = useState('');
  const ta = useRef<HTMLTextAreaElement>(null);
  // A real click moves focus to the page after the handler runs and would steal it back; the next tick wins that race.
  useEffect(() => { const t = setTimeout(() => ta.current?.focus(), 0); return () => clearTimeout(t); }, []);
  const send = async () => {
    if (!text.trim()) return;
    if (await commentAction(projectId, 'comment-add', { targetId, text })) {
      useComments.getState().close();
      useUi.getState().setTool('move');
      toast('Comment pinned. Ask Claude to address it.');
    }
  };
  return (
    <PopShell x={x} y={y}>
      <div className="text-[11px] text-muted-foreground">On {elementLabel(doc, targetId)}</div>
      <Textarea
        ref={ta} value={text} aria-label="Comment" placeholder="What should change? Claude will read this."
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
      />
      <div className="mt-2.5 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => useComments.getState().close()}>Cancel</Button>
        <Button size="sm" onClick={send}>Comment</Button>
      </div>
    </PopShell>
  );
}

function Message({ author, text, t }: { author?: string; text: string; t: number }) {
  return (
    <div className="mb-2">
      <b className={cn('font-medium', author === 'claude' && 'text-[oklch(0.68_0.2_295)]')}>{author === 'claude' ? 'Claude' : 'You'}</b>
      <small className="ml-2 text-muted-foreground">{ago(t)}</small>
      {/* Untrusted text: React escapes it, and pre-wrap keeps the author's line breaks. */}
      <p className="whitespace-pre-wrap break-words">{text}</p>
    </div>
  );
}

function Thread({ projectId, id, x, y }: { projectId: string; id: string; x: number; y: number }) {
  const doc = useProject((s) => s.doc);
  const comments = useProject((s) => s.comments);
  const c: Comment | undefined = comments.find((k) => k.id === id);
  const [text, setText] = useState('');
  // The comment was deleted (here or by Claude): close instead of showing a stale thread.
  useEffect(() => { if (!c) useComments.getState().close(); }, [c]);
  if (!c) return null;
  const reply = async () => { if (text.trim() && await commentAction(projectId, 'comment-reply', { commentId: id, text })) setText(''); };
  return (
    <PopShell x={x} y={y}>
      <div className="mb-2 text-[11px] text-muted-foreground">#{numberOf(comments, c)} · {elementLabel(doc, c.targetId)}</div>
      <Message author={c.author} text={c.text} t={c.createdAt} />
      {c.replies.map((r, i) => <Message key={i} author={r.author} text={r.text} t={r.createdAt} />)}
      <Textarea
        value={text} aria-label="Reply" placeholder="Reply…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) reply(); }}
      />
      <div className="mt-2.5 flex items-center gap-2">
        <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => { await commentAction(projectId, 'comment-delete', { commentId: id }); useComments.getState().close(); }}>Delete</Button>
        <span className="flex-1" />
        <Button size="sm" variant="outline" onClick={async () => { await commentAction(projectId, 'comment-resolve', { commentId: id, resolved: !c.resolved }); if (!c.resolved) useComments.getState().close(); }}>
          {c.resolved ? 'Reopen' : 'Resolve'}
        </Button>
        <Button size="sm" onClick={reply}>Reply</Button>
      </div>
    </PopShell>
  );
}
