import { useEffect, useRef } from 'react';
import type { ProjectSummary } from '@/api/projects';
import { cn } from '@/lib/utils';

interface Props {
  cover: ProjectSummary['cover'];
  // Box the preview must fill. The cover is scaled to the box width and cropped from the top, so the box shape is the
  // caller's choice (a wide card area in grid view, a small chip in list view).
  width: number;
  height: number;
  className?: string;
}

// Scaled-down live preview of a project's cover artboard. The HTML is rendered at its real size inside a shadow root
// (so the design's CSS cannot leak into the app, nor ours into it), then shrunk with a transform to fit the box.
// React must not render artboard HTML (project rule), so the shadow DOM is filled imperatively in an effect.
export function CoverThumb({ cover, width, height, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !cover) return;
    // attachShadow throws on a second call (StrictMode runs effects twice in dev), so reuse an existing root.
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>:host{all:initial;display:block;font-family:system-ui,sans-serif}</style><div style="position:relative;width:100%;height:100%">${cover.html}</div>`;
  }, [cover]);

  const box = cn('relative shrink-0 overflow-hidden bg-muted/60', className);
  if (!cover) {
    return <div className={cn(box, 'flex items-center justify-center text-xs text-muted-foreground')} style={{ width, height }}>Empty</div>;
  }
  return (
    <div className={box} style={{ width, height }}>
      <div
        ref={ref}
        className="pointer-events-none absolute top-0 left-0 origin-top-left bg-white"
        style={{ width: cover.width, height: cover.height, transform: `scale(${width / cover.width})` }}
      />
    </div>
  );
}
