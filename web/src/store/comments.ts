import { create } from 'zustand';

// UI state for comment pins and the popover. The comments themselves live in store/project.ts (server data);
// this holds only what the user is looking at: which popover is open and whether resolved pins show.
export type Popover =
  | { kind: 'new'; targetId: string; x: number; y: number }
  | { kind: 'thread'; id: string; x: number; y: number }
  | null;

interface CommentsUi {
  popover: Popover;
  showResolved: boolean;
  openNew: (targetId: string, x: number, y: number) => void;
  openThread: (id: string, x: number, y: number) => void;
  close: () => void;
  setShowResolved: (on: boolean) => void;
}

export const useComments = create<CommentsUi>((set) => ({
  popover: null,
  showResolved: false,
  openNew: (targetId, x, y) => set({ popover: { kind: 'new', targetId, x, y } }),
  openThread: (id, x, y) => set({ popover: { kind: 'thread', id, x, y } }),
  close: () => set({ popover: null }),
  setShowResolved: (showResolved) => set({ showResolved }),
}));
