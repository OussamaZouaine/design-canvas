import { useEffect, useRef, useState } from 'react';
import { useCanvas } from '@/store/canvas';
import { useUi } from '@/store/ui';

const SIZE = 18; // ruler thickness in screen px
const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

// Pick the smallest "nice" step whose labels sit at least ~70 screen px apart, so labels never collide.
const stepFor = (k: number) => STEPS.find((s) => s * k >= 70) ?? STEPS[STEPS.length - 1];

// Ticks for one axis. `offset` is the camera translation, `len` the visible length in screen px.
// Majors carry a label (in design px, what the Inspector shows); minors are a fifth of a major
// and only drawn when they are at least 7 px apart.
function ticks(offset: number, k: number, len: number) {
  const step = stepFor(k);
  const minor = step / 5;
  const showMinor = minor * k >= 7;
  const from = Math.floor(-offset / k / minor) * minor;
  const to = (len - offset) / k;
  const out: { pos: number; major: boolean; label: number }[] = [];
  for (let w = from; w <= to; w += minor) {
    const major = Math.abs(w / step - Math.round(w / step)) < 1e-6;
    if (major || showMinor) out.push({ pos: Math.round(offset + w * k) + 0.5, major, label: Math.round(w) });
  }
  return out;
}

// Top and left rulers (Shift+R). Pure overlay, redrawn when the view settles (`viewTick`), so it costs
// nothing during a pan/zoom burst and never touches the engine's hot path. Shows design px, not screen px.
export function Rulers() {
  const on = useUi((s) => s.rulers);
  const engine = useCanvas((s) => s.engine);
  useCanvas((s) => s.viewTick); // subscribe so the ticks follow the camera
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // The ruler fills <main>; track its size so ticks cover the whole length.
  useEffect(() => {
    const el = box.current;
    if (!el || !on) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [on]);

  if (!on || !engine) return null;
  const v = engine.getView();
  const xs = ticks(v.x, v.k, size.w);
  const ys = ticks(v.y, v.k, size.h);

  return (
    <div ref={box} className="pointer-events-none absolute inset-0 z-10 text-muted-foreground" aria-hidden>
      {/* Strips are opaque so artboards slide under them like in Figma; the corner square hides the overlap. */}
      <svg className="absolute top-0 left-0 bg-background/95" width={size.w} height={SIZE}>
        <line x1={0} x2={size.w} y1={SIZE - 0.5} y2={SIZE - 0.5} stroke="currentColor" strokeOpacity={0.3} />
        {xs.map((t) => (
          <g key={t.pos}>
            <line x1={t.pos} x2={t.pos} y1={t.major ? 4 : SIZE - 5} y2={SIZE} stroke="currentColor" strokeOpacity={t.major ? 0.7 : 0.35} />
            {t.major && <text x={t.pos + 3} y={11} fontSize={9} fill="currentColor" className="tnum">{t.label}</text>}
          </g>
        ))}
      </svg>
      <svg className="absolute top-0 left-0 bg-background/95" width={SIZE} height={size.h}>
        <line x1={SIZE - 0.5} x2={SIZE - 0.5} y1={0} y2={size.h} stroke="currentColor" strokeOpacity={0.3} />
        {ys.map((t) => (
          <g key={t.pos}>
            <line y1={t.pos} y2={t.pos} x1={t.major ? 4 : SIZE - 5} x2={SIZE} stroke="currentColor" strokeOpacity={t.major ? 0.7 : 0.35} />
            {/* Rotated so the label reads bottom-to-top and fits inside the narrow strip. */}
            {t.major && <text transform={`translate(11 ${t.pos - 3}) rotate(-90)`} fontSize={9} fill="currentColor" className="tnum">{t.label}</text>}
          </g>
        ))}
      </svg>
      <div className="absolute top-0 left-0 border-r border-b bg-background" style={{ width: SIZE, height: SIZE }} />
    </div>
  );
}
