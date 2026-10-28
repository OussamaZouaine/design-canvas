import { create } from 'zustand';
import { parsePayload, type ClipPayload } from '@/canvas/clipboard';

// The app clipboard outlives any one canvas engine (the engine is destroyed when the project changes) and is shared
// with other tabs through localStorage, so a copy can be pasted into another page, project or tab.
// localStorage can throw (private mode, blocked site data): the in-memory copy still works in this tab then.
const KEY = 'dc-clipboard';

const read = (): ClipPayload | null => {
  try { return parsePayload(localStorage.getItem(KEY)); } catch { return null; }
};

interface ClipState {
  payload: ClipPayload | null;
  set: (p: ClipPayload) => void;
  // After a cut is pasted once the ids are spent: later pastes are plain copies (see Doc.pasteBoards).
  spendCut: () => void;
  clear: () => void;
}

const persist = (p: ClipPayload | null) => {
  try { if (p) localStorage.setItem(KEY, JSON.stringify(p)); else localStorage.removeItem(KEY); } catch { /* this tab only */ }
};

export const useClipboard = create<ClipState>((set, get) => ({
  payload: read(),
  set: (p) => { persist(p); set({ payload: p }); },
  spendCut: () => {
    const p = get().payload;
    if (!p?.cut) return;
    const next = { ...p, cut: false };
    persist(next);
    set({ payload: next });
  },
  clear: () => { persist(null); set({ payload: null }); },
}));

// Another tab copied something: follow it. `storage` never fires in the tab that wrote the value.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) useClipboard.setState({ payload: read() });
  });
}
