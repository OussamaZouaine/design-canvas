// Pure helpers for keeping element comments attached when a board is rebuilt (deleted and recreated by name).
// A rebuild gives every inner node a new data-pid, so we pair old and new nodes by their position in the tree.
import { parse, HTMLElement } from 'node-html-parser';

// [{ id, path }] for every node with a data-pid. `path` is the chain of `tag[index among element siblings]`
// from the board root, e.g. "div[0]/span[2]": unique per node, and the same for the same spot in a rebuilt copy.
export function nodePaths(html) {
  const out = [];
  const walk = (parent, prefix) => {
    parent.childNodes.filter((n) => n instanceof HTMLElement).forEach((el, i) => {
      const path = `${prefix}${prefix ? '/' : ''}${el.rawTagName}[${i}]`;
      const id = el.getAttribute('data-pid');
      if (id) out.push({ id, path });
      walk(el, path);
    });
  };
  walk(parse(html, { comment: false }), '');
  return out;
}

// old [{id,path}] + the board's current html -> Map(oldId -> newId) for the spots that exist in both.
// shortcut: position only, so a rebuild that reorders or wraps content can pair a comment with the wrong
// element; upgrade to text/name matching if that shows up.
export function matchNodes(oldPaths, newHtml) {
  const byPath = new Map(nodePaths(newHtml).map((n) => [n.path, n.id]));
  const map = new Map();
  for (const o of oldPaths) if (byPath.has(o.path)) map.set(o.id, byPath.get(o.path));
  return map;
}
