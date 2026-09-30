// weapons.js — the guns in your hands. Ten in the building (see catalog.js),
// two carried at once (three with a SPLIT THE PAIR SPRITZ): slot 1 is your
// sidearm, slot 2 your primary. New guns come off THE BIG SIX wheel or the
// shop and swap in for what you're holding. Fire modes: hitscan (stops at
// walls; the Whale punches through bodies), the Dealer's Shoe's piercing razor
// cards, the Magnum's exploding corks, and the Jubilee's flame jet. Also owns
// melee, the throw that launches lethals/tacticals, and the drinking animation
// for the cocktail automats. Attachments, perks and vices all feed in here.

import * as THREE from 'three';
import { CONFIG, clamp, rand, pick } from './config.js';
import { Audio } from './audio.js';
import { GUNS, PACKED } from './catalog.js';
import { buildViewmodels, flashTexture, stemHand } from './gfx/viewmodels.js';
import { GunAnimator, track } from './gfx/vmanim.js';
import { cocktailGlass } from './gfx/machines.js';
import { cardMesh } from './chars/props.js';
import { STYLE } from './gfx/style.js';

const SWITCH_TIME = 0.34;
const DRINK_TIME = 2.0;

// per-gun presentation: shot sound, camera kick, shake, flash size, the sound
// it makes coming up after a swap, and where it sits at the hip [x, y, z, yaw]
const GUNFX = {
  pistol:    { sfx: 'shoot_pistol', kick: 0.006, shake: 0, flash: 1, raise: 'hammer', hip: [0.2, -0.095, -0.4, 0.09] },
  derringer: { sfx: 'shoot_derringer', kick: 0.016, shake: 0.03, flash: 1.15, raise: 'break_close', hip: [0.19, -0.1, -0.36, 0.1] },
  shotgun:   { sfx: 'shoot_shotgun', kick: 0.02, shake: 0.06, flash: 1.6, raise: 'pump_fwd', eject: true, hip: [0.19, -0.105, -0.43, 0.07] },
  smg:       { sfx: 'shoot_smg', kick: 0.0032, shake: 0, flash: 0.75, raise: 'bolt', eject: true, hip: [0.19, -0.1, -0.43, 0.07] },
  tommy:     { sfx: 'shoot_tommy', kick: 0.0045, shake: 0.01, flash: 0.9, raise: 'bolt', eject: true, hip: [0.19, -0.112, -0.45, 0.07] },
  shoe:      { sfx: 'shoot_card', kick: 0.004, shake: 0, flash: 0, raise: 'shuffle', hip: [0.19, -0.108, -0.44, 0.07] },
  rifle:     { sfx: 'shoot_rifle', kick: 0.013, shake: 0.04, flash: 1, raise: 'lever', eject: true, hip: [0.19, -0.105, -0.46, 0.07] },
  magnum:    { sfx: 'shoot_cork', kick: 0.022, shake: 0.05, flash: 0.45, raise: 'break_close', hip: [0.2, -0.11, -0.46, 0.07] },
  whale:     { sfx: 'shoot_whale', kick: 0.036, shake: 0.13, flash: 1.9, raise: 'break_close', hip: [0.19, -0.1, -0.48, 0.06] },
  jubilee:   { sfx: null, kick: 0.0005, shake: 0, flash: 0, raise: 'ignite', hip: [0.2, -0.115, -0.44, 0.07] },
  luck:      { sfx: 'luck_zap', kick: 0.009, shake: 0.05, flash: 0, raise: 'luck_raise', hip: [0.2, -0.108, -0.42, 0.08] },
};
const A = CONFIG.allIn;

// gold-plated copies of a gun's materials for ALL IN (shared across guns)
const _gilded = new Map();
function gilded(mat) {
  if (_gilded.has(mat)) return _gilded.get(mat);
  const m = mat.clone();
  m.color = mat.color ? mat.color.clone().lerp(new THREE.Color(0xe8b84a), 0.72) : new THREE.Color(0xe8b84a);
  m.metalness = Math.max(0.9, mat.metalness ?? 0);
  m.roughness = Math.min(0.28, mat.roughness ?? 0.3);
  m.emissive = new THREE.Color(0x4a3208);
  m.emissiveIntensity = 0.35;
  _gilded.set(mat, m);
  return m;
}
const CARD_FACES = [['A', '♠'], ['K', '♥'], ['Q', '♦'], ['J', '♣'], ['10', '♠'], ['A', '♦'], ['7', '♥']];

class Weapon {
  constructor(id, def, owner) {
    this.id = id;
    this.def = def;
    this.owner = owner;
    this.mag = def.mag;
    this.reserve = def.reserve;
    this.packed = false;            // pushed ALL IN
    // attachment multipliers (upgrades.js bumps these)
    this.mods = { damage: 1, fireRate: 1, mag: 1, reload: 1, crit: 0, lifesteal: 0 };
  }
  get pf() { return this.owner.game.perkFx || {}; }
  get name() { return this.packed ? PACKED[this.id] : this.def.name; }
  get magSize() { return Math.round(this.def.mag * this.mods.mag * (this.packed ? A.mag : 1)); }
  get damage() { return this.def.damage * this.mods.damage * (this.packed ? (this.def.fire === 'flame' ? A.flameDamage : A.damage) : 1); }
  get fireInterval() { return 1 / (this.def.fireRate * this.mods.fireRate * (this.pf.fireRate || 1) * (this.packed ? A.fireRate : 1) * (this.owner.game.rewards?.mult('fireRate') || 1)); }
  get reloadTime() { return this.def.reload * this.mods.reload * (this.pf.reload || 1) * (this.packed ? A.reload : 1); }
  get critChance() { return this.def.critChance + this.mods.crit + (this.packed ? A.crit : 0); }
  get maxReserve() { return Math.round(this.def.maxReserve * (this.owner.game.vice === 'packrat' ? 0.85 : 1) * (this.packed ? A.reserve : 1)); }
}

export class Weapons {
  constructor(game) {
    this.game = game;
    this.arsenal = {};
    for (const [id, def] of Object.entries(CONFIG.weapons)) this.arsenal[id] = new Weapon(id, def, this);
    this.slots = ['pistol', 'shotgun', null];
    this.slot = 1;
    this.currentId = 'shotgun';
    this.triggerHeld = false;
    this.cooldown = 0;
    this.reloading = false;
    this.reloadT = 0;
    this.meleeCd = 0;
    this.kick = 0;
    this.switchT = 0;
    this.pendingSlot = -1;
    this.drinkT = 0;
    this.shots = [];                 // cards + corks in flight
    this.raycaster = new THREE.Raycaster();
    this._buildViewmodel();
  }

  get current() { return this.arsenal[this.currentId]; }
  get maxSlots() { return this.game.perkFx?.slots || 2; }
  get switchTime() { return SWITCH_TIME * (this.game.perkFx?.switchMult || 1) * (this.game.vice === 'quickdraw' ? 0.5 : 1); }
  owned() { return this.slots.filter(Boolean); }
  owns(id) { return this.slots.includes(id); }

  /** new run: the class's two guns, fresh */
  reset(loadout = { sidearm: 'pistol', primary: 'shotgun' }) {
    for (const [id, def] of Object.entries(CONFIG.weapons)) {
      const w = this.arsenal[id];
      w.mods = { damage: 1, fireRate: 1, mag: 1, reload: 1, crit: 0, lifesteal: 0 };
      if (w.packed) this.gild(id, false);
      w.packed = false;
      w.mag = w.magSize;
      w.reserve = def.reserve;
    }
    this.slots = [loadout.sidearm || 'pistol', loadout.primary || 'shotgun', null];
    this.slot = 1;
    this.currentId = this.slots[1];
    this.reloading = false;
    this.cooldown = 0;
    this.meleeCd = 0;
    this.switchT = 0;
    this.pendingSlot = -1;
    this.drinkT = 0;
    this.clearShots();
    this._refreshViewmodel();
  }

  // ----------------------------- viewmodel ----------------------------------
  // Models + gloved hands live in gfx/viewmodels.js; each exposes the moving
  // parts vmanim.js animates and its muzzle.
  _buildViewmodel() {
    this.vm = new THREE.Group();
    this.vmModels = buildViewmodels();
    for (const m of Object.values(this.vmModels)) {
      m.visible = false;
      m.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
      this.vm.add(m);
    }
    // the viewmodel lives in its own overlay scene (camera space), drawn after
    // the world with a cleared depth buffer — so it never pokes into walls
    this.vm.position.set(0.2, -0.1, -0.4);
    this.vm.scale.setScalar(0.9);
    this.game.vmScene.add(this.vm);

    this.muzzle = new THREE.PointLight(0xffb050, 0, 3, 1.6);          // lights the gun
    this.vm.add(this.muzzle);
    this.worldMuzzle = new THREE.PointLight(0xffb050, 0, 12, 1.6);    // lights the room
    this.worldMuzzle.position.set(0.3, -0.15, -1.3);
    this.game.camera.add(this.worldMuzzle);
    const flashTex = flashTexture();
    // (1930s: an inked BANG star, painted — additive light would wash its outline away)
    const flashMat = STYLE.cartoon
      ? new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, depthWrite: false, alphaTest: 0.05 })
      : new THREE.MeshBasicMaterial({ map: flashTex, color: new THREE.Color(3, 2.4, 1.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.flashMesh = new THREE.Group();
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), flashMat);
    const side = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.2), flashMat);
    side.rotation.y = Math.PI / 2;
    side.position.z = -0.12;
    const side2 = side.clone();
    side2.rotation.set(0, Math.PI / 2, Math.PI / 2);
    this.flashMesh.add(front, side, side2);
    this.flashMesh.traverse((o) => { o.renderOrder = 11; });
    this.flashMesh.visible = false;
    this.anim = new GunAnimator(this.vmModels);
    // the drink: a gloved hand around a coupe's stem
    this.drinkRig = new THREE.Group();
    this.drinkHand = stemHand();
    this.drinkRig.add(this.drinkHand);
    this.drinkRig.visible = false;
    this.drinkRig.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    this.game.vmScene.add(this.drinkRig);
    this._refreshViewmodel();
  }

  _refreshViewmodel() {
    for (const [id, m] of Object.entries(this.vmModels)) m.visible = id === this.currentId;
    // the flash + its light ride the live gun, so they follow recoil and reloads
    const model = this.vmModels[this.currentId];
    const mz = model.userData.muzzle;
    model.add(this.flashMesh, this.muzzle);
    this.flashMesh.position.copy(mz);
    this.muzzle.position.copy(mz).add(new THREE.Vector3(0, 0.05, -0.05));
    this.anim?.cancelReload();
  }

  // ----------------------------- switching ----------------------------------
  switchSlot(i) {
    const g = this.game;
    if (i >= this.maxSlots) {
      if (i === 2) g.ui.prompt('A third gun takes a SPLIT THE PAIR SPRITZ');
      return;
    }
    const id = this.slots[i];
    if (!id || i === this.slot || this.switchT > 0 || this.drinkT > 0) return;
    // animated swap: gun drops off-screen, swaps at the bottom, comes back up
    this.pendingSlot = i;
    this.switchT = this.switchTime;
    this.reloading = false;
    this.anim.cancelReload();
    g.ui.reloadBar(null);
    Audio.play('whoosh');
  }

  /** legacy: switch to a gun by id if you're carrying it */
  switchTo(id) { const i = this.slots.indexOf(id); if (i >= 0) this.switchSlot(i); }

  cycle(dir) {
    const n = this.maxSlots;
    for (let k = 1; k <= n; k++) {
      const i = (this.slot + dir * k + n * 4) % n;
      if (this.slots[i]) { this.switchSlot(i); return; }
    }
  }

  /**
   * hand the player a gun. Carrying it already? topped up. A free slot? it
   * goes there. Otherwise it replaces what's in your hands. Returns the gun
   * that was dropped (or null).
   */
  give(id) {
    const g = this.game;
    const w = this.arsenal[id];
    if (!w) return null;
    if (this.owns(id)) {
      w.mag = w.magSize;
      w.reserve = w.maxReserve;
      g.ui.banner(`${w.def.name.toUpperCase()} — TOPPED UP`, 'gold', 1800);
      g.ui.updateHUD();
      return null;
    }
    let i = this.slots.findIndex((s, k) => !s && k < this.maxSlots);
    if (i < 0) i = this.slot;
    const dropped = this.slots[i];
    if (dropped && this.arsenal[dropped].packed) { this.arsenal[dropped].packed = false; this.gild(dropped, false); }
    this.slots[i] = id;
    if (w.packed) { w.packed = false; this.gild(id, false); }
    w.mag = w.magSize;
    w.reserve = w.def.reserve;
    // bring it up: same slot animates a swap too
    this.reloading = false;
    this.anim.cancelReload();
    this.pendingSlot = i;
    this.switchT = this.switchTime;
    const the = (n) => (/^the /i.test(n) ? n : `the ${n}`);
    g.ui.banner(`${w.name.toUpperCase()}${dropped ? ` — swapped for ${the(this.arsenal[dropped].def.name)}` : ''}`, 'gold', 2400);
    g.ui.updateHUD();
    return dropped;
  }

  /** losing the Spritz: the third gun goes back to the house */
  dropExtraSlots() {
    for (let i = this.maxSlots; i < this.slots.length; i++) {
      if (!this.slots[i]) continue;
      this.slots[i] = null;
      if (this.slot === i) {
        this.slot = 1;
        this.currentId = this.slots[1] || this.slots[0];
        this._refreshViewmodel();
      }
    }
  }

  // ------------------------------- ALL IN -------------------------------------
  /** gold-plate a gun's viewmodel (everything but the hands) — or strip it back */
  gild(id, on = true) {
    const model = this.vmModels[id];
    const list = [];
    model.traverse((o) => {
      if (!o.isMesh) return;
      for (let p = o; p && p !== model; p = p.parent) if (p.userData.hand) return;
      if (on) {
        const base = o.userData.baseMat || o.material;
        const swap = (m) => (m.isMeshStandardMaterial && !m.transparent ? gilded(m) : m);
        o.userData.baseMat = base;
        o.material = Array.isArray(base) ? base.map(swap) : swap(base);
        list.push(...(Array.isArray(o.material) ? o.material : [o.material]).filter((m) => m !== base));
      } else if (o.userData.baseMat) {
        o.material = o.userData.baseMat;
        delete o.userData.baseMat;
      }
    });
    this._gildMats = this._gildMats || {};
    this._gildMats[id] = on ? [...new Set(list)] : null;
  }

  /** push the gun in your hands ALL IN (the machine plays the show; this lands the result) */
  packCurrent() {
    const w = this.current;
    if (w.packed) return false;
    w.packed = true;
    this.gild(w.id, true);
    w.mag = w.magSize;
    w.reserve = w.maxReserve;
    this.game.ui.updateHUD();
    return true;
  }

  /** packed guns pay: every kill spits a few chips (and Lady Luck always does) */
  _paid(w, ref, point) {
    if (!ref.dead || ref._paid || !point) return;
    const n = (w.packed ? A.killChips : 0) + (w.id === 'luck' ? 6 : 0);
    if (!n || !ref.mesh) return;
    ref._paid = true;
    if (this.game.net.active) this.game.awardChips(n, ref.mesh.position);   // co-op: straight to the shooter
    else this.game.pickups.spawnChips(ref.mesh.position.clone(), n);
    this.game.effects.spawnBurst(point, 0xffd060, 8, 5);
  }

  // ------------------------------ damage ------------------------------------
  /** everything that scales a gun's damage besides its own attachments */
  _dmgMult(w) {
    const g = this.game;
    let m = g.playerMods.dmgAllMult;                       // Blood Pact
    if (g.dashBuffT > 0) m *= 1.6;                        // Dash & Cash window
    if (g.vice === 'brawler') m *= 0.9;
    if (g.vice === 'quickdraw' && GUNS[w.id]?.cat === 'sidearm') m *= 1.3;
    if (g.vice === 'laststand' && g.player.hp < g.player.maxHp * 0.3) m *= 1.35;
    m *= g.rewards?.mult('damage') || 1;                  // HIGH ROLLER, THE WHALE'S BLESSING
    return m;
  }

  /** one hit on one target (bullets, cards) */
  _hit(ref, point, isHead, w, mult = 1) {
    const g = this.game, pf = g.perkFx || {};
    let dmg = w.damage * mult * this._dmgMult(w);
    if (isHead) dmg *= CONFIG.headshotMult * (pf.headMult || 1);
    const crit = Math.random() < (w.critChance + g.playerMods.critAdd + (pf.critAdd || 0));
    if (crit) dmg *= CONFIG.critMult;
    // SNAKE EYES SHOOTER: one in four hits twice
    if (pf.doubleTap && Math.random() < pf.doubleTap) dmg *= 2;
    // Crit Comptroller: crits refund a lethal (2s internal cooldown)
    if (crit && g.playerMods.critGrenade && (this.critGrenadeCd ?? 0) <= 0 && g.player.grenades < g.lethalMax()) {
      this.critGrenadeCd = 2;
      g.player.grenades++;
      g.ui.floatText(point, '+💣', 'ammo');
    }
    g.effects.spawnBurst(point, (crit || isHead) ? 0xc9a227 : 0x8f1f2f, (crit || isHead) ? 7 : 4, 3.5);
    ref.takeDamage(dmg, crit || isHead, point, 'hit', isHead);
    this._paid(w, ref, point);
    if (w.mods.lifesteal > 0) g.player.heal(dmg * w.mods.lifesteal);
    g.ui.hitmarker(crit || isHead);
    Audio.play(crit ? 'crit' : 'hit');
    if (isHead) {
      g.stats.headshots++;
      g.progress?.bump('headshots');
      g.addChips(Math.round(g.playerMods.headshotBonus));
    }
  }

  // ------------------------------ firing ------------------------------------
  tryFire() {
    const g = this.game;
    if (g.state !== 'COMBAT' || this.reloading || this.cooldown > 0 || this.switchT > 0 || this.drinkT > 0) return;
    if (g.player.bledOut) return;
    const w = this.current;
    if (w.mag <= 0) {
      Audio.play('dryfire');
      this.anim.dryFire(this.currentId);
      this.cooldown = 0.2;
      this.startReload();
      return;
    }
    if (!g.rewards?.bottomless) w.mag--;             // FREE SPINS: the mag never empties
    this.shotCount = (this.shotCount || 0) + 1;     // co-op: your teammates hear it
    this.cooldown = w.fireInterval;
    this.kick = 1;
    const fx = GUNFX[this.currentId];
    if (fx.sfx) Audio.play(fx.sfx);

    // camera punch per shot (recoil climbs on full auto — control it)
    g.player.pitch = Math.min(1.45, g.player.pitch + fx.kick);
    if (fx.shake) g.addShake(fx.shake);

    // muzzle flash: sprite always (dimmer with reduced flash), light only without
    if (fx.flash > 0) {
      this.flashMesh.visible = true;
      this.flashMesh.children[0].material.opacity = g.settings.reducedFlash ? 0.35 : 1;
      this.flashMesh.rotation.z = Math.random() * Math.PI;
      this.flashMesh.scale.setScalar(fx.flash * rand(0.85, 1.15));
      if (!g.settings.reducedFlash) { this.muzzle.intensity = 8; this.worldMuzzle.color.set(0xffb050); this.worldMuzzle.intensity = 45 * Math.min(1.4, fx.flash); }
      clearTimeout(this._flashT);
      this._flashT = setTimeout(() => { this.flashMesh.visible = false; this.muzzle.intensity = 0; this.worldMuzzle.intensity = 0; }, 45);
    }
    if (fx.eject) g.effects.spawnShell();
    if (fx.flash > 0 && Math.random() < 0.7) g.effects.spawnMuzzleSmoke(this.muzzleWorld());

    // recoil spring, hammer fall + drum index, pump / lever cycle
    this.anim.fire(this.currentId, w.fireInterval);

    const def = w.def;
    if (def.fire === 'card') this._fireCard(w);
    else if (def.fire === 'cork') this._fireCork(w);
    else if (def.fire === 'flame') this._fireFlame(w);
    else if (def.fire === 'luck') this._fireLuck(w);
    else {
      // LAST CALL: the final round in the mag hits for triple
      const lastCall = g.playerMods.lastBullet && w.mag === 0 && w.magSize > 1;
      const spreadBase = def.spread * (g.player.aiming ? 0.4 * (g.perkFx?.adsSpread || 1) : 1);
      for (let p = 0; p < def.pellets; p++) this._fireRay(w, spreadBase, lastCall ? 3 : 1);
      if (lastCall) g.ui.prompt('LAST CALL!', 700);
    }
    g.ui.updateHUD();
  }

  _aimDir(spread) {
    const g = this.game;
    return new THREE.Vector3(0, 0, -1)
      .applyEuler(g.camera.rotation)
      .add(new THREE.Vector3(rand(-spread, spread), rand(-spread, spread), rand(-spread, spread)))
      .normalize();
  }

  /** hitscan: stops at the first wall; pierce > 1 carries on through bodies */
  _fireRay(w, spread, dmgMult = 1) {
    const g = this.game;
    const dir = this._aimDir(spread);
    const wall = g.arena.rayHit(g.camera.position, dir, 80);
    const wallD = wall ? wall.dist : 80;
    this.raycaster.set(g.camera.position, dir);
    this.raycaster.far = wallD;
    const hits = this.raycaster.intersectObjects(g.enemies.hitMeshes(), false);
    const pierce = w.def.pierce || 1;
    const seen = new Set();
    let last = null;
    for (const hit of hits) {
      const ref = hit.object.userData.ref;
      if (!ref || seen.has(ref) || ref.dead) continue;
      seen.add(ref);
      this._hit(ref, hit.point, !!hit.object.userData.isHead, w, dmgMult * (seen.size > 1 ? 0.85 : 1));
      last = hit;
      if (seen.size >= pierce) break;
    }
    const end = last && seen.size >= pierce ? last.distance : wallD;
    this._tracer(dir, end);
    if (wall && !(last && seen.size >= pierce)) g.effects.spawnImpact(wall.point.addScaledVector(wall.normal, 0.02), wall.normal);
  }

  /** THE DEALER'S SHOE: a razor card that slices through a line of them */
  _fireCard(w) {
    const g = this.game;
    const dir = this._aimDir(w.def.spread * (g.player.aiming ? 0.3 : 1));
    // fly from the shoe's mouth toward whatever the crosshair is on
    const wall = g.arena.rayHit(g.camera.position, dir, 60);
    const aim = g.camera.position.clone().addScaledVector(dir, wall ? Math.max(2, wall.dist) : 60);
    const start = this.muzzleWorld();
    const vel = aim.sub(start).normalize().multiplyScalar(w.def.speed);
    const [r, s] = pick(CARD_FACES);
    const mesh = cardMesh(r, s, 0.15, 0.21);
    const holder = new THREE.Group();
    mesh.rotation.x = -Math.PI / 2;
    holder.add(mesh);
    holder.position.copy(start);
    holder.lookAt(start.clone().add(vel));
    g.scene.add(holder);
    this.shots.push({ kind: 'card', mesh: holder, spin: mesh, pos: start.clone(), vel, left: w.def.pierce || 1, hit: new Set(), t: 1.4, w });
  }

  /** THE MAGNUM: an exploding champagne cork on a lob */
  _fireCork(w) {
    const g = this.game;
    const dir = this._aimDir(w.def.spread);
    dir.y += 0.05; dir.normalize();
    const start = this.muzzleWorld();
    const mesh = new THREE.Group();
    const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.07, 12), new THREE.MeshStandardMaterial({ color: 0xc89a60, roughness: 0.9 }));
    cork.rotation.x = Math.PI / 2;
    mesh.add(cork);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.025, 14), new THREE.MeshStandardMaterial({ color: 0xd8b040, metalness: 1, roughness: 0.3, emissive: 0x3a2800 }));
    cap.rotation.x = Math.PI / 2;
    cap.position.z = -0.045;
    mesh.add(cap);
    mesh.position.copy(start);
    g.scene.add(mesh);
    g.effects.spawnBurst(start, 0xffd060, 5, 3);
    this.shots.push({ kind: 'cork', mesh, pos: start.clone(), vel: dir.multiplyScalar(w.def.speed), t: 4, w });
  }

  /** CHERRIES JUBILEE: a tongue of flame; everything in the cone burns */
  _fireFlame(w) {
    const g = this.game;
    const dir = this._aimDir(0);
    const origin = this.muzzleWorld();
    for (let i = 0; i < 2; i++) g.effects.spawnFlame(origin, dir, 11);
    this.flameN = (this.flameN || 0) + 1;
    if (this.flameN % 3 === 0) Audio.play('flame');
    if (!g.settings.reducedFlash) {
      this.worldMuzzle.color.set(0xff7a2a);
      this.worldMuzzle.intensity = 30 + Math.random() * 15;
      clearTimeout(this._flameLightT);
      this._flameLightT = setTimeout(() => { this.worldMuzzle.intensity = 0; }, 140);
    }
    const eye = g.camera.position;
    const range = w.def.range;
    const dmg = w.damage * this._dmgMult(w);
    let hitAny = false;
    const targets = [...g.enemies.list, ...g.bosses.filter((b) => !b.dead)];
    for (const e of targets) {
      if (e.dead) continue;
      const to = e.mesh.position.clone().setY(1.1).sub(eye);
      const d = to.length();
      if (d > range + (e.def?.scale || 1) * 0.5) continue;
      if (to.normalize().dot(dir) < 0.88) continue;
      if (g.arena.lineBlocked(eye, e.mesh.position, false)) continue;
      e.takeDamage(dmg, false, null, 'fire');
      e.ignite?.(w.def.burn * (w.packed ? 1.6 : 1), 3);
      this._paid(w, e, e.mesh.position.clone().setY(1.2));
      hitAny = true;
    }
    if (hitAny && this.flameN % 4 === 0) g.ui.hitmarker(false);
  }

  /**
   * LADY LUCK: a bolt of green-gold fortune leaps to whatever's nearest the
   * crosshair, then jumps from one of them to the next — six in a row (nine
   * when she's gone all in). Every kill pays out.
   */
  _fireLuck(w) {
    const g = this.game;
    const dir = this._aimDir(0);
    const eye = g.camera.position.clone();
    const start = this.muzzleWorld();
    const targets = [...g.enemies.list.filter((z) => !z.dead), ...g.bosses.filter((b) => !b.dead)];
    const chest = (e) => e.mesh.position.clone().setY(1.2 * (e.mesh.scale.y || 1));
    let first = null, best = 0.13;
    for (const e of targets) {
      const to = chest(e).sub(eye);
      const d = to.length();
      if (d > 45) continue;
      const ang = Math.acos(clamp(to.normalize().dot(dir), -1, 1)) - Math.min(0.1, 0.7 / d);
      if (ang < best && !g.arena.lineBlocked(eye, e.mesh.position, false)) { best = ang; first = e; }
    }
    if (!g.settings.reducedFlash) {
      this.worldMuzzle.color.set(0x5aff9a);
      this.worldMuzzle.intensity = 60;
      clearTimeout(this._flashT);
      this._flashT = setTimeout(() => { this.worldMuzzle.intensity = 0; }, 90);
    }
    if (!first) {
      const wall = g.arena.rayHit(eye, dir, 45);
      const end = eye.clone().addScaledVector(dir, wall ? wall.dist : 45);
      this._arc(start, end);
      if (wall) g.effects.spawnImpact(wall.point, wall.normal);
      return;
    }
    const chain = w.def.chain + (w.packed ? 3 : 0);
    const hit = new Set();
    let cur = first, from = start, dmg = w.damage * this._dmgMult(w);
    for (let i = 0; i < chain && cur; i++) {
      hit.add(cur);
      const at = chest(cur);
      this._arc(from, at);
      cur.takeDamage(dmg, true, at, 'luck');
      cur.stun?.(0.35);
      g.effects.spawnLuckSpark(at);
      this._paid(w, cur, at);
      from = at;
      dmg *= 0.85;
      let nxt = null, nd = w.def.chainRange;
      for (const e of targets) {
        if (hit.has(e) || e.dead) continue;
        const d = e.mesh.position.distanceTo(cur.mesh.position);
        if (d < nd && !g.arena.lineBlocked(cur.mesh.position, e.mesh.position, false)) { nd = d; nxt = e; }
      }
      if (nxt) g.audioAt('luck_jump', nxt.mesh.position);
      cur = nxt;
    }
    g.ui.hitmarker(true);
  }

  /** a jagged bolt between two points (two flickers, then gone) */
  _arc(a, b) {
    const g = this.game;
    if (!this._arcMats) {
      this._arcMats = [
        new THREE.LineBasicMaterial({ color: new THREE.Color(2.4, 4, 2.6), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
        new THREE.LineBasicMaterial({ color: new THREE.Color(0.6, 3, 1.1), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
        new THREE.LineBasicMaterial({ color: new THREE.Color(3, 2.2, 0.6), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
      ];
    }
    const make = (jag, mat) => {
      const pts = [];
      const n = 12;
      const d = b.clone().sub(a);
      const len = d.length();
      const side = new THREE.Vector3(-d.z, 0, d.x).normalize();
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const k = Math.sin(t * Math.PI) * jag * Math.min(1, len / 4);
        pts.push(a.clone().addScaledVector(d, t).addScaledVector(side, (Math.random() - 0.5) * k).add(new THREE.Vector3(0, (Math.random() - 0.5) * k, 0)));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, mat);
      g.scene.add(line);
      return line;
    };
    const lines = [make(0.35, this._arcMats[0]), make(0.6, this._arcMats[1]), make(0.45, this._arcMats[2])];
    setTimeout(() => {
      for (const l of lines) { g.scene.remove(l); l.geometry.dispose(); }
      const again = [make(0.4, this._arcMats[0]), make(0.7, this._arcMats[1])];
      setTimeout(() => { for (const l of again) { g.scene.remove(l); l.geometry.dispose(); } }, 60);
    }, 55);
  }

  _updateShots(dt) {
    const g = this.game;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.t -= dt;
      let done = s.t <= 0;
      if (s.kind === 'cork') s.vel.y -= 9.8 * dt;
      const step = s.vel.clone().multiplyScalar(dt);
      const len = step.length();
      const dir = step.clone().divideScalar(len || 1);
      if (!done && s.kind === 'card') {
        this.raycaster.set(s.pos, dir);
        this.raycaster.far = len;
        for (const hit of this.raycaster.intersectObjects(g.enemies.hitMeshes(), false)) {
          const ref = hit.object.userData.ref;
          if (!ref || s.hit.has(ref) || ref.dead) continue;
          s.hit.add(ref);
          this._hit(ref, hit.point, !!hit.object.userData.isHead, s.w, s.hit.size > 1 ? 0.85 : 1);
          if (--s.left <= 0) { done = true; break; }
        }
        const wall = g.arena.rayHit(s.pos, dir, len);
        if (!done && wall) { g.effects.spawnImpact(wall.point, wall.normal); g.audioAt('card', wall.point); done = true; }
        s.spin.rotation.z += dt * 30;
      }
      if (!done && s.kind === 'cork') {
        let boom = s.pos.y < 0.12 || !!g.arena.rayHit(s.pos, dir, len);
        if (!boom) {
          for (const e of [...g.enemies.list, ...g.bosses]) {
            if (e.dead) continue;
            const c = e.mesh.position;
            const r = 0.7 + (e.def?.scale || 1) * 0.3;
            if (Math.hypot(c.x - s.pos.x, c.z - s.pos.z) < r && s.pos.y < 2.2 * (e.mesh.scale.y || 1)) { boom = true; break; }
          }
        }
        if (Math.random() < 0.6) g.effects.spawnTrail(s.pos, 0xffd060);
        s.mesh.lookAt(s.pos.clone().add(s.vel));
        if (boom) {
          g.enemies.explodeAt(s.pos.clone(), s.w.def.radius, s.w.damage * this._dmgMult(s.w), false);
          g.effects.spawnBurst(s.pos.clone(), 0xffd060, 12, 7);
          done = true;
        }
      }
      if (done) {
        g.scene.remove(s.mesh);
        this.shots.splice(i, 1);
        continue;
      }
      s.pos.add(step);
      s.mesh.position.copy(s.pos);
    }
  }

  clearShots() {
    for (const s of this.shots) this.game.scene.remove(s.mesh);
    this.shots = [];
  }

  /** muzzle position in world space (the viewmodel lives in camera space) */
  muzzleWorld() {
    const m = this.vmModels[this.currentId];
    const mz = m.userData.muzzle.clone();
    m.updateMatrixWorld(true);
    mz.applyMatrix4(m.matrixWorld);   // -> camera space
    return this.game.camera.localToWorld(mz);
  }

  _tracer(dir, dist) {
    const g = this.game;
    if (!this._tracerMat) {
      this._tracerMat = new THREE.LineBasicMaterial({ color: new THREE.Color(3.2, 2.4, 1.2), transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false });
      this._tracerGold = new THREE.LineBasicMaterial({ color: new THREE.Color(4, 2.8, 0.6), transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false });
    }
    const mat = this.current.packed ? this._tracerGold : this._tracerMat;
    const start = this.muzzleWorld();
    const end = g.camera.position.clone().add(dir.clone().multiplyScalar(dist));
    // a short streak partway down the path reads better than a full laser line
    const a = start.clone().lerp(end, Math.random() * 0.3);
    const b = a.clone().lerp(end, Math.min(1, 6 / Math.max(dist, 0.1)));
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, mat);
    g.scene.add(line);
    setTimeout(() => { g.scene.remove(line); geo.dispose(); }, 45);
  }

  // ------------------------------ reload ------------------------------------
  startReload() {
    const w = this.current;
    if (this.reloading || this.switchT > 0 || this.drinkT > 0 || w.mag >= w.magSize || w.reserve <= 0) return;
    this.reloading = true;
    this.reloadT = 0;
    this.anim.startReload(this.currentId, Math.min(w.magSize - w.mag, w.reserve), w.reloadTime);
  }

  refillAll() {
    for (const id of this.owned()) {
      const w = this.arsenal[id];
      w.reserve = w.maxReserve;
      w.mag = w.magSize;
    }
    this.game.ui.updateHUD();
  }

  addReservePct(pct) {
    for (const id of this.owned()) {
      const w = this.arsenal[id];
      w.reserve = Math.min(w.maxReserve, w.reserve + Math.round(w.def.reserve * pct));
    }
  }

  applyReservePenalty(mult) {
    for (const id of this.owned()) { const w = this.arsenal[id]; w.reserve = Math.floor(w.reserve * mult); }
    this.game.ui.updateHUD();
  }

  // --------------------------- melee + throws -------------------------------
  tryMelee() {
    const g = this.game;
    if (g.state !== 'COMBAT' || this.meleeCd > 0 || this.drinkT > 0) return;
    this.meleeCd = CONFIG.melee.cooldown;
    Audio.play('melee');
    this.kick = 1.6;
    this.anim.melee();
    const fwd = new THREE.Vector3(0, 0, -1).applyEuler(g.camera.rotation);
    const targets = [...g.enemies.list, ...g.bosses.filter((b) => !b.dead)];
    const mult = g.playerMods.meleeDmg * (g.vice === 'brawler' ? 2.5 : 1);
    for (const e of targets) {
      const to = e.mesh.position.clone().sub(g.player.pos);
      const d = to.length();
      if (d > CONFIG.melee.range + (e.def?.scale || 1) * 0.5) continue;
      to.normalize();
      if (to.dot(fwd) < CONFIG.melee.arcDot) continue;
      e.takeDamage(CONFIG.melee.damage * mult, false, e.mesh.position, 'melee');
      if (e.knockback) e.knockback(fwd, CONFIG.melee.knockback);
      if (e.dead && g.vice === 'brawler') g.player.heal(5);
      g.ui.hitmarker(false);
    }
  }

  /**
   * the throwing arm: winds up with `prop` in the left hand and calls
   * release() at the top of the throw. Returns false if busy.
   */
  throwItem(prop, release) {
    const g = this.game;
    if (g.state !== 'COMBAT' || this._throwing || this.drinkT > 0) return false;
    this._throwing = true;
    const ud = this.vmModels[this.currentId].userData;
    if (this._throwProp) this._throwProp.parent?.remove(this._throwProp);
    this._throwProp = prop || null;
    if (prop) {
      prop.position.copy(ud.carry.chip.position);
      prop.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
      ud.fist.add(prop);
    }
    this.anim.throw();
    Audio.play('whoosh');
    setTimeout(() => {
      this._throwing = false;
      if (g.state !== 'COMBAT') { release(false); return; }
      release(true);
      Audio.play('card');
    }, 240);
    setTimeout(() => { if (this._throwProp === prop && prop) { prop.parent?.remove(prop); this._throwProp = null; } }, 600);
    return true;
  }

  // ------------------------------ drinking ----------------------------------
  /** hand the gun over for a few seconds (ALL IN) — it comes back up when onDone runs */
  holdDown(seconds, onDone) {
    if (this.drinkT > 0) return false;
    this.drinkT = seconds;
    this._drinkLen = seconds;
    this._holdOnly = true;
    this._drinkDone = onDone;
    this._drinkEv = new Set();
    this.reloading = false;
    this.anim.cancelReload();
    this.game.ui.reloadBar(null);
    return true;
  }

  /** knock back a cocktail from an automat; onDone fires after the last gulp */
  drink(def, onDone) {
    if (this.drinkT > 0) return false;
    this.drinkT = DRINK_TIME;
    this._drinkLen = DRINK_TIME;
    this._holdOnly = false;
    this._drinkDone = onDone;
    this._drinkEv = new Set();
    this.reloading = false;
    this.anim.cancelReload();
    this.game.ui.reloadBar(null);
    if (this.drinkGlass) this.drinkRig.remove(this.drinkGlass);
    this.drinkGlass = cocktailGlass(def.color, { glow: 0.45 });
    this.drinkGlass.scale.setScalar(0.85);
    this.drinkGlass.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    this.drinkRig.add(this.drinkGlass);
    Audio.play('pour');
    return true;
  }

  _updateDrink(dt) {
    const t = 1 - this.drinkT / (this._drinkLen || DRINK_TIME);
    if (this._holdOnly) {
      this.drinkRig.visible = false;
      this.drinkT -= dt;
      if (this.drinkT <= 0) {
        this.drinkT = 0;
        const done = this._drinkDone;
        this._drinkDone = null;
        done?.();
      }
      return track(t, [[0, 0], [0.1, 0.5], [0.9, 0.5], [1, 1]]);
    }
    const ev = (at, name) => { if (t >= at && !this._drinkEv.has(name)) { this._drinkEv.add(name); Audio.play(name); } };
    ev(0.26, 'glass_clink');
    ev(0.44, 'gulp');
    ev(0.58, 'gulp');
    ev(0.84, 'glass_smash');
    const r = this.drinkRig;
    r.visible = t > 0.08 && t < 0.9;
    // up from below, a look at it, to the lips (tipping back), then tossed away
    const P = track(t, [[0.08, [0.12, -0.46, -0.4]], [0.28, [0.06, -0.19, -0.38]], [0.42, [0.02, -0.17, -0.3]], [0.68, [0.01, -0.15, -0.27]], [0.78, [0.1, -0.2, -0.32]], [0.9, [0.4, -0.5, -0.34]]]);
    const R = track(t, [[0.08, [0.2, 0, -0.2]], [0.28, [0, 0.25, 0]], [0.42, [0.85, 0.15, 0.05]], [0.68, [1.25, 0.1, 0.1]], [0.78, [0.6, 0, -0.6]], [0.9, [0.3, 0.6, -1.8]]]);
    r.position.set(P[0], P[1], P[2]);
    r.rotation.set(R[0], R[1], R[2]);
    // the liquid drains as you drink
    const liq = this.drinkGlass?.userData.liquid;
    if (liq) liq.scale.setScalar(Math.max(0.05, 1 - clamp((t - 0.42) / 0.28, 0, 1)));
    this.drinkT -= dt;
    if (this.drinkT <= 0) {
      this.drinkT = 0;
      r.visible = false;
      const done = this._drinkDone;
      this._drinkDone = null;
      done?.();
    }
    // the gun sits low while the glass is up
    return track(t, [[0, 0], [0.12, 0.5], [0.86, 0.5], [1, 1]]);
  }

  // ------------------------------ update ------------------------------------
  update(dt) {
    const g = this.game;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.meleeCd = Math.max(0, this.meleeCd - dt);
    this.critGrenadeCd = Math.max(0, (this.critGrenadeCd ?? 0) - dt);
    this._updateShots(dt);

    if (this.reloading) {
      const w = this.current;
      this.reloadT += dt;
      g.ui.reloadBar(clamp(this.reloadT / w.reloadTime, 0, 1));
      if (this.reloadT >= w.reloadTime) {
        const need = w.magSize - w.mag;
        const take = Math.min(need, w.reserve);
        w.mag += take;
        w.reserve -= take;
        // Devil's Reload: speed has a price
        if (g.playerMods.reloadHpCost > 0 && take > 0) {
          g.player.hp = Math.max(1, g.player.hp - g.playerMods.reloadHpCost);
        }
        this.reloading = false;
        g.ui.reloadBar(null);
        g.ui.updateHUD();
      }
    }

    // full-auto
    if (this.triggerHeld && this.current.def.auto) this.tryFire();

    // ---- weapon switch: drop, swap at the bottom, rise ----
    let switchProg = 0;
    if (this.switchT > 0) {
      const T = this.switchTime;
      this.switchT = Math.max(0, this.switchT - dt);
      switchProg = 1 - this.switchT / T;
      if (switchProg >= 0.5 && this.pendingSlot >= 0) {
        this.slot = this.pendingSlot;
        this.pendingSlot = -1;
        this.currentId = this.slots[this.slot];
        this._refreshViewmodel();
        g.ui.updateHUD();
        Audio.play(GUNFX[this.currentId].raise);
      }
    }
    if (this.drinkT > 0) switchProg = this._updateDrink(dt);

    // ---- the gun as a machine: recoil, actions, reloads, melee, throws ----
    const w = this.current;
    const keys = g.player.keys;
    const moving = g.player.onGround && (keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD']);
    const sprinting = moving && (keys['ShiftLeft'] || keys['ShiftRight']) && !g.player.aiming
      && this.cooldown <= 0 && !this.triggerHeld;
    const pose = this.anim.update(dt, this.currentId, {
      reloadP: this.reloading ? clamp(this.reloadT / w.reloadTime, 0, 1) : 1,
      switchProg,
      sprinting,
      onEvent: (name) => this._animEvent(name),
    });
    const model = this.vmModels[this.currentId];
    model.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
    model.rotation.set(pose.rot[0], pose.rot[1], pose.rot[2]);
    // a thrown lethal/tactical rides where the chip bomb would
    if (this._throwProp) {
      const ud = model.userData;
      this._throwProp.visible = ud.carry.chip.visible;
      ud.carry.chip.visible = false;
      if (this._throwProp.parent !== ud.fist) { ud.fist.add(this._throwProp); this._throwProp.position.copy(ud.carry.chip.position); }
    }

    // gilded guns catch the light
    const gm = this._gildMats?.[this.currentId];
    if (gm) {
      const k = 0.28 + 0.22 * Math.max(0, Math.sin(performance.now() / 380));
      for (const m of gm) m.emissiveIntensity = k;
    }

    // ---- walk sway (figure-eight) + idle breathing ----
    this.kick = Math.max(0, this.kick - dt * 8);
    const run = sprinting ? 1.7 : 1;
    const swayX = moving ? Math.sin(g.player.bobT) * 0.013 * run : 0;
    const swayY = moving ? -Math.abs(Math.cos(g.player.bobT)) * 0.012 * run : 0;
    const breathe = Math.sin(performance.now() / 640) * 0.006;
    this._airDip = (this._airDip || 0) + ((g.player.onGround ? 0 : -0.025) - (this._airDip || 0)) * Math.min(1, dt * 6);

    const aim = g.player.aiming && !this.reloading && this.switchT <= 0 && this.drinkT <= 0;
    // hip: low and right. aim: sights on the crosshair
    const hip = GUNFX[this.currentId].hip;
    const baseX = aim ? 0 : hip[0];
    const baseY = aim ? -0.064 : hip[1];
    const baseZ = aim ? -0.34 : hip[2];
    // look sway: the gun lags a touch behind fast mouse turns
    const lookX = clamp((g.player._lookDX || 0) * 0.0009, -0.03, 0.03);
    const lookY = clamp((g.player._lookDY || 0) * 0.0009, -0.03, 0.03);
    g.player._lookDX = (g.player._lookDX || 0) * Math.max(0, 1 - dt * 10);
    g.player._lookDY = (g.player._lookDY || 0) * Math.max(0, 1 - dt * 10);
    const target = new THREE.Vector3(
      baseX + swayX * (aim ? 0.3 : 1) - lookX,
      baseY + swayY * (aim ? 0.3 : 1) + breathe * (aim ? 0.3 : 1) + lookY + this._airDip,
      baseZ);
    this.vm.position.lerp(target, Math.min(1, dt * 14));
    const strafe = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
    this._tilt = (this._tilt || 0) + (-strafe * 0.05 - (this._tilt || 0)) * Math.min(1, dt * 6);
    this.vm.rotation.x = 0.02 + (moving ? Math.cos(g.player.bobT * 2) * 0.008 * run : 0);
    this.vm.rotation.y += ((aim ? 0 : hip[3]) + lookX * 2 - this.vm.rotation.y) * Math.min(1, dt * 10);
    this.vm.rotation.z = this._tilt + (moving ? Math.sin(g.player.bobT) * 0.02 * run : 0);

    g.ui.crosshairSpread(this.kick * 10 + (g.player.aiming ? 0 : 4) + (sprinting ? 10 : 0));
  }

  /** timeline events from the animator: foley, casings, the dropped mag */
  _animEvent(name) {
    const g = this.game;
    const model = this.vmModels[this.currentId];
    const ud = model.userData;
    if (name === 'casings') {
      Audio.play('eject');
      const src = ud.drum || ud.hinge;
      src.updateMatrixWorld(true);
      const p = new THREE.Vector3().setFromMatrixPosition(src.matrixWorld);
      g.effects.spawnCasings(g.camera.localToWorld(p), ud.casings ?? 6);
      return;
    }
    if (name === 'magdrop') {
      ud.mag.updateMatrixWorld(true);
      const p = new THREE.Vector3().setFromMatrixPosition(ud.mag.matrixWorld);
      const q = new THREE.Quaternion().setFromRotationMatrix(ud.mag.matrixWorld);
      q.premultiply(g.camera.quaternion);
      const copy = ud.mag.clone(true);
      copy.scale.setScalar(0.9);
      g.effects.spawnDebris(copy, g.camera.localToWorld(p), q, g.player.rightFlat().multiplyScalar(-0.4).setY(-0.5));
      return;
    }
    Audio.play(name);
  }

  onLand(fallSpeed) { this.anim.land(fallSpeed); }
}

export { GUNFX };
