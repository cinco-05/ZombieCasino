// rig.js — procedural humanoid: a real skeleton plus ONE continuous skinned
// body mesh (torso, sculpted head, neck, arms, hands with fingers, legs,
// shoes, optional coat skirt). Every surface is UV-mapped into a 1024 atlas
// so outfits are painted "skins" (see skins.js), not colored primitives.
//
// Conventions: meters, +Y up, the character faces +Z. Bind pose = arms
// hanging at the sides. The character's LEFT is +X.

import * as THREE from 'three';
import { STYLE } from '../gfx/style.js';

export const ATLAS = 1024;

// Atlas layout. x/y/w/h = pixel rect (canvas, y down). W/H = physical size of
// the unwrapped surface in meters (the painter draws in meters). y0 = world
// height of the region's bottom edge in the bind pose.
export const REGIONS = {
  torso: { x: 0,   y: 0,   w: 512, h: 512, W: 1.0,  H: 0.68, y0: 0.84 },
  head:  { x: 512, y: 0,   w: 512, h: 256, W: 0.58, H: 0.24, y0: 1.59 },
  coat:  { x: 512, y: 256, w: 256, h: 256, W: 1.2,  H: 0.5 },
  hands: { x: 768, y: 256, w: 128, h: 128, W: 0.2,  H: 0.2 },
  shoes: { x: 896, y: 256, w: 128, h: 128, W: 0.3,  H: 0.28 },
  neck:  { x: 768, y: 384, w: 256, h: 128, W: 0.38, H: 0.24, y0: 1.43 },
  armL:  { x: 0,   y: 512, w: 256, h: 512, W: 0.34, H: 0.64, y0: 0.87, outer: 0.25 },
  armR:  { x: 256, y: 512, w: 256, h: 512, W: 0.34, H: 0.64, y0: 0.87, outer: 0.75 },
  legL:  { x: 512, y: 512, w: 256, h: 512, W: 0.52, H: 0.95, y0: 0.06, outer: 0.25 },
  legR:  { x: 768, y: 512, w: 256, h: 512, W: 0.52, H: 0.95, y0: 0.06, outer: 0.75 },
};

// head landmarks shared with the face painter (head-region meters)
export const HEAD_C = { y: 1.71, z: 0.012 };
// the cartoon's big head sits down on the collar (no long neck under a big ball)
const TOON_HEAD_DROP = 0.07;
export const FACE = {
  cx: REGIONS.head.W / 2,        // front center
  eyeDX: 0.035, eyeY: 0.128,     // eye sockets
  noseY: 0.097, mouthY: 0.066, chinY: 0.036,
  browY: 0.145, hairY: 0.172, earDX: REGIONS.head.W / 4, earY: 0.11,
};

export const BONE_NAMES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'upperArmL', 'foreArmL', 'handL',
  'shoulderR', 'upperArmR', 'foreArmR', 'handR',
  'upperLegL', 'lowerLegL', 'footL',
  'upperLegR', 'lowerLegR', 'footR',
];
export const PARENT = {
  hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  shoulderL: 'chest', upperArmL: 'shoulderL', foreArmL: 'upperArmL', handL: 'foreArmL',
  shoulderR: 'chest', upperArmR: 'shoulderR', foreArmR: 'upperArmR', handR: 'foreArmR',
  upperLegL: 'hips', lowerLegL: 'upperLegL', footL: 'lowerLegL',
  upperLegR: 'hips', lowerLegR: 'upperLegR', footR: 'lowerLegR',
};
const BONE_INDEX = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));

// body shapes. Every number is a multiplier on the standard build.
export const BUILDS = {
  standard: {},
  lean:    { shoulders: 0.94, chest: 0.9, waist: 0.88, hips: 0.94, arms: 0.86, legs: 0.88, neck: 0.92 },
  brute:   { shoulders: 1.34, chest: 1.32, waist: 1.18, hips: 1.1, arms: 1.5, legs: 1.28, neck: 1.3, head: 1.02, pants: 0.45 },
  fat:     { shoulders: 1.08, chest: 1.2, waist: 1.38, belly: 1, hips: 1.28, arms: 1.28, legs: 1.28, neck: 1.18, head: 1.04, pants: 0.35 },
  guard:   { shoulders: 1.16, chest: 1.16, waist: 1.05, arms: 1.16, legs: 1.1, neck: 1.1 },
  pitboss: { shoulders: 1.36, chest: 1.36, waist: 1.4, belly: 0.85, hips: 1.28, arms: 1.55, legs: 1.32, neck: 1.3, head: 1.12, pants: 0.4 },
  dealer:  { chest: 0.92, waist: 0.84, hips: 0.92, arms: 0.9, legs: 0.92, neck: 0.9, head: 1.02 },
  // the Strip's own: long-legged showgirls, and the King in his jumpsuit
  showgirl: { shoulders: 0.84, chest: 0.94, waist: 0.7, hips: 1.04, arms: 0.8, legs: 0.94, neck: 0.8, head: 0.94, pants: 0.04, sleeves: 0.0 },
  king:     { shoulders: 1.06, chest: 1.06, waist: 1.12, belly: 0.4, hips: 1.08, arms: 1.05, legs: 1.06, neck: 1.08, head: 1.02, pants: 0.95, sleeves: 0.7 },
};
const DEFAULTS = {
  shoulders: 1, chest: 1, waist: 1, belly: 0, hips: 1, arms: 1, legs: 1,
  neck: 1, head: 1, pants: 0.65, sleeves: 0.5, coat: null,
};

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const gauss = (v, s) => Math.exp(-(v * v) / (2 * s * s));

// ------------------------------- skeleton ------------------------------------
export function jointsFor(b) {
  const sw = 0.172 * b.shoulders + 0.018;
  const hx = 0.088 * b.hips + 0.002;
  const J = {
    root: V(0, 0, 0),
    hips: V(0, 0.95, 0),
    spine: V(0, 1.08, 0),
    chest: V(0, 1.28, 0),
    neck: V(0, 1.49, -0.005),
    head: V(0, 1.6 - (b.toon ? TOON_HEAD_DROP : 0), 0.005),
  };
  for (const [s, sx] of [['L', 1], ['R', -1]]) {
    J['shoulder' + s] = V(0.05 * sx, 1.43, 0);
    J['upperArm' + s] = V(sw * sx, 1.44, -0.01);
    J['foreArm' + s] = V((sw + 0.024) * sx, 1.16, -0.024);
    J['hand' + s] = V((sw + 0.038) * sx, 0.915, 0.0);
    J['upperLeg' + s] = V(hx * sx, 0.93, 0);
    J['lowerLeg' + s] = V((hx + 0.004) * sx, 0.5, 0.012);
    J['foot' + s] = V((hx + 0.008) * sx, 0.085, -0.01);
  }
  return J;
}

/** fresh bone hierarchy for one character instance */
export function makeSkeleton(J) {
  const bones = {};
  for (const name of BONE_NAMES) {
    const b = new THREE.Bone();
    b.name = name;
    bones[name] = b;
  }
  bones.root.position.copy(J.root);
  for (const name of BONE_NAMES) {
    if (name === 'root') continue;
    const p = PARENT[name];
    bones[p].add(bones[name]);
    bones[name].position.copy(J[name]).sub(J[p]);
  }
  bones.root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(BONE_NAMES.map((n) => bones[n]));
  return { bones, skeleton };
}

// ---------------------------- geometry builder -------------------------------
class Builder {
  constructor() {
    this.pos = []; this.uv = []; this.si = []; this.sw = [];
    this.tris = [[], [], []];    // per material: 0 body, 1 eyes, 2 body double-sided
    this.normalGroups = [];      // vertex index sets whose normals get averaged
  }

  vert(p, u, v, w) {
    const i = this.pos.length / 3;
    this.pos.push(p.x, p.y, p.z);
    this.uv.push(u, v);
    const arr = Object.entries(w).filter((e) => e[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const tot = arr.reduce((s, e) => s + e[1], 0) || 1;
    for (let k = 0; k < 4; k++) {
      if (k < arr.length) { this.si.push(BONE_INDEX[arr[k][0]]); this.sw.push(arr[k][1] / tot); }
      else { this.si.push(0); this.sw.push(0); }
    }
    return i;
  }

  tri(a, b, c, mat = 0) { this.tris[mat].push(a, b, c); }

  static uvOf(region, s, t) {
    const R = REGIONS[region];
    const x = R.x + 2 + s * (R.w - 4);
    const y = R.y + 2 + (1 - t) * (R.h - 4);
    return [x / ATLAS, 1 - y / ATLAS];
  }

  /**
   * Generalized cylinder. rings: [{p, rx, zf, zb, n, v, w, f?}]
   *   rx = half-width along the side axis, zf/zb = front/back depth,
   *   n = superellipse exponent (2 round, >2 boxier), v = texture t (0..1),
   *   w = {bone: weight}, f = "front" direction hint (default +Z).
   * opts: region, seg, cap0, cap1, th0/th1 (partial sweep), mat, weightFn, clampY, s0/s1
   */
  loft(rings, o) {
    const seg = o.seg || 16;
    const th0 = o.th0 ?? -Math.PI, th1 = o.th1 ?? Math.PI;
    const full = Math.abs(th1 - th0 - Math.PI * 2) < 1e-6;
    const s0 = o.s0 ?? 0, s1 = o.s1 ?? 1;
    const mat = o.mat || 0;
    const n = rings.length;
    const rows = [], frames = [];
    for (let i = 0; i < n; i++) {
      const r = rings[i];
      const prev = rings[Math.max(0, i - 1)].p, next = rings[Math.min(n - 1, i + 1)].p;
      const t = next.clone().sub(prev).normalize();
      const fh = r.f || o.f || V(0, 0, 1);
      const f = fh.clone().sub(t.clone().multiplyScalar(fh.dot(t))).normalize();
      const s = new THREE.Vector3().crossVectors(t, f).normalize();
      frames.push({ t, f, s });
      const e = 2 / (r.n || 2);
      const row = [];
      for (let j = 0; j <= seg; j++) {
        const th = th0 + (th1 - th0) * (j / seg);
        const sn = Math.sin(th), cs = Math.cos(th);
        const a = Math.sign(sn) * Math.pow(Math.abs(sn), e);
        const b = Math.sign(cs) * Math.pow(Math.abs(cs), e);
        const rz = cs >= 0 ? r.zf : r.zb;
        const p = r.p.clone().addScaledVector(s, r.rx * a).addScaledVector(f, rz * b);
        if (o.clampY !== undefined && p.y < o.clampY) p.y = o.clampY;
        const su = lerp(s0, s1, j / seg);
        const [u, v] = Builder.uvOf(o.region, su, r.v);
        const w = o.weightFn ? o.weightFn(p, r.w) : r.w;
        row.push(this.vert(p, u, v, w));
      }
      rows.push(row);
    }
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < seg; j++) {
        const a = rows[i][j], b = rows[i][j + 1], c = rows[i + 1][j + 1], d = rows[i + 1][j];
        this.tri(a, b, c, mat);
        this.tri(a, c, d, mat);
      }
    }
    if (full) for (const row of rows) this.normalGroups.push([row[0], row[seg]]);
    const cap = (i, end) => {
      const r = rings[i];
      const row = rows[i];
      // duplicate the rim so the cap gets its own flat-ish normals
      const rim = row.map((vi) => {
        const p = V(this.pos[vi * 3], this.pos[vi * 3 + 1], this.pos[vi * 3 + 2]);
        return this.vert(p, this.uv[vi * 2], this.uv[vi * 2 + 1], o.weightFn ? o.weightFn(p, r.w) : r.w);
      });
      const cpos = r.p.clone();
      if (o.clampY !== undefined && cpos.y < o.clampY) cpos.y = o.clampY;
      const [cu, cv] = Builder.uvOf(o.region, (s0 + s1) / 2, r.v);
      const c = this.vert(cpos, cu, cv, r.w);
      for (let j = 0; j < seg; j++) {
        if (end) this.tri(c, rim[j], rim[j + 1], mat);
        else this.tri(c, rim[j + 1], rim[j], mat);
      }
    };
    if (o.cap0) cap(0, false);
    if (o.cap1) cap(n - 1, true);
    return rows;
  }

  /** lat-long surface around a center with a shaping function (heads, ears, eyes) */
  sphereish(C, rows, cols, shape, o) {
    const grid = [];
    for (let i = 0; i <= rows; i++) {
      const phi = (i / rows) * Math.PI;
      const row = [];
      for (let j = 0; j <= cols; j++) {
        const th = -Math.PI + (j / cols) * Math.PI * 2;
        const d = V(Math.sin(phi) * Math.sin(th), Math.cos(phi), Math.sin(phi) * Math.cos(th));
        const p = C.clone().add(shape(d));
        let u = 0.5, v = 0.5;
        if (o.uvFn) [u, v] = o.uvFn(p, d, th);
        row.push(this.vert(p, u, v, o.w));
      }
      grid.push(row);
    }
    const mat = o.mat || 0;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const a = grid[i][j], b = grid[i][j + 1], c = grid[i + 1][j + 1], d = grid[i + 1][j];
        this.tri(a, c, b, mat);
        this.tri(a, d, c, mat);
      }
    }
    for (const row of grid) this.normalGroups.push([row[0], row[cols]]);
    this.normalGroups.push(grid[0].slice(), grid[rows].slice());
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    const idx = [];
    for (let m = 0; m < this.tris.length; m++) {
      if (!this.tris[m].length) continue;
      g.addGroup(idx.length, this.tris[m].length, m);
      for (const i of this.tris[m]) idx.push(i);
    }
    g.setIndex(idx);
    g.computeVertexNormals();
    const nrm = g.attributes.normal;
    const tmp = new THREE.Vector3();
    for (const grp of this.normalGroups) {
      tmp.set(0, 0, 0);
      for (const i of grp) tmp.x += nrm.getX(i), tmp.y += nrm.getY(i), tmp.z += nrm.getZ(i);
      tmp.normalize();
      for (const i of grp) nrm.setXYZ(i, tmp.x, tmp.y, tmp.z);
    }
    g.computeBoundingSphere();
    return g;
  }
}

/** Catmull-Rom densify key rings so silhouettes come out smooth */
function smooth(keys, sub = 2) {
  if (keys.length < 2 || sub < 1) return keys;
  const out = [];
  const cr = (p0, p1, p2, p3, t) => {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
  const mixW = (a, b, t) => {
    const o = {};
    for (const k in a) o[k] = (o[k] || 0) + a[k] * (1 - t);
    for (const k in b) o[k] = (o[k] || 0) + b[k] * t;
    return o;
  };
  for (let i = 0; i < keys.length - 1; i++) {
    const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(keys.length - 1, i + 2)];
    for (let s = 0; s <= sub; s++) {
      if (s === sub && i < keys.length - 2) continue;
      const t = s / sub;
      out.push({
        p: V(cr(k0.p.x, k1.p.x, k2.p.x, k3.p.x, t), cr(k0.p.y, k1.p.y, k2.p.y, k3.p.y, t), cr(k0.p.z, k1.p.z, k2.p.z, k3.p.z, t)),
        rx: Math.max(0.002, cr(k0.rx, k1.rx, k2.rx, k3.rx, t)),
        zf: Math.max(0.002, cr(k0.zf, k1.zf, k2.zf, k3.zf, t)),
        zb: Math.max(0.002, cr(k0.zb, k1.zb, k2.zb, k3.zb, t)),
        n: lerp(k1.n || 2, k2.n || 2, t),
        v: lerp(k1.v, k2.v, t),
        w: mixW(k1.w, k2.w, t),
        f: k1.f && k2.f ? k1.f.clone().lerp(k2.f, t).normalize() : (k1.f || k2.f),
      });
    }
  }
  return out;
}

// ------------------------------ body parts -----------------------------------
function torso(B, b, J) {
  const R = REGIONS.torso;
  const H = b.hips, W = b.waist, C = b.chest, S = b.shoulders, N = b.neck, bel = b.belly;
  const sw = J.upperArmL.x;
  const wAt = (y) => {
    if (y <= 0.98) return { hips: 1 };
    if (y <= 1.12) { const t = sstep(0.98, 1.12, y); return { hips: 1 - t, spine: t }; }
    if (y <= 1.22) return { spine: 1 };
    if (y <= 1.32) { const t = sstep(1.22, 1.32, y); return { spine: 1 - t, chest: t }; }
    if (y <= 1.49) return { chest: 1 };
    return { chest: 0.45, neck: 0.55 };
  };
  //        y      rx                 zf                                zb                  z     n
  const K = [
    [0.845, 0.1 * H,              0.06,                              0.07,               0,     2],
    [0.88,  0.152 * H,            0.086 + bel * 0.01,                0.1 * H,            -0.004, 2.2],
    [0.95,  0.172 * H,            0.096 + bel * 0.04,                0.116 * H,          -0.01, 2.3],
    [1.02,  0.163 * lerp(H, W, .5), 0.096 + bel * 0.085,             0.102 * H,          -0.006, 2.3],
    [1.1,   0.151 * W,            0.097 + bel * 0.11,                0.09 * W,           0,     2.3],
    [1.18,  0.156 * lerp(W, C, .5), 0.103 + bel * 0.085,             0.09 * C,           0.002, 2.4],
    [1.26,  0.171 * C,            0.117 * C + bel * 0.035,           0.096 * C,          0.004, 2.5],
    [1.33,  0.184 * C,            0.121 * C,                         0.102 * C,          0.0,   2.6],
    [1.4,   0.197 * S,            0.106 * C,                         0.1 * C,            -0.006, 2.7],
    [1.455, 0.182 * S,            0.084 * lerp(1, C, .5),            0.09 * C,           -0.012, 2.5],
    [1.49,  0.125 * lerp(1, S, .6), 0.064 * N,                       0.07 * N,           -0.012, 2.2],
    [1.515, 0.068 * N,            0.055 * N,                         0.06 * N,           -0.008, 2],
  ];
  const keys = K.map(([y, rx, zf, zb, z, n]) => ({
    p: V(0, y, z), rx, zf, zb, n, v: (y - R.y0) / R.H, w: wAt(y),
  }));
  B.loft(smooth(keys, 3), {
    region: 'torso', seg: 28, cap0: true, cap1: true,
    weightFn: (p, w) => {
      const ax = Math.abs(p.x), side = p.x > 0 ? 'L' : 'R';
      const o = { ...w };
      // shoulders follow the arm a little when it lifts
      const ts = sstep(0.11, sw, ax) * sstep(1.3, 1.42, p.y) * 0.5;
      // buttocks/thighs follow the leg swing
      const tl = sstep(0.95, 0.85, p.y) * sstep(0.015, 0.1, ax) * 0.45;
      const k = 1 - ts - tl;
      for (const key in o) o[key] *= k;
      if (ts > 0) o['upperArm' + side] = (o['upperArm' + side] || 0) + ts;
      if (tl > 0) o['upperLeg' + side] = (o['upperLeg' + side] || 0) + tl;
      return o;
    },
  });
}

function neck(B, b) {
  const R = REGIONS.neck, N = b.neck;
  const keys = [
    { p: V(0, 1.43, -0.012), rx: 0.07 * N, zf: 0.066 * N, zb: 0.068 * N, w: { chest: 0.7, neck: 0.3 } },
    { p: V(0, 1.5, -0.006), rx: 0.064 * N, zf: 0.06 * N, zb: 0.064 * N, w: { neck: 1 } },
    { p: V(0, 1.58, 0.002), rx: 0.058 * N, zf: 0.054 * N, zb: 0.06 * N, w: { neck: 0.7, head: 0.3 } },
    { p: V(0, 1.66, 0.006), rx: 0.05 * N, zf: 0.046 * N, zb: 0.054 * N, w: { head: 1 } },
  ].map((k) => ({ ...k, v: (k.p.y - R.y0) / R.H }));
  B.loft(smooth(keys, 2), { region: 'neck', seg: 14 });
}

function head(B, b) {
  const R = REGIONS.head, hs = b.head;
  const T = b.headT || 1;                          // the cartoon's bigger head grows up from the neck
  const C = V(0, 1.6 - (b.toon ? TOON_HEAD_DROP : 0) + (HEAD_C.y - 1.6) * T, HEAD_C.z * T);
  const toonShape = (d) => {
    // rubber hose: a round ball, a soft muzzle pushed forward, a button nose
    let x = d.x * 0.084, y = d.y * 0.1, z = d.z * 0.09;
    const front = sstep(0.1, 0.8, d.z);
    if (d.y < 0) x *= 1 - 0.1 * Math.pow(-d.y, 1.5);
    z += 0.03 * front * gauss(d.y + 0.36, 0.26) * gauss(d.x, 0.42);   // the muzzle
    x *= 1 + 0.08 * front * gauss(d.y + 0.4, 0.3);                    // cheeks
    z += 0.018 * front * gauss(d.x, 0.13) * gauss(d.y + 0.08, 0.12);  // the button nose
    return V(x, y, z).multiplyScalar(hs);
  };
  const realShape = (d) => {
    let x = d.x * 0.083, y = d.y * 0.108, z = d.z * 0.097;
    const front = sstep(0.1, 0.75, d.z);
    if (d.y < 0) {                                  // jaw + chin taper
      const k = -d.y;
      x *= 1 - 0.3 * Math.pow(k, 1.4);
      z *= 1 - 0.13 * Math.pow(k, 1.6) * (d.z < 0 ? 1.6 : 0.35);
    }
    if (d.z < 0) z *= 1 + 0.07 * sstep(-0.3, 0.4, d.y);          // fuller back of skull
    if (d.y > 0.55) y *= 1 - 0.04 * sstep(0.55, 1, d.y);          // slightly flat crown
    z -= 0.008 * front * (1 - Math.abs(d.y));                     // face plane
    z += 0.009 * front * gauss(d.y - 0.2, 0.07) * gauss(d.x, 0.5); // brow ridge
    const ex = Math.abs(d.x) - 0.36;
    z -= 0.017 * front * gauss(ex, 0.13) * gauss(d.y - 0.07, 0.11); // eye sockets
    const nose = gauss(d.x, 0.1) * sstep(0.2, -0.05, d.y) * sstep(-0.45, -0.28, d.y);
    z += 0.027 * front * nose * (0.4 + 0.6 * sstep(0.15, -0.3, d.y));
    x *= 1 - 0.25 * front * nose * gauss(d.x, 0.1);
    z += 0.006 * front * gauss(Math.abs(d.x) - 0.55, 0.14) * gauss(d.y + 0.08, 0.1); // cheekbones
    z -= 0.006 * front * gauss(d.y + 0.52, 0.035) * gauss(d.x, 0.35);               // mouth line
    z += 0.004 * front * gauss(d.y + 0.45, 0.06) * gauss(d.x, 0.3);                 // lips
    z += 0.012 * front * gauss(d.y + 0.8, 0.12) * gauss(d.x, 0.35);                 // chin
    return V(x, y, z).multiplyScalar(hs);
  };
  const shape = b.toon ? toonShape : realShape;
  const uvFn = (p) => {
    const th = Math.atan2(p.x - C.x, p.z - C.z);
    const y = HEAD_C.y + (p.y - C.y) / T;            // paint lands where it would on a normal head
    return Builder.uvOf('head', (th + Math.PI) / (Math.PI * 2), Math.min(1, Math.max(0, (y - R.y0) / R.H)));
  };
  const headW = { head: 1 };
  B.sphereish(C, 24, 32, shape, { uvFn, w: headW });
  if (b.toon) return;                               // cartoon eyes are props; no ears

  // ears
  for (const sx of [1, -1]) {
    const E = C.clone().add(V(0.082 * sx * hs, -0.004, -0.01));
    B.sphereish(E, 6, 10, (d) => {
      const v = V(d.x * 0.011, d.y * 0.027, d.z * 0.019).multiplyScalar(hs);
      v.x += Math.abs(d.z) < 0.5 ? 0.004 * sx * hs : 0;
      return v;
    }, { uvFn, w: headW });
  }
  // eyeballs (material 1 — glowing)
  for (const sx of [1, -1]) {
    const E = C.clone().add(V(0.03 * sx * hs, 0.0076 * hs, 0.07 * hs));
    B.sphereish(E, 6, 8, (d) => d.clone().multiplyScalar(0.0125 * hs), { w: headW, mat: 1 });
  }
}

function arm(B, b, J, side) {
  const sx = side === 'L' ? 1 : -1;
  const R = REGIONS['arm' + side];
  const A = J['upperArm' + side], E = J['foreArm' + side], Wr = J['hand' + side];
  const k = b.arms, sl = b.sleeves;
  const tube = 0.056 * k;
  const loose = (r, amt = 1) => lerp(r, Math.max(r, tube * (0.85 + 0.15 * amt)), sl * amt);
  const ua = 'upperArm' + side, fa = 'foreArm' + side, hd = 'hand' + side;
  const at = (P, dy = 0) => P.clone().add(V(0, dy, 0));
  const K = [
    { p: at(A, 0.06).add(V(-0.02 * sx, 0, 0)), rx: 0.05 * k, zf: 0.05 * k, zb: 0.05 * k, w: { chest: 0.5, [ua]: 0.5 } },
    { p: at(A, 0.01), rx: 0.059 * k, zf: 0.057 * k, zb: 0.057 * k, w: { [ua]: 1 } },
    { p: A.clone().lerp(E, 0.35), rx: loose(0.051 * k), zf: loose(0.053 * k), zb: loose(0.05 * k), w: { [ua]: 1 } },
    { p: A.clone().lerp(E, 0.72), rx: loose(0.045 * k), zf: loose(0.046 * k), zb: loose(0.044 * k), w: { [ua]: 1 } },
    { p: E.clone(), rx: loose(0.041 * k), zf: loose(0.042 * k), zb: loose(0.041 * k), w: { [ua]: 0.5, [fa]: 0.5 } },
    { p: E.clone().lerp(Wr, 0.25), rx: loose(0.044 * k), zf: loose(0.043 * k), zb: loose(0.042 * k), w: { [fa]: 1 } },
    { p: E.clone().lerp(Wr, 0.62), rx: loose(0.037 * k, 0.8), zf: loose(0.035 * k, 0.8), zb: loose(0.034 * k, 0.8), w: { [fa]: 1 } },
    { p: at(Wr, 0.03), rx: loose(0.03 * k, 0.6), zf: loose(0.027 * k, 0.6), zb: loose(0.027 * k, 0.6), w: { [fa]: 0.85, [hd]: 0.15 } },
    { p: at(Wr, 0.0), rx: 0.027 * k, zf: 0.024 * k, zb: 0.024 * k, w: { [fa]: 0.4, [hd]: 0.6 } },
  ].map((r) => ({ ...r, v: Math.min(1, Math.max(0, (r.p.y - R.y0) / R.H)) }));
  B.loft(smooth(K, 2), { region: 'arm' + side, seg: 16, cap0: true, cap1: true });
}

function hand(B, b, J, side) {
  const sx = side === 'L' ? 1 : -1;
  const Hj = J['hand' + side];
  const hd = 'hand' + side;
  const k = Math.pow(b.arms, 0.6);
  const w = { [hd]: 1 };
  // palm: thin in X (toward the thigh), wide in Z
  const palm = [
    { p: Hj.clone().add(V(0, 0.012, 0)), rx: 0.021 * k, zf: 0.028 * k, zb: 0.028 * k, v: 1, w: { [hd]: 0.7, ['foreArm' + side]: 0.3 } },
    { p: Hj.clone().add(V(0.002 * sx, -0.012, 0.002)), rx: 0.018 * k, zf: 0.037 * k, zb: 0.035 * k, v: 0.85, w, n: 2.4 },
    { p: Hj.clone().add(V(0.003 * sx, -0.042, 0.004)), rx: 0.017 * k, zf: 0.043 * k, zb: 0.04 * k, v: 0.65, w, n: 2.6 },
    { p: Hj.clone().add(V(0.002 * sx, -0.07, 0.004)), rx: 0.016 * k, zf: 0.043 * k, zb: 0.04 * k, v: 0.5, w, n: 2.6 },
    { p: Hj.clone().add(V(0.0, -0.08, 0.004)), rx: 0.012 * k, zf: 0.038 * k, zb: 0.035 * k, v: 0.45, w, n: 2.4 },
  ];
  B.loft(palm, { region: 'hands', seg: 14, cap1: true, s0: 0, s1: 1 });

  // four clawed fingers curling toward the palm (palm faces -X*sx)
  const fingers = [[0.03, 1.0], [0.011, 1.1], [-0.008, 1.03], [-0.026, 0.82]];
  fingers.forEach(([fz, len], fi) => {
    const curl = 0.42 + fi * 0.05;
    const segs = [0.042, 0.028, 0.022].map((l) => l * len * k);
    let P = Hj.clone().add(V(0.002 * sx, -0.072, fz * k + 0.004));
    let a = 0;
    const rings = [];
    const rad = [0.0095, 0.0088, 0.0079, 0.0064].map((r) => r * k);
    for (let i = 0; i <= 3; i++) {
      const back = V(sx * Math.cos(a), -Math.sin(a), 0);   // nail side, turns as it curls
      rings.push({ p: P.clone(), rx: rad[i] * 0.95, zf: rad[i], zb: rad[i], v: 0.42 - i * 0.13, w, f: back });
      if (i < 3) {
        a += curl * (i === 0 ? 0.6 : 1);
        const dir = V(-sx * Math.sin(a), -Math.cos(a), 0);
        P = P.clone().addScaledVector(dir, segs[i]);
      }
    }
    B.loft(rings, { region: 'hands', seg: 8, cap1: true, s0: fi / 5, s1: (fi + 1) / 5 });
  });
  // thumb: forward and in, off the palm's front edge
  const T0 = Hj.clone().add(V(-0.008 * sx, -0.022, 0.034 * k));
  const td = V(-0.35 * sx, -0.75, 0.55).normalize();
  const T1 = T0.clone().addScaledVector(td, 0.035 * k);
  const td2 = V(-0.55 * sx, -0.7, 0.35).normalize();
  const T2 = T1.clone().addScaledVector(td2, 0.028 * k);
  const fT = V(sx * 0.6, 0.2, 0.6).normalize();
  B.loft([
    { p: T0, rx: 0.012 * k, zf: 0.012 * k, zb: 0.012 * k, v: 0.42, w, f: fT },
    { p: T1, rx: 0.0105 * k, zf: 0.0105 * k, zb: 0.0105 * k, v: 0.25, w, f: fT },
    { p: T2, rx: 0.0082 * k, zf: 0.0082 * k, zb: 0.0082 * k, v: 0.05, w, f: fT },
  ], { region: 'hands', seg: 8, cap1: true, s0: 0.8, s1: 1 });
}

function leg(B, b, J, side) {
  const sx = side === 'L' ? 1 : -1;
  const R = REGIONS['leg' + side];
  const Hp = J['upperLeg' + side], K = J['lowerLeg' + side], A = J['foot' + side];
  const k = b.legs, pn = b.pants;
  const ul = 'upperLeg' + side, ll = 'lowerLeg' + side, ft = 'foot' + side;
  // trouser tube radius by height — baggy legs blend toward this
  const tubeAt = (y) => (y > 0.5 ? lerp(0.074, 0.094, sstep(0.5, 0.92, y)) : lerp(0.066, 0.074, sstep(0.1, 0.5, y))) * k;
  const at = (y) => {
    const p = y >= K.y ? Hp.clone().lerp(K, (Hp.y - y) / (Hp.y - K.y)) : K.clone().lerp(A, (K.y - y) / (K.y - A.y));
    return p;
  };
  const shape = (y, rx, zf, zb) => {
    const t = tubeAt(y);
    return { rx: lerp(rx * k, t, pn), zf: lerp(zf * k, t, pn), zb: lerp(zb * k, t * 1.02, pn) };
  };
  const K0 = [
    [1.02, 0.086, 0.086, 0.09, { hips: 1 }],
    [0.91, 0.09, 0.092, 0.1, { [ul]: 0.75, hips: 0.25 }],
    [0.8, 0.083, 0.086, 0.088, { [ul]: 1 }],
    [0.68, 0.071, 0.071, 0.074, { [ul]: 1 }],
    [0.57, 0.061, 0.061, 0.063, { [ul]: 0.85, [ll]: 0.15 }],
    [0.5, 0.057, 0.059, 0.058, { [ul]: 0.5, [ll]: 0.5 }],
    [0.44, 0.056, 0.053, 0.062, { [ll]: 1 }],
    [0.34, 0.055, 0.05, 0.067, { [ll]: 1 }],
    [0.22, 0.045, 0.045, 0.047, { [ll]: 1 }],
    [0.13, 0.037, 0.037, 0.037, { [ll]: 0.9, [ft]: 0.1 }],
    [0.075, 0.036, 0.037, 0.037, { [ll]: 0.5, [ft]: 0.5 }],
  ];
  const keys = K0.map(([y, rx, zf, zb, w]) => ({
    p: y > Hp.y ? V(Hp.x, y, 0) : at(y), ...shape(y, rx, zf, zb), n: 2,
    v: Math.min(1, Math.max(0, (y - R.y0) / R.H)), w,
  }));
  B.loft(smooth(keys, 2), { region: 'leg' + side, seg: 16, cap1: true });
}

function shoe(B, b, J, side) {
  const F = J['foot' + side];
  const ft = 'foot' + side;
  const k = Math.pow(b.legs, 0.5);
  const S = [
    // z      y      rx     top    bottom
    [-0.078, 0.052, 0.03, 0.03, 0.048],
    [-0.062, 0.058, 0.039, 0.048, 0.056],
    [-0.02, 0.06, 0.044, 0.056, 0.06],
    [0.03, 0.05, 0.048, 0.049, 0.05],
    [0.08, 0.04, 0.05, 0.036, 0.04],
    [0.128, 0.033, 0.047, 0.026, 0.033],
    [0.162, 0.028, 0.037, 0.02, 0.028],
    [0.178, 0.026, 0.021, 0.013, 0.026],
  ];
  const rings = S.map(([z, y, rx, top, bot], i) => ({
    p: V(F.x, y * k, F.z + z * k), rx: rx * k, zf: top * k, zb: bot * k, n: 2.2,
    v: i / (S.length - 1), w: i === 0 ? { [ft]: 0.7, ['lowerLeg' + side]: 0.3 } : { [ft]: 1 },
    f: V(0, 1, 0),
  }));
  B.loft(smooth(rings, 1), { region: 'shoes', seg: 22, cap0: true, cap1: true, clampY: 0.004 });
}

function coat(B, b) {
  const c = b.coat;
  const top = 1.03, len = c.len, bottom = top - len;
  const H = b.hips, bel = b.belly;
  const th0 = c.tails ? Math.PI * 0.52 : (c.open ? Math.PI * 0.1 : -Math.PI);
  const th1 = c.tails ? Math.PI * 1.48 : (c.open ? Math.PI * 1.9 : Math.PI);
  const rings = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    const y = top - len * t;
    rings.push({
      p: V(0, y, -0.008),
      rx: (0.176 * H + 0.012 + 0.045 * t) * (c.flare || 1),
      zf: 0.104 + bel * 0.09 + 0.02 * t,
      zb: 0.122 * H + 0.03 * t,
      n: 2.2, v: 1 - t, w: { hips: 1 },
    });
  }
  B.loft(rings, {
    region: 'coat', seg: 26, th0, th1, mat: 2,
    weightFn: (p) => {
      const t = sstep(top - 0.05, bottom, p.y);
      const wl = sstep(-0.06, 0.06, p.x);
      return { hips: 1 - t, upperLegL: t * wl * 0.8, upperLegR: t * (1 - wl) * 0.8, spine: 0 };
    },
  });
}

// ------------------------------ rubber hose ---------------------------------
/**
 * 1930s proportions, kept tasteful: a bigger head, slimmer rubber-hose limbs,
 * a little bean of a belly — cartoony without going lumpy
 */
function toonBody(b) {
  return {
    ...b, toon: true,
    headT: 1.5, head: b.head * 1.5,
    arms: b.arms * 0.72, legs: b.legs * 0.8,
    sleeves: Math.min(b.sleeves, 0.12), pants: Math.min(b.pants, 0.18),
    shoulders: b.shoulders * 0.9, chest: b.chest * 0.96, waist: b.waist * 1.02,
    hips: b.hips * 1.04, belly: b.belly + 0.1, neck: b.neck * 0.85,
  };
}

/**
 * rubber hose sits a little lower to the ground: everything below the neck is
 * squashed to 82% of its height and the (bigger, rounder) head set straight
 * down on top — after building, so the painted clothes still map where they should
 */
const SQUAT = 0.82, SQUAT_Y = 1.5;
const squatY = (y) => (y <= SQUAT_Y ? y * SQUAT : SQUAT_Y * SQUAT + (y - SQUAT_Y));
function squatBody(geo, J) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setY(i, squatY(y));
    // normals follow the inverse-transpose of the squash (seam averaging kept)
    if (y <= SQUAT_Y) {
      const nx = n.getX(i), ny = n.getY(i) / SQUAT, nz = n.getZ(i);
      const l = Math.hypot(nx, ny, nz) || 1;
      n.setXYZ(i, nx / l, ny / l, nz / l);
    }
  }
  p.needsUpdate = true;
  n.needsUpdate = true;
  geo.computeBoundingSphere();
  for (const k of Object.keys(J)) J[k].y = squatY(J[k].y);
}

/** a puffy white cartoon glove: rolled cuff, a round mitt, three fat fingers and a thumb */
function toonHand(B, b, J, side) {
  const sx = side === 'L' ? 1 : -1;
  const Hj = J['hand' + side];
  const hd = 'hand' + side, fa = 'foreArm' + side;
  const w = { [hd]: 1 };
  const k = Math.max(0.9, Math.pow(b.arms / 0.72, 0.3));      // big gloves, even on noodle arms
  B.loft([
    { p: Hj.clone().add(V(0, 0.04, 0)), rx: 0.02 * k, zf: 0.02 * k, zb: 0.02 * k, v: 1, w: { [hd]: 0.4, [fa]: 0.6 } },
    { p: Hj.clone().add(V(0, 0.018, 0)), rx: 0.043 * k, zf: 0.043 * k, zb: 0.043 * k, v: 0.95, w },
    { p: Hj.clone().add(V(0, 0.0, 0)), rx: 0.048 * k, zf: 0.048 * k, zb: 0.048 * k, v: 0.9, w },
    { p: Hj.clone().add(V(0, -0.014, 0)), rx: 0.028 * k, zf: 0.03 * k, zb: 0.03 * k, v: 0.85, w },
  ], { region: 'hands', seg: 22, cap1: true, s0: 0, s1: 0.3 });
  const P = Hj.clone().add(V(0.004 * sx, -0.058 * k, 0.006));
  const uv = Builder.uvOf('hands', 0.62, 0.6);
  B.sphereish(P, 14, 20, (d) => V(d.x * 0.034 * k, d.y * 0.046 * k, d.z * 0.047 * k), { w, uvFn: () => uv });
  [[0.027, 0.92], [0.0, 1.05], [-0.027, 0.9]].forEach(([fz, len], fi) => {
    const rings = [];
    let Q = P.clone().add(V(0, -0.026 * k, fz * k));
    let a = 0;
    for (let i = 0; i <= 3; i++) {
      const rad = (i === 3 ? 0.012 : 0.0155) * k;
      rings.push({ p: Q.clone(), rx: rad, zf: rad, zb: rad, v: 0.5 - i * 0.1, w, f: V(sx * Math.cos(a), -Math.sin(a), 0) });
      a += 0.45;
      Q = Q.clone().addScaledVector(V(-sx * Math.sin(a), -Math.cos(a), 0), 0.017 * k * len);
    }
    B.loft(smooth(rings, 1), { region: 'hands', seg: 12, cap1: true, s0: 0.35 + fi * 0.2, s1: 0.5 + fi * 0.2 });
  });
  const T0 = P.clone().add(V(-0.012 * sx, 0.004, 0.036 * k));
  const T1 = T0.clone().add(V(-0.012 * sx, -0.016 * k, 0.014 * k));
  const T2 = T1.clone().add(V(-0.006 * sx, -0.016 * k, 0.004 * k));
  B.loft([
    { p: T0, rx: 0.015 * k, zf: 0.015 * k, zb: 0.015 * k, v: 0.4, w },
    { p: T1, rx: 0.014 * k, zf: 0.014 * k, zb: 0.014 * k, v: 0.25, w },
    { p: T2, rx: 0.011 * k, zf: 0.011 * k, zb: 0.011 * k, v: 0.1, w },
  ], { region: 'hands', seg: 12, cap1: true, s0: 0.9, s1: 1 });
}

/** big round cartoon shoes */
function toonShoe(B, b, J, side) {
  const F = J['foot' + side];
  const ft = 'foot' + side;
  const k = 1.3 * Math.pow(b.legs / 0.8, 0.25);
  const S = [
    [-0.075, 0.05, 0.034, 0.03, 0.045],
    [-0.06, 0.056, 0.045, 0.05, 0.052],
    [-0.02, 0.058, 0.05, 0.058, 0.056],
    [0.035, 0.052, 0.056, 0.058, 0.05],
    [0.085, 0.048, 0.062, 0.056, 0.046],
    [0.13, 0.045, 0.06, 0.05, 0.043],
    [0.162, 0.042, 0.048, 0.038, 0.04],
    [0.178, 0.04, 0.026, 0.02, 0.03],
  ];
  const rings = S.map(([z, y, rx, top, bot], i) => ({
    p: V(F.x, y * k * 0.8, F.z + z * k), rx: rx * k * 0.85, zf: top * k * 0.8, zb: bot * k * 0.8, n: 2,
    v: i / (S.length - 1), w: i === 0 ? { [ft]: 0.7, ['lowerLeg' + side]: 0.3 } : { [ft]: 1 },
    f: V(0, 1, 0),
  }));
  B.loft(smooth(rings, 1), { region: 'shoes', seg: 16, cap0: true, cap1: true, clampY: 0.004 });
}

// ---------------------------------- API --------------------------------------
const _bodyCache = new Map();

/** shared body geometry + bind-pose joints for a build (cached) */
export function bodyFor(buildName = 'standard', extra = {}) {
  const key = buildName + JSON.stringify(extra);
  if (_bodyCache.has(key)) return _bodyCache.get(key);
  let b = { ...DEFAULTS, ...(BUILDS[buildName] || {}), ...extra };
  if (STYLE.cartoon) b = toonBody(b);
  const J = jointsFor(b);
  const B = new Builder();
  torso(B, b, J);
  neck(B, b);
  head(B, b);
  for (const s of ['L', 'R']) {
    arm(B, b, J, s);
    if (b.toon) toonHand(B, b, J, s); else hand(B, b, J, s);
    leg(B, b, J, s);
    if (b.toon) toonShoe(B, b, J, s); else shoe(B, b, J, s);
  }
  if (b.coat) coat(B, b);
  const geometry = B.build();
  if (b.toon) squatBody(geometry, J);
  // mapY: where a height on the full-size figure ended up on this one (hitboxes use it)
  const mapY = b.toon ? squatY : (y) => y;
  const T = b.headT || 1;
  const headC = V(0, mapY(1.6 - (b.toon ? TOON_HEAD_DROP : 0) + (HEAD_C.y - 1.6) * T), HEAD_C.z * T);
  const out = { geometry, joints: J, build: b, mapY, headC };
  _bodyCache.set(key, out);
  return out;
}
