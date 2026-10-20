import { useEffect, useRef } from 'react';
import { useCanvas } from '@/store/canvas';
import { useComments } from '@/store/comments';
import { useProject } from '@/store/project';
import { CanvasEngine } from './engine';
import './canvas.css';

// The one React component around the imperative engine. It renders an EMPTY div; the engine fills it.
// React must never render artboard HTML, so this component only (1) creates/destroys the engine,
// (2) forwards store changes into it, and (3) publishes the engine's events back into the store.
export function Canvas({ projectId }: { projectId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useCanvas((s) => s.engine);
  const doc = useProject((s) => s.doc);
  const agentIds = useProject((s) => s.agentIds);

  // Create the engine once per project. StrictMode runs this twice in dev: destroy() must undo everything.
  useEffect(() => {
    const c = useCanvas.getState();
    const e = new CanvasEngine(host.current!, projectId, {
      onZoom: c.setZoom,
      onSelect: c.setSelected,
      onLive: c.setLive,
      onPage: c.setActivePage,
      onView: c.bumpView,
      onCommentPick: (targetId, x, y) => useComments.getState().openNew(targetId, x, y),
    });
    e.setFollow(c.follow);
    c.setEngine(e);
    return () => {
      e.destroy();
      c.setEngine(null);
      c.setSelected(null);
      c.setLive(null);
    };
  }, [projectId]);

  // Every new doc goes straight into the engine, which diffs it against what is on screen.
  useEffect(() => { if (engine && doc) engine.setDoc(doc); }, [engine, doc]);
  useEffect(() => { engine?.setAgentIds(agentIds); }, [engine, agentIds]);

  return <div ref={host} className="dc-viewport absolute inset-0" />;
}
