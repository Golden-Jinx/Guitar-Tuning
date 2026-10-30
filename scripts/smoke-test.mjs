import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseRoot = path.join(desktopRoot, 'release');
const development = process.argv[2] === '--dev';
const executable = development ? createRequire(import.meta.url)('electron') : path.resolve(process.argv[2] || path.join(releaseRoot, 'win-unpacked', 'Stringroom.exe'));
const marker = randomUUID();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runName = `smoke-${path.basename(executable, '.exe').replace(/[^a-z0-9_-]/gi, '-')}-${stamp}`;
const outputDirectory = path.join(releaseRoot, runName);
const outputPath = path.join(outputDirectory, 'report.json');
const tempParent = await fs.realpath(os.tmpdir());
let temporaryRoot;
let result;

async function cleanupTemporaryProfile() {
  if (!temporaryRoot) return;
  const resolved = await fs.realpath(temporaryRoot);
  const relative = path.relative(tempParent, resolved);
  const ownership = await fs.readFile(path.join(resolved, '.stringroom-smoke-owner'), 'utf8');
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.dirname(resolved) !== tempParent || !path.basename(resolved).startsWith('stringroom-smoke-') || ownership !== marker) {
    throw new Error(`Refusing to remove an unverified temporary profile: ${resolved}`);
  }
  await fs.rm(resolved, { recursive: true, force: true, maxRetries: 12, retryDelay: 150 });
}

try {
  await fs.access(executable);
  await fs.mkdir(outputDirectory, { recursive: true });
  temporaryRoot = await fs.mkdtemp(path.join(tempParent, 'stringroom-smoke-'));
  await fs.writeFile(path.join(temporaryRoot, '.stringroom-smoke-owner'), marker, 'utf8');
  const userData = path.join(temporaryRoot, 'user-data');
  await fs.mkdir(userData);
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.ELECTRON_NO_ASAR;
  result = await new Promise((resolve, reject) => {
    const args = [...(development ? [desktopRoot] : []), '--smoke-test', `--smoke-output=${outputPath}`, `--smoke-user-data=${userData}`];
    const child = spawn(executable, args, { windowsHide: true, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let timedOut = false;
    const append = (label, value) => { if (chunks.reduce((sum, chunk) => sum + chunk.length, 0) < 100000) chunks.push(`${label}${value.toString()}`); };
    child.stdout.on('data', value => append('', value));
    child.stderr.on('data', value => append('[stderr] ', value));
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) {
        const terminator = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        terminator.on('error', () => child.kill());
      } else child.kill('SIGKILL');
    }, 45000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ executable, args, code, signal, timedOut, output: chunks.join('') });
    });
  });
  await fs.writeFile(path.join(outputDirectory, 'process.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  if (result.timedOut) throw new Error('Packaged smoke test exceeded its 45-second hard timeout.');
  const report = JSON.parse(await fs.readFile(outputPath, 'utf8'));
  for (const item of report.checks || []) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.error ? ': ' + item.error : ''}`);
  if (!report.ok) for (const error of report.errors || []) console.error(typeof error === 'string' ? error : error.message);
  if (result.code !== 0 || !report.ok) throw new Error(`Packaged smoke test failed (exit ${result.code}).`);
  console.log(`Smoke test passed. Report: ${outputPath}`);
} catch (error) {
  console.error(error.message);
  if (result?.output) console.error(result.output);
  console.error(`Diagnostics: ${outputDirectory}`);
  process.exitCode = 1;
} finally {
  try { await cleanupTemporaryProfile(); }
  catch (error) {
    console.error(`Temporary test profile was preserved: ${error.message}`);
    process.exitCode = 1;
  }
}
