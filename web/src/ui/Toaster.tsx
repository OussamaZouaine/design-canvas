import { useToast } from '@/store/toast';

// Single live-region toast, mounted once at the root. role=status makes screen readers announce changes politely.
// Only opacity/transform animate (project motion rule); reduced motion drops the movement.
export function Toaster() {
  const { message, actionLabel, onAction, visible, hide } = useToast();
  return (
    <div
      role="status"
      className={
        // bottom-18 clears the canvas's floating toolbar (bottom-4, 40px tall). Tailwind v4 translate utilities set the
        // `translate` property, not `transform`, so that is what the transition names.
        'fixed bottom-18 left-1/2 z-50 flex items-center gap-3.5 rounded-lg bg-foreground px-4 py-2.5 text-xs text-background shadow-float ' +
        'transition-[opacity,translate] ease-[var(--ease-out)] motion-reduce:transition-none ' +
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
