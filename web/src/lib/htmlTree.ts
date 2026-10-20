// Read-only view of the document used by the Layers and Inspector panels.
// The canvas engine owns the live shadow DOM; the panels instead parse each artboard's stored HTML into a
// detached DOM (DOMParser never runs scripts or loads images) and read ids, names and inline styles from it.
import { canvasAction } from '@/api/projects';
import type { Artboard, DocData } from '@/api/types';
import { toast } from '@/store/toast';
import { useCanvas } from '@/store/canvas';

// Cache keyed by artboard id so a board is parsed once per HTML change, not once per render.
const trees = new Map<string, { html: string; root: HTMLElement }>();

export function treeOf(ab: Artboard): HTMLElement {
  let t = trees.get(ab.id);
  if (!t || t.html !== ab.html) {
    t = { html: ab.html, root: new DOMParser().parseFromString(`<body>${ab.html}</body>`, 'text/html').body };
    trees.set(ab.id, t);
  }
  return t.root;
}

const INLINE = new Set(['span', 'b', 'strong', 'i', 'em', 'a', 'br', 'small', 'sub', 'sup', 'code']);
export type Kind = 'artboard' | 'frame' | 'text' | 'image' | 'svg' | 'component';

// Only nodes with an id (data-pid) are layers; wrapper-less text runs and decorative markup are skipped.
export const kidsOf = (el: Element) => [...el.children].filter((c): c is HTMLElement => c instanceof HTMLElement && !!c.dataset.pid);

export function kindOf(el: HTMLElement): Kind {
  if (el.dataset.component) return 'component';
  const t = el.tagName.toLowerCase();
  if (t === 'svg') return 'svg';
  if (t === 'img') return 'image';
  // A node whose children are all inline text markup, and which has text, reads as a text layer.
  return [...el.children].every((c) => INLINE.has(c.tagName.toLowerCase())) && el.textContent?.trim() ? 'text' : 'frame';
}

export const labelOf = (el: HTMLElement) =>
  el.dataset.name || (el.dataset.component ? `${el.dataset.component}/${el.dataset.variant ?? ''}` : el.tagName.toLowerCase());

export const snippetOf = (el: HTMLElement) => (kindOf(el) === 'text' ? el.textContent!.trim().replace(/\s+/g, ' ').slice(0, 40) : '');

// Find a node by id. `hint` (the engine's pid index) avoids scanning boards; the scan is the fallback for a doc
// that reached the store a moment before the engine indexed it.
export function findNode(doc: DocData, id: string, hint?: string): { ab: Artboard; el: HTMLElement } | null {
  const q = `[data-pid="${CSS.escape(id)}"]`;
  const hinted = hint ? doc.artboards.find((a) => a.id === hint) : undefined;
  for (const ab of hinted ? [hinted] : doc.artboards) {
    const el = treeOf(ab).querySelector<HTMLElement>(q);
    if (el) return { ab, el };
  }
  return hinted ? findNode(doc, id) : null;
}

// Ids of every ancestor node of `id` (nearest first), ending with its artboard id: what must be open to show it.
export function ancestorsOf(doc: DocData, id: string): string[] {
  const hit = findNode(doc, id, useCanvas.getState().engine?.boardOf(id));
  if (!hit) return [];
  const out: string[] = [];
  for (let p = hit.el.parentElement; p?.dataset?.pid; p = p.parentElement) out.push(p.dataset.pid);
  out.push(hit.ab.id);
  return out;
}

// Inline `style="a: b; c: d"` as an ordered map (property names lower-cased).
export function parseStyle(str = ''): Map<string, string> {
  const map = new Map<string, string>();
  for (const decl of str.split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) map.set(decl.slice(0, i).trim().toLowerCase(), decl.slice(i + 1).trim());
  }
  return map;
}

// One place for every panel edit: marks it as the user's (so the canvas does not play the "Claude is designing"
// reveal), posts it, and turns a server refusal (locked node, bad value) into a toast.
export async function sendEdit(projectId: string, action: string, body: unknown) {
  useCanvas.getState().engine?.markUserEdit();
  try {
    await canvasAction(projectId, action, body);
  } catch (e) {
    toast((e as Error).message || 'That change was not allowed');
  }
}
