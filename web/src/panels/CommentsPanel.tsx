import { Button } from '@/components/ui/button';
import { elementLabel, focusComment, numberOf } from '@/lib/comments';
import { ago } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useComments } from '@/store/comments';
import { useProject } from '@/store/project';

// Right-panel "Comments" tab: Open / All filter (shared with the pins on the canvas) and a clickable list.
export function CommentsPanel() {
  const doc = useProject((s) => s.doc);
  const comments = useProject((s) => s.comments);
  const { showResolved, setShowResolved } = useComments();
  const list = comments.filter((c) => showResolved || !c.resolved);
  return (
    <div className="p-3">
      <div className="mb-3 flex gap-1">
        <Button size="sm" variant={showResolved ? 'ghost' : 'secondary'} aria-pressed={!showResolved} onClick={() => setShowResolved(false)}>Open</Button>
        <Button size="sm" variant={showResolved ? 'secondary' : 'ghost'} aria-pressed={showResolved} onClick={() => setShowResolved(true)}>All</Button>
      </div>
      {list.length === 0 && (
        <p className="text-muted-foreground">
          {showResolved ? 'No comments yet.' : 'No open comments. Press C, then click an element to leave one. Claude reads them and replies.'}
        </p>
      )}
      {list.map((c) => (
        // data-comment-ui: clicking a row must not count as an "outside click" that closes the popover it opens.
        <button
          key={c.id} data-comment-ui onClick={() => focusComment(c)}
          className={cn('mb-1 flex w-full gap-2 rounded-md p-2 text-left hover:bg-muted', c.resolved && 'opacity-60')}
        >
          <span className="tnum grid size-5 shrink-0 place-items-center rounded-full bg-[var(--selection)] text-[10px] text-white">{numberOf(comments, c)}</span>
          <span className="min-w-0">
            <span className="line-clamp-3 break-words">{c.text}</span>
            <small className="block text-muted-foreground">
              {c.author === 'claude' ? 'Claude' : 'You'} · {ago(c.createdAt)} · {elementLabel(doc, c.targetId)}
              {c.replies.length ? ` · ${c.replies.length} repl${c.replies.length === 1 ? 'y' : 'ies'}` : ''}{c.resolved ? ' · resolved' : ''}
            </small>
          </span>
        </button>
      ))}
    </div>
  );
}
