// Export an artboard as a React component. Every inline style becomes one Tailwind
// arbitrary-property class, so the output looks identical to the canvas without us having to
// guess a design-system mapping (a human can then swap them for real utilities or tokens).
import { parse, HTMLElement, TextNode } from 'node-html-parser';
import { toCssDeclarations } from './theme.mjs';

const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'wbr']);

// HTML/SVG attribute names that differ in JSX. SVG's hyphenated attributes become camelCase.
const ATTR = { class: 'className', for: 'htmlFor', tabindex: 'tabIndex', colspan: 'colSpan', rowspan: 'rowSpan', readonly: 'readOnly', maxlength: 'maxLength' };
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const jsxAttr = (name) => ATTR[name] ?? (name.startsWith('aria-') || name.startsWith('data-') ? name : camel(name));

// One class per declaration, written as the property and value joined by a colon inside square
// brackets (Tailwind's arbitrary-property syntax). Inside the brackets Tailwind reads an
// underscore as a space, so real underscores are escaped and real spaces become underscores.
export function styleToClasses(style = '') {
  const out = [];
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':');
    if (i <= 0) continue;
    const prop = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim().replace(/_/g, '\\_').replace(/\s+/g, '_');
    if (prop && value) out.push(`[${prop}:${value}]`);
  }
  return out;
}

// JSX text may not contain these raw.
const escapeText = (t) => t.replace(/[{}<>]/g, (c) => `{'${c}'}`);

function render(node, depth) {
  const pad = '  '.repeat(depth);
  if (node instanceof TextNode) {
    const t = node.rawText.replace(/\s+/g, ' ');
    // Whitespace-only text between tags is layout noise in JSX.
    return t.trim() ? pad + escapeText(t.trim()) : '';
  }
  if (!(node instanceof HTMLElement)) return '';
  const tag = node.rawTagName.toLowerCase();
  const attrs = [];
  for (const [name, raw] of Object.entries(node.attributes)) {
    const n = name.toLowerCase();
    // data-pid / data-name are canvas bookkeeping, not part of the design.
    if (n === 'data-pid' || n === 'data-name' || n === 'data-locked') continue;
    if (n === 'style') continue; // handled below as classes
    attrs.push(raw === '' ? jsxAttr(n) : `${jsxAttr(n)}=${JSON.stringify(raw)}`);
  }
  const classes = styleToClasses(node.getAttribute('style'));
  if (classes.length) attrs.unshift(`className=${JSON.stringify(classes.join(' '))}`);
  const open = `<${tag}${attrs.map((a) => ' ' + a).join('')}`;
  if (VOID.has(tag)) return `${pad}${open} />`;
  const kids = node.childNodes.map((c) => render(c, depth + 1)).filter(Boolean);
  if (!kids.length) return `${pad}${open} />`;
  return `${pad}${open}>\n${kids.join('\n')}\n${pad}</${tag}>`;
}

// PascalCase component name from an artboard name ("Board screen · empty" -> BoardScreenEmpty).
export function componentName(name) {
  const words = String(name).match(/[A-Za-z0-9]+/g) ?? [];
  const n = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  return /^[A-Za-z]/.test(n) ? n : 'Artboard' + n;
}

// `theme` is optional: when the project has tokens they are declared on the wrapper, so var(--...)
// references inside the design keep resolving without a separate stylesheet.
// `fontUrls` are the Google CSS URLs of the families the board uses; they are listed in a header comment
// because a component cannot load a font by itself (add them to the app's <head> or CSS @import).
export function artboardToReact(ab, theme, fontUrls = []) {
  const root = parse(ab.html, { comment: false });
  const body = root.childNodes.map((c) => render(c, 2)).filter(Boolean).join('\n');
  // Wrapper gives the board its design size; children are laid out inside it as on the canvas.
  const tokenClasses = styleToClasses(toCssDeclarations(theme?.tokens ?? {}));
  const wrap = [`[position:relative] [width:${ab.width}px] [min-height:${ab.height}px]`, ...tokenClasses].join(' ');
  const fontLines = fontUrls.map((u) => `//   <link rel="stylesheet" href="${u}" />`);
  const fontNote = fontUrls.length ? ['// Google Fonts used (load once in your app\'s <head>):', ...fontLines, ''].join('\n') : '';
  return `${fontNote}export function ${componentName(ab.name)}() {
  return (
    <div className="${wrap}">
${body}
    </div>
  );
}
`;
}

// JSX for one node (get_jsx): the same rendering as a whole board, without the board wrapper.
// `name` becomes the component name (the node's data-name, else its tag).
export function nodeToReact(el, name, theme, fontUrls = []) {
  const fontLines = fontUrls.map((u) => `//   <link rel="stylesheet" href="${u}" />`);
  const fontNote = fontUrls.length ? ['// Google Fonts used (load once in your app\'s <head>):', ...fontLines, ''].join('\n') : '';
  // Token variables are declared on a wrapper only when the node actually references one.
  const tokenClasses = /var\(--/.test(el.toString()) ? styleToClasses(toCssDeclarations(theme?.tokens ?? {})) : [];
  const body = render(el, tokenClasses.length ? 3 : 2);
  const inner = tokenClasses.length
    ? `    <div className=${JSON.stringify(tokenClasses.join(' '))}>\n${body}\n    </div>`
    : body;
  return `${fontNote}export function ${componentName(name)}() {
  return (
${inner}
  );
}
`;
}
