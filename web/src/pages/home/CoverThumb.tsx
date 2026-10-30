import { useEffect, useRef, useState } from 'react';
import type { ProjectSummary } from '@/api/projects';
import { cn } from '@/lib/utils';

interface Props {
  cover: ProjectSummary['cover'];
  // Box the preview must fill. The cover is scaled to the box width and cropped from the top, so the box shape is the
  // caller's choice (a wide card area in grid view, a small chip in list view).
  // Omit width to fill the parent's width (measured), used by the fluid grid cards.
  width?: number;
  height: number;
  className?: string;
}

// Scaled-down live preview of a project's cover artboard. The HTML is rendered at its real size inside a shadow root
// (so the design's CSS cannot leak into the app, nor ours into it), then shrunk with a transform to fit the box.
// React must not render artboard HTML (project rule), so the shadow DOM is filled imperatively in an effect.
export function CoverThumb({ cover, width: fixedWidth, height, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(0);
  const width = fixedWidth ?? measured;

  // ResizeObserver keeps the scale right when the fluid grid changes column width.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || fixedWidth !== undefined) return;
    const ro = new ResizeObserver(() => setMeasured(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fixedWidth, cover]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !cover) return;
    // attachShadow throws on a second call (StrictMode runs effects twice in dev), so reuse an existing root.
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>:host{all:initial;display:block;font-family:system-ui,sans-serif}</style><div style="position:relative;width:100%;height:100%">${cover.html}</div>`;
  }, [cover]);

  // A pure black/white 10% outline gives every cover the same crisp edge, whatever colour its own edge is
  // (a tinted outline would pick up the card underneath and read as dirt).
  const box = cn('relative shrink-0 overflow-hidden bg-muted/60 outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10', className);
  if (!cover) {
    return <div className={cn(box, 'flex items-center justify-center text-xs text-muted-foreground')} style={{ width: fixedWidth, height }}>Empty</div>;
  }
  return (
    <div ref={boxRef} className={box} style={{ width: fixedWidth, height }}>
      <div
        ref={ref}
        className="pointer-events-none absolute top-0 left-0 origin-top-left bg-white"
        style={{ width: cover.width, height: cover.height, transform: `scale(${width / cover.width})`, visibility: width ? undefined : 'hidden' }}
      />
    </div>
  );
}
