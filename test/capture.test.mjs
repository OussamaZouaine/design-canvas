import test from 'node:test';
import assert from 'node:assert/strict';
import { Doc } from '../src/doc.mjs';
import { checkTarget, isPrivateIp, EXTRACT_SCRIPT, LIMITS } from '../src/capture.mjs';

test('isPrivateIp: loopback, private, link-local and mapped addresses are private; public ones are not', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111']) assert.equal(isPrivateIp(ip), false, ip);
});

test('checkTarget: only http(s), no credentials, no private targets unless allowed', async () => {
  const pub = async () => [{ address: '93.184.216.34' }];
  const priv = async () => [{ address: '10.0.0.5' }];
  assert.equal((await checkTarget('https://example.com/a?b=1', { lookup: pub })).hostname, 'example.com');
  await assert.rejects(checkTarget('file:///etc/passwd', { lookup: pub }), /http and https/);
  await assert.rejects(checkTarget('javascript:alert(1)', { lookup: pub }), /http and https/);
  await assert.rejects(checkTarget('https://user:pw@example.com/', { lookup: pub }), /user name/);
  await assert.rejects(checkTarget('http://localhost:3777/', { lookup: pub }), /localhost/);
  await assert.rejects(checkTarget('http://127.0.0.1/', { lookup: pub }), /private/);
  await assert.rejects(checkTarget('http://[::1]/', { lookup: pub }), /private/);
  await assert.rejects(checkTarget('http://intranet.example/', { lookup: priv }), /private/); // a public-looking name that resolves to a private address
  await assert.rejects(checkTarget('not a url'), /valid URL/);
  assert.equal((await checkTarget('http://localhost:3777/', { allowPrivate: true })).port, '3777');
});

test('EXTRACT_SCRIPT is a self-contained expression that parses', () => {
  const src = EXTRACT_SCRIPT({ ...LIMITS, maxNodes: 5 });
  assert.doesNotThrow(() => new Function(`return ${src}`));
  assert.match(src, /"maxNodes":5/);
});

test('writeHtml: opts.normalize false keeps captured markup; the sanitizer still runs', () => {
  const doc = new Doc(null);
  doc.normalize = () => true; // a project that normalizes
  const ab = doc.createArtboard({ width: 400, height: 200 });
  doc.writeHtml(ab.id, '<div style="margin:3px"><script>x()</script><div onclick="x()" style="padding:1px">hi</div></div>', 'replace', { normalize: false });
  const html = doc.getArtboard(ab.id).html;
  assert.ok(!/script|onclick/.test(html));
  assert.match(html, /margin:3px/);
});
