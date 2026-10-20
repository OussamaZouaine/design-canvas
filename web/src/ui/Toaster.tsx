import { useToast } from '@/store/toast';

// Single live-region toast, mounted once at the root. role=status makes screen readers announce changes politely.
// Only opacity/transform animate (project motion rule); reduced motion drops the movement.
export function Toaster() {
  const { message, actionLabel, onAction, visible, hide } = useToast();
  return (
    <div
      role="status"
      className={
        'fixed bottom-6 left-1/2 z-50 flex items-center gap-3.5 rounded-lg bg-foreground px-4 py-2.5 text-xs text-background shadow-lg ' +
        'transition-[opacity,transform] ease-[var(--ease-out)] motion-reduce:transition-none ' +
        (visible ? 'translate-y-0 opacity-100 duration-200 -translate-x-1/2' : 'pointer-events-none translate-y-2 opacity-0 duration-150 -translate-x-1/2')
      }
    >
      {message}
      {actionLabel && (
        <button className="font-medium text-[var(--selection)]" onClick={() => { hide(); onAction?.(); }}>{actionLabel}</button>
      )}
    </div>
  );
}
