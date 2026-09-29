// allin.js — ALL IN, the house's own forge (this casino's pack-a-punch). It
// stands against the back wall of the High Limit Room. Push 1000 chips in and
// hand over the gun in your hands: the lever drops, the reels spin, the press
// slams, and it comes back gold-plated with a new name (catalog.js PACKED),
// double damage, deeper mags, and every kill spits chips.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Audio } from './audio.js';
import { PACKED } from './catalog.js';

const A = CONFIG.allIn;
const SEVEN = Math.PI / 8;            // reel angle that puts a 7 on the payline

export class AllIn {
  constructor(game) {
    this.game = game;
    this.t = -1;                       // < 0: idle
    this.gunId = null;
  }

  get busy() { return this.t >= 0; }

  interactable() {
    const m = this.game.arena.allIn;
    return {
      pos: m.front, facing: m.facing, radius: 2.8, zone: this.game.arena.zoneAtRaw(m.pos.x, m.pos.z),
      label: () => this._label(),
      cost: () => (this._blocked() ? null : A.price),
      use: () => this.use(),
    };
  }

  _blocked() {
    const w = this.game.weapons.current;
    return this.busy || !w || w.packed || !PACKED[w.id];
  }

  _label() {
    const w = this.game.weapons.current;
    const col = '#ff2d55';
    if (this.busy) return { title: 'ALL IN', sub: 'The house is working on it…', cost: null, icon: '🎰', color: col };
    if (w.packed) return { title: `${w.name}`, sub: "That one's already all in. Bring the house something else.", cost: null, action: '—', icon: '🎰', color: col };
    return {
      title: `GO ALL IN — ${w.def.name.toUpperCase()}`,
      sub: `Comes back as ${PACKED[w.id]}: double damage, deeper mags, every kill pays`,
      cost: A.price, icon: '🎰', color: col,
    };
  }

  use() {
    const g = this.game;
    if (this._blocked()) return;
    if (g.chips < A.price) { Audio.play('dryfire'); g.ui.prompt(`ALL IN means ${A.price} chips on the table`); return; }
    const w = g.weapons.current;
    if (!g.weapons.holdDown(A.time, () => this._finish(w.id))) return;
    g.chips -= A.price;
    g.ui.updateHUD();
    this.gunId = w.id;
    this.t = 0;
    this._stage = 0;
    const m = g.arena.allIn;
    m.busy = true;
    this._reelFrom = m.reels.map((r) => r.rotation.x);
    g.audioAt('allin_start', m.pos.clone().setY(1.6));
    g.ui.banner(`${w.def.name.toUpperCase()} GOES ALL IN`, 'red', 2000);
  }

  /** the gun comes back up out of the machine */
  _finish(id) {
    const g = this.game;
    // swapped away mid-show? it still lands on the gun you handed over
    if (g.weapons.currentId !== id) { g.weapons.arsenal[id].packed = true; g.weapons.gild(id, true); }
    else g.weapons.packCurrent();
    const w = g.weapons.arsenal[id];
    w.mag = w.magSize; w.reserve = w.maxReserve;
    g.progress?.bump('packed');
    g.ui.banner(`★ ${PACKED[id]} ★`, 'gold', 3000);
    g.ui.updateHUD();
  }

  update(dt) {
    if (!this.busy) return;
    const g = this.game, m = g.arena.allIn, t = (this.t += dt);
    const at = m.pos.clone().setY(1.2);
    // 1) the lever drops and springs back
    const pull = t < 0.25 ? t / 0.25 : Math.max(0, 1 - (t - 0.25) / 0.6);
    m.lever.rotation.x = 0.95 * pull * pull;
    // 2) the reels whip round, then stop one by one on sevens
    m.reels.forEach((r, i) => {
      const stop = 1.5 + i * 0.45;
      if (t < stop) {
        const k = Math.min(1, t / 0.4);
        r.rotation.x += dt * 22 * k;
      } else if (!r.userData.landed) {
        r.userData.landed = true;
        const turn = Math.PI * 2;
        r.rotation.x = Math.ceil((r.rotation.x - SEVEN) / turn) * turn + SEVEN;
        g.audioAt('wheel_tick', at.clone().setY(1.9));
      }
    });
    // 3) bulbs chase double time; the mouth glows hotter as the press comes down
    m.bulbs.forEach((b, i) => { b.material.emissiveIntensity = 1 + 3 * Math.max(0, Math.sin(t * 16 - i * 0.7)); });
    const slamAt = 2.7;
    m.mouthGlow.emissiveIntensity = 0.25 + Math.min(0.6, t * 0.25);
    if (t < slamAt) m.press.position.y = 1.26 + 0.07 * Math.min(1, t / 0.6);
    else {
      const k = Math.min(1, (t - slamAt) / 0.08);
      m.press.position.y = 1.33 - 0.15 * k;
      if (this._stage === 0) {
        this._stage = 1;
        g.audioAt('allin_stamp', at);
        g.addShake(0.12);
        g.effects.spawnBurst(m.group.localToWorld(new THREE.Vector3(0, 1.0, 0.75)), 0xffd060, 28, 7);
        g.effects.spawnBurst(m.group.localToWorld(new THREE.Vector3(0, 2.6, 0.7)), 0xff2d55, 14, 5);
      }
    }
    if (t > A.time + 0.3) this._rest();
  }

  _rest() {
    const m = this.game.arena.allIn;
    m.busy = false;
    m.lever.rotation.x = 0;
    m.press.position.y = 1.26;
    m.mouthGlow.emissiveIntensity = 0.25;
    for (const r of m.reels) r.userData.landed = false;
    this.t = -1;
    this.gunId = null;
  }

  /** the round ended mid-show: the gun comes straight back, finished */
  settle() {
    if (!this.busy) return;
    const w = this.game.weapons;
    if (w.drinkT > 0 && w._holdOnly) {
      w.drinkT = 0;
      const done = w._drinkDone;
      w._drinkDone = null;
      done?.();
    }
    this._rest();
  }

  reset() {
    if (this.busy) this._rest();
  }
}
