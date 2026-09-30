// enemies.js — the horde. Ten kinds of casino zombie, each a fully rigged,
// skinned, dressed character (see chars/):
//   walker    — shuffling gambler (basic melee)
//   sprinter  — valet, fast and fragile
//   brute     — bouncer, slow tank
//   spitter   — cocktail server, lobs acid from range
//   gasbag    — bloated high roller, EXPLODES on death (stand back)
//   pitguard  — armored body, weak glowing head
//   collector — THE DEBT COLLECTOR (severe penalty): hunts you, steals chips
//   croupier  — flings razor-card bursts from range
//   magician  — teleports toward you in a purple poof
//   jackpot   — walking slot machine; flees, pays out big if you catch it
//               (and drops THE BANDIT'S ARM for LADY LUCK)
//   showgirl  — a dead chorus-line dancer: fast, fragile, high kicks
//   king      — THE KING: croons mid-fight and whips the horde into a frenzy
// Plus the enemy projectile pool and the player's chip-bomb grenades.

import * as THREE from 'three';
import { CONFIG, rand, randInt, pick } from './config.js';
import { Seed } from './rng.js';
import { Character } from './chars/character.js';
import { cardMesh } from './chars/props.js';
import { chipBombMesh } from './gfx/models.js';
import { STYLE } from './gfx/style.js';

const E = CONFIG.enemies;
const CARD_FACES = [['A', '♠'], ['K', '♥'], ['Q', '♦'], ['J', '♣'], ['7', '♥'], ['A', '♦']];
const _flow = { x: 0, z: 0 };

/**
 * which way should a body at pos walk to reach target? Straight at it when
 * the floor between is clear, otherwise downhill on the nav flow field.
 * state: { los, losT, heading: Vector3 } kept per walker. Returns heading.
 */
export function steer(game, state, pos, target, dt, nav = game.arena.nav) {
  const dx = target.x - pos.x, dz = target.z - pos.z;
  const dist = Math.hypot(dx, dz) || 1e-4;
  state.losT = (state.losT ?? 0) - dt;
  if (state.losT <= 0) {
    state.losT = 0.2 + Math.random() * 0.15;
    state.los = nav.lineClear(pos.x, pos.z, target.x, target.z);
  }
  let wx = dx / dist, wz = dz / dist;
  if (!state.los && dist > 1.5 && nav.flow(pos.x, pos.z, _flow)) { wx = _flow.x; wz = _flow.z; }
  const h = state.heading || (state.heading = new THREE.Vector3(wx, 0, wz));
  const k = Math.min(1, dt * 9);
  h.x += (wx - h.x) * k; h.z += (wz - h.z) * k;
  const l = Math.hypot(h.x, h.z) || 1;
  h.x /= l; h.z /= l;
  return h;
}

/** how fast is it really going (for the cartoon's dust puffs) */
const mvK = (z) => z.speed * (z.fx.slowT > 0 ? z.fx.slowMult : 1) * (z.fx.hypeT > 0 ? 1.45 : 1) * (z.disabled || z.riseT > 0 ? 0 : 1);

// ------------------------------- one zombie ---------------------------------
class Zombie {
  constructor(game, kind, roundScale, elite = false) {
    this.game = game;
    this.kind = kind;
    this.def = { name: kind.toUpperCase(), ...E[kind] };
    if (kind === 'collector') this.def.name = 'THE DEBT COLLECTOR';
    this.elite = elite;

    const hpMult = roundScale.hp * (elite ? CONFIG.eliteMult.hp : 1);
    this.maxHp = this.hp = this.def.hp * hpMult;
    this.speed = this.def.speed * (elite ? CONFIG.eliteMult.speed : 1) * roundScale.speedMult;
    this.damage = this.def.damage * roundScale.dmg;
    this.dead = false;
    this.attackCd = 0;
    this.hitFlash = 0;
    this.kbVel = new THREE.Vector3();
    this.animSpeed = 0;
    this._prev = new THREE.Vector3();
    this.nav = {};                 // steering memory (line of sight, heading)
    // status effects from the player's tacticals and lethals
    this.fx = { slowT: 0, slowMult: 1, stunT: 0, slipT: 0, slipCd: 0, burnT: 0, burnDps: 0, burnTick: 0, hypeT: 0 };
    if (kind === 'king') this.def.name = 'THE KING';

    this._buildMesh();
    this.nid = game.net.nextId++;              // co-op: how both screens name this one
    if (game.net.isHost) game.net.hookChar(this);
  }

  /** a GOLDEN GAMBLER: tougher, quicker, dripping gold — and a guaranteed Epic comp */
  makeGolden() {
    this.golden = true;
    this.maxHp = this.hp = this.hp * 3;
    this.speed *= 1.3;
    this.def = { ...this.def, name: 'THE GOLDEN GAMBLER', chips: [120, 180] };
  }

  // ------------------------------ status effects ------------------------------
  slow(mult, t) { this.fx.slowMult = Math.min(this.fx.slowT > 0 ? this.fx.slowMult : 1, mult); this.fx.slowT = Math.max(this.fx.slowT, t); }
  stun(t) { if (this.kind === 'jackpot') t *= 0.5; this.fx.stunT = Math.max(this.fx.stunT, t); this.char.daze(t); }
  slip(t = 2.2) {
    if (this.fx.slipCd > 0 || this.fx.slipT > 0) return false;
    if (this.kind === 'brute' || this.kind === 'pitguard') t *= 0.7;   // big boys get up quicker
    this.fx.slipT = t; this.fx.slipCd = t + 1.6;
    this.char.slip(t);
    this.game.audioAt('slip', this.mesh.position);
    return true;
  }
  ignite(dps, t) { this.fx.burnDps = Math.max(this.fx.burnT > 0 ? this.fx.burnDps : 0, dps); this.fx.burnT = Math.max(this.fx.burnT, t); }
  get disabled() { return this.fx.stunT > 0 || this.fx.slipT > 0; }

  _buildMesh() {
    this.char = new Character(this.kind, { elite: this.elite, hitRef: this });
    this.mesh = this.char.root;                 // world placement lives on the root
    // visual size: kinds still differ, but the builds carry most of the bulk now
    const vs = Math.pow(this.def.scale, 0.72) * (0.94 + Math.random() * 0.12);
    this.mesh.scale.setScalar(vs);
    this.parts = this.char.hitboxes;
    this.groanT = rand(3, 12);

    // claw up out of the floor somewhere open, away from (and ideally behind) you
    const p = this.game.player;
    this.mesh.position.copy(this.game.arena.spawnPoint(p.pos, p.forwardFlat()));
    this.game.arena.collide(this.mesh.position, 0.5);
    this.char.rise(0.75);
    this.riseT = 0.75;
    this.game.scene.add(this.mesh);
    this.game.effects.spawnDust?.(this.mesh.position, 1.2);
  }

  knockback(dir, force) {
    this.kbVel.add(dir.clone().setY(0).normalize().multiplyScalar(force));
  }

  takeDamage(dmg, strong, point, cause = 'hit', isHead = false) {
    if (this.dead) return;
    if (cause !== 'fire') this.lastHitBy = this._by ?? 0;      // co-op: the seat that fired (0 = the host)
    this.lastCause = cause;
    this._lastHitHead = isHead;
    // pit guard body armor: full damage only on the head
    if (this.kind === 'pitguard' && !isHead) dmg *= (1 - this.def.bodyResist);
    if (this._by == null) this.game.stats.damage += Math.max(0, Math.min(dmg, this.hp));   // the scoreboard (guests count their own)
    this.hp -= dmg;
    this.hitFlash = 0.08;
    this.char.flinch(strong ? 0.9 : 0.5);
    // stagger: bullets shove, scaled down for the big ones
    const away = this.mesh.position.clone().sub(this.game.player.pos).setY(0).normalize();
    this.kbVel.add(away.multiplyScalar((strong ? 2.2 : 1.3) / this.def.scale));
    if (point && this.game.settings) {
      this.game.ui.floatText(point, Math.round(dmg), strong ? 'dmg crit' : 'dmg');
    }
    if (this.hp <= 0) this.die();
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    const g = this.game;
    g.audioAt('zombie_die', this.mesh.position);
    if (!g.net.creditedElsewhere(this)) g.onKill(this);    // co-op: another seat's kill goes on their card

    // drops
    const chipMult = this.elite ? CONFIG.eliteMult.chips : 1;
    const amt = Math.round(randInt(this.def.chips[0], this.def.chips[1]) * chipMult);
    if (g.net.active) g.net.creditKill(this, amt + (this.stash || 0));    // co-op: the killer gets paid
    else g.pickups.spawnChips(this.mesh.position.clone(), amt + (this.stash || 0));
    if (this.stash) g.ui.banner(`DEBT RECLAIMED +${this.stash} chips (with interest)`, 'gold');
    g.pickups.spawnDrop(this.mesh.position.clone().add(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1))));
    g.rewards.rollDrop(this);                         // comps: the rarer the enemy, the rarer the comp
    // the walking slot machine's arm comes off — LADY LUCK needs it
    if (this.kind === 'jackpot' && g.wonder && (g.net.active || !g.wonder.has('arm')) && !g.pickups.list.some((p) => p.part === 'arm')) {
      g.pickups.spawnPart(this.mesh.position.clone(), 'arm');
      g.ui.banner("THE JACKPOT'S ARM CAME OFF — GRAB IT", 'gold', 2600);
    }
    if (this.kind === 'king') {
      g.ui.banner('THE KING HAS LEFT THE BUILDING', 'gold', 2800);
      g.audioAt('cheer', this.mesh.position);
    }

    // gasbag explodes on death — no corpse, it IS the explosion
    if (this.kind === 'gasbag') {
      g.effects.spawnGibs?.(this.mesh.position.clone().setY(1.2), 0x7a8a2a);
      g.enemies.explodeAt(this.mesh.position.clone(), this.def.blastRadius, this.damage, true);
      g.scene.remove(this.mesh);
      this.char.dispose();
      return;
    }
    const headPop = this._lastHitHead && this.lastCause !== 'explosion' && Math.random() < 0.7;
    if (STYLE.cartoon) {
      // knocked clean out: a puff, and the little ghost floats up out of him
      g.effects.toonCloud?.(this.mesh.position.clone().setY(1.2 * this.mesh.scale.y), 1.1);
      g.effects.spawnGhost?.(this.mesh.position.clone().setY(1.6 * this.mesh.scale.y));
    }
    const top = this.mesh.position.clone().setY(1.55 * this.mesh.scale.y);
    if (headPop) {
      g.effects.spawnHeadPop?.(top.setY(1.7 * this.mesh.scale.y));
    } else {
      g.effects.spawnBlood?.(top, 10, 3.5);
    }
    g.effects.spawnDecal?.(this.mesh.position, 1.1 + Math.random() * 0.8);
    // collapse and fall — with some variety in how they go down
    const style = this.kind === 'sprinter' && Math.random() < 0.5 ? 'spin'
      : this.lastCause === 'explosion' ? 'back' : null;
    this.char.die(style, headPop);
    g.enemies.corpses.push({ char: this.char, mesh: this.mesh });
  }

  update(dt) {
    const g = this.game;
    const p = g.targetFor(this);             // the nearest player still on their feet
    this.attackCd = Math.max(0, this.attackCd - dt);
    this._prev.copy(this.mesh.position);
    if (this.riseT > 0) this.riseT -= dt;
    const risen = this.riseT <= 0;

    // ambient groans (only nearby, so it doesn't turn into a choir)
    this.groanT -= dt;
    if (this.groanT <= 0) {
      this.groanT = rand(6, 16);
      if (this.mesh.position.distanceTo(p.pos) < 30) g.audioAt('groan', this.mesh.position);
    }

    // heavy footsteps for the big ones — you hear them coming
    if (this.kind === 'brute' || this.kind === 'collector' || this.kind === 'pitguard') {
      this.stepT = (this.stepT ?? 0) - dt;
      if (this.stepT <= 0) {
        this.stepT = Math.max(0.3, 1.4 / this.speed);
        if (this.mesh.position.distanceTo(p.pos) < 18) {
          g.audioAt(this.kind === 'collector' ? 'step_click' : 'step_heavy', this.mesh.position);
        }
      }
    }

    // hit flash / gasbag about to blow
    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      this.char.setFlash(STYLE.cartoon ? 0.45 : 0.9, 0xffd8b0);
    } else if (this.kind === 'gasbag' && this.hp < this.maxHp * 0.35) {
      const pulse = 0.25 + 0.25 * Math.sin(performance.now() / (g.settings.reducedFlash ? 400 : 120));
      this.char.setFlash(pulse, 0x9dff4a);
      this.char.bones.spine.scale.setScalar(1.08 + pulse * 0.2);
    } else if (this.golden) {
      this.char.setFlash(0.32 + 0.14 * Math.sin(performance.now() / 110), 0xffd24a);
      if (Math.random() < 0.15) g.effects.spawnBurst(this.mesh.position.clone().setY(1.4), 0xffd24a, 1, 1.5);
    } else if (this.fx.hypeT > 0) {
      // whipped up by THE KING: a hot pink shimmer
      this.char.setFlash(0.18 + 0.12 * Math.sin(performance.now() / 90), 0xff4aa0);
    } else {
      this.char.setFlash(0);
    }

    // ------------------------------ status ------------------------------
    const fx = this.fx;
    fx.slowT = Math.max(0, fx.slowT - dt);
    fx.stunT = Math.max(0, fx.stunT - dt);
    fx.slipT = Math.max(0, fx.slipT - dt);
    fx.slipCd = Math.max(0, fx.slipCd - dt);
    if (fx.burnT > 0) {
      fx.burnT -= dt;
      fx.burnTick -= dt;
      if (Math.random() < 0.5) g.effects.spawnFire(this.mesh.position.clone().setY(0.4 + Math.random() * 1.3 * this.mesh.scale.y), 0.7);
      if (fx.burnTick <= 0) {
        fx.burnTick = 0.25;
        this.takeDamage(fx.burnDps * 0.25, false, null, 'fire');
        if (this.dead) return;
      }
    }
    fx.hypeT = Math.max(0, fx.hypeT - dt);
    const speedK = (fx.slowT > 0 ? fx.slowMult : 1) * (fx.hypeT > 0 ? 1.45 : 1);
    const disabled = this.disabled;

    // chase the player — or the False Jackpot ringing somewhere nearby
    const lure = g.enemies.lure;
    const lured = lure && this.kind !== 'jackpot' && this.mesh.position.distanceTo(lure.pos) < lure.radius;
    const target = lured ? lure.pos : p.pos;
    const toPlayer = p.pos.clone().sub(this.mesh.position); toPlayer.y = 0;
    const dist = toPlayer.length();
    toPlayer.normalize();
    const dir = steer(g, this.nav, this.mesh.position, target, dt, lured ? g.arena.nav : p.nav);
    const sees = this.nav.los && !lured;
    // turn to face where we're headed (or the player once they're close and in sight)
    const face = (sees && dist < 8) || lured ? toPlayer : dir;
    const want = lured ? Math.atan2(target.x - this.mesh.position.x, target.z - this.mesh.position.z)
      : Math.atan2(face.x, face.z) + (this.kind === 'jackpot' ? Math.PI : 0);
    let dy = want - this.mesh.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    if (!disabled) this.mesh.rotation.y += dy * Math.min(1, dt * (this.kind === 'sprinter' ? 12 : 7));

    // 1930s: a runner kicks up little cartoon dust clouds
    if (STYLE.cartoon && mvK(this) > 3.2) {
      this._puffT = (this._puffT || 0) - dt;
      if (this._puffT <= 0) { this._puffT = 0.16; g.effects.spawnToonPuff?.(this.mesh.position.clone().setY(0.12)); }
    }
    // knockback decay
    if (this.kbVel.lengthSq() > 0.01) {
      this.mesh.position.add(this.kbVel.clone().multiplyScalar(dt));
      this.kbVel.multiplyScalar(Math.max(0, 1 - 6 * dt));
    }

    // behavior
    const mv = (risen ? 1 : 0.35) * speedK * (disabled ? 0 : 1);
    const canHit = risen && !disabled && !lured;
    if (lured) {
      // crowd the fake jackpot, paws out
      if (this.mesh.position.distanceTo(target) > 1.4) this.mesh.position.addScaledVector(dir, this.speed * dt * mv);
    } else if (this.kind === 'jackpot') {
      // flees the player; escapes for good if you don't kill it in time
      this.mesh.position.add(toPlayer.multiplyScalar(-this.speed * dt * mv));
    } else if (this.kind === 'magician') {
      this.blinkT = (this.blinkT ?? this.def.blinkCd) - dt;
      if (this.blinkT <= 0 && dist > 6 && risen && !disabled) {
        this.blinkT = this.def.blinkCd;
        // poof out, reappear 5-8m from the player at a random angle (somewhere you can stand)
        for (let tries = 0; tries < 8; tries++) {
          const a = Math.random() * Math.PI * 2;
          const r2 = 5 + Math.random() * 3;
          const nx = p.pos.x + Math.cos(a) * r2, nz = p.pos.z + Math.sin(a) * r2;
          if (!g.arena.walkable(nx, nz)) continue;
          g.effects.spawnPoof?.(this.mesh.position.clone().setY(1.2), 0xc27aff);
          this.mesh.position.set(nx, 0, nz);
          g.arena.collide(this.mesh.position, 0.5);
          this._prev.copy(this.mesh.position);
          g.effects.spawnPoof?.(this.mesh.position.clone().setY(1.2), 0xc27aff);
          g.audioAt('card', this.mesh.position);
          break;
        }
      } else {
        this.mesh.position.addScaledVector(dir, this.speed * dt * mv);
      }
      const reachM = 1.3 + this.def.scale * 0.4;
      if (dist < reachM && this.attackCd <= 0 && canHit) {
        this.attackCd = 1.1;
        this.char.attack('swipe', 0.4);
        p.takeDamage(this.damage, this);
      }
    } else if (this.kind === 'croupier') {
      // keeps dealing distance, flings a fan of razor cards — only with a clear line
      const want2 = this.def.attackRange * 0.8;
      if (dist > this.def.attackRange || !sees) this.mesh.position.addScaledVector(dir, this.speed * dt * mv);
      else if (dist < want2 - 2) this.mesh.position.add(toPlayer.clone().multiplyScalar(-this.speed * 0.6 * dt * mv));
      if (dist <= this.def.attackRange && sees && this.attackCd <= 0 && canHit) {
        this.attackCd = this.def.attackCd;
        this.char.attack('throw', 0.55);
        g.audioAt('card', this.mesh.position);
        const base = p.pos.clone().sub(this.mesh.position).setY(0).normalize();
        setTimeout(() => {
          if (this.dead) return;
          for (let i = 0; i < this.def.burst; i++) {
            const a = (i - (this.def.burst - 1) / 2) * 0.12;
            const dir = base.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
            dir.y = 0.03;
            g.enemies.spawnProjectile(
              this.mesh.position.clone().add(new THREE.Vector3(0, 1.6, 0)),
              dir.multiplyScalar(this.def.projSpeed), this.damage, 0xf5f0e0, this);
          }
        }, 260);
      }
    } else if (this.kind === 'spitter') {
      const want2 = this.def.attackRange * 0.8;
      if (dist > this.def.attackRange || !sees) this.mesh.position.addScaledVector(dir, this.speed * dt * mv);
      else if (dist < want2 - 2) this.mesh.position.add(toPlayer.clone().multiplyScalar(-this.speed * 0.7 * dt * mv));
      if (dist <= this.def.attackRange && sees && this.attackCd <= 0 && canHit) {
        this.attackCd = this.def.attackCd;
        this.char.attack('spit', 0.5);
        g.audioAt('gas_hiss', this.mesh.position);
        setTimeout(() => {
          if (this.dead) return;
          const from = this.mesh.position.clone().add(new THREE.Vector3(0, 1.65 * this.mesh.scale.y, 0));
          const aim = p.pos.clone().sub(from).normalize();
          g.enemies.spawnProjectile(from, aim.multiplyScalar(this.def.projSpeed), this.damage, 0x7aff4a, this);
        }, 220);
      }
    } else {
      // THE KING: every few seconds he stops, strikes a pose and croons, and
      // the whole floor goes wild — everything near him speeds up
      if (this.kind === 'king') {
        this.poseT = (this.poseT ?? this.def.poseCd * 0.6) - dt;
        if (this.poseT <= 0 && risen && !disabled && dist < 22) {
          this.poseT = this.def.poseCd;
          this.posing = 1.7;
          this.char.attack('pose', 1.7);
          g.audioAt('croon', this.mesh.position);
          g.effects.spawnBurst(this.mesh.position.clone().setY(2.2), 0xffd060, 10, 4);
          let n = 0;
          for (const z of g.enemies.list) {
            if (z === this || z.dead) continue;
            if (z.mesh.position.distanceTo(this.mesh.position) < 14) { z.fx.hypeT = this.def.hype; n++; }
          }
          if (n) g.ui.prompt('THE KING WORKS THE CROWD — they go wild', 1800);
        }
      }
      if (this.posing > 0) this.posing -= dt;
      // melee chasers (the showgirls and the King kick)
      if (!(this.posing > 0)) this.mesh.position.addScaledVector(dir, this.speed * dt * mv);
      const reach = 1.3 + this.def.scale * 0.4;
      if (dist < reach && this.attackCd <= 0 && canHit && !(this.posing > 0)) {
        this.attackCd = this.kind === 'showgirl' ? 0.9 : 1.1;
        const kicker = this.kind === 'showgirl' || this.kind === 'king';
        this.char.attack(kicker ? 'kick' : 'swipe', 0.45);
        p.takeDamage(this.damage, this);
      }
    }

    // gentle separation so they don't stack — eased over a few frames (a full
    // shove every frame made crowds shudder against each other and the walls)
    const sepK = Math.min(0.5, dt * 10);
    for (const other of g.enemies.list) {
      if (other === this || other.dead) continue;
      const ox = this.mesh.position.x - other.mesh.position.x, oz = this.mesh.position.z - other.mesh.position.z;
      const d = Math.hypot(ox, oz);
      const min = 0.9 * (this.def.scale + other.def.scale) * 0.5 + 0.5;
      if (d < min && d > 1e-4) {
        const f = (min - d) * sepK / d;
        this.mesh.position.x += ox * f; this.mesh.position.z += oz * f;
      }
    }
    g.arena.collide(this.mesh.position, 0.5 * this.def.scale);

    // animate from how far we actually moved this frame (feet match the floor)
    const moved = this._prev.distanceTo(this.mesh.position) / Math.max(dt, 1e-4);
    this.animSpeed += (Math.min(moved, 9) - this.animSpeed) * Math.min(1, dt * 8);
    this.char.update(dt, this.animSpeed / this.mesh.scale.y);
  }
}

// ------------------------------- the manager --------------------------------
export class Enemies {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.projectiles = [];   // enemy shots
    this.grenades = [];      // player chip bombs
    this.corpses = [];       // falling bodies (visual only, not shootable)
    this.spawnQueue = [];
    this.spawnT = 0;
    this._acidGeo = new THREE.SphereGeometry(0.16, 12, 10);
    this._acidMat = new THREE.MeshStandardMaterial({ color: 0x1a4a0a, emissive: 0x7aff4a, emissiveIntensity: 2.5, roughness: 0.2 });
  }

  remaining() { return this.game.net.isGuest ? this.game.net.remoteRemaining : this.list.length + this.spawnQueue.length; }

  hitMeshes() {
    const out = [];
    for (const z of this.list) out.push(...z.parts);
    for (const b of this.game.bosses) if (!b.dead) out.push(...b.parts);
    return out;
  }

  // ------------------------------ round setup -------------------------------
  buildRound(round, mods) {
    this.clearAll();
    const S = CONFIG.spawn;
    let count = Math.round((S.baseCount + S.perRound * (round - 1)) * (mods.countMult || 1));
    if (mods.bossRound) count = Math.round(count * 0.55);

    const queue = [];
    for (let i = 0; i < count; i++) {
      let kind = 'walker';
      const r = Seed.random('horde');
      if (mods.onlyKinds) {                                  // RUSH HOUR etc.
        kind = Seed.pick('horde', mods.onlyKinds);
      } else if (mods.heavyMix) {                            // HEAVYWEIGHT NIGHT
        kind = r < 0.4 ? 'brute' : r < 0.75 ? 'pitguard' : 'walker';
      } else {
        if (round >= 2 && r < 0.22) kind = 'sprinter';
        else if (round >= 3 && r < 0.34) kind = 'spitter';
        else if (round >= 4 && r < 0.42) kind = 'croupier';
        else if (round >= 4 && r < 0.50) kind = 'gasbag';
        else if (round >= 4 && r < 0.58) kind = 'pitguard';
        else if (round >= 6 && r < 0.64) kind = 'magician';
        else if (round >= 6 && r < 0.72) kind = 'brute';
        else if (round >= 3 && r >= 0.72 && r < 0.8) kind = 'showgirl';   // 8%, every round from 3
      }
      queue.push({ kind, elite: !!mods.elite && Seed.random('horde') < 0.25 });
    }
    // penalty: extra specials
    for (let i = 0; i < (mods.extraSpecial || 0); i++) {
      queue.push({ kind: Seed.pick('horde', ['brute', 'gasbag', 'pitguard']), elite: !!mods.elite });
    }
    if (mods.debtCollector) queue.push({ kind: 'collector', elite: false });
    // bonus target: a jackpot wanders in on some rounds — far more often while
    // LADY LUCK still needs its arm
    const armWanted = this.game.wonder && !this.game.wonder.has('arm') && !this.game.wonder.built;
    const jp = mods.bossRound ? 0 : armWanted ? (round >= 2 ? 0.55 : 0) : (round >= 3 ? 0.25 : 0);
    if (Seed.random('horde') < jp) queue.splice(Math.floor(queue.length * (0.3 + Seed.random('horde') * 0.5)), 0, { kind: 'jackpot', elite: false });
    // THE KING drops in on some nights
    if (!mods.bossRound && round >= 4 && Seed.random('horde') < 0.22) queue.splice(Math.floor(queue.length * 0.5), 0, { kind: 'king', elite: false });

    this.spawnQueue = queue;
    this.roundScale = {
      hp: 1 + CONFIG.spawn.hpScalePerRound * (round - 1),
      dmg: (1 + CONFIG.spawn.dmgScalePerRound * (round - 1)) * (mods.dmgMult || 1),
      speedMult: mods.speedMult || 1,
    };
    this.spawnT = 0;
  }

  update(dt) {
    if (this.game.net.isGuest) {
      // the host runs the horde; we animate its puppets and our own chip bombs
      for (const z of this.list) z.update(dt);
      this._updateGrenades(dt);
      this._updateCorpses(dt);
      return;
    }
    // re-flood the nav field around whatever they're chasing, a few times a second
    if (this.lure) {
      this.lure.t -= dt;
      if (this.lure.t <= 0) this.lure = null;
    }
    this.navT = (this.navT ?? 0) - dt;
    if (this.navT <= 0) {
      this.navT = 0.22;
      const t = this.lure ? this.lure.pos : this.game.player.pos;
      this.game.arena.nav.build(t.x, t.z);
      // co-op: a field for every teammate still standing
      if (this.game.net.isHost) for (const r of this.game.net.aliveRemotes()) r.nav.build(r.pos.x, r.pos.z);
    }
    // trickle spawns
    this.spawnT -= dt;
    while (this.spawnQueue.length && this.list.length < CONFIG.spawn.maxAlive && this.spawnT <= 0) {
      const s = this.spawnQueue.shift();
      const z = new Zombie(this.game, s.kind, this.roundScale, s.elite);
      if (s.golden) z.makeGolden();
      this.list.push(z);
      this.spawnT = rand(0.15, 0.5);
      if (s.kind === 'jackpot') {
        z.lifeT = CONFIG.enemies.jackpot.despawn;
        const arm = this.game.wonder && !this.game.wonder.has('arm') && !this.game.wonder.built;
        this.game.ui.banner(arm ? "★ A JACKPOT WALKS THE FLOOR — LADY LUCK WANTS ITS ARM ★" : '★ A JACKPOT WALKS THE FLOOR — CASH IT OUT ★', 'gold', 2600);
        this.game.audioAt('jackpot', z.mesh.position);
      }
      if (s.kind === 'king') {
        this.game.ui.banner('♪ LADIES AND GENTLEMEN… THE KING ♪', 'gold', 2600);
        this.game.audioAt('croon', z.mesh.position);
      }
    }

    for (let i = this.list.length - 1; i >= 0; i--) {
      const z = this.list[i];
      if (z.dead) { this.list.splice(i, 1); continue; }
      // the jackpot escapes if you're too slow — no kill, no payout
      if (z.lifeT !== undefined) {
        z.lifeT -= dt;
        if (z.lifeT <= 0) {
          z.dead = true;
          this.game.effects.spawnPoof?.(z.mesh.position.clone().setY(1.2), 0xffd24a);
          this.game.scene.remove(z.mesh);
          z.char.dispose();
          this.game.ui.prompt('The jackpot cashed out and left...');
          this.list.splice(i, 1);
          continue;
        }
      }
      z.update(dt);
    }
    this._updateProjectiles(dt);
    this._updateGrenades(dt);
    this._updateCorpses(dt);
  }

  _updateCorpses(dt) {
    // cap the pile so a huge round can't tank the frame rate
    while (this.corpses.length > 14) {
      const c = this.corpses.shift();
      this.game.scene.remove(c.mesh);
      c.char.dispose();
    }
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      if (c.char.update(dt)) {
        this.game.scene.remove(c.mesh);
        c.char.dispose();
        this.corpses.splice(i, 1);
      }
    }
  }

  // ---------------------------- enemy projectiles ---------------------------
  spawnProjectile(pos, vel, damage, color, source) {
    let m, kind;
    if (color === 0x7aff4a) {
      kind = 'acid';
      m = new THREE.Mesh(this._acidGeo, this._acidMat);
    } else {
      kind = 'card';
      const [r, s] = pick(CARD_FACES);
      m = cardMesh(r, s, 0.16, 0.22);
      m.lookAt(m.position.clone().add(vel));
    }
    m.position.copy(pos);
    this.game.scene.add(m);
    this.projectiles.push({ mesh: m, vel, damage, t: 4, source, kind, spin: rand(14, 22) });
  }

  _updateProjectiles(dt) {
    const g = this.game;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.t -= dt;
      // inside a MISSING CLOCK, even the spit slows to a crawl
      const k = g.equipment ? g.equipment.timeScaleAt(pr.mesh.position) : 1;
      pr.mesh.position.add(pr.vel.clone().multiplyScalar(dt * k));
      if (pr.kind === 'card') {
        pr.mesh.rotateZ(pr.spin * dt);
      } else {
        pr.mesh.scale.setScalar(1 + Math.sin(pr.t * 30) * 0.12);
        if (Math.random() < 0.5) g.effects.spawnTrail?.(pr.mesh.position, 0x7aff4a);
      }
      const struck = g.alivePlayers().find((q) => pr.mesh.position.distanceTo(q.pos) < 0.8);
      const hitPlayer = !!struck;
      const oob = g.arena.solidAt(pr.mesh.position) || pr.mesh.position.y < 0.05;
      if (hitPlayer) struck.takeDamage(pr.damage, pr.source);
      if (hitPlayer || oob || pr.t <= 0) {
        if (pr.kind === 'acid') g.effects.spawnSplash?.(pr.mesh.position, 0x7aff4a);
        g.scene.remove(pr.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  // --------------------------- player grenades -------------------------------
  spawnGrenade(pos, vel) {
    const m = chipBombMesh();
    m.position.copy(pos);
    this.game.scene.add(m);
    this.grenades.push({ mesh: m, vel: vel.clone(), fuse: CONFIG.grenade.fuse });
  }

  _updateGrenades(dt) {
    const g = this.game;
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const gr = this.grenades[i];
      gr.fuse -= dt;
      gr.vel.y -= 14 * dt;
      gr.mesh.position.add(gr.vel.clone().multiplyScalar(dt));
      gr.mesh.rotation.x += dt * 8;
      gr.mesh.rotation.z += dt * 5;
      const blink = gr.mesh.userData.light;
      if (blink) blink.visible = Math.sin(gr.fuse * (gr.fuse < 0.5 ? 60 : 25)) > 0;
      if (gr.mesh.position.y < 0.1) {
        gr.mesh.position.y = 0.1;
        gr.vel.y = Math.abs(gr.vel.y) * 0.35;   // bounce
        gr.vel.x *= 0.7; gr.vel.z *= 0.7;
      }
      if (g.arena.collide(gr.mesh.position, 0.15, gr.mesh.position.y)) { gr.vel.x *= -0.45; gr.vel.z *= -0.45; }
      if (gr.fuse <= 0) {
        this.explodeAt(gr.mesh.position.clone(), CONFIG.grenade.radius, CONFIG.grenade.damage, false);
        g.scene.remove(gr.mesh);
        this.grenades.splice(i, 1);
      }
    }
  }

  /** shared explosion: hurts zombies always; hurts the player if hostile */
  /** the bang and the scorch mark, no damage (co-op mirrors the partner's blasts) */
  boomFx(pos, radius, hostile) {
    const g = this.game;
    g.audioAt('explosion', pos);
    g.addShake(0.22 * Math.max(0.2, 1 - g.player.pos.distanceTo(pos) / 30));
    g.effects.spawnExplosion?.(pos.clone().setY(Math.max(0.5, pos.y)), radius, hostile ? 0x9dff4a : 0xffa040);
    g.effects.spawnDecal?.(pos, radius * 0.5, 'scorch');
  }

  explodeAt(pos, radius, damage, hostile, cause = 'explosion') {
    const g = this.game;
    this.boomFx(pos, radius, hostile);
    g.net.sendBoom(pos, radius, hostile);

    const flat = pos.clone().setY(1);
    for (const z of [...this.list]) {
      const d = z.mesh.position.distanceTo(pos);
      if (d < radius && !g.arena.lineBlocked(flat, z.mesh.position, false)) {
        z.takeDamage(damage * (1 - d / radius * 0.6), true, z.mesh.position.clone().setY(1.2), cause);
      }
    }
    for (const b of g.bosses) {
      if (!b.dead && b.mesh.position.distanceTo(pos) < radius + 1) {
        b.takeDamage(damage * 0.8, false, b.mesh.position.clone().setY(2));
      }
    }
    // teammates caught in a hostile blast (they check their own Powder Keg)
    if (hostile && g.net.isHost) for (const r of g.net.aliveRemotes()) if (r.pos.distanceTo(pos) < radius) r.takeDamage(damage * 0.5, null, true);
    // POWDER KEG PUNCH: blasts can't touch you
    if (g.perkFx?.blastProof) return;
    if (hostile && g.player.pos.distanceTo(pos) < radius) {
      g.player.takeDamage(damage * 0.5, null);
    } else if (!hostile && g.player.pos.distanceTo(pos) < radius * 0.6) {
      g.player.takeDamage(15, null); // your own bomb stings a little
    }
  }

  clearAll() {
    for (const z of this.list) { z.dead = true; this.game.scene.remove(z.mesh); z.char.dispose(); }
    for (const pr of this.projectiles) this.game.scene.remove(pr.mesh);
    for (const gr of this.grenades) this.game.scene.remove(gr.mesh);
    for (const c of this.corpses) { this.game.scene.remove(c.mesh); c.char.dispose(); }
    this.list = [];
    this.projectiles = [];
    this.grenades = [];
    this.corpses = [];
    this.spawnQueue = [];
    this.lure = null;
  }
}
