'use strict';

// Capture the real renderer in a disposable profile without opening a window.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs', 'preview.png');

if (!process.versions.electron) {
  void (async () => {
    const parent = await fs.realpath(os.tmpdir());
    const profile = await fs.mkdtemp(path.join(parent, 'stringroom-preview-'));
    const marker = randomUUID();
    await fs.writeFile(path.join(profile, '.preview-owner'), marker);
    try {
      const environment = { ...process.env };
      delete environment.ELECTRON_RUN_AS_NODE;
      delete environment.ELECTRON_NO_ASAR;
      await new Promise((resolve, reject) => {
        const child = spawn(require('electron'), [__filename, `--preview-profile=${profile}`], {
          env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
        });
        let log = '';
        child.stdout.on('data', chunk => { log += chunk; });
        child.stderr.on('data', chunk => { log += chunk; });
        const timer = setTimeout(() => child.kill(), 30000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('close', code => {
          clearTimeout(timer);
          if (code !== 0) reject(new Error(log || `Preview exited with ${code}`));
          else resolve();
        });
      });
      console.log(output);
    } finally {
      const resolved = await fs.realpath(profile);
      const relative = path.relative(parent, resolved);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)
        || path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('stringroom-preview-')
        || await fs.readFile(path.join(resolved, '.preview-owner'), 'utf8') !== marker) {
        throw new Error('Refusing to delete an unverified preview profile.');
      }
      await fs.rm(resolved, { recursive: true, force: true, maxRetries: 12, retryDelay: 150 });
    }
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const { app, BrowserWindow, protocol, session } = require('electron');
  const { APP_URL, CSP, assetForUrl, isLocalRequest } = require('../electron/policy.cjs');
  const profile = process.argv.find(arg => arg.startsWith('--preview-profile='))?.slice('--preview-profile='.length);
  if (!profile || !path.isAbsolute(profile)) throw new Error('An absolute disposable profile is required.');
  app.setPath('userData', profile);
  app.commandLine.appendSwitch('mute-audio');
  protocol.registerSchemesAsPrivileged([{ scheme: 'stringroom', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
  app.whenReady().then(async () => {
    const ses = session.defaultSession;
    ses.setPermissionCheckHandler(() => false);
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isLocalRequest(details.url) }));
    ses.protocol.handle('stringroom', async request => {
      const asset = assetForUrl(request.url, path.join(root, 'dist'));
      if (!asset) return new Response('Not found', { status: 404 });
      try {
        return new Response(await fs.readFile(asset.file), { headers: { 'Content-Type': asset.type, 'Content-Security-Policy': CSP } });
      } catch { return new Response('Not found', { status: 404 }); }
    });
    const window = new BrowserWindow({ width: 1160, height: 820, useContentSize: true, show: false,
      backgroundColor: '#f5f4ee', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    await window.loadURL(APP_URL);
    await window.webContents.executeJavaScript(`(async () => {
      for (let attempt = 0; attempt < 100 && !document.querySelector('[data-tuning-id="guitar-open-c"] .preset-select'); attempt++) await new Promise(resolve => setTimeout(resolve, 50));
      const row = document.querySelector('[data-tuning-id="guitar-open-c"]');
      if (!row) throw new Error('Open C did not render');
      const select = row.querySelector('.preset-select') || row.querySelector('button:not([data-reorder-handle])');
      if (!select) throw new Error('Tuning select button missing');
      select.click();
      await document.fonts.ready;
      await new Promise(resolve => setTimeout(resolve, 350));
      if (document.getElementById('current-tuning').textContent !== 'Open C') throw new Error('Open C was not selected');
      if (document.getElementById('listening-status').textContent.trim() !== 'Microphone off') throw new Error('Microphone should stay off');
    })()`);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, (await window.webContents.capturePage()).toPNG());
    app.exit(0);
  }).catch(error => { console.error(error); app.exit(1); });
}
