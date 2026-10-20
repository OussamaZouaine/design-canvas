import { useCallback, useEffect, useState } from 'react';

// GET a JSON endpoint for a side-panel tab. Refetches when `refreshKey` changes (e.g. a server event tick) and,
// when `pollMs` is set, on a timer (for data nothing pushes, like MCP call stats). Returns the previous data while
// reloading, so a tab never flashes empty between refreshes.
export function useJson<T>(url: string, refreshKey: unknown = 0, pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const [manual, setManual] = useState(0);
  const reload = useCallback(() => setManual((n) => n + 1), []);

  useEffect(() => {
    let alive = true; // a slow response must not overwrite a newer one, or land after unmount
    const load = () =>
      fetch(url)
        .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<T>; })
        .then((d) => { if (alive) { setData(d); setFailed(false); } })
        .catch(() => { if (alive) setFailed(true); });
    load();
    const timer = pollMs ? setInterval(load, pollMs) : undefined;
    return () => { alive = false; clearInterval(timer); };
  }, [url, refreshKey, pollMs, manual]);

  return { data, failed, reload };
}
