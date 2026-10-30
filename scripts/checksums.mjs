import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const release = join(root, 'release');
const filenames = [
  `Stringroom-${version}-Windows-x64-Portable.exe`,
  `Stringroom-${version}-Windows-x64-Setup.exe`,
  `Stringroom-${version}-Source.tar.gz`,
];
const checksumFile = join(release, 'SHA256SUMS.txt');

async function sha256(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(join(release, filename))) hash.update(chunk);
  return hash.digest('hex');
}

const mode = process.argv.slice(2);
if (mode.length > 1 || (mode.length === 1 && mode[0] !== '--verify')) {
  throw new Error('Usage: node scripts/checksums.mjs [--verify]');
}

if (mode[0] === '--verify') {
  const entries = (await readFile(checksumFile, 'utf8')).trim().split(/\r?\n/);
  if (entries.length !== filenames.length) throw new Error('Unexpected checksum entry count');
  for (let i = 0; i < filenames.length; i += 1) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(entries[i]);
    if (!match || match[2] !== filenames[i]) throw new Error('Unexpected checksum filename');
    if (await sha256(match[2]) !== match[1]) throw new Error(`Checksum mismatch: ${match[2]}`);
    console.log(`Verified: ${match[2]}`);
  }
} else {
  const entries = [];
  for (const filename of filenames) entries.push(`${await sha256(filename)}  ${filename}`);
  await writeFile(checksumFile, `${entries.join('\n')}\n`, 'utf8');
  console.log(`Created ${checksumFile}`);
}
