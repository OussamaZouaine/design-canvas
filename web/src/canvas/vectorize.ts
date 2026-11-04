// Real-vector SVG export. The foreignObject SVG (raster.ts boardSvg) keeps HTML inside, so Figma, Illustrator and
// Inkscape show nothing. This walks a laid-out copy of the board and rewrites what it sees as native SVG: boxes become
// <rect>, text becomes <text> (one per line, positions read from the browser's own line layout), pictures become
// <image>, inline <svg> is nested as is. Pure measuring + string building; no React.
//
// Supported: background colour and linear-gradient, uniform and per-side borders, border-radius (one radius per
// corner pair), outer box-shadow, opacity, overflow clip, img (object-fit cover/contain), text (font, size, weight,
// colour, letter-spacing, underline, text-transform), nested inline svg.
// Not supported (dropped, never an error): transforms (the bounding box is used), radial/conic gradients, filters,
// background-clip:text, inset shadows, pseudo-elements, multiple backgrounds.
import { BOARD_CSS, boardRoot } from './contract';
import { embeddedFontCss } from './fonts';
import type { Crop } from './raster';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n: number) => String(Math.round(n * 100) / 100);
const isClear = (c: string) => !c || c === 'transparent' || /^rgba\([^)]*,\s*0\)$/.test(c) || /\/\s*0(\.0+)?%?\s*\)$/.test(c);

// Split on commas that are not inside parentheses ("oklch(0.5 0.1 20), red 40%").
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// CSS linear-gradient(...) -> SVG <linearGradient> defs, or null for anything else (radial, conic, multiple layers).
function gradientDef(id: string, bg: string): string | null {
  const m = /^linear-gradient\((.*)\)$/s.exec(bg.trim());
  if (!m) return null;
  const parts = splitTop(m[1]);
  let angle = 180; // CSS default: to bottom
  if (/^(-?[\d.]+)deg$/.test(parts[0])) angle = parseFloat(parts.shift()!);
  else if (/^to /.test(parts[0])) {
    const dirs: Record<string, number> = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270, 'to top right': 45, 'to right top': 45, 'to bottom right': 135, 'to right bottom': 135, 'to bottom left': 225, 'to left bottom': 225, 'to top left': 315, 'to left top': 315 };
    angle = dirs[parts.shift()!] ?? 180;
  } else if (/^[\d.]+(turn|rad|grad)$/.test(parts[0])) return null;
  const stops = parts.map((p) => {
    const sm = /^(.*?)(?:\s+(-?[\d.]+)%)?$/.exec(p)!;
    return { color: sm[1].trim(), at: sm[2] === undefined ? null : parseFloat(sm[2]) / 100 };
  });
  if (stops.length < 2 || stops.some((s) => /px|em|rem/.test(s.color))) return null;
  stops.forEach((s, i) => { if (s.at === null) s.at = stops.length === 1 ? 0 : i / (stops.length - 1); });
  const a = (angle * Math.PI) / 180, dx = Math.sin(a), dy = -Math.cos(a);
  const g = `x1="${num(0.5 - dx / 2)}" y1="${num(0.5 - dy / 2)}" x2="${num(0.5 + dx / 2)}" y2="${num(0.5 + dy / 2)}"`;
  return `<linearGradient id="${id}" ${g}>${stops.map((s) => `<stop offset="${num(s.at!)}" style="stop-color:${esc(s.color)}"/>`).join('')}</linearGradient>`;
}

async function dataUri(src: string): Promise<string> {
  if (src.startsWith('data:')) return src;
  try {
    const blob = await (await fetch(src)).blob();
    return await new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = no; r.readAsDataURL(blob); });
  } catch { return ''; }
}

let ascentCtx: CanvasRenderingContext2D | null = null;
// Distance from the top of a line's content box to its baseline. SVG <text> is positioned by baseline, while the
// browser reports the content box, and renderers disagree on dominant-baseline, so compute it once here.
function ascentOf(font: string): number {
  ascentCtx ??= document.createElement('canvas').getContext('2d')!;
  ascentCtx.font = font;
  return ascentCtx.measureText('Hg').fontBoundingBoxAscent;
}

const applyTransform = (t: string, cs: CSSStyleDeclaration) => (cs.textTransform === 'uppercase' ? t.toUpperCase() : cs.textTransform === 'lowercase' ? t.toLowerCase() : cs.textTransform === 'capitalize' ? t.replace(/\b\w/g, (c) => c.toUpperCase()) : t);

interface Ctx { ox: number; oy: number; defs: string[]; n: number; clips: number }

// Lines of a text node: group words by the top of their client rect (a wrapped paragraph has one rect row per line).
function textLines(node: Text): { text: string; rect: DOMRect }[] {
  const raw = node.data;
  const lines: { text: string; rect: DOMRect }[] = [];
  const re = /\S+/g;
  const range = document.createRange();
  let m: RegExpExecArray | null;
  let cur: { text: string; rect: DOMRect } | null = null;
  while ((m = re.exec(raw))) {
    range.setStart(node, m.index);
    range.setEnd(node, m.index + m[0].length);
    const r = range.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    if (cur && Math.abs(r.top - cur.rect.top) < r.height / 2) {
      cur.text += ' ' + m[0];
      cur.rect = new DOMRect(cur.rect.left, cur.rect.top, r.right - cur.rect.left, cur.rect.height);
    } else {
      cur = { text: m[0], rect: r };
      lines.push(cur);
    }
  }
  return lines;
}

async function walk(el: Element, c: Ctx, isRoot: boolean): Promise<string> {
  if (!(el instanceof HTMLElement || el instanceof SVGElement)) return '';
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden' && !(el instanceof HTMLElement && el.childElementCount)) return '';
  const r = el.getBoundingClientRect();
  const x = r.left - c.ox, y = r.top - c.oy, w = r.width, h = r.height;
  const visible = cs.visibility !== 'hidden';

  // Inline svg: nested as is, placed by its measured box. Computed colour travels as `color` for currentColor.
  if (el instanceof SVGSVGElement) {
    if (!visible || !w || !h) return '';
    const clone = el.cloneNode(true) as SVGSVGElement;
    for (const n of [clone, ...clone.querySelectorAll('*')]) for (const a of [...n.attributes]) if (a.name.startsWith('data-')) n.removeAttribute(a.name);
    // var(--token) means nothing outside the board: bake the resolved value into attributes and inline styles.
    const origs = [el, ...el.querySelectorAll('*')];
    [clone, ...clone.querySelectorAll('*')].forEach((n, i) => {
      const live = getComputedStyle(origs[i]);
      for (const a of [...n.attributes]) if (a.value.includes('var(')) n.setAttribute(a.name, a.value.replace(/var\((--[\w-]+)(?:,[^)]*)?\)/g, (_, v) => live.getPropertyValue(v).trim() || 'currentColor'));
    });
    clone.setAttribute('x', num(x)); clone.setAttribute('y', num(y)); clone.setAttribute('width', num(w)); clone.setAttribute('height', num(h));
    if (!clone.getAttribute('viewBox') && el.getAttribute('width') && el.getAttribute('height')) clone.setAttribute('viewBox', `0 0 ${parseFloat(el.getAttribute('width')!)} ${parseFloat(el.getAttribute('height')!)}`);
    clone.setAttribute('style', `color:${cs.color}`);
    clone.removeAttribute('xmlns');
    return new XMLSerializer().serializeToString(clone).replace(/ xmlns="[^"]*"/, '');
  }
  if (!(el instanceof HTMLElement)) return '';

  const out: string[] = [];
  const radius = (corner: string) => parseFloat(cs.getPropertyValue(corner)) || 0;
  const rx = Math.min(Math.max(radius('border-top-left-radius'), radius('border-top-right-radius'), radius('border-bottom-left-radius'), radius('border-bottom-right-radius')), w / 2, h / 2);
  const rxAttr = rx ? ` rx="${num(rx)}"` : '';

  if (visible && w > 0 && h > 0) {
    const bgColor = cs.backgroundColor;
    const bgImg = cs.backgroundImage;
    // box-shadow: only outer shadows, one filter each. Parsed as "colour x y blur spread" (Chrome's computed order).
    const shadows = cs.boxShadow !== 'none' ? splitTop(cs.boxShadow).filter((s) => !/inset/.test(s)) : [];
    let filterAttr = '';
    if (shadows.length) {
      const id = `s${c.n++}`;
      const fx = shadows.map((s) => {
        const col = /^(rgba?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|lab\([^)]*\)|color\([^)]*\)|[a-z]+)/.exec(s.trim())?.[0] ?? 'black';
        const nums = (s.replace(col, '').match(/-?[\d.]+px/g) ?? []).map(parseFloat);
        const [dx = 0, dy = 0, blur = 0] = nums;
        return `<feDropShadow dx="${dx}" dy="${dy}" stdDeviation="${num(blur / 2)}" flood-color="${esc(col)}"/>`;
      }).join('');
      c.defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">${fx}</filter>`);
      filterAttr = ` filter="url(#${id})"`;
    }
    const grad = bgImg !== 'none' ? gradientDef(`g${c.n}`, bgImg) : null;
    if (grad) { c.defs.push(grad); }
    const hasFill = !isClear(bgColor);
    if (hasFill || grad) {
      // Gradient sits on top of the colour, like CSS; the shadow filter goes on the first shape only.
      if (hasFill) out.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"${rxAttr} fill="${esc(bgColor)}"${filterAttr}/>`);
      if (grad) out.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"${rxAttr} fill="url(#g${c.n++})"${hasFill ? '' : filterAttr}/>`);
    }
    // Borders: all four equal -> one inset stroke; otherwise a filled strip per side.
    const sides = (['top', 'right', 'bottom', 'left'] as const).map((s) => ({ s, wd: parseFloat(cs.getPropertyValue(`border-${s}-width`)) || 0, st: cs.getPropertyValue(`border-${s}-style`), col: cs.getPropertyValue(`border-${s}-color`) })).filter((b) => b.wd > 0 && b.st !== 'none' && b.st !== 'hidden' && !isClear(b.col));
    if (sides.length === 4 && sides.every((b) => b.wd === sides[0].wd && b.col === sides[0].col)) {
      const b = sides[0], i = b.wd / 2; // a stroke is centred on the edge, so inset by half its width
      const dash = sides[0].st === 'dashed' ? ` stroke-dasharray="${num(b.wd * 3)} ${num(b.wd * 2)}"` : sides[0].st === 'dotted' ? ` stroke-dasharray="${num(b.wd)} ${num(b.wd)}"` : '';
      out.push(`<rect x="${num(x + i)}" y="${num(y + i)}" width="${num(Math.max(0, w - b.wd))}" height="${num(Math.max(0, h - b.wd))}" rx="${num(Math.max(0, rx - i))}" fill="none" stroke="${esc(b.col)}" stroke-width="${num(b.wd)}"${dash}/>`);
    } else {
      for (const b of sides) {
        const [bx, by, bw, bh] = b.s === 'top' ? [x, y, w, b.wd] : b.s === 'bottom' ? [x, y + h - b.wd, w, b.wd] : b.s === 'left' ? [x, y, b.wd, h] : [x + w - b.wd, y, b.wd, h];
        out.push(`<rect x="${num(bx)}" y="${num(by)}" width="${num(bw)}" height="${num(bh)}" fill="${esc(b.col)}"/>`);
      }
    }
    if (el instanceof HTMLImageElement && el.currentSrc) {
      const href = await dataUri(el.currentSrc);
      if (href) {
        const fit = cs.objectFit;
        const par = fit === 'cover' ? 'xMidYMid slice' : fit === 'contain' ? 'xMidYMid meet' : fit === 'fill' || fit === '' ? 'none' : 'xMidYMid meet';
        let clip = '';
        if (fit === 'cover' || rx) { // `slice` overflows its box: clip to the (rounded) box
          const id = `c${c.clips++}`;
          c.defs.push(`<clipPath id="${id}"><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"${rxAttr}/></clipPath>`);
          clip = ` clip-path="url(#${id})"`;
        }
        out.push(`<image x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" href="${esc(href)}" preserveAspectRatio="${par}"${clip}/>`);
      }
    }
  }

  // Children in DOM order: elements recurse, text nodes become <text> lines.
  const kids: string[] = [];
  for (const child of el.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE) kids.push(await walk(child as Element, c, false));
    else if (child.nodeType === Node.TEXT_NODE && visible && !(el instanceof HTMLImageElement)) {
      const fontStyle = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const asc = ascentOf(fontStyle);
      for (const ln of textLines(child as Text)) {
        const letter = parseFloat(cs.letterSpacing);
        const deco = cs.textDecorationLine !== 'none' ? ` text-decoration="${esc(cs.textDecorationLine)}"` : '';
        kids.push(`<text x="${num(ln.rect.left - c.ox)}" y="${num(ln.rect.top - c.oy + asc)}" font-family="${esc(cs.fontFamily)}" font-size="${esc(cs.fontSize)}" font-weight="${esc(cs.fontWeight)}"${cs.fontStyle !== 'normal' ? ` font-style="${esc(cs.fontStyle)}"` : ''} fill="${esc(cs.color)}"${letter ? ` letter-spacing="${num(letter)}"` : ''}${deco} xml:space="preserve">${esc(applyTransform(ln.text, cs))}</text>`);
      }
    }
  }
  let inner = kids.join('');
  const clipsKids = /hidden|clip|auto|scroll/.test(cs.overflowX + cs.overflowY) && !isRoot;
  if (clipsKids && inner) {
    const id = `c${c.clips++}`;
    c.defs.push(`<clipPath id="${id}"><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"${rxAttr}/></clipPath>`);
    inner = `<g clip-path="url(#${id})">${inner}</g>`;
  }
  const body = out.join('') + inner;
  if (!body) return '';
  const label = el.dataset.name ? ` id="${esc(el.dataset.name.replace(/\s+/g, '-'))}"` : '';
  const op = parseFloat(cs.opacity);
  return op < 1 || label ? `<g${label}${op < 1 ? ` opacity="${num(op)}"` : ''}>${body}</g>` : body;
}

// One item as a standalone SVG string. `crop` is the box to export in board units (whole board, or one layer);
// `html` is the board's markup. The board is mounted in a private off-screen shadow root with the same wrapper
// and theme the engine uses, measured, and removed again.
export async function vectorSvg(opts: { html: string; width: number; height: number; fit: boolean; themeDecls: string; crop: Crop; nodeId?: string; scale?: number }): Promise<string> {
  const { html, width, height, fit, themeDecls, crop, nodeId } = opts;
  const fontCss = await embeddedFontCss(html + themeDecls);
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-100000px;top:0;pointer-events:none;contain:strict;width:${width}px;height:${height}px`;
  document.body.appendChild(host);
  try {
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>:host{all:initial;display:block;font-family:system-ui,sans-serif}${BOARD_CSS}</style><style>:host{${themeDecls}}</style>${boardRoot(fit, html)}`;
    // Let pictures finish loading so their boxes and currentSrc are final.
    await Promise.all([...root.querySelectorAll('img')].map((i) => i.decode().catch(() => undefined)));
    const wrap = root.querySelector<HTMLElement>('[data-board-root]')!;
    const base = wrap.getBoundingClientRect();
    const rootEl = nodeId ? root.querySelector<HTMLElement>(`[data-pid="${nodeId.replace(/[^A-Za-z0-9_-]/g, '')}"]`) : wrap;
    if (!rootEl) throw new Error('Node not found for SVG export');
    const c: Ctx = { ox: base.left + crop.x, oy: base.top + crop.y, defs: [], n: 0, clips: 0 };
    const body = await walk(rootEl, c, true);
    const k = opts.scale ?? 1;
    const style = fontCss ? `<style>${fontCss}</style>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(crop.w * k)}" height="${num(crop.h * k)}" viewBox="0 0 ${num(crop.w)} ${num(crop.h)}">${style}${c.defs.length ? `<defs>${c.defs.join('')}</defs>` : ''}${nodeId ? '' : `<rect width="${num(crop.w)}" height="${num(crop.h)}" fill="#fff"/>`}${body}</svg>`;
  } finally {
    host.remove();
  }
}
