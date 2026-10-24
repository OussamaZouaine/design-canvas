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

test('normalizing keeps overflow:visible on an svg (it is not the default there)', () => {
  const doc = new Doc(null);
  doc.normalize = () => true;
  const ab = doc.createArtboard({ name: 'N' });
  doc.writeHtml(ab.id, '<svg viewBox="0 0 4 4" style="overflow:visible;width:4px;height:4px"></svg><div style="overflow:visible;width:4px">x</div>');
  const h = doc.getArtboard(ab.id).html;
  assert.match(h, /<svg[^>]*overflow: ?visible/);
  assert.doesNotMatch(h, /<div[^>]*overflow/);
});

// Path editing rewrites d, viewBox and the svg box together; one undo must restore all of it.
const PATH_SVG = '<svg data-shape="path" viewBox="0 0 44 44" preserveAspectRatio="none" fill="none" stroke="oklch(0.45 0.12 255)" stroke-width="2" style="position:absolute;left:10px;top:20px;width:44px;height:44px;overflow:visible"><path d="M2 2L42 42" vector-effect="non-scaling-stroke"/></svg>';

test('editVector changes d, viewBox and the box in one undo step', () => {
  const { doc, created, html } = setup(PATH_SVG);
  const svgId = created[0];
  const pathId = /<path[^>]*data-pid="([^"]+)"/.exec(html())?.[1] ?? /data-pid="([^"]+)"[^>]*d="M2/.exec(html())[1];
  doc.editVector([
    { id: pathId, attrs: { d: 'M2 2C10 10 20 20 60 60' } },
    { id: svgId, attrs: { viewBox: '0 0 64 64' }, styles: { left: '8px', top: '18px', width: '64px', height: '64px' } },
  ]);
  assert.match(html(), /d="M2 2C10 10 20 20 60 60"/);
  assert.match(html(), /viewBox="0 0 64 64"/);
  assert.match(html(), /left: 8px/);
  doc.undo(1, 'user');
  assert.match(html(), /d="M2 2L42 42"/);
  assert.match(html(), /viewBox="0 0 44 44"/);
  assert.match(html(), /left: 10px/);
});

test('editVector refuses HTML nodes and bad attributes without writing anything', () => {
  const { doc, created, html } = setup(`<div>hi</div>${PATH_SVG}`);
  const before = html();
  assert.throws(() => doc.editVector([{ id: created[0], attrs: { d: 'M0 0' } }]), /not an SVG node/);
  assert.throws(() => doc.editVector([{ id: created[1], attrs: { onclick: 'x()' } }]), /not an editable/);
  assert.equal(html(), before);
});

test('get_tree names a pen path with its inner path id and d', () => {
  const { doc, ab } = setup(PATH_SVG);
  const out = doc.outline(ab.id, { depth: 0 });
  const text = Array.isArray(out) ? out.join('\n') : String(out.text ?? out);
  assert.match(text, /path:\S+ d:M2 2L42 42/);
});
