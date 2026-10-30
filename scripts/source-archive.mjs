import { spawnSync } from 'node:child_process';
import { lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Invalid package version');

// Explicit source roots keep caches, local Git credentials and built output out of the archive.
const sourceRoots = [
  'README.md', '.gitignore', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  'electron', 'dist', 'build', 'scripts', 'tests', '.github', 'docs',
];
const filenames = [];
async function collect(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`Source archive refuses symlinks: ${relative(root, path)}`);
  if (info.isDirectory()) {
    for (const entry of (await readdir(path)).sort()) await collect(join(path, entry));
  } else if (info.isFile()) {
    const name = relative(root, path).replaceAll('\\', '/');
    if (/(?:^|\/)(?:node_modules|release|\.git|\.smoke-[^/]*)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|pfx|p12|log)$/i.test(name)) {
      throw new Error(`Unexpected private or generated file in source: ${name}`);
    }
    filenames.push(name);
  }
}
for (const entry of sourceRoots) await collect(join(root, entry));
await mkdir(join(root, 'release'), { recursive: true });
const output = join(root, 'release', `Stringroom-${version}-Source.tar.gz`);
const result = spawnSync('tar', ['-czf', output, '-C', root, '--', ...filenames], {
  encoding: 'utf8', windowsHide: true,
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Source archive failed: ${result.stderr || result.stdout}`);
console.log(`Created ${output} (${filenames.length} source files)`);
