// Tiny PDF writer: one page per JPEG, the page as big as the image in points (1 px = 1 pt). Raster only: the browser
// render path yields bitmaps, and vector PDF would need Chrome's print pipeline (a later follow-up).
// Pure (no DOM, no imports) so node:test can load it.
export interface PdfPage { jpeg: Uint8Array; width: number; height: number }

export function makePdf(pages: PdfPage[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let len = 0;
  const push = (b: Uint8Array | string) => { const u = typeof b === 'string' ? enc.encode(b) : b; parts.push(u); len += u.length; };
  // Object numbers: 1 catalog, 2 page tree, then per page: page, content, image.
  const obj = (n: number, body: (Uint8Array | string)[]) => { offsets[n] = len; push(`${n} 0 obj\n`); body.forEach(push); push('\nendobj\n'); };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(2, [`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`]);
  pages.forEach((p, i) => {
    const n = 3 + i * 3;
    const content = `q ${p.width} 0 0 ${p.height} 0 0 cm /Im0 Do Q`;
    obj(n, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.width} ${p.height}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`]);
    obj(n + 1, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
    obj(n + 2, [`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`, p.jpeg, '\nendstream']);
  });
  const count = 3 + pages.length * 3;
  const xref = len;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(len);
  let p = 0;
  for (const c of parts) { out.set(c, p); p += c.length; }
  return out;
}
