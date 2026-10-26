// Pruned CSS report for capture_url (opt-in `prune_css`). Why a report and not markup: capture_url bakes computed
// styles into inline-styled divs because the sanitizer strips <style>/<link> and boards are shadow roots, so
// the page's own rules (breakpoints, :hover / :focus, custom properties, web fonts) are lost. We must not weaken
// the sanitizer or inject <style>, so instead we walk the page's CSSOM inside the captured page, keep only the
// rules that still match something in the DOM, and hand the agent a compact summary of the design-relevant ones.
//
// The functions below are written to be SELF-CONTAINED (no module-scope references): `PRUNE_SCRIPT` ships their
// source text into the page through CDP Runtime.evaluate, and the same functions are unit-tested in Node
// (test/cssreport.test.mjs) with fake rule objects. Keep them import-free and free of outer variables.

export const PRUNE_LIMITS = { inPageMs: 5000, serverMs: 8000, states: 30, breakpoints: 20, vars: 60, fonts: 20, keyframes: 20, ruleChars: 220, reportChars: 7000 };

// Removes pseudo-classes and pseudo-elements so `a:hover::before` can be tested as `a` against the static DOM
// (no element is hovered while we look). Functional ones such as `:not(.x)` are dropped with their balanced
// parentheses. A selector left empty or ending in a combinator gets `*` so it stays valid and over-matches,
// which is the safe direction (we would rather keep a rule than lose a hover state).
function stripPseudo(sel) {
  let out = '', i = 0, quote = '', bracket = 0;
  while (i < sel.length) {
    const c = sel[i];
    if (quote) { out += c; if (c === '\\') out += sel[++i] ?? ''; else if (c === quote) quote = ''; i++; continue; }
    if (c === '"' || c === "'") { quote = c; out += c; i++; continue; }
    if (c === '[') bracket++;
    if (c === ']') bracket = Math.max(0, bracket - 1);
    if (c === '\\') { out += c + (sel[i + 1] ?? ''); i += 2; continue; }
    if (c === ':' && !bracket) {
      i++;
      if (sel[i] === ':') i++;
      while (i < sel.length && /[\w-]/.test(sel[i])) i++;
      if (sel[i] === '(') { // skip the balanced argument list
        let depth = 0;
        for (; i < sel.length; i++) {
          if (sel[i] === '(') depth++;
          else if (sel[i] === ')' && --depth === 0) { i++; break; }
        }
      }
      continue;
    }
    out += c; i++;
  }
  out = out.trim();
  if (!out || /[>+~]$/.test(out)) out += '*';
  return out.replace(/([>+~])\s*(?=[>+~])/g, '$1*');
}

// Splits a selector list on top-level commas only (a comma inside :is(...) or [attr="a,b"] is not a separator).
function splitSelectors(text) {
  const parts = [];
  let depth = 0, quote = '', cur = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { cur += c; if (c === '\\') cur += text[++i] ?? ''; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// Walks `sheets` (CSSStyleSheet-like objects: `cssRules` may throw for cross-origin sheets) and returns a raw
// summary of the rules that still matter. env: { matches(selector) -> boolean, now() -> ms, deadline: ms, fontText: string }.
// When the deadline passes we stop and mark `timedOut`: the totals then describe only what was scanned and the
// font / keyframe filter is skipped (conservative: keep when unsure).
function pruneSheets(sheets, env) {
  const cache = new Map();
  const keep = (selectorText) => {
    for (const s of splitSelectors(selectorText)) {
      const base = stripPseudo(s);
      let hit = cache.get(base);
      if (hit === undefined) { try { hit = !!env.matches(base); } catch { hit = true; } cache.set(base, hit); }
      if (hit) return true;
    }
    return false;
  };
  const r = { rulesTotal: 0, rulesKept: 0, bytesBefore: 0, bytesAfter: 0, timedOut: false, skippedSheets: 0, states: [], breakpoints: {}, vars: {}, fontFaces: [], keyframes: [] };
  let usage = env.fontText || '';
  let anim = '';
  const size = (rule) => rule.cssText.length;
  const STATE = /:(hover|focus|focus-visible|focus-within|active|disabled|checked)\b/;

  function walk(rules, media) {
    for (const rule of rules) {
      if (env.now() > env.deadline) { r.timedOut = true; return; }
      if (rule.selectorText !== undefined) {
        r.rulesTotal++; r.bytesBefore += size(rule);
        if (!keep(rule.selectorText)) continue;
        r.rulesKept++; r.bytesAfter += size(rule);
        const st = rule.style;
        if (st) {
          for (let i = 0; i < st.length; i++) if (st[i].startsWith('--')) r.vars[st[i]] = st.getPropertyValue(st[i]).trim();
          usage += ' ' + (st.getPropertyValue('font-family') || '') + ' ' + (st.getPropertyValue('font') || '');
          anim += ' ' + (st.getPropertyValue('animation') || '') + ' ' + (st.getPropertyValue('animation-name') || '');
        }
        if (STATE.test(rule.selectorText)) r.states.push({ media, css: rule.cssText });
      } else if (rule.type === 5) { // @font-face: decided after the walk, once we know which families are used
        r.rulesTotal++; r.bytesBefore += size(rule);
        r.fontFaces.push({ family: (rule.style.getPropertyValue('font-family') || '').replace(/["']/g, '').trim(), weight: rule.style.getPropertyValue('font-weight') || '400', style: rule.style.getPropertyValue('font-style') || 'normal', bytes: size(rule) });
      } else if (rule.type === 7) { // @keyframes: same, by name
        r.rulesTotal++; r.bytesBefore += size(rule);
        r.keyframes.push({ name: rule.name, bytes: size(rule) });
      } else if (rule.styleSheet) { // @import
        try { walk(rule.styleSheet.cssRules, media); } catch { r.skippedSheets++; }
      } else if (rule.cssRules) { // @media / @supports / @layer / @container
        const before = r.rulesKept;
        const cond = rule.type === 4 ? '@media ' + (rule.media ? rule.media.mediaText : rule.conditionText) : null;
        walk(rule.cssRules, cond || media);
        if (cond && r.rulesKept > before) r.breakpoints[cond] = r.rulesKept - before;
      }
      if (r.timedOut) return;
    }
  }

  for (const sheet of sheets) {
    if (env.now() > env.deadline) { r.timedOut = true; break; }
    let rules;
    try { rules = sheet.cssRules; } catch { r.skippedSheets++; continue; } // cross-origin sheet: unreadable
    walk(rules, null);
    if (r.timedOut) break;
  }

  if (!r.timedOut) {
    const u = usage.toLowerCase().replace(/["']/g, '');
    r.fontFaces = r.fontFaces.filter((f) => f.family && u.includes(f.family.toLowerCase()));
    r.keyframes = r.keyframes.filter((k) => anim.includes(k.name));
  }
  for (const f of r.fontFaces) { r.rulesKept++; r.bytesAfter += f.bytes; delete f.bytes; }
  for (const k of r.keyframes) { r.rulesKept++; r.bytesAfter += k.bytes; delete k.bytes; }
  return r;
}

// Source text of the in-page script: defines the helpers, then prunes document.styleSheets under the deadline.
export const PRUNE_SCRIPT = (limits = PRUNE_LIMITS) => `(() => {
${stripPseudo.toString()}
${splitSelectors.toString()}
${pruneSheets.toString()}
const t0 = Date.now();
const fontText = [document.documentElement, document.body].map((e) => getComputedStyle(e).fontFamily).join(' ');
return pruneSheets(Array.from(document.styleSheets), {
  matches: (s) => document.querySelector(s) !== null,
  now: () => Date.now(), deadline: t0 + ${Number(limits.inPageMs)}, fontText,
});
})()`;

// Turns the raw in-page summary into the capped object the tool returns (token-friendly, deterministic order).
export function formatReport(raw, limits = PRUNE_LIMITS) {
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const out = {
    css_bytes_before: raw.bytesBefore, css_bytes_after: raw.bytesAfter,
    rules_scanned: raw.rulesTotal, rules_kept: raw.rulesKept,
    breakpoints: Object.entries(raw.breakpoints).sort((a, b) => b[1] - a[1]).slice(0, limits.breakpoints).map(([query, rules]) => ({ query, rules })),
    custom_properties: Object.fromEntries(Object.entries(raw.vars).slice(0, limits.vars).map(([k, v]) => [k, clip(v, 80)])),
    fonts: raw.fontFaces.slice(0, limits.fonts),
    keyframes: raw.keyframes.slice(0, limits.keyframes).map((k) => k.name),
    interaction_rules: raw.states.slice(0, limits.states).map((s) => (s.media ? `${s.media} { ${clip(s.css, limits.ruleChars)} }` : clip(s.css, limits.ruleChars))),
  };
  const notes = [];
  if (raw.timedOut) notes.push('Scan hit its time limit: totals are partial and fonts / keyframes are not filtered by use.');
  if (raw.skippedSheets) notes.push(`${raw.skippedSheets} cross-origin stylesheet(s) could not be read.`);
  if (raw.states.length > limits.states) notes.push(`${raw.states.length - limits.states} more hover / focus rules not shown.`);
  if (notes.length) out.notes = notes;
  // Hard cap: drop the longest list first until the JSON fits.
  while (JSON.stringify(out).length > limits.reportChars && out.interaction_rules.length) out.interaction_rules.pop();
  return out;
}
