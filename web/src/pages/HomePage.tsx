import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { listProjects, type ProjectSummary } from '@/api/projects';

// Phase 1 placeholder: just enough to navigate to a project. Phase 2 ports the real home page.
export function HomePage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  useEffect(() => { listProjects().then(setProjects).catch(() => setProjects([])); }, []);
  return (
    <main className="p-6">
      <h1 className="mb-3 text-lg font-semibold">Projects</h1>
      <ul className="space-y-1">
        {projects?.map((p) => (
          <li key={p.id}><Link to="/p/$id" params={{ id: p.id }} className="hover:underline">{p.name}</Link></li>
        ))}
      </ul>
    </main>
  );
}
