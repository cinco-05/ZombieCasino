// vegas.js — the set pieces that make the building feel like the Strip:
//   ALL IN              the house's pack-a-punch: a gilded slot-press with a lever
//   THE CAGE bench      where LADY LUCK gets built, her three parts on a velvet tray
//   the parts           THE GREEN ZERO, THE LOADED DICE, THE BANDIT'S ARM
//   the craps table     real felt layout, rails, and dice that roll
//   the WELCOME sign    "Welcome to Fabulous LOST WAGES, Nevada"
//   the keno board      80 numbers, 20 drawn at a time, live
//   the Strip           a painted night skyline for the one window in the house

import * as THREE from 'three';
import { makeCanvas, toTexture, noiseCanvas, metalCanvas, rng } from './texkit.js';

const lathe = (pts, segs = 24) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);
const at = (m, x, y, z) => { m.position.set(x, y, z); return m; };
const box = (w, h, d, mat, x = 0, y = 0, z = 0) => at(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat), x, y, z);

let _V = null;
function mats() {
  if (_V) return _V;
  _V = {
    gold: new THREE.MeshStandardMaterial({ color: 0xe0b040, metalness: 1, roughness: 0.24 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xeef0f4, metalness: 1, roughness: 0.1 }),
    lacquer: new THREE.MeshStandardMaterial({ color: 0x0a0608, metalness: 0.3, roughness: 0.2 }),
    wine: new THREE.MeshStandardMaterial({ color: 0x3a0610, metalness: 0.45, roughness: 0.25 }),
    steel: new THREE.MeshStandardMaterial({ map: toTexture(metalCanvas(256, '#6a6e78', 31)), metalness: 0.85, roughness: 0.35 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x3a1c0a, roughness: 0.45 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x1a0a08, roughness: 0.4 }),
    velvet: new THREE.MeshStandardMaterial({ color: 0x5a0a16, roughness: 0.95 }),
    red: new THREE.MeshStandardMaterial({ color: 0xb3122e, roughness: 0.25, metalness: 0.1 }),
    redGlow: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff1a2a, emissiveIntensity: 2 }),
    emerald: new THREE.MeshStandardMaterial({ color: 0x0a3a1a, emissive: 0x2dff7a, emissiveIntensity: 2.4, roughness: 0.08 }),
    bulb: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffd9a0, emissiveIntensity: 3 }),
    lampGreen: new THREE.MeshStandardMaterial({ color: 0x0d4a2a, metalness: 0.3, roughness: 0.3, side: THREE.DoubleSide, emissive: 0x0a3a1a, emissiveIntensity: 0.6 }),
    ivory: new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.3 }),
  };
  return _V;
}

function fit(c, text, maxW, size, family = 'Georgia, serif', weight = 'bold') {
  let s = size;
  do { c.font = `${weight} ${s}px ${family}`; s -= 2; } while (c.measureText(text).width > maxW && s > 8);
}

/** dice face textures (1..6 pips), shared */
let _diceMats = null;
function diceMats(color = '#b3122e') {
  if (_diceMats) return _diceMats;
  const face = (n) => {
    const S = 128, cv = makeCanvas(S), c = cv.getContext('2d');
    c.fillStyle = color; c.fillRect(0, 0, S, S);
    c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(0, 0, S, 10);
    const P = { 1: [[64, 64]], 2: [[34, 34], [94, 94]], 3: [[30, 30], [64, 64], [98, 98]], 4: [[34, 34], [94, 34], [34, 94], [94, 94]],
      5: [[30, 30], [98, 30], [64, 64], [30, 98], [98, 98]], 6: [[34, 28], [94, 28], [34, 64], [94, 64], [34, 100], [94, 100]] }[n];
    c.fillStyle = '#f6f0e4';
    for (const [x, y] of P) { c.beginPath(); c.arc(x, y, 11, 0, Math.PI * 2); c.fill(); }
    return new THREE.MeshStandardMaterial({ map: toTexture(cv), roughness: 0.2, metalness: 0.05, transparent: false });
  };
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z  ->  1, 6, 2, 5, 3, 4 (opposites sum to 7)
  _diceMats = [face(1), face(6), face(2), face(5), face(3), face(4)];
  return _diceMats;
}
const DIE_TOP_ROT = {                 // rotation that puts face n on top (+y)
  1: [0, 0, Math.PI / 2], 6: [0, 0, -Math.PI / 2], 2: [0, 0, 0], 5: [Math.PI, 0, 0], 3: [-Math.PI / 2, 0, 0], 4: [Math.PI / 2, 0, 0],
};
export function dieMesh(size = 0.1) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), diceMats());
  m.rotation.order = 'YXZ';          // tip the face up first, then spin about the vertical
  return m;
}
export function dieFaceUp(mesh, n) {
  const r = DIE_TOP_ROT[n];
  mesh.rotation.set(r[0], mesh.rotation.y, r[2]);
}

// ------------------------------- LADY LUCK's parts ----------------------------
export function partMesh(key) {
  const V = mats();
  const g = new THREE.Group();
  if (key === 'zero') {
    g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 14), V.emerald), 0, 0.13, 0));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.01, 8, 28), V.gold);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.09;
    g.add(ring);
    g.add(new THREE.Mesh(lathe([[0.05, 0], [0.05, 0.02], [0.02, 0.05], [0.03, 0.09], [0, 0.09]], 16), V.gold));
    const zero = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.06), new THREE.MeshBasicMaterial({ map: (() => {
      const cv = makeCanvas(64), c = cv.getContext('2d');
      c.fillStyle = '#f4efe2'; c.font = 'bold 50px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('0', 32, 35);
      return toTexture(cv);
    })(), transparent: true, depthWrite: false }));
    zero.position.set(0, 0.13, 0.072);
    g.add(zero);
  } else if (key === 'dice') {
    const a = dieMesh(0.1), b = dieMesh(0.1);
    dieFaceUp(a, 6); dieFaceUp(b, 1);
    a.position.set(-0.06, 0.05, 0); b.position.set(0.06, 0.05, 0.02);
    b.rotation.y = 0.6;
    g.add(a, b);
    // "loaded": a glint of lead through a chipped corner
    g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), V.redGlow), -0.1, 0.1, 0.03));
  } else if (key === 'arm') {
    const mount = box(0.12, 0.1, 0.12, V.chrome, 0, 0.05, 0);
    g.add(mount);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.55, 10), V.chrome);
    rod.position.set(0, 0.34, 0);
    rod.rotation.z = -0.25;
    g.add(rod);
    g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), V.red), 0.075, 0.62, 0));
    // torn wiring where it came off the machine
    for (let i = 0; i < 4; i++) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 4), new THREE.MeshStandardMaterial({ color: [0xff2d2d, 0xffd24a, 0x2d8aff, 0x1a1a1a][i], roughness: 0.6 }));
      w.position.set(-0.04 + i * 0.025, -0.02, 0.03);
      w.rotation.set(0.4 + i * 0.3, 0, 0.3 - i * 0.2);
      g.add(w);
    }
  }
  return g;
}

// --------------------------------- THE CAGE -----------------------------------
/** the counter where LADY LUCK is assembled. Front faces +Z. */
export function workbench() {
  const V = mats();
  const g = new THREE.Group();
  g.add(box(2.3, 0.08, 0.9, V.steel, 0, 0.94, 0));
  g.add(box(2.2, 0.86, 0.82, V.lacquer, 0, 0.47, -0.02));
  g.add(box(2.34, 0.03, 0.94, V.gold, 0, 0.99, 0));
  // velvet tray with three recesses
  g.add(box(1.5, 0.03, 0.46, V.velvet, 0, 1.0, 0.08));
  const slots = {};
  [['zero', -0.52], ['dice', 0], ['arm', 0.52]].forEach(([k, x]) => {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.012, 24), V.gold);
    pad.position.set(x, 1.02, 0.08);
    g.add(pad);
    const p = partMesh(k);
    p.position.set(x, 1.03, 0.08);
    if (k === 'arm') { p.scale.setScalar(0.6); p.rotation.z = 0.9; }
    p.visible = false;
    g.add(p);
    slots[k] = p;
  });
  // a green banker's lamp + a jeweler's loupe on a stand
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.03, 16), V.gold), -0.95, 1.0, -0.22));
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 8), V.gold), -0.95, 1.18, -0.22));
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.16, 0.12, 20, 1, true, 0, Math.PI), V.lampGreen);
  shade.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  shade.position.set(-0.9, 1.38, -0.22);
  g.add(shade);
  g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), V.bulb), -0.9, 1.34, -0.22));
  g.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.01, 8, 20), V.chrome), 0.95, 1.2, -0.2));
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 6), V.chrome), 0.95, 1.08, -0.2));
  // a brass plaque
  const plq = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.2), new THREE.MeshBasicMaterial({ map: (() => {
    const cv = makeCanvas(512, 96), c = cv.getContext('2d');
    c.fillStyle = '#1a1008'; c.fillRect(0, 0, 512, 96);
    c.strokeStyle = '#c9a227'; c.lineWidth = 6; c.strokeRect(4, 4, 504, 88);
    c.fillStyle = '#e8c860'; c.textAlign = 'center'; c.textBaseline = 'middle';
    fit(c, 'THE CAGE — REPAIRS & ADJUSTMENTS', 470, 38);
    c.fillText('THE CAGE — REPAIRS & ADJUSTMENTS', 256, 50);
    return toTexture(cv);
  })(), color: new THREE.Color(1.3, 1.3, 1.3) }));
  plq.position.set(0, 0.7, 0.395);
  g.add(plq);
  g.userData = { slots, gunAnchor: new THREE.Vector3(0, 1.2, 0.05) };
  return g;
}

// -------------------------------- craps table ---------------------------------
function crapsFelt() {
  const W = 2048, H = 1024, cv = makeCanvas(W, H), c = cv.getContext('2d');
  c.fillStyle = '#0c5a30'; c.fillRect(0, 0, W, H);
  c.globalAlpha = 0.25; c.globalCompositeOperation = 'overlay';
  c.drawImage(noiseCanvas(256, 40, 2, 7, 2), 0, 0, W, H);
  c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
  c.strokeStyle = '#f2ead0'; c.fillStyle = '#f2ead0'; c.lineWidth = 6; c.textAlign = 'center'; c.textBaseline = 'middle';
  // mirrored layouts at both ends, the proposition box in the middle
  for (const side of [0, 1]) {
    c.save();
    if (side) { c.translate(W, H); c.rotate(Math.PI); }
    c.strokeRect(80, 120, 660, 780);
    c.font = 'bold 52px Georgia, serif';
    c.save(); c.translate(130, 510); c.rotate(-Math.PI / 2); c.fillText('PASS LINE', 0, 0); c.restore();
    c.save(); c.translate(230, 510); c.rotate(-Math.PI / 2); c.font = 'bold 40px Georgia, serif'; c.fillText("DON'T PASS BAR", 0, 0); c.restore();
    c.font = 'bold 90px Georgia, serif';
    c.fillText('COME', 520, 330);
    c.strokeRect(290, 220, 440, 220);
    c.font = 'bold 44px Georgia, serif';
    c.fillText('FIELD', 520, 520);
    c.font = 'bold 38px Georgia, serif';
    c.fillText('2 · 3 · 4 · 9 · 10 · 11 · 12', 520, 580);
    c.strokeRect(290, 460, 440, 170);
    const place = ['4', '5', 'SIX', '8', 'NINE', '10'];
    place.forEach((p, i) => {
      c.strokeRect(290 + i * 73, 660, 73, 110);
      c.font = `bold ${p.length > 2 ? 22 : 40}px Georgia, serif`;
      c.fillText(p, 326 + i * 73, 715);
    });
    c.restore();
  }
  // center: any seven, hardways, any craps
  c.strokeStyle = '#ffd24a'; c.fillStyle = '#ffd24a';
  c.strokeRect(820, 180, 408, 660);
  c.font = 'bold 48px Georgia, serif';
  c.fillStyle = '#e8263a'; c.fillText('SEVEN', 1024, 250);
  c.fillStyle = '#f2ead0'; c.font = 'bold 32px Georgia, serif';
  c.fillText('HARD WAYS', 1024, 360);
  ['2·2', '3·3', '4·4', '5·5'].forEach((h, i) => { c.strokeRect(860 + (i % 2) * 170, 390 + Math.floor(i / 2) * 110, 160, 100); c.fillText(h, 940 + (i % 2) * 170, 440 + Math.floor(i / 2) * 110); });
  c.fillStyle = '#e8263a'; c.font = 'bold 40px Georgia, serif';
  c.fillText('ANY CRAPS', 1024, 700);
  c.fillStyle = '#ffd24a'; c.font = 'italic 34px Georgia, serif';
  c.fillText('HOUSE OF THE UNDEAD', 1024, 790);
  return toTexture(cv);
}

/** a full-size craps table along X. Returns { group, dice:[a,b], bedY, half:[x,z] } */
export function crapsTable() {
  const V = mats();
  const g = new THREE.Group();
  const L = 4.4, W = 2.3;
  // a rounded rectangle path (a Shape or a hole Path)
  const rounded = (P, l, w, r) => {
    P.moveTo(-l / 2 + r, -w / 2);
    P.lineTo(l / 2 - r, -w / 2); P.quadraticCurveTo(l / 2, -w / 2, l / 2, -w / 2 + r);
    P.lineTo(l / 2, w / 2 - r); P.quadraticCurveTo(l / 2, w / 2, l / 2 - r, w / 2);
    P.lineTo(-l / 2 + r, w / 2); P.quadraticCurveTo(-l / 2, w / 2, -l / 2, w / 2 - r);
    P.lineTo(-l / 2, -w / 2 + r); P.quadraticCurveTo(-l / 2, -w / 2, -l / 2 + r, -w / 2);
    return P;
  };
  const shape = rounded(new THREE.Shape(), L, W, 0.55);
  // the tub: a thick wooden wall around a sunken felt bed (three fixes the hole's winding)
  shape.holes.push(rounded(new THREE.Path(), L - 0.34, W - 0.34, 0.4));
  const outer = new THREE.ExtrudeGeometry(shape, { depth: 0.36, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.04, bevelSegments: 3 });
  outer.rotateX(-Math.PI / 2);
  g.add(at(new THREE.Mesh(outer, V.wood), 0, 0.66, 0));
  g.add(box(L - 0.3, 0.36, W - 0.3, V.lacquer, 0, 0.84, 0));      // the tub's body under the felt
  const bedGeo = new THREE.PlaneGeometry(L - 0.35, W - 0.35);
  const bed = new THREE.Mesh(bedGeo, new THREE.MeshStandardMaterial({ map: crapsFelt(), roughness: 0.95 }));
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = 1.025;
  g.add(bed);
  // padded top rail + the chip rail groove, brass trim
  const railPts = shape.getPoints(24).map((p) => new THREE.Vector3(p.x * 0.99, 1.06, -p.y * 0.99));
  const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPts, true), 120, 0.075, 10, true), V.leather);
  g.add(rail);
  const trim = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPts.map((p) => p.clone().multiplyScalar(0.94).setY(0.99)), true), 120, 0.012, 6, true), V.gold);
  g.add(trim);
  // pedestal legs
  for (const x of [-1.3, 1.3]) {
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 0.66, 16), V.lacquer), x, 0.33, 0));
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 20), V.gold), x, 0.02, 0));
  }
  // the stickman's stick lying across the layout, and a few stacks
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.4, 6), V.wood);
  stick.rotation.set(0, 0.3, Math.PI / 2);
  stick.position.set(0.4, 1.05, -0.5);
  g.add(stick);
  // the dice (dynamic — they roll)
  const a = dieMesh(0.07), b = dieMesh(0.07);
  a.position.set(-1.1, 1.06, 0.2); b.position.set(-1.0, 1.06, 0.3);
  dieFaceUp(a, 3); dieFaceUp(b, 4);
  a.userData.dynamic = true; b.userData.dynamic = true;
  g.add(a, b);
  return { group: g, dice: [a, b], bedY: 1.06, half: [L / 2, W / 2] };
}

// ----------------------------- the WELCOME sign -------------------------------
/** "Welcome to Fabulous LOST WAGES Nevada" — the diamond with the star. Faces +Z. */
export function welcomeSign() {
  const V = mats();
  const g = new THREE.Group();
  const W = 4.2, H = 2.8;
  const cvW = 1024, cvH = 683, cv = makeCanvas(cvW, cvH), c = cv.getContext('2d');
  // the classic diamond-ish board
  const dia = [[cvW / 2, 8], [cvW - 8, cvH / 2], [cvW / 2, cvH - 8], [8, cvH / 2]];
  c.fillStyle = '#f4efe2';
  c.beginPath(); c.moveTo(cvW / 2, 20); c.lineTo(cvW - 30, cvH * 0.38); c.lineTo(cvW - 70, cvH * 0.72); c.lineTo(cvW / 2, cvH - 20); c.lineTo(70, cvH * 0.72); c.lineTo(30, cvH * 0.38); c.closePath(); c.fill();
  void dia;
  // WELCOME in red coins
  const letters = 'WELCOME';
  for (let i = 0; i < 7; i++) {
    const x = 230 + i * 94, y = 175;
    c.fillStyle = '#c8102e'; c.beginPath(); c.arc(x, y, 42, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#f4efe2'; c.lineWidth = 4; c.beginPath(); c.arc(x, y, 34, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#f4efe2'; c.font = 'bold 48px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(letters[i], x, y + 3);
  }
  c.fillStyle = '#1a3a9a'; c.font = 'italic bold 56px Georgia, serif';
  c.fillText('to Fabulous', cvW / 2, 285);
  c.fillStyle = '#c8102e'; fit(c, 'LOST WAGES', 760, 150, 'Georgia, serif', 'bold');
  c.fillText('LOST WAGES', cvW / 2, 400);
  c.fillStyle = '#1a3a9a'; c.font = 'bold 54px Georgia, serif';
  c.fillText('N E V A D A', cvW / 2, 515);
  c.strokeStyle = '#c8102e'; c.lineWidth = 10;
  c.beginPath(); c.moveTo(cvW / 2, 20); c.lineTo(cvW - 30, cvH * 0.38); c.lineTo(cvW - 70, cvH * 0.72); c.lineTo(cvW / 2, cvH - 20); c.lineTo(70, cvH * 0.72); c.lineTo(30, cvH * 0.38); c.closePath(); c.stroke();
  const tex = toTexture(cv);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.26, roughness: 0.5 }));   // lit, not blown out, under the stage spots
  // punch the canvas's transparent corners out
  face.material.alphaMap = (() => {
    const m = makeCanvas(cvW / 4, cvH / 4), mc = m.getContext('2d');
    mc.fillStyle = '#000'; mc.fillRect(0, 0, m.width, m.height);
    mc.fillStyle = '#fff'; mc.scale(0.25, 0.25);
    mc.beginPath(); mc.moveTo(cvW / 2, 14); mc.lineTo(cvW - 24, cvH * 0.38); mc.lineTo(cvW - 64, cvH * 0.72); mc.lineTo(cvW / 2, cvH - 14); mc.lineTo(64, cvH * 0.72); mc.lineTo(24, cvH * 0.38); mc.closePath(); mc.fill();
    return toTexture(m, { srgb: false });
  })();
  face.position.y = 2.2;
  g.add(face);
  // the back of the board + two posts
  const back = face.clone();
  back.material = new THREE.MeshStandardMaterial({ color: 0x2a2a30, alphaMap: face.material.alphaMap, alphaTest: 0.5, transparent: true, side: THREE.BackSide });
  g.add(back);
  for (const x of [-1.1, 1.1]) g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 2.2, 12), V.chrome), x, 0.55, -0.05));
  // bulbs chasing round the edge
  const bulbs = [];
  const edge = [[0, 1.33], [1.99, 0.33], [1.8, -0.59], [0, -1.33], [-1.8, -0.59], [-1.99, 0.33]];
  for (let s = 0; s < edge.length; s++) {
    const [x0, y0] = edge[s], [x1, y1] = edge[(s + 1) % edge.length];
    const n = 9;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffe8a0, emissiveIntensity: 3 }));
      b.position.set(x0 + (x1 - x0) * t, 2.2 + y0 + (y1 - y0) * t, 0.03);
      g.add(b);
      bulbs.push(b);
    }
  }
  // the star on top
  const starShape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i / 10) * Math.PI * 2, rr = i % 2 ? 0.14 : 0.32;
    if (i === 0) starShape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else starShape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  const star = new THREE.Mesh(new THREE.ExtrudeGeometry(starShape, { depth: 0.05, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffd24a, emissiveIntensity: 2.6 }));
  star.position.set(0, 3.95, -0.02);
  g.add(star);
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 8), V.chrome), 0, 3.65, -0.03));
  g.userData = { bulbs, star };
  return g;
}

// ------------------------------- the keno board -------------------------------
/** 80 numbers, 20 drawn one after another. call board.tick(dt) each frame */
export function kenoBoard() {
  const W = 1024, H = 512, cv = makeCanvas(W, H), c = cv.getContext('2d');
  const tex = toTexture(cv);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.5), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.5, 1.5, 1.5) }));
  const state = { drawn: [], order: [], t: 0, game: 1000 + Math.floor(Math.random() * 8000) };
  const newGame = () => {
    const pool = Array.from({ length: 80 }, (_, i) => i + 1);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    state.order = pool.slice(0, 20);
    state.drawn = [];
    state.game++;
  };
  const draw = () => {
    c.fillStyle = '#050308'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#c9a227'; c.lineWidth = 8; c.strokeRect(6, 6, W - 12, H - 12);
    c.fillStyle = '#ffd24a'; c.font = 'bold 56px Georgia, serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.shadowColor = '#ffb020'; c.shadowBlur = 14;
    c.fillText('KENO', 30, 48);
    c.shadowBlur = 0;
    c.font = 'bold 26px Georgia, serif'; c.fillStyle = '#e8e0c8'; c.textAlign = 'right';
    c.fillText(`GAME ${state.game} · ${state.drawn.length}/20 DRAWN`, W - 30, 48);
    const set = new Set(state.drawn);
    const last = state.drawn[state.drawn.length - 1];
    c.textAlign = 'center';
    for (let n = 1; n <= 80; n++) {
      const i = (n - 1) % 10, j = Math.floor((n - 1) / 10);
      const x = 60 + i * 100, y = 118 + j * 48;
      const on = set.has(n);
      c.fillStyle = on ? (n === last ? '#ff2d55' : '#ffd24a') : '#1a1420';
      c.beginPath(); c.roundRect(x - 40, y - 19, 80, 38, 8); c.fill();
      c.fillStyle = on ? '#140808' : '#6a6070';
      c.font = 'bold 28px Georgia, serif';
      c.fillText(String(n), x, y + 2);
    }
    tex.needsUpdate = true;
  };
  newGame();
  draw();
  return {
    mesh,
    tick(dt) {
      state.t -= dt;
      if (state.t > 0) return false;
      if (state.drawn.length < 20) {
        state.drawn.push(state.order[state.drawn.length]);
        state.t = 0.45;
        draw();
        return true;                       // a ball dropped (play a blip)
      }
      state.t = 6;                         // hold the result, then a new game
      newGame();
      draw();
      return false;
    },
  };
}

// --------------------------------- the Strip ----------------------------------
/** a painted night skyline of the Strip — for the only window in the house */
export function stripSkyline() {
  const W = 4096, H = 1024, cv = makeCanvas(W, H), c = cv.getContext('2d');
  const R = rng(1955);
  const sky = c.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#07030f'); sky.addColorStop(0.45, '#1c0a2e'); sky.addColorStop(0.72, '#5a1a4a'); sky.addColorStop(0.86, '#b04a3a'); sky.addColorStop(1, '#2a0a10');
  c.fillStyle = sky; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(255,255,255,${R() * 0.6})`; c.fillRect(R() * W, R() * H * 0.5, 2, 2); }
  // a big sick moon
  const mg = c.createRadialGradient(3300, 190, 10, 3300, 190, 150);
  mg.addColorStop(0, '#fff4d0'); mg.addColorStop(0.6, '#f0d090'); mg.addColorStop(1, 'rgba(240,200,140,0)');
  c.fillStyle = mg; c.beginPath(); c.arc(3300, 190, 150, 0, Math.PI * 2); c.fill();
  // desert mountains
  c.fillStyle = '#1a0a1e';
  c.beginPath(); c.moveTo(0, 700);
  for (let x = 0; x <= W; x += 60) c.lineTo(x, 640 - Math.sin(x * 0.003) * 60 - R() * 40);
  c.lineTo(W, H); c.lineTo(0, H); c.closePath(); c.fill();
  // searchlight beams
  for (let i = 0; i < 6; i++) {
    const x = 300 + R() * (W - 600), a = (R() - 0.5) * 0.6;
    const bg = c.createLinearGradient(x, 900, x + Math.sin(a) * 900, 0);
    bg.addColorStop(0, 'rgba(255,240,200,0.35)'); bg.addColorStop(1, 'rgba(255,240,200,0)');
    c.fillStyle = bg;
    c.beginPath(); c.moveTo(x - 6, 900); c.lineTo(x + Math.sin(a) * 900 - 70, 0); c.lineTo(x + Math.sin(a) * 900 + 70, 0); c.lineTo(x + 6, 900); c.closePath(); c.fill();
  }
  const windows = (x, y, w, h, lit = 0.55, col = '#ffd890') => {
    for (let wy = y + 10; wy < y + h - 8; wy += 14) {
      for (let wx = x + 6; wx < x + w - 6; wx += 12) {
        if (R() < lit) { c.fillStyle = R() < 0.1 ? '#ff9ad0' : col; c.globalAlpha = 0.5 + R() * 0.5; c.fillRect(wx, wy, 6, 8); }
      }
    }
    c.globalAlpha = 1;
  };
  // the skyline: back row of towers
  for (let x = 0; x < W;) {
    const w = 80 + R() * 160, h = 180 + R() * 330;
    c.fillStyle = '#120818'; c.fillRect(x, 880 - h, w, h);
    windows(x, 880 - h, w, h, 0.35);
    x += w + R() * 30;
  }
  // landmarks
  // a black glass pyramid with a beam straight up
  c.fillStyle = '#0a0610'; c.beginPath(); c.moveTo(500, 900); c.lineTo(820, 540); c.lineTo(1140, 900); c.closePath(); c.fill();
  const beam = c.createLinearGradient(820, 540, 820, 0);
  beam.addColorStop(0, 'rgba(255,255,255,0.9)'); beam.addColorStop(1, 'rgba(200,220,255,0.1)');
  c.fillStyle = beam; c.fillRect(810, 0, 20, 540);
  // a lattice tower
  c.strokeStyle = '#d8b060'; c.lineWidth = 3;
  for (let k = 0; k < 16; k++) {
    const y = 900 - k * 28, hw = 90 - k * 5.4;
    c.beginPath(); c.moveTo(1500 - hw, y); c.lineTo(1500 + hw, y); c.stroke();
    c.beginPath(); c.moveTo(1500 - hw, y); c.lineTo(1500 + hw - 5.4, y - 28); c.moveTo(1500 + hw, y); c.lineTo(1500 - hw + 5.4, y - 28); c.stroke();
  }
  c.beginPath(); c.moveTo(1500, 452); c.lineTo(1500, 380); c.stroke();
  // a needle tower with a pod
  c.fillStyle = '#16101e'; c.fillRect(2380, 260, 24, 640);
  c.beginPath(); c.ellipse(2392, 270, 70, 28, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#ff2d55'; c.fillRect(2388, 150, 8, 110);
  for (let i = 0; i < 12; i++) { c.fillStyle = '#ffd890'; c.fillRect(2330 + i * 10, 268, 6, 5); }
  // a fairytale castle with colored turrets
  for (let i = 0; i < 5; i++) {
    const x = 2750 + i * 70, h = 150 + (i % 2) * 70;
    c.fillStyle = '#1e1428'; c.fillRect(x, 900 - h, 50, h);
    c.fillStyle = ['#ff2d55', '#2d8aff', '#ffd24a', '#2dff7a', '#c27aff'][i];
    c.beginPath(); c.moveTo(x - 6, 900 - h); c.lineTo(x + 25, 900 - h - 70); c.lineTo(x + 56, 900 - h); c.closePath(); c.fill();
  }
  // neon hotel signs up the fronts of the near towers
  const neon = (text, x, y, col, size, vertical = false) => {
    c.save();
    c.shadowColor = col; c.shadowBlur = 28; c.fillStyle = col; c.font = `bold ${size}px Georgia, serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    if (vertical) { for (let i = 0; i < text.length; i++) c.fillText(text[i], x, y + i * size * 0.95); } else c.fillText(text, x, y);
    c.shadowBlur = 8; c.fillStyle = '#ffffff'; c.globalAlpha = 0.6;
    if (vertical) { for (let i = 0; i < text.length; i++) c.fillText(text[i], x, y + i * size * 0.95); } else c.fillText(text, x, y);
    c.restore();
  };
  for (const [x, w, h] of [[180, 220, 520], [1180, 200, 470], [1900, 240, 560], [3550, 260, 500]]) {
    c.fillStyle = '#0c0612'; c.fillRect(x, 920 - h, w, h);
    windows(x, 920 - h, w, h, 0.6);
  }
  neon('LOST WAGES', 290, 460, '#ff2d78', 44, true);
  neon('DUNES', 1280, 520, '#2dd6ff', 52, true);
  neon('STARDUST', 2020, 420, '#c27aff', 44, true);
  neon('SANDS', 3680, 480, '#ffb04a', 56, true);
  neon('★ OPEN 24 HRS ★', 3000, 640, '#2dff7a', 40);
  neon('FREE PARKING', 1720, 700, '#ffd24a', 34);
  // the boulevard: rivers of head- and taillights
  c.fillStyle = '#0a0508'; c.fillRect(0, 920, W, 104);
  for (let i = 0; i < 260; i++) {
    const y = 940 + R() * 70, x = R() * W, len = 40 + R() * 160;
    c.strokeStyle = y < 975 ? `rgba(255,${60 + R() * 60},60,${0.5 + R() * 0.5})` : `rgba(255,250,220,${0.4 + R() * 0.6})`;
    c.lineWidth = 2 + R() * 3;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + len, y); c.stroke();
  }
  return toTexture(cv);
}

// ----------------------------------- ALL IN -----------------------------------
function reelStrip() {
  // symbols run round the drum (canvas x = around, y = along the axle), each
  // turned a quarter so it reads upright once wrapped on a reel lying on its side
  const cv = makeCanvas(1024, 256), c = cv.getContext('2d');
  c.fillStyle = '#f6efe0'; c.fillRect(0, 0, 1024, 256);
  const syms = [['7', '#b3122e'], ['BAR', '#141414'], ['🍒', '#b3122e'], ['💎', '#2a6aff'], ['7', '#b3122e'], ['🔔', '#c9a227'], ['☠', '#141414'], ['♠', '#141414']];
  syms.forEach(([s, col], i) => {
    c.save();
    c.translate(64 + i * 128, 128);
    c.rotate(Math.PI / 2);
    c.fillStyle = col; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = s === 'BAR' ? 'bold 64px Georgia, serif' : 'bold 104px Georgia, serif';
    c.fillText(s, 0, 4);
    c.restore();
    c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(i * 128 + 126, 0, 3, 256);
  });
  return toTexture(cv);
}

/**
 * ALL IN: a deco slot-press. Front faces +Z. userData: reels (groups that spin
 * about X), lever (pivot, rotation.x pulls down), press (moves on Y), bulbs.
 */
export function allInMachine() {
  const V = mats();
  const g = new THREE.Group();
  g.add(box(3.1, 0.3, 1.34, V.lacquer, 0, 0.15, 0));
  g.add(box(3.14, 0.05, 1.38, V.gold, 0, 0.31, 0));
  g.add(box(2.7, 2.2, 1.05, V.wine, 0, 1.43, 0));
  for (const x of [-1.38, 1.38]) {
    g.add(box(0.14, 2.3, 1.1, V.gold, x, 1.45, 0));
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.3, 16), V.gold), x, 1.45, 0.58));
  }
  // the arched crown with the marquee
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 1.05, 40, 1, false, 0, Math.PI), V.wine);
  crown.rotation.set(Math.PI / 2, Math.PI / 2, 0);
  crown.position.set(0, 2.53, 0);
  g.add(crown);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.06, 10, 56, Math.PI), V.gold);
  arch.position.set(0, 2.53, 0.53);
  g.add(arch);
  const bulbs = [];
  for (let i = 0; i <= 22; i++) {
    const a = (i / 22) * Math.PI;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffd9a0, emissiveIntensity: 3 }));
    b.position.set(Math.cos(a) * 1.24, 2.53 + Math.sin(a) * 1.24, 0.56);
    g.add(b);
    bulbs.push(b);
  }
  // "ALL IN" in the arch
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.8), new THREE.MeshBasicMaterial({ map: (() => {
    const cv = makeCanvas(1024, 430), c = cv.getContext('2d');
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = '#ff2d55'; c.shadowBlur = 40; c.fillStyle = '#ff2d55';
    c.font = 'bold 250px Georgia, serif'; c.fillText('ALL IN', 512, 230);
    c.shadowBlur = 12; c.fillStyle = '#fff4e0'; c.fillText('ALL IN', 512, 230);
    c.font = 'italic 44px Georgia, serif'; c.shadowColor = '#ffd24a'; c.fillStyle = '#ffd24a';
    c.fillText('the house\'s own forge', 512, 390);
    return toTexture(cv);
  })(), transparent: true, depthWrite: false, color: new THREE.Color(1.8, 1.8, 1.8) }));
  plate.position.set(0, 3.05, 0.54);
  g.add(plate);
  // three big reels behind windows
  const reelTex = reelStrip();
  const reelMat = new THREE.MeshStandardMaterial({ map: reelTex, emissive: 0xffffff, emissiveMap: reelTex, emissiveIntensity: 0.5, roughness: 0.4 });
  const reels = [];
  g.add(box(2.1, 0.95, 0.06, V.lacquer, 0, 1.9, 0.5));
  for (let i = 0; i < 3; i++) {
    const x = -0.68 + i * 0.68;
    const holder = new THREE.Group();
    holder.position.set(x, 1.9, 0.18);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.56, 32, 1, true), reelMat);
    drum.rotation.z = Math.PI / 2;
    holder.add(drum);
    g.add(holder);
    reels.push(holder);
    const frame = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.03, 8, 4), V.gold);
    frame.rotation.z = Math.PI / 4;
    frame.scale.set(0.9, 1.25, 1);
    frame.position.set(x, 1.9, 0.54);
    g.add(frame);
  }
  g.add(box(2.1, 0.05, 0.1, V.redGlow, 0, 1.9, 0.56));           // the payline
  // the intake: a dark mouth with a gold lip, and the press above it
  g.add(box(1.4, 0.36, 0.2, V.lacquer, 0, 0.95, 0.46));
  g.add(box(1.5, 0.05, 0.3, V.gold, 0, 0.75, 0.5));
  const mouthGlow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff9a20, emissiveIntensity: 0.25 });
  g.add(box(1.25, 0.22, 0.02, mouthGlow, 0, 0.95, 0.565));
  const press = new THREE.Group();
  press.add(box(1.3, 0.16, 0.42, V.gold, 0, 0, 0));
  press.add(box(0.16, 0.16, 0.16, V.chrome, 0, 0.16, -0.05));    // short ram: stays under the reel windows
  press.position.set(0, 1.26, 0.62);
  g.add(press);
  // the lever on the right flank
  const lever = new THREE.Group();
  lever.position.set(1.6, 1.3, 0.1);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.3, 12), V.chrome);
  rod.position.y = 0.65;
  lever.add(rod);
  lever.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), V.red), 0, 1.35, 0));
  const hub = at(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.2, 16), V.chrome), 1.52, 1.3, 0.1);
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  g.add(lever);
  // the price plaque
  const plq = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.26), new THREE.MeshBasicMaterial({ map: (() => {
    const cv = makeCanvas(768, 125), c = cv.getContext('2d');
    c.fillStyle = '#0c0a08'; c.fillRect(0, 0, 768, 125);
    c.strokeStyle = '#c9a227'; c.lineWidth = 6; c.strokeRect(4, 4, 760, 117);
    c.fillStyle = '#e8c860'; c.textAlign = 'center'; c.textBaseline = 'middle';
    fit(c, 'PUSH IT ALL IN — 1000 CHIPS', 720, 52);
    c.fillText('PUSH IT ALL IN — 1000 CHIPS', 384, 64);
    return toTexture(cv);
  })(), color: new THREE.Color(1.3, 1.3, 1.3) }));
  plq.position.set(0, 0.52, 0.53);
  g.add(plq);
  g.userData = { reels, lever, press, bulbs, mouthGlow };
  return g;
}
