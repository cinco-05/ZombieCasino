import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player } from '../src/player.js';
import { Game } from '../src/game.js';

test('walk, sprint and jump produce distinct first-person motion', () => {
  const previousDocument = globalThis.document;
  globalThis.document = new EventTarget();
  const game = {
    state: 'COMBAT',
    settings: { sensitivity: 1 },
    camera: new THREE.PerspectiveCamera(76, 1, 0.1, 200),
    arena: { collide: (position) => position },
    ui: { updateHUD() {}, damage() {}, prompt() {} },
    debug: { invuln: false },
  };
  const player = new Player(game);
  game.player = player;

  player.keys.KeyW = true;
  player.update(0.1);
  const walkDistance = 8 - player.pos.z;

  player.reset();
  player.keys.KeyW = true;
  player.keys.ShiftLeft = true;
  player.update(0.1);
  const sprintDistance = 8 - player.pos.z;
  assert.ok(sprintDistance > walkDistance, 'sprint should be faster than walking');

  player.reset();
  player.keys.Space = true;
  player.update(0.05);
  assert.equal(player.onGround, false);
  assert.ok(player.pos.y > 1.7, 'jump should raise the camera');
  globalThis.document = previousDocument;
});

test('pause, resume and restart preserve the intended game-state flow', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { pointerLockElement: null };
  const shown = [];
  const hidden = [];
  const game = Object.assign(Object.create(Game.prototype), {
    state: 'COMBAT',
    ui: {
      requestPointer() {}, show: (id) => shown.push(id), hide: (id) => hidden.push(id),
      hideAllPanels() {}, updateHUD() {},
    },
  });
  game.pause();
  assert.equal(game.state, 'PAUSED');
  assert.deepEqual(shown, ['pause-menu']);
  game.resume();
  assert.equal(game.state, 'COMBAT');
  assert.deepEqual(hidden, ['pause-menu']);

  const calls = [];
  Object.assign(game, {
    bosses: [], stats: {}, chips: 999, combo: 4, round: 7,
    player: { reset: () => calls.push('player') },
    weapons: { reset: () => calls.push('weapons') },
    enemies: { clearAll: () => calls.push('enemies') },
    pickups: { clear: () => calls.push('pickups') },
    casino: { reset: () => calls.push('casino') },
    upgrades: { reset: () => calls.push('upgrades') },
    arena: { setRedAlert() {}, setLowLight() {} },
    beginRound: () => calls.push('beginRound'),
  });
  game.newRun();
  assert.equal(game.round, 1);
  assert.equal(game.chips, 0);
  assert.deepEqual(calls, ['player', 'weapons', 'enemies', 'pickups', 'casino', 'upgrades', 'beginRound']);
  globalThis.document = previousDocument;
});
