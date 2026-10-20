// Minimal typed client; Phase 1 grows this into the full API layer.
export interface ProjectSummary { id: string; name: string }

export async function listProjects(): Promise<ProjectSummary[]> {
  const res = await fetch('/api/projects');
  if (!res.ok) throw new Error(`GET /api/projects -> ${res.status}`);
  const body = await res.json();
  return Array.isArray(body) ? body : body.projects ?? [];
}
