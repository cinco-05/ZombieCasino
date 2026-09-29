import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const originalHashes = new Map([
  ['index.html', 'e3b63203daa64229516a89bf3a71e4238de99f5244303c4bcce48c0b3b6713e6'],
  ['src/main.js', '03c3d4362a6fd02e61a9576162d986311b96c89c4959e74bdcbca047ec1b6df3'],
  ['src/debug.js', '2b88570356131c862f1000257983b9d5486f37fc75c14699706b04e5545e0144'],
  ['src/game.js', 'fcca38200ec25a79db6b193b54575aeeda2bfe2fd823b03ba392896b2e1074f4'],
  ['src/casino.js', 'a605015a71bb00600f98e552a3718dc59a29f14b798d3b30708ed0dd0eaf81ac'],
  ['src/enemies.js', 'cba745b9fed9c356b61f8de71b2370f032669db9279f39ebe01e7598e04477cc'],
  ['src/weapons.js', '406509a8e01551db5431071c994e69f1da9aa51f82c36e891155ca796bac0dec'],
  ['src/upgrades.js', '62508bcef7fa15018d8df287de941a7f5f92ae33b8d27458411ac2e3c99baa89'],
  ['src/bosses.js', '87f56264de3a2437465bb300265d943a0f19116353a02520041b3bcc04da09aa'],
]);

const failures = [];
const walk = (directory) => readdirSync(directory).flatMap((name) => {
  const path = join(directory, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

for (const [relative, expected] of originalHashes) {
  const actual = createHash('sha256').update(readFileSync(join(root, relative))).digest('hex');
  if (actual !== expected) failures.push(`${relative} no longer matches the uploaded file`);
}

const jsFiles = [...walk(join(root, 'src')), join(root, 'vite.config.js')].filter((path) => extname(path) === '.js');
for (const file of jsFiles) {
  const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (syntax.status !== 0) failures.push(`${file}: ${syntax.stderr.trim()}`);
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/(?:from\s+|import\s*)['"](\.\.?\/[^'"]+)['"]/g)) {
    const target = resolve(dirname(file), match[1]);
    if (!existsSync(target)) failures.push(`${file} imports missing ${match[1]}`);
  }
}

for (const required of [
  'package.json', 'vite.config.js', 'README.md', 'styles/main.css',
  'vendor/three.module.js', 'vendor/three.core.js', 'vendor/THREE-LICENSE.txt',
  'src/config.js', 'src/audio.js', 'src/ui.js', 'src/player.js', 'src/arena.js',
  'src/pickups.js', 'src/cards.js',
]) {
  if (!existsSync(join(root, required))) failures.push(`missing required file ${required}`);
}

const domSources = readFileSync(join(root, 'index.html'), 'utf8') + readFileSync(join(root, 'src/ui.js'), 'utf8');
for (const file of jsFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\$\(['"]([^'"]+)['"]\)/g)) {
    const id = match[1];
    if (!domSources.includes(`id="${id}"`) && !domSources.includes(`id='${id}'`)) failures.push(`${file} references missing DOM id ${id}`);
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `FAIL: ${failure}`).join('\n'));
  process.exit(1);
}
console.log(`Project verification passed: ${jsFiles.length} JS files, all local imports present, original files unchanged.`);
