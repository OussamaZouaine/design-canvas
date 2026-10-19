// Estimates how many tokens each MCP tool result costs Claude, so we can see which tools
// dominate a session and cut those first. These are estimates, not billing numbers.

// Text is roughly 4 bytes per token. Images cost one token per 28x28-pixel patch
// (Anthropic's vision docs), so we need the pixel size, read straight from the image header.
export function imageSize(base64, mimeType) {
  const head = Buffer.from(base64.slice(0, 64), 'base64');
  if (mimeType === 'image/png' && head.length >= 24) return { w: head.readUInt32BE(16), h: head.readUInt32BE(20) };
  return null; // other formats: fall back to a byte-based guess
}

export function estimateTokens(result) {
  let tokens = 0;
  for (const part of result?.content ?? []) {
    if (part.type === 'text') tokens += Math.ceil(Buffer.byteLength(part.text) / 4);
    else if (part.type === 'image') {
      const size = imageSize(part.data, part.mimeType);
      tokens += size ? Math.ceil(size.w / 28) * Math.ceil(size.h / 28) : Math.ceil((part.data.length * 0.75) / 750);
    }
  }
  return tokens;
}

export class Meter {
  constructor() {
    this.startedAt = Date.now();
    this.tools = new Map(); // name -> { calls, tokens, errors }
  }

  record(name, result) {
    const t = this.tools.get(name) ?? { calls: 0, tokens: 0, errors: 0 };
    t.calls++;
    t.tokens += estimateTokens(result);
    if (result?.isError) t.errors++;
    this.tools.set(name, t);
  }

  snapshot() {
    const tools = [...this.tools].map(([name, t]) => ({ name, ...t })).sort((a, b) => b.tokens - a.tokens);
    return { since: this.startedAt, totalTokens: tools.reduce((n, t) => n + t.tokens, 0), tools };
  }
}
