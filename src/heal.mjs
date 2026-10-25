// Chunk healing for streamed writes (write_html with `stream`).
//
// A streamed run sends one HTML chunk per call and each call must leave the board in a valid, visible state, but a
// chunk (or the run so far) can stop in the middle of anything: an open <div>, a half-written tag (`<div sty`),
// an unfinished <script>. `healHtml` turns such a prefix into well-formed markup: it trims what cannot be parsed
// yet and closes what is still open. It is pure and DOM-free so it is cheap to unit test.
//
// It does not sanitize: `Doc._prepare` still strips script/style/handlers on the healed result. Dropping an
// unfinished <script>/<style> here is only so its raw text never leaks into the board as visible content.

// Elements that never take a closing tag (HTML void elements).
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
// Elements whose content is raw text, so a `<` inside must not be read as a tag.
const RAW_TEXT = new Set(['script', 'style']);

// Where the tag that starts at `i` ends (index of its `>`), honouring quoted attribute values, or -1 if it is cut off.
function tagEnd(s, i) {
  let quote = '';
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (quote) { if (c === quote) quote = ''; } // a `>` inside "..." belongs to the value
    else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return j;
  }
  return -1;
}

export function healHtml(raw) {
  const s = String(raw);
  const stack = []; // names of the elements still open, as written (svg keeps its camelCase)
  let out = '';
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt === -1) { out += s.slice(i); break; }
    out += s.slice(i, lt);
    const next = s[lt + 1];
    if (s.startsWith('<!--', lt)) {
      const end = s.indexOf('-->', lt + 4);
      if (end === -1) break; // unfinished comment: drop it
      out += s.slice(lt, end + 3);
      i = end + 3;
    } else if (next === '/') {
      const end = tagEnd(s, lt);
      if (end === -1) break; // `</di`: wait for the rest
      const name = s.slice(lt + 2, end).trim().toLowerCase();
      const at = stack.map((n) => n.toLowerCase()).lastIndexOf(name);
      if (at !== -1) { // also closes anything left open inside it, like a browser would
        while (stack.length > at + 1) out += `</${stack.pop()}>`;
        stack.pop();
        out += s.slice(lt, end + 1);
      } // a stray closing tag with no opener is dropped
      i = end + 1;
    } else if (next && /[a-zA-Z]/.test(next)) {
      const end = tagEnd(s, lt);
      if (end === -1) break; // `<div sty`: half-written tag, trim it
      const tag = s.slice(lt, end + 1);
      const name = /^<([a-zA-Z][^\s/>]*)/.exec(tag)[1];
      const lower = name.toLowerCase();
      i = end + 1;
      if (RAW_TEXT.has(lower) && !tag.endsWith('/>')) {
        const close = s.toLowerCase().indexOf(`</${lower}`, i);
        const closeEnd = close === -1 ? -1 : s.indexOf('>', close);
        if (closeEnd === -1) break; // unfinished <script>: drop it and everything after
        out += s.slice(lt, closeEnd + 1);
        i = closeEnd + 1;
        continue;
      }
      out += tag;
      if (!VOID.has(lower) && !tag.endsWith('/>')) stack.push(name);
    } else if (next === '!') { // <!doctype ...> and friends
      const end = tagEnd(s, lt);
      if (end === -1) break;
      out += s.slice(lt, end + 1);
      i = end + 1;
    } else if (next === undefined) {
      break; // a lone `<` at the very end may be the start of a tag
    } else {
      out += '&lt;'; // a literal `<` in text (e.g. "a < b")
      i = lt + 1;
    }
  }
  // A cut-off entity (`&am`) would render as junk text; the next chunk will bring the whole one.
  out = out.replace(/&#?[a-zA-Z0-9]{0,8}$/, '');
  while (stack.length) out += `</${stack.pop()}>`;
  return out;
}
