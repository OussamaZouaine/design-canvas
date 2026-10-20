import { useEffect, useEffectEvent, useState } from 'react';

export type Connection = 'connecting' | 'connected' | 'disconnected';

// Subscribes to the global /events stream (not the per-project one) and calls `reload` shortly after any of the named
// events fires. Claude can fire many edits per second, so reloads are debounced per event (ms in the map).
// useEffectEvent keeps the effect from re-subscribing when `reload` changes identity, while still calling the latest one.
export function useLiveReload(reload: () => void, events: Record<string, number>): Connection {
  const [connection, setConnection] = useState<Connection>('connecting');
  const onReload = useEffectEvent(reload);
  // The map is a fresh object each render; key the effect on its content instead.
  const key = JSON.stringify(events);

  useEffect(() => {
    const es = new EventSource('/events'); // reconnects by itself
    let timer: ReturnType<typeof setTimeout> | undefined;
    es.onopen = () => setConnection('connected');
    es.onerror = () => setConnection('disconnected');
    for (const [name, delay] of Object.entries(JSON.parse(key) as Record<string, number>)) {
      es.addEventListener(name, () => { clearTimeout(timer); timer = setTimeout(onReload, delay); });
    }
    return () => { clearTimeout(timer); es.close(); };
  }, [key]);

  return connection;
}
