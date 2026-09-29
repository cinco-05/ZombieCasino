// bosses.js — THE PIT BOSS (round 5 miniboss: charger with a slam) and
// THE HOUSE DEALER (round 10 final boss: teleports, deals razor-card fans,
// opens a glowing vulnerability window after each volley, phases at 66/33%).
// Both are full skinned characters (chars/) scaled up to boss size.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Audio } from './audio.js';
import { ARENA_HALF } from './arena.js';
import { Character } from './chars/character.js';
import { cardMesh } from './chars/props.js';
import { steer } from './enemies.js';

class BossBase {
  constructor(game, name, hp) {
    this.game = game;
    this.name = name;
    this.maxHp = this.hp = hp;
    this.dead = false;
    this.parts = [];
    this.hitFlash = 0;
    this.def = { name, scale: 2 };
    this._prev = new THREE.Vector3();
    this.animSpeed = 0;
    this.nav = {};
  }

  // tacticals barely register on management
  slow() {} stun() {} slip() { return false; } ignite() {}

  _makeChar(kind, scale) {
    this.kind = kind;
    this.char = new Character(kind, { hitRef: this });
    this.nid = 'b' + (this.game.net.nextId++);
    if (this.game.net.isHost) this.game.net.hookChar(this);
    this.mesh = this.char.root;
    this.mesh.scale.setScalar(scale);
    this.parts = this.char.hitboxes;
    this.game.scene.add(this.mesh);
  }

  takeDamage(dmg, strong, point) {
    if (this.dead) return;
    this.lastHitBy = this._byGuest ? 'guest' : 'host';
    if (this.vulnT > 0) dmg *= 2;           // dealer's open window
    this.hp -= dmg;
    this.hitFlash = 0.08;
    this.char.flinch(0.25);
    if (point) this.game.ui.floatText(point, Math.round(dmg), strong ? 'dmg crit' : 'dmg');
    this.game.ui.updateHUD();
    if (this.hp <= 0) this._die();
  }

  knockback() { /* bosses don't budge */ }

  /** animate from real movement; returns true once a death has played out */
  _animate(dt) {
    const moved = this._prev.distanceTo(this.mesh.position) / Math.max(dt, 1e-4);
    this.animSpeed += (Math.min(moved, 16) - this.animSpeed) * Math.min(1, dt * 8);
    this._prev.copy(this.mesh.position);
    return this.char.update(dt, this.animSpeed / this.mesh.scale.y);
  }

  _face(toPlayer, dt, rate = 5) {
    const want = Math.atan2(toPlayer.x, toPlayer.z);
    let d = want - this.mesh.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.mesh.rotation.y += d * Math.min(1, dt * rate);
  }

  /** after death the body keeps falling; remove it when done */
  _updateCorpse(dt) {
    if (this._gone) return;
    if (this.char.update(dt)) {
      this._gone = true;
      this.game.scene.remove(this.mesh);
      this.char.dispose();
    }
  }
}

// ============================== THE PIT BOSS =================================
export class PitBoss extends BossBase {
  constructor(game) {
    super(game, 'THE PIT BOSS',
      1400 * (1 + 0.1 * (game.round - CONFIG.minibossRound))
           * (1 + 0.10 * Math.min(5, game.grudge?.pitboss || 0)));   // grudge: +10%/death, cap 5
    this.kind = 'pitboss';
    if ((game.grudge?.pitboss || 0) > 0) {
      setTimeout(() => game.ui.prompt('"YOU AGAIN. STILL IN DEBT."', 2600), 2400);
    }
    this.state = 'chase';
    this.stateT = 0;
    this.chargeDir = new THREE.Vector3();
    this.summonT = 8;
    this.vulnT = 0;
    this._makeChar('pitboss', 1.7);
    this.mesh.position.set(0, 0, -ARENA_HALF + 4);
    this._prev.copy(this.mesh.position);
    this.char.rise(1.2);
    game.effects.spawnDust(this.mesh.position, 2.2);
    game.ui.banner('THE PIT BOSS HAS ENTERED THE FLOOR', 'red', 2600);
    Audio.play('boss_phase');
  }

  update(dt) {
    if (this.dead) { this._updateCorpse(dt); return; }
    const g = this.game;
    this.hitFlash = Math.max(0, this.hitFlash - dt);

    const P = g.targetFor(this);
    const toPlayer = P.pos.clone().sub(this.mesh.position); toPlayer.y = 0;
    const dist = toPlayer.length();
    toPlayer.normalize();
    if (this.state !== 'charge') this._face(toPlayer, dt, this.state === 'chase' ? 4 : 8);
    this.stateT -= dt;

    // wind-up telegraphs glow hot; hits flash white
    const rf = g.settings.reducedFlash;
    if (this.hitFlash > 0) this.char.setFlash(0.8, 0xffffff);
    else if (this.state === 'slamWind') this.char.setFlash(0.35 + (rf ? 0 : 0.25 * Math.sin(performance.now() / 50)), 0xff3a2a);
    else if (this.state === 'chargeWind') this.char.setFlash(0.35 + (rf ? 0 : 0.25 * Math.sin(performance.now() / 50)), 0xffa02a);
    else this.char.setFlash(0);

    // periodic summons
    this.summonT -= dt;
    if (this.summonT <= 0) {
      this.summonT = 11;
      g.enemies.spawnQueue.push({ kind: 'walker' }, { kind: 'sprinter' });
      g.ui.prompt('THE PIT BOSS CALLS FOR BACKUP');
    }

    switch (this.state) {
      case 'chase': {
        this.char.gait = 'lurch';
        const dir = steer(g, this.nav, this.mesh.position, P.pos, dt, P.nav);
        this.mesh.position.addScaledVector(dir, 2.2 * dt);
        if (dist < 3 && this.stateT <= 0) {
          this.state = 'slamWind'; this.stateT = 0.7;
          this.char.attack('swipe', 0.95);
          g.audioAt('warn', this.mesh.position);
        } else if (dist > 8 && this.stateT <= 0 && this.nav.los) {
          this.state = 'chargeWind'; this.stateT = 0.8; this.chargeDir.copy(toPlayer);
          g.audioAt('warn', this.mesh.position);
        }
        break;
      }
      case 'chargeWind':
        this.char.hunch = 0.5;                          // head down, like a bull
        if (this.stateT <= 0) { this.state = 'charge'; this.stateT = 1.0; this.char.gait = 'run'; }
        break;
      case 'charge':
        this.mesh.rotation.y = Math.atan2(this.chargeDir.x, this.chargeDir.z);
        this.mesh.position.add(this.chargeDir.clone().multiplyScalar(14 * dt));
        if (Math.random() < 0.5) g.effects.spawnDust(this.mesh.position, 0.6);
        const run = g.alivePlayers().filter((q) => q.pos.distanceTo(this.mesh.position) < 2.4);
        if (run.length) {
          for (const q of run) q.takeDamage(28, this);
          g.addShake(0.2);
          this.stateT = 0;
        }
        // runs until time's up or he slams into something solid
        if (this.stateT <= 0 || g.arena.collide(this.mesh.position, 1.4)) {
          if (this.stateT > 0) { g.addShake(0.15); g.audioAt('step_heavy', this.mesh.position); }
          this.state = 'chase'; this.stateT = 1.5;
          this.char.gait = 'lurch'; this.char.hunch = 0.12;
        }
        break;
      case 'slamWind':
        if (this.stateT <= 0) {
          this.state = 'chase'; this.stateT = 1.2;
          g.audioAt('explosion', this.mesh.position);
          g.addShake(0.28);
          const front = this.mesh.position.clone().add(toPlayer.clone().multiplyScalar(1.4)).setY(0.3);
          g.effects.spawnDust(front, 2);
          g.effects.spawnBurst(front, 0xffa040, 8, 6);
          g.effects.spawnDecal(front, 1.8, 'scorch');
          for (const q of g.alivePlayers()) {
            if (q.pos.distanceTo(this.mesh.position) < 5 && q.onGround) q.takeDamage(24, this);
          }
        }
        break;
    }
    g.arena.collide(this.mesh.position, 1.4);
    this._animate(dt);
  }

  _die() {
    this.dead = true;
    const g = this.game;
    this.char.die('back');
    g.effects.spawnBlood(this.mesh.position.clone().setY(2.6), 30, 6);
    g.effects.spawnDecal(this.mesh.position, 2.6);
    g.onBossDefeated(this.kind);
  }
}

// ============================ THE HOUSE DEALER ===============================
export class HouseDealer extends BossBase {
  constructor(game) {
    super(game, 'THE HOUSE DEALER',
      3200 * (1 + 0.12 * Math.max(0, game.round - CONFIG.finalRound))   // endless scaling
           * (1 + 0.10 * Math.min(5, game.grudge?.housedealer || 0)));  // grudge
    this.kind = 'housedealer';
    if ((game.grudge?.housedealer || 0) > 0) {
      setTimeout(() => game.ui.prompt('"BACK FOR ANOTHER HAND? HOW PREDICTABLE."', 2600), 2400);
    }
    this.phase = 1;
    this.teleT = 4;
    this.volleyT = 2.5;
    this.vulnT = 0;
    this.orbitT = 0;
    this._makeChar('housedealer', 1.6);

    // floating halo of oversized playing cards
    this.halo = new THREE.Group();
    const faces = [['A', '♠'], ['K', '♥'], ['Q', '♦'], ['J', '♣'], ['A', '♥'], ['K', '♠'], ['Q', '♣'], ['J', '♦']];
    faces.forEach(([r, s], i) => {
      const card = cardMesh(r, s, 0.3, 0.42);
      const a = (i / faces.length) * Math.PI * 2;
      card.position.set(Math.cos(a) * 1.05, 0, Math.sin(a) * 1.05);
      card.rotation.y = -a + Math.PI / 2;
      this.halo.add(card);
    });
    this.halo.position.y = 2.2;
    this.mesh.add(this.halo);

    this.mesh.position.set(0, 0, -10);
    this._prev.copy(this.mesh.position);
    this.char.rise(1.4);
    game.effects.spawnPoof(this.mesh.position.clone().setY(1.5), 0xffd24a);
    game.arena.setRedAlert(true);
    game.ui.banner('THE HOUSE DEALER: "FINAL HAND."', 'red', 3000);
    Audio.play('boss_phase');
    Audio.setBossMode(true);
  }

  _teleport() {
    const g = this.game;
    g.audioAt('card', this.mesh.position);
    g.effects.spawnPoof(this.mesh.position.clone().setY(2), 0xff2d55);
    // reappear somewhere open, a card's throw from the player — whichever room they're hiding in
    this.mesh.position.copy(g.arena.spawnPoint(g.targetFor(this).pos, null, 9, 22));
    this._prev.copy(this.mesh.position);
    g.effects.spawnPoof(this.mesh.position.clone().setY(2), 0xff2d55);
  }

  _volley() {
    const g = this.game;
    g.audioAt('warn', this.mesh.position);
    this.char.attack('throw', 0.6);
    const n = this.phase === 3 ? 14 : this.phase === 2 ? 10 : 7;
    const spread = 0.5;
    setTimeout(() => {
      if (this.dead) return;
      const base = g.targetFor(this).pos.clone().sub(this.mesh.position).setY(0).normalize();
      for (let i = 0; i < n; i++) {
        const a = (i - (n - 1) / 2) * (spread / n * 2.2);
        const dir = base.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
        dir.y = 0.02;
        g.enemies.spawnProjectile(
          this.mesh.position.clone().add(new THREE.Vector3(0, 2.6, 0)),
          dir.multiplyScalar(this.phase === 3 ? 13 : 10), 14, 0xffffff, this);
      }
      // after dealing, the dealer's face lights up — 2x damage window
      this.vulnT = 2.2;
      this.game.ui.prompt('THE DEALER IS OPEN — HIT THE HEAD!', 1800);
    }, 280);
  }

  update(dt) {
    if (this.dead) {
      this.halo.children.forEach((c, i) => { c.position.y -= dt * (2 + i * 0.3); c.rotation.x += dt * 4; });
      this._updateCorpse(dt);
      return;
    }
    const g = this.game;
    this.orbitT += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.halo.rotation.y += dt * (this.phase * 0.8);
    this.halo.position.y = 2.2 + Math.sin(this.orbitT * 1.5) * 0.12;
    this.halo.children.forEach((c, i) => { c.position.y = Math.sin(this.orbitT * 2 + i) * 0.15; });
    this.char.setFlash(this.hitFlash > 0 ? 0.7 : 0, 0xffffff);

    // phase transitions at 66% / 33%
    const frac = this.hp / this.maxHp;
    if (this.phase === 1 && frac < 0.66) this._phaseUp(2);
    if (this.phase === 2 && frac < 0.33) this._phaseUp(3);

    const P = g.targetFor(this);
    const toPlayer = P.pos.clone().sub(this.mesh.position); toPlayer.y = 0;
    this._face(toPlayer.clone().normalize(), dt, 6);

    // drift slowly, teleport on a timer (sooner if you've broken line of sight)
    const dir = steer(g, this.nav, this.mesh.position, P.pos, dt, P.nav);
    this.mesh.position.addScaledVector(dir, 1.2 * dt);
    if (!this.nav.los) this.teleT -= dt * 1.5;
    this.teleT -= dt;
    if (this.teleT <= 0) {
      this.teleT = this.phase === 3 ? 4.5 : 6.5;
      this._teleport();
    }

    this.volleyT -= dt;
    if (this.volleyT <= 0) {
      this.volleyT = this.phase === 3 ? 2.2 : this.phase === 2 ? 3.0 : 3.8;
      this._volley();
    }

    if (this.vulnT > 0) {
      this.vulnT -= dt;
      this.char.setGlow(g.settings.reducedFlash ? 5 : 5 + 3 * Math.sin(this.orbitT * 10));
    } else {
      this.char.setGlow(0);
    }
    g.arena.collide(this.mesh.position, 1.2);
    this._animate(dt);
  }

  _phaseUp(n) {
    this.phase = n;
    const g = this.game;
    Audio.play('boss_phase');
    g.effects.spawnPoof(this.mesh.position.clone().setY(2.2), 0xff2d55);
    g.ui.banner(n === 2 ? 'THE DEALER RESHUFFLES — PHASE 2' : 'FINAL PHASE — ALL BETS ARE OFF', 'red', 2400);
    g.enemies.spawnQueue.push({ kind: 'sprinter' }, { kind: 'sprinter' },
      n === 3 ? { kind: 'gasbag' } : { kind: 'walker' });
  }

  _die() {
    this.dead = true;
    const g = this.game;
    this.char.setGlow(0);
    this.char.die('back', false);
    g.effects.spawnPoof(this.mesh.position.clone().setY(2.4), 0xffd24a);
    g.effects.spawnDecal(this.mesh.position, 2.4);
    g.arena.setRedAlert(false);
    Audio.setBossMode(false);
    g.onBossDefeated(this.kind);
  }
}
