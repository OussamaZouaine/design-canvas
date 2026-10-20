import type { OverviewComment, ProjectSummary } from './types';

export type { ProjectSummary };

// Thin fetch wrapper. The server only accepts JSON POSTs (CSRF defence), so the content type is always set.
// On failure it surfaces the server's own `{error}` message so toasts say something useful.
async function request<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });
  if (!res.ok) {
    const detail = await res.json().then((j: { error?: string }) => j.error, () => undefined);
    throw new Error(detail || `${method} ${url} -> ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const listProjects = (opts: { trashed?: boolean } = {}) =>
  request<ProjectSummary[]>('GET', `/api/projects${opts.trashed ? '?deleted=1' : ''}`);

export const createProject = (name: string, description: string) =>
  request<ProjectSummary>('POST', '/api/projects', { name, description });

// `data` is the parsed contents of a previously exported .dcproject.json file.
export const importProject = (data: unknown) => request<ProjectSummary>('POST', '/api/projects/import', data);

// Canvas/project actions all share one shape: POST /api/projects/:id/<action> or /api/p/:id/<action>.
export const projectAction = (id: string, action: string, body?: unknown) =>
  request<{ ok: boolean }>('POST', `/api/projects/${id}/${action}`, body);

export const canvasAction = (id: string, action: string, body?: unknown) =>
  request<{ ok: boolean; result?: unknown }>('POST', `/api/p/${id}/${action}`, body);

// Viewing a project makes it the "active" one that Claude's MCP tools target by default.
export const activateProject = (id: string) => projectAction(id, 'activate');

// Every comment from every non-trashed project (powers the Home badge and /comments).
export const listAllComments = () => request<OverviewComment[]>('GET', '/api/comments');
