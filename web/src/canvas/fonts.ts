// Browser side of Phase E (fonts). The server keeps the woff2 files; this module gets them onto the screen
// in two different ways, because the canvas draws a board in two different ways:
//  1. Live DOM: one @font-face <style> in the document head. @font-face rules inside a shadow root are
//     ignored by browsers, and boards are shadow roots, but they do inherit the document's font faces.
//  2. Bitmaps (screenshots, zoomed-out snapshots): the SVG foreignObject cannot load any file, so the faces a
//     board actually uses are embedded as base64 data: URIs inside the SVG itself.
import type { ProjectFont } from '@/api/types';

let fonts: ProjectFont[] = [];

const urlOf = (f: ProjectFont, face: ProjectFont['faces'][number]) => `/api/fonts/${f.slug}/${face.file}`;

// Pure: the @font-face rules for some fonts. `src` decides where the file comes from (URL or data: URI).
export function fontFaceCss(list: ProjectFont[], src: (f: ProjectFont, face: ProjectFont['faces'][number]) => string): string {
  return list.flatMap((f) => f.faces.map((face) =>
    // font-display:block hides text briefly instead of flashing the fallback (swap would reflow the board).
    `@font-face{font-family:"${f.family}";font-style:${face.style};font-weight:${face.weight};font-display:block;src:url(${src(f, face)}) format("woff2")}`,
  )).join('');
}

// Stable text for "which fonts does this project have": part of the snapshot cache key, so adding a weight redraws.
export const fontsSignature = () => fonts.map((f) => `${f.family}:${f.faces.map((x) => x.file).join(',')}`).join('|');

// Families whose name appears in a board's HTML (a cheap superset of "used"; an unused embed only costs bytes).
export function usedFonts(html: string, list = fonts): ProjectFont[] {
  const lower = html.toLowerCase();
  return list.filter((f) => lower.includes(f.family.toLowerCase()));
}

let ready: Promise<unknown> = Promise.resolve();

// Called whenever the project's meta arrives. Returns true when the set of fonts changed.
export function setProjectFonts(next: ProjectFont[] | undefined): boolean {
  const list = next ?? [];
  const before = fontsSignature();
  fonts = list;
  if (fontsSignature() === before) return false;
  let tag = document.getElementById('dc-project-fonts') as HTMLStyleElement | null;
  if (!tag) {
    tag = document.createElement('style');
    tag.id = 'dc-project-fonts';
    document.head.appendChild(tag);
  }
  tag.textContent = fontFaceCss(list, urlOf);
  // Start loading now so the first paint of a board that uses it is not blank; failures just leave the fallback.
  ready = Promise.all(list.flatMap((f) => f.faces.map((face) =>
    document.fonts.load(`${face.style} ${face.weight} 16px "${f.family}"`).catch(() => [])),
  ));
  return true;
}

// Measuring and screenshots wait for this so text is laid out with the real font, not the fallback.
export const fontsReady = () => ready;

// ---- data: URIs for the bitmap path --------------------------------------------------
const dataCache = new Map<string, Promise<string>>(); // file url -> data: URI (a face is fetched once per session)

function toDataUri(url: string): Promise<string> {
  let p = dataCache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`font ${url}: HTTP ${r.status}`);
      return r.blob();
    }).then((blob) => new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).replace(/^data:[^;]*;/, 'data:font/woff2;'));
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    }));
    p.catch(() => dataCache.delete(url)); // do not cache a failure: the next snapshot retries
    dataCache.set(url, p);
  }
  return p;
}

// @font-face CSS with embedded files, only for the families this board mentions. '' when it uses none.
export async function embeddedFontCss(html: string): Promise<string> {
  const used = usedFonts(html);
  if (!used.length) return '';
  const uris = new Map<string, string>();
  try {
    await Promise.all(used.flatMap((f) => f.faces.map(async (face) => { uris.set(urlOf(f, face), await toDataUri(urlOf(f, face))); })));
  } catch {
    return ''; // a missing file must not break the whole screenshot: it just shows the fallback font
  }
  return fontFaceCss(used, (f, face) => uris.get(urlOf(f, face))!);
}
