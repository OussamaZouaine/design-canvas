import { create } from 'zustand';
import type { CanvasEngine } from '@/canvas/engine';

// What the imperative canvas engine reports to React chrome (zoom label, live pill, selected id, page),
// plus the engine itself so chrome buttons (fit, zoom, follow) can call it. The engine lives in the store
// instead of a ref so effects and event handlers elsewhere can reach it without prop drilling.
export interface MenuState {
  x: number; y: number; id: string | null;
  extra?: { label: string; run: () => void }[];
}

interface CanvasState {
  engine: CanvasEngine | null;
  zoom: number;
  selected: string | null;
  live: { id: string; name: string } | null;
  activePage: string | null;
  follow: boolean;
  // Bumped whenever the view settles; chrome that tracks canvas elements (comment pins) re-measures on it.
  viewTick: number;
  bumpView: () => void;
  // Theme mode being previewed ('base' or a named mode). A view setting, not document data; the Theme tab (Phase 6) sets it.
  mode: string;
  setMode: (m: string) => void;
  // Right-click menu: where it opened and which node (or board) it is about; null = closed.
  // `extra` is set by the Layers panel: its own items (rename, hide, lock) that only the panel can run.
  menu: MenuState | null;
  setMenu: (m: MenuState | null) => void;
  setEngine: (e: CanvasEngine | null) => void;
  setZoom: (k: number) => void;
  setSelected: (id: string | null) => void;
  setLive: (l: { id: string; name: string } | null) => void;
  setActivePage: (id: string | null) => void;
  setFollow: (on: boolean) => void;
}

const initialFollow = (() => { try { return localStorage.getItem('dc-follow') !== '0'; } catch { return true; } })();

export const useCanvas = create<CanvasState>((set, get) => ({
  engine: null,
  zoom: 0.5,
  selected: null,
  live: null,
  activePage: null,
  follow: initialFollow,
  viewTick: 0,
  bumpView: () => set((s) => ({ viewTick: s.viewTick + 1 })),
  mode: 'base',
  setMode: (mode) => { get().engine?.setThemeMode(mode); set({ mode }); },
  menu: null,
  setMenu: (menu) => set({ menu }),
  setEngine: (engine) => set({ engine }),
  setZoom: (zoom) => set({ zoom }),
  setSelected: (selected) => set({ selected }),
  setLive: (live) => set({ live }),
  setActivePage: (activePage) => set({ activePage }),
  setFollow: (follow) => set({ follow }),
}));
