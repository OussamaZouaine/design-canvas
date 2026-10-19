import test from 'node:test';
import assert from 'node:assert/strict';
import { Doc } from '../src/doc.mjs';

const BTN = {
  default: '<button style="padding: 8px 16px; background: #eee"><span data-slot="label">Button</span></button>',
  primary: '<button style="padding: 8px 16px; background: #55f; color: #fff"><span data-slot="label">Button</span></button>',
};

function setup() {
  const doc = new Doc(null);
  const ab = doc.createArtboard({ name: 'T' });
  doc.setComponent('button', BTN);
  return { doc, ab };
}
const html = (doc, ab) => doc.getArtboard(ab.id).html;

test('x-component expands a variant and fills slots, escaping text', () => {
  const { doc, ab } = setup();
  const [id] = doc.writeHtml(ab.id, '<x-component name="button" variant="primary" slot-label="Save <b>"></x-component>');
  const out = html(doc, ab);
  assert.match(out, /data-component="button"/);
  assert.match(out, /data-variant="primary"/);
  assert.match(out, /Save &lt;b&gt;/);
  assert.match(out, new RegExp(`data-pid="${id}"`));
});

test('unknown component or variant is a clear error', () => {
  const { doc, ab } = setup();
  assert.throws(() => doc.writeHtml(ab.id, '<x-component name="nope"></x-component>'), /no component named/);
  assert.throws(() => doc.writeHtml(ab.id, '<x-component name="button" variant="huge"></x-component>'), /no variant "huge"/);
});

test('editing the master updates every instance and keeps ids and slot text', () => {
  const { doc, ab } = setup();
  const [a] = doc.writeHtml(ab.id, '<x-component name="button" variant="primary" slot-label="Save"></x-component>');
  const [b] = doc.writeHtml(ab.id, '<x-component name="button" slot-label="Cancel"></x-component>');
  const r = doc.setComponent('button', {
    default: BTN.default.replace('#eee', '#ddd'),
    primary: BTN.primary.replace('#55f', '#f50'),
  });
  assert.equal(r.instancesUpdated, 2);
  const out = html(doc, ab);
  assert.match(out, /#f50/);
  assert.match(out, /#ddd/);
  assert.doesNotMatch(out, /#55f|#eee/);
  assert.match(out, /Save/);
  assert.match(out, /Cancel/);
  assert.match(out, new RegExp(`data-pid="${a}"`));
  assert.match(out, new RegExp(`data-pid="${b}"`));
});

test('a removed variant falls back to the default', () => {
  const { doc, ab } = setup();
  doc.writeHtml(ab.id, '<x-component name="button" variant="primary" slot-label="Go"></x-component>');
  doc.setComponent('button', { default: BTN.default });
  assert.match(html(doc, ab), /data-variant="default"/);
  assert.match(html(doc, ab), /Go/);
});

test('detach and delete turn instances into plain nodes', () => {
  const { doc, ab } = setup();
  const [a] = doc.writeHtml(ab.id, '<x-component name="button"></x-component>');
  doc.detach(a);
  assert.doesNotMatch(html(doc, ab), /data-component/);
  assert.throws(() => doc.detach(a), /not a component instance/);
  doc.writeHtml(ab.id, '<x-component name="button"></x-component>');
  doc.deleteComponent('button');
  assert.doesNotMatch(html(doc, ab), /data-component/);
  assert.deepEqual(doc.components, {});
});

test('masters must be one root element and valid names', () => {
  const doc = new Doc(null);
  assert.throws(() => doc.setComponent('Bad Name', BTN), /lowercase/);
  assert.throws(() => doc.setComponent('card', { default: '<div></div><div></div>' }), /single root/);
  assert.throws(() => doc.setComponent('card', {}), /at least one variant/);
});

test('masters are sanitized like any other write', () => {
  const doc = new Doc(null);
  doc.setComponent('card', { default: '<div onclick="x()"><script>1</script><i>ok</i></div>' });
  const m = doc.components.card.variants.default;
  assert.doesNotMatch(m, /onclick|script/);
  assert.doesNotMatch(m, /data-pid/);
});

test('instances are one line in the outline', () => {
  const { doc, ab } = setup();
  doc.writeHtml(ab.id, '<div data-name="Row"><x-component name="button" variant="primary" slot-label="Save"></x-component></div>');
  const out = doc.outline(ab.id, { depth: 4 });
  assert.match(out, /button\/primary "Save"/);
  assert.equal(out.split('\n').filter((l) => /span/.test(l)).length, 0);
});

test('component changes are undoable', () => {
  const { doc, ab } = setup();
  doc.writeHtml(ab.id, '<x-component name="button" slot-label="A"></x-component>');
  doc.setComponent('button', { default: '<button>new</button>' });
  doc.undo();
  assert.match(doc.components.button.variants.default, /data-slot/);
});

test('components sheet lists variants, regenerates and is reused', () => {
  const { doc } = setup();
  const sheet = doc.createComponentsSheet();
  assert.match(sheet.html, /primary/);
  assert.match(sheet.html, /slots: label/);
  doc.setComponent('badge', { default: '<span>New</span>' });
  assert.match(doc.getArtboard(sheet.id).html, /badge/);
  assert.equal(doc.createComponentsSheet().id, sheet.id);
});
