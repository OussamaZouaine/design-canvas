// sRGB hex <-> OKLCH. The project rule is OKLCH everywhere, but the browser's native colour picker only speaks hex,
// so picked colours are converted on the way in. Matrices are Bjorn Ottosson's OKLab reference.

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToOklch(hex: string): string | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => toLinear(parseInt(h.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * mm - 0.8086757660 * s;
  const C = Math.hypot(A, B);
  // Hue is meaningless for greys; 0 keeps the output stable instead of printing noise.
  const hue = C < 0.0004 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return `oklch(${+L.toFixed(3)} ${+C.toFixed(3)} ${+hue.toFixed(1)})`;
}

// Best-effort hex for the native picker's starting value: handles hex and oklch(); anything else (var(), names) is null.
export function toHex(css: string): string | null {
  const t = css.trim();
  if (/^#[0-9a-f]{6}$/i.test(t)) return t;
  const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/[^)]*)?\)$/i.exec(t);
  if (!m) return null;
  const L = parseFloat(m[1]) / (m[2] ? 100 : 1), C = parseFloat(m[3]), hr = (parseFloat(m[4]) * Math.PI) / 180;
  const a = C * Math.cos(hr), b = C * Math.sin(hr);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s];
  // Clamp out-of-gamut channels: the picker can only show sRGB.
  return '#' + lin.map((c) => Math.round(Math.min(1, Math.max(0, toGamma(c))) * 255).toString(16).padStart(2, '0')).join('');
}
