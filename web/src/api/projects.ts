import type { ProjectSummary } from './types';

export type { ProjectSummary };

// Thin fetch wrapper. The server only accepts JSON POSTs (CSRF defence), so the content type is always set.
async function request<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export const listProjects = (opts: { trashed?: boolean } = {}) =>
  request<ProjectSummary[]>('GET', `/api/projects${opts.trashed ? '?deleted=1' : ''}`);

// Canvas/project actions all share one shape: POST /api/projects/:id/<action> or /api/p/:id/<action>.
export const projectAction = (id: string, action: string, body?: unknown) =>
  request<{ ok: boolean }>('POST', `/api/projects/${id}/${action}`, body);

export const canvasAction = (id: string, action: string, body?: unknown) =>
  request<{ ok: boolean; result?: unknown }>('POST', `/api/p/${id}/${action}`, body);

// Viewing a project makes it the "active" one that Claude's MCP tools target by default.
export const activateProject = (id: string) => projectAction(id, 'activate');
