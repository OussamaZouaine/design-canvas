import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import { Button } from '@/components/ui/button';
import { listProjects, type ProjectSummary } from './api/projects';

// Phase 0 smoke test: proves Vite, the compiler, Tailwind, shadcn and the proxy to the Node server work together.
function App() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    listProjects().then(setProjects).catch((e) => setError(String(e)));
  }, []);
  return (
    <main className="p-6 text-sm">
      <h1 className="text-lg font-semibold">Design Canvas (React)</h1>
      <Button className="mt-3" onClick={() => location.reload()}>Reload</Button>
      {error && <p className="text-destructive">{error}</p>}
      {projects && (
        <ul className="mt-3 list-disc pl-5">
          {projects.map((p) => <li key={p.id}>{p.name}</li>)}
        </ul>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
