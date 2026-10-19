// Tiny inline-style helpers shared by the document model and the normalizer.

// Parse "a:b; c:d" into an ordered Map so edits keep declaration order.
export function parseStyle(str = '') {
  const map = new Map();
  for (const decl of str.split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) map.set(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
  }
  return map;
}

export const styleToString = (map) => [...map].map(([k, v]) => `${k}: ${v}`).join('; ');
