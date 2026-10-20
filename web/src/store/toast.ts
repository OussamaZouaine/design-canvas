import { create } from 'zustand';

interface ToastState {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  visible: boolean;
  show: (message: string, actionLabel?: string, onAction?: () => void) => void;
  hide: () => void;
}

// One timer for the whole app: a new toast replaces the old one instead of stacking (matches the legacy pages).
let timer: ReturnType<typeof setTimeout> | undefined;

export const useToast = create<ToastState>((set) => ({
  message: '',
  visible: false,
  show: (message, actionLabel, onAction) => {
    clearTimeout(timer);
    set({ message, actionLabel, onAction, visible: true });
    // Toasts with an Undo action stay longer so there is time to react.
    timer = setTimeout(() => set({ visible: false }), actionLabel ? 7000 : 3000);
  },
  hide: () => set({ visible: false }),
}));

export const toast = (message: string, actionLabel?: string, onAction?: () => void) =>
  useToast.getState().show(message, actionLabel, onAction);
