import test from 'node:test';
import assert from 'node:assert/strict';
import { findBrowser, HeadlessWorker } from '../src/headless.mjs';

test('findBrowser: DC_BROWSER must exist, otherwise null', () => {
  assert.equal(findBrowser({ DC_BROWSER: '/no/such/browser' }), null);
  assert.equal(findBrowser({ DC_BROWSER: process.execPath }), process.execPath);
});

test('ensure: returns at once when a tab exists, explains when no browser is available', async () => {
  const withTab = new HeadlessWorker({ port: 1, hasTab: () => true, browser: null });
  await withTab.ensure('p_00000000');
  const none = new HeadlessWorker({ port: 1, hasTab: () => false, browser: null });
  await assert.rejects(() => none.ensure('p_00000000'), /No Chrome or Edge/);
});
