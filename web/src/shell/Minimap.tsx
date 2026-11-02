import { useRef } from 'react';
import { fitWorld, toMap, toWorld, unionRects, viewRect } from '@/canvas/minimap';
import { useCanvas } from '@/store/canvas';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';

const W = 176, H = 120;

// Overview of the current page: every board as a plain rectangle (no snapshots, so 50+ boards stay cheap) plus the
// viewport rectangle. Click or drag moves the camera. It redraws on `viewTick` (rAF-coalesced by the engine) and on
// doc changes, never per pointer move on its own; the drag itself goes through engine.centerOn -> applyView.
export function Minimap() {
  // React Compiler would memoize the engine read below on `engine` alone, because the store subscriptions that
  // signal "the view / doc changed" are not read in the output. Opt out so every subscription re-renders it.
  'use no memo';
  const on = useUi((s) => s.minimap);
  const engine = useCanvas((s) => s.engine);
  useCanvas((s) => s.viewTick);
  useCanvas((s) => s.activePage); // a page switch changes which boards exist
  useProject((s) => s.doc);
  const box = useRef<HTMLDivElement>(null);
  if (!on || !engine) return null;

  const { boards, vw, vh } = engine.getMinimapData();
  if (!boards.length || !vw) return null;
  const v = engine.getView();
  const vr = viewRect(v, vw, vh);
  // The map covers boards + viewport, so the viewport rect stays visible even when panned far off the boards.
  const fit = fitWorld(unionRects([...boards, vr])!, W, H);
  const vm = toMap(fit, vr);

  const go = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    const p = toWorld(fit, e.clientX - r.left, e.clientY - r.top);
    engine.centerOn(p.x, p.y);
  };
  // Pointer capture keeps the drag alive when the pointer leaves the small box.
  const down = (e: React.PointerEvent) => { e.currentTarget.setPointerCapture(e.pointerId); go(e); };
  const move = (e: React.PointerEvent) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) go(e); };

  return (
    <div
      ref={box}
      role="img"
      aria-label="Canvas minimap"
      onPointerDown={down}
      onPointerMove={move}
      className="material absolute right-4 bottom-16 z-10 cursor-pointer touch-none overflow-hidden rounded-xl"
      style={{ width: W, height: H }}
    >
      <svg width={W} height={H} className="block text-foreground">
        {boards.map((b, i) => { const m = toMap(fit, b); return <rect key={i} x={m.x} y={m.y} width={Math.max(1, m.w)} height={Math.max(1, m.h)} rx={1} fill="currentColor" fillOpacity={0.28} />; })}
        {/* Neutral ink, not signal blue: blue means selection only. */}
        <rect x={vm.x} y={vm.y} width={vm.w} height={vm.h} fill="currentColor" fillOpacity={0.06} stroke="currentColor" strokeOpacity={0.8} />
      </svg>
    </div>
  );
}
