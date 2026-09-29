// paint.js — the atlas painter. Draws into the character UV atlas in real
// surface units (meters) so a 2cm button is 2cm on the model no matter which
// body part it lands on. Paints three layers in lockstep:
//   color  (sRGB albedo)
//   orm    (G = roughness, B = metalness) — leather shines, cloth doesn't
//   glow   (emissive, only allocated when something glows)
// finish() turns them into textures (+ a bump map derived from the color).

import * as THREE from 'three';
import { ATLAS, REGIONS } from './rig.js';
import { makeCanvas, toTexture, noiseCanvas, tintedNoise, rng, bumpFrom, Tiles } from '../gfx/texkit.js';

export const MAT = {
  cloth:   { r: 0.93, m: 0 },
  wool:    { r: 0.97, m: 0 },
  velvet:  { r: 1.0, m: 0 },
  silk:    { r: 0.5, m: 0 },
  satin:   { r: 0.38, m: 0 },
  skin:    { r: 0.62, m: 0 },
  wet:     { r: 0.22, m: 0 },
  leather: { r: 0.36, m: 0 },
  patent:  { r: 0.16, m: 0 },
  plastic: { r: 0.4, m: 0 },
  gold:    { r: 0.28, m: 1 },
  silver:  { r: 0.3, m: 1 },
  sequin:  { r: 0.3, m: 0.85 },
  hair:    { r: 0.7, m: 0 },
  teeth:   { r: 0.45, m: 0 },
};

/** lighten (+) / darken (-) a css color */
export function shade(color, amt) {
  const c = new THREE.Color(color);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt)));
  return '#' + c.getHexString();
}
export function mix(a, b, t) {
  return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}
const ormStyle = (m) => `rgb(255,${Math.round(m.r * 255)},${Math.round((m.m || 0) * 255)})`;

export class Painter {
  constructor(seed = 1, quality = 1) {
    this.size = Math.round(ATLAS * quality);
    this.k = this.size / ATLAS;
    this.col = makeCanvas(this.size);
    this.c = this.col.getContext('2d');
    this.ormCv = makeCanvas(this.size / 2);
    this.o = this.ormCv.getContext('2d');
    this.o.fillStyle = ormStyle(MAT.cloth);
    this.o.fillRect(0, 0, this.size / 2, this.size / 2);
    this.glowCv = null;
    this.g = null;
    this.rand = rng(seed);
    this.seed = seed;
    this.reg = null;
  }

  r(a = 0, b = 1) { return a + this.rand() * (b - a); }
  pick(arr) { return arr[Math.floor(this.rand() * arr.length)]; }

  _ctxs() { return this.g ? [[this.c, this.k], [this.o, this.k / 2], [this.g, this.k / 2]] : [[this.c, this.k], [this.o, this.k / 2]]; }

  _enableGlow() {
    if (this.g) return;
    this.glowCv = makeCanvas(this.size / 2);
    this.g = this.glowCv.getContext('2d');
    this.g.fillStyle = '#000';
    this.g.fillRect(0, 0, this.size / 2, this.size / 2);
    if (this.reg) this._apply(this.g, this.k / 2);
  }

  _apply(ctx, k) {
    const R = this.reg;
    ctx.restore(); ctx.save();
    const sx = (R.w * k) / R.W, sy = (R.h * k) / R.H;
    ctx.setTransform(sx, 0, 0, -sy, R.x * k, (R.y + R.h) * k);
    ctx.beginPath();
    ctx.rect(0, 0, R.W, R.H);
    ctx.clip();
  }

  /** select a body region; subsequent drawing is in that region's meters */
  use(name) {
    this.reg = REGIONS[name];
    this.regName = name;
    this.W = this.reg.W; this.H = this.reg.H;
    for (const [ctx, k] of this._ctxs()) {
      if (!ctx.__saved) { ctx.save(); ctx.__saved = true; }
      this._apply(ctx, k);
    }
    return this;
  }

  // ---------------- primitive fills (color + optional material) -------------
  _draw(buildPath, color, mat, { stroke = 0, alpha = 1, rule = 'nonzero', glow = null, op = null } = {}) {
    const jobs = [[this.c, color]];
    if (mat) jobs.push([this.o, ormStyle(mat)]);
    if (glow) { this._enableGlow(); jobs.push([this.g, glow]); }
    for (const [ctx, style] of jobs) {
      if (!style) continue;
      ctx.globalAlpha = ctx === this.c ? alpha : Math.min(1, alpha * 1.2);
      if (op && ctx === this.c) ctx.globalCompositeOperation = op;
      ctx.beginPath();
      buildPath(ctx);
      if (stroke) {
        ctx.strokeStyle = style; ctx.lineWidth = stroke; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.stroke();
      } else {
        ctx.fillStyle = style;
        ctx.fill(rule);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  fill(color, mat) { return this.rect(-0.01, -0.01, this.W + 0.02, this.H + 0.02, color, mat); }
  rect(x, y, w, h, color, mat, o) { this._draw((c) => c.rect(x, y, w, h), color, mat, o); return this; }
  poly(pts, color, mat, o) {
    this._draw((c) => { c.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) c.lineTo(p[0], p[1]); c.closePath(); }, color, mat, o);
    return this;
  }
  ellipse(x, y, rx, ry, color, mat, o = {}) {
    this._draw((c) => c.ellipse(x, y, rx, ry, o.rot || 0, 0, Math.PI * 2), color, mat, o);
    return this;
  }
  circle(x, y, r, color, mat, o) { return this.ellipse(x, y, r, r, color, mat, o); }
  line(pts, width, color, mat, o = {}) {
    this._draw((c) => { c.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) c.lineTo(p[0], p[1]); }, color, mat, { ...o, stroke: width });
    return this;
  }
  curve(pts, width, color, mat, o = {}) {   // smooth polyline through points
    this._draw((c) => {
      c.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
        c.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      const L = pts[pts.length - 1];
      c.lineTo(L[0], L[1]);
    }, color, mat, { ...o, stroke: width });
    return this;
  }
  path(fn, color, mat, o) { this._draw(fn, color, mat, o); return this; }

  /** soft radial gradient spot (color layer only unless mat given) */
  spot(x, y, r, color, alpha = 1, op = null, sy = 1) {
    const c = this.c;
    c.save();
    c.translate(x, y); c.scale(1, sy);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
    const col = new THREE.Color(color);
    const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
    g.addColorStop(0, `rgba(${rgb},${alpha})`);
    g.addColorStop(0.55, `rgba(${rgb},${alpha * 0.45})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    if (op) c.globalCompositeOperation = op;
    c.fillStyle = g;
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
    c.restore();
    return this;
  }

  /** run fn with every layer clipped to a polygon (don't enable glow inside) */
  clipTo(pts, fn) {
    const ctxs = this._ctxs();
    for (const [ctx] of ctxs) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.closePath();
      ctx.clip();
    }
    fn();
    for (const [ctx] of ctxs) ctx.restore();
    return this;
  }

  /** glow-only spot (emissive layer) */
  glowSpot(x, y, r, color, alpha = 1) {
    this._enableGlow();
    const c = this.g;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    const col = new THREE.Color(color);
    const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
    g.addColorStop(0, `rgba(${rgb},${alpha})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    return this;
  }

  /** vertical gradient band across the region (e.g. grime rising from the hem) */
  vgrad(y0, y1, color, a0, a1, op = null) {
    const c = this.c;
    const col = new THREE.Color(color);
    const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
    const g = c.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, `rgba(${rgb},${a0})`);
    g.addColorStop(1, `rgba(${rgb},${a1})`);
    if (op) c.globalCompositeOperation = op;
    c.fillStyle = g;
    c.fillRect(-0.01, Math.min(y0, y1), this.W + 0.02, Math.abs(y1 - y0));
    c.globalCompositeOperation = 'source-over';
    return this;
  }

  /** horizontal gradient (side shading) */
  hgrad(x0, x1, color, a0, a1, op = null) {
    const c = this.c;
    const col = new THREE.Color(color);
    const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
    const g = c.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, `rgba(${rgb},${a0})`);
    g.addColorStop(1, `rgba(${rgb},${a1})`);
    if (op) c.globalCompositeOperation = op;
    c.fillStyle = g;
    c.fillRect(Math.min(x0, x1), -0.01, Math.abs(x1 - x0), this.H + 0.02);
    c.globalCompositeOperation = 'source-over';
    return this;
  }

  // --------------- pixel-space overlays (noise / patterns) ------------------
  _pixelFill(ctx, k, style, alpha, op) {
    const R = this.reg;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    if (op) ctx.globalCompositeOperation = op;
    ctx.fillStyle = style;
    // pattern offset varies per call so repeats don't line up
    const ox = Math.floor(this.rand() * 256), oy = Math.floor(this.rand() * 256);
    ctx.translate(-ox, -oy);
    ctx.fillRect(R.x * k + ox, R.y * k + oy, R.w * k, R.h * k);
    ctx.restore();
  }

  /** fractal noise overlay; scale = cells across a 256 tile */
  noise(alpha = 0.2, op = 'overlay', scale = 6, octaves = 4, seed = 0) {
    const n = noiseCanvas(256, scale, octaves, (this.seed * 13 + seed) % 97 + 1, 1.4);
    this._pixelFill(this.c, this.k, this.c.createPattern(n, 'repeat'), alpha, op);
    return this;
  }

  /** colored blotches: noise-shaped patches of `color` */
  mottle(color, alpha = 0.4, scale = 3, seed = 0, contrast = 2.2) {
    const n = tintedNoise(256, scale, 4, (this.seed * 7 + seed) % 89 + 3, color, 1, false, contrast);
    this._pixelFill(this.c, this.k, this.c.createPattern(n, 'repeat'), alpha, null);
    return this;
  }

  pattern(tile, alpha = 1, op = null) {
    this._pixelFill(this.c, this.k, this.c.createPattern(tile, 'repeat'), alpha, op);
    return this;
  }

  /** roughness override across the whole current region */
  material(mat) {
    const R = this.reg, k = this.k / 2;
    this.o.save();
    this.o.setTransform(1, 0, 0, 1, 0, 0);
    this.o.fillStyle = ormStyle(mat);
    this.o.fillRect(R.x * k, R.y * k, R.w * k, R.h * k);
    this.o.restore();
    return this;
  }

  /** text in meters (drawn upright) */
  text(str, x, y, size, color, font = 'bold', align = 'center', glow = null) {
    const R = this.reg;
    for (const [ctx, k, style] of [[this.c, this.k, color], ...(glow ? [[this._glowCtx(), this.k / 2, glow]] : [])]) {
      const sx = (R.w * k) / R.W, sy = (R.h * k) / R.H;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = style;
      ctx.font = `${font} ${Math.max(4, size * sy)}px Georgia, serif`;
      ctx.textAlign = align; ctx.textBaseline = 'middle';
      ctx.fillText(str, R.x * k + x * sx, (R.y + R.h) * k - y * sy);
      ctx.restore();
    }
    return this;
  }
  _glowCtx() { this._enableGlow(); return this.g; }

  // ---------------------------- stitched details ----------------------------
  seam(pts, color, width = 0.0022) {
    this.line(pts, width, shade(color, -0.12), null, { alpha: 0.8 });
    const off = pts.map(([x, y]) => [x + 0.0018, y + 0.0012]);
    this.line(off, width * 0.5, shade(color, 0.12), null, { alpha: 0.35 });
    return this;
  }

  button(x, y, r, color = '#e9e3d2', mat = MAT.plastic) {
    this.circle(x, y + r * 0.15, r * 1.15, 'rgba(0,0,0,0.35)');
    this.circle(x, y, r, color, mat);
    this.circle(x, y, r * 0.7, shade(color, -0.08));
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      this.circle(x + dx * r * 0.28, y + dy * r * 0.28, r * 0.13, shade(color, -0.4));
    }
    this.circle(x - r * 0.35, y + r * 0.35, r * 0.25, 'rgba(255,255,255,0.4)');
    return this;
  }

  // --------------------------------- gore -----------------------------------
  /** irregular blob path around (x,y) */
  blob(x, y, r, jag = 0.35, pts = 12, sy = 1) {
    const out = [];
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const rr = r * (1 - jag / 2 + this.rand() * jag);
      out.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * sy]);
    }
    return out;
  }

  splat(x, y, size, color = '#4a0507', alpha = 0.85, drips = true) {
    const dark = shade(color, -0.08);
    this.poly(this.blob(x, y, size, 0.6, 14), color, MAT.wet, { alpha });
    this.poly(this.blob(x + size * 0.1, y + size * 0.1, size * 0.55, 0.5, 10), dark, null, { alpha: alpha * 0.8 });
    const n = 5 + Math.floor(this.rand() * 8);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2, d = size * (1.1 + this.rand() * 1.6);
      this.circle(x + Math.cos(a) * d, y + Math.sin(a) * d, size * (0.06 + this.rand() * 0.18), color, MAT.wet, { alpha });
    }
    if (drips) {
      const nd = 1 + Math.floor(this.rand() * 3);
      for (let i = 0; i < nd; i++) this.drip(x + (this.rand() - 0.5) * size, y, size * (1.5 + this.rand() * 4), size * 0.18, color, alpha);
    }
    return this;
  }

  drip(x, y, len, w, color = '#4a0507', alpha = 0.85) {
    const wob = (this.rand() - 0.5) * w * 2;
    this.path((c) => {
      c.moveTo(x - w / 2, y);
      c.quadraticCurveTo(x - w * 0.4 + wob, y - len * 0.5, x - w * 0.25, y - len);
      c.arc(x, y - len, w * 0.45, Math.PI, 0, true);
      c.quadraticCurveTo(x + w * 0.4 + wob, y - len * 0.5, x + w / 2, y);
      c.closePath();
    }, color, MAT.wet, { alpha });
    return this;
  }

  wound(x, y, size, skin = '#8b917c') {
    this.spot(x, y, size * 2.4, '#4a2438', 0.45);
    this.spot(x, y, size * 1.5, '#6a1a22', 0.5);
    this.poly(this.blob(x, y, size, 0.7, 12, 0.7), '#5c1216', MAT.wet);
    this.poly(this.blob(x, y, size * 0.72, 0.6, 10, 0.7), '#2a0406', MAT.wet);
    this.poly(this.blob(x + size * 0.1, y - size * 0.05, size * 0.35, 0.5, 8, 0.8), '#7a1a18', MAT.wet, { alpha: 0.8 });
    for (let i = 0; i < 4; i++) {
      this.circle(x + (this.rand() - 0.5) * size, y + (this.rand() - 0.5) * size * 0.6, size * 0.08, '#c4a070', null, { alpha: 0.6 });
    }
    this.drip(x + (this.rand() - 0.5) * size * 0.5, y - size * 0.4, size * (1 + this.rand() * 2), size * 0.2, '#3a0406', 0.8);
    return this;
  }

  /** torn cloth hole revealing rotten skin beneath */
  tear(x, y, size, skin) {
    const pts = this.blob(x, y, size, 0.9, 11, 0.75);
    // scuffed, stained fabric around the rip
    this.poly(this.blob(x, y, size * 1.35, 0.5, 12, 0.8), 'rgba(20,8,6,0.3)', null);
    const hole = pts.map(([px, py]) => [x + (px - x) * 0.88, y + (py - y) * 0.88]);
    this.poly(hole, shade(skin, -0.2), MAT.skin);
    this.clipTo(hole, () => {
      this.mottle('#3a1a28', 0.5, 6, 9);
      this.veins(3, '#2a1a38', 0.4, 0.0018);
      // deep shadow at the rim where the cloth overhangs the skin
      const c = this.c;
      const g = c.createRadialGradient(x, y, size * 0.2, x, y, size * 0.95);
      g.addColorStop(0, 'rgba(40,6,10,0)');
      g.addColorStop(1, 'rgba(12,2,4,0.85)');
      c.fillStyle = g;
      c.fillRect(x - size * 1.2, y - size * 1.2, size * 2.4, size * 2.4);
      if (this.rand() < 0.7) this.wound(x + size * 0.1, y - size * 0.1, size * 0.4, skin);
    });
    // frayed threads curling into the hole
    for (let i = 0; i < pts.length; i++) {
      const [px, py] = pts[i];
      this.line([[px, py], [px + (x - px) * 0.3, py + (y - py) * 0.3]], 0.0014, 'rgba(40,30,24,0.8)');
    }
    return this;
  }

  /** soft cloth fold: dark crease with a light ridge beside it */
  fold(pts, color, alpha = 0.3) {
    this.curve(pts, 0.009, shade(color, -0.2), null, { alpha: alpha * 0.6 });
    this.curve(pts, 0.003, shade(color, -0.35), null, { alpha });
    this.curve(pts.map(([x, y]) => [x, y + 0.006]), 0.004, shade(color, 0.15), null, { alpha: alpha * 0.7 });
    return this;
  }

  /** branching vein network */
  veins(count, color = '#3a2a48', alpha = 0.32, width = 0.0022) {
    for (let i = 0; i < count; i++) {
      let x = this.r(0, this.W), y = this.r(0, this.H);
      let a = this.r(0, Math.PI * 2);
      const pts = [[x, y]];
      const steps = 6 + Math.floor(this.rand() * 10);
      for (let s = 0; s < steps; s++) {
        a += this.r(-0.7, 0.7);
        const l = this.r(0.006, 0.02);
        x += Math.cos(a) * l; y += Math.sin(a) * l;
        pts.push([x, y]);
        if (this.rand() < 0.18) {
          const bx = x + Math.cos(a + 1) * 0.02, by = y + Math.sin(a + 1) * 0.02;
          this.line([[x, y], [bx, by]], width * 0.6, color, null, { alpha: alpha * 0.8 });
        }
      }
      this.curve(pts, width * this.r(0.6, 1.2), color, null, { alpha });
    }
    return this;
  }

  // ------------------------------- finish -----------------------------------
  finish(post = null) {
    for (const ctx of [this.c, this.o, this.g]) {
      if (ctx && ctx.__saved) { ctx.restore(); ctx.__saved = false; }
    }
    if (post) post(this.col, this.k);          // e.g. the 1930s ink-and-paint pass
    const map = toTexture(this.col);
    const orm = toTexture(this.ormCv, { srgb: false });
    const bump = toTexture(bumpFrom(this.col, this.size / 2, 0.3, this.seed), { srgb: false });
    const glow = this.glowCv ? toTexture(this.glowCv) : null;
    return { map, orm, bump, glow, canvas: this.col };
  }
}

export { Tiles };
