import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const args = [require.resolve('electron-builder/cli.js'), '--win', '--x64', '--publish', 'never'];
const child = spawn(process.execPath, args, {
  stdio: 'inherit', windowsHide: true,
  // Level 5 keeps repeat builds fast while still compressing the bundled runtime.
  env: { ...process.env, ELECTRON_BUILDER_COMPRESSION_LEVEL: '5', CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
