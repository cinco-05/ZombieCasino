// viewmodels.js — first-person guns and the gloved hands holding them.
// Frames and stocks are extruded from side profiles, surfaces are textured
// (nickel, blued steel, walnut, ivory, brass), and each gun carries the
// moving parts vmanim.js animates (hammer, trigger, cylinder crane, pump,
// lever, magazine, charging handle) plus a free left hand with the things it
// carries during reloads (speedloader, shells, cartridges, a fresh mag).
// Local frame: -Z = barrel direction, +Y up, +X right. Origin ~ the trigger.

import * as THREE from 'three';
import { makeCanvas, toTexture, woodCanvas, metalCanvas, noiseCanvas, fabricCanvas } from './texkit.js';
import { chipMesh } from './models.js';
import { STYLE, toonRim } from './style.js';
import { toonTexture } from './toonart.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lathe = (pts, segs = 20) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);

// --------------------------------- materials ---------------------------------
let _M = null;
/** gold with hand-cut scrollwork — the side plates, trims and guards of every gun */
function engravedGold() {
  const S = 512, cv = makeCanvas(S), c = cv.getContext('2d');
  const grd = c.createLinearGradient(0, 0, S, S);
  grd.addColorStop(0, '#f0c858'); grd.addColorStop(0.5, '#d8a63a'); grd.addColorStop(1, '#ecc050');
  c.fillStyle = grd; c.fillRect(0, 0, S, S);
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  c.lineCap = 'round';
  // scroll curls, each cut dark with a bright burr beside it
  for (let i = 0; i < 30; i++) {
    const x = r() * S, y = r() * S, R0 = 16 + r() * 28, dir = r() < 0.5 ? 1 : -1, a0 = r() * Math.PI * 2;
    for (const [col, w, off] of [['rgba(92,54,8,0.8)', 3.2, 0], ['rgba(255,240,170,0.6)', 1.3, -1.6]]) {
      c.strokeStyle = col; c.lineWidth = w; c.beginPath();
      for (let t = 0; t <= 1.001; t += 0.02) {
        const a = a0 + dir * t * Math.PI * 3.2, rr = R0 * (1 - t * 0.85);
        const px = x + Math.cos(a) * rr + off, py = y + Math.sin(a) * rr + off;
        if (t === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.stroke();
    }
  }
  c.strokeStyle = 'rgba(92,54,8,0.75)'; c.lineWidth = 5; c.strokeRect(12, 12, S - 24, S - 24);
  return toTexture(cv);
}

function mats() {
  if (_M) return _M;
  const wood = (base, dark, seed, rep = [1, 1]) => {
    const t = toTexture(woodCanvas(512, base, dark, seed), { repeat: rep });
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.42, metalness: 0.02 });
  };
  const ivoryCv = makeCanvas(256), ic = ivoryCv.getContext('2d');
  ic.fillStyle = '#e8e0cc'; ic.fillRect(0, 0, 256, 256);
  ic.globalAlpha = 0.35; ic.drawImage(noiseCanvas(256, 3, 5, 61, 1.6), 0, 0); ic.globalAlpha = 1;
  for (let i = 0; i < 40; i++) { ic.strokeStyle = 'rgba(160,140,100,0.25)'; ic.beginPath(); ic.moveTo(0, i * 7); ic.bezierCurveTo(80, i * 7 + 6, 160, i * 7 - 6, 256, i * 7 + 3); ic.stroke(); }
  _M = {
    nickel: new THREE.MeshStandardMaterial({ map: toTexture(metalCanvas(256, '#b8bcc4', 3)), metalness: 1, roughness: 0.22 }),
    blued: new THREE.MeshStandardMaterial({ map: toTexture(metalCanvas(256, '#34405a', 7)), metalness: 0.85, roughness: 0.28 }),
    black: new THREE.MeshStandardMaterial({ map: toTexture(metalCanvas(256, '#141418', 9, false)), metalness: 0.4, roughness: 0.55 }),
    brass: new THREE.MeshStandardMaterial({ map: toTexture(metalCanvas(256, '#c8962e', 11)), metalness: 1, roughness: 0.3 }),
    gold: new THREE.MeshStandardMaterial({ map: engravedGold(), metalness: 1, roughness: 0.24 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xeef0f4, metalness: 1, roughness: 0.08 }),
    walnut: wood('#5a3016', '#2a1206', 3, [1, 1]),
    cherry: wood('#6a2412', '#300c04', 13, [1, 1]),
    ivory: new THREE.MeshStandardMaterial({ map: toTexture(ivoryCv), roughness: 0.35 }),
    // 1930s: four-fingered white cartoon gloves on black rubber-hose sleeves
    glove: new THREE.MeshStandardMaterial({ map: toTexture(fabricCanvas(256, STYLE.cartoon ? '#f3eee2' : '#1a1618', 71, false)), roughness: STYLE.cartoon ? 0.8 : 0.5, metalness: 0.05 }),
    sleeve: new THREE.MeshStandardMaterial({ map: toTexture(fabricCanvas(256, STYLE.cartoon ? '#121014' : '#1e1a24', 73, true), { repeat: [3, 3] }), roughness: 0.95 }),
    cuff: new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.85 }),
    cufflink: new THREE.MeshStandardMaterial({ color: 0xd8b23a, metalness: 1, roughness: 0.25 }),
    glowGold: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffd24a, emissiveIntensity: 3 }),
    glowPink: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2d78, emissiveIntensity: 3 }),
    glowCyan: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x27e6ff, emissiveIntensity: 1.2 }),
    glowGreen: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x2dff7a, emissiveIntensity: 3 }),
    redInlay: new THREE.MeshStandardMaterial({ color: 0x9a0a18, roughness: 0.3, emissive: 0x3a0006, emissiveIntensity: 0.4 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xc8703a, metalness: 1, roughness: 0.3 }),
    lead: new THREE.MeshStandardMaterial({ color: 0x70707a, metalness: 0.7, roughness: 0.45 }),
    shellRed: new THREE.MeshStandardMaterial({ color: 0xa01414, roughness: 0.45, metalness: 0.05 }),
    // the new guns
    pearl: new THREE.MeshStandardMaterial({ map: toTexture(ivoryCv), color: 0xf4e8f0, roughness: 0.18, metalness: 0.1 }),
    bottle: new THREE.MeshStandardMaterial({ color: 0x1a6a3a, metalness: 0.5, roughness: 0.08, envMapIntensity: 1.6, emissive: 0x04200e }),
    foil: new THREE.MeshStandardMaterial({ map: toTexture(metalCanvas(256, '#d8b040', 91, false)), metalness: 1, roughness: 0.38 }),
    cork: new THREE.MeshStandardMaterial({ map: toTexture(noiseCanvas(128, 16, 3, 93, 1.8)), color: 0xc89a60, roughness: 0.9 }),
    lacquer: new THREE.MeshStandardMaterial({ color: 0x8a0a14, metalness: 0.4, roughness: 0.18 }),
    ebony: new THREE.MeshStandardMaterial({ color: 0x120a08, roughness: 0.35, metalness: 0.05 }),
    blueFlame: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x3a8aff, emissiveIntensity: 4, transparent: true, opacity: 0.9 }),
    glassClear: new THREE.MeshStandardMaterial({ color: 0xd8e8ff, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.3 }),
    cardEdge: new THREE.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.6 }),
  };
  // every solid surface gets the thin cartoon rim, so the gun reads as shapes, not a slab
  for (const m of Object.values(_M)) if (m.isMeshStandardMaterial && !m.transparent && m.emissive.getHex() === 0) toonRim(m, 0.32);
  return _M;
}

/** a small canvas label on a plane */
function labelPlane(w, h, draw, mat = {}) {
  const cv = makeCanvas(256, Math.round(256 * h / w)), c = cv.getContext('2d');
  draw(c, cv.width, cv.height);
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: toTexture(cv), roughness: 0.5, transparent: true, ...mat }));
}

// --------------------------------- helpers -----------------------------------
/** extrude a side profile given as [forward, up] points; width along X, centered */
function profile(pts, width, mat, bevel = 0.005) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) s.lineTo(p[0], p[1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 8 });
  g.rotateY(Math.PI / 2);                     // shape x (forward) -> -Z
  g.translate(-(width - bevel * 2) / 2, 0, 0);
  const box = new THREE.Box3().setFromBufferAttribute(g.attributes.position);
  // world-ish planar UVs so wood grain runs along the gun
  const uv = g.attributes.uv, p = g.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getZ(i) - box.min.z) * 3.2, (p.getY(i) - box.min.y) * 3.2 + p.getX(i) * 2);
  return new THREE.Mesh(g, mat);
}
const cyl = (r, len, mat, x, y, z, segs = 16) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, segs), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
};
const box = (w, h, d, mat, x, y, z) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
};
function tube(points, r, mat, capEnd = true) {
  const curve = new THREE.CatmullRomCurve3(points);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 14, r, 8, false), mat));
  if (capEnd) {
    const tip = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat);
    tip.position.copy(points[points.length - 1]);
    g.add(tip);
  }
  const base = new THREE.Mesh(new THREE.SphereGeometry(r * 1.05, 8, 6), mat);
  base.position.copy(points[0]);
  g.add(base);
  return g;
}
function capsule(a, b, r, mat, squash = null) {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len), 6, 12), mat);
  m.position.copy(a).lerp(b, 0.5);
  m.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
  if (squash) m.scale.set(squash[0], 1, squash[1]);
  return m;
}

let _stitchMat = null;
/** jacket sleeve + shirt cuff running from the wrist back off-screen */
function forearm(wrist, dir, M) {
  const g = new THREE.Group();
  const d = dir.clone().normalize();
  const elbow = wrist.clone().addScaledVector(d, 0.5);
  g.add(capsule(wrist.clone().addScaledVector(d, 0.01), wrist.clone().addScaledVector(d, 0.06), 0.03, M.glove));
  if (STYLE.cartoon) {
    // the rubber-hose glove's flared cuff, three stitch lines down the back
    const flare = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.036, 0.05, 20), M.glove);
    flare.position.copy(wrist).addScaledVector(d, 0.07);
    flare.quaternion.setFromUnitVectors(V(0, 1, 0), d);
    g.add(flare);
    const stitch = _stitchMat || (_stitchMat = new THREE.MeshBasicMaterial({ color: 0x1d130c }));
    for (const off of [-0.012, 0, 0.012]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.004, 0.045), stitch);
      line.position.copy(wrist).addScaledVector(d, 0.015).add(V(off, 0.028, 0));
      line.quaternion.setFromUnitVectors(V(0, 0, 1), d);
      g.add(line);
    }
  } else {
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.035, 18, 1, true), M.cuff);
    cuff.position.copy(wrist).addScaledVector(d, 0.065);
    cuff.quaternion.setFromUnitVectors(V(0, 1, 0), d);
    g.add(cuff);
    const link = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 6), M.cufflink);
    link.position.copy(cuff.position).add(V(0.036, 0.004, 0));
    g.add(link);
  }
  const sl = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.046, 0.5, 18), M.sleeve);
  sl.position.copy(wrist).addScaledVector(d, 0.08 + 0.25);
  sl.quaternion.setFromUnitVectors(V(0, -1, 0), d);
  g.add(sl);
  void elbow;
  return g;
}

/**
 * a gloved hand wrapped around a grip running from A (top) to B (bottom).
 * sx: +1 right hand, -1 left hand. trigger: point the index finger reaches.
 */
function gripHand(A, B, sx, M, { trigger = null, halfW = 0.024, halfD = 0.02, armDir = null } = {}) {
  const g = new THREE.Group();
  const u = B.clone().sub(A).normalize();
  const fw = V(0, 0, -1);
  const f = fw.clone().sub(u.clone().multiplyScalar(u.dot(fw))).normalize();
  const r = new THREE.Vector3().crossVectors(u, f).normalize();
  const at = (t) => A.clone().lerp(B, t);
  const len = A.distanceTo(B);
  // palm / back of the hand on the outside of the grip
  const pc = at(0.5).addScaledVector(r, sx * (halfW + 0.012)).addScaledVector(f, -0.01);
  g.add(capsule(pc.clone().addScaledVector(u, -len * 0.38), pc.clone().addScaledVector(u, len * 0.34), 0.026, M.glove, [0.62, 1.1]));
  // heel of the hand behind the grip
  g.add(capsule(at(0.25).addScaledVector(f, -(halfD + 0.014)), at(0.8).addScaledVector(f, -(halfD + 0.012)), 0.02, M.glove));
  // fingers wrap around the front to the far side
  const fingers = trigger ? [0.34, 0.58, 0.8] : [0.14, 0.38, 0.6, 0.8];
  fingers.forEach((t, i) => {
    const C = at(t);
    const fr = i === fingers.length - 1 ? 0.0082 : 0.0095;
    const pts = [];
    for (let k = 0; k <= 6; k++) {
      const phi = -0.35 + (k / 6) * (Math.PI * 0.95 + 0.35);
      pts.push(C.clone().addScaledVector(r, sx * Math.cos(phi) * (halfW + fr + 0.001)).addScaledVector(f, Math.sin(phi) * (halfD + fr + 0.001)));
    }
    g.add(tube(pts, fr, M.glove));
  });
  // index finger on the trigger
  if (trigger) {
    const k0 = at(0.1).addScaledVector(r, sx * (halfW + 0.009));
    const mid = trigger.clone().addScaledVector(r, sx * 0.016).addScaledVector(f, -0.012).addScaledVector(u, -0.004);
    g.add(tube([k0, mid, trigger.clone().addScaledVector(r, sx * 0.004)], 0.0092, M.glove));
  }
  // thumb along the far side, pointing forward
  const t0 = at(0.02).addScaledVector(f, -(halfD + 0.01)).addScaledVector(r, sx * 0.012);
  const t1 = at(-0.02).addScaledVector(r, -sx * (halfW + 0.006)).addScaledVector(f, -0.004);
  const t2 = at(0.05).addScaledVector(r, -sx * (halfW + 0.01)).addScaledVector(f, halfD + 0.02);
  g.add(tube([t0, t1, t2], 0.0105, M.glove));
  // wrist + sleeve heading back toward the camera
  const wrist = at(0.85).addScaledVector(f, -(halfD + 0.02)).addScaledVector(r, sx * 0.012);
  g.add(forearm(wrist, armDir || V(sx * 0.35, -0.55, 1), M));
  g.userData.hand = true;
  return g;
}

/** support hand cupped under a horizontal forend centered at C (radius R) */
function supportHand(C, R, M, { armDir = V(-0.45, -0.6, 1) } = {}) {
  const g = new THREE.Group();
  const X = V(1, 0, 0), Y = V(0, 1, 0), Z = V(0, 0, 1);
  const palmC = C.clone().addScaledVector(Y, -(R + 0.016)).addScaledVector(X, -0.006);
  g.add(capsule(palmC.clone().addScaledVector(Z, 0.045), palmC.clone().addScaledVector(Z, -0.03), 0.027, M.glove, [1.15, 0.55]));
  [-0.03, -0.011, 0.008, 0.026].forEach((dz, i) => {
    const fr = i === 3 ? 0.0082 : 0.0092;
    const pts = [];
    for (let k = 0; k <= 5; k++) {
      const phi = -Math.PI / 2 + (k / 5) * (Math.PI / 2 + 0.45);
      pts.push(C.clone().addScaledVector(X, Math.cos(phi) * (R + fr)).addScaledVector(Y, Math.sin(phi) * (R + fr)).addScaledVector(Z, dz));
    }
    g.add(tube(pts, fr, M.glove));
  });
  const th0 = C.clone().addScaledVector(Y, -(R + 0.01)).addScaledVector(X, -(R * 0.7)).addScaledVector(Z, 0.035);
  const th1 = C.clone().addScaledVector(X, -(R + 0.011)).addScaledVector(Z, 0.0);
  const th2 = C.clone().addScaledVector(X, -(R + 0.008)).addScaledVector(Y, 0.004).addScaledVector(Z, -0.045);
  g.add(tube([th0, th1, th2], 0.0105, M.glove));
  const wrist = palmC.clone().addScaledVector(Z, 0.07).addScaledVector(Y, -0.012);
  g.add(forearm(wrist, armDir, M));
  g.userData.hand = true;
  return g;
}

/** move a group's pivot to P without moving anything visually */
function recenter(g, P) {
  for (const c of g.children) c.position.sub(P);
  g.position.add(P);
  return g;
}

/** a free left fist (pivot = palm) for reloads and throws */
function leftFist(M, { halfW = 0.015, halfD = 0.015, len = 0.07 } = {}) {
  const g = gripHand(V(0, 0, 0), V(0, -len, 0), -1, M, { halfW, halfD, armDir: V(-0.45, -0.65, 1) });
  return recenter(g, V(0, -len / 2, 0));
}

/** six rounds on a twist-release speedloader, noses toward -Z */
function speedloader(M) {
  const g = new THREE.Group();
  g.add(cyl(0.02, 0.012, M.black, 0, 0, 0.012, 16));
  g.add(cyl(0.0075, 0.022, M.black, 0, 0, 0.03, 10));
  const rounds = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.52;
    const x = Math.cos(a) * 0.022, y = Math.sin(a) * 0.022;
    rounds.add(cyl(0.0046, 0.03, M.brass, x, y, -0.008, 8));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.0046, 0.012, 8), M.lead);
    tip.rotation.x = -Math.PI / 2;
    tip.position.set(x, y, -0.029);
    rounds.add(tip);
  }
  g.add(rounds);
  g.userData.rounds = rounds;
  return g;
}

function shellMesh(M) {
  const g = new THREE.Group();
  g.add(cyl(0.0095, 0.052, M.shellRed, 0, 0, -0.004, 12));
  g.add(cyl(0.0099, 0.016, M.brass, 0, 0, 0.026, 12));
  return g;
}

function cartridgeMesh(M) {
  const g = new THREE.Group();
  g.add(cyl(0.0056, 0.034, M.brass, 0, 0, 0, 10));
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.0052, 0.016, 10), M.lead);
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -0.025;
  g.add(tip);
  return g;
}

function smgMag(M) {
  const mag = new THREE.Group();
  mag.add(box(0.036, 0.22, 0.07, M.blued, 0, -0.11, 0));
  mag.add(box(0.038, 0.014, 0.074, M.black, 0, -0.22, 0));
  for (let i = 0; i < 6; i++) mag.add(box(0.037, 0.004, 0.01, M.brass, 0, -0.02 - i * 0.032, 0.03));
  return mag;
}

/** a chip bomb pinched above the fist, for the throw */
function chipCarry(fist) {
  const chip = chipMesh('#b3122e', 0.032, 0.012);
  chip.rotation.x = Math.PI / 2;
  chip.position.set(0, 0.05, -0.006);
  chip.visible = false;
  fist.add(chip);
  return chip;
}

// ------------------------------- the four guns -------------------------------
/** Lucky Seven — nickel revolver, gold drum, ivory grips with a red 7 */
function pistol(M) {
  const g = new THREE.Group();
  g.add(profile([[-0.075, 0.034], [0.0, 0.05], [0.115, 0.05], [0.125, 0.03], [0.125, -0.018], [0.03, -0.028], [0.005, -0.04], [-0.02, -0.05], [-0.075, -0.045], [-0.085, -0.01]], 0.046, M.nickel));
  const grip = profile([[0.002, -0.04], [-0.03, -0.158], [-0.05, -0.17], [-0.078, -0.166], [-0.074, -0.06], [-0.062, -0.034]], 0.052, M.ivory, 0.004);
  g.add(grip);
  const seven = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.04), (() => {
    const cv = makeCanvas(64, 80), c = cv.getContext('2d');
    c.font = 'bold 72px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#b3122e'; c.fillText('7', 32, 44);
    return new THREE.MeshStandardMaterial({ map: toTexture(cv), transparent: true, roughness: 0.3, emissive: 0x6a0010, emissiveIntensity: 0.6, emissiveMap: toTexture(cv) });
  })());
  seven.position.set(0.0285, -0.105, 0.05);
  seven.rotation.set(0, Math.PI / 2, -0.25);
  g.add(seven);
  // the cylinder rides on a crane that swings out to the left for reloads
  const crane = new THREE.Group();
  crane.position.set(-0.012, -0.024, -0.055);
  crane.add(box(0.008, 0.03, 0.012, M.nickel, 0.004, 0.016, -0.046));   // yoke arm
  const drum = new THREE.Group();
  drum.add(cyl(0.039, 0.1, M.gold, 0, 0, 0, 24));
  const rounds = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const fl = box(0.012, 0.006, 0.07, M.brass, Math.cos(a) * 0.036, Math.sin(a) * 0.036, 0);
    fl.rotation.z = a;
    drum.add(fl);
    const cx = Math.cos(a + 0.52) * 0.022, cy = Math.sin(a + 0.52) * 0.022;
    drum.add(cyl(0.008, 0.101, M.black, cx, cy, 0, 8));
    rounds.add(cyl(0.0074, 0.006, M.brass, cx, cy, 0.049, 10));        // case heads
    rounds.add(cyl(0.0022, 0.002, M.copper, cx, cy, 0.0525, 6));      // primers
  }
  drum.add(rounds);
  drum.position.set(0.012, 0.036, 0);
  crane.add(drum);
  g.add(crane);
  // barrel, rib, ejector housing, sight
  g.add(cyl(0.019, 0.31, M.nickel, 0, 0.028, -0.275, 20));
  g.add(box(0.02, 0.014, 0.31, M.nickel, 0, 0.047, -0.275));
  g.add(cyl(0.012, 0.2, M.nickel, 0, 0.004, -0.225, 12));
  g.add(cyl(0.022, 0.012, M.gold, 0, 0.028, -0.43, 20));
  g.add(box(0.006, 0.016, 0.014, M.nickel, 0, 0.06, -0.42));
  g.add(box(0.004, 0.005, 0.005, M.glowGold, 0, 0.069, -0.42));
  // hammer (pivots at the frame) + trigger + guard
  const hammer = new THREE.Group();
  hammer.position.set(0, 0.032, 0.064);
  hammer.add(box(0.012, 0.034, 0.018, M.nickel, 0, 0.016, 0.004));
  hammer.add(box(0.014, 0.006, 0.022, M.nickel, 0, 0.034, 0.012));    // spur
  g.add(hammer);
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.004, 6, 18, Math.PI), M.nickel);
  guard.position.set(0, -0.03, -0.012);
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  g.add(guard);
  const trigger = new THREE.Group();
  trigger.position.set(0, -0.028, -0.008);
  const blade = box(0.006, 0.026, 0.008, M.gold, 0, -0.012, -0.002);
  blade.rotation.x = 0.35;
  trigger.add(blade);
  g.add(trigger);
  // right hand
  g.add(gripHand(V(0, -0.045, 0.03), V(0, -0.16, 0.055), 1, M, { trigger: V(0, -0.045, -0.012), halfW: 0.026, halfD: 0.026 }));
  // free left hand for reloads + throws
  const fist = leftFist(M, { halfW: 0.013, halfD: 0.013, len: 0.065 });
  const sl = speedloader(M);
  sl.position.set(0, 0.05, -0.012);
  fist.add(sl);
  const chip = chipCarry(fist);
  fist.visible = false;
  g.add(fist);
  g.userData = { kind: 'pistol', crane, drum, rounds, hammer, trigger, fist, carry: { speedloader: sl, chip }, muzzle: V(0, 0.028, -0.44) };
  return g;
}

/** Riverboat Scattergun — blued double barrel, walnut, gold engraving, racking pump */
function shotgun(M) {
  const g = new THREE.Group();
  g.add(cyl(0.03, 0.64, M.blued, -0.031, 0.032, -0.4, 20));
  g.add(cyl(0.03, 0.64, M.blued, 0.031, 0.032, -0.4, 20));
  g.add(box(0.02, 0.012, 0.64, M.gold, 0, 0.064, -0.4));
  g.add(box(0.008, 0.012, 0.012, M.glowPink, 0, 0.074, -0.71));
  for (const x of [-0.031, 0.031]) g.add(cyl(0.032, 0.02, M.gold, x, 0.032, -0.72, 20));
  // receiver with engraved gold side plates
  g.add(profile([[-0.12, 0.06], [0.08, 0.062], [0.08, 0.0], [0.04, -0.04], [-0.12, -0.035]], 0.07, M.blued));
  for (const x of [-0.036, 0.036]) {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.06), M.gold);
    plate.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2;
    plate.position.set(x * 1.01, 0.012, 0.0);
    g.add(plate);
  }
  // walnut stock with a pistol-grip wrist
  g.add(profile([[-0.12, 0.045], [-0.4, 0.035], [-0.52, 0.05], [-0.55, -0.12], [-0.46, -0.14], [-0.2, -0.07], [-0.14, -0.12], [-0.1, -0.12], [-0.08, -0.035]], 0.058, M.walnut, 0.006));
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.004, 6, 18, Math.PI), M.gold);
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  guard.position.set(0, -0.038, 0.035);
  g.add(guard);
  const trigger = new THREE.Group();
  trigger.position.set(0, -0.034, 0.035);
  trigger.add(box(0.006, 0.026, 0.008, M.gold, 0, -0.011, 0));
  g.add(trigger);
  g.add(box(0.03, 0.004, 0.08, M.black, 0, -0.04, 0.0));               // loading port
  // the pump (racks) — the support hand rides it but is its own object
  const pump = new THREE.Group();
  pump.add(profile([[-0.08, -0.004], [0.08, -0.004], [0.075, -0.05], [-0.075, -0.052]], 0.072, M.walnut, 0.008));
  for (let i = 0; i < 7; i++) pump.add(box(0.074, 0.003, 0.004, M.black, 0, -0.03, -0.06 + i * 0.02));
  pump.position.set(0, 0.0, -0.32);
  g.add(pump);
  const support = recenter(supportHand(V(0, -0.028, -0.32), 0.036, M), V(0, -0.028, -0.32));
  g.add(support);
  g.add(gripHand(V(0, -0.04, 0.085), V(0, -0.125, 0.135), 1, M, { trigger: V(0, -0.045, 0.035), halfW: 0.028, halfD: 0.024, armDir: V(0.3, -0.5, 1) }));
  const fist = leftFist(M, { halfW: 0.014, halfD: 0.014 });
  const shell = shellMesh(M);
  shell.position.set(0, 0.05, -0.012);
  fist.add(shell);
  const chip = chipCarry(fist);
  fist.visible = false;
  g.add(fist);
  g.userData = {
    kind: 'shotgun', pump, support, supportBase: support.position.clone(), trigger, fist, carry: { shell, chip },
    port: V(0, -0.042, 0.0), muzzle: V(0, 0.032, -0.74),
  };
  return g;
}

/** Chip Spitter — black polymer SMG, cyan light strip, long mag, vented shroud */
function smg(M) {
  const g = new THREE.Group();
  g.add(profile([[-0.3, 0.055], [0.12, 0.055], [0.14, 0.03], [0.14, -0.03], [0.08, -0.035], [-0.3, -0.035]], 0.062, M.black));
  g.add(box(0.064, 0.012, 0.36, M.glowCyan, 0, 0.022, -0.1));
  g.add(box(0.04, 0.02, 0.26, M.blued, 0, 0.066, -0.08));
  const shroud = cyl(0.036, 0.2, M.black, 0, 0.018, -0.4, 16);
  g.add(shroud);
  for (let i = 0; i < 5; i++) g.add(cyl(0.0372, 0.012, M.blued, 0, 0.018, -0.33 - i * 0.034, 16));
  g.add(cyl(0.02, 0.06, M.blued, 0, 0.018, -0.53, 12));
  // poker chip emblem on the side
  const emblem = new THREE.Mesh(new THREE.CircleGeometry(0.02, 20), M.glowPink);
  emblem.position.set(0.032, 0.01, -0.05);
  emblem.rotation.y = Math.PI / 2;
  g.add(emblem);
  // pistol grip + trigger guard + stock stub
  g.add(profile([[-0.035, -0.03], [-0.06, -0.16], [-0.1, -0.165], [-0.085, -0.03]], 0.052, M.black, 0.005));
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.0045, 6, 18, Math.PI), M.black);
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  guard.position.set(0, -0.035, 0.01);
  g.add(guard);
  const trigger = new THREE.Group();
  trigger.position.set(0, -0.03, 0.012);
  trigger.add(box(0.006, 0.022, 0.008, M.chrome, 0, -0.01, 0));
  g.add(trigger);
  g.add(profile([[-0.14, 0.03], [-0.34, 0.02], [-0.36, -0.06], [-0.32, -0.07], [-0.14, -0.02]], 0.04, M.black, 0.004));
  // charging handle on the left side
  const charger = new THREE.Group();
  charger.position.set(-0.036, 0.034, 0.05);
  charger.add(box(0.014, 0.012, 0.02, M.chrome, -0.004, 0, 0));
  g.add(charger);
  // foregrip
  g.add(profile([[0.2, -0.035], [0.215, -0.13], [0.245, -0.135], [0.26, -0.035]], 0.04, M.black, 0.005));
  const mag = smgMag(M);
  mag.position.set(0, -0.03, -0.05);
  mag.rotation.x = 0.12;
  g.add(mag);
  g.add(gripHand(V(0, -0.04, 0.06), V(0, -0.155, 0.08), 1, M, { trigger: V(0, -0.042, 0.012), halfW: 0.024, halfD: 0.022 }));
  // the left fist lives on the foregrip and does the mag swap itself
  const fist = leftFist(M, { halfW: 0.018, halfD: 0.018, len: 0.085 });
  fist.position.set(0, -0.0875, -0.23);
  const handMag = smgMag(M);
  handMag.position.set(0, 0.265, 0.004);
  handMag.visible = false;
  fist.add(handMag);
  const chip = chipCarry(fist);
  g.add(fist);
  g.userData = {
    kind: 'smg', mag, magBaseY: -0.03, charger, trigger, fist, fistRest: fist.position.clone(),
    carry: { mag: handMag, chip }, muzzle: V(0, 0.018, -0.57),
  };
  return g;
}

/** Boneyard Special — brass lever-action, octagon barrel, bone-white stock with a skull */
function rifle(M) {
  const g = new THREE.Group();
  g.add(cyl(0.02, 0.78, M.blued, 0, 0.036, -0.48, 8));
  g.add(cyl(0.013, 0.62, M.brass, 0, 0.004, -0.4, 12));
  g.add(box(0.008, 0.014, 0.012, M.blued, 0, 0.062, -0.84));
  g.add(box(0.004, 0.005, 0.005, M.glowGreen, 0, 0.071, -0.84));
  g.add(box(0.012, 0.018, 0.02, M.blued, 0, 0.062, -0.02));
  g.add(profile([[-0.1, 0.058], [0.1, 0.058], [0.11, 0.0], [0.08, -0.04], [-0.1, -0.035]], 0.056, M.brass));
  // bone-white stock with a skull inlay
  g.add(profile([[-0.1, 0.045], [-0.4, 0.03], [-0.52, 0.055], [-0.55, -0.13], [-0.47, -0.15], [-0.18, -0.06], [-0.1, -0.03]], 0.056, M.ivory, 0.006));
  const skull = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.06), (() => {
    const cv = makeCanvas(64), c = cv.getContext('2d');
    c.fillStyle = '#1a1210'; c.font = '52px serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('☠', 32, 36);
    return new THREE.MeshStandardMaterial({ map: toTexture(cv), transparent: true, roughness: 0.4 });
  })());
  skull.position.set(0.0295, -0.03, 0.34);
  skull.rotation.y = Math.PI / 2;
  g.add(skull);
  // forend
  g.add(profile([[0.12, 0.02], [0.46, 0.02], [0.47, -0.025], [0.13, -0.035]], 0.05, M.cherry, 0.006));
  // the lever (swings) with the trigger hand riding in it
  const lever = new THREE.Group();
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.006, 8, 20), M.brass);
  loop.rotation.y = Math.PI / 2;
  loop.position.set(0, -0.07, 0.07);
  lever.add(loop);
  lever.add(box(0.012, 0.012, 0.12, M.brass, 0, -0.032, 0.0));
  lever.position.set(0, -0.02, -0.02);
  g.add(lever);
  const trigger = new THREE.Group();
  trigger.position.set(0, -0.032, 0.022);
  trigger.add(box(0.005, 0.02, 0.007, M.blued, 0, -0.008, 0));
  g.add(trigger);
  g.add(box(0.004, 0.014, 0.04, M.black, 0.029, -0.008, -0.03));       // loading gate
  g.add(gripHand(V(0, -0.03, 0.12), V(0, -0.115, 0.16), 1, M, { trigger: V(0, -0.045, 0.02), halfW: 0.026, halfD: 0.024, armDir: V(0.3, -0.5, 1) }));
  const support = recenter(supportHand(V(0, -0.006, -0.32), 0.03, M), V(0, -0.006, -0.32));
  g.add(support);
  const fist = leftFist(M, { halfW: 0.013, halfD: 0.013 });
  const cartridge = cartridgeMesh(M);
  cartridge.position.set(0, 0.05, -0.014);
  fist.add(cartridge);
  const chip = chipCarry(fist);
  fist.visible = false;
  g.add(fist);
  g.userData = {
    kind: 'rifle', lever, support, supportBase: support.position.clone(), trigger, fist, carry: { cartridge, chip },
    gate: V(0.031, -0.008, -0.03), muzzle: V(0, 0.036, -0.88),
  };
  return g;
}

// ------------------------------- the new six ---------------------------------
/** brass cartridges held side by side (for break-actions), noses toward -Z */
function roundPair(M, n, r, len, spacing, axis = 'y') {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const o = (i - (n - 1) / 2) * spacing;
    const c = new THREE.Group();
    c.add(cyl(r, len, M.brass, 0, 0, 0, 10));
    c.add(cyl(r * 1.12, len * 0.08, M.brass, 0, 0, len * 0.46, 10));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(r * 0.95, len * 0.4, 10), M.lead);
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = -len * 0.66;
    c.add(tip);
    c.position[axis] = o;
    g.add(c);
  }
  return g;
}

/** THE ACE UP THE SLEEVE — gold-framed over/under derringer, pearl bird's-head grip */
function derringer(M) {
  const g = new THREE.Group();
  g.add(profile([[-0.05, 0.03], [0.07, 0.03], [0.075, -0.004], [0.03, -0.02], [-0.02, -0.03], [-0.055, -0.02]], 0.034, M.gold));
  g.add(profile([[-0.02, -0.02], [-0.045, -0.1], [-0.07, -0.122], [-0.095, -0.108], [-0.085, -0.03], [-0.055, -0.012]], 0.04, M.pearl, 0.005));
  const ace = labelPlane(0.026, 0.034, (c, w, h) => {
    c.fillStyle = '#f6f0e4'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#1a1208'; c.lineWidth = 8; c.strokeRect(4, 4, w - 8, h - 8);
    c.fillStyle = '#1a1208'; c.font = `bold ${h * 0.55}px Georgia, serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('♠', w / 2, h * 0.56);
  });
  ace.position.set(0.0206, -0.07, 0.07);
  ace.rotation.set(0, Math.PI / 2, -0.25);
  g.add(ace);
  // barrels tip down on a hinge at the front of the frame
  const hinge = new THREE.Group();
  hinge.position.set(0, 0.006, -0.065);
  hinge.add(box(0.03, 0.058, 0.158, M.nickel, 0, 0.03, -0.021));
  for (const y of [0.018, 0.044]) {
    hinge.add(cyl(0.0108, 0.162, M.nickel, 0, y, -0.021, 16));
    hinge.add(cyl(0.012, 0.01, M.gold, 0, y, -0.1, 16));
    hinge.add(cyl(0.0065, 0.011, M.black, 0, y, -0.1015, 10));
  }
  hinge.add(box(0.034, 0.006, 0.15, M.gold, 0, 0.062, -0.02));
  hinge.add(box(0.004, 0.006, 0.008, M.glowGold, 0, 0.068, -0.09));
  const rounds = new THREE.Group();
  for (const y of [0.018, 0.044]) {
    rounds.add(cyl(0.0098, 0.004, M.brass, 0, y, 0.059, 12));
    rounds.add(cyl(0.003, 0.002, M.copper, 0, y, 0.0615, 8));
  }
  hinge.add(rounds);
  g.add(hinge);
  // spur hammer + spur trigger
  const hammer = new THREE.Group();
  hammer.position.set(0, 0.03, 0.02);
  hammer.add(box(0.01, 0.028, 0.012, M.nickel, 0, 0.012, 0.004));
  g.add(hammer);
  const trigger = new THREE.Group();
  trigger.position.set(0, -0.022, 0.0);
  trigger.add(box(0.006, 0.02, 0.008, M.gold, 0, -0.009, 0));
  g.add(trigger);
  g.add(gripHand(V(0, -0.03, 0.022), V(0, -0.108, 0.058), 1, M, { trigger: V(0, -0.028, 0.0), halfW: 0.021, halfD: 0.021 }));
  const fist = leftFist(M, { halfW: 0.012, halfD: 0.012, len: 0.06 });
  const carry = roundPair(M, 2, 0.0085, 0.026, 0.026);
  carry.position.set(0, 0.05, -0.012);
  fist.add(carry);
  const chip = chipCarry(fist);
  fist.visible = false;
  g.add(fist);
  g.userData = {
    kind: 'break', hinge, openAngle: -1.0, rounds, chambers: [V(0, 0.018, 0.06), V(0, 0.044, 0.06)], casings: 2,
    hammer, trigger, fist, carry: { rounds: carry, chip }, muzzle: V(0, 0.05, -0.17),
  };
  return g;
}

/** THE MAGNUM — a break-open cork cannon built around a champagne bottle */
function magnum(M) {
  const g = new THREE.Group();
  g.add(profile([[-0.1, 0.05], [0.1, 0.05], [0.1, -0.02], [0.05, -0.045], [-0.1, -0.04]], 0.07, M.brass));
  g.add(profile([[-0.1, 0.035], [-0.4, 0.025], [-0.52, 0.045], [-0.55, -0.12], [-0.46, -0.14], [-0.2, -0.06], [-0.15, -0.13], [-0.1, -0.13], [-0.08, -0.04]], 0.06, M.walnut, 0.006));
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.004, 6, 18, Math.PI), M.gold);
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  guard.position.set(0, -0.043, 0.035);
  g.add(guard);
  const trigger = new THREE.Group();
  trigger.position.set(0, -0.04, 0.035);
  trigger.add(box(0.006, 0.024, 0.008, M.gold, 0, -0.01, 0));
  g.add(trigger);
  // the bottle barrel on its hinge
  const hinge = new THREE.Group();
  hinge.position.set(0, -0.02, -0.095);
  const bottle = new THREE.Mesh(lathe([[0.046, 0], [0.048, 0.02], [0.048, 0.3], [0.036, 0.35], [0.024, 0.39], [0.022, 0.5], [0.026, 0.505], [0.026, 0.52], [0.016, 0.525], [0, 0.525]], 28), M.bottle);
  bottle.geometry.rotateX(-Math.PI / 2);
  bottle.position.set(0, 0.052, 0.03);
  hinge.add(bottle);
  hinge.add(cyl(0.029, 0.16, M.foil, 0, 0.052, 0.03 - 0.44, 18));               // foil over the neck
  for (const z of [-0.36, -0.46]) {
    const wire = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.002, 6, 20), M.chrome);
    wire.position.set(0, 0.052, z);
    hinge.add(wire);
  }
  const label = labelPlane(0.1, 0.06, (c, w, h) => {
    c.fillStyle = '#efe4c8'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#8a6a10'; c.lineWidth = 6; c.strokeRect(6, 6, w - 12, h - 12);
    c.fillStyle = '#1a1008'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `bold ${h * 0.3}px Georgia, serif`; c.fillText('MAGNUM', w / 2, h * 0.42);
    c.font = `italic ${h * 0.16}px Georgia, serif`; c.fillText('brut · 1899', w / 2, h * 0.72);
  }, { transparent: false });
  label.position.set(-0.049, 0.052, -0.15);
  label.rotation.y = -Math.PI / 2;
  hinge.add(label);
  const rounds = new THREE.Group();
  rounds.add(cyl(0.034, 0.006, M.foil, 0, 0.052, 0.034, 20));                  // the loaded cork's foil base
  hinge.add(rounds);
  g.add(hinge);
  const support = recenter(supportHand(V(0, 0.032, -0.3), 0.049, M), V(0, 0.032, -0.3));
  g.add(support);
  g.add(gripHand(V(0, -0.045, 0.085), V(0, -0.13, 0.135), 1, M, { trigger: V(0, -0.05, 0.035), halfW: 0.028, halfD: 0.024, armDir: V(0.3, -0.5, 1) }));
  const fist = leftFist(M, { halfW: 0.016, halfD: 0.016 });
  const shell = new THREE.Group();
  shell.add(cyl(0.032, 0.03, M.foil, 0, 0, 0.012, 18));
  shell.add(cyl(0.021, 0.036, M.cork, 0, 0, -0.018, 14));
  shell.add(cyl(0.028, 0.018, M.cork, 0, 0, -0.042, 14));
  shell.position.set(0, 0.058, -0.012);
  fist.add(shell);
  const chip = chipCarry(fist);
  fist.visible = false;
  g.add(fist);
  g.userData = {
    kind: 'break', hinge, openAngle: -0.72, rounds, chambers: [V(0, 0.052, 0.04)], casings: 0, support, supportBase: support.position.clone(),
    trigger, fist, carry: { shell, chip }, muzzle: V(0, 0.032, -0.6),
  };
  return g;
}

/** THE WHALE — side-by-side big-game double rifle, engraved gold, walnut */
function whale(M) {
  const g = new THREE.Group();
  g.add(profile([[-0.12, 0.066], [0.1, 0.068], [0.1, -0.004], [0.06, -0.045], [-0.12, -0.04]], 0.074, M.blued));
  for (const x of [-0.038, 0.038]) {
    const plate = labelPlane(0.17, 0.07, (c, w, h) => {
      c.fillStyle = '#b8902a'; c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(60,40,5,0.8)'; c.lineWidth = 2;
      for (let i = 0; i < 18; i++) { c.beginPath(); c.arc(w * (0.2 + (i % 6) * 0.13), h * (0.3 + Math.floor(i / 6) * 0.2), 10 + (i % 3) * 4, 0, Math.PI * 1.4); c.stroke(); }
      c.font = `bold ${h * 0.36}px Georgia, serif`; c.fillStyle = '#2a1a04'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('🐋', w * 0.5, h * 0.52);
    }, { metalness: 0.9, roughness: 0.3, transparent: false });
    plate.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2;
    plate.position.set(x * 1.01, 0.018, 0.0);
    g.add(plate);
  }
  g.add(profile([[-0.12, 0.05], [-0.4, 0.04], [-0.53, 0.06], [-0.56, -0.13], [-0.47, -0.15], [-0.2, -0.07], [-0.15, -0.13], [-0.1, -0.13], [-0.08, -0.04]], 0.062, M.walnut, 0.007));
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.027, 0.004, 6, 18, Math.PI), M.gold);
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  guard.position.set(0, -0.044, 0.04);
  g.add(guard);
  const trigger = new THREE.Group();
  trigger.position.set(0, -0.04, 0.04);
  trigger.add(box(0.006, 0.026, 0.008, M.gold, 0, -0.011, 0));
  g.add(trigger);
  const hinge = new THREE.Group();
  hinge.position.set(0, -0.02, -0.1);
  for (const x of [-0.025, 0.025]) {
    hinge.add(cyl(0.024, 0.72, M.blued, x, 0.056, -0.34, 20));
    hinge.add(cyl(0.012, 0.012, M.black, x, 0.056, -0.705, 12));
  }
  hinge.add(box(0.022, 0.012, 0.7, M.blued, 0, 0.086, -0.34));
  hinge.add(box(0.01, 0.016, 0.012, M.gold, 0, 0.1, -0.67));
  hinge.add(box(0.005, 0.005, 0.005, M.glowGold, 0, 0.11, -0.67));
  hinge.add(box(0.04, 0.02, 0.012, M.gold, 0, 0.098, -0.05));                        // express rear sight
  hinge.add(profile([[0.02, 0.028], [0.33, 0.028], [0.34, -0.018], [0.03, -0.024]], 0.062, M.walnut, 0.006));
  const rounds = new THREE.Group();
  for (const x of [-0.025, 0.025]) rounds.add(cyl(0.02, 0.005, M.brass, x, 0.056, 0.022, 14));
  hinge.add(rounds);
  g.add(hinge);
  const support = recenter(supportHand(V(0, -0.01, -0.36), 0.036, M), V(0, -0.01, -0.36));
  g.add(support);
  g.add(gripHand(V(0, -0.045, 0.09), V(0, -0.13, 0.14), 1, M, { trigger: V(0, -0.05, 0.04), halfW: 0.028, halfD: 0.024, armDir: V(0.3, -0.5, 1) }));
  const fist = leftFist(M, { halfW: 0.016, halfD: 0.016 });
  const carry = roundPair(M, 2, 0.013, 0.07, 0.05, 'x');
  carry.position.set(0, 0.056, -0.02);
  fist.add(carry);
  const chip = chipCarry(fist);
  fist.visible = false;
  g.add(fist);
  g.userData = {
    kind: 'break', hinge, openAngle: -0.55, rounds, chambers: [V(-0.025, 0.056, 0.03), V(0.025, 0.056, 0.03)], casings: 2,
    support, supportBase: support.position.clone(), trigger, fist, carry: { rounds: carry, chip }, muzzle: V(0, 0.036, -0.82),
  };
  return g;
}

/** THE LOAN SHARK — drum-fed tommy gun: walnut furniture, finned barrel, Cutts compensator */
function tommy(M) {
  const g = new THREE.Group();
  g.add(profile([[-0.14, 0.05], [0.13, 0.05], [0.15, 0.02], [0.15, -0.03], [0.1, -0.035], [-0.14, -0.03]], 0.058, M.blued));
  g.add(cyl(0.016, 0.44, M.blued, 0, 0.014, -0.36, 14));
  for (let i = 0; i < 14; i++) g.add(cyl(0.025, 0.006, M.blued, 0, 0.014, -0.17 - i * 0.017, 16));
  const comp = cyl(0.021, 0.07, M.blued, 0, 0.014, -0.6, 14);
  g.add(comp);
  for (let i = 0; i < 3; i++) g.add(box(0.044, 0.004, 0.008, M.black, 0, 0.034, -0.58 - i * 0.016));
  g.add(box(0.012, 0.022, 0.012, M.blued, 0, 0.056, -0.6));
  g.add(box(0.004, 0.005, 0.005, M.glowGold, 0, 0.068, -0.6));
  g.add(box(0.03, 0.03, 0.02, M.blued, 0, 0.065, 0.1));                                // ladder sight
  // walnut: pistol grip, butt stock, vertical foregrip
  g.add(profile([[-0.03, -0.03], [-0.055, -0.155], [-0.095, -0.16], [-0.085, -0.03]], 0.05, M.walnut, 0.006));
  g.add(profile([[-0.14, 0.038], [-0.45, 0.02], [-0.5, 0.03], [-0.52, -0.12], [-0.44, -0.13], [-0.14, -0.03]], 0.05, M.walnut, 0.006));
  g.add(profile([[0.26, -0.01], [0.27, -0.13], [0.3, -0.14], [0.335, -0.13], [0.33, -0.01]], 0.044, M.walnut, 0.006));
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.0045, 6, 18, Math.PI), M.blued);
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  guard.position.set(0, -0.035, 0.01);
  g.add(guard);
  const trigger = new THREE.Group();
  trigger.position.set(0, -0.03, 0.012);
  trigger.add(box(0.006, 0.022, 0.008, M.chrome, 0, -0.01, 0));
  g.add(trigger);
  // the cocking knob rides on top
  const charger = new THREE.Group();
  charger.position.set(0, 0.058, 0.02);
  charger.add(new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), M.chrome));
  g.add(charger);
  const drum = () => {
    const d = new THREE.Group();
    const body = cyl(0.078, 0.046, M.blued, 0, -0.085, 0, 28);
    body.rotation.set(0, 0, Math.PI / 2);
    d.add(body);
    const face = cyl(0.05, 0.05, M.black, 0, -0.085, 0, 20);
    face.rotation.set(0, 0, Math.PI / 2);
    d.add(face);
    const key = cyl(0.012, 0.056, M.chrome, 0, -0.085, 0, 10);
    key.rotation.set(0, 0, Math.PI / 2);
    d.add(key);
    d.add(box(0.03, 0.02, 0.05, M.blued, 0, -0.005, 0));
    return d;
  };
  const mag = drum();
  mag.position.set(0, -0.025, -0.085);
  g.add(mag);
  g.add(gripHand(V(0, -0.04, 0.06), V(0, -0.155, 0.08), 1, M, { trigger: V(0, -0.042, 0.012), halfW: 0.024, halfD: 0.022 }));
  const fist = leftFist(M, { halfW: 0.018, halfD: 0.018, len: 0.085 });
  fist.position.set(0, -0.075, -0.3);
  const handMag = drum();
  handMag.position.set(0, 0.2, 0.004);
  handMag.visible = false;
  fist.add(handMag);
  const chip = chipCarry(fist);
  g.add(fist);
  g.userData = {
    kind: 'mag', mag, magBase: mag.position.clone(), magDrop: V(0, -0.05, 0), charger, chargerAxis: V(0, 0, 0.06), chargerGrab: V(0, 0.035, 0),
    trigger, fist, fistRest: fist.position.clone(), handMagOffset: handMag.position.clone(),
    carry: { mag: handMag, chip }, muzzle: V(0, 0.014, -0.64),
  };
  return g;
}

/** THE DEALER'S SHOE — a mahogany card shoe that deals razor cards at the dead */
function shoe(M) {
  const g = new THREE.Group();
  g.add(profile([[-0.12, 0.07], [0.2, 0.045], [0.26, 0.004], [0.26, -0.035], [-0.12, -0.035]], 0.078, M.walnut, 0.005));
  // brass corner caps at the mouth
  for (const x of [-0.037, 0.037]) g.add(box(0.008, 0.042, 0.02, M.brass, x, -0.014, -0.25));
  for (const x of [-0.04, 0.04]) {
    g.add(box(0.004, 0.006, 0.38, M.brass, x, -0.034, -0.07));
    const rail = box(0.004, 0.006, 0.33, M.brass, x, 0.058, -0.04);
    rail.rotation.x = 0.078;
    g.add(rail);
  }
  const plate = labelPlane(0.16, 0.05, (c, w, h) => {
    c.fillStyle = '#c8962e'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#3a2808'; c.lineWidth = 5; c.strokeRect(4, 4, w - 8, h - 8);
    c.fillStyle = '#2a1a04'; c.font = `bold ${h * 0.5}px Georgia, serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('♠ DEALER ♠', w / 2, h * 0.54);
  }, { metalness: 0.9, roughness: 0.3, transparent: false });
  plate.position.set(-0.0405, 0.012, -0.06);        // the side you can see from the hip
  plate.rotation.y = -Math.PI / 2;
  g.add(plate);
  // a glass window on top shows the deck inside
  const win = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.004, 0.18), M.glassClear);
  win.position.set(0, 0.062, -0.02);
  win.rotation.x = 0.078;
  g.add(win);
  for (let i = 0; i < 12; i++) g.add(box(0.044, 0.003, 0.064, i % 3 === 0 ? M.shellRed : M.cardEdge, 0, 0.036 + i * 0.0018, -0.02 - i * 0.012));
  // the mouth and the card waiting in it
  g.add(box(0.07, 0.022, 0.012, M.black, 0, -0.012, -0.262));
  const cardTex = labelPlane(0.05, 0.07, (c, w, h) => {
    c.fillStyle = '#9a0a18'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#f4efe2'; c.lineWidth = 8; c.strokeRect(8, 8, w - 16, h - 16);
    c.strokeStyle = 'rgba(244,239,226,0.6)'; c.lineWidth = 3;
    for (let k = -h; k < w + h; k += 22) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + h, h); c.stroke(); c.beginPath(); c.moveTo(k + h, 0); c.lineTo(k, h); c.stroke(); }
  }, { transparent: false, side: THREE.DoubleSide });
  const card = new THREE.Group();
  cardTex.rotation.x = -Math.PI / 2;
  card.add(cardTex);
  card.position.set(0, -0.012, -0.27);
  g.add(card);
  // ebony pistol grip with brass trim
  g.add(profile([[-0.035, -0.03], [-0.06, -0.155], [-0.1, -0.16], [-0.088, -0.03]], 0.05, M.ebony, 0.005));
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.0045, 6, 18, Math.PI), M.brass);
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  guard.position.set(0, -0.037, 0.01);
  g.add(guard);
  const trigger = new THREE.Group();
  trigger.position.set(0, -0.032, 0.012);
  trigger.add(box(0.006, 0.022, 0.008, M.brass, 0, -0.01, 0));
  g.add(trigger);
  // the deck (magazine) slots up into the belly
  const deck = () => {
    const d = new THREE.Group();
    d.add(box(0.06, 0.1, 0.09, M.cherry, 0, -0.05, 0));
    for (let i = 0; i < 6; i++) d.add(box(0.062, 0.004, 0.086, i % 2 ? M.cardEdge : M.shellRed, 0, -0.012 - i * 0.015, 0));
    d.add(box(0.064, 0.012, 0.094, M.brass, 0, -0.1, 0));
    return d;
  };
  const mag = deck();
  mag.position.set(0, -0.03, -0.1);
  g.add(mag);
  const support = recenter(supportHand(V(0, -0.052, -0.2), 0.034, M), V(0, -0.052, -0.2));
  g.add(support);
  g.add(gripHand(V(0, -0.04, 0.06), V(0, -0.155, 0.08), 1, M, { trigger: V(0, -0.042, 0.012), halfW: 0.024, halfD: 0.022 }));
  const fist = leftFist(M, { halfW: 0.018, halfD: 0.018, len: 0.085 });
  const handMag = deck();
  handMag.position.set(0, 0.2, 0.004);
  handMag.visible = false;
  fist.add(handMag);
  const chip = chipCarry(fist);
  fist.visible = false;
  g.add(fist);
  g.userData = {
    kind: 'mag', mag, magBase: mag.position.clone(), magDrop: V(0, -0.07, 0), card, cardRest: card.position.clone(),
    support, supportBase: support.position.clone(), trigger, fist, handMagOffset: handMag.position.clone(),
    carry: { mag: handMag, chip }, muzzle: V(0, -0.012, -0.29), noFlash: true,
  };
  return g;
}

/** CHERRIES JUBILEE — the bartender's flambé torch: red lacquer, copper tank, a blue pilot flame */
function jubilee(M) {
  const g = new THREE.Group();
  g.add(cyl(0.034, 0.34, M.lacquer, 0, 0.012, -0.12, 20));
  for (const z of [0.04, -0.1, -0.26]) g.add(cyl(0.037, 0.014, M.gold, 0, 0.012, z, 20));
  const nozzle = new THREE.Mesh(lathe([[0.034, 0], [0.022, 0.06], [0.014, 0.14], [0.018, 0.16], [0.02, 0.17], [0.012, 0.17]], 18), M.brass);
  nozzle.geometry.rotateX(-Math.PI / 2);
  nozzle.position.set(0, 0.012, -0.29);
  g.add(nozzle);
  // pilot light under the tip, shielded by a little brass hood
  const pilot = new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 8), M.blueFlame);
  pilot.position.set(0, -0.012, -0.455);
  g.add(pilot);
  g.add(box(0.02, 0.004, 0.03, M.brass, 0, -0.002, -0.448));
  g.add(cyl(0.004, 0.08, M.copper, 0, -0.012, -0.41, 6));
  // pressure gauge
  const gauge = labelPlane(0.05, 0.05, (c, w, h) => {
    c.fillStyle = '#f4efe2'; c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#1a1208'; c.lineWidth = 6; c.stroke();
    c.strokeStyle = '#b3122e'; c.lineWidth = 10; c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 22, -0.3, 0.9); c.stroke();
    c.strokeStyle = '#1a1208'; c.lineWidth = 5; c.beginPath(); c.moveTo(w / 2, h / 2); c.lineTo(w * 0.78, h * 0.3); c.stroke();
  });
  gauge.position.set(-0.0385, 0.02, -0.02);
  gauge.rotation.y = -Math.PI / 2;
  g.add(gauge);
  const bezel = cyl(0.028, 0.012, M.brass, -0.034, 0.02, -0.02, 18);
  bezel.rotation.set(0, 0, Math.PI / 2);
  g.add(bezel);
  // walnut grip
  g.add(profile([[-0.03, -0.018], [-0.055, -0.15], [-0.095, -0.155], [-0.085, -0.018]], 0.05, M.walnut, 0.006));
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.0045, 6, 18, Math.PI), M.brass);
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  guard.position.set(0, -0.025, 0.01);
  g.add(guard);
  const trigger = new THREE.Group();
  trigger.position.set(0, -0.02, 0.012);
  trigger.add(box(0.006, 0.024, 0.008, M.brass, 0, -0.01, 0));
  g.add(trigger);
  // valve knob on the left (the "charger" you twist after a tank swap)
  const charger = new THREE.Group();
  charger.position.set(-0.04, 0.012, -0.16);
  const knob = cyl(0.012, 0.016, M.chrome, 0, 0, 0, 12);
  knob.rotation.set(0, 0, Math.PI / 2);
  charger.add(knob);
  g.add(charger);
  // the copper fuel tank (magazine) hangs under the body
  const tank = () => {
    const t = new THREE.Group();
    const body = cyl(0.036, 0.16, M.copper, 0, -0.05, 0, 18);
    t.add(body);
    for (const z of [-0.08, 0.08]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.036, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.copper);
      cap.rotation.x = z < 0 ? -Math.PI / 2 : Math.PI / 2;
      cap.position.set(0, -0.05, z);
      t.add(cap);
    }
    t.add(box(0.018, 0.03, 0.03, M.brass, 0, -0.012, 0));
    t.add(cyl(0.038, 0.01, M.brass, 0, -0.05, 0.04, 18));
    return t;
  };
  const mag = tank();
  mag.position.set(0, -0.01, -0.05);
  g.add(mag);
  const support = recenter(supportHand(V(0, 0.012, -0.24), 0.036, M), V(0, 0.012, -0.24));
  g.add(support);
  g.add(gripHand(V(0, -0.028, 0.06), V(0, -0.145, 0.08), 1, M, { trigger: V(0, -0.032, 0.012), halfW: 0.024, halfD: 0.022 }));
  const fist = leftFist(M, { halfW: 0.02, halfD: 0.02, len: 0.085 });
  const handMag = tank();
  handMag.position.set(0, 0.22, 0.004);
  handMag.visible = false;
  fist.add(handMag);
  const chip = chipCarry(fist);
  fist.visible = false;
  g.add(fist);
  g.userData = {
    kind: 'mag', mag, magBase: mag.position.clone(), magDrop: V(0, -0.06, 0), charger, chargerAxis: V(-0.012, 0, 0), chargerGrab: V(-0.03, -0.02, 0.01),
    support, supportBase: support.position.clone(), trigger, fist, handMagOffset: handMag.position.clone(),
    carry: { mag: handMag, chip }, muzzle: V(0, 0.012, -0.47), pilot, noFlash: true,
  };
  return g;
}

/** a slot reel strip (7, cherry, bar, bell...) wrapped around a little drum */
let _reelTex = null;
function reelTexture() {
  if (_reelTex) return _reelTex;
  // symbols run round the drum, turned a quarter so they read upright on the
  // gun's left flank (the reels share one axle along the barrel)
  const cv = makeCanvas(512, 128), c = cv.getContext('2d');
  c.fillStyle = '#f6efe0'; c.fillRect(0, 0, 512, 128);
  const syms = [['7', '#b3122e'], ['🍒', '#b3122e'], ['BAR', '#141414'], ['🔔', '#c9a227'], ['7', '#b3122e'], ['♣', '#1a7a3a'], ['BAR', '#141414'], ['💎', '#2a6aff']];
  syms.forEach(([s, col], i) => {
    c.save();
    c.translate(32 + i * 64, 64);
    c.rotate(-Math.PI / 2);
    c.fillStyle = col; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = s === 'BAR' ? 'bold 30px Georgia, serif' : 'bold 46px Georgia, serif';
    c.fillText(s, 0, 2);
    c.restore();
    c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(i * 64 + 62, 0, 2, 128);
  });
  _reelTex = toTexture(cv);
  return _reelTex;
}

/** LADY LUCK — the wonder weapon: gold, ivory, an emerald chamber, three reels, a lever, dice */
function luck(M) {
  const g = new THREE.Group();
  const emerald = new THREE.MeshStandardMaterial({ color: 0x0a3a1a, emissive: 0x2dff7a, emissiveIntensity: 2.6, roughness: 0.1 });
  const greenGlass = new THREE.MeshStandardMaterial({ color: 0x7affb0, metalness: 0.1, roughness: 0.02, transparent: true, opacity: 0.28, depthWrite: false });
  // the body: an art-deco torpedo in gold with ivory bands
  const body = new THREE.Mesh(lathe([[0.0, 0], [0.028, 0.004], [0.042, 0.04], [0.054, 0.13], [0.05, 0.2], [0.036, 0.29], [0.03, 0.33], [0.0, 0.335]], 28), M.gold);
  body.geometry.rotateX(-Math.PI / 2);
  body.position.set(0, 0.03, 0.12);
  g.add(body);
  for (const z of [0.04, -0.06, -0.14]) g.add(cyl(0.052 - (z < -0.1 ? 0.008 : 0), 0.012, M.ivory, 0, 0.03, z, 24));
  // emitter rings + the glowing tip
  const rings = [];
  [[-0.225, 0.036], [-0.255, 0.031], [-0.285, 0.026]].forEach(([z, r]) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0045, 8, 24), M.gold);
    ring.position.set(0, 0.03, z);
    g.add(ring);
    rings.push(ring);
  });
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.013, 14, 10), emerald);
  tip.position.set(0, 0.03, -0.305);
  g.add(tip);
  // the emerald chamber with THE GREEN ZERO inside
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 14), greenGlass);
  dome.position.set(0, 0.086, -0.035);
  g.add(dome);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 8, 24), M.gold);
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, 0.07, -0.035);
  g.add(collar);
  const zero = new THREE.Mesh(new THREE.SphereGeometry(0.014, 14, 10), emerald);
  zero.position.set(0, 0.086, -0.035);
  g.add(zero);
  // three slot reels on the left flank
  const reelMat = new THREE.MeshStandardMaterial({ map: reelTexture(), roughness: 0.4, emissive: 0xffffff, emissiveMap: reelTexture(), emissiveIntensity: 0.35 });
  const reels = [];
  g.add(box(0.012, 0.05, 0.12, M.black, -0.05, 0.035, -0.04));
  for (let i = 0; i < 3; i++) {
    const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.03, 16, 1, true), reelMat);
    reel.rotation.x = Math.PI / 2;      // axle along the barrel, faces out the left flank
    const holder = new THREE.Group();
    holder.position.set(-0.05, 0.035, -0.08 + i * 0.04);
    holder.add(reel);
    g.add(holder);
    reels.push(holder);
  }
  g.add(box(0.004, 0.056, 0.126, M.gold, -0.057, 0.035, -0.04));
  // ivory grip with gold trim, the loaded dice hanging off the butt
  g.add(profile([[-0.03, -0.012], [-0.055, -0.15], [-0.095, -0.155], [-0.085, -0.012]], 0.05, M.ivory, 0.006));
  g.add(box(0.052, 0.008, 0.07, M.gold, 0, -0.012, 0.06));
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.0045, 6, 18, Math.PI), M.gold);
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  guard.position.set(0, -0.022, 0.01);
  g.add(guard);
  const trigger = new THREE.Group();
  trigger.position.set(0, -0.017, 0.012);
  trigger.add(box(0.006, 0.024, 0.008, M.gold, 0, -0.01, 0));
  g.add(trigger);
  const dice = new THREE.Group();
  dice.position.set(0, -0.155, 0.09);
  const chain = cyl(0.0015, 0.04, M.gold, 0, -0.02, 0, 4);
  chain.rotation.set(0, 0, 0);                        // hangs straight down
  dice.add(chain);
  const dieMat = M.shellRed;
  for (const [x, y, r] of [[-0.008, -0.045, 0.4], [0.009, -0.05, -0.3]]) {
    const d = box(0.016, 0.016, 0.016, dieMat, x, y, 0);
    d.rotation.set(r, r * 1.3, 0);
    dice.add(d);
  }
  g.add(dice);
  // THE BANDIT'S ARM: the lever you rack after a reload
  const charger = new THREE.Group();
  charger.position.set(-0.052, 0.05, 0.06);
  const rod = cyl(0.0045, 0.08, M.chrome, 0, 0.04, 0, 8);
  rod.rotation.set(0, 0, 0);                          // stands upright
  charger.add(rod);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), M.shellRed);
  knob.position.set(0, 0.082, 0);
  charger.add(knob);
  g.add(charger);
  // the magazine: a clear tube of green chips
  const chipRack = () => {
    const r = new THREE.Group();
    const tube = cyl(0.022, 0.1, greenGlass, 0, -0.05, 0, 16);
    tube.rotation.set(0, 0, 0);                       // vertical
    r.add(tube);
    for (let i = 0; i < 8; i++) {
      const chip = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.009, 16), i % 2 ? emerald : M.gold);
      chip.position.y = -0.008 - i * 0.011;
      r.add(chip);
    }
    const cap = cyl(0.024, 0.01, M.gold, 0, -0.1, 0, 16);
    cap.rotation.set(0, 0, 0);
    r.add(cap);
    return r;
  };
  const mag = chipRack();
  mag.position.set(0, -0.012, -0.07);
  g.add(mag);
  const support = recenter(supportHand(V(0, 0.03, -0.17), 0.047, M), V(0, 0.03, -0.17));
  g.add(support);
  g.add(gripHand(V(0, -0.03, 0.06), V(0, -0.145, 0.08), 1, M, { trigger: V(0, -0.032, 0.012), halfW: 0.024, halfD: 0.022 }));
  const fist = leftFist(M, { halfW: 0.02, halfD: 0.02, len: 0.085 });
  const handMag = chipRack();
  handMag.position.set(0, 0.2, 0.004);
  handMag.visible = false;
  fist.add(handMag);
  const chip = chipCarry(fist);
  fist.visible = false;
  g.add(fist);
  g.userData = {
    kind: 'mag', mag, magBase: mag.position.clone(), magDrop: V(0, -0.06, 0), charger, chargerAxis: V(0, -0.035, 0.02), chargerGrab: V(-0.02, 0.06, 0),
    chargeSfx: 'lever', support, supportBase: support.position.clone(), trigger, fist, handMagOffset: handMag.position.clone(),
    carry: { mag: handMag, chip }, muzzle: V(0, 0.03, -0.31), noFlash: true, reels, rings, zero, tip, dice,
  };
  return g;
}

const BUILDERS = { pistol, derringer, shotgun, smg, tommy, shoe, rifle, magnum, whale, jubilee, luck };

export function buildViewmodels() {
  const M = mats();
  const out = {};
  for (const [id, fn] of Object.entries(BUILDERS)) out[id] = fn(M);
  // the SMG's mag swap is the generic magazine choreography
  Object.assign(out.smg.userData, {
    kind: 'mag', magBase: out.smg.userData.mag.position.clone(), magDrop: V(0, -0.06, 0),
    chargerAxis: V(0, 0, 0.045), chargerGrab: V(-0.016, -0.04, 0), handMagOffset: V(0, 0.265, 0.004),
  });
  return out;
}

/** a gloved right hand closed around a vertical stem at the origin (for drinking) */
export function stemHand() {
  const M = mats();
  return gripHand(V(0, 0.1, 0), V(0, 0.015, 0), 1, M, { halfW: 0.009, halfD: 0.009, armDir: V(0.35, -0.95, 0.45) });
}

/** a gun on its own — no hands — for THE BIG SIX's prize pedestal */
export function buildWorldGun(id) {
  const M = mats();
  const gun = BUILDERS[id](M);
  const strip = [];
  gun.traverse((o) => { if (o.userData.hand || o === gun.userData.fist || o === gun.userData.support) strip.push(o); });
  for (const o of strip) o.parent?.remove(o);
  return gun;
}

/** star-shaped muzzle flash texture */
export function flashTexture() {
  if (STYLE.cartoon) return toonTexture('bang');
  const S = 128, cv = makeCanvas(S), c = cv.getContext('2d');
  c.translate(S / 2, S / 2);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, S / 2);
  g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(0.2, 'rgba(255,220,140,0.9)'); g.addColorStop(0.5, 'rgba(255,140,40,0.35)'); g.addColorStop(1, 'rgba(255,80,0,0)');
  c.fillStyle = g;
  c.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, r = i % 2 ? S * 0.16 : S * (0.36 + (i % 4 === 0 ? 0.12 : 0));
    if (i === 0) c.moveTo(Math.cos(a) * r, Math.sin(a) * r); else c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  c.closePath(); c.fill();
  c.beginPath(); c.arc(0, 0, S * 0.18, 0, Math.PI * 2); c.fill();
  return toTexture(cv, { srgb: false });
}
