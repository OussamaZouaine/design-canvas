// Estimates how many tokens each MCP tool result costs Claude, so we can see which tools
// dominate a session and cut those first. These are estimates, not billing numbers.

// Text is roughly 4 bytes per token. Images cost about width*height/750 tokens (Anthropic's vision docs),
// so we need the pixel size, read straight from the image header.
export function imageSize(base64, mimeType) {
  if (mimeType === 'image/png') {
    const head = Buffer.from(base64.slice(0, 64), 'base64');
    return head.length >= 24 ? { w: head.readUInt32BE(16), h: head.readUInt32BE(20) } : null;
  }
  if (mimeType === 'image/jpeg') return jpegSize(base64);
  return null; // other formats: fall back to a byte-based guess
}

// A JPEG is a chain of segments (FF <marker> <u16 length> ...). The size sits in the SOF0/1/2 frame header,
// which comes after APP/DQT segments of any length (EXIF can be kilobytes), so we walk the chain and decode
// more of the base64 whenever the next segment lies beyond what we have. Chunks stay multiples of 4 chars
// so every slice decodes cleanly on its own.
function jpegSize(base64) {
  let chars = 4096;
  let buf = Buffer.from(base64.slice(0, chars), 'base64');
  if (buf.length < 2 || buf[0] !== 0xff || buf[1] !== 0xd8) return null; // no SOI: not a JPEG
  let i = 2;
  for (;;) {
    // Need marker (2) + length (2) + precision (1) + height (2) + width (2) for a SOF; grow the window if short.
    while (i + 9 > buf.length) {
      if (chars >= base64.length) return null;
      chars *= 4;
      buf = Buffer.from(base64.slice(0, chars), 'base64');
    }
    if (buf[i] !== 0xff) return null; // lost sync: corrupt or unexpected data
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; } // fill byte before a marker
    if (marker >= 0xc0 && marker <= 0xc2) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan with no frame header
    i += 2 + buf.readUInt16BE(i + 2);
  }
}

export function estimateTokens(result) {
  let tokens = 0;
  for (const part of result?.content ?? []) {
    if (part.type === 'text') tokens += Math.ceil(Buffer.byteLength(part.text) / 4);
    else if (part.type === 'image') {
      const size = imageSize(part.data, part.mimeType);
      tokens += size ? Math.ceil((size.w * size.h) / 750) : Math.ceil((part.data.length * 0.75) / 750);
    }
  }
  return tokens;
}

export class Meter {
  constructor() {
    this.startedAt = Date.now();
    this.tools = new Map(); // name -> { calls, tokens, errors }
    this.lastCallAt = null; // MCP is stateless (no open connection), so recent activity is the only "connected" signal
  }

  record(name, result) {
    const t = this.tools.get(name) ?? { calls: 0, tokens: 0, errors: 0 };
    t.calls++;
    t.tokens += estimateTokens(result);
    if (result?.isError) t.errors++;
    this.tools.set(name, t);
    this.lastCallAt = Date.now();
  }

  snapshot() {
    const tools = [...this.tools].map(([name, t]) => ({ name, ...t })).sort((a, b) => b.tokens - a.tokens);
    return { since: this.startedAt, lastCallAt: this.lastCallAt, totalTokens: tools.reduce((n, t) => n + t.tokens, 0), tools };
  }
}
