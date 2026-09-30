// wonder.js — LADY LUCK, the house's wonder weapon. She's built at THE CAGE
// in the Counting Room from three parts, each won from a different game:
//   THE GREEN ZERO    land the ball on green (shop roulette, or the house wheel)
//   THE LOADED DICE   roll a natural at the craps table on the grand floor
//   THE BANDIT'S ARM  cash out a walking JACKPOT before it gets away
// Also runs the two floor games you can play mid-round: the house wheel on
// the dais and the craps table. Parts sit on the bench's velvet tray as you
// win them; with all three she can be assembled and taken.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Audio } from './audio.js';
import { PARTS } from './catalog.js';
import { Seed } from './rng.js';
import { buildWorldGun } from './gfx/viewmodels.js';
import { dieFaceUp } from './gfx/vegas.js';

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const ASSEMBLE_TIME = 2.2;
const REFILL = 250;               // re-rack her reels at the cage

export class Wonder {
  constructor(game) {
    this.game = game;
    this.parts = new Set();
    this.built = false;
    this.greenMisses = 0;
    this.diceMisses = 0;
    this.state = 'idle';           // idle | assembling | ready (on the bench) | taken
    this.t = 0;
    this.gunMesh = null;
    this.roll = null;              // the craps dice in flight
  }

  has(key) { return this.parts.has(key); }
  get complete() { return this.parts.size === 3; }

  /**
   * the chance a roulette spin lands on green. The house is a single-zero
   * wheel (1 in 37) but while you still need the part it gets kinder every
   * time you miss — a pity timer, so nobody grinds forever.
   */
  greenChance() {
    if (this.has('zero') || this.built) return 1 / 37;
    return Math.min(0.5, 0.03 + 0.07 * this.greenMisses);
  }

  /** a spin that didn't hit green while you still needed it */
  missGreen() {
    if (!this.has('zero') && !this.built) this.greenMisses++;
  }

  collect(key) {
    if (this.has(key) || this.built) return;
    const g = this.game;
    this.parts.add(key);
    if (key === 'zero') this.greenMisses = 0;
    const def = PARTS[key];
    const left = 3 - this.parts.size;
    g.ui.banner(`${def.icon} ${def.name} — ${left ? `${left} part${left === 1 ? '' : 's'} to LADY LUCK` : 'LADY LUCK CAN BE BUILT AT THE CAGE'}`, 'gold', 3200);
    Audio.play('part_get');
    this._syncBench();
    g.ui.updateParts?.();
  }

  _syncBench() {
    const b = this.game.arena.bench;
    if (!b) return;
    for (const [k, m] of Object.entries(b.slots)) m.visible = this.has(k) && !this.built;
  }

  // ------------------------------ interactables ------------------------------
  interactables() {
    const a = this.game.arena;
    const list = [];
    if (a.bench) {
      list.push({
        pos: a.bench.front, facing: a.bench.facing, radius: 2.6, zone: a.zoneAtRaw(a.bench.pos.x, a.bench.pos.z),
        label: () => this._benchLabel(),
        cost: () => this._benchCost(),
        use: () => this._benchUse(),
      });
    }
    // the house wheel on the dais — ringed all the way round, so no facing
    list.push({
      pos: new THREE.Vector3(0, 0, -4), radius: 4.4, zone: 0,
      label: () => this._wheelLabel(),
      cost: () => (a.houseSpin ? null : CONFIG.houseWheel.price),
      use: () => this._wheelUse(),
    });
    if (a.craps) {
      list.push({
        pos: a.craps.pos, radius: 3.4, zone: 0,
        label: () => this._crapsLabel(),
        cost: () => (this.roll ? null : CONFIG.craps.price),
        use: () => this._crapsUse(),
      });
    }
    return list;
  }

  // -------------------------------- THE CAGE ---------------------------------
  _benchCost() {
    if (this.state === 'taken' && this.game.weapons.owns('luck')) return REFILL;
    return null;
  }

  _benchLabel() {
    const w = this.game.weapons;
    const col = '#2dff7a';
    if (this.state === 'assembling') return { title: 'THE CAGE', sub: 'The locksmith is fitting her together…', cost: null, icon: '🔧', color: col };
    if (this.state === 'ready') return { title: 'TAKE LADY LUCK', sub: w.slots.slice(0, w.maxSlots).every(Boolean) ? `Swaps for the ${w.current.name} in your hands` : 'Goes into your empty slot', cost: null, action: 'TAKE', icon: '🍀', color: col };
    if (this.state === 'taken') {
      if (w.owns('luck')) return { title: 'RE-RACK LADY LUCK', sub: 'The cage refills her reels', cost: REFILL, icon: '🍀', color: col };
      return { title: 'TAKE LADY LUCK', sub: "She's been waiting for you", cost: null, action: 'TAKE', icon: '🍀', color: col };
    }
    if (this.complete) return { title: 'ASSEMBLE LADY LUCK', sub: 'All three parts are on the tray', cost: null, action: 'BUILD', icon: '🍀', color: col };
    const missing = Object.keys(PARTS).filter((k) => !this.has(k));
    const next = PARTS[missing[0]];
    return {
      title: `THE CAGE — LADY LUCK ${this.parts.size}/3`,
      sub: `${missing.map((k) => PARTS[k].name).join(' · ')} still missing. ${next.how}`,
      cost: null, action: 'LOOK', icon: '🍀', color: col,
    };
  }

  _benchUse() {
    const g = this.game;
    if (this.state === 'assembling') return;
    if (this.state === 'ready' || (this.state === 'taken' && !g.weapons.owns('luck'))) {
      this._clearGun();
      g.weapons.give('luck');
      this.state = 'taken';
      Audio.play('luck_raise');
      g.ui.updateParts?.();
      return;
    }
    if (this.state === 'taken') {
      if (g.chips < REFILL) { Audio.play('dryfire'); g.ui.prompt(`The cage wants ${REFILL} chips to re-rack her`); return; }
      g.chips -= REFILL;
      const w = g.weapons.arsenal.luck;
      w.mag = w.magSize; w.reserve = w.maxReserve;
      g.ui.banner(`${w.name} — RE-RACKED`, 'green', 1800);
      Audio.play('ammo');
      g.ui.updateHUD();
      return;
    }
    if (!this.complete) { g.ui.prompt(this._benchLabel().sub, 3200); return; }
    this.state = 'assembling';
    this.t = 0;
    g.audioAt('allin_start', g.arena.bench.pos.clone().setY(1.2));
  }

  _clearGun() {
    if (!this.gunMesh) return;
    this.game.scene.remove(this.gunMesh);
    this.gunMesh = null;
  }

  _placeGun() {
    const b = this.game.arena.bench;
    const m = buildWorldGun('luck');
    m.scale.setScalar(1.8);
    m.position.copy(b.group.localToWorld(b.gunAnchor.clone()));
    m.rotation.set(0, Math.PI / 2, 0);
    this.game.scene.add(m);
    this.gunMesh = m;
  }

  // ------------------------------ the house wheel -----------------------------
  _wheelLabel() {
    if (this.game.arena.houseSpin) return { title: 'THE HOUSE WHEEL', sub: 'No more bets…', cost: null, icon: '🎡', color: '#2dff7a' };
    const want = !this.has('zero') && !this.built;
    return {
      title: 'SPIN THE HOUSE WHEEL',
      sub: want ? 'Green takes THE GREEN ZERO · red pays 2 to 1 · black takes your chips'
        : 'Green pays 35 to 1 · red pays 2 to 1 · black takes your chips',
      cost: CONFIG.houseWheel.price, icon: '🎡', color: '#2dff7a',
    };
  }

  _wheelUse() {
    const g = this.game, a = g.arena;
    const price = CONFIG.houseWheel.price;
    if (a.houseSpin) return;
    if (g.chips < price) { Audio.play('dryfire'); g.ui.prompt(`The house wheel takes ${price} chips a spin`); return; }
    // decide now, reveal when the ball drops
    const n = Seed.random('floor') < this.greenChance() ? 0 : 1 + Seed.int('floor', 36);
    if (!a.spinHouseWheel(() => this._wheelLanded(n))) return;
    g.chips -= price;
    Audio.play('chip');
    g.ui.updateHUD();
  }

  _wheelLanded(n) {
    const g = this.game;
    const at = { x: 0, y: 1.4, z: -4 };
    if (n === 0) {
      if (!this.has('zero') && !this.built) {
        this.collect('zero');
        g.effects.spawnBurst(new THREE.Vector3(0, 1.6, -4), 0x2dff7a, 24, 6);
      } else {
        const win = CONFIG.houseWheel.price * 35;
        g.addChips(win);
        g.ui.banner(`● 0 GREEN — THE HOUSE PAYS 35 TO 1 +${win}`, 'green', 2800);
        g.audioAt('jackpot', at);
      }
      return;
    }
    this.missGreen();
    if (RED.has(n)) {
      const win = CONFIG.houseWheel.price * 2;
      g.addChips(win);
      g.ui.banner(`● ${n} RED — PAYS +${win}`, 'red', 2200);
      g.audioAt('wager_win', at);
    } else {
      g.ui.banner(`● ${n} BLACK — THE HOUSE THANKS YOU`, 'gold', 2200);
      g.audioAt('wager_lose', at);
    }
  }

  // --------------------------------- craps ------------------------------------
  _crapsLabel() {
    if (this.roll) return { title: 'THE CRAPS TABLE', sub: 'Dice are out…', cost: null, icon: '🎲', color: '#ff2d55' };
    const want = !this.has('dice') && !this.built;
    return {
      title: 'ROLL THE BONES',
      sub: want ? 'A natural (7 or 11) wins THE LOADED DICE · 2, 3 or 12 is craps'
        : 'A natural pays 2 to 1 · 2, 3 or 12 is craps · any point gets half back',
      cost: CONFIG.craps.price, icon: '🎲', color: '#ff2d55',
    };
  }

  _crapsUse() {
    const g = this.game, c = g.arena.craps;
    const price = CONFIG.craps.price;
    if (this.roll) return;
    if (g.chips < price) { Audio.play('dryfire'); g.ui.prompt(`The stickman wants ${price} chips a roll`); return; }
    g.chips -= price;
    g.ui.updateHUD();
    Audio.play('chip');
    // roll them honestly... unless the table's felt sorry for you
    let a = 1 + Seed.int('floor', 6), b = 1 + Seed.int('floor', 6);
    const want = !this.has('dice') && !this.built;
    if (want && this.diceMisses >= 4) { a = 5; b = 2; }
    // throw from your end of the table toward the far wall
    const local = c.group.worldToLocal(g.player.pos.clone());
    const dir = local.x < 0 ? 1 : -1;
    const hx = c.half[0] - 0.3;
    this.roll = {
      t: 0, a, b, dir, done: false,
      dice: c.dice.map((d, i) => ({
        mesh: d,
        from: new THREE.Vector3(-dir * (hx - 0.4), c.bedY + 0.35, (i ? 0.25 : -0.15) + (Math.random() - 0.5) * 0.3),
        wall: dir * hx,
        rest: new THREE.Vector3(dir * (hx - 0.45 - Math.random() * 0.5), c.bedY, (i ? 0.3 : -0.2) + (Math.random() - 0.5) * 0.5),
        spin: new THREE.Vector3(8 + Math.random() * 8, 4 + Math.random() * 6, 8 + Math.random() * 8),
        yaw: Math.random() * Math.PI * 2,
      })),
    };
    g.audioAt('dice_roll', c.pos.clone().setY(1.1));
  }

  _updateRoll(dt) {
    const r = this.roll;
    if (!r) return;
    const c = this.game.arena.craps;
    r.t += dt;
    const T1 = 0.55, T2 = 1.15;   // fly to the back wall, bounce back and settle
    for (const d of r.dice) {
      const m = d.mesh;
      if (r.t < T1) {
        const k = r.t / T1;
        m.position.set(d.from.x + (d.wall - d.from.x) * k, c.bedY + (d.from.y - c.bedY) * (1 - k) + Math.abs(Math.sin(k * Math.PI * 2)) * 0.12 * (1 - k), d.from.z + (d.rest.z - d.from.z) * k * 0.6);
        m.rotation.x += d.spin.x * dt; m.rotation.y += d.spin.y * dt; m.rotation.z += d.spin.z * dt;
      } else if (r.t < T2) {
        const k = (r.t - T1) / (T2 - T1);
        const e = 1 - Math.pow(1 - k, 2);
        const z0 = d.from.z + (d.rest.z - d.from.z) * 0.6;
        m.position.set(d.wall + (d.rest.x - d.wall) * e, c.bedY + Math.abs(Math.sin(k * Math.PI * 3)) * 0.06 * (1 - k), z0 + (d.rest.z - z0) * e);
        if (k < 0.6) { m.rotation.x += d.spin.x * dt * (1 - k); m.rotation.z += d.spin.z * dt * (1 - k); m.rotation.y += d.spin.y * dt; }
        else {
          if (!d.settled) { d.settled = true; m.rotation.y = d.yaw; dieFaceUp(m, d === r.dice[0] ? r.a : r.b); }
          m.rotation.y += dt * 3 * (1 - k);
        }
      } else if (!r.done) {
        m.position.copy(d.rest);
      }
    }
    if (r.t >= T2 && !r.done) { r.done = true; this._crapsLanded(r.a, r.b); }
    if (r.t > T2 + 1.2) this.roll = null;
  }

  _crapsLanded(a, b) {
    const g = this.game, c = g.arena.craps;
    const sum = a + b;
    const at = c.pos.clone().setY(1.2);
    const want = !this.has('dice') && !this.built;
    const price = CONFIG.craps.price;
    if (sum === 7 || sum === 11) {
      if (want) {
        this.diceMisses = 0;
        this.collect('dice');
        g.effects.spawnBurst(at.clone().setY(1.4), 0xff2d55, 20, 5);
      } else {
        g.addChips(price * 3);
        g.ui.banner(`⚅ ${a} + ${b} = ${sum} — NATURAL! +${price * 3}`, 'gold', 2400);
      }
      g.audioAt('cheer', at);
      return;
    }
    if (want) this.diceMisses++;
    if (sum === 2 || sum === 3 || sum === 12) {
      g.ui.banner(`⚅ ${a} + ${b} = ${sum} — CRAPS. THE HOUSE TAKES IT`, 'red', 2200);
      g.audioAt('wager_lose', at);
    } else {
      const back = Math.round(price / 2);
      g.addChips(back);
      g.ui.banner(`⚅ ${a} + ${b} — POINT IS ${sum}. The stickman slides back ${back}`, 'gold', 2200);
      g.audioAt('chip', at);
    }
  }

  // --------------------------------- loop -------------------------------------
  update(dt) {
    const g = this.game, b = g.arena.bench;
    this._updateRoll(dt);
    if (this.state === 'assembling') {
      this.t += dt;
      if (Math.random() < dt * 22) {
        const p = b.group.localToWorld(new THREE.Vector3((Math.random() - 0.5) * 1.2, 1.1, 0.08));
        g.effects.spawnBurst(p, Math.random() < 0.5 ? 0x2dff7a : 0xffd060, 4, 3);
      }
      if (this.t >= ASSEMBLE_TIME) {
        this.state = 'ready';
        this.built = true;
        g.progress?.bump('luckBuilt');
        this._syncBench();
        this._placeGun();
        g.effects.spawnLuckSpark?.(b.group.localToWorld(b.gunAnchor.clone()));
        g.ui.banner('🍀 LADY LUCK IS BUILT — TAKE HER FROM THE CAGE', 'green', 3200);
        g.audioAt('jackpot', b.pos.clone().setY(1.2));
        g.ui.updateParts?.();
      }
    } else if (this.state === 'ready' && this.gunMesh) {
      this.t += dt;
      const base = b.group.localToWorld(b.gunAnchor.clone());
      this.gunMesh.position.copy(base).setY(base.y + 0.08 + Math.sin(this.t * 2) * 0.04);
      this.gunMesh.rotation.y += dt * 0.9;
    }
  }

  // ------------------------------ run lifecycle -------------------------------
  /** the round's over: dice, wheel and the build all finish on the spot */
  settle() {
    const r = this.roll;
    if (r && !r.done) {
      r.done = true;
      for (const d of r.dice) {
        d.mesh.position.copy(d.rest);
        d.mesh.rotation.y = d.yaw;
        dieFaceUp(d.mesh, d === r.dice[0] ? r.a : r.b);
      }
      this._crapsLanded(r.a, r.b);
    }
    this.roll = null;
    const hs = this.game.arena.houseSpin;
    if (hs && !hs.done) { hs.done = true; hs.onLand?.(); }
    if (this.state === 'assembling') { this.t = ASSEMBLE_TIME; this.update(0); }
  }

  reset() {
    this.parts.clear();
    this.built = false;
    this.greenMisses = 0;
    this.diceMisses = 0;
    this.state = 'idle';
    this.t = 0;
    this._clearGun();
    if (this.roll) {
      const c = this.game.arena.craps;
      for (const d of this.roll.dice) d.mesh.position.copy(d.rest).setY(c.bedY);
      this.roll = null;
    }
    this._syncBench();
    this.game.ui.updateParts?.();
  }

  save() {
    return { parts: [...this.parts], built: this.built, state: this.state, greenMisses: this.greenMisses, diceMisses: this.diceMisses };
  }

  restore(d) {
    this.reset();
    if (!d) return;
    for (const k of d.parts || []) if (PARTS[k]) this.parts.add(k);
    this.built = !!d.built;
    this.greenMisses = d.greenMisses || 0;
    this.diceMisses = d.diceMisses || 0;
    // mid-assembly saves finish building; an untaken gun waits on the bench
    this.state = d.state === 'assembling' ? 'ready' : (d.state || 'idle');
    if (this.state === 'ready') this._placeGun();
    this._syncBench();
    this.game.ui.updateParts?.();
  }
}
