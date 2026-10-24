import { create } from 'zustand';

export type Tool = 'move' | 'frame' | 'rect' | 'ellipse' | 'line' | 'pen' | 'text' | 'image' | 'comment' | 'hand';
export type PanelTab = 'design' | 'comment' | 'activity' | 'versions' | 'theme' | 'tokens' | 'agents' | 'mcp';
export type Theme = 'dark' | 'light';

// localStorage can throw (private mode, blocked site data), so every access is guarded.
const read = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const write = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* preference just will not persist */ }
};

// The theme is the shadcn `.dark` class on <html>. Dark by default (canvas tools read better on dark).
// Every colour transition would fire at once on a flip and smear the switch, so transitions are switched off
// (`.theme-switching`), styles are recomputed so the new colours land without them, then they come back.
// A timeout, not requestAnimationFrame: rAF never fires in a background tab, which would leave transitions off.
// The first apply at load skips all this (nothing has rendered yet, so nothing can transition).
export const applyTheme = (theme: Theme, instant = true) => {
  const root = document.documentElement;
  if (instant) root.classList.add('theme-switching');
  root.classList.toggle('dark', theme === 'dark');
  if (!instant) return;
  void getComputedStyle(root).color; // force the style recalc while transitions are off
  setTimeout(() => root.classList.remove('theme-switching'), 1);
};

interface UiState {
  tool: Tool;
  panelTab: PanelTab;
  layersOpen: boolean;
  panelOpen: boolean;
  theme: Theme;
  rulers: boolean;
  toggleRulers: () => void;
  setTool: (t: Tool) => void;
  setPanelTab: (t: PanelTab) => void;
  toggleLayers: () => void;
  togglePanel: () => void;
  toggleTheme: () => void;
}

const initialTheme: Theme = read('dc-theme') === 'light' ? 'light' : 'dark';
applyTheme(initialTheme, false);

export const useUi = create<UiState>((set, get) => ({
  tool: 'move',
  panelTab: 'design',
  layersOpen: true,
  panelOpen: true,
  theme: initialTheme,
  rulers: read('dc-rulers') === '1',
  toggleRulers: () => {
    const rulers = !get().rulers;
    write('dc-rulers', rulers ? '1' : '0');
    set({ rulers });
  },
  setTool: (tool) => set({ tool }),
  setPanelTab: (panelTab) => set({ panelTab, panelOpen: true }),
  toggleLayers: () => set((s) => ({ layersOpen: !s.layersOpen })),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  toggleTheme: () => {
    const theme: Theme = get().theme === 'dark' ? 'light' : 'dark';
    applyTheme(theme);
    write('dc-theme', theme);
    set({ theme });
  },
}));
