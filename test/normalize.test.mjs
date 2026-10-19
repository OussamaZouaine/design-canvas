import test from 'node:test';
import assert from 'node:assert/strict';
import { Doc } from '../src/doc.mjs';

function board(normalize = true) {
  const doc = new Doc(null);
  doc.normalize = () => normalize;
  return { doc, ab: doc.createArtboard({ name: 'T' }) };
}
const write = (doc, ab, html) => { doc.writeHtml(ab.id, html); return doc.getArtboard(ab.id).html; };

test('classes and <style> blocks are dropped, inline styles stay', () => {
  const { doc, ab } = board();
  const html = write(doc, ab, '<style>.a{color:red}</style><p class="a" style="color: blue">x</p>');
  assert.doesNotMatch(html, /class=|<style/);
  assert.match(html, /color: blue/);
});

test('flex-only and gap declarations are stripped from plain blocks', () => {
  const { doc, ab } = board();
  const html = write(doc, ab, '<div style="gap: 8px; justify-content: center; color: red"></div>');
  assert.doesNotMatch(html, /gap|justify/);
  assert.match(html, /color: red/);
});

test('flex containers keep their layout but lose default values', () => {
  const { doc, ab } = board();
  const html = write(doc, ab, '<div style="display: flex; flex-direction: row; gap: 8px; position: static; opacity: 1"></div>');
  assert.match(html, /display: flex/);
  assert.match(html, /gap: 8px/);
  assert.doesNotMatch(html, /flex-direction|position|opacity/);
});

test('boxes with a size, padding or border get border-box; others do not', () => {
  const { doc, ab } = board();
  const html = write(doc, ab, '<div style="width: 100px; padding: 8px"></div><p style="color: red"></p>');
  assert.match(html, /width: 100px; padding: 8px; box-sizing: border-box/);
  assert.equal([...html.matchAll(/box-sizing/g)].length, 1);
});

test('an explicit box-sizing is respected', () => {
  const { doc, ab } = board();
  assert.match(write(doc, ab, '<div style="width: 9px; box-sizing: content-box"></div>'), /content-box/);
});

test('inherited properties are never treated as redundant', () => {
  const { doc, ab } = board();
  assert.match(write(doc, ab, '<b style="font-weight: 400; color: black"></b>'), /font-weight: 400/);
});

test('projects without the option keep their markup as written', () => {
  const { doc, ab } = board(false);
  const html = write(doc, ab, '<p class="a" style="gap: 8px">x</p>');
  assert.match(html, /class="a"/);
  assert.match(html, /gap: 8px/);
});

test('import sanitizing does not normalize', () => {
  const doc = new Doc(null);
  doc.normalize = () => true;
  doc.data.artboards.push({ id: 'A1', name: 'I', x: 0, y: 0, width: 10, height: 10, html: '<p class="keep" style="width: 5px">x</p>' });
  doc.sanitizeAll();
  assert.match(doc.data.artboards[0].html, /class="keep"/);
  assert.doesNotMatch(doc.data.artboards[0].html, /box-sizing/);
});
