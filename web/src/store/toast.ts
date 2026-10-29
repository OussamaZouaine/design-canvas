import { toast as sonner } from 'sonner';

// Thin adapter so the ~25 call sites keep `toast(message, actionLabel?, onAction?)`; sonner (shadcn) renders it.
// A fixed id makes a new toast replace the previous one instead of stacking (same behaviour as the old store).
// Toasts with an Undo action stay longer so there is time to react.
export const toast = (message: string, actionLabel?: string, onAction?: () => void) =>
  sonner(message, {
    id: 'dc-toast',
    duration: actionLabel ? 7000 : 3000,
    action: actionLabel ? { label: actionLabel, onClick: () => onAction?.() } : undefined,
  });
