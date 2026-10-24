// Markup for the vector shape tools (rectangle, ellipse, line). A shape is one plain inline <svg> positioned
// absolutely inside its board, so Claude, the Layers panel and export all treat it like any other node.
//
// Design choices worth knowing:
// - viewBox is the drawn size in px and preserveAspectRatio is "none", so resizing the svg (handles, W/H fields,
//   which set CSS width/height) stretches the shape instead of letterboxing it.
// - vector-effect non-scaling-stroke keeps the outline width constant while it is stretched.
// - Paint (fill, stroke...) sits on the <svg> root and the shape inherits it. The root is what the user selects
//   (data-shape marks it, see the engine's pointer handler), so the Inspector only ever edits one element.
export type ShapeKind = 'rect' | 'ellipse' | 'line';

export interface ShapeBox { x: number; y: number; w: number; h: number; flipX?: boolean; flipY?: boolean }

// Defaults are OKLCH like every colour in the app; ellipse and rect share a soft blue, a line is just a dark stroke.
const FILL = 'oklch(0.85 0.06 255)';
const STROKE = 'oklch(0.45 0.12 255)';
const NAMES: Record<ShapeKind, string> = { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line' };

const n = (v: number) => Math.round(v * 100) / 100;

export function shapeHtml(kind: ShapeKind, box: ShapeBox): string {
  // A line can be perfectly horizontal or vertical; a zero-size svg would not render, so the box is at least 1px.
  const w = Math.max(1, Math.round(box.w)), h = Math.max(1, Math.round(box.h));
  const paint = kind === 'line'
    ? `fill="none" stroke="${STROKE}" stroke-width="2" stroke-linecap="round"`
    : `fill="${FILL}" stroke="${STROKE}" stroke-width="2"`;
  const ve = 'vector-effect="non-scaling-stroke"';
  let shape: string;
  if (kind === 'rect') shape = `<rect width="${w}" height="${h}" ${ve}/>`;
  else if (kind === 'ellipse') shape = `<ellipse cx="${n(w / 2)}" cy="${n(h / 2)}" rx="${n(w / 2)}" ry="${n(h / 2)}" ${ve}/>`;
  else {
    // Dragging right-to-left or bottom-to-top runs the line along the other diagonal of its box.
    const [x1, x2] = box.flipX ? [w, 0] : [0, w];
    const [y1, y2] = box.flipY ? [h, 0] : [0, h];
    shape = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${ve}/>`;
  }
  const style = `position:absolute;left:${Math.round(box.x)}px;top:${Math.round(box.y)}px;width:${w}px;height:${h}px;overflow:visible`;
  return `<svg data-shape="${kind}" data-name="${NAMES[kind]}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" ${paint} style="${style}">${shape}</svg>`;
}
