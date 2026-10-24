import test from 'node:test';
import assert from 'node:assert/strict';
import { Doc } from '../src/doc.mjs';
import { extractSvg } from '../src/svg.mjs';

function setup(html) {
  const doc = new Doc(null);
  const ab = doc.createArtboard({ name: 'Test' });
  const created = doc.writeHtml(ab.id, html);
  return { doc, ab, created, html: () => doc.getArtboard(ab.id).html };
}

test('a normal inline svg survives the sanitizer with its viewBox and paths', () => {
  const { html } = setup('<svg viewBox="0 0 24 24" fill="none"><path d="M3 12h18" stroke="currentColor"/><circle cx="12" cy="12" r="4" fill="oklch(0.7 0.1 200)"/></svg>');
  assert.match(html(), /viewBox="0 0 24 24"/);
  assert.match(html(), /d="M3 12h18"/);
  assert.match(html(), /<circle/);
});

test('active content is stripped from svg', () => {
  const { html } = setup(
    '<svg viewBox="0 0 10 10" onload="x()"><script>alert(1)</script><style>*{}</style>' +
    '<foreignObject><div>hi</div></foreignObject><rect width="5" height="5" onclick="x()"/>' +
    '<set attributeName="href" to="javascript:x()"/><animate attributeName="xlink:href" to="http://e"/></svg>',
  );
  for (const bad of [/script/i, /<style/i, /foreignObject/i, /onload/i, /onclick/i, /<set/i, /<animate/i]) assert.doesNotMatch(html(), bad);
  assert.match(html(), /<rect/);
});

test('external references are dropped, in-document ones kept', () => {
  const { html } = setup(
    '<svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs>' +
    '<rect fill="url(#g)" width="5" height="5"/><rect fill="url(http://evil/x)" width="5" height="5" style="fill:url(//evil/y)"/>' +
    '<use href="http://evil/a.svg#x"/><use href="#g"/><image href="http://evil/p.png"/>' +
    '<image href="data:image/png;base64,AAAA"/><image href="data:image/svg+xml;base64,AAAA"/>' +
    '<a href="javascript:x()"><rect width="1" height="1"/></a></svg>',
  );
  const h = html();
  assert.match(h, /fill="url\(#g\)"/);
  assert.doesNotMatch(h, /evil/);
  assert.match(h, /href="#g"/);
  assert.match(h, /data:image\/png/);
  assert.doesNotMatch(h, /svg\+xml/);
  assert.doesNotMatch(h, /javascript/);
});

test('set_attrs edits svg geometry in one undo step, and rejects the unsafe', () => {
  const { doc, created, html } = setup('<svg viewBox="0 0 10 10"><path d="M0 0L5 5" stroke="red"/></svg>');
  const pid = html().match(/<path[^>]*data-pid="(N\d+)"/)[1];
  doc.setAttrs([pid], { d: 'M1 1L9 9', 'stroke-width': 2, stroke: null });
  assert.match(html(), /d="M1 1L9 9"/);
  assert.match(html(), /stroke-width="2"/);
  assert.doesNotMatch(html(), /stroke="red"/);
  assert.throws(() => doc.setAttrs([pid], { onclick: 'x()' }), /not an editable/);
  assert.throws(() => doc.setAttrs([pid], { fill: 'url(http://evil/x)' }), /in-document/);
  assert.throws(() => doc.setAttrs(['N9999'], { d: 'M0 0' }), /not found/);
  doc.undo();
  assert.match(html(), /d="M0 0L5 5"/);
});

test('outline names svg shapes by tag and shows their key attributes', () => {
  const { doc, ab } = setup('<svg viewBox="0 0 24 24"><g><path d="M3 12h18" stroke="red"/></g></svg>');
  const tree = doc.outline(ab.id, { depth: 4 });
  assert.match(tree, /svg viewBox:0 0 24 24/);
  assert.match(tree, / g\b/);
  assert.match(tree, /path d:M3 12h18 stroke:red/);
});

test('set_attrs refuses html nodes', () => {
  const { doc, created } = setup('<div style="color:red">x</div>');
  assert.throws(() => doc.setAttrs(created, { fill: 'red' }), /not an SVG node/);
});

test('extractSvg trims prolog and rejects files without an svg', () => {
  assert.equal(extractSvg('<?xml version="1.0"?><!DOCTYPE svg><!-- c --><svg a="1"></svg>\n'), '<svg a="1"></svg>');
  assert.throws(() => extractSvg('<html></html>'), /no <svg>/);
});
