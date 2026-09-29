// player.js — first-person controller: WASD + sprint + jump, mouse look,
// NEW dash (Q) with i-frames, health/armor, damage handling.

import * as THREE from 'three';
import { CONFIG, clamp } from './config.js';
import { Audio } from './audio.js';

const P = CONFIG.player;

export class Player {
  constructor(game) {
    this.game = game;
    this.keys = {};
    this.aiming = false;

    this.pos = new THREE.Vector3(0, P.eyeHeight, 8);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;      // face the room
    this.pitch = 0;
    this.onGround = true;

    this.maxHp = P.hp;
    this.hp = P.hp;
    this.armor = 0;
    this.iFrames = 0;

    this.grenades = CONFIG.grenade.start;   // lethal count (G)
    this.lethalId = 'chipbomb';
    this.tacticalId = 'bellini';            // tactical (T)
    this.tacticals = 2;
    this.dashCd = 0;
    this.dashT = 0;
    this.dashDir = new THREE.Vector3();

    this.bobT = 0;
  }

  reset() {
    this.downed = false; this.bledOut = false; this.downT = 0; this.downLow = 0;
    this.pos.set(0, P.eyeHeight, 8);
    this.vel.set(0, 0, 0);
    this.yaw = Math.PI; this.pitch = 0;
    this.hp = this.maxHp = P.hp;
    this.armor = 0;
    this.iFrames = 0;
    this.grenades = CONFIG.grenade.start;
    this.dashCd = 0; this.dashT = 0;
    this.aiming = false;
    this.hurtKick = { x: 0, y: 0 };
    this.roll = 0;
  }

  onMouseMove(dx, dy) {
    const s = 0.0022 * this.game.settings.sensitivity * (this.aiming ? 0.6 : 1);
    this._lookDX = (this._lookDX || 0) + dx;     // feeds the viewmodel's look sway
    this._lookDY = (this._lookDY || 0) + dy;
    this.yaw -= dx * s;
    this.pitch = clamp(this.pitch - dy * s, -1.45, 1.45);
  }

  /** co-op: on your feet (not bleeding out, not bled out) */
  get alive() { return !this.downed && !this.bledOut; }
  /** the flow field that leads the dead to you */
  get nav() { return this.game.arena.nav; }

  forwardFlat() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(-1);
  }

  rightFlat() {
    const f = this.forwardFlat();
    return new THREE.Vector3(-f.z, 0, f.x);
  }

  tryDash() {
    if (this.dashCd > 0 || this.dashT > 0) return;
    const dir = new THREE.Vector3();
    if (this.keys['KeyW']) dir.add(this.forwardFlat());
    if (this.keys['KeyS']) dir.sub(this.forwardFlat());
    if (this.keys['KeyD']) dir.add(this.rightFlat());
    if (this.keys['KeyA']) dir.sub(this.rightFlat());
    if (dir.lengthSq() < 0.01) dir.copy(this.forwardFlat());
    dir.normalize();
    this.dashDir.copy(dir);
    this.dashT = P.dashTime;
    this.dashCd = this.dashCooldown;
    this.iFrames = Math.max(this.iFrames, P.dashIFrames);
    if (this.game.playerMods.dashDamage) this.game.dashBuffT = 1.5;   // Dash & Cash
    this._dashBoom = !!this.game.perkFx?.dashBlast;                    // Powder Keg Punch
    Audio.play('dash');
  }

  get dashCooldown() { return P.dashCooldown * this.game.playerMods.dashCd * (this.game.perkFx?.dashCd || 1); }

  update(dt) {
    const g = this.game;
    this.iFrames = Math.max(0, this.iFrames - dt);
    // co-op: down on the carpet — you can look around (and shoot), not walk
    const floored = this.downed || this.bledOut;
    if (floored) this.keys = {};
    this.downLow = (this.downLow || 0) + ((floored ? 1.05 : 0) - (this.downLow || 0)) * Math.min(1, dt * 5);
    this.dashCd = Math.max(0, this.dashCd - dt);

    // horizontal intent
    const dir = new THREE.Vector3();
    if (this.keys['KeyW']) dir.add(this.forwardFlat());
    if (this.keys['KeyS']) dir.sub(this.forwardFlat());
    if (this.keys['KeyD']) dir.add(this.rightFlat());
    if (this.keys['KeyA']) dir.sub(this.rightFlat());
    if (dir.lengthSq() > 0) dir.normalize();

    let speed = P.speed;
    if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) speed *= P.sprintMult;
    if (this.aiming) speed *= 0.55;
    speed *= g.casino.roundMods.playerSlowMult || 1;
    speed *= g.playerMods.speed * (g.perkFx?.speed || 1);
    if (g.vice === 'laststand' && this.hp < this.maxHp * 0.3) speed *= 1.15;

    let move;
    if (this.dashT > 0) {
      this.dashT -= dt;
      move = this.dashDir.clone().multiplyScalar(P.dashSpeed * dt);
      // POWDER KEG PUNCH: every dash ends in a bang (you're immune to it)
      if (this.dashT <= 0 && this._dashBoom) {
        this._dashBoom = false;
        g.enemies.explodeAt(this.pos.clone().setY(0.6), 3.4, 75, false);
      }
    } else {
      move = dir.multiplyScalar(speed * dt);
    }
    this.pos.add(move);

    // jump + gravity
    if (this.keys['Space'] && this.onGround) {
      this.vel.y = P.jumpVel;
      this.onGround = false;
    }
    const fallSpeed = -this.vel.y;
    this.vel.y -= P.gravity * dt;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= P.eyeHeight) {
      this.pos.y = P.eyeHeight;
      this.vel.y = 0;
      if (!this.onGround && fallSpeed > 3) {
        this.landDipT = 0.2;                        // camera dips on a landing
        this.landAmt = Math.min(1, fallSpeed / 9);
        Audio.play('land');
        g.weapons.onLand?.(fallSpeed);
      }
      this.onGround = true;
    }
    this.landDipT = Math.max(0, (this.landDipT ?? 0) - dt);

    // collide with arena bounds + cover
    g.arena.collide(this.pos, P.radius);

    // camera: bob (up-down + a little side-to-side), strafe roll, landing dip,
    // and the jolt from being hit
    const bobbing = this.onGround && move.lengthSq() > 1e-6 && this.dashT <= 0;
    const sprinting = speed > P.speed * 1.2;
    if (bobbing) {
      const prev = this.bobT;
      this.bobT += dt * (sprinting ? 11.5 : 8.5);
      // a footstep every half cycle
      if (Math.floor(prev / Math.PI) !== Math.floor(this.bobT / Math.PI)) Audio.play(sprinting ? 'step_heavy' : 'step');
    }
    const amp = sprinting ? 1.5 : 1;
    const bob = bobbing ? Math.sin(this.bobT * 2) * 0.026 * amp : 0;
    const sideBob = bobbing ? Math.sin(this.bobT) * 0.022 * amp : 0;
    const landDip = this.landDipT > 0 ? Math.sin((1 - this.landDipT / 0.2) * Math.PI) * 0.09 * (this.landAmt ?? 1) : 0;
    const strafe = (this.keys['KeyD'] ? 1 : 0) - (this.keys['KeyA'] ? 1 : 0);
    this.roll = (this.roll || 0) + ((-strafe * 0.022 + (bobbing ? Math.sin(this.bobT) * 0.006 * amp : 0)) - (this.roll || 0)) * Math.min(1, dt * 8);
    this.hurtKick = this.hurtKick || { x: 0, y: 0 };
    this.hurtKick.x *= Math.exp(-dt * 9); this.hurtKick.y *= Math.exp(-dt * 9);
    const r = this.rightFlat();
    g.camera.position.set(this.pos.x + r.x * sideBob, this.pos.y + bob - landDip - this.downLow, this.pos.z + r.z * sideBob);
    g.camera.rotation.set(this.pitch + this.hurtKick.x, this.yaw + this.hurtKick.y, this.roll + this.downLow * 0.35, 'YXZ');

    // aim zoom
    const baseFov = g.settings.fov || P.fov;
    const targetFov = this.aiming && g.weapons.current.def.zoomOk ? baseFov - (P.fov - P.aimFov) : baseFov;
    g.camera.fov += (targetFov - g.camera.fov) * Math.min(1, dt * 12);
    g.camera.updateProjectionMatrix();
  }

  heal(amount) {
    this.hp = clamp(this.hp + amount, 0, this.maxHp);
    this.game.ui.updateHUD();
  }

  addArmor(amount) {
    this.armor = clamp(this.armor + amount, 0, 100);
  }

  /** returns true if damage actually landed */
  takeDamage(amount, source = null) {
    const g = this.game;
    if (this.hp <= 0 || this.iFrames > 0 || g.debug.invuln || g.rewards?.untouchable) return false;
    // (co-op keeps playing behind the pause menu — no hiding in there)
    if (g.state !== 'COMBAT' && !(g.net?.active && g.state === 'PAUSED' && g._stateBeforePause === 'COMBAT')) return false;

    if (this.armor > 0 && !g.playerMods.armorDisabled) {   // Glass Cannon voids armor
      const absorbed = Math.min(this.armor, amount * P.armorAbsorb);
      this.armor -= absorbed;
      amount -= absorbed;
    }
    this.hp -= amount;
    if (g.rewards) g.rewards.hitThisRound = true;
    // Loaded Dice: getting hit shakes chips loose
    if (g.playerMods.hitChipLoss > 0 && g.chips > 0) {
      g.chips = Math.max(0, g.chips - g.playerMods.hitChipLoss);
    }
    // UNTOUCHABLE objective fails on any hit
    if (g.objective?.def.key === 'untouchable') g.objective.failed = true;
    this.iFrames = P.hurtIFrames;
    Audio.play('hurt');
    g.addShake(0.08);
    g.ui.hurtFlash(Math.min(1, amount / 30));
    // snap the view away from whoever hit us, and show where it came from
    const from = source?.mesh?.position;
    if (from) {
      const to = from.clone().sub(this.pos).setY(0).normalize();
      const f = this.forwardFlat();
      const ang = Math.atan2(f.x * to.z - f.z * to.x, f.x * to.x + f.z * to.z);   // + = to the right
      this.hurtKick = { x: 0.06, y: -Math.sign(ang || 1) * 0.05 };
      g.ui.damageFrom(ang);
    } else {
      this.hurtKick = { x: 0.08, y: 0 };
    }
    g.post?.hit(Math.min(1, amount / 25) * (g.settings.reducedFlash ? 0.3 : 1));

    // Debt Collector steals chips on hit
    if (source?.def?.stealOnHit && g.chips > 0) {
      const stolen = Math.min(g.chips, source.def.stealOnHit);
      g.chips -= stolen;
      source.stash = (source.stash || 0) + stolen;
      Audio.play('steal');
      g.ui.prompt(`THE DEBT COLLECTOR TOOK ${stolen} CHIPS`);
    }

    if (this.hp <= 0) {
      this.hp = 0;
      // DOUBLE DOWN DAIQUIRI: the house deals you back in
      if (g.perks?.tryRevive()) return true;
      if (g.net?.active) { g.net.goDown(source?.def?.name || 'the horde'); return true; }   // co-op: bleed out, wait for a hand
      g.onPlayerDeath(source?.def?.name || 'the horde');
    }
    return true;
  }
}
