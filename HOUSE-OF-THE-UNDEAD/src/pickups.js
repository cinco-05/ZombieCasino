// pickups.js — poker-chip stacks (magnetize to the player), ammo boxes,
// first-aid tins. Each floats over a soft colored glow so it reads on carpet.

import * as THREE from 'three';
import { Audio } from './audio.js';
import { chipStack, ammoBoxMesh, medkitMesh } from './gfx/models.js';
import { partMesh } from './gfx/vegas.js';
import { PARTS } from './catalog.js';
import { Seed } from './rng.js';
import { compMesh, collectibleMesh, COMPS } from './rewards.js';
import { toTexture, softBlobCanvas } from './gfx/texkit.js';

export class Pickups {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.nextId = 1;                 // co-op: the guest names pickups by these
    this._glowTex = toTexture(softBlobCanvas(128, 'rgba(255,255,255,0.9)', 'rgba(255,255,255,0)'), { srgb: false });
    this._glowGeo = new THREE.PlaneGeometry(1, 1);
  }

  _wrap(model, pos, y) {
    const g = new THREE.Group();
    model.position.y = y;
    g.add(model);
    const glow = new THREE.Mesh(this._glowGeo, new THREE.MeshBasicMaterial({
      map: this._glowTex, color: model.userData.glowColor ?? 0xffd24a, transparent: true,
      opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.02;
    glow.scale.setScalar(1.1);
    g.add(glow);
    g.position.copy(pos);
    g.position.y = 0;
    g.userData = { model, glow };
    this.game.scene.add(g);
    return g;
  }

  spawnChips(pos, amount) {
    if (this.game.net.isGuest) return;          // the host's floor is the real floor
    const g = this._wrap(chipStack(amount), pos, 0.4);
    this.list.push({ id: this.nextId++, kind: 'chips', mesh: g, amount, t: 20, vy: 3 });
  }

  spawnDrop(pos) {
    // rolls a chance for ammo / health, modified by penalties
    if (this.game.net.isGuest) return;
    const healMult = this.game.casino.roundMods.healDropMult ?? 1;
    const more = this.game.perkFx?.dropMult || 1;                 // Loose Change Liqueur
    const r = Seed.random('drops') / more;
    if (r < 0.10 * healMult) {
      const g = this._wrap(medkitMesh(), pos, 0.4);
      this.list.push({ id: this.nextId++, kind: 'heal', mesh: g, amount: 20, t: 15, vy: 3 });
    } else if (r < 0.22) {
      const g = this._wrap(ammoBoxMesh(), pos, 0.35);
      this.list.push({ id: this.nextId++, kind: 'ammo', mesh: g, t: 15, vy: 3 });
    }
  }

  /** a comp (power-up) token in its rarity colour */
  spawnComp(pos, key) {
    if (this.game.net.isGuest || !COMPS[key]) return;
    const g = this._wrap(compMesh(key), pos, 0.55);
    g.userData.glow.scale.setScalar(1.6);
    this.list.push({ id: this.nextId++, kind: 'comp', key, mesh: g, t: 25, vy: 4.5 });
    this.game.audioAt('glint', pos);
  }

  /** a commemorative chip for the set: it waits until the round ends */
  spawnCollectible(pos, id) {
    if (this.game.net.isGuest) return;
    const g = this._wrap(collectibleMesh(id), pos, 0.55);
    g.userData.glow.scale.setScalar(2.2);
    this.list.push({ id: this.nextId++, kind: 'collectible', key: id, mesh: g, t: Infinity, vy: 3 });
  }

  /** one of LADY LUCK's parts — it never expires; walk over it */
  spawnPart(pos, key) {
    const model = partMesh(key);
    model.scale.setScalar(key === 'arm' ? 1.3 : 2.4);
    model.userData.glowColor = new THREE.Color(PARTS[key].color).getHex();
    const g = this._wrap(model, pos, 0.5);
    g.userData.glow.scale.setScalar(2);
    this.list.push({ id: this.nextId++, kind: 'part', part: key, mesh: g, t: Infinity, vy: 4 });
    Audio.play('part_get');
  }

  /** the round ended with a part still on the carpet: the floor staff hands it over */
  collectParts() {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (p.kind !== 'part') continue;
      this._collect(p);
      this.list.splice(i, 1);
    }
  }

  update(dt) {
    const g = this.game;
    if (g.net.isGuest) return;                  // net.js animates the host's pickups
    const ppos = g.player.pos;
    const mates = g.net.isHost ? g.net.aliveRemotes() : [];     // co-op: whoever walks over it
    const t = performance.now() / 1000;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t -= dt;
      const { model, glow } = p.mesh.userData;
      model.rotation.y += dt * (p.kind === 'comp' || p.kind === 'collectible' ? 3.2 : 2.2);
      if (model.userData.beam) model.userData.beam.material.opacity = (model.userData.beam.userData.base || 0.3) * (0.75 + 0.25 * Math.sin(t * 4 + i));
      // little hop on spawn, then a gentle bob
      if (p.vy > 0) { model.position.y += p.vy * dt; p.vy -= 12 * dt; }
      else model.position.y = 0.45 + Math.sin(t * 3 + i) * 0.06;
      glow.material.opacity = 0.4 + Math.sin(t * 4 + i) * 0.15;
      if (p.t < 3) p.mesh.visible = Math.sin(p.t * 20) > -0.3;   // about to vanish
      const d = p.mesh.position.distanceTo(new THREE.Vector3(ppos.x, 0, ppos.z));
      // chips magnetize
      const magnetR = 5 * g.playerMods.magnet * (g.perkFx?.magnet || 1);
      if (p.kind === 'chips' && d < magnetR) {
        const target = new THREE.Vector3(ppos.x, 0, ppos.z);
        p.mesh.position.lerp(target, Math.min(1, dt * Math.max(1, magnetR + 1 - d) * 2.2));
      }
      const mate = d < 1.2 ? null : mates.find((r) => Math.hypot(p.mesh.position.x - r.pos.x, p.mesh.position.z - r.pos.z) < 1.2);
      if (d < 1.2) {
        this._collect(p);
        this.list.splice(i, 1);
      } else if (mate) {
        // a teammate walked over it: it's theirs
        this._remove(p);
        this.list.splice(i, 1);
        g.net.sendTo(mate.seat, { t: 'pick', kind: p.kind, amount: p.amount || 0, part: p.part || p.key || null });
      } else if (p.t <= 0) {
        this._remove(p);
        this.list.splice(i, 1);
      }
    }
  }

  _remove(p) {
    this.game.scene.remove(p.mesh);
    p.mesh.userData.glow.material.dispose();
  }

  _collect(p) {
    const g = this.game;
    this._remove(p);
    const at = p.mesh.position.clone().setY(1.2);
    if (p.kind === 'chips') {
      const amt = Math.round(p.amount * g.comboMult() * g.playerMods.chipPickupMult   // Loaded Dice
        * (g.perkFx?.chipMult || 1) * (g.vice === 'hustler' ? 1.25 : 1)               // Liqueur, the Hustler
        * (g.rewards?.mult('chips') || 1));                                            // Loose Slots, Happy Hour, Black Card
      g.addChips(amt);
      if (g.playerMods.chipHeal) g.player.heal(Math.floor(amt / 25));                  // Vampire Chips
      Audio.play('chip');
      g.ui.floatText(at, `+${amt}`, 'chips');
    } else if (p.kind === 'ammo') {
      g.weapons.addReservePct(0.35);
      Audio.play('ammo');
      g.ui.floatText(at, '+AMMO', 'ammo');
    } else if (p.kind === 'heal') {
      g.player.heal(p.amount);
      Audio.play('heal');
      g.ui.floatText(at, `+${p.amount} HP`, 'heal');
    } else if (p.kind === 'part') {
      g.wonder.collect(p.part);
    } else if (p.kind === 'comp') {
      g.rewards.grant(p.key);
    } else if (p.kind === 'collectible') {
      g.progress.collect(p.key);
    }
  }

  clear() {
    for (const p of this.list) this._remove(p);
    this.list = [];
  }

  /** guest: a stand-in for one of the host's pickups */
  remoteMesh(kind, amount, part, pos) {
    let model;
    if (kind === 'chips') model = chipStack(amount);
    else if (kind === 'heal') model = medkitMesh();
    else if (kind === 'ammo') model = ammoBoxMesh();
    else if (kind === 'comp') return this._wrap(compMesh(part), pos, 0.55);
    else if (kind === 'collectible') return this._wrap(collectibleMesh(part), pos, 0.55);
    else {
      model = partMesh(part || 'zero');
      model.scale.setScalar(part === 'arm' ? 1.3 : 2.4);
      model.userData.glowColor = new THREE.Color(PARTS[part || 'zero'].color).getHex();
    }
    return this._wrap(model, pos, 0.45);
  }

  /** guest: the host says we picked something up */
  collectRemote(m) {
    const g = this.game;
    const at = g.player.pos.clone().add(g.player.forwardFlat()).setY(1.2);
    if (m.kind === 'chips') g.awardChips(m.amount, at);
    else if (m.kind === 'ammo') { g.weapons.addReservePct(0.35); Audio.play('ammo'); g.ui.floatText(at, '+AMMO', 'ammo'); }
    else if (m.kind === 'heal') { g.player.heal(m.amount); Audio.play('heal'); g.ui.floatText(at, `+${m.amount} HP`, 'heal'); }
    else if (m.kind === 'part') g.wonder.collect(m.part);
    else if (m.kind === 'comp') g.rewards.grant(m.part);
    else if (m.kind === 'collectible') g.progress.collect(m.part);
    g.ui.updateHUD();
  }
}
