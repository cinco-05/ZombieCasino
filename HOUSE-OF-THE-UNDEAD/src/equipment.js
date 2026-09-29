// equipment.js — lethals on G, tacticals on T (see catalog.js for the names):
//   CHIP BOMB           frag — the old reliable (enemies.js runs its fuse)
//   FLAMING SAMBUCA     shatters into a pool of fire; walkers-through burn
//   THE VELVET ROPE     a brass stanchion mine; goes off when they cross it
//   FALSE JACKPOT       rings a fake jackpot: the horde comes running, then it blows
//   BUTTERFINGERS BELLINI  a slick of spilled drinks — they slip and go down flat
//   THE MISSING CLOCK   a dome of slow time; the dead (and their spit) crawl
//   PAPARAZZI FLASH     a camera flash that blinds everything looking at it
//   EYE IN THE SKY      the casino's dome camera on a tripod, with a gun
// Everything is thrown by the left hand (weapons.throwItem), flies, bounces,
// lands, and then lives here until it's spent.

import * as THREE from 'three';
import { CONFIG, rand } from './config.js';
import { Audio } from './audio.js';
import { LETHALS, TACTICALS } from './catalog.js';
import { gearMesh, sentryMesh } from './gfx/gear.js';
import { makeCanvas, toTexture, softBlobCanvas } from './gfx/texkit.js';

const EQ = CONFIG.equipment;
const SHATTER = new Set(['sambuca', 'bellini']);
const THROW_SPEED = { sambuca: 16, bellini: 15, rope: 10, jackpot: 13, clock: 14, flash: 15, eye: 9 };

let _blob = null;
const blobTex = () => _blob ||= toTexture(softBlobCanvas(128, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)'), { srgb: false });

let _dial = null;
function dialTex() {
  if (_dial) return _dial;
  const S = 512, cv = makeCanvas(S), c = cv.getContext('2d');
  c.translate(S / 2, S / 2);
  c.strokeStyle = 'rgba(160,220,255,0.9)'; c.lineWidth = 6;
  c.beginPath(); c.arc(0, 0, S * 0.46, 0, Math.PI * 2); c.stroke();
  c.lineWidth = 2; c.beginPath(); c.arc(0, 0, S * 0.36, 0, Math.PI * 2); c.stroke();
  c.fillStyle = 'rgba(190,235,255,0.95)'; c.font = `bold ${S * 0.07}px Georgia, serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
  const R = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  R.forEach((t, i) => { const a = (i / 12) * Math.PI * 2 - Math.PI / 2; c.fillText(t, Math.cos(a) * S * 0.41, Math.sin(a) * S * 0.41); });
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    c.beginPath(); c.moveTo(Math.cos(a) * S * 0.44, Math.sin(a) * S * 0.44); c.lineTo(Math.cos(a) * S * (i % 5 ? 0.43 : 0.4), Math.sin(a) * S * (i % 5 ? 0.43 : 0.4)); c.stroke();
  }
  _dial = toTexture(cv, { srgb: false });
  return _dial;
}

export class Equipment {
  constructor(game) {
    this.game = game;
    this.flying = [];
    this.active = [];
    this._v = new THREE.Vector3();
  }

  // --------------------------------- throwing ---------------------------------
  throwLethal() {
    const g = this.game, p = g.player, key = p.lethalId;
    if (g.state !== 'COMBAT') return;
    if (p.grenades <= 0) { Audio.play('dryfire'); g.ui.prompt(`Out of ${LETHALS[key].name}s — the shop restocks them`); return; }
    const ok = g.weapons.throwItem(gearMesh(key), (live) => {
      if (!live) { p.grenades++; g.ui.updateHUD(); return; }
      this._launch(key);
    });
    if (ok) { p.grenades--; g.ui.updateHUD(); }
  }

  useTactical() {
    const g = this.game, p = g.player, key = p.tacticalId;
    if (g.state !== 'COMBAT' || !key) return;
    if (p.tacticals <= 0) { Audio.play('dryfire'); g.ui.prompt(`Out of ${TACTICALS[key].name} — the shop restocks them`); return; }
    if (key === 'eye' && this.active.some((a) => a.key === 'eye')) { g.ui.prompt('The Eye in the Sky is already watching'); return; }
    const ok = g.weapons.throwItem(gearMesh(key), (live) => {
      if (!live) { p.tacticals++; g.ui.updateHUD(); return; }
      this._launch(key);
    });
    if (ok) { p.tacticals--; g.ui.updateHUD(); }
  }

  _launch(key) {
    const g = this.game;
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(g.camera.rotation);
    dir.y += 0.22; dir.normalize();
    const pos = g.camera.position.clone().add(dir.clone().multiplyScalar(0.7));
    if (key === 'chipbomb') { g.enemies.spawnGrenade(pos, dir.multiplyScalar(CONFIG.grenade.throwSpeed)); return; }
    const mesh = gearMesh(key);
    mesh.scale.setScalar(1.5);
    mesh.position.copy(pos);
    g.scene.add(mesh);
    this.flying.push({ key, mesh, pos, vel: dir.multiplyScalar(THROW_SPEED[key] || 14), spin: new THREE.Vector3(rand(-9, 9), rand(-6, 6), rand(-9, 9)), t: 0, bounces: 0 });
  }

  // ---------------------------------- update ----------------------------------
  update(dt) {
    const g = this.game;
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.t += dt;
      f.vel.y -= 14 * dt;
      const step = f.vel.clone().multiplyScalar(dt);
      const len = step.length();
      const dir = step.clone().divideScalar(len || 1);
      let arrive = null;
      if (SHATTER.has(f.key)) {
        // glass breaks on the first thing it touches
        const wall = g.arena.rayHit(f.pos, dir, len);
        if (wall) arrive = wall.point.setY(0);
        else if (f.pos.y + step.y < 0.06) arrive = f.pos.clone().add(step).setY(0);
        else {
          for (const z of g.enemies.list) {
            if (z.dead) continue;
            const c = z.mesh.position;
            if (Math.hypot(c.x - f.pos.x, c.z - f.pos.z) < 0.7 && f.pos.y < 2) { arrive = c.clone().setY(0); break; }
          }
        }
        f.mesh.rotation.x += f.spin.x * dt; f.mesh.rotation.z += f.spin.z * dt;
      } else {
        // everything else bounces and settles, then deploys
        if (f.pos.y + step.y < 0.04) {
          step.y = 0.04 - f.pos.y;
          f.vel.y = Math.abs(f.vel.y) * 0.28;
          f.vel.x *= 0.5; f.vel.z *= 0.5;
          f.spin.multiplyScalar(0.4);
          if (f.bounces++ < 2) g.audioAt('casing', f.pos);
        }
        f.mesh.rotation.x += f.spin.x * dt; f.mesh.rotation.y += f.spin.y * dt; f.mesh.rotation.z += f.spin.z * dt;
        const settled = f.pos.y < 0.08 && Math.hypot(f.vel.x, f.vel.z) < 0.9 && Math.abs(f.vel.y) < 1.2;
        if (settled || f.t > 3) arrive = f.pos.clone().setY(0);
        if (f.key === 'flash' && f.t > 1.05) arrive = f.pos.clone();          // pops in the air if it has to
      }
      if (arrive) {
        g.scene.remove(f.mesh);
        this.flying.splice(i, 1);
        this._arrive(f.key, arrive);
        continue;
      }
      f.pos.add(step);
      if (g.arena.collide(f.pos, 0.1, f.pos.y)) { f.vel.x *= -0.4; f.vel.z *= -0.4; }
      f.mesh.position.copy(f.pos);
    }
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      a.t += dt;
      if (a.update(dt) === false) {
        a.dispose?.();
        this.active.splice(i, 1);
      }
    }
  }

  /** is this point inside a MISSING CLOCK? (enemy spit slows down in there too) */
  timeScaleAt(p) {
    for (const a of this.active) {
      if (a.key === 'clock' && Math.hypot(p.x - a.pos.x, p.z - a.pos.z) < a.r && p.y < a.r) return EQ.clock.slow;
    }
    return 1;
  }

  _targets() {
    const g = this.game;
    return [...g.enemies.list.filter((z) => !z.dead), ...g.bosses.filter((b) => !b.dead)];
  }

  _disc(pos, r, mat, y = 0.02) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 40), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, y, pos.z);
    m.renderOrder = 1;
    this.game.scene.add(m);
    return m;
  }

  // ---------------------------------- landing ----------------------------------
  _arrive(key, pos) {
    const g = this.game;
    const add = (a) => { a.key = key; a.t = 0; a.pos = pos; this.active.push(a); return a; };

    if (key === 'sambuca') {
      const E = EQ.sambuca;
      g.audioAt('glass_smash', pos);
      g.audioAt('fire_whoosh', pos);
      g.effects.spawnDecal(pos, E.radius * 0.8, 'scorch');
      const glow = this._disc(pos, E.radius, new THREE.MeshBasicMaterial({ map: blobTex(), color: 0xff7a2a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }), 0.03);
      let tick = 0;
      const self = add({
        r: E.radius,
        update: (dt) => {
          const life = E.time - self.t;
          const k = Math.min(1, life / 1.2);
          glow.material.opacity = (0.4 + Math.random() * 0.2) * k;
          for (let n = 0; n < 4; n++) {
            const ang = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * E.radius * 0.9;
            g.effects.spawnFire(new THREE.Vector3(pos.x + Math.cos(ang) * rr, 0.1, pos.z + Math.sin(ang) * rr), 1.1 * k + 0.2);
          }
          tick -= dt;
          if (tick <= 0) {
            tick = 0.25;
            for (const e of this._targets()) {
              if (Math.hypot(e.mesh.position.x - pos.x, e.mesh.position.z - pos.z) < E.radius) {
                e.takeDamage(E.dps * 0.25, false, null, 'fire');
                e.ignite?.(E.burnDps, E.burnTime);
              }
            }
            const pp = g.player.pos;
            if (Math.hypot(pp.x - pos.x, pp.z - pos.z) < E.radius * 0.8 && !g.perkFx?.blastProof) g.player.takeDamage(3, null);
          }
          return life > 0;
        },
        dispose: () => { g.scene.remove(glow); glow.material.dispose(); },
      });
      return;
    }

    if (key === 'bellini') {
      const E = EQ.bellini;
      g.audioAt('glass_smash', pos);
      g.audioAt('splash', pos);
      g.effects.spawnSplash(pos.clone().setY(0.3), 0xffb080);
      const mat = new THREE.MeshStandardMaterial({ color: 0xffa070, roughness: 0.04, metalness: 0.3, transparent: true, opacity: 0.72, emissive: 0x4a1a0a, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const pool = this._disc(pos, E.radius, mat, 0.015);
      // irregular edge: squash it a little
      pool.scale.set(1, 0.8 + Math.random() * 0.3, 1);
      pool.rotation.z = Math.random() * Math.PI;
      const shards = new THREE.Group();
      for (let i = 0; i < 10; i++) {
        const s = new THREE.Mesh(new THREE.TetrahedronGeometry(0.04 + Math.random() * 0.04), gearGlass());
        s.position.set((Math.random() - 0.5) * E.radius, 0.02, (Math.random() - 0.5) * E.radius);
        s.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        shards.add(s);
      }
      shards.position.set(pos.x, 0, pos.z);
      g.scene.add(shards);
      const self = add({
        r: E.radius,
        update: () => {
          const life = E.time - self.t;
          mat.opacity = 0.72 * Math.min(1, life / 1.5);
          for (const e of this._targets()) {
            const d = Math.hypot(e.mesh.position.x - pos.x, e.mesh.position.z - pos.z);
            if (d < E.radius * 0.95) {
              e.slow?.(E.slow, 0.3);
              if (e.slip?.(E.slip)) g.effects.spawnSplash(e.mesh.position.clone().setY(0.2), 0xffb080);
            }
          }
          return life > 0;
        },
        dispose: () => { g.scene.remove(pool); g.scene.remove(shards); mat.dispose(); },
      });
      return;
    }

    if (key === 'rope') {
      const E = EQ.rope;
      const mines = this.active.filter((a) => a.key === 'rope');
      if (mines.length >= 3) mines[0].t = 1e9;                  // oldest one retires
      const mesh = gearMesh('rope');
      mesh.scale.setScalar(2.4);
      mesh.position.set(pos.x, 0, pos.z);
      mesh.rotation.y = Math.random() * Math.PI;
      g.scene.add(mesh);
      g.audioAt('rope_plant', pos);
      let armed = false, fuse = -1;
      const self = add({
        update: (dt) => {
          const t = self.t;
          if (t > 1e8) return false;
          if (!armed && t > E.arm) { armed = true; g.audioAt('beep', pos); }
          mesh.userData.light.visible = armed ? Math.sin(t * (fuse >= 0 ? 40 : 4)) > 0 : false;
          if (armed && fuse < 0) {
            for (const e of this._targets()) {
              if (Math.hypot(e.mesh.position.x - pos.x, e.mesh.position.z - pos.z) < E.trigger) { fuse = 0.28; g.audioAt('beep', pos); break; }
            }
          }
          if (fuse >= 0) {
            fuse -= dt;
            if (fuse <= 0) {
              g.enemies.explodeAt(pos.clone().setY(0.4), E.radius, E.damage, false);
              return false;
            }
          }
          return t < E.life;
        },
        dispose: () => g.scene.remove(mesh),
      });
      return;
    }

    if (key === 'jackpot') {
      const E = EQ.jackpot;
      const mesh = gearMesh('jackpot');
      mesh.scale.setScalar(2.6);
      mesh.position.set(pos.x, 0, pos.z);
      mesh.rotation.y = Math.atan2(g.player.pos.x - pos.x, g.player.pos.z - pos.z);
      g.scene.add(mesh);
      g.enemies.lure = { pos: new THREE.Vector3(pos.x, 0, pos.z), radius: E.pull, t: E.lure };
      if (g.net.isGuest) g.net.send({ t: 'lure', x: pos.x, z: pos.z, r: E.pull, time: E.lure });   // the host's horde hears it
      g.enemies.navT = 0;
      g.ui.prompt('FALSE JACKPOT — every zombie in earshot wants a piece', 2200);
      let jingle = 0;
      const self = add({
        update: (dt) => {
          const t = self.t;
          jingle -= dt;
          if (jingle <= 0) { jingle = 0.9; g.audioAt('jackpot', pos); g.effects.spawnBurst(pos.clone().setY(0.8), 0xffd060, 6, 4); }
          mesh.userData.lights.forEach((b, k) => { b.visible = Math.sin(t * 16 + k * 1.3) > 0; });
          mesh.rotation.y += dt * 0.6;
          if (t >= E.lure) {
            g.enemies.explodeAt(pos.clone().setY(0.5), E.radius, E.damage, false);
            g.effects.spawnBurst(pos.clone().setY(1), 0xffd060, 20, 10);
            return false;
          }
          return true;
        },
        dispose: () => g.scene.remove(mesh),
      });
      return;
    }

    if (key === 'clock') {
      const E = EQ.clock;
      g.audioAt('clock_stop', pos);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(E.radius, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.ShaderMaterial({
        uniforms: { uT: { value: 0 }, uK: { value: 0 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        vertexShader: /* glsl */`varying vec3 vN; varying vec3 vV; varying float vY;
          void main() { vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); vY = position.y; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: /* glsl */`uniform float uT; uniform float uK; varying vec3 vN; varying vec3 vV; varying float vY;
          void main() {
            float rim = pow(1.0 - clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.5);
            float bands = 0.5 + 0.5 * sin(vY * 6.0 - uT * 2.0);
            gl_FragColor = vec4(vec3(0.45, 0.8, 1.0), uK * (0.05 + rim * 0.5 + bands * 0.04));
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }));
      dome.position.set(pos.x, 0, pos.z);
      dome.renderOrder = 3;
      g.scene.add(dome);
      const ring = this._disc(pos, E.radius, new THREE.MeshBasicMaterial({ map: dialTex(), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, color: 0x8ad8ff }), 0.04);
      const watch = gearMesh('clock');
      watch.scale.setScalar(2.2);
      watch.position.set(pos.x, 0, pos.z);
      g.scene.add(watch);
      let tick = 0;
      const self = add({
        r: E.radius,
        update: (dt) => {
          const t = self.t, life = E.time - t;
          const k = Math.min(1, t / 0.4) * Math.min(1, life / 0.6);
          dome.material.uniforms.uT.value = t;
          dome.material.uniforms.uK.value = k;
          dome.scale.setScalar(0.3 + 0.7 * Math.min(1, t / 0.35));
          ring.material.opacity = 0.8 * k;
          ring.rotation.z -= dt * 0.25;
          tick -= dt;
          if (tick <= 0) { tick = 0.5; g.audioAt('tick', pos); }
          for (const e of this._targets()) {
            if (Math.hypot(e.mesh.position.x - pos.x, e.mesh.position.z - pos.z) < E.radius) e.slow?.(E.slow, 0.25);
          }
          return life > 0;
        },
        dispose: () => { g.scene.remove(dome); g.scene.remove(ring); g.scene.remove(watch); dome.material.dispose(); },
      });
      return;
    }

    if (key === 'flash') {
      const E = EQ.flash;
      g.audioAt('camera_flash', pos);
      g.effects.spawnFlashPop(pos.clone().setY(Math.max(0.4, pos.y)));
      const p1 = pos.clone().setY(1.2);
      for (const e of this._targets()) {
        const d = e.mesh.position.distanceTo(pos);
        if (d < E.radius && !g.arena.lineBlocked(p1, e.mesh.position, false)) e.stun?.(E.stun * (1 - d / E.radius * 0.4));
      }
      // you catch some of it too if you're looking
      const to = pos.clone().sub(g.camera.position);
      const d = to.length();
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(g.camera.quaternion);
      const look = to.normalize().dot(fwd);
      if (d < 16 && look > 0.3 && !g.arena.lineBlocked(g.camera.position, pos, false)) g.ui.whiteout((look - 0.3) / 0.7 * (1 - d / 16));
      return;
    }

    if (key === 'eye') {
      const E = EQ.eye;
      const mesh = sentryMesh();
      mesh.position.set(pos.x, 0, pos.z);
      mesh.rotation.y = g.player.yaw + Math.PI;
      g.scene.add(mesh);
      g.audioAt('turret_deploy', pos);
      const ud = mesh.userData;
      let target = null, scan = 0, cd = 0.6, spin = 0;
      const flash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.2, 1.2), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      flash.position.copy(ud.muzzle);
      flash.visible = false;
      ud.head.add(flash);
      const tracer = new THREE.LineBasicMaterial({ color: new THREE.Color(3, 0.6, 0.8), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
      const self = add({
        update: (dt) => {
          const t = self.t;
          // unfold: legs spread, head rises
          const u = Math.min(1, t / 0.6);
          ud.legs.scale.set(1, 0.3 + 0.7 * u, 1);
          ud.head.position.y = 0.3 + 0.65 * u;
          ud.lens.material.emissiveIntensity = 2 + Math.sin(t * 6) * 1;
          if (t < 0.6) return true;
          scan -= dt;
          if (scan <= 0) {
            scan = 0.3;
            target = null;
            let bd = E.range;
            const eye = new THREE.Vector3(pos.x, 1.0, pos.z);
            for (const e of this._targets()) {
              const d = e.mesh.position.distanceTo(eye);
              if (d < bd && !g.arena.lineBlocked(eye, e.mesh.position, false)) { bd = d; target = e; }
            }
          }
          if (target && !target.dead) {
            const want = Math.atan2(target.mesh.position.x - pos.x, target.mesh.position.z - pos.z) + Math.PI;
            let dy = want - mesh.rotation.y - ud.head.rotation.y;
            dy = Math.atan2(Math.sin(dy), Math.cos(dy));
            ud.head.rotation.y += dy * Math.min(1, dt * 10);
            cd -= dt;
            if (cd <= 0 && Math.abs(dy) < 0.25) {
              cd = 1 / E.rate;
              const from = ud.head.localToWorld(ud.muzzle.clone());
              const hitAt = target.mesh.position.clone().setY(1.2 * (target.mesh.scale.y || 1));
              target.takeDamage(E.damage, false, hitAt, 'hit');
              g.effects.spawnBurst(hitAt, 0x8f1f2f, 3, 3);
              g.audioAt('turret', from);
              flash.visible = true;
              setTimeout(() => { flash.visible = false; }, 40);
              const geo = new THREE.BufferGeometry().setFromPoints([from, hitAt]);
              const line = new THREE.Line(geo, tracer);
              g.scene.add(line);
              setTimeout(() => { g.scene.remove(line); geo.dispose(); }, 50);
            }
          } else {
            spin += dt;
            ud.head.rotation.y = Math.sin(spin * 0.8) * 1.2;                // sweeping
          }
          if (t > E.life) {
            g.effects.spawnBurst(new THREE.Vector3(pos.x, 1, pos.z), 0xffc070, 10, 5);
            g.audioAt('powerdown', pos);
            return false;
          }
          return true;
        },
        dispose: () => { g.scene.remove(mesh); tracer.dispose(); },
      });
    }
  }

  clear() {
    for (const f of this.flying) this.game.scene.remove(f.mesh);
    for (const a of this.active) a.dispose?.();
    this.flying = [];
    this.active = [];
  }
}

let _shardMat = null;
function gearGlass() {
  return _shardMat ||= new THREE.MeshStandardMaterial({ color: 0xeef4ff, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.6 });
}
