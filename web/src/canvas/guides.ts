// Draws the smart guides and distance pills from snap.ts into the screen-px overlay. The snap maths works in
// "client px / zoom" space (so nodes and boards share it); this layer multiplies back by the zoom and subtracts the
// viewport's origin, which keeps lines 1 px crisp at any zoom (the overlay is never scaled).
import type { Guide, Pill } from './snap';

export class Guides {
  private host = document.createElement('div');

  constructor(overlay: HTMLElement, private viewport: HTMLElement, private zoom: () => number) {
    this.host.className = 'dc-guides dc-hide';
    overlay.append(this.host);
  }

  // Replace everything drawn so far. Cheap: a handful of nodes per pointer move, rebuilt rather than diffed.
  show(guides: readonly Guide[], pills: readonly Pill[]) {
    const k = this.zoom(), vp = this.viewport.getBoundingClientRect();
    const sx = (v: number) => v * k - vp.left, sy = (v: number) => v * k - vp.top;
    const mk = (cls: string, style: Partial<CSSStyleDeclaration>, text?: string) => {
      const el = document.createElement('i');
      el.className = cls;
      Object.assign(el.style, style);
      if (text !== undefined) el.textContent = text; // textContent: never innerHTML for anything drawn here
      this.host.append(el);
    };
    this.host.replaceChildren();
    for (const g of guides) {
      if (g.axis === 'x') mk('dc-guide', { left: sx(g.pos) + 'px', top: sy(g.from) + 'px', width: '1px', height: (g.to - g.from) * k + 'px' });
      else mk('dc-guide', { top: sy(g.pos) + 'px', left: sx(g.from) + 'px', height: '1px', width: (g.to - g.from) * k + 'px' });
    }
    for (const p of pills) {
      const cls = p.equal ? 'dc-gap eq' : 'dc-gap';
      const len = Math.abs(p.b - p.a) * k;
      // The measured segment (with end ticks from CSS), then the number centred on it.
      if (p.axis === 'x') {
        mk(cls, { left: sx(Math.min(p.a, p.b)) + 'px', top: sy(p.at) + 'px', width: len + 'px', height: '0' });
        mk('dc-pill', { left: sx((p.a + p.b) / 2) + 'px', top: sy(p.at) + 'px' }, String(Math.round(p.value)));
      } else {
        mk(cls + ' v', { top: sy(Math.min(p.a, p.b)) + 'px', left: sx(p.at) + 'px', height: len + 'px', width: '0' });
        mk('dc-pill', { top: sy((p.a + p.b) / 2) + 'px', left: sx(p.at) + 'px' }, String(Math.round(p.value)));
      }
    }
    this.host.classList.toggle('dc-hide', !guides.length && !pills.length);
  }

  clear() { this.host.replaceChildren(); this.host.classList.add('dc-hide'); }
}
