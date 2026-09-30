// debug.js — the F3 developer panel. Deliberately styled unlike the game UI
// so it can't be mistaken for a player-facing feature.

import { Audio } from './audio.js';

export function initDebug(game) {
  const panel = document.getElementById('debug-panel');
  const rows = [
    ['+500 chips', () => game.addChips(500)],
    ['Full heal', () => game.player.heal(999)],
    ['Refill ammo', () => game.weapons.refillAll()],
    ['Toggle invulnerable', () => { game.debug.invuln = !game.debug.invuln; flash(`invuln: ${game.debug.invuln}`); }],
    ['Skip round (win it)', () => {
      if (game.state === 'PAUSED' && game._stateBeforePause === 'COMBAT') game.resume();
      if (game.state !== 'COMBAT') return flash('need a round in progress');
      game.enemies.clearAll();
      game.bosses.forEach((b) => { if (!b.dead) { b.hp = 1; b.takeDamage(999, false, null); } });
      flash('round skipped');
    }],
    ['Jump to Round 5 (miniboss)', () => { game.newRun(); game.round = 4; jumpNote(); }],
    ['Jump to Round 10 (final boss)', () => { game.newRun(); game.round = 9; game.addChips(400); jumpNote(); }],
    ['Rig next blackjack: WIN', () => { game.debug.forceBJ = 'win'; flash('BJ rigged: win'); }],
    ['Rig next blackjack: LOSS', () => { game.debug.forceBJ = 'loss'; flash('BJ rigged: loss'); }],
    ['Rig next blackjack: PUSH', () => { game.debug.forceBJ = 'push'; flash('BJ rigged: push'); }],
    ['Rig next roulette: WIN', () => { game.debug.forceRoulette = 'win'; flash('roulette rigged: win'); }],
    ['Rig next roulette: LOSS', () => { game.debug.forceRoulette = 'loss'; flash('roulette rigged: loss'); }],
    ['+3 lethals, +3 tacticals', () => { game.player.grenades += 3; game.player.tacticals += 3; game.ui.updateHUD(); flash('gear+'); }],
    ['Give a random gun', () => {
      const ids = Object.keys(game.weapons.arsenal).filter((id) => !game.weapons.owns(id));
      game.weapons.give(ids[Math.floor(Math.random() * ids.length)]);
    }],
    ['Open every door', () => { for (const d of game.arena.doors) game.arena.openZone(d.zone); }],
    ['+2000 chips', () => game.addChips(2000)],
    ['— LADY LUCK / ALL IN —', null],
    ['Give all 3 Lady Luck parts', () => { ['zero', 'dice', 'arm'].forEach((k) => game.wonder.collect(k)); flash('parts on the tray at THE CAGE'); }],
    ['Hand me Lady Luck', () => {
      ['zero', 'dice', 'arm'].forEach((k) => game.wonder.collect(k));
      game.wonder.built = true; game.wonder.state = 'taken'; game.wonder._syncBench(); game.ui.updateParts();
      game.weapons.give('luck');
    }],
    ['ALL IN the gun in my hands', () => { flash(game.weapons.packCurrent() ? `packed: ${game.weapons.current.name}` : 'already packed'); }],
    ['— SPAWN (during a round) —', null],
    ['Spawn THE KING', () => spawn('king')],
    ['Spawn 4 showgirls', () => { for (let i = 0; i < 4; i++) spawn('showgirl'); }],
    ['Spawn a JACKPOT (drops the arm)', () => spawn('jackpot')],
    ['— TELEPORT —', null],
    ['To THE CAGE (Lady Luck bench)', () => tp(3, game.arena.bench.front)],
    ['To ALL IN (High Limit Room)', () => tp(1, game.arena.allIn.front)],
    ['To the craps table', () => tp(0, { x: 0, z: -13.4 })],
    ['To the house wheel', () => tp(0, { x: 0, z: -0.3 })],
    ['— OTHER —', null],
    ['Apply mild penalty', () => game.casino.applyPenalty('mild')],
    ['Apply moderate penalty', () => game.casino.applyPenalty('moderate')],
    ['Apply severe penalty', () => game.casino.applyPenalty('severe')],
    ['Offer COMMON upgrade', () => game.upgrades.offer('common')],
    ['Offer RARE upgrade', () => game.upgrades.offer('rare')],
    ['Offer LEGENDARY upgrade', () => game.upgrades.offer('legendary')],
    ['Band: skip to the next tune', () => { Audio.nextSong(); flash(Audio.nowPlaying?.title || 'no audio yet'); }],
  ];

  function spawn(kind) {
    game.enemies.spawnQueue.unshift({ kind, elite: false });
    flash(game.state === 'COMBAT' || game.state === 'PAUSED' ? `${kind} incoming` : `${kind} queued for the next round`);
  }
  function tp(zone, at) {
    if (zone) game.arena.openZone(zone, true);
    game.player.pos.set(at.x, game.player.pos.y, at.z + (zone === 0 ? 0 : 0.5));
    game.player.yaw = 0;
    flash('teleported');
  }

  function jumpNote() {
    // newRun() already kicked off round 1's countdown; the next round-clear
    // will advance from the round we just set. Simplest correct jump: clear
    // the freshly loaded round immediately.
    setTimeout(() => {
      game.enemies.clearAll();
      if (game.state === 'COMBAT' || game.state === 'COUNTDOWN') {
        game.setState('COMBAT');
        game.onRoundCleared();
      }
    }, 100);
    flash('jumping…');
  }

  const head = document.createElement('div');
  head.className = 'dbg-head';
  head.textContent = 'DEBUG (F3) — press ESC to free the mouse, then click';
  panel.appendChild(head);

  const stat = document.createElement('div');
  stat.className = 'dbg-stat';
  panel.appendChild(stat);

  const note = document.createElement('div');
  note.className = 'dbg-note';
  panel.appendChild(note);
  function flash(msg) { note.textContent = msg; setTimeout(() => { if (note.textContent === msg) note.textContent = ''; }, 2500); }

  for (const [label, fn] of rows) {
    if (!fn) {                                    // a section heading
      const h = document.createElement('div');
      h.className = 'dbg-head';
      h.textContent = label;
      panel.appendChild(h);
      continue;
    }
    const b = document.createElement('button');
    b.className = 'dbg-btn';
    b.textContent = label;
    b.onclick = fn;
    panel.appendChild(b);
  }

  // FPS + entity counter
  let frames = 0, last = performance.now();
  (function tick() {
    requestAnimationFrame(tick);
    frames++;
    const now = performance.now();
    if (now - last >= 1000) {
      stat.textContent = `FPS ${frames} · state ${game.state} · enemies ${game.enemies.list.length} · projectiles ${game.enemies.projectiles.length}`;
      frames = 0; last = now;
    }
  })();

  return {
    toggle() {
      game.debug.show = !game.debug.show;
      panel.classList.toggle('hidden', !game.debug.show);
    },
  };
}
