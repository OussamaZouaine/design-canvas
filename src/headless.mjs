// Headless render worker: when Claude asks for a screenshot / layout measure and no browser tab has the
// project open, start a headless Chrome or Edge that loads the normal canvas page (/p/<id>?headless=1).
// That page connects over SSE like any tab, so every askBrowser handler works unchanged. No new npm
// dependency and no DevTools protocol: we only spawn the browser the machine already has.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Where a Chromium-family browser usually lives. DC_BROWSER overrides (full path to the executable).
const CANDIDATES = {
  win32: [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'],
};

export function findBrowser(env = process.env, platform = process.platform) {
  if (env.DC_BROWSER) return fs.existsSync(env.DC_BROWSER) ? env.DC_BROWSER : null;
  return (CANDIDATES[platform] || []).find((p) => fs.existsSync(p)) || null;
}

export class HeadlessWorker {
  // hasTab(projectId): is a tab (any kind) already connected for that project?
  // port: the server port. idleMs: kill a worker nobody asked anything of for this long.
  constructor({ port, hasTab, idleMs = 120_000, browser = findBrowser() }) {
    this.port = port;
    this.hasTab = hasTab;
    this.idleMs = idleMs;
    this.browser = browser;
    this.procs = new Map(); // projectId -> { child, dir, timer, ready }
    this.disabled = process.env.DC_HEADLESS === '0';
  }

  get available() {
    return !this.disabled && !!this.browser;
  }

  // Make sure some tab is connected for the project. Resolves once it is; rejects with a readable reason.
  // Concurrent callers (screenshot + measure in one turn) share one launch through the stored `ready` promise.
  async ensure(projectId, timeoutMs = 20_000) {
    if (this.hasTab(projectId)) { this.touch(projectId); return; }
    if (!this.available) {
      throw new Error(this.disabled ? 'Headless worker is disabled (DC_HEADLESS=0)' : 'No Chrome or Edge found for the headless worker (set DC_BROWSER to its path)');
    }
    // After a failed launch, fail fast for a minute so every later tool call does not wait out the timeout again.
    if (Date.now() - (this.lastFail ?? 0) < 60_000) throw new Error('Headless browser failed to start a moment ago');
    let w = this.procs.get(projectId);
    if (!w) {
      w = this.launch(projectId, timeoutMs);
      this.procs.set(projectId, w);
    }
    try {
      await w.ready;
    } catch (e) {
      this.lastFail = Date.now();
      throw e;
    }
    this.touch(projectId);
  }

  launch(projectId, timeoutMs) {
    // A private profile per worker: no lock clash with the user's own browser, nothing left behind (removed on stop).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-headless-'));
    const child = spawn(
      this.browser,
      [
        '--headless=new',
        `--user-data-dir=${dir}`,
        '--window-size=1600,1000',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        // Headless pages are never "occluded", but keep timers and rendering at full speed anyway.
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        `http://localhost:${this.port}/p/${projectId}?headless=1`,
      ],
      { stdio: 'ignore', windowsHide: true },
    );
    const w = { child, dir, timer: null, ready: null };
    w.ready = new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = setInterval(() => {
        if (this.hasTab(projectId)) { clearInterval(poll); resolve(); }
        else if (Date.now() - started > timeoutMs) {
          clearInterval(poll);
          this.stop(projectId);
          reject(new Error('Headless browser did not connect in time (is web/dist built? run pnpm build:web)'));
        }
      }, 150);
      child.on('error', (e) => { clearInterval(poll); this.stop(projectId); reject(e); });
      child.on('exit', () => { clearInterval(poll); this.cleanup(projectId, w); reject(new Error('Headless browser exited early')); });
    });
    // A rejection nobody awaits (caller timed out first) must not crash the server.
    w.ready.catch(() => {});
    return w;
  }

  // Each use postpones the idle shutdown.
  touch(projectId) {
    const w = this.procs.get(projectId);
    if (!w) return;
    clearTimeout(w.timer);
    w.timer = setTimeout(() => this.stop(projectId), this.idleMs);
    w.timer.unref?.();
  }

  cleanup(projectId, w) {
    clearTimeout(w.timer);
    if (this.procs.get(projectId) === w) this.procs.delete(projectId);
    try { fs.rmSync(w.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* profile still locked: the OS temp cleaner gets it */ }
  }

  stop(projectId) {
    const w = this.procs.get(projectId);
    if (!w) return;
    this.procs.delete(projectId);
    clearTimeout(w.timer);
    try { w.child.kill(); } catch { /* already gone */ }
    // Chrome releases the profile a moment after it exits.
    setTimeout(() => this.cleanup(projectId, w), 1500).unref?.();
  }

  stopAll() {
    for (const id of [...this.procs.keys()]) this.stop(id);
  }
}
