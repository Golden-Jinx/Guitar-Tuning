import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { assetForUrl, isAppDocument, allowAudioCheck, allowAudioRequest, isAllowedExternal, isLocalRequest } = require('../electron/policy.cjs');

test('desktop origin serves only bundled assets and rejects paths outside the bundle', () => {
  assert.ok(assetForUrl('stringroom://app/', '/bundle').file.endsWith('index.html'));
  assert.equal(assetForUrl('stringroom://app/app.mjs', '/bundle').type, 'text/javascript; charset=utf-8');
  for (const url of ['https://app/app.mjs', 'stringroom://evil/app.mjs', 'stringroom://user@app/app.mjs', 'stringroom://app:42/app.mjs', 'stringroom://app/%2e%2e%2felectron/main.cjs', 'stringroom://app/C:%5csecret', 'stringroom://app/%ZZ', 'stringroom://app/sw.js']) assert.equal(assetForUrl(url, '/bundle'), null, url);
  assert.equal(isAppDocument('stringroom://app/app.mjs'), false);
});
test('only the main tuner frame can request microphone access', () => {
  const request = { isMainFrame: true, requestingUrl: 'stringroom://app/', mediaTypes: ['audio'] };
  assert.equal(allowAudioRequest('media', request), true);
  for (const details of [{ ...request, mediaTypes: ['video'] }, { ...request, mediaTypes: ['audio', 'video'] }, { ...request, mediaTypes: [] }, { ...request, isMainFrame: false }, { ...request, requestingUrl: 'https://example.com' }]) assert.equal(allowAudioRequest('media', details), false);
  assert.equal(allowAudioRequest('display-capture', request), false);
  assert.equal(allowAudioCheck('media', 'stringroom://app', { isMainFrame: true, requestingUrl: 'stringroom://app/', mediaType: 'audio' }), true);
  assert.equal(allowAudioCheck('media', 'stringroom://app', { isMainFrame: true, requestingUrl: 'stringroom://app/', mediaType: 'video' }), false);
});
test('desktop blocks network requests and unexpected external URL schemes', () => {
  assert.equal(isLocalRequest('stringroom://app/style.css'), true);
  assert.equal(isLocalRequest('blob:stringroom://app/1234'), true);
  for (const url of ['https://example.com', 'file:///C:/secret', 'blob:https://example.com/1234']) assert.equal(isLocalRequest(url), false);
  assert.equal(isAllowedExternal('https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia'), true);
  for (const url of ['javascript:alert(1)', 'file:///C:/', 'https://developer.mozilla.org.evil.com/', 'https://x@developer.mozilla.org/', 'https://example.com']) assert.equal(isAllowedExternal(url), false);
});
