import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { UI } from '../src/ui.js';
import { Casino } from '../src/casino.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('the exact uploaded HTML is completed by UI before Casino wires its controls', () => {
  const dom = new JSDOM(readFileSync(resolve(root, 'index.html'), 'utf8'), {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;

  const game = {
    renderer: { domElement: document.getElementById('game-canvas') },
    settings: {},
    stats: {},
    chips: 0,
    round: 1,
    debug: {},
  };
  game.ui = new UI(game);
  game.casino = new Casino(game);

  for (const id of [
    'buy-grenade', 'buy-rifle', 'btn-slots', 'slots-panel', 'slots-spin',
    'slots-close', 'btn-controls-main', 'controls-panel', 'btn-controls-close',
  ]) assert.ok(document.getElementById(id), `expected #${id}`);

  const sensitivity = document.getElementById('set-sensitivity');
  sensitivity.value = '1.7';
  sensitivity.dispatchEvent(new dom.window.Event('input'));
  assert.equal(game.settings.sensitivity, 1.7);
  assert.equal(JSON.parse(localStorage.getItem('hotu.settings.v1')).sensitivity, 1.7);

  dom.window.close();
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.localStorage;
});
