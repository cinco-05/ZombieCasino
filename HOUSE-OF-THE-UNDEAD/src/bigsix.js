// bigsix.js — THE BIG SIX: a real casino money wheel standing on the grand
// floor. Pay, pull, and the clapper ticks down the pegs until it lands on a
// gun — which rises out of the pedestal for you to take (it swaps for the one
// in your hands if both slots are full). Land on the skull and the house keeps
// your chips. Guns you're already carrying get skipped.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Audio } from './audio.js';
import { GUNS } from './catalog.js';
import { Seed } from './rng.js';
import { buildWorldGun } from './gfx/viewmodels.js';
import { toTexture, softBlobCanvas } from './gfx/texkit.js';

const ease = (t) => 1 - Math.pow(1 - t, 3.2);

export class BigSix {
  constructor(game) {
    this.game = game;
    this.state = 'idle';               // idle | spinning | prize
    this.t = 0;
    this.prizeId = null;
    this.prizeMesh = null;
    this.angle = 0;
    this.clap = 0;
  }

  get price() { return CONFIG.bigSix.price; }

  interactable() {
    const b = this.game.arena.bigSix;
    return {
      pos: b.front, facing: b.facing, radius: 2.7, zone: 0,
      label: () => this._label(),
      cost: () => (this.state === 'idle' ? this.price : null),
      use: () => this.use(),
    };
  }

  _label() {
    if (this.state === 'spinning') return { title: 'THE BIG SIX', sub: 'Round and round she goes…', cost: null, icon: '🎡', color: '#ffb04a' };
    if (this.state === 'prize') {
      const w = this.game.weapons;
      const full = w.slots.slice(0, w.maxSlots).every(Boolean);
      const name = GUNS[this.prizeId].name;
      return { title: `TAKE ${name}`, sub: full ? `Swaps for the ${w.current.def.name} in your hands` : 'Goes into your empty slot', cost: null, action: 'TAKE', icon: GUNS[this.prizeId].icon, color: '#ffd24a' };
    }
    return { title: 'THE BIG SIX', sub: 'Spin the wheel for a random gun. The skull keeps your chips.', cost: this.price, icon: '🎡', color: '#ffb04a' };
  }

  use() {
    const g = this.game;
    if (this.state === 'prize') {
      g.weapons.give(this.prizeId);
      Audio.play('ammo');
      this._clearPrize();
      this.state = 'idle';
      return;
    }
    if (this.state !== 'idle') return;
    if (g.chips < this.price) { Audio.play('dryfire'); g.ui.prompt(`The Big Six takes ${this.price} chips a spin`); return; }
    g.chips -= this.price;
    g.ui.updateHUD();
    Audio.play('chip');
    this._spin();
  }

  _spin() {
    const g = this.game, b = g.arena.bigSix;
    const n = b.count;
    // pick a wedge — never a gun you're already holding
    const held = new Set(g.weapons.owned());
    const pool = b.segs.map((s, i) => i).filter((i) => !b.segs[i].gun || !held.has(b.segs[i].gun));
    const i = Seed.pick('floor', pool);
    this.result = i;
    const c = ((i + 0.5) / n) * Math.PI * 2;
    // land the wedge's center under the clapper at 12 o'clock (angle π/2), with a nudge off-center
    const jitter = (Math.random() - 0.5) * (Math.PI * 2 / n) * 0.6;
    let target = Math.PI / 2 - c + jitter;
    const turns = 4 + Math.floor(Math.random() * 2);
    const from = b.wheel.rotation.z;
    while (target < from + turns * Math.PI * 2) target += Math.PI * 2;
    this.from = from;
    this.to = target;
    this.dur = 4.4 + Math.random() * 0.6;
    this.t = 0;
    this.state = 'spinning';
    this.lastPeg = Math.floor(from / (Math.PI * 2 / n));
    g.audioAt('wheel_spin', b.pos.clone().setY(2.7));
  }

  update(dt) {
    const g = this.game, b = g.arena.bigSix;
    this.clap = Math.max(0, this.clap - dt * 9);
    b.clapper.rotation.z = -this.clap * 0.5;
    if (this.state === 'spinning') {
      this.t += dt;
      const k = Math.min(1, this.t / this.dur);
      const a = this.from + (this.to - this.from) * ease(k);
      b.wheel.rotation.z = a;
      // tick the clapper every time a peg passes 12 o'clock
      const peg = Math.floor(a / (Math.PI * 2 / b.count));
      if (peg !== this.lastPeg) {
        this.lastPeg = peg;
        this.clap = 1;
        g.audioAt('wheel_tick', b.pos.clone().setY(4.4));
      }
      if (k >= 1) this._land();
    } else if (this.state === 'prize') {
      this.t += dt;
      const m = this.prizeMesh;
      if (m) {
        const rise = Math.min(1, this.t / 0.8);
        m.position.copy(b.prizeWorld).add(new THREE.Vector3(0, 0.45 * rise + Math.sin(this.t * 2) * 0.04, 0));
        m.rotation.y += dt * 1.1;
        m.visible = this.t < CONFIG.bigSix.claimTime - 2 || Math.sin(this.t * 18) > 0;
        this.glow.material.opacity = 0.55 * rise;
      }
      if (this.t > CONFIG.bigSix.claimTime) {
        this._clearPrize();
        this.state = 'idle';
        g.ui.prompt('The Big Six takes its prize back');
      }
    }
  }

  _land() {
    const g = this.game, b = g.arena.bigSix;
    const seg = b.segs[this.result];
    if (seg.skull) {
      this.state = 'idle';
      g.ui.banner('☠ THE BIG SIX LANDS ON THE HOUSE — no prize', 'red', 2600);
      g.audioAt('wager_lose', b.pos.clone().setY(2));
      return;
    }
    this.prizeId = seg.gun;
    this.state = 'prize';
    this.t = 0;
    const m = buildWorldGun(seg.gun);
    m.scale.setScalar(1.9);
    // a prize should shine: every surface gets a warm gold edge glow
    m.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const lit = mats.map((mt) => {
        const c = mt.clone();
        if (c.emissive) { c.emissive = new THREE.Color(0x5a4010); c.emissiveIntensity = 0.9; }
        return c;
      });
      o.material = Array.isArray(o.material) ? lit : lit[0];
    });
    m.position.copy(b.prizeWorld);
    this.game.scene.add(m);
    this.prizeMesh = m;
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({
      map: toTexture(softBlobCanvas(128, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)'), { srgb: false }),
      color: 0xffd24a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.copy(b.prizeWorld).setY(0.92);
    this.game.scene.add(this.glow);
    g.ui.banner(`THE BIG SIX PAYS OUT: ${GUNS[seg.gun].name}`, 'gold', 2600);
    g.audioAt('jackpot', b.pos.clone().setY(2));
  }

  _clearPrize() {
    if (this.prizeMesh) {
      this.game.scene.remove(this.prizeMesh);
      this.prizeMesh.traverse((o) => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); });
    }
    if (this.glow) { this.game.scene.remove(this.glow); this.glow.material.map?.dispose(); this.glow.material.dispose(); }
    this.prizeMesh = null;
    this.glow = null;
    this.prizeId = null;
  }

  reset() {
    this._clearPrize();
    this.state = 'idle';
    this.t = 0;
  }
}
