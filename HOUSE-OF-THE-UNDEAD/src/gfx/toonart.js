// toonart.js — hand-drawn 1930s cartoon effects, painted on canvas with the
// wobble of a real ink line: impact stars, puffy outlined smoke clouds, ink
// splats, the spiky BANG of a muzzle flash, the little ghost that floats up
// out of a knocked-out zombie, dust puffs, sweat drops. One 4x4 atlas feeds
// the effects system; a few pieces are also sprites of their own.

import * as THREE from 'three';

export const INK = '#1d130c';
export const PAPER = '#f4ead0';
// atlas cells (4 x 4)
export const TOON = { star: 0, cloud: 1, splat: 2, bang: 3, ghost: 4, puff: 5, drop: 6, star4: 7, cloud2: 8, spark: 9, ring: 10, sweat: 11 };

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

/** a closed wobbly path through points (the hand-inked look) */
function wobblePath(c, pts) {
  c.beginPath();
  const n = pts.length;
  for (let i = 0; i <= n; i++) {
    const p = pts[i % n], q = pts[(i + 1) % n];
    const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    if (i === 0) c.moveTo(mx, my); else c.quadraticCurveTo(p[0], p[1], mx, my);
  }
  c.closePath();
}

export function drawStar(c, cx, cy, R, { points = 5, inner = 0.45, fill = PAPER, ink = INK, width = 0, seed = 3 } = {}) {
  const r = rng(seed);
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i / (points * 2)) * Math.PI * 2 + (r() - 0.5) * 0.08;
    const rad = (i % 2 ? R * inner : R) * (0.92 + r() * 0.12);
    pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
  }
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
  c.lineJoin = 'round';
  c.fillStyle = fill; c.fill();
  c.lineWidth = width || Math.max(3, R * 0.16); c.strokeStyle = ink; c.stroke();
}

/** a puffy cartoon cloud: overlapping balls, inked round the outside only */
export function drawCloud(c, cx, cy, R, { fill = PAPER, ink = INK, seed = 7, shade = 'rgba(0,0,0,0.12)' } = {}) {
  const r = rng(seed);
  const balls = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.4;
    const d = R * (0.38 + r() * 0.12);
    balls.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, R * (0.38 + r() * 0.16)]);
  }
  balls.push([cx, cy, R * 0.5]);
  // ink ring: every ball drawn fat in ink first, then the fills on top
  c.fillStyle = ink;
  for (const [x, y, rr] of balls) { c.beginPath(); c.arc(x, y, rr + R * 0.075, 0, Math.PI * 2); c.fill(); }
  c.fillStyle = fill;
  for (const [x, y, rr] of balls) { c.beginPath(); c.arc(x, y, rr, 0, Math.PI * 2); c.fill(); }
  // a painted shadow on the underside
  c.save();
  c.beginPath();
  for (const [x, y, rr] of balls) { c.moveTo(x + rr, y); c.arc(x, y, rr, 0, Math.PI * 2); }
  c.clip();
  c.fillStyle = shade;
  c.beginPath(); c.ellipse(cx + R * 0.15, cy + R * 0.45, R * 0.95, R * 0.5, 0, 0, Math.PI * 2); c.fill();
  c.restore();
}

export function drawSplat(c, cx, cy, R, { fill = INK, seed = 11 } = {}) {
  const r = rng(seed);
  const pts = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const rad = R * (i % 2 ? 0.55 + r() * 0.2 : 0.8 + r() * 0.25);
    pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
  }
  c.fillStyle = fill;
  wobblePath(c, pts); c.fill();
  for (let i = 0; i < 6; i++) {
    const a = r() * Math.PI * 2, d = R * (1.05 + r() * 0.3);
    c.beginPath(); c.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, R * (0.06 + r() * 0.08), 0, Math.PI * 2); c.fill();
  }
}

/** the spiky BANG of a cartoon gunshot */
export function drawBang(c, cx, cy, R, { seed = 5 } = {}) {
  const r = rng(seed);
  const spikes = 11;
  const pts = [];
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2 + (r() - 0.5) * 0.12;
    const rad = i % 2 ? R * (0.42 + r() * 0.1) : R * (0.82 + r() * 0.18);
    pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
  }
  c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath();
  c.fillStyle = '#ffd24a'; c.fill();
  c.lineWidth = R * 0.09; c.lineJoin = 'round'; c.strokeStyle = INK; c.stroke();
  drawStar(c, cx, cy, R * 0.5, { points: 7, inner: 0.55, fill: '#fff8e0', seed: seed + 1, width: R * 0.05 });
}

/** the little ghost that floats up out of a knocked-out zombie */
export function drawGhost(c, cx, cy, R, { seed = 13 } = {}) {
  const r = rng(seed);
  c.save();
  c.beginPath();
  c.moveTo(cx - R * 0.55, cy + R * 0.7);
  c.bezierCurveTo(cx - R * 0.7, cy - R * 0.2, cx - R * 0.5, cy - R * 0.95, cx, cy - R * 0.95);
  c.bezierCurveTo(cx + R * 0.5, cy - R * 0.95, cx + R * 0.7, cy - R * 0.2, cx + R * 0.55, cy + R * 0.7);
  // the wavy tail
  for (let i = 0; i < 4; i++) {
    const x0 = cx + R * 0.55 - (i + 1) * R * 0.275;
    c.quadraticCurveTo(x0 + R * 0.14, cy + R * (0.5 + r() * 0.1), x0, cy + R * 0.72);
  }
  c.closePath();
  c.fillStyle = 'rgba(248,244,230,0.92)'; c.fill();
  c.lineWidth = R * 0.08; c.strokeStyle = INK; c.stroke();
  // pie-cut eyes and an "o" mouth
  for (const sx of [-1, 1]) {
    c.fillStyle = INK;
    c.beginPath(); c.ellipse(cx + sx * R * 0.2, cy - R * 0.35, R * 0.1, R * 0.16, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = PAPER;
    c.beginPath(); c.moveTo(cx + sx * R * 0.2, cy - R * 0.35); c.arc(cx + sx * R * 0.2, cy - R * 0.35, R * 0.12, -0.9, -0.3); c.fill();
  }
  c.fillStyle = INK; c.beginPath(); c.ellipse(cx, cy - R * 0.05, R * 0.08, R * 0.11, 0, 0, Math.PI * 2); c.fill();
  c.restore();
}

function drawDrop(c, cx, cy, R, fill) {
  c.beginPath();
  c.moveTo(cx, cy - R);
  c.bezierCurveTo(cx + R * 0.7, cy - R * 0.1, cx + R * 0.6, cy + R * 0.7, cx, cy + R * 0.7);
  c.bezierCurveTo(cx - R * 0.6, cy + R * 0.7, cx - R * 0.7, cy - R * 0.1, cx, cy - R);
  c.fillStyle = fill; c.fill();
  c.lineWidth = R * 0.14; c.strokeStyle = INK; c.stroke();
}

let _atlas = null;
/** the 4x4 atlas the toon particle batch samples */
export function toonAtlas() {
  if (_atlas) return _atlas;
  const S = 1024, C = S / 4;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  const cell = (i, fn) => { const x = (i % 4) * C, y = Math.floor(i / 4) * C; c.save(); c.beginPath(); c.rect(x, y, C, C); c.clip(); fn(x + C / 2, y + C / 2, C * 0.4); c.restore(); };
  cell(TOON.star, (x, y, R) => drawStar(c, x, y, R, { fill: '#fff8e0' }));
  cell(TOON.cloud, (x, y, R) => drawCloud(c, x, y, R, { seed: 7 }));
  cell(TOON.splat, (x, y, R) => drawSplat(c, x, y, R * 0.8));
  cell(TOON.bang, (x, y, R) => drawBang(c, x, y, R));
  cell(TOON.ghost, (x, y, R) => drawGhost(c, x, y, R));
  cell(TOON.puff, (x, y, R) => drawCloud(c, x, y, R * 0.8, { seed: 21, fill: '#e8dcc0' }));
  cell(TOON.drop, (x, y, R) => { drawDrop(c, x - R * 0.35, y, R * 0.45, INK); drawDrop(c, x + R * 0.4, y + R * 0.3, R * 0.3, INK); });
  cell(TOON.star4, (x, y, R) => drawStar(c, x, y, R, { points: 4, inner: 0.32, fill: '#ffd24a', seed: 9 }));
  cell(TOON.cloud2, (x, y, R) => drawCloud(c, x, y, R, { seed: 33, fill: '#8a8070', shade: 'rgba(0,0,0,0.2)' }));
  cell(TOON.spark, (x, y, R) => {
    c.strokeStyle = INK; c.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      c.lineWidth = R * 0.12;
      c.beginPath(); c.moveTo(x + Math.cos(a) * R * 0.35, y + Math.sin(a) * R * 0.35); c.lineTo(x + Math.cos(a) * R * 0.95, y + Math.sin(a) * R * 0.95); c.stroke();
    }
  });
  cell(TOON.ring, (x, y, R) => { c.lineWidth = R * 0.12; c.strokeStyle = INK; c.beginPath(); c.arc(x, y, R * 0.8, 0, Math.PI * 2); c.stroke(); });
  cell(TOON.sweat, (x, y, R) => drawDrop(c, x, y, R * 0.7, '#9ad8ff'));
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  // no mipmaps: small sprites would blur the ink into the fill and go grey
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  return (_atlas = t);
}

/** one hand-drawn picture as a texture (used for sprites and the gun's BANG) */
const _single = {};
export function toonTexture(kind, size = 256) {
  if (_single[kind]) return _single[kind];
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d');
  const R = size * 0.42, x = size / 2, y = size / 2;
  if (kind === 'star') drawStar(c, x, y, R, { fill: '#ffd24a', seed: 4 });
  else if (kind === 'bang') drawBang(c, x, y, R);
  else if (kind === 'ghost') drawGhost(c, x, y, R);
  else if (kind === 'splat') drawSplat(c, x, y, R * 0.75, { seed: 19 });
  else if (kind === 'soot') drawSplat(c, x, y, R * 0.8, { fill: 'rgba(29,19,12,0.85)', seed: 23 });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return (_single[kind] = t);
}

let _starMat = null;
/** the little yellow stars that circle a dazed head */
export function dizzyStarMaterial() {
  return _starMat || (_starMat = new THREE.SpriteMaterial({ map: toonTexture('star'), transparent: true, depthWrite: false }));
}
