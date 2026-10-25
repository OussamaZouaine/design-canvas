import test from 'node:test';
import assert from 'node:assert/strict';
import { healHtml } from '../src/heal.mjs';

test('complete markup is unchanged', () => {
  const html = '<div style="a:b"><p>hi</p><img src="x"><br/></div>';
  assert.equal(healHtml(html), html);
});

test('closes open elements in reverse order', () => {
  assert.equal(healHtml('<div><section><p>text'), '<div><section><p>text</p></section></div>');
});

test('trims a half-written tag', () => {
  assert.equal(healHtml('<div><span>a</span><div sty'), '<div><span>a</span></div>');
  assert.equal(healHtml('<div><a href="x'), '<div></div>');
  assert.equal(healHtml('<div>a<'), '<div>a</div>');
  assert.equal(healHtml('<div></di'), '<div></div>');
});

test('a > inside a quoted attribute does not end the tag', () => {
  assert.equal(healHtml('<div data-x="a>b">hi'), '<div data-x="a>b">hi</div>');
});

test('drops an unfinished script or style, keeps a finished one', () => {
  assert.equal(healHtml('<div>a<script>var x = "<div>'), '<div>a</div>');
  assert.equal(healHtml('<div><style>.a{'), '<div></div>');
  assert.equal(healHtml('<div><script>1<2</script>b'), '<div><script>1<2</script>b</div>');
});

test('drops an unfinished comment and a cut-off entity', () => {
  assert.equal(healHtml('<p>a<!-- todo'), '<p>a</p>');
  assert.equal(healHtml('<p>Tom &am'), '<p>Tom </p>');
  assert.equal(healHtml('<p>Tom &amp; Jo</p>'), '<p>Tom &amp; Jo</p>');
});

test('a closing tag closes children left open and stray closers are dropped', () => {
  assert.equal(healHtml('<div><b>x</div>tail'), '<div><b>x</b></div>tail');
  assert.equal(healHtml('a</span>b'), 'ab');
});

test('svg keeps its camelCase names and self-closing children', () => {
  assert.equal(healHtml('<svg viewBox="0 0 1 1"><linearGradient><stop offset="0"/>'), '<svg viewBox="0 0 1 1"><linearGradient><stop offset="0"/></linearGradient></svg>');
});

test('a literal < in text is escaped', () => {
  assert.equal(healHtml('<p>a < b</p>'), '<p>a &lt; b</p>');
});

test('empty input', () => {
  assert.equal(healHtml(''), '');
});
