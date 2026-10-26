// capture_url: copy a live web page into an artboard. The canvas tab cannot do this (cross-origin pages
// cannot be read from it), so we drive a throwaway headless Chrome/Edge over the DevTools protocol (CDP):
// navigate, run EXTRACT_SCRIPT inside the page to turn the laid-out DOM into flat, inline-styled
// markup, and take a screenshot to keep as a reference picture. Node 22+ ships a global WebSocket, so
// there is no npm dependency. Everything that leaves this module still goes through the normal
// sanitizer (Doc.writeHtml); the checks below only decide which pages we are willing to open at all.
import { spawn } from 'node:child_process';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { findBrowser } from './headless.mjs';
import { PRUNE_SCRIPT, PRUNE_LIMITS, formatReport } from './cssreport.mjs';

export const LIMITS = { maxNodes: 3000, maxHtmlBytes: 1_500_000, maxHeight: 12_000, navTimeoutMs: 25_000 };

// ---- which targets we will open ---------------------------------------------------------------

// Loopback, private, link-local (cloud metadata lives at 169.254.169.254), CGNAT and other non-public ranges.
export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v); // IPv4-mapped: judge the embedded address
    if (mapped) return isPrivateIp(mapped[1]);
    return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
  }
  return true; // not an IP at all: treat as unsafe
}

// Throws unless the URL is plain http(s) to a public host (or allowPrivate was asked for explicitly).
// Returns the parsed URL. `lookup` is injectable for tests.
export async function checkTarget(raw, { allowPrivate = false, lookup = (h) => dns.lookup(h, { all: true }) } = {}) {
  let u;
  try { u = new URL(raw); } catch { throw new Error(`Not a valid URL: ${raw}`); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only http and https URLs can be captured');
  if (u.username || u.password) throw new Error('URLs with a user name or password are not accepted');
  if (!allowPrivate) await assertPublicHost(u.hostname, lookup);
  return u;
}

export async function assertPublicHost(hostname, lookup = (h) => dns.lookup(h, { all: true })) {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('Refusing localhost (pass allow_private: true if you really mean a local page)');
  const ips = net.isIP(host) ? [host] : (await lookup(host)).map((r) => r.address);
  if (!ips.length) throw new Error(`Could not resolve ${host}`);
  if (ips.some(isPrivateIp)) throw new Error(`Refusing ${host}: it points at a private or local network address (pass allow_private: true if you really mean it)`);
}

// ---- the script that runs inside the page -------------------------------------------------------

// Walks the laid-out DOM and returns { title, width, height, html, nodes, truncated }. The output uses only
// div / span / img / svg / br with inline styles: the sanitizer strips <style>/<link>, so a copy can only
// keep a page's look by baking the computed styles in. Semantics (headings, lists, links) are given up on purpose.
// Written as a function so it is syntax-checked with the rest of the file, then sent as source text.
function extractInPage(limits) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const attr = (s) => esc(s).replace(/"/g, '&quot;');
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'META', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'HEAD', 'TITLE', 'BASE', 'AUDIO', 'MAP', 'DIALOG']);
  // Inherited properties: only written when they differ from the parent, which keeps the markup small.
  const INHERITED = ['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'white-space', 'visibility', 'cursor'];
  // Not inherited: written unless equal to the initial value.
  const OWN = {
    'flex-direction': 'row', 'flex-wrap': 'nowrap', 'justify-content': 'normal', 'align-items': 'normal', 'align-content': 'normal', 'align-self': 'auto',
    'flex-grow': '0', 'flex-shrink': '1', 'flex-basis': 'auto', order: '0', 'row-gap': 'normal', 'column-gap': 'normal',
    'grid-template-columns': 'none', 'grid-template-rows': 'none', 'grid-column-start': 'auto', 'grid-column-end': 'auto', 'grid-row-start': 'auto', 'grid-row-end': 'auto', 'grid-auto-flow': 'row',
    'background-color': 'rgba(0, 0, 0, 0)', 'background-image': 'none', 'background-size': 'auto', 'background-position': '0% 0%', 'background-repeat': 'repeat',
    'border-top-left-radius': '0px', 'border-top-right-radius': '0px', 'border-bottom-right-radius': '0px', 'border-bottom-left-radius': '0px',
    'box-shadow': 'none', opacity: '1', transform: 'none', float: 'none', clear: 'none', 'z-index': 'auto', 'text-decoration-line': 'none', 'text-overflow': 'clip',
    'border-spacing': '0px 0px', 'border-collapse': 'separate', 'object-fit': 'fill', 'vertical-align': 'baseline', 'overflow-x': 'visible', 'overflow-y': 'visible', 'list-style-type': 'disc',
  };
  const cs = (el, pseudo) => getComputedStyle(el, pseudo);
  const root = document.documentElement;
  let nodes = 0, bytes = 0, truncated = false;

  function styleOf(el, style, parentStyle, forceBlockSize) {
    const out = [];
    const put = (k, v) => { if (v !== '' && v != null) out.push(`${k}:${v}`); };
    const pos = style.position === 'fixed' ? 'absolute' : style.position === 'sticky' ? 'relative' : style.position; // fixed would pin to the canvas, not the board
    if (pos !== 'static') {
      put('position', pos);
      for (const s of ['top', 'right', 'bottom', 'left']) if (style[s] !== 'auto') put(s, style[s]);
    }
    for (const p of INHERITED) if (!parentStyle || style.getPropertyValue(p) !== parentStyle.getPropertyValue(p)) put(p, style.getPropertyValue(p).replace(/"/g, "'"));
    for (const [p, init] of Object.entries(OWN)) {
      const v = style.getPropertyValue(p);
      if (v && v !== init) put(p, v.replace(/"/g, "'"));
    }
    // Box model: always explicit, because the UA defaults of the original tag (a heading's margin) do not carry over to a div.
    put('margin', ['top', 'right', 'bottom', 'left'].map((s) => style.getPropertyValue(`margin-${s}`)).join(' '));
    put('padding', ['top', 'right', 'bottom', 'left'].map((s) => style.getPropertyValue(`padding-${s}`)).join(' '));
    const sides = ['top', 'right', 'bottom', 'left'].map((s) => ({ w: style.getPropertyValue(`border-${s}-width`), st: style.getPropertyValue(`border-${s}-style`), c: style.getPropertyValue(`border-${s}-color`) }));
    for (const [i, s] of ['top', 'right', 'bottom', 'left'].entries()) {
      const b = sides[i];
      if (b.st !== 'none' && b.st !== 'hidden' && parseFloat(b.w) > 0) put(`border-${s}`, `${b.w} ${b.st} ${b.c}`);
    }
    put('box-sizing', 'border-box');
    const ov = style.overflowX !== 'visible' || style.overflowY !== 'visible';
    if (ov) put('overflow', style.overflowX === style.overflowY ? style.overflowX : `${style.overflowX} ${style.overflowY}`);
    // Size: widths of laid-out boxes are baked in so wrapping matches the captured viewport. Heights only where content cannot decide them.
    if (el instanceof HTMLElement) {
      const d = style.display;
      if (d !== 'inline' && d !== 'contents' && d !== 'none' && !/^table-(row|row-group|header-group|footer-group)$/.test(d)) put('width', `${el.offsetWidth}px`);
      const empty = !el.firstChild;
      if (forceBlockSize || ov || empty) if (el.offsetHeight) put('height', `${el.offsetHeight}px`);
    }
    return out.join(';');
  }

  // Text added by ::before / ::after (icon glyphs, quote marks). Only plain string content is kept.
  function pseudoText(el, which) {
    const c = cs(el, which).content;
    const m = /^"((?:[^"\\]|\\.)*)"$/.exec(c);
    if (!m || !m[1] || m[1].trim() === '') return '';
    return `<span>${esc(m[1].replace(/\\(.)/g, '$1'))}</span>`;
  }

  function visit(el, parentStyle) {
    if (nodes >= limits.maxNodes || bytes >= limits.maxHtmlBytes) { truncated = true; return ''; }
    if (SKIP.has(el.tagName)) return '';
    const style = cs(el);
    if (style.display === 'none') return '';
    nodes++;
    const tag = el.tagName.toLowerCase();

    if (tag === 'svg' || el instanceof SVGSVGElement) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return '';
      const clone = el.cloneNode(true);
      clone.querySelectorAll('script,style,foreignObject').forEach((n) => n.remove());
      // Presentation comes from page CSS, which the copy does not have: bake fill / stroke into attributes.
      const live = [el, ...el.querySelectorAll('*')], copy = [clone, ...clone.querySelectorAll('*')];
      live.forEach((src, i) => {
        const dst = copy[i];
        if (!dst || !dst.setAttribute) return;
        const s = cs(src);
        dst.setAttribute('fill', s.fill);
        if (s.stroke !== 'none') { dst.setAttribute('stroke', s.stroke); dst.setAttribute('stroke-width', s.strokeWidth); }
      });
      clone.setAttribute('width', Math.round(r.width));
      clone.setAttribute('height', Math.round(r.height));
      if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const html = clone.outerHTML;
      bytes += html.length;
      return html.length > 60_000 ? '' : html; // a huge illustration would swamp the board
    }
    if (tag === 'br') return '<br>';
    if (tag === 'img') {
      const src = el.currentSrc || el.src || '';
      if (!/^https?:/i.test(src) && !(/^data:image\//i.test(src) && src.length < 30_000)) return '';
      const r = el.getBoundingClientRect();
      const html = `<img src="${attr(src)}" alt="${attr(el.alt || '')}" style="${attr(styleOf(el, style, parentStyle, true))};height:${Math.round(r.height)}px">`;
      bytes += html.length;
      return html;
    }

    let inner = '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      // Form controls cannot be copied (the sanitizer drops forms and their behaviour); keep what they show.
      const shown = tag === 'select' ? (el.selectedOptions[0]?.textContent ?? '') : (el.value || el.placeholder || '');
      if (el.type === 'hidden') return '';
      inner = esc(String(shown));
    } else {
      inner += pseudoText(el, '::before');
      for (const n of el.childNodes) {
        if (n.nodeType === 3) {
          // Whitespace-only text between blocks is noise; between inline items it matters, so keep a single space.
          const t = n.nodeValue;
          if (t.trim() || /^(inline|inline-block|inline-flex)$/.test(style.display)) { inner += esc(t); bytes += t.length; }
        } else if (n.nodeType === 1) inner += visit(n, style);
      }
      inner += pseudoText(el, '::after');
    }
    const asSpan = style.display === 'inline';
    const t = asSpan ? 'span' : 'div';
    const css = styleOf(el, style, parentStyle, false) + (asSpan ? '' : `;display:${style.display}`);
    const html = `<${t} style="${attr(css)}">${inner}</${t}>`;
    bytes += html.length - inner.length;
    return html;
  }

  // The page background lives on <html> or <body>; the wrapper carries it so the copy has the same canvas colour.
  const bodyStyle = cs(document.body), rootStyle = cs(root);
  const bg = bodyStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' ? bodyStyle.backgroundColor : rootStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' ? rootStyle.backgroundColor : '#fff';
  const width = root.clientWidth;
  const height = Math.min(Math.max(document.body.scrollHeight, root.scrollHeight), limits.maxHeight);
  const body = visit(document.body, rootStyle);
  return {
    title: document.title || location.hostname,
    finalUrl: location.href,
    width, height, nodes, truncated,
    html: `<div style="position:relative;width:${width}px;min-height:${height}px;background:${attr(bg)};overflow:hidden">${body}</div>`,
  };
}
export const EXTRACT_SCRIPT = (limits = LIMITS) => `(${extractInPage.toString()})(${JSON.stringify(limits)})`;

// ---- driving the browser ----------------------------------------------------------------------

// Minimal CDP client over the global WebSocket: send(method, params) -> result, and on(event, fn).
class Cdp {
  constructor(ws) {
    this.ws = ws; this.nextId = 1; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener('message', (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) for (const fn of this.handlers.get(msg.method) || []) fn(msg.params);
    });
    ws.addEventListener('close', () => { for (const p of this.pending.values()) p.reject(new Error('Browser connection closed')); this.pending.clear(); });
  }
  static open(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new Cdp(ws)));
      ws.addEventListener('error', () => reject(new Error('Could not connect to the headless browser')));
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(event, fn) { (this.handlers.get(event) ?? this.handlers.set(event, []).get(event)).push(fn); }
  close() { try { this.ws.close(); } catch { /* already closed */ } }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Start the browser on a private profile with a debugging port the OS picks (port 0): Chrome then writes the
// port into DevToolsActivePort inside the profile, which avoids guessing a free port.
async function launch(browser) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-capture-'));
  const child = spawn(browser, [
    '--headless=new', `--user-data-dir=${dir}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--mute-audio', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  let exited = false;
  child.on('exit', () => { exited = true; });
  const file = path.join(dir, 'DevToolsActivePort');
  for (let i = 0; i < 100; i++) {
    if (exited) break;
    if (fs.existsSync(file)) {
      const port = Number(fs.readFileSync(file, 'utf8').split('\n')[0]);
      if (port) return { child, dir, port };
    }
    await sleep(150);
  }
  stopBrowser({ child, dir });
  throw new Error('The headless browser did not start');
}

function stopBrowser({ child, dir }) {
  try { child.kill(); } catch { /* gone */ }
  // Chrome lets go of the profile a moment after it exits.
  setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* temp cleaner */ } }, 1500).unref?.();
}

let busy = false; // one capture at a time: each one is a whole browser process

// Load `rawUrl` at `width` px and return { title, finalUrl, width, height, html, nodes, truncated, screenshot: Buffer, mime }.
// Every request the page makes (including redirects and images) is checked against the same public-host rule.
export async function captureUrl(rawUrl, { width = 1280, allowPrivate = false, browser = findBrowser(), timeoutMs = LIMITS.navTimeoutMs, lookup, pruneCss = false } = {}) {
  if (process.env.DC_HEADLESS === '0') throw new Error('Headless browser is disabled (DC_HEADLESS=0)');
  if (!browser) throw new Error('No Chrome or Edge found (set DC_BROWSER to its path)');
  const target = await checkTarget(rawUrl, { allowPrivate, lookup });
  if (busy) throw new Error('Another capture is still running, try again in a moment');
  busy = true;
  let proc, cdp;
  const deadline = Date.now() + timeoutMs;
  try {
    proc = await launch(browser);
    const list = await (await fetch(`http://127.0.0.1:${proc.port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    if (!page) throw new Error('The headless browser opened no page');
    cdp = await Cdp.open(page.webSocketDebuggerUrl);

    // Gate every request through the host check (cached per host), so a redirect or a subresource cannot reach a private network.
    const verdicts = new Map();
    const allowed = (host) => {
      if (allowPrivate) return Promise.resolve(true);
      if (!verdicts.has(host)) verdicts.set(host, assertPublicHost(host, lookup).then(() => true, () => false));
      return verdicts.get(host);
    };
    cdp.on('Fetch.requestPaused', async (e) => {
      let ok = false;
      try {
        const u = new URL(e.request.url);
        ok = (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') || (/^https?:$/.test(u.protocol) && await allowed(u.hostname));
      } catch { /* unparsable: blocked */ }
      cdp.send(ok ? 'Fetch.continueRequest' : 'Fetch.failRequest', ok ? { requestId: e.requestId } : { requestId: e.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
    });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });

    const loaded = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve));
    const nav = await cdp.send('Page.navigate', { url: target.href });
    if (nav.errorText) throw new Error(`Could not load the page: ${nav.errorText}`);
    // A page that never finishes loading (long polling, a stuck ad) still gets captured with what has arrived.
    await Promise.race([loaded, sleep(Math.max(1000, deadline - Date.now()))]);

    // Scroll to the bottom and back so lazy-loaded images start, then give them a moment to arrive.
    const evalJs = async (expression) => {
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(`Page script failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      return r.result.value;
    };
    await evalJs('(async()=>{const h=document.documentElement.scrollHeight;for(let y=0;y<Math.min(h,8000);y+=700){scrollTo(0,y);await new Promise(r=>setTimeout(r,60));}scrollTo(0,0);await new Promise(r=>setTimeout(r,500));})()');

    const result = await evalJs(EXTRACT_SCRIPT());
    // Re-check where we ended up: a redirect to a private host would have been blocked above, but say so clearly.
    if (!allowPrivate) await assertPublicHost(new URL(result.finalUrl).hostname, lookup);

    // Optional CSS report (never touches the markup). The in-page scan has its own 5 s deadline; the race is a
    // second guard for a page that hangs the evaluate itself. Any failure just skips the report.
    let cssReport;
    if (pruneCss) {
      try {
        const raw = await Promise.race([evalJs(PRUNE_SCRIPT()), sleep(PRUNE_LIMITS.serverMs).then(() => { throw new Error('timed out'); })]);
        cssReport = formatReport(raw);
      } catch (e) { cssReport = { skipped: `CSS scan failed: ${e.message}` }; }
    }

    const shot = async (format) => {
      const clip = { x: 0, y: 0, width: result.width, height: result.height, scale: 1 };
      const { data } = await cdp.send('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality: 85 } : {}), captureBeyondViewport: true, clip });
      return Buffer.from(data, 'base64');
    };
    let screenshot = await shot('png'), mime = 'image/png';
    if (screenshot.length > 8_000_000) { screenshot = await shot('jpeg'); mime = 'image/jpeg'; } // addReference caps images at 10 MB
    return { ...result, screenshot, mime, ...(cssReport && { cssReport }) };
  } finally {
    cdp?.close();
    if (proc) stopBrowser(proc);
    busy = false;
  }
}
