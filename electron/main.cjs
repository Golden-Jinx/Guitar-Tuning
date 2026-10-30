'use strict';

const { app, BrowserWindow, Menu, protocol, session, shell, dialog, screen } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { APP_URL, CSP, assetForUrl, isAppDocument, allowAudioCheck, allowAudioRequest, isAllowedExternal, isLocalRequest } = require('./policy.cjs');

const smoke = process.argv.includes('--smoke-test');
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const smokeOutput = smoke ? option('smoke-output') : null;
app.setName('Stringroom');
app.setAppUserModelId('com.stringroom.tuner');
app.setPath('userData', path.join(app.getPath('appData'), 'Stringroom'));
if (smoke) {
  const userData = option('smoke-user-data');
  if (!userData || !path.isAbsolute(userData) || !smokeOutput || !path.isAbsolute(smokeOutput)) throw new Error('Smoke mode requires absolute output and user data paths.');
  app.setPath('userData', userData);
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('mute-audio');
}
protocol.registerSchemesAsPrivileged([
  { scheme: 'stringroom', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

let mainWindow;
const hasLock = smoke || app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show(); mainWindow.focus();
  });
  app.whenReady().then(launch).catch(fatal);
}

async function openExternal(url) {
  if (isAllowedExternal(url)) await shell.openExternal(url);
}

async function launch() {
  const assets = path.join(app.getAppPath(), 'dist');
  const ses = session.defaultSession;
  ses.protocol.handle('stringroom', async request => {
    const asset = assetForUrl(request.url, assets);
    if (!asset || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
    try {
      const body = request.method === 'HEAD' ? null : await fs.readFile(asset.file);
      return new Response(body, { headers: { 'Content-Type': asset.type, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  ses.setPermissionCheckHandler((contents, permission, origin, details) =>
    contents === mainWindow?.webContents && allowAudioCheck(permission, origin, details));
  ses.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(contents === mainWindow?.webContents && allowAudioRequest(permission, details)));
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isLocalRequest(details.url) }));
  ses.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ title: 'Export custom tunings', defaultPath: 'stringroom-tunings.json', filters: [{ name: 'JSON backup', extensions: ['json'] }] });
  });

  const area = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    title: 'Stringroom', width: Math.min(1160, area.width - 32), height: Math.min(820, area.height - 32),
    minWidth: Math.min(480, area.width - 32), minHeight: Math.min(560, area.height - 32),
    backgroundColor: '#f5f4ee', icon: path.join(app.getAppPath(), 'dist', 'icon-512.png'),
    show: false, autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: false, backgroundThrottling: !smoke }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => { if (!isAppDocument(url)) event.preventDefault(); });
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.on('closed', () => { mainWindow = null; });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [{ role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { label: 'Help', submenu: [
      { label: 'About Stringroom', click: () => dialog.showMessageBox(mainWindow, { title: 'Stringroom', message: `Stringroom ${app.getVersion()}`, detail: 'Guitar & bass tuner. Audio is processed on this device.\nCustom tunings are stored on this computer.', buttons: ['OK'] }) },
      { label: 'Web version', click: () => { void openExternal('https://stringroom-tuner-1029.nifty-joy-6371.chatgpt.site/').catch(() => {}); } }
    ] }
  ]));
  await mainWindow.loadURL(APP_URL);
  if (smoke) {
    const report = await require('./smoke.cjs').runSmoke(mainWindow, { outputPath: smokeOutput });
    app.exit(report.ok ? 0 : 1);
  } else mainWindow.show();
}

async function fatal(error) {
  if (smoke && smokeOutput) {
    await fs.mkdir(path.dirname(smokeOutput), { recursive: true });
    await fs.writeFile(smokeOutput, JSON.stringify({ ok: false, errors: [error.stack || String(error)] }, null, 2));
  } else dialog.showErrorBox('Stringroom could not start', error.message || String(error));
  app.exit(1);
}
app.on('window-all-closed', () => app.quit());
