'use strict';

const path = require('node:path');

const APP_URL = 'stringroom://app/';
const ASSETS = new Set([
  'index.html', 'style.css', 'app.mjs', 'pitch.mjs', 'tunings.mjs',
  'library.mjs', 'reorder.mjs', 'interaction.mjs', 'icon.svg',
  'icon-180.png', 'icon-192.png', 'icon-512.png'
]);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

function isAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'stringroom:' && url.hostname === 'app'
      && !url.port && !url.username && !url.password;
  } catch { return false; }
}

function assetForUrl(value, root) {
  if (!isAppUrl(value)) return null;
  try {
    const url = new URL(value);
    const name = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).slice(1);
    if (!ASSETS.has(name)) return null;
    return { file: path.join(root, name), type: TYPES[path.extname(name)] };
  } catch { return null; }
}

function isAppDocument(value) {
  if (!isAppUrl(value)) return false;
  const url = new URL(value);
  return ['/', '/index.html'].includes(url.pathname) && !url.search;
}

function allowAudioCheck(permission, origin, details = {}) {
  return permission === 'media' && isAppUrl(origin)
    && details.isMainFrame === true && isAppDocument(details.requestingUrl)
    && details.mediaType === 'audio';
}

function allowAudioRequest(permission, details = {}) {
  return permission === 'media' && details.isMainFrame === true
    && isAppDocument(details.requestingUrl)
    && Array.isArray(details.mediaTypes) && details.mediaTypes.length > 0
    && details.mediaTypes.every(type => type === 'audio');
}

function isAllowedExternal(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['developer.mozilla.org', 'stringroom-tuner-1029.nifty-joy-6371.chatgpt.site'].includes(url.hostname);
  } catch { return false; }
}

function isLocalRequest(value) {
  return isAppUrl(value) || (value.startsWith('blob:') && isAppUrl(value.slice(5)));
}

module.exports = { APP_URL, CSP, assetForUrl, isAppUrl, isAppDocument, allowAudioCheck, allowAudioRequest, isAllowedExternal, isLocalRequest };
