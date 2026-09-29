// machines.js — the floor's special furniture: the art-deco cocktail automats
// that pour perk drinks, THE BIG SIX money wheel, and the cocktail glass that
// shows up both behind the automat's porthole and in your hand when you drink.

import * as THREE from 'three';
import { makeCanvas, toTexture, metalCanvas } from './texkit.js';

const lathe = (pts, segs = 32) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);
const at = (m, x, y, z) => { m.position.set(x, y, z); return m; };

let _S = null;
function shared() {
  if (_S) return _S;
  _S = {
    gold: new THREE.MeshStandardMaterial({ color: 0xe0b040, metalness: 1, roughness: 0.25 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xeef0f4, metalness: 1, roughness: 0.1 }),
    lacquer: new THREE.MeshStandardMaterial({ color: 0x0a080c, metalness: 0.3, roughness: 0.22 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x050407, roughness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xdfefff, metalness: 0.1, roughness: 0.04, transparent: true, opacity: 0.28, depthWrite: false }),
    steel: new THREE.MeshStandardMaterial({ map: toTexture(metalCanvas(256, '#6a6e78', 21)), metalness: 0.9, roughness: 0.35 }),
    bulb: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffd9a0, emissiveIntensity: 3 }),
  };
  return _S;
}

/** fit text into a width by shrinking the font */
function fitFont(c, text, maxW, size, family = 'Georgia, serif', weight = 'bold') {
  let s = size;
  do { c.font = `${weight} ${s}px ${family}`; s -= 2; } while (c.measureText(text).width > maxW && s > 10);
}

// ------------------------------ cocktail glass --------------------------------
/** a coupe on a stem, liquid glowing in the drink's color (origin = foot) */
export function cocktailGlass(color, { liquidOnly = false, glow = 1.6 } = {}) {
  const S = shared();
  const g = new THREE.Group();
  const col = new THREE.Color(color);
  const glassMat = S.glass;
  if (!liquidOnly) {
    g.add(new THREE.Mesh(lathe([[0, 0], [0.045, 0], [0.047, 0.004], [0.01, 0.01], [0.006, 0.02], [0.006, 0.1], [0.012, 0.11], [0.07, 0.14], [0.074, 0.15], [0.068, 0.15], [0.01, 0.114]], 24), glassMat));
  }
  const liquid = new THREE.Mesh(lathe([[0, 0.118], [0.03, 0.124], [0.062, 0.142], [0.0, 0.142]], 24),
    new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.4), emissive: col, emissiveIntensity: glow, roughness: 0.1, transparent: true, opacity: 0.92 }));
  g.add(liquid);
  // garnish: a cherry on a pick
  const pick = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.09, 4), S.gold);
  pick.position.set(0.03, 0.16, 0);
  pick.rotation.z = 0.5;
  g.add(pick);
  g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), new THREE.MeshStandardMaterial({ color: 0x8a0010, roughness: 0.2, emissive: 0x3a0006 })), 0.014, 0.135, 0));
  g.userData.liquid = liquid;
  return g;
}

// ------------------------------ perk automat ----------------------------------
function plateTexture(def) {
  const W = 1024, H = 256, cv = makeCanvas(W, H), c = cv.getContext('2d');
  const grd = c.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#0e0a12'); grd.addColorStop(1, '#050308');
  c.fillStyle = grd; c.fillRect(0, 0, W, H);
  c.strokeStyle = '#c9a227'; c.lineWidth = 10; c.strokeRect(8, 8, W - 16, H - 16);
  c.strokeStyle = 'rgba(201,162,39,0.5)'; c.lineWidth = 3; c.strokeRect(26, 26, W - 52, H - 52);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.shadowColor = def.color; c.shadowBlur = 26;
  fitFont(c, def.name, W - 120, 96);
  c.strokeStyle = def.color; c.lineWidth = 6; c.strokeText(def.name, W / 2, H / 2 + 6);
  c.shadowBlur = 8; c.fillStyle = '#fff6e0'; c.fillText(def.name, W / 2, H / 2 + 6);
  return toTexture(cv);
}

function menuTexture(def) {
  const W = 512, H = 320, cv = makeCanvas(W, H), c = cv.getContext('2d');
  c.fillStyle = '#efe4c8'; c.fillRect(0, 0, W, H);
  c.strokeStyle = '#6a4a10'; c.lineWidth = 8; c.strokeRect(10, 10, W - 20, H - 20);
  c.fillStyle = '#1a1008'; c.textAlign = 'center'; c.textBaseline = 'top';
  c.font = 'bold 40px Georgia, serif';
  c.fillText(def.icon, W / 2, 26);
  // blurb, word-wrapped
  c.font = 'italic 25px Georgia, serif';
  const words = def.blurb.split(' ');
  let line = '', y = 86;
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (c.measureText(t).width > W - 70) { c.fillText(line, W / 2, y); y += 31; line = w; } else line = t;
  }
  if (line) c.fillText(line, W / 2, y);
  c.font = 'bold 44px Georgia, serif';
  c.fillStyle = '#8a0a18';
  c.fillText(`${def.price} CHIPS`, W / 2, H - 68);
  return toTexture(cv);
}

/**
 * one cocktail automat for a drink. Local frame: front faces +Z, origin on the
 * floor at the machine's center. userData.glow: materials to pulse.
 */
export function perkMachine(def) {
  const S = shared();
  const col = new THREE.Color(def.color);
  const body = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.28), metalness: 0.45, roughness: 0.28 });
  const neon = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: col, emissiveIntensity: 2.4 });
  const porthole = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: col.clone().multiplyScalar(0.35), emissiveIntensity: 1.2, roughness: 0.3 });
  const g = new THREE.Group();

  // plinth + body + arched crown
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.18, 1.0), S.lacquer), 0, 0.09, 0));
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.04, 1.04), S.gold), 0, 0.2, 0));
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.14, 1.8, 0.84), body), 0, 1.1, 0));
  // half cylinder lying along Z, curved side up (Ry then Rx: x = r cos θ, y = r sin θ)
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.57, 0.57, 0.84, 32, 1, false, 0, Math.PI), body);
  crown.rotation.x = Math.PI / 2;
  crown.rotation.y = Math.PI / 2;
  crown.position.set(0, 2.0, 0);
  g.add(crown);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(0.57, 0.03, 8, 40, Math.PI), S.gold);
  arch.position.set(0, 2.0, 0.425);
  g.add(arch);
  for (const x of [-0.57, 0.57]) {
    g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.8, 0.05), S.gold), x, 1.1, 0.425));
    // neon tubes running up the front edges
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.7, 8), neon), x * 0.9, 1.12, 0.46));
  }
  // name plate across the crown
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.06, 0.265), new THREE.MeshBasicMaterial({ map: plateTexture(def), color: new THREE.Color(1.6, 1.6, 1.6) }));
  plate.position.set(0, 2.2, 0.432);
  g.add(plate);
  // porthole with the drink inside
  g.add(at(new THREE.Mesh(new THREE.CircleGeometry(0.33, 40), porthole), 0, 1.5, 0.423));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 10, 44), S.gold);
  ring.position.set(0, 1.5, 0.43);
  g.add(ring);
  const glass = cocktailGlass(def.color);
  glass.scale.setScalar(2.4);
  glass.position.set(0, 1.23, 0.36);
  g.add(glass);
  const pane = new THREE.Mesh(new THREE.CircleGeometry(0.33, 40), S.glass);
  pane.position.set(0, 1.5, 0.445);
  g.add(pane);
  // the menu card + dispensing nook + coin slot
  const menuTex = menuTexture(def);
  const menu = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.39), new THREE.MeshStandardMaterial({ map: menuTex, emissiveMap: menuTex, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.7 }));
  menu.position.set(0, 0.88, 0.424);
  g.add(menu);
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.1), S.dark), 0, 0.43, 0.39));
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.03, 0.18), S.chrome), 0, 0.33, 0.47));
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.03), S.chrome), 0.44, 0.9, 0.43));
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.08, 0.035), S.dark), 0.44, 0.92, 0.44));
  // sunburst fan + bulb on top
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI / 2 + (i / 8) * Math.PI;
    const ray = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.34, 0.03), S.chrome);
    ray.position.set(Math.sin(a) * 0.2, 2.62 + Math.cos(a) * 0.2, 0);
    ray.rotation.z = -a;
    g.add(ray);
  }
  g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), neon), 0, 2.6, 0));
  g.userData = { glow: [neon, porthole], glass, def };
  return g;
}

// ------------------------------- THE BIG SIX ----------------------------------
function wheelFace(segs) {
  const S = 1024, cv = makeCanvas(S), c = cv.getContext('2d');
  const R = S / 2;
  c.translate(R, R);
  const n = segs.length;
  const cols = ['#8a0a18', '#101014'];
  segs.forEach((s, i) => {
    // local angle a (counter-clockwise from +x) is -a on the canvas (y down)
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, R - 6, -a0, -a1, true); c.closePath();
    c.fillStyle = s.skull ? '#050505' : s.gold ? '#8a6a10' : cols[i % 2];
    c.fill();
    c.strokeStyle = '#d8b040'; c.lineWidth = 5; c.stroke();
    c.save();
    c.rotate(-(a0 + a1) / 2);
    c.textAlign = 'right'; c.textBaseline = 'middle';
    c.fillStyle = s.skull ? '#ff2d55' : '#f6ecd0';
    fitFont(c, s.label, R * 0.62, 40);
    c.shadowColor = 'rgba(0,0,0,0.8)'; c.shadowBlur = 6;
    c.fillText(s.label, R - 40, 0);
    c.font = 'bold 52px Georgia, serif';
    c.textAlign = 'center';
    c.fillStyle = s.skull ? '#ff2d55' : '#ffd24a';
    c.fillText(s.icon, R * 0.2, 0);
    c.restore();
  });
  // hub medallion
  const g = c.createRadialGradient(0, 0, 10, 0, 0, R * 0.16);
  g.addColorStop(0, '#fff0b0'); g.addColorStop(1, '#8a6010');
  c.fillStyle = g; c.beginPath(); c.arc(0, 0, R * 0.16, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#1a1008'; c.font = 'bold 60px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('6', 0, 4);
  return toTexture(cv);
}

/**
 * THE BIG SIX: a vertical money wheel on a gilded stand. segs: [{label, icon,
 * skull?}] laid out counter-clockwise from 3 o'clock. Front faces +Z.
 * Returns { group, wheel (spins about Z), clapper, center, prize (Vector3) }
 */
export function bigSixWheel(segs) {
  const S = shared();
  const R = 1.7;
  const g = new THREE.Group();
  const cy = 2.75;
  // stand: plinth, two fluted legs, a back frame
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.25, 1.1), S.lacquer), 0, 0.125, 0));
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(3.44, 0.05, 1.14), S.gold), 0, 0.26, 0));
  for (const x of [-1.2, 1.2]) {
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, cy - 0.3, 12), S.gold), x, 0.25 + (cy - 0.3) / 2, -0.2));
  }
  const back = at(new THREE.Mesh(new THREE.CylinderGeometry(R + 0.28, R + 0.28, 0.14, 64), S.lacquer), 0, cy, -0.24);
  back.rotation.x = Math.PI / 2;
  g.add(back);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(R + 0.22, 0.07, 12, 72), S.gold);
  frame.position.set(0, cy, -0.12);
  g.add(frame);
  // marquee bulbs around the frame
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), S.bulb), Math.cos(a) * (R + 0.34), cy + Math.sin(a) * (R + 0.34), -0.1));
  }
  // the wheel itself (dynamic)
  const wheel = new THREE.Group();
  wheel.position.set(0, cy, 0);
  const face = new THREE.Mesh(new THREE.CircleGeometry(R, 96), new THREE.MeshStandardMaterial({ map: wheelFace(segs), roughness: 0.35, metalness: 0.15, emissive: 0xffffff, emissiveIntensity: 0.18, emissiveMap: null }));
  face.material.emissiveMap = face.material.map;
  face.position.z = 0.07;
  wheel.add(face);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.14, 96), S.lacquer);
  disc.rotation.x = Math.PI / 2;
  wheel.add(disc);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.045, 10, 96), S.gold);
  rim.position.z = 0.07;
  wheel.add(rim);
  const n = segs.length;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.14, 8), S.chrome);
    peg.rotation.x = Math.PI / 2;
    peg.position.set(Math.cos(a) * (R - 0.06), Math.sin(a) * (R - 0.06), 0.14);
    wheel.add(peg);
  }
  const hub = at(new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), S.gold), 0, 0, 0.08);
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);
  wheel.userData.dynamic = true;
  g.add(wheel);
  // the clapper at 12 o'clock
  const clapper = new THREE.Group();
  clapper.position.set(0, cy + R + 0.12, 0.2);
  const flap = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.34, 0.02), new THREE.MeshStandardMaterial({ color: 0x3a0a08, roughness: 0.5 }));
  flap.position.y = -0.15;
  clapper.add(flap);
  clapper.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.1), S.gold), 0, 0.02, 0));
  clapper.userData.dynamic = true;
  g.add(clapper);
  // prize pedestal in front
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.9, 24), S.lacquer), 0, 0.45, 0.95));
  const lip = at(new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.025, 8, 32), S.gold), 0, 0.9, 0.95);
  lip.rotation.x = Math.PI / 2;
  g.add(lip);
  return { group: g, wheel, clapper, center: new THREE.Vector3(0, cy, 0), prize: new THREE.Vector3(0, 1.35, 0.95), radius: R, count: n };
}
