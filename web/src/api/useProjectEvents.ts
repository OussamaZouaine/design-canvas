import { useEffect } from 'react';
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
    // screenshot / computed / compare requests are answered by the canvas engine in Phase 4.

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
