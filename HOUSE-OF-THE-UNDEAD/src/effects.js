// effects.js — all the juice. GPU point-sprite particles (two batches: normal
// blend for blood/smoke/dust, additive for fire/sparks/glows — one draw call
// each), floor decals (blood pools, scorch marks, bullet scuffs), explosion
// fireballs with a shockwave ring + light flash, and ejected brass casings.

import * as THREE from 'three';
import { rand } from './config.js';
import { makeCanvas, toTexture, noiseCanvas } from './gfx/texkit.js';
import { STYLE } from './gfx/style.js';
import { toonAtlas, toonTexture, TOON } from './gfx/toonart.js';

const TOONFX = STYLE.cartoon;          // 1930s: stars, puffy clouds and ink instead of sparks, smoke and blood

const MAX_P = 900;
const MAX_SHELLS = 30;
const MAX_DECALS = 46;
const CELL = { blob: 0, smoke: 1, spark: 2, drop: 3 };

// ---------------------------- particle atlas ---------------------------------
function particleAtlas() {
  const S = 256, H = 128;
  const cv = makeCanvas(S), c = cv.getContext('2d');
  const n = noiseCanvas(128, 4, 4, 77, 1.6);
  // 0: soft blob
  let g = c.createRadialGradient(64, 64, 0, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, H, H);
  // 1: smoke puff — noise masked by a soft circle
  const tmp = makeCanvas(H), t = tmp.getContext('2d');
  t.drawImage(n, 0, 0);
  t.globalCompositeOperation = 'destination-in';
  g = t.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.6, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  t.fillStyle = g; t.fillRect(0, 0, H, H);
  c.drawImage(tmp, H, 0);
  // 2: spark / star
  c.save(); c.translate(64, H + 64);
  g = c.createRadialGradient(0, 0, 0, 0, 0, 60);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.15, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.beginPath(); c.arc(0, 0, 60, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.9)';
  for (let i = 0; i < 4; i++) { c.rotate(Math.PI / 4); c.fillRect(-60, -2, 120, 4); }
  c.restore();
  // 3: blood droplet cluster
  c.save(); c.translate(H + 64, H + 64);
  c.fillStyle = '#fff';
  c.beginPath();
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI * 2, r = 30 + Math.sin(i * 2.7) * 10 + Math.cos(i * 1.3) * 6;
    if (i === 0) c.moveTo(Math.cos(a) * r, Math.sin(a) * r); else c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  c.fill();
  for (let i = 0; i < 9; i++) {
    const a = i * 0.7, r = 42 + (i % 3) * 7;
    c.beginPath(); c.arc(Math.cos(a) * r, Math.sin(a) * r, 4 + (i % 4) * 2, 0, Math.PI * 2); c.fill();
  }
  c.restore();
  return toTexture(cv, { srgb: false });
}

const VERT = /* glsl */`
  attribute float size; attribute float alpha; attribute float angle; attribute float cell; attribute vec3 color;
  uniform float uScale;
  varying float vAlpha; varying float vAngle; varying float vCell; varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = size * uScale / max(0.05, -mv.z);
    vAlpha = alpha; vAngle = angle; vCell = cell; vColor = color;
  }`;
const FRAG = /* glsl */`
  uniform sampler2D uAtlas;
  varying float vAlpha; varying float vAngle; varying float vCell; varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float c = cos(vAngle), s = sin(vAngle);
    p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) discard;
    vec2 uv = (vec2(mod(vCell, 2.0), 1.0 - floor(vCell / 2.0)) + vec2(p.x, 1.0 - p.y)) * 0.5;
    vec4 t = texture2D(uAtlas, uv);
    float a = t.a * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor * t.rgb, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

class Batch {
  constructor(scene, atlas, additive) {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX_P * 3);
    this.col = new Float32Array(MAX_P * 3);
    this.size = new Float32Array(MAX_P);
    this.alpha = new Float32Array(MAX_P);
    this.angle = new Float32Array(MAX_P);
    this.cell = new Float32Array(MAX_P);
    const dyn = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', dyn(this.pos, 3));
    this.geo.setAttribute('color', dyn(this.col, 3));
    this.geo.setAttribute('size', dyn(this.size, 1));
    this.geo.setAttribute('alpha', dyn(this.alpha, 1));
    this.geo.setAttribute('angle', dyn(this.angle, 1));
    this.geo.setAttribute('cell', dyn(this.cell, 1));
    this.geo.setDrawRange(0, 0);
    this.uniforms = { uAtlas: { value: atlas }, uScale: { value: 800 } };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    scene.add(this.points);
    this.list = [];
  }

  write() {
    const n = Math.min(this.list.length, MAX_P);
    for (let i = 0; i < n; i++) {
      const q = this.list[i];
      const k = 1 - q.life / q.max;                 // 0 -> 1 over the lifetime
      this.pos[i * 3] = q.p.x; this.pos[i * 3 + 1] = q.p.y; this.pos[i * 3 + 2] = q.p.z;
      const r = q.c1 ? q.c.r + (q.c1.r - q.c.r) * k : q.c.r;
      const g = q.c1 ? q.c.g + (q.c1.g - q.c.g) * k : q.c.g;
      const b = q.c1 ? q.c.b + (q.c1.b - q.c.b) * k : q.c.b;
      this.col[i * 3] = r * q.bright; this.col[i * 3 + 1] = g * q.bright; this.col[i * 3 + 2] = b * q.bright;
      this.size[i] = q.s0 + (q.s1 - q.s0) * (q.grow ? Math.sqrt(k) : k);
      const fadeIn = q.fadeIn ? Math.min(1, k / q.fadeIn) : 1;
      this.alpha[i] = (q.a0 + (q.a1 - q.a0) * k) * fadeIn;
      this.angle[i] = q.angle;
      this.cell[i] = q.cell;
    }
    this.geo.setDrawRange(0, n);
    for (const key of ['position', 'color', 'size', 'alpha', 'angle', 'cell']) this.geo.attributes[key].needsUpdate = true;
  }
}

const TOON_FRAG = FRAG.replace(
  'vec2 uv = (vec2(mod(vCell, 2.0), 1.0 - floor(vCell / 2.0)) + vec2(p.x, 1.0 - p.y)) * 0.5;',
  'vec2 uv = (vec2(mod(vCell, 4.0), 3.0 - floor(vCell / 4.0)) + vec2(p.x, 1.0 - p.y)) * 0.25;');

class ToonBatch extends Batch {
  constructor(scene) {
    super(scene, toonAtlas(), false);
    this.mat.fragmentShader = TOON_FRAG;
    this.mat.needsUpdate = true;
    this.points.renderOrder = 5;
  }
}

// ------------------------------- decals --------------------------------------
function bloodDecalTexture(seed) {
  const S = 256, cv = makeCanvas(S), c = cv.getContext('2d');
  let s = seed;
  const R = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  c.fillStyle = '#ffffff';
  c.beginPath();
  for (let i = 0; i <= 22; i++) {
    const a = (i / 22) * Math.PI * 2, r = 60 + R() * 38;
    const x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r;
    if (i === 0) c.moveTo(x, y); else c.quadraticCurveTo(128 + Math.cos(a - 0.14) * (r + 14), 128 + Math.sin(a - 0.14) * (r + 14), x, y);
  }
  c.fill();
  for (let i = 0; i < 26; i++) {
    const a = R() * Math.PI * 2, r = 90 + R() * 34;
    c.beginPath(); c.arc(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 2 + R() * 7, 0, Math.PI * 2); c.fill();
  }
  // use it as an alpha mask over dark wet red
  const out = makeCanvas(S), o = out.getContext('2d');
  o.fillStyle = '#4a0306'; o.fillRect(0, 0, S, S);
  o.globalAlpha = 0.5; o.globalCompositeOperation = 'multiply';
  o.drawImage(noiseCanvas(256, 5, 4, seed % 50 + 1, 1.5), 0, 0);
  o.globalCompositeOperation = 'destination-in'; o.globalAlpha = 1;
  o.drawImage(cv, 0, 0);
  return toTexture(out);
}

function scorchTexture() {
  const S = 256, cv = makeCanvas(S), c = cv.getContext('2d');
  const g = c.createRadialGradient(128, 128, 10, 128, 128, 126);
  g.addColorStop(0, 'rgba(8,6,6,0.95)'); g.addColorStop(0.55, 'rgba(14,10,8,0.75)'); g.addColorStop(1, 'rgba(20,14,10,0)');
  c.fillStyle = g; c.fillRect(0, 0, S, S);
  c.globalCompositeOperation = 'destination-out';
  c.globalAlpha = 0.5;
  c.drawImage(noiseCanvas(256, 6, 4, 33, 2), 0, 0);
  return toTexture(cv);
}

// -------------------------------- Effects ------------------------------------
export class Effects {
  constructor(game) {
    this.game = game;
    const atlas = particleAtlas();
    this.soft = new Batch(game.scene, atlas, false);
    this.add = new Batch(game.scene, atlas, true);
    this.toon = TOONFX ? new ToonBatch(game.scene) : null;
    this.shells = [];
    this._shellGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.05, 8);
    this._shellMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 1, roughness: 0.25 });

    this.decals = [];
    this._decalGeo = new THREE.PlaneGeometry(1, 1);
    this._bloodTex = TOONFX ? [toonTexture('splat')] : [bloodDecalTexture(11), bloodDecalTexture(29), bloodDecalTexture(47)];
    this._scorchTex = TOONFX ? toonTexture('soot') : scorchTexture();

    // one shared flash light for explosions (cheap, no shader recompiles)
    this.flash = new THREE.PointLight(0xffa040, 0, 18, 1.6);
    game.scene.add(this.flash);
    this.flashT = 0;

    this.rings = [];
    this._ringGeo = new THREE.RingGeometry(0.8, 1, 48);
    this._tmp = new THREE.Vector3();
    this._initMotes();
  }

  /** dust hanging in the air, only really visible where the light falls */
  _initMotes() {
    const N = 420;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = rand(-18, 18); pos[i * 3 + 1] = rand(0, 6); pos[i * 3 + 2] = rand(-18, 18);
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.moteU = {
      uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uScale: { value: 800 },
      uL: { value: [new THREE.Vector4(0, -4, 9, 0.9), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.moteU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute float seed;
        uniform float uTime; uniform vec3 uCam; uniform vec4 uL[4]; uniform float uScale;
        varying float vA;
        void main() {
          vec3 p = position + vec3(sin(uTime * 0.3 + seed * 6.0), sin(uTime * 0.2 + seed * 3.0) * 0.4, cos(uTime * 0.25 + seed * 5.0)) * 0.5;
          vec2 box = vec2(36.0);
          p.xz = uCam.xz + mod(p.xz - uCam.xz + box * 0.5, box) - box * 0.5;
          p.y = 0.2 + mod(p.y + uTime * 0.05 * (seed - 0.5), 6.0);
          float lit = 0.06;
          for (int i = 0; i < 4; i++) lit += uL[i].w * (1.0 - smoothstep(0.0, uL[i].z, distance(p.xz, uL[i].xy)));
          vA = min(1.0, lit) * (0.45 + 0.55 * sin(uTime * 1.3 + seed * 20.0));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (0.02 + seed * 0.025) * uScale / max(0.1, -mv.z);
        }`,
      fragmentShader: /* glsl */`
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vA * 0.55;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vec3(1.0, 0.9, 0.75) * 1.6, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.motes = new THREE.Points(geo, mat);
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 4;
    this.motes.visible = !TOONFX;          // CG dust in the light doesn't belong in a cartoon
    this.game.scene.add(this.motes);
  }

  // --------------------------- particle emitters ----------------------------
  _emit(batch, o) {
    if (batch.list.length >= MAX_P) batch.list.shift();
    const q = {
      p: o.p.clone(), v: o.v || new THREE.Vector3(),
      life: o.life, max: o.life, grav: o.grav ?? 0, drag: o.drag ?? 0,
      s0: o.s0 ?? 0.2, s1: o.s1 ?? o.s0 ?? 0.2, grow: !!o.grow,
      a0: o.a0 ?? 1, a1: o.a1 ?? 0, fadeIn: o.fadeIn || 0,
      c: new THREE.Color(o.color ?? 0xffffff), c1: o.color1 !== undefined ? new THREE.Color(o.color1) : null,
      bright: o.bright ?? 1, angle: o.angle ?? Math.random() * 6.28, spin: o.spin ?? 0, cell: o.cell ?? 0,
      floor: o.floor ?? true,
    };
    batch.list.push(q);
    return q;
  }

  _rv(speed, up = 0.6) {
    return new THREE.Vector3(rand(-1, 1), rand(up - 0.4, up + 0.8), rand(-1, 1)).normalize().multiplyScalar(rand(speed * 0.4, speed));
  }

  // ------------------------- 1930s cartoon effects ---------------------------
  _t(o) { return this._emit(this.toon, { color: 0xffffff, a0: 1, a1: 0.9, ...o }); }
  /** an impact star that pops out and spins away */
  toonStar(pos, size = 0.35, speed = 2.5, cell = TOON.star) {
    this._t({ p: pos, v: this._rv(speed, 0.8), life: rand(0.28, 0.42), grav: 3, drag: 3, s0: size * 0.4, s1: size, grow: true, cell, spin: rand(-6, 6), a1: 0.6 });
  }
  /** a puffy inked cloud */
  toonCloud(pos, size = 0.6, { v = null, life = rand(0.6, 0.9), cell = TOON.cloud, rise = 0.8 } = {}) {
    this._t({ p: pos, v: v || new THREE.Vector3(rand(-0.4, 0.4), rise * rand(0.6, 1.2), rand(-0.4, 0.4)), life, grav: -0.2, drag: 1.8,
      s0: size * 0.35, s1: size, grow: true, cell, spin: rand(-1.2, 1.2), a0: 1, a1: 0 });
  }
  /** the little ghost that floats up out of a knocked-out zombie */
  spawnGhost(pos) {
    if (!this.toon) return;
    this._t({ p: pos, v: new THREE.Vector3(rand(-0.25, 0.25), 1.1, rand(-0.25, 0.25)), life: 1.7, grav: -0.15, drag: 0.4, s0: 0.25, s1: 0.75, grow: true, cell: TOON.ghost, angle: 0, spin: 0, a0: 0.95, a1: 0, floor: false });
  }
  /** the dust a running cartoon kicks up behind its heels */
  spawnToonPuff(pos) {
    if (!this.toon) return;
    this.toonCloud(pos, rand(0.28, 0.4), { cell: TOON.puff, life: rand(0.35, 0.5), rise: 0.4 });
  }

  /** legacy entry point: routes old color-coded bursts to proper effects */
  spawnBurst(pos, color, count = 6, speed = 4, gravity = 12) {
    if (gravity < 0) return this.spawnSmoke(pos, count, 0x8a8a8a);
    const c = new THREE.Color(color);
    const hsl = {}; c.getHSL(hsl);
    const warm = hsl.h > 0.06 && hsl.h < 0.17 && hsl.s > 0.4;          // gold / orange
    if (warm && this.toon) {
      for (let i = 0; i < Math.min(5, Math.ceil(count / 2)); i++) this.toonStar(pos, rand(0.18, 0.3), speed * 0.8, TOON.star4);
      if (count >= 6) this.toonStar(pos, 0.42, 0.5);
      return;
    }
    if (warm) {
      for (let i = 0; i < count * 2; i++) {
        this._emit(this.add, { p: pos, v: this._rv(speed * 1.4), life: rand(0.25, 0.5), grav: 9, drag: 1.5, s0: rand(0.05, 0.1), s1: 0.01, color: 0xffd060, bright: 3, cell: CELL.spark, a1: 0.2 });
      }
      return;
    }
    if (hsl.h > 0.9 || hsl.h < 0.03) return this.spawnBlood(pos, count, speed);   // red = blood
    for (let i = 0; i < count; i++) {
      this._emit(this.soft, { p: pos, v: this._rv(speed), life: rand(0.35, 0.7), grav: gravity, s0: rand(0.08, 0.16), s1: 0.05, color, cell: CELL.blob, a0: 0.9 });
    }
  }

  spawnBlood(pos, count = 8, speed = 3.5) {
    if (this.toon) {
      // no gore in a 1930s cartoon: an impact star, the spark lines of a hit, a few ink drops
      this.toonStar(pos, 0.36, 0.4);
      this._t({ p: pos, life: 0.14, s0: 0.3, s1: 0.55, cell: TOON.spark, a0: 1, a1: 0.4 });
      for (let i = 0; i < Math.ceil(count / 3); i++) this._t({ p: pos, v: this._rv(speed), life: rand(0.35, 0.6), grav: 12, s0: rand(0.08, 0.13), s1: 0.06, cell: TOON.drop });
      return;
    }
    const rf = this.game.settings?.reducedFlash;
    for (let i = 0; i < count; i++) {
      this._emit(this.soft, { p: pos, v: this._rv(speed), life: rand(0.4, 0.8), grav: 13, drag: 0.6, s0: rand(0.05, 0.12), s1: rand(0.03, 0.06), color: 0x6a0408, color1: 0x2a0204, cell: CELL.drop, a0: 0.95, a1: 0.6 });
    }
    for (let i = 0; i < Math.ceil(count / 3); i++) {
      this._emit(this.soft, { p: pos, v: this._rv(speed * 0.35), life: rand(0.35, 0.6), grav: 0.5, drag: 2, s0: 0.2, s1: rf ? 0.5 : 0.8, grow: true, color: 0x5a0508, cell: CELL.smoke, a0: 0.55, a1: 0 });
    }
  }

  spawnHeadPop(pos) {
    if (this.toon) {
      this._t({ p: pos, life: 0.22, s0: 0.6, s1: 1.0, cell: TOON.bang, a0: 1, a1: 0.5 });
      for (let i = 0; i < 6; i++) this.toonStar(pos, rand(0.22, 0.36), 4, i % 2 ? TOON.star : TOON.star4);
      this.toonCloud(pos, 0.7);
      return;
    }
    this.spawnBlood(pos, 22, 5);
    for (let i = 0; i < 10; i++) {
      this._emit(this.soft, { p: pos, v: this._rv(6, 0.9), life: rand(0.6, 1), grav: 14, drag: 0.3, s0: rand(0.1, 0.18), s1: 0.08, color: 0x3a0406, cell: CELL.drop, a0: 1, a1: 0.8 });
    }
    this._emit(this.soft, { p: pos, life: 0.7, s0: 0.4, s1: 1.4, grow: true, color: 0x6a0508, cell: CELL.smoke, a0: 0.7, a1: 0 });
    this.spawnDecal(pos, 0.9);
  }

  spawnGibs(pos, color) {
    if (this.toon) {
      for (let i = 0; i < 9; i++) this.toonCloud(pos.clone().add(new THREE.Vector3(rand(-0.6, 0.6), rand(-0.4, 0.6), rand(-0.6, 0.6))), rand(0.7, 1.2), { cell: TOON.cloud2 });
      for (let i = 0; i < 6; i++) this.toonStar(pos, 0.3, 5);
      return;
    }
    for (let i = 0; i < 26; i++) {
      this._emit(this.soft, { p: pos, v: this._rv(9, 0.7), life: rand(0.5, 1.1), grav: 15, drag: 0.4, s0: rand(0.1, 0.22), s1: 0.1, color, color1: 0x2a2a08, cell: CELL.drop, a0: 1, a1: 0.7 });
    }
    for (let i = 0; i < 6; i++) {
      this._emit(this.soft, { p: pos, v: this._rv(2), life: rand(1, 1.6), grav: -0.4, drag: 1.2, s0: 0.6, s1: 2.4, grow: true, color: 0x6a7a2a, cell: CELL.smoke, a0: 0.5, a1: 0 });
    }
  }

  spawnSmoke(pos, count = 3, color = 0x777777) {
    if (this.toon) { for (let i = 0; i < Math.min(3, count); i++) this.toonCloud(pos, rand(0.3, 0.5), { cell: TOON.puff }); return; }
    for (let i = 0; i < count; i++) {
      this._emit(this.soft, { p: pos, v: new THREE.Vector3(rand(-0.2, 0.2), rand(0.4, 0.9), rand(-0.2, 0.2)), life: rand(0.6, 1.1), grav: -0.3, drag: 1.5, s0: 0.06, s1: 0.35, grow: true, color, cell: CELL.smoke, a0: 0.35, a1: 0, fadeIn: 0.1 });
    }
  }

  spawnDust(pos, scale = 1) {
    if (this.toon) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        this.toonCloud(pos.clone().add(new THREE.Vector3(Math.cos(a) * 0.3, 0.2, Math.sin(a) * 0.3)), 0.55 * scale,
          { cell: TOON.puff, v: new THREE.Vector3(Math.cos(a) * 1.4 * scale, 0.3, Math.sin(a) * 1.4 * scale) });
      }
      return;
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const p = pos.clone().add(new THREE.Vector3(Math.cos(a) * 0.3, 0.15, Math.sin(a) * 0.3));
      this._emit(this.soft, { p, v: new THREE.Vector3(Math.cos(a) * 1.6 * scale, rand(0.2, 0.7), Math.sin(a) * 1.6 * scale), life: rand(0.8, 1.3), grav: -0.1, drag: 2.2, s0: 0.3 * scale, s1: 1.1 * scale, grow: true, color: 0x4a3a4a, cell: CELL.smoke, a0: 0.55, a1: 0, fadeIn: 0.1 });
    }
  }

  spawnPoof(pos, color = 0xc27aff) {
    if (this.toon) {
      for (let i = 0; i < 7; i++) this.toonCloud(pos.clone().add(new THREE.Vector3(rand(-0.4, 0.4), rand(-0.6, 0.5), rand(-0.4, 0.4))), rand(0.6, 0.9));
      for (let i = 0; i < 4; i++) this.toonStar(pos, 0.26, 3.5, TOON.star4);
      return;
    }
    for (let i = 0; i < 14; i++) {
      this._emit(this.soft, { p: pos.clone().add(new THREE.Vector3(rand(-0.3, 0.3), rand(-0.8, 0.6), rand(-0.3, 0.3))), v: this._rv(1.6, 0.3), life: rand(0.7, 1.1), grav: -0.6, drag: 2, s0: 0.3, s1: 1.2, grow: true, color, color1: 0x1a0a2a, cell: CELL.smoke, a0: 0.75, a1: 0 });
    }
    for (let i = 0; i < 16; i++) {
      this._emit(this.add, { p: pos, v: this._rv(4.5, 0.4), life: rand(0.3, 0.7), grav: 2, drag: 2.5, s0: 0.12, s1: 0.02, color, bright: 3, cell: CELL.spark });
    }
  }

  /** a lick of flame (burning zombies, fire pools) */
  spawnFire(pos, scale = 1) {
    const rf = this.game.settings?.reducedFlash;
    this._emit(this.add, { p: pos.clone().add(new THREE.Vector3(rand(-0.15, 0.15), 0, rand(-0.15, 0.15)).multiplyScalar(scale)),
      v: new THREE.Vector3(rand(-0.2, 0.2), rand(1.2, 2.2) * scale, rand(-0.2, 0.2)), life: rand(0.3, 0.55), grav: -1, drag: 1,
      s0: 0.25 * scale, s1: 0.05, color: 0xffc050, color1: 0xa01a04, bright: rf ? 1 : 1.8, cell: CELL.smoke, a0: 0.85, a1: 0, spin: rand(-2, 2) });
    if (Math.random() < 0.2) this._emit(this.soft, { p: pos.clone().setY(pos.y + 0.5 * scale), v: new THREE.Vector3(0, rand(0.6, 1.1), 0), life: rand(0.8, 1.3), grav: -0.3, drag: 1, s0: 0.2 * scale, s1: 0.8 * scale, grow: true, color: 0x2a2226, cell: CELL.smoke, a0: 0.35, a1: 0, fadeIn: 0.2 });
  }

  /** the flambé torch's jet: a tongue of fire along a direction */
  spawnFlame(pos, dir, speed = 11) {
    const v = dir.clone().multiplyScalar(speed * rand(0.8, 1.1)).add(new THREE.Vector3(rand(-0.6, 0.6), rand(-0.3, 0.6), rand(-0.6, 0.6)));
    this._emit(this.add, { p: pos, v, life: rand(0.35, 0.6), grav: -2, drag: 1.6, s0: 0.1, s1: 0.75, grow: true,
      color: 0xffa040, color1: 0x8a1604, bright: this.game.settings?.reducedFlash ? 0.6 : 0.95, cell: CELL.smoke, a0: 0.55, a1: 0, spin: rand(-3, 3), floor: false });
  }

  /** a curl of cigarette smoke drifting up off an ashtray into the haze */
  spawnWisp(pos) {
    this._emit(this.soft, { p: pos, v: new THREE.Vector3(rand(-0.08, 0.08), rand(0.35, 0.6), rand(-0.08, 0.08)), life: rand(4, 6.5), grav: -0.02, drag: 0.15,
      s0: 0.08, s1: rand(1.2, 2.2), grow: true, color: 0x9a96a8, color1: 0x5a5668, cell: CELL.smoke, a0: 0.16, a1: 0, fadeIn: 0.25, spin: rand(-0.3, 0.3), floor: false });
  }

  /** LADY LUCK's strike: green-gold sparks and a lucky glow */
  spawnLuckSpark(pos) {
    const rf = this.game.settings?.reducedFlash;
    for (let i = 0; i < 14; i++) {
      this._emit(this.add, { p: pos, v: this._rv(6, 0.4), life: rand(0.25, 0.5), grav: 6, drag: 2, s0: 0.09, s1: 0.02, color: i % 3 ? 0x5aff9a : 0xffd24a, bright: rf ? 1.5 : 3, cell: CELL.spark });
    }
    this._emit(this.add, { p: pos, life: 0.22, s0: 0.5, s1: 1.4, color: 0x3aff8a, bright: rf ? 0.6 : 1.4, cell: CELL.blob, a0: 0.8, a1: 0 });
  }

  /** a white pop (the paparazzi flash) */
  spawnFlashPop(pos) {
    for (let i = 0; i < 3; i++) this._emit(this.add, { p: pos, life: 0.25, s0: 1.5, s1: 6, color: 0xffffff, bright: 2.5, cell: CELL.blob, a0: 1, a1: 0 });
    for (let i = 0; i < 24; i++) this._emit(this.add, { p: pos, v: this._rv(9, 0.2), life: rand(0.3, 0.6), grav: 4, drag: 2, s0: 0.1, s1: 0.02, color: 0xe8f4ff, bright: 3, cell: CELL.spark });
    this.flash.position.copy(pos).setY(Math.max(1, pos.y + 0.5));
    this.flash.color.set(0xeef4ff);
    this.flash.intensity = this.game.settings?.reducedFlash ? 60 : 300;
    this.flashT = 0.25;
  }

  spawnTrail(pos, color) {
    this._emit(this.add, { p: pos, v: new THREE.Vector3(0, 0.2, 0), life: 0.3, s0: 0.24, s1: 0.05, color, bright: 1.6, cell: CELL.blob, a0: 0.7, a1: 0 });
  }

  spawnSplash(pos, color) {
    for (let i = 0; i < 14; i++) {
      this._emit(this.add, { p: pos, v: this._rv(4), life: rand(0.3, 0.6), grav: 10, s0: 0.1, s1: 0.03, color, bright: 2.2, cell: CELL.blob });
    }
    this._emit(this.add, { p: pos, life: 0.35, s0: 0.3, s1: 1.4, grow: true, color, bright: 1.4, cell: CELL.blob, a0: 0.8, a1: 0 });
  }

  spawnMuzzleSmoke(pos) {
    if (this.toon) { if (Math.random() < 0.5) this.toonCloud(pos, 0.18, { cell: TOON.puff, life: 0.4, rise: 0.5 }); return; }
    this._emit(this.soft, { p: pos, v: new THREE.Vector3(rand(-0.1, 0.1), rand(0.3, 0.6), rand(-0.1, 0.1)), life: rand(0.5, 0.9), grav: -0.4, drag: 1.4, s0: 0.05, s1: 0.28, grow: true, color: 0x9a9aa0, cell: CELL.smoke, a0: 0.28, a1: 0, fadeIn: 0.15 });
  }

  /** where a bullet struck something that isn't a zombie */
  spawnImpact(pos, normal) {
    const n = normal || new THREE.Vector3(0, 1, 0);
    if (this.toon) {
      this._t({ p: pos.clone().addScaledVector(n, 0.04), life: 0.12, s0: 0.2, s1: 0.32, cell: TOON.spark, a0: 1, a1: 0.3 });
      this.toonCloud(pos.clone().addScaledVector(n, 0.08), 0.22, { cell: TOON.puff, life: 0.35, v: n.clone().multiplyScalar(0.5) });
      return;
    }
    for (let i = 0; i < 6; i++) {
      const v = n.clone().multiplyScalar(rand(1, 3)).add(new THREE.Vector3(rand(-1.5, 1.5), rand(-0.5, 1.5), rand(-1.5, 1.5)));
      this._emit(this.add, { p: pos, v, life: rand(0.12, 0.3), grav: 12, s0: 0.05, s1: 0.01, color: 0xffc070, bright: 3, cell: CELL.spark });
    }
    this._emit(this.soft, { p: pos.clone().addScaledVector(n, 0.05), v: n.clone().multiplyScalar(0.4), life: 0.6, grav: -0.2, drag: 2, s0: 0.08, s1: 0.4, grow: true, color: 0x6a5a5a, cell: CELL.smoke, a0: 0.45, a1: 0 });
  }

  spawnExplosion(pos, radius = 5, tint = 0xffa040) {
    const rf = this.game.settings?.reducedFlash;
    const k = radius / 5;
    if (this.toon) {
      // KA-BOOM: a spiky flash, a ring of puffy clouds rolling out, stars flying, an inked shock ring
      this._t({ p: pos.clone().setY(Math.max(0.6, pos.y)), life: 0.28, s0: 2.2 * k, s1: 3.4 * k, cell: TOON.bang, a0: 1, a1: 0.6, spin: rand(-1, 1) });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const dir = new THREE.Vector3(Math.cos(a), rand(0.1, 0.5), Math.sin(a));
        this.toonCloud(pos.clone().add(dir.clone().multiplyScalar(0.4 * k)).setY(Math.max(0.4, pos.y)), rand(1.4, 2.2) * k,
          { v: dir.multiplyScalar(rand(3, 4.5) * k), life: rand(0.8, 1.3), cell: i % 3 ? TOON.cloud : TOON.cloud2 });
      }
      for (let i = 0; i < 8; i++) this.toonStar(pos.clone().setY(1), rand(0.3, 0.55) * k, 8 * k, i % 2 ? TOON.star : TOON.star4);
      this._t({ p: pos.clone().setY(0.3), life: 0.4, s0: 0.5 * k, s1: 5 * k, grow: true, cell: TOON.ring, a0: 0.9, a1: 0, angle: 0, spin: 0, floor: false });
      this.flash.position.copy(pos).setY(Math.max(1, pos.y + 1));
      this.flash.color.set(0xffe8a0);
      this.flash.intensity = rf ? 40 : 140;
      this.flashT = 0.25;
      return;
    }
    // fireball
    for (let i = 0; i < 18; i++) {
      const p = pos.clone().add(new THREE.Vector3(rand(-0.6, 0.6), rand(-0.3, 0.6), rand(-0.6, 0.6)).multiplyScalar(k));
      this._emit(this.add, { p, v: this._rv(3.5 * k, 0.5), life: rand(0.35, 0.65), grav: -1, drag: 3, s0: 0.8 * k, s1: 2.6 * k, grow: true, color: 0xffb050, color1: 0x8a1a04, bright: rf ? 0.7 : 1.2, cell: CELL.smoke, a0: 0.8, a1: 0, angle: rand(0, 6) });
    }
    // white-hot core, brief
    for (let i = 0; i < 3; i++) {
      this._emit(this.add, { p: pos, life: 0.16, s0: 1.2 * k, s1: 2.2 * k, color: tint, bright: rf ? 0.8 : 1.6, cell: CELL.blob, a0: 0.9, a1: 0 });
    }
    // rolling smoke
    for (let i = 0; i < 16; i++) {
      this._emit(this.soft, { p: pos.clone().add(new THREE.Vector3(rand(-0.8, 0.8), rand(0, 0.8), rand(-0.8, 0.8)).multiplyScalar(k)), v: this._rv(2.2 * k, 0.9), life: rand(1.4, 2.4), grav: -0.6, drag: 1.3, s0: 1.0 * k, s1: 3.6 * k, grow: true, color: 0x2a2226, color1: 0x141014, cell: CELL.smoke, a0: 0.7, a1: 0, fadeIn: 0.12 });
    }
    // sparks
    for (let i = 0; i < 30; i++) {
      this._emit(this.add, { p: pos, v: this._rv(13 * k, 0.6), life: rand(0.4, 0.9), grav: 14, drag: 0.8, s0: 0.1, s1: 0.02, color: 0xffd080, bright: 3, cell: CELL.spark });
    }
    // light flash + floor shockwave
    this.flash.position.copy(pos).setY(Math.max(1, pos.y + 1));
    this.flash.color.set(tint);
    this.flash.intensity = rf ? 60 : 220;
    this.flashT = 0.35;
    const ring = new THREE.Mesh(this._ringGeo, new THREE.MeshBasicMaterial({
      color: tint, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(pos).setY(0.06);
    this.game.scene.add(ring);
    this.rings.push({ mesh: ring, t: 0, r: radius });
  }

  // ------------------------------- decals -----------------------------------
  spawnDecal(pos, size = 1, type = 'blood') {
    if (this.decals.length >= MAX_DECALS) {
      const old = this.decals.shift();
      this.game.scene.remove(old.mesh);
      old.mesh.material.dispose();
    }
    const blood = type === 'blood';
    const mat = new THREE.MeshStandardMaterial({
      map: blood ? this._bloodTex[Math.floor(Math.random() * 3)] : this._scorchTex,
      transparent: true, depthWrite: false, roughness: blood ? 0.18 : 1, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const m = new THREE.Mesh(this._decalGeo, mat);
    m.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    m.position.set(pos.x + rand(-0.2, 0.2), 0.008 + this.decals.length * 0.0004, pos.z + rand(-0.2, 0.2));
    m.scale.setScalar(0.01);
    m.renderOrder = 1;
    this.game.scene.add(m);
    this.decals.push({ mesh: m, t: 0, size, life: blood ? 40 : 25 });
  }

  // ------------------------------- shells -----------------------------------
  /** shell casing ejected from the current weapon's breech */
  spawnShell() {
    const g = this.game;
    if (this.shells.length >= MAX_SHELLS) {
      const old = this.shells.shift();
      g.scene.remove(old.mesh);
    }
    const mesh = new THREE.Mesh(this._shellGeo, this._shellMat);
    // the viewmodel lives in camera space; eject from just right of the breech
    mesh.position.copy(g.camera.localToWorld(g.weapons.vm.position.clone().add(new THREE.Vector3(0.05, 0.06, -0.05))));
    const right = g.player.rightFlat();
    const vel = right.multiplyScalar(rand(1.6, 2.6))
      .add(new THREE.Vector3(0, rand(2.2, 3.2), 0))
      .add(g.player.forwardFlat().multiplyScalar(rand(-0.4, 0.4)));
    g.scene.add(mesh);
    this.shells.push({ mesh, vel, spin: rand(8, 18), t: 1.6, bounced: 0 });
  }

  /** a handful of spent casings tumbling out of the revolver */
  spawnCasings(pos, n = 6) {
    const g = this.game;
    for (let i = 0; i < n; i++) {
      if (this.shells.length >= MAX_SHELLS) g.scene.remove(this.shells.shift().mesh);
      const mesh = new THREE.Mesh(this._shellGeo, this._shellMat);
      mesh.position.copy(pos).add(new THREE.Vector3(rand(-0.03, 0.03), rand(-0.03, 0.03), rand(-0.03, 0.03)));
      const vel = new THREE.Vector3(rand(-0.6, 0.6), rand(0.2, 1.2), rand(-0.6, 0.6));
      g.scene.add(mesh);
      this.shells.push({ mesh, vel, spin: rand(8, 20), t: 1.8, bounced: 0 });
    }
  }

  /** a real object (the dropped mag) falling out of the viewmodel into the world */
  spawnDebris(obj, pos, quat, vel) {
    const g = this.game;
    obj.position.copy(pos);
    obj.quaternion.copy(quat);
    obj.traverse((o) => { o.renderOrder = 0; o.frustumCulled = true; });
    g.scene.add(obj);
    (this.debris ||= []).push({ obj, vel: vel.clone(), spin: new THREE.Vector3(rand(-6, 6), rand(-3, 3), rand(-6, 6)), t: 6, landed: false });
  }

  // ------------------------------- update -----------------------------------
  update(dt) {
    const g = this.game;
    // projection scale for point sizes (matches the camera + drawing buffer)
    const h = g.renderer.getDrawingBufferSize(this._tmp).y;
    const scale = h / (2 * Math.tan(THREE.MathUtils.degToRad(g.camera.fov) / 2));
    const mu = this.moteU;
    mu.uTime.value += dt;
    mu.uScale.value = scale;
    mu.uCam.value.copy(g.camera.position);
    const dl = g.arena?.discoLights || [];
    for (let i = 0; i < 3; i++) {
      const tp = dl[i]?.light.target.position;
      if (tp) mu.uL.value[i + 1].set(tp.x, tp.z, 3.5, g.arena.lowLight ? 0.2 : 0.8);
    }
    mu.uL.value[0].w = g.arena?.lowLight ? 0.2 : 0.9;
    for (const b of this.toon ? [this.soft, this.add, this.toon] : [this.soft, this.add]) {
      b.uniforms.uScale.value = scale;
      for (let i = b.list.length - 1; i >= 0; i--) {
        const q = b.list[i];
        q.life -= dt;
        if (q.life <= 0) { b.list.splice(i, 1); continue; }
        q.v.y -= q.grav * dt;
        if (q.drag) q.v.multiplyScalar(Math.max(0, 1 - q.drag * dt));
        q.p.addScaledVector(q.v, dt);
        q.angle += q.spin * dt;
        if (q.floor && q.p.y < 0.03 && q.grav > 0) {
          q.p.y = 0.03; q.v.set(0, 0, 0); q.grav = 0;
          q.life = Math.min(q.life, 0.25);
        }
      }
      b.write();
    }

    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      sh.t -= dt;
      sh.vel.y -= 16 * dt;
      sh.mesh.position.addScaledVector(sh.vel, dt);
      sh.mesh.rotation.x += dt * sh.spin;
      sh.mesh.rotation.z += dt * sh.spin * 0.6;
      if (sh.mesh.position.y < 0.015 && sh.bounced < 2) {
        if (sh.bounced === 0 && sh.mesh.position.distanceTo(g.player.pos) < 6) g.audioAt('casing', sh.mesh.position);
        sh.bounced++;
        sh.mesh.position.y = 0.015;
        sh.vel.y = Math.abs(sh.vel.y) * 0.3;
        sh.vel.x *= 0.5; sh.vel.z *= 0.5;
        sh.spin *= 0.4;
      } else if (sh.mesh.position.y < 0.015) {
        sh.mesh.position.y = 0.015; sh.vel.set(0, 0, 0); sh.spin = 0;
        sh.mesh.rotation.x = Math.PI / 2;
      }
      if (sh.t <= 0) {
        g.scene.remove(sh.mesh);
        this.shells.splice(i, 1);
      }
    }

    for (let i = (this.debris?.length || 0) - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.t -= dt;
      if (!d.landed) {
        d.vel.y -= 14 * dt;
        d.obj.position.addScaledVector(d.vel, dt);
        d.obj.rotation.x += d.spin.x * dt; d.obj.rotation.y += d.spin.y * dt; d.obj.rotation.z += d.spin.z * dt;
        if (d.obj.position.y < 0.03) {
          d.obj.position.y = 0.03;
          if (Math.abs(d.vel.y) > 1.5) {
            d.vel.y = Math.abs(d.vel.y) * 0.25; d.vel.x *= 0.5; d.vel.z *= 0.5; d.spin.multiplyScalar(0.4);
            g.audioAt('mag_out', d.obj.position);
          } else {
            d.landed = true;
            d.obj.rotation.set(Math.PI / 2, d.obj.rotation.y, 0);
          }
        }
      }
      if (d.t < 1) d.obj.position.y -= dt * 0.08;
      if (d.t <= 0) { g.scene.remove(d.obj); this.debris.splice(i, 1); }
    }

    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.t += dt;
      const grow = Math.min(1, d.t / 0.6);
      d.mesh.scale.setScalar(d.size * (0.3 + 0.7 * Math.sqrt(grow)));
      if (d.t > d.life - 3) d.mesh.material.opacity = Math.max(0, (d.life - d.t) / 3);
      if (d.t > d.life) {
        g.scene.remove(d.mesh);
        d.mesh.material.dispose();
        this.decals.splice(i, 1);
      }
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / 0.45;
      r.mesh.scale.setScalar(0.3 + k * r.r * 1.3);
      r.mesh.material.opacity = Math.max(0, 0.8 * (1 - k));
      if (k >= 1) {
        g.scene.remove(r.mesh);
        r.mesh.material.dispose();
        this.rings.splice(i, 1);
      }
    }

    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.intensity *= Math.exp(-dt * 12);
      if (this.flashT <= 0) this.flash.intensity = 0;
    }
  }

  clear() {
    for (const b of this.toon ? [this.soft, this.add, this.toon] : [this.soft, this.add]) { b.list = []; b.write(); }
    for (const s of this.shells) this.game.scene.remove(s.mesh);
    for (const d of this.decals) { this.game.scene.remove(d.mesh); d.mesh.material.dispose(); }
    for (const r of this.rings) { this.game.scene.remove(r.mesh); r.mesh.material.dispose(); }
    for (const d of this.debris || []) this.game.scene.remove(d.obj);
    this.shells = []; this.decals = []; this.rings = []; this.debris = [];
    this.flash.intensity = 0;
  }
}
