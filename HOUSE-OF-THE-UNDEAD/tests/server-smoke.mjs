import { spawn } from 'node:child_process';
import { once } from 'node:events';

const child = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5188', '--strictPort',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let output = '';
child.stdout.on('data', (chunk) => { output += chunk; });
child.stderr.on('data', (chunk) => { output += chunk; });

const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Vite did not start:\n${output}`)), 10000);
  const inspect = () => {
    if (output.includes('Local:')) { clearTimeout(timeout); resolve(); }
  };
  child.stdout.on('data', inspect);
  child.stderr.on('data', inspect);
  child.once('exit', (code) => {
    clearTimeout(timeout);
    reject(new Error(`Vite exited with ${code}:\n${output}`));
  });
});

try {
  await ready;
  for (const path of ['/', '/styles/main.css', '/src/main.js', '/vendor/three.module.js']) {
    const response = await fetch(`http://127.0.0.1:5188${path}`);
    const body = await response.text();
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}:\n${body}\n${output}`);
    if (!body.length) throw new Error(`${path} returned an empty body`);
  }
  console.log('Development-server smoke test passed: Vite started and all entry assets returned HTTP 200.');
} finally {
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 2000))]);
}
