import { useRef } from 'react';
import type { DocData } from '@/api/types';
import { findNode, parseStyle, sendEdit } from '@/lib/htmlTree';
import { MIXED, parentInfo, shared, type ParentInfo, type StyleMap } from '@/lib/inspect';
import { useCanvas } from '@/store/canvas';

// One selected node as the Design tab sees it: its parsed element (from the stored HTML, detached) and inline style.
export interface Entry {
  id: string;
  el: HTMLElement;
  style: StyleMap;
  parentId: string | null; // null when the parent is the board root wrapper (not a layer)
  parentStyle: StyleMap | null;
  parent: ParentInfo;
}

export type StylePatch = Record<string, string | null>;

// Everything a section needs to read and edit the whole selection. Reads return the shared value or MIXED; writes go
// out as ONE `style` action covering every selected node (one undo step), with `perId` when values differ per node.
export interface Model {
  projectId: string;
  entries: Entry[];
  primary: Entry;
  tokens: Record<string, string>;
  locked: boolean;
  /** Shared inline value of a property: '' = unset on all, MIXED = they differ. */
  get(prop: string): string;
  /** Shared value computed per node (for derived values such as padding sides). */
  getBy(fn: (e: Entry) => string): string;
  /** Same patch on every selected node. */
  patch(styles: StylePatch): void;
  /** A different patch per node (null = leave the node alone); can also touch other nodes by id (e.g. parents). */
  patchEach(fn: (e: Entry) => StylePatch | null, extra?: Record<string, StylePatch>): void;
  /** Live preview on the canvas without a server write; null restores. A committed edit replaces it. */
  preview(styles: StylePatch | null): void;
  previewEach(fn: (e: Entry) => StylePatch): void;
  /** Measured size / offset of a node on the canvas (layout px, zoom removed), or null when its board is a bitmap. */
  measure(id: string): { w: number; h: number; x: number; y: number; k: number; pw: number; ph: number } | null;
}

// Tokens for the mode being viewed: base values plus that mode's overrides.
export function tokensFor(doc: DocData, mode: string): Record<string, string> {
  const theme = doc.theme ?? { tokens: {}, modes: {} };
  return { ...theme.tokens, ...(mode === 'base' ? {} : theme.modes?.[mode] ?? {}) };
}

export function useModel(projectId: string, doc: DocData, ids: string[], tokens: Record<string, string>): Model | null {
  const engine = useCanvas((s) => s.engine);
  // Inline styles that preview() overwrote, keyed by element, so a cancelled scrub can put them back.
  const saved = useRef(new Map<HTMLElement, Map<string, string>>());

  const entries: Entry[] = [];
  for (const id of ids) {
    const hit = findNode(doc, id, engine?.boardOf(id));
    if (!hit) continue;
    const pEl = hit.el.parentElement?.dataset?.pid ? hit.el.parentElement : null;
    const parentStyle = pEl ? Object.fromEntries(parseStyle(pEl.getAttribute('style') ?? '')) : null;
    entries.push({
      id, el: hit.el, style: Object.fromEntries(parseStyle(hit.el.getAttribute('style') ?? '')),
      parentId: pEl?.dataset.pid ?? null, parentStyle, parent: parentInfo(parentStyle),
    });
  }
  if (!entries.length) return null;
  const primary = entries[entries.length - 1];

  const restore = () => {
    for (const [el, props] of saved.current) for (const [k, v] of props) { if (v) el.style.setProperty(k, v); else el.style.removeProperty(k); }
    saved.current.clear();
  };
  const apply = (id: string, styles: StylePatch) => {
    const el = engine?.findElement(id);
    if (!el) return;
    let mem = saved.current.get(el);
    if (!mem) saved.current.set(el, (mem = new Map()));
    for (const [k, v] of Object.entries(styles)) {
      if (!mem.has(k)) mem.set(k, el.style.getPropertyValue(k));
      if (v === null) el.style.removeProperty(k); else el.style.setProperty(k, v);
    }
  };
  // A real edit supersedes the preview: forget the originals (the doc update redraws the node) instead of restoring
  // them, which would flash the old value for a frame before the server answers.
  const send = (body: { ids: string[]; styles?: StylePatch; perId?: Record<string, StylePatch> }) => {
    saved.current.clear();
    sendEdit(projectId, 'style', body);
  };

  const model: Model = {
    projectId, entries, primary, tokens,
    locked: entries.some((e) => !!e.el.closest('[data-locked]')),
    get: (prop) => shared(entries.map((e) => e.style[prop] ?? (prop === 'background' ? e.style['background-color'] : undefined) ?? '')),
    getBy: (fn) => shared(entries.map(fn)),
    patch: (styles) => send({ ids: entries.map((e) => e.id), styles }),
    patchEach: (fn, extra) => {
      const perId: Record<string, StylePatch> = {};
      for (const e of entries) { const p = fn(e); if (p) perId[e.id] = { ...perId[e.id], ...p }; }
      for (const [id, p] of Object.entries(extra ?? {})) perId[id] = { ...perId[id], ...p };
      if (Object.keys(perId).length) send({ ids: [], perId });
    },
    preview: (styles) => { if (styles === null) restore(); else for (const e of entries) apply(e.id, styles); },
    previewEach: (fn) => { for (const e of entries) apply(e.id, fn(e)); },
    measure: (id) => {
      const el = engine?.findElement(id);
      if (!el || !el.offsetWidth) return null;
      const r = el.getBoundingClientRect();
      const k = r.width / el.offsetWidth || 1;
      // Offset from the parent's padding box origin, in layout px (what `left` / `top` mean for an absolute child).
      const par = el.parentElement;
      const pr = par?.getBoundingClientRect();
      const x = pr ? (r.left - pr.left) / k - (par?.clientLeft ?? 0) : el.offsetLeft;
      const y = pr ? (r.top - pr.top) / k - (par?.clientTop ?? 0) : el.offsetTop;
      return { w: el.offsetWidth, h: el.offsetHeight, x, y, k, pw: par?.clientWidth ?? 0, ph: par?.clientHeight ?? 0 };
    },
  };
  return model;
}

export { MIXED };
