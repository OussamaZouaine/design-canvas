import { Check, Copy, Pipette, Trash2, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  formatGradient, formatHex, formatOklch, hslToRgb, inGamut, mixOklch, oklchToRgb, parseColor, parseGradient, parseHex,
  rgbToHsl, rgbToOklch, toGamut, toRgb255, type Gradient, type Oklch, type Rgb,
} from '@/lib/color';
import { cn } from '@/lib/utils';
import { NumberField } from '@/ui/NumberField';
import { Tip } from '@/ui/Tip';

// The area's chroma axis ends here: about the most chroma any hue reaches inside Display P3, so the whole usable
// range fits and the sRGB edge shows as a visible boundary inside the area.
const C_MAX = 0.37;
const GREY: Oklch = { l: 0.7, c: 0, h: 0, a: 1 };
const swatchRing = 'outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10';

// A paintable CSS background (colour, gradient, url) for swatches; anything else paints nothing.
export const paintable = (v: string) => typeof CSS !== 'undefined' && CSS.supports('background', v);

// Resolve a colour the pure parser does not know (named colours like `rebeccapurple`, hsl()) by letting a 2D canvas
// normalise it: reading `fillStyle` back gives `#rrggbb` or `rgba(...)`, which parseColor handles.
let probe: CanvasRenderingContext2D | null = null;
function browserColor(css: string): Oklch | null {
  probe ??= document.createElement('canvas').getContext('2d');
  if (!probe || !CSS.supports('color', css)) return null;
  probe.fillStyle = '#000';
  probe.fillStyle = css;
  return parseColor(String(probe.fillStyle));
}
export const partsOf = (css: string, tokens?: Record<string, string>) => parseColor(css, tokens) ?? browserColor(css) ?? GREY;

// Shared pointer handling for the 2D area, the strips and the stop bar: pointer capture keeps a drag alive outside
// the element, and `pick` gets the pointer position as 0..1 fractions of the element's box.
function dragProps(pick: (fx: number, fy: number, e: ReactPointerEvent) => void, done: () => void) {
  const at = (e: ReactPointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    pick(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)), e);
  };
  return {
    onPointerDown: (e: ReactPointerEvent) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); at(e); },
    onPointerMove: (e: ReactPointerEvent) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) at(e); },
    onPointerUp: (e: ReactPointerEvent) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) done(); },
  };
}

// Arrow keys for the sliders (Shift = 10x). Each press is a commit, like NumberField's steps.
const arrows = (e: KeyboardEvent, move: (dx: number, dy: number) => void) => {
  const k = e.shiftKey ? 10 : 1;
  const d = ({ ArrowLeft: [-k, 0], ArrowRight: [k, 0], ArrowUp: [0, -k], ArrowDown: [0, k] } as Record<string, number[]>)[e.key];
  if (d) { e.preventDefault(); move(d[0], d[1]); }
};

// The lightness x chroma plane for one hue, drawn into a small canvas and scaled up (smooth, cheap: about 9k pixels).
// Colours outside sRGB are drawn faded, so the sRGB edge is visible and P3-only colours are still reachable.
function Area({ o, onPick, onDone }: { o: Oklch; onPick: (o: Oklch) => void; onDone: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = cv.current?.getContext('2d');
    if (!ctx) return;
    const W = 96, H = 96, img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = { l: 1 - y / (H - 1), c: (x / (W - 1)) * C_MAX, h: o.h, a: 1 };
        const rgb = oklchToRgb(p), i = (y * W + x) * 4;
        const out = rgb.some((v) => v < -0.0005 || v > 1.0005);
        rgb.forEach((v, j) => { img.data[i + j] = Math.round(Math.min(1, Math.max(0, v)) * 255); });
        img.data[i + 3] = out ? 60 : 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [o.h]);
  const step = (dx: number, dy: number) => { onPick({ ...o, c: Math.min(C_MAX, Math.max(0, o.c + dx * 0.002)), l: Math.min(1, Math.max(0, o.l - dy * 0.01)) }); onDone(); };
  return (
    <div
      role="slider" tabIndex={0} aria-label="Lightness and chroma" aria-valuetext={`L ${Math.round(o.l * 100)}, C ${o.c.toFixed(3)}`}
      className="relative size-44 shrink-0 cursor-crosshair touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-selection"
      {...dragProps((fx, fy) => onPick({ ...o, c: fx * C_MAX, l: 1 - fy }), onDone)}
      onKeyDown={(e) => arrows(e, step)}
    >
      <canvas ref={cv} width={96} height={96} className={cn('dc-checker size-full rounded-md', swatchRing)} />
      <Thumb x={Math.min(1, o.c / C_MAX)} y={1 - o.l} color={formatOklch({ ...o, a: 1 })} />
    </div>
  );
}

// White ring with a dark hairline, readable on any colour (same look as the old range thumbs).
function Thumb({ x, y, color }: { x: number; y: number; color?: string }) {
  return (
    <span
      className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_oklch(0_0_0/0.35)]"
      style={{ left: `${x * 100}%`, top: `${y * 100}%`, background: color }}
    />
  );
}

// A vertical strip (hue or alpha). `value` is 0..1 from top to bottom.
function Strip({ label, value, text, background, checker, onPick, onDone }: {
  label: string; value: number; text: string; background: string; checker?: boolean; onPick: (v: number) => void; onDone: () => void;
}) {
  return (
    <div
      role="slider" tabIndex={0} aria-label={label} aria-orientation="vertical" aria-valuetext={text}
      className={cn('relative h-44 w-3 shrink-0 cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-selection', checker && 'dc-checker', swatchRing)}
      {...dragProps((_, fy) => onPick(fy), onDone)}
      onKeyDown={(e) => arrows(e, (_, dy) => { onPick(Math.min(1, Math.max(0, value + dy / 100))); onDone(); })}
    >
      <span className="absolute inset-0 rounded-full" style={{ background }} />
      <Thumb x={0.5} y={value} />
    </div>
  );
}

function CopyBtn({ label, text }: { label: string; text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Tip label={label}><button
      type="button" aria-label={label}
      onClick={() => { void navigator.clipboard?.writeText(text); setDone(true); window.setTimeout(() => setDone(false), 1000); }}
      className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-[background-color,color,scale] duration-150 active:scale-[0.96] pointer-hover:hover:bg-field-hover pointer-hover:hover:text-foreground"
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button></Tip>
  );
}

interface PickerProps { o: Oklch; onPreview: (o: Oklch) => void; onCommit: (o: Oklch) => void; onCancel: () => void }

const round = (v: number, d = 0) => +v.toFixed(d);

// The solid colour editor: area + hue + alpha, then the numbers. OKLCH is the source of truth; HSL / RGB / hex are
// derived from the gamut-mapped sRGB colour and converted back on edit.
function Picker({ o, onPreview, onCommit, onCancel }: PickerProps) {
  const latest = useRef(o);
  latest.current = o;
  const live = (next: Oklch) => { latest.current = next; onPreview(next); };
  const done = () => onCommit(latest.current);
  const rgb = toRgb255(o);
  const [hh, ss, ll] = rgbToHsl(rgb.map((x) => x / 255) as Rgb);
  const fromRgb = (r: Rgb) => ({ ...rgbToOklch(r), a: o.a });
  const out = !inGamut(o);
  const alphaTxt = o.a < 1 ? ` / ${round(o.a, 2)}` : '';

  // A NumberField wired to one channel: preview while scrubbing, commit on release / Enter.
  const num = (label: string, value: number, step: number, min: number, max: number, set: (v: number) => Oklch) => (
    <NumberField
      key={label} label={<span className="text-[10px]">{label}</span>} title={label} value={value} step={step} min={min} max={max}
      onPreview={(v) => (v === null ? onCancel() : onPreview(set(v)))}
      onChange={(v) => onCommit(set(v))}
    />
  );
  const row = (copyLabel: string, copy: string, cells: ReactNode[]) => (
    <div className="flex items-center gap-1">
      <div className="grid min-w-0 flex-1 grid-cols-3 gap-1">{cells}</div>
      <CopyBtn label={copyLabel} text={copy} />
    </div>
  );
  const hueBg = `linear-gradient(to bottom, ${[0, 60, 120, 180, 240, 300, 360].map((h) => `oklch(0.75 0.15 ${h})`).join(', ')})`;
  const solid = formatOklch({ ...o, a: 1 });

  return (
    <div className="flex gap-3">
      <div className="flex gap-2">
        <Area o={o} onPick={live} onDone={done} />
        <Strip label="Hue" value={o.h / 360} text={`${round(o.h)} degrees`} background={hueBg} onPick={(v) => live({ ...o, h: v * 360 })} onDone={done} />
        <Strip
          label="Alpha" value={1 - o.a} text={`${Math.round(o.a * 100)}%`} checker
          background={`linear-gradient(to bottom, ${solid}, ${formatOklch({ ...o, a: 0 })})`}
          onPick={(v) => live({ ...o, a: round(1 - v, 2) })} onDone={done}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {row('Copy OKLCH', formatOklch(o), [
          num('L', round(o.l * 100, 1), 0.1, 0, 100, (v) => ({ ...o, l: v / 100 })),
          num('C', round(o.c, 3), 0.001, 0, 0.5, (v) => ({ ...o, c: v })),
          num('H', round(o.h, 1), 0.1, 0, 360, (v) => ({ ...o, h: v })),
        ])}
        {row('Copy HSL', `hsl(${round(hh)} ${round(ss)}% ${round(ll)}%${alphaTxt})`, [
          num('H', round(hh), 1, 0, 360, (v) => fromRgb(hslToRgb(v, ss, ll))),
          num('S', round(ss), 1, 0, 100, (v) => fromRgb(hslToRgb(hh, v, ll))),
          num('L', round(ll), 1, 0, 100, (v) => fromRgb(hslToRgb(hh, ss, v))),
        ])}
        {row('Copy RGB', `rgb(${rgb.join(' ')}${alphaTxt})`, [0, 1, 2].map((i) =>
          num('RGB'[i], rgb[i], 1, 0, 255, (v) => fromRgb(rgb.map((x, j) => (j === i ? v : x) / 255) as Rgb)),
        ))}
        <HexRow o={o} onCommit={onCommit} />
        {out && (
          // Out-of-sRGB colours are kept as authored (wide-gamut screens show them); hex/RGB above are the mapped values.
          <div className="flex items-center justify-between gap-2 rounded-md bg-field px-2 py-1 text-[11px] text-muted-foreground">
            <span>Outside sRGB</span>
            <button type="button" className="font-medium text-foreground underline-offset-2 hover:underline" onClick={() => onCommit(toGamut(o))}>Fit to sRGB</button>
          </div>
        )}
      </div>
    </div>
  );
}

// Hex + alpha, the "FFFFFF / 100%" field. An 8-digit hex sets the alpha too.
function HexRow({ o, onCommit }: { o: Oklch; onCommit: (o: Oklch) => void }) {
  const hex = formatHex(o);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const p = draft === null ? null : parseHex(draft);
    if (p) onCommit({ ...p.o, a: p.alpha ?? o.a });
    setDraft(null);
  };
  return (
    <div className="grid grid-cols-[1fr_auto] gap-1">
      <input
        aria-label="Hex" spellCheck={false}
        className="tnum h-7 min-w-0 rounded-md bg-field px-2 text-xs uppercase outline-none transition-colors duration-150 pointer-hover:hover:bg-field-hover focus:ring-1 focus:ring-selection"
        value={draft ?? hex} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setDraft(null); }}
      />
      <NumberField
        key={`a${o.a}`} className="w-20" label={<span className="text-[10px]">A</span>} title="Alpha" unit="%" value={Math.round(o.a * 100)} min={0} max={100}
        onChange={(v) => onCommit({ ...o, a: v / 100 })}
      />
    </div>
  );
}

// Stop bar for a gradient: click the bar to add a stop (colour interpolated in OKLCH), drag a stop to move it, drag
// it well below the bar or press Delete to remove it (a gradient keeps at least two stops).
function StopBar({ g, sel, resolve, onSelect, onPreview, onCommit }: {
  g: Gradient; sel: number; resolve: (css: string) => Oklch;
  onSelect: (i: number) => void; onPreview: (g: Gradient) => void; onCommit: (g: Gradient) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number; g: Gradient; away: boolean } | null>(null);
  const sorted = [...g.stops].sort((a, b) => a.pos - b.pos);
  const remove = (i: number) => { if (g.stops.length > 2) { onCommit({ ...g, stops: g.stops.filter((_, j) => j !== i) }); onSelect(Math.max(0, i - 1)); } };
  const add = (pos: number) => {
    // New stop takes the colour the gradient already shows at that spot, so adding one never changes the picture.
    const after = sorted.findIndex((s) => s.pos >= pos);
    const a = sorted[Math.max(0, after - 1)] ?? sorted[0], b = sorted[after === -1 ? sorted.length - 1 : after];
    const t = b.pos === a.pos ? 0 : (pos - a.pos) / (b.pos - a.pos);
    const next = { ...g, stops: [...g.stops, { color: formatOklch(mixOklch(resolve(a.color), resolve(b.color), t)), pos }] };
    onCommit(next);
    onSelect(next.stops.length - 1);
  };
  const posAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return +Math.min(1, Math.max(0, (clientX - r.left) / r.width)).toFixed(3);
  };
  return (
    <div className="flex flex-col gap-1">
      <div
        ref={bar} aria-label="Gradient stops, click to add" className={cn('dc-checker relative h-6 cursor-copy rounded-md', swatchRing)}
        onPointerDown={(e) => { if (e.target === e.currentTarget || e.target === e.currentTarget.firstChild) add(posAt(e.clientX)); }}
      >
        <span className="absolute inset-0 rounded-md" style={{ background: formatGradient({ ...g, kind: 'linear', angle: 90 }) }} />
        {g.stops.map((s, i) => (
          <button
            key={i} type="button" aria-label={`Stop ${Math.round(s.pos * 100)}%`} aria-pressed={i === sel}
            className={cn(
              'dc-checker absolute top-1/2 h-7 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none overflow-hidden rounded-[4px] border-2 border-white shadow-[0_0_0_1px_oklch(0_0_0/0.35)] outline-none focus-visible:ring-2 focus-visible:ring-selection',
              i === sel && 'shadow-[0_0_0_2px_var(--selection)]',
            )}
            style={{ left: `${s.pos * 100}%` }}
            onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); onSelect(i); drag.current = { i, g, away: false }; }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
              const r = bar.current!.getBoundingClientRect();
              d.away = d.g.stops.length > 2 && e.clientY > r.bottom + 32;
              d.g = { ...g, stops: g.stops.map((x, j) => (j === i ? { ...x, pos: posAt(e.clientX) } : x)) };
              // While "away" the stop previews as removed, so the user sees what letting go will do.
              onPreview(d.away ? { ...d.g, stops: d.g.stops.filter((_, j) => j !== i) } : d.g);
            }}
            onPointerUp={() => {
              const d = drag.current;
              drag.current = null;
              if (!d) return;
              if (d.away) remove(i);
              else if (d.g !== g) onCommit(d.g);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(i); }
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const d = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 0.01);
                onCommit({ ...g, stops: g.stops.map((x, j) => (j === i ? { ...x, pos: +Math.min(1, Math.max(0, x.pos + d)).toFixed(3) } : x)) });
              }
            }}
          >
            <span className="absolute inset-0" style={{ background: paintable(s.color) ? s.color : 'transparent' }} />
          </button>
        ))}
      </div>
    </div>
  );
}

// Popover shell: positions beside the swatch, closes on outside press / Escape, and switches between the solid
// picker and the gradient editor (the gradient's selected stop uses the same picker). Every drag previews on the
// canvas (no server write) and commits once on release, so one gesture is one undo step.
export function ColorPopover({ anchor, start, resolved = start, tokens, onClose, onPreview, onCommit }: {
  // `resolved` = what `start` paints when it is a var(--token) the tokens map cannot resolve (the caller knows).
  anchor: HTMLElement | null; start: string; resolved?: string; tokens?: Record<string, string>;
  onClose: () => void; onPreview?: (v: string | null) => void; onCommit: (v: string) => void;
}) {
  const resolve = (css: string) => partsOf(css, tokens);
  const [grad, setGrad] = useState<Gradient | null>(() => parseGradient(start));
  const [sel, setSel] = useState(0);
  const startSolid = () => parseColor(start, tokens) ?? partsOf(resolved, tokens);
  const [solid, setSolid] = useState<Oklch>(() => (grad ? GREY : startSolid()));
  const [current, setCurrent] = useState(start);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Place the popover beside the swatch: the Design tab sits at the right edge, so it opens to the left, and is
  // clamped to the viewport. useLayoutEffect so it never paints once at the wrong spot.
  useLayoutEffect(() => {
    if (!anchor || !box.current) return;
    const a = anchor.getBoundingClientRect(), b = box.current.getBoundingClientRect();
    const left = a.left - b.width - 12 >= 8 ? a.left - b.width - 12 : Math.min(a.right + 12, window.innerWidth - b.width - 8);
    setPos({ left, top: Math.max(8, Math.min(a.top - 8, window.innerHeight - b.height - 8)) });
  }, [anchor, !!grad]);

  // Close on an outside press or Escape. Pointerdown (not click) so a drag that starts outside also closes it.
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose(); };
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key, true); };
  }, [anchor, onClose]);

  const stop = grad?.stops[Math.min(sel, grad.stops.length - 1)];
  const editing = stop ? resolve(stop.color) : solid;
  // Turn an edited colour into the whole value: the colour itself, or the gradient with the selected stop replaced.
  const build = (o: Oklch) => {
    if (!grad) return { css: formatOklch(o), grad: null };
    const g = { ...grad, stops: grad.stops.map((s, i) => (i === sel ? { ...s, color: formatOklch(o) } : s)) };
    return { css: formatGradient(g), grad: g };
  };
  const apply = (o: Oklch, final: boolean) => {
    const next = build(o);
    if (next.grad) setGrad(next.grad); else setSolid(o);
    setCurrent(next.css);
    if (final) onCommit(next.css); else onPreview?.(next.css);
  };
  const setGradient = (g: Gradient, final: boolean) => {
    setGrad(g);
    const css = formatGradient(g);
    setCurrent(css);
    if (final) onCommit(css); else onPreview?.(css);
  };
  // Previous swatch: put the starting value back (and the editor state with it).
  const revert = () => {
    const g = parseGradient(start);
    setGrad(g); setSel(0); setSolid(g ? GREY : startSolid()); setCurrent(start);
    onCommit(start);
  };
  const eyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;
  const pickScreen = async () => {
    try {
      // EyeDropper API (Chromium only, hence the feature check above); rejects when the user presses Escape.
      const res = await new (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper().open();
      const p = parseHex(res.sRGBHex);
      if (p) apply({ ...p.o, a: editing.a }, true);
    } catch { /* cancelled */ }
  };
  const colourTokens = Object.entries(tokens ?? {});
  const tokenOn = (name: string) => (stop ? stop.color : current) === `var(--${name})`;
  const iconBtn = 'grid size-7 place-items-center rounded-md text-muted-foreground transition-[background-color,color,scale] duration-150 active:scale-[0.96] pointer-hover:hover:bg-field-hover pointer-hover:hover:text-foreground';

  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label="Colour picker"
      // Same entrance as the context menu (120ms fade + scale, off for reduced motion); fixed so panel scrolling can't detach it.
      className="ctx-menu material shadow-float fixed z-50 flex w-[32rem] flex-col gap-3 rounded-xl p-3 text-xs text-popover-foreground"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0 }}
    >
      <div className="flex items-center gap-1">
        <span className="flex-1 text-[13px] font-semibold">{grad ? (grad.kind === 'linear' ? 'Linear gradient' : 'Radial gradient') : 'Colour'}</span>
        {eyeDropper && <Tip label="Pick from screen"><button type="button" aria-label="Pick from screen" className={iconBtn} onClick={pickScreen}><Pipette className="size-3.5" /></button></Tip>}
        <Tip label="Close"><button type="button" aria-label="Close" className={iconBtn} onClick={onClose}><X className="size-3.5" /></button></Tip>
      </div>

      {grad && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <div role="group" className="flex h-7 items-center gap-0.5 rounded-md bg-field p-0.5">
              {(['linear', 'radial'] as const).map((k) => (
                <button
                  key={k} type="button" aria-pressed={grad.kind === k} onClick={() => setGradient({ ...grad, kind: k }, true)}
                  className={cn('h-6 rounded-[5px] px-2 text-muted-foreground transition-[background-color,color] duration-150 pointer-hover:hover:text-foreground', grad.kind === k && 'bg-background text-foreground shadow-sm')}
                >
                  {k === 'linear' ? 'Linear' : 'Radial'}
                </button>
              ))}
            </div>
            {grad.kind === 'linear' && (
              <NumberField
                key={`ang${grad.angle}`} className="w-24" label={<span className="text-[10px]">Angle</span>} title="Gradient angle" unit="°"
                value={round(grad.angle, 1)} step={1} min={-360} max={720}
                onPreview={(v) => (v === null ? onPreview?.(null) : onPreview?.(formatGradient({ ...grad, angle: ((v % 360) + 360) % 360 })))}
                onChange={(v) => setGradient({ ...grad, angle: ((v % 360) + 360) % 360 }, true)}
              />
            )}
            <span className="flex-1" />
            <Tip label="Remove stop"><button
              type="button" aria-label="Remove stop" disabled={grad.stops.length <= 2} className={cn(iconBtn, 'disabled:pointer-events-none disabled:opacity-40')}
              onClick={() => { setGradient({ ...grad, stops: grad.stops.filter((_, j) => j !== sel) }, true); setSel(Math.max(0, sel - 1)); }}
            ><Trash2 className="size-3.5" /></button></Tip>
          </div>
          <StopBar
            g={grad} sel={sel} resolve={resolve} onSelect={setSel}
            onPreview={(g) => onPreview?.(formatGradient(g))}
            onCommit={(g) => setGradient(g, true)}
          />
          {stop && (
            <NumberField
              key={`pos${sel}:${stop.pos}`} className="w-28" label={<span className="text-[10px]">Stop</span>} title="Stop position" unit="%"
              value={round(stop.pos * 100, 1)} min={0} max={100}
              onChange={(v) => setGradient({ ...grad, stops: grad.stops.map((s, i) => (i === sel ? { ...s, pos: v / 100 } : s)) }, true)}
            />
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-1">
        <button type="button" aria-label="Previous colour, click to restore" onClick={revert} className={cn('dc-checker relative h-8 overflow-hidden rounded-l-md', swatchRing)}>
          <span className="absolute inset-0" style={{ background: paintable(resolved) ? resolved : 'transparent' }} />
        </button>
        <div className={cn('dc-checker relative h-8 overflow-hidden rounded-r-md', swatchRing)}>
          <span className="absolute inset-0" style={{ background: paintable(current) ? current : 'transparent' }} />
        </div>
        <span className="text-center text-[11px] text-muted-foreground">Previous</span>
        <span className="text-center text-[11px] text-muted-foreground">New</span>
      </div>

      <Picker
        // Remount per stop so the hex draft and NumberField state never carry over from another stop.
        key={grad ? `stop${sel}` : 'solid'}
        o={editing}
        onPreview={(o) => apply(o, false)}
        onCommit={(o) => apply(o, true)}
        onCancel={() => onPreview?.(null)}
      />

      {colourTokens.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">Tokens</span>
          <div className="grid max-h-28 grid-cols-12 gap-1 overflow-y-auto">
            {colourTokens.map(([name, val]) => (
              <Tip key={name} label={name}><button
                type="button" aria-label={`Use token ${name}`} aria-pressed={tokenOn(name)}
                onClick={() => {
                  const ref = `var(--${name})`;
                  if (!grad) { onCommit(ref); onClose(); return; }
                  // In a gradient the token goes on the selected stop and stays linked (written as var()).
                  setGradient({ ...grad, stops: grad.stops.map((s, i) => (i === sel ? { ...s, color: ref } : s)) }, true);
                }}
                className={cn('dc-checker relative size-7 overflow-hidden rounded-md', swatchRing, tokenOn(name) && 'ring-2 ring-selection')}
              >
                <span className="absolute inset-0" style={{ background: paintable(val) ? val : 'transparent' }} />
              </button></Tip>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
