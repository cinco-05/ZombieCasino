// build-html.mjs — the same single-file build as build-html.ps1, for anyone
// with Node instead of PowerShell (macOS, Linux, or Windows):
//
//   node build-html.mjs
//
// Writes ../HOUSE OF THE UNDEAD.html: the stylesheet inlined, every ES module
// (three.js + src/**) embedded as an inert <script type="hotu/module">, and a
// tiny loader that turns each into a blob: URL, installs an import map for the
// bare "three" and "@hotu/src/..." names, then imports main.js.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const out = join(dirname(root), 'HOUSE OF THE UNDEAD.html');
const read = (p) => readFileSync(p, 'utf8');
// never let embedded source close the tag early
const safe = (t) => t.replace(/<\/(script)/gi, '<\\/$1');
const walk = (d) => readdirSync(d).sort().flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const modules = new Map([['three', join(root, 'vendor', 'three.module.js')]]);
for (const f of walk(join(root, 'src')).filter((p) => p.endsWith('.js'))) {
  modules.set(`@hotu/${relative(root, f).split(sep).join('/')}`, f);
}

let scripts = '';
for (const [key, path] of modules) {
  let src = read(path);
  if (key !== 'three') {
    // rewrite relative imports to their bare "@hotu/..." key
    src = src.replace(/(\bfrom\s*|\bimport\s*)(['"])(\.{1,2}\/[^'"]+)\2/g, (m, kw, q, rel) =>
      `${kw}${q}@hotu/${relative(root, resolve(dirname(path), rel)).split(sep).join('/')}${q}`);
  }
  scripts += `<script type="hotu/module" data-key="${key}">${safe(src)}</script>\n`;
}

const loader = `<script>
(function () {
  var map = { imports: {} };
  document.querySelectorAll('script[type="hotu/module"]').forEach(function (s) {
    map.imports[s.dataset.key] = URL.createObjectURL(new Blob([s.textContent], { type: 'text/javascript' }));
  });
  var im = document.createElement('script');
  im.type = 'importmap';
  im.textContent = JSON.stringify(map);
  document.head.appendChild(im);
  var m = document.createElement('script');
  m.type = 'module';
  m.textContent = 'import "@hotu/src/main.js";';
  document.body.appendChild(m);
})();
</script>
`;

let html = read(join(root, 'index.html'));
const css = read(join(root, 'styles', 'main.css'));
const swap = (from, to) => {
  if (!html.includes(from)) throw new Error(`index.html layout changed: "${from}" not found`);
  html = html.replace(from, () => to);
};
swap('<link rel="stylesheet" href="styles/main.css">', `<style>\n${css}\n</style>`);
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '');
swap('<script src="vendor/peerjs.min.js"></script>', `<script>\n${safe(read(join(root, 'vendor', 'peerjs.min.js')))}\n</script>`);
swap('<script type="module" src="src/main.js"></script>', scripts + loader);
if (/src="src\/main.js"|href="styles\/|src="vendor\//.test(html)) throw new Error('index.html layout changed: loader not injected');

writeFileSync(out, html);
console.log(`built: ${out} (${(Buffer.byteLength(html) / 1048576).toFixed(1)} MB, ${modules.size} modules)`);
