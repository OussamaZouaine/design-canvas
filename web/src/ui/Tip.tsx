import type { ReactElement } from 'react';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// Replaces the native `title=` on icon buttons: styled, shows the shortcut as a kbd chip, and (via the
// TooltipProvider in main.tsx) opens instantly once another tooltip was just open. `children` must be one element
// that can hold a ref (a Button or a plain <button>); Base UI's `render` prop merges the trigger props onto it.
// Keep an aria-label on the child: a tooltip is not an accessible name.
export function Tip({ label, keys, side, children }: { label: string; keys?: string; side?: 'top' | 'bottom' | 'left' | 'right'; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side}>
        {label}
        {keys && <Kbd>{keys}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}
