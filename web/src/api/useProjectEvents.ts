import { useEffect } from 'react';
import { answer, compareToReference, computedStyles, measure, screenshot, type ReplyHost } from '@/canvas/replies';
import { useCanvas } from '@/store/canvas';
import { useProject } from '@/store/project';
import { activateProject } from './projects';
import type { Comment, DocData, ProjectMeta } from './types';

// Subscribes to one project's SSE stream and feeds the store. One EventSource per mounted project page;
// EventSource reconnects by itself, and the server re-sends meta + doc + comments on every (re)connect.
export function useProjectEvents(projectId: string) {
  useEffect(() => {
    const s = useProject.getState();
    s.reset();

    const es = new EventSource(`/events?project=${projectId}`);
    const parse = <T,>(e: Event) => JSON.parse((e as MessageEvent).data) as T;

    es.onopen = () => useProject.getState().setConnection('connected');
    es.onerror = () => useProject.getState().setConnection('disconnected');
    es.addEventListener('meta', (e) => useProject.getState().setMeta(parse<ProjectMeta>(e)));
    es.addEventListener('doc', (e) => useProject.getState().applyDocDelta(parse<DocData>(e)));
    es.addEventListener('comments', (e) => useProject.getState().setComments(parse<Comment[]>(e)));
    es.addEventListener('agent', (e) => useProject.getState().setAgentIds(parse<{ ids: string[] }>(e).ids));
    es.addEventListener('activity', () => useProject.getState().bumpActivity());
    // Claude's MCP tools ask this tab for pixels and layout; the engine owns the DOM, so it answers.
    // With no engine yet (page still loading) the request gets an error reply instead of timing out.
    const ask = (e: Event, endpoint: 'screenshot' | 'reply', run: (host: ReplyHost, d: any) => unknown) => {
      const d = parse<{ id: string }>(e);
      const engine = useCanvas.getState().engine;
      void answer(projectId, endpoint, d.id, () => {
        if (!engine) throw new Error('Canvas not ready');
        return run(engine.replyHost(), d);
      });
    };
    es.addEventListener('screenshot', (e) => ask(e, 'screenshot', (h, d) => screenshot(h, d.artboardId, d)));
    es.addEventListener('computed', (e) => ask(e, 'reply', (h, d) => computedStyles(h, d.nodeIds, d.props)));
    es.addEventListener('measure', (e) => ask(e, 'reply', (h, d) => measure(h, d.boards)));
    es.addEventListener('compare', (e) => ask(e, 'reply', (h, d) => compareToReference(h, d.artboardId, d.refId)));

    // Claim "active project" when the tab loads or becomes visible, NOT on SSE reconnect, so a stale
    // background tab cannot steal it from the one the user is looking at.
    const claim = () => { if (document.visibilityState === 'visible') activateProject(projectId).catch(() => {}); };
    claim();
    document.addEventListener('visibilitychange', claim);

    return () => {
      es.close();
      document.removeEventListener('visibilitychange', claim);
    };
  }, [projectId]);
}
