import { create } from 'zustand';
import type { CanvasEngine } from '@/canvas/engine';

// What the imperative canvas engine reports to React chrome (zoom label, live pill, selected id, page),
// plus the engine itself so chrome buttons (fit, zoom, follow) can call it. The engine lives in the store
// instead of a ref so effects and event handlers elsewhere can reach it without prop drilling.
interface CanvasState {
  engine: CanvasEngine | null;
  zoom: number;
  selected: string | null;
  live: { id: string; name: string } | null;
  activePage: string | null;
  follow: boolean;
  setEngine: (e: CanvasEngine | null) => void;
  setZoom: (k: number) => void;
  setSelected: (id: string | null) => void;
  setLive: (l: { id: string; name: string } | null) => void;
  setActivePage: (id: string | null) => void;
  setFollow: (on: boolean) => void;
}

const initialFollow = (() => { try { return localStorage.getItem('dc-follow') !== '0'; } catch { return true; } })();

export const useCanvas = create<CanvasState>((set) => ({
  engine: null,
  zoom: 0.5,
  selected: null,
  live: null,
  activePage: null,
  follow: initialFollow,
  setEngine: (engine) => set({ engine }),
  setZoom: (zoom) => set({ zoom }),
  setSelected: (selected) => set({ selected }),
  setLive: (live) => set({ live }),
  setActivePage: (activePage) => set({ activePage }),
  setFollow: (follow) => set({ follow }),
}));
