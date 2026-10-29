// Minimal "store" (no compression) zip writer for exports: PNG/JPG/PDF are already compressed, so deflate would
// only cost time. Pure (no DOM, no imports) so node:test can load it. Names are UTF-8 (flag bit 11).
let table: Uint32Array | null = null;
export function crc32(data: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry { name: string; data: Uint8Array }

export function makeZip(entries: ZipEntry[], date = new Date()): Uint8Array {
  const enc = new TextEncoder();
  // MS-DOS time/date; years before 1980 cannot be stored.
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = (Math.max(0, date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: DataView, o: number, n: number) => v.setUint16(o, n, true);
  const u32 = (v: DataView, o: number, n: number) => v.setUint32(o, n, true);
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50); u16(lv, 4, 20); u16(lv, 6, 0x0800); u16(lv, 8, 0); u16(lv, 10, dosTime); u16(lv, 12, dosDate);
    u32(lv, 14, crc); u32(lv, 18, e.data.length); u32(lv, 22, e.data.length); u16(lv, 26, name.length); u16(lv, 28, 0);
    local.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    u32(cv, 0, 0x02014b50); u16(cv, 4, 20); u16(cv, 6, 20); u16(cv, 8, 0x0800); u16(cv, 10, 0); u16(cv, 12, dosTime); u16(cv, 14, dosDate);
    u32(cv, 16, crc); u32(cv, 20, e.data.length); u32(cv, 24, e.data.length); u16(cv, 28, name.length);
    u32(cv, 42, offset);
    cd.set(name, 46);
    chunks.push(local, e.data);
    central.push(cd);
    offset += local.length + e.data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50); u16(ev, 8, entries.length); u16(ev, 10, entries.length); u32(ev, 12, cdSize); u32(ev, 16, offset);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}
