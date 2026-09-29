// props.js — the 3D accessories that make each zombie read at a glance:
// hats (lathe-turned felt and silk), shades, bow ties, the cocktail tray,
// briefcase, monocle, cape, pit-guard armor, the slot-machine head, crowns...
// Each builder returns [{ bone, obj }] with obj posed in that bone's frame
// (bind-pose axes: +Y up, +Z forward, +X = character's left).

import * as THREE from 'three';
import { makeCanvas, toTexture, fabricCanvas, noiseCanvas } from '../gfx/texkit.js';

const _mats = new Map();
function mat(key, make) {
  if (!_mats.has(key)) _mats.set(key, make());
  return _mats.get(key);
}

const M = {
  felt: (color) => mat('felt' + color, () => new THREE.MeshStandardMaterial({
    map: toTexture(fabricCanvas(256, color, 23, false), { repeat: [3, 3] }), roughness: 0.95 })),
  silk: (color) => mat('silk' + color, () => new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.1 })),
  gold: () => mat('gold', () => new THREE.MeshStandardMaterial({ color: 0xd8a830, metalness: 1, roughness: 0.28 })),
  silver: () => mat('silver', () => new THREE.MeshStandardMaterial({ color: 0xcfd4dc, metalness: 1, roughness: 0.22 })),
  steel: (color = 0x2a3040) => mat('steel' + color, () => new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness: 0.35 })),
  gloss: (color) => mat('gloss' + color, () => new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.12 })),
  plastic: (color) => mat('plastic' + color, () => new THREE.MeshStandardMaterial({ color, roughness: 0.45 })),
  glass: (color = 0xaabbcc, opacity = 0.28) => mat('glass' + color + opacity, () => new THREE.MeshStandardMaterial({
    color, roughness: 0.04, metalness: 0.1, transparent: true, opacity, depthWrite: false })),
  glow: (color, intensity = 2.5) => mat('glow' + color + intensity, () => new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: color, emissiveIntensity: intensity })),
  leather: (color) => mat('leather' + color, () => new THREE.MeshStandardMaterial({
    map: toTexture(fabricCanvas(256, color, 31, false)), roughness: 0.42 })),
};

const lathe = (pts, segs = 28) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);
const mesh = (geo, material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  return m;
};

// ------------------------------ playing cards --------------------------------
const SUIT_COLOR = { '♠': '#111', '♣': '#111', '♥': '#b3122e', '♦': '#b3122e' };
const _cardTex = new Map();
export function cardTexture(rank, suit) {
  const key = rank + suit;
  if (_cardTex.has(key)) return _cardTex.get(key);
  const cv = makeCanvas(128, 180);
  const c = cv.getContext('2d');
  c.fillStyle = '#f4efe2';
  c.beginPath(); c.roundRect(0, 0, 128, 180, 12); c.fill();
  c.globalAlpha = 0.18;
  c.drawImage(noiseCanvas(128, 8, 3, 5, 1.2), 0, 0, 128, 180);
  c.globalAlpha = 1;
  c.fillStyle = SUIT_COLOR[suit];
  c.font = 'bold 30px Georgia, serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(rank, 20, 22); c.font = '24px serif'; c.fillText(suit, 20, 48);
  c.save(); c.translate(108, 158); c.rotate(Math.PI);
  c.font = 'bold 30px Georgia, serif'; c.fillText(rank, 0, 0); c.font = '24px serif'; c.fillText(suit, 0, 26);
  c.restore();
  c.font = rank.length > 1 || 'JQK'.includes(rank) ? 'bold 64px Georgia, serif' : '80px serif';
  c.fillText('JQK'.includes(rank) ? rank : suit, 64, 94);
  // a smear of old blood on some
  if ((rank.charCodeAt(0) + suit.charCodeAt(0)) % 3 === 0) {
    c.fillStyle = 'rgba(90,6,10,0.55)';
    c.beginPath(); c.ellipse(90, 130, 22, 14, 0.6, 0, Math.PI * 2); c.fill();
  }
  const t = toTexture(cv);
  _cardTex.set(key, t);
  return t;
}
let _backTex = null;
export function cardBackTexture() {
  if (_backTex) return _backTex;
  const cv = makeCanvas(128, 180);
  const c = cv.getContext('2d');
  c.fillStyle = '#f4efe2'; c.beginPath(); c.roundRect(0, 0, 128, 180, 12); c.fill();
  c.fillStyle = '#7a0a14'; c.beginPath(); c.roundRect(8, 8, 112, 164, 8); c.fill();
  c.strokeStyle = '#d8b23a'; c.lineWidth = 2;
  for (let i = -20; i < 30; i++) { c.beginPath(); c.moveTo(8 + i * 10, 8); c.lineTo(8 + i * 10 + 164, 172); c.stroke(); }
  c.strokeStyle = '#f4efe2'; c.lineWidth = 3; c.strokeRect(14, 14, 100, 152);
  c.fillStyle = '#d8b23a'; c.font = 'bold 44px serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('☠', 64, 90);
  _backTex = toTexture(cv);
  return _backTex;
}
/** a two-sided card mesh (face on +Z) */
export function cardMesh(rank = 'A', suit = '♠', w = 0.063, h = 0.088) {
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(w, h);
  const front = new THREE.Mesh(geo, mat('card' + rank + suit, () => new THREE.MeshStandardMaterial({ map: cardTexture(rank, suit), roughness: 0.55 })));
  const back = new THREE.Mesh(geo, mat('cardback', () => new THREE.MeshStandardMaterial({ map: cardBackTexture(), roughness: 0.55 })));
  back.rotation.y = Math.PI;
  back.position.z = -0.0005;
  g.add(front, back);
  return g;
}

// ------------------------------- the props -----------------------------------
/** an ostrich plume on a canvas (alpha-cut), tinted toward a costume color */
function featherMat(color = '#ffffff') {
  return mat('feather' + color, () => {
    const W = 128, H = 512, cv = makeCanvas(W, H), c = cv.getContext('2d');
    c.clearRect(0, 0, W, H);
    const base = new THREE.Color(color);
    const rgb = (k) => `rgb(${Math.round(255 * (0.7 + 0.3 * base.r) * k)},${Math.round(255 * (0.7 + 0.3 * base.g) * k)},${Math.round(255 * (0.7 + 0.3 * base.b) * k)})`;
    // the barbs: hundreds of soft strokes curling off the shaft
    for (let i = 0; i < 520; i++) {
      const t = Math.random();
      const y = H - 20 - t * (H - 40);
      const wide = Math.sin(Math.min(1, t * 1.15) * Math.PI) * 58 + 4;
      const s = Math.random() < 0.5 ? -1 : 1;
      c.strokeStyle = rgb(0.75 + Math.random() * 0.25);
      c.globalAlpha = 0.35 + Math.random() * 0.5;
      c.lineWidth = 1 + Math.random() * 2;
      c.beginPath(); c.moveTo(W / 2, y);
      c.quadraticCurveTo(W / 2 + s * wide * 0.6, y - 10, W / 2 + s * wide, y - 28 - Math.random() * 20);
      c.stroke();
    }
    c.globalAlpha = 1;
    c.strokeStyle = '#f4efe2'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(W / 2, H - 6); c.lineTo(W / 2, 20); c.stroke();
    return new THREE.MeshStandardMaterial({ map: toTexture(cv), alphaTest: 0.3, transparent: false, side: THREE.DoubleSide, roughness: 0.9 });
  });
}
const _featherGeo = new THREE.PlaneGeometry(1, 1);
_featherGeo.translate(0, 0.5, 0);               // pivot at the quill
function feather(color, w, h) {
  const m = new THREE.Mesh(_featherGeo, featherMat(color));
  m.scale.set(w, h, 1);
  return m;
}

function hatBand(r, h, color, y = 0.012) {
  return mesh(new THREE.CylinderGeometry(r, r * 1.01, h, 28, 1, true), M.silk(color), 0, y, 0);
}

const BUILDERS = {
  trilby({ hs, color = '#3a342c' }) {
    const g = new THREE.Group();
    const felt = M.felt(color);
    g.add(mesh(lathe([[0.097, 0], [0.099, 0.03], [0.094, 0.07], [0.082, 0.098], [0.05, 0.11], [0.02, 0.1], [0, 0.098]]), felt));
    const brim = mesh(lathe([[0.096, 0.002], [0.13, 0.004], [0.158, -0.004], [0.162, -0.012], [0.158, -0.008], [0.13, -0.002], [0.096, -0.004]]), felt);
    g.add(brim);
    g.add(hatBand(0.1, 0.022, '#141010'));
    g.scale.set(1, 1, 1.12).multiplyScalar(hs);
    g.position.set(0, 0.18 * hs, 0.004);
    g.rotation.set(-0.12, 0, 0.1);
    return [{ bone: 'head', obj: g }];
  },
  pillbox({ hs }) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.078, 0.083, 0.07, 24), M.felt('#8d1f2f')));
    g.add(mesh(new THREE.CylinderGeometry(0.084, 0.084, 0.016, 24), M.gold(), 0, -0.02, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.079, 0.079, 0.006, 24), M.gold(), 0, 0.036, 0));
    g.scale.setScalar(hs);
    g.position.set(0.015, 0.2 * hs, -0.005);
    g.rotation.z = -0.22;
    return [{ bone: 'head', obj: g }];
  },
  tophat({ hs, band = '#5a0a18', color = '#0c0c0e', tall = 0.17 }) {
    const g = new THREE.Group();
    const silk = M.silk(color);
    g.add(mesh(lathe([[0.091, 0], [0.089, tall * 0.5], [0.095, tall], [0.07, tall + 0.002], [0, tall + 0.002]]), silk));
    g.add(mesh(lathe([[0.09, 0.004], [0.14, 0.006], [0.155, 0.02], [0.158, 0.016], [0.14, -0.002], [0.09, -0.004]]), silk));
    g.add(hatBand(0.0915, 0.03, band, 0.018));
    g.scale.set(1, 1, 1.1).multiplyScalar(hs);
    g.position.set(0, 0.185 * hs, 0.0);
    g.rotation.x = -0.06;
    return [{ bone: 'head', obj: g }];
  },
  tophatMagic(o) {
    const out = BUILDERS.tophat({ ...o, band: '#8a2dff', color: '#14081f', tall: 0.2 });
    const hat = out[0].obj;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      hat.add(mesh(new THREE.OctahedronGeometry(0.009), M.glow(0xffd24a, 3), Math.sin(a) * 0.094, 0.02, Math.cos(a) * 0.094));
    }
    return out;
  },
  tophatDealer(o) { return BUILDERS.tophat({ ...o, band: '#8a0a18', tall: 0.19 }); },
  bowler({ hs }) {
    const g = new THREE.Group();
    const felt = M.felt('#141414');
    g.add(mesh(lathe([[0.1, 0], [0.103, 0.035], [0.096, 0.075], [0.075, 0.105], [0.04, 0.118], [0, 0.12]]), felt));
    g.add(mesh(lathe([[0.1, 0.002], [0.13, 0.004], [0.142, 0.018], [0.145, 0.012], [0.13, -0.003], [0.1, -0.004]]), felt));
    g.add(hatBand(0.1015, 0.02, '#2a0a0a'));
    g.scale.set(1, 1, 1.1).multiplyScalar(hs);
    g.position.set(0, 0.185 * hs, 0.0);
    return [{ bone: 'head', obj: g }];
  },
  shades({ hs }) {
    const g = new THREE.Group();
    const lens = M.gloss(0x050507);
    const frame = M.steel(0x111111);
    for (const sx of [1, -1]) {
      const l = mesh(new THREE.BoxGeometry(0.046, 0.026, 0.005), lens, sx * 0.03, 0, 0);
      l.rotation.y = sx * 0.12;
      g.add(l);
      const arm = mesh(new THREE.BoxGeometry(0.003, 0.004, 0.09), frame, sx * 0.084, 0.006, -0.045);
      g.add(arm);
    }
    g.add(mesh(new THREE.BoxGeometry(0.02, 0.004, 0.004), frame, 0, 0.006, 0.002));
    g.add(mesh(new THREE.BoxGeometry(0.17, 0.004, 0.004), frame, 0, 0.013, -0.004));
    g.scale.setScalar(hs);
    g.position.set(0, 0.118 * hs, 0.09 * hs);
    return [{ bone: 'head', obj: g }];
  },
  earpiece({ hs }) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.SphereGeometry(0.008, 8, 6), M.plastic('#111')));
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.004, -0.03, -0.02), new THREE.Vector3(0.0, -0.08, -0.035), new THREE.Vector3(-0.01, -0.14, -0.05)]);
    g.add(mesh(new THREE.TubeGeometry(curve, 16, 0.0022, 5), M.glass(0xd8e0e8, 0.6)));
    g.scale.setScalar(hs);
    g.position.set(-0.088 * hs, 0.108 * hs, 0.0);
    return [{ bone: 'head', obj: g }];
  },
  bowtie(o, color = 0x111111) {
    const g = new THREE.Group();
    const m = M.silk(color);
    for (const sx of [1, -1]) {
      const w = mesh(new THREE.ConeGeometry(0.026, 0.042, 4), m, sx * 0.021, 0, 0);
      w.rotation.z = sx * Math.PI / 2;
      w.scale.set(1, 1, 0.45);
      g.add(w);
    }
    g.add(mesh(new THREE.BoxGeometry(0.014, 0.018, 0.012), m));
    g.position.set(0, 0.012, (o.neckR || 0.056) + 0.006);
    return [{ bone: 'neck', obj: g }];
  },
  bowtieRed(o) { return BUILDERS.bowtie(o, 0x9a0a18); },
  tray() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.01, 28), M.silver()));
    g.add(mesh(new THREE.TorusGeometry(0.15, 0.006, 6, 28), M.silver(), 0, 0.006, 0)).children;
    g.children[1].rotation.x = Math.PI / 2;
    // martini of something that glows
    const glass = M.glass(0xe8f0f0, 0.3);
    g.add(mesh(lathe([[0.003, 0], [0.028, 0.0], [0.003, 0.004], [0.003, 0.06], [0.045, 0.11], [0.043, 0.112], [0.003, 0.064]], 16), glass, 0.03, 0.005, 0));
    const liquid = mesh(new THREE.ConeGeometry(0.038, 0.04, 16), M.glow(0x6aff2a, 2.2), 0.03, 0.098, 0);
    liquid.rotation.x = Math.PI;
    g.add(liquid);
    g.add(mesh(new THREE.SphereGeometry(0.008, 8, 6), M.plastic('#2a6a1a'), 0.03, 0.09, 0.012));
    // second glass, knocked over
    const g2 = mesh(lathe([[0.003, 0], [0.028, 0.0], [0.003, 0.004], [0.003, 0.06], [0.045, 0.11], [0.043, 0.112], [0.003, 0.064]], 16), glass, -0.06, 0.02, 0.05);
    g2.rotation.z = Math.PI / 2;
    g.add(g2);
    // held flat on the left palm (hand frame: -Y along fingers)
    g.rotation.x = Math.PI / 2;
    g.position.set(0.02, -0.05, 0.0);
    return [{ bone: 'handL', obj: g, level: true }];
  },
  chain({ neckR = 0.056, chestZ = 0.13 }) {
    const g = new THREE.Group();
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16, e = 2 * t - 1, bow = 1 - e * e;
      pts.push(new THREE.Vector3(e * (neckR + 0.03), 0.215 - 0.185 * bow, 0.004 + (chestZ + 0.016) * Math.sqrt(bow)));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    g.add(mesh(new THREE.TubeGeometry(curve, 64, 0.007, 6), M.gold()));
    const medal = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.006, 20), M.gold(), 0, 0.005, chestZ + 0.03);
    medal.rotation.x = Math.PI / 2 - 0.2;
    g.add(medal);
    g.add(mesh(new THREE.OctahedronGeometry(0.01), M.glow(0xff1a3a, 1.2), 0, 0.005, chestZ + 0.036));
    return [{ bone: 'chest', obj: g }];
  },
  cards({ hipZ = 0.11 }) {
    const g = new THREE.Group();
    [['A', '♠'], ['K', '♥'], ['7', '♦']].forEach(([r, s], i) => {
      const c = cardMesh(r, s);
      c.position.set(-0.07 + i * 0.05, 0.06, hipZ + 0.004);
      c.rotation.set(-0.15, 0, (i - 1) * 0.35);
      g.add(c);
    });
    return [{ bone: 'hips', obj: g }];
  },
  helmet({ hs }) {
    const g = new THREE.Group();
    const shell = mesh(new THREE.SphereGeometry(0.118, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), M.gloss(0x1a2038));
    shell.scale.set(1, 0.95, 1.1);
    g.add(shell);
    const rim = mesh(new THREE.TorusGeometry(0.118, 0.008, 6, 28), M.steel(0x11141c), 0, -0.002, 0);
    rim.rotation.x = Math.PI / 2;
    rim.scale.set(1, 1.1, 1);
    g.add(rim);
    const visor = mesh(new THREE.SphereGeometry(0.13, 20, 10, Math.PI / 2 - 0.95, 1.9, 0.55, 1.1), M.glass(0x9ab4dd, 0.22));
    visor.scale.set(1, 1, 1.12);
    g.add(visor);
    g.add(mesh(new THREE.BoxGeometry(0.2, 0.016, 0.02), M.steel(0x11141c), 0, 0.055, 0.12));
    const stripe = mesh(new THREE.BoxGeometry(0.02, 0.005, 0.2), M.glow(0xffd24a, 0.8), 0, 0.112, 0.0);
    g.add(stripe);
    g.scale.setScalar(hs);
    g.position.set(0, 0.125 * hs, 0.005);
    return [{ bone: 'head', obj: g }];
  },
  pauldrons() {
    const out = [];
    for (const [side, sx] of [['L', 1], ['R', -1]]) {
      const p = mesh(new THREE.SphereGeometry(0.1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), M.steel(0x2a3148));
      p.scale.set(1, 0.8, 1.05);
      p.position.set(0.012 * sx, 0.015, 0);
      p.rotation.z = -0.35 * sx;
      const rim = mesh(new THREE.TorusGeometry(0.0985, 0.007, 6, 24), M.gold(), 0, 0.02, 0);
      rim.rotation.x = Math.PI / 2;
      p.add(rim);
      out.push({ bone: 'upperArm' + side, obj: p });
    }
    return out;
  },
  badge({ chestZ = 0.13 }) {
    const shape = new THREE.Shape();
    for (let i = 0; i < 12; i++) {
      const a = Math.PI / 2 + (i / 12) * Math.PI * 2, r = i % 2 ? 0.02 : 0.034;
      if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r); else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const b = mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.004, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 1 }), M.gold());
    b.position.set(0.075, 0.08, chestZ - 0.012);
    b.rotation.y = 0.35;
    return [{ bone: 'chest', obj: b }];
  },
  briefcase() {
    const g = new THREE.Group();
    const leather = M.leather('#2a1a0e');
    g.add(mesh(new THREE.BoxGeometry(0.085, 0.27, 0.38), leather, 0, -0.2, 0));
    for (const z of [-0.12, 0.12]) g.add(mesh(new THREE.BoxGeometry(0.09, 0.02, 0.03), M.gold(), 0, -0.07, z));
    const handle = mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 14, Math.PI), leather, 0, -0.065, 0);
    handle.rotation.y = Math.PI / 2;
    g.add(handle);
    g.add(mesh(new THREE.BoxGeometry(0.087, 0.004, 0.36), M.gold(), 0, -0.2, 0));
    g.position.set(0, -0.02, 0.0);
    return [{ bone: 'handR', obj: g }];
  },
  monocle({ hs }) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.TorusGeometry(0.018, 0.0018, 6, 20), M.gold()));
    g.add(mesh(new THREE.CircleGeometry(0.017, 16), M.glass(0xffffff, 0.2)));
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.015, -0.01, 0), new THREE.Vector3(-0.03, -0.06, -0.01), new THREE.Vector3(-0.02, -0.12, 0.0)]);
    g.add(mesh(new THREE.TubeGeometry(curve, 10, 0.0012, 4), M.gold()));
    g.scale.setScalar(hs);
    g.position.set(-0.031 * hs, 0.118 * hs, 0.088 * hs);
    return [{ bone: 'head', obj: g }];
  },
  visor({ hs }) {
    const g = new THREE.Group();
    const band = mesh(new THREE.CylinderGeometry(0.097, 0.097, 0.03, 28, 1, true, -1.1, 2.2), M.glass(0x1f8f4f, 0.75));
    g.add(band);
    const brim = mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.006, 28, 1, false, -0.9, 1.8), M.glass(0x2aa860, 0.55));
    brim.position.set(0, -0.012, 0.015);
    brim.rotation.x = 0.2;
    g.add(brim);
    g.add(mesh(new THREE.TorusGeometry(0.096, 0.004, 4, 28), M.plastic('#111')).rotateX(Math.PI / 2));
    g.scale.set(1, 1, 1.1).multiplyScalar(hs);
    g.position.set(0, 0.165 * hs, 0.0);
    return [{ bone: 'head', obj: g }];
  },
  cardsHand() {
    const g = new THREE.Group();
    [['A', '♥'], ['K', '♠'], ['Q', '♦'], ['J', '♣']].forEach(([r, s], i) => {
      const c = cardMesh(r, s);
      c.position.set(0, -0.06 - i * 0.002, 0.03);
      c.rotation.set(0, Math.PI / 2, (i - 1.5) * 0.28);
      g.add(c);
    });
    return [{ bone: 'handR', obj: g }];
  },
  wand() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.3, 8), M.gloss(0x0a0a0a)));
    for (const y of [0.13, -0.13]) g.add(mesh(new THREE.CylinderGeometry(0.0065, 0.0065, 0.04, 8), M.gloss(0xf0f0f0), 0, y, 0));
    g.add(mesh(new THREE.OctahedronGeometry(0.012), M.glow(0xc27aff, 3), 0, 0.16, 0));
    g.rotation.x = Math.PI / 2;
    g.position.set(0, -0.055, 0.04);
    return [{ bone: 'handR', obj: g }];
  },
  cape({ sq = 1 } = {}) {
    // real cloth: gathered at the collar, wrapped round the shoulders, falling
    // in soft pleats that deepen toward a gently scalloped hem
    const geo = new THREE.PlaneGeometry(0.5, 1.02, 28, 20);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      const v = (0.51 - y) / 1.02;               // 0 top .. 1 bottom
      const u = x / 0.25;                        // -1 .. 1
      const spread = 0.9 + v * 0.62;
      const pleat = Math.sin(u * Math.PI * 3.5 + 0.4) * (0.01 + 0.04 * v);
      const hem = v > 0.85 ? Math.cos(u * Math.PI * 3.5 + 0.4) * 0.022 * (v - 0.85) / 0.15 : 0;
      const top = 1 - Math.min(1, v * 4);                        // the part lying over the shoulders
      const shoulder = -0.07 * u * u * top;                      // drops away from the collar
      p.setXYZ(i, x * spread, (y - 0.33 + hem + shoulder) * sq,
        -0.16 - v * 0.07 + (u * u) * (0.14 - v * 0.03 + 0.1 * top) + pleat);
    }
    geo.computeVertexNormals();
    const outer = new THREE.Mesh(geo, mat('capeOut', () => new THREE.MeshStandardMaterial({
      map: toTexture(fabricCanvas(256, '#3c1a5a', 41, false)), roughness: 0.75, side: THREE.BackSide })));
    const inner = new THREE.Mesh(geo, mat('capeIn', () => new THREE.MeshStandardMaterial({ color: 0x7a0a1a, roughness: 0.4, side: THREE.FrontSide })));
    const g = new THREE.Group();
    g.add(outer, inner);
    g.position.set(0, 0.2, 0.02);
    g.userData.cape = true;
    return [{ bone: 'chest', obj: g }];
  },
  cigar() {
    const g = new THREE.Group();
    const c = mesh(new THREE.CylinderGeometry(0.009, 0.008, 0.13, 10), M.leather('#4a2a14'));
    g.add(c);
    g.add(mesh(new THREE.CylinderGeometry(0.0092, 0.0092, 0.012, 10), M.gold(), 0, -0.04, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.0091, 0.0091, 0.01, 10), M.glow(0xff5a1a, 3), 0, 0.068, 0));
    g.rotation.set(Math.PI / 2 - 0.25, 0, 0.35);
    g.position.set(0.018, 0.056, 0.14);
    return [{ bone: 'head', obj: g }];
  },
  slotHead() {
    const g = new THREE.Group();
    const cv = makeCanvas(256, 300);
    const c = cv.getContext('2d');
    const grad = c.createLinearGradient(0, 0, 0, 300);
    grad.addColorStop(0, '#6a4a0a'); grad.addColorStop(0.5, '#d8b23a'); grad.addColorStop(1, '#6a4a0a');
    c.fillStyle = grad; c.fillRect(0, 0, 256, 300);
    c.fillStyle = '#1a0a1a'; c.beginPath(); c.roundRect(20, 20, 216, 60, 10); c.fill();
    c.fillStyle = '#ffd24a'; c.font = 'bold 40px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('JACKPOT', 128, 52);
    c.fillStyle = '#0a0612'; c.beginPath(); c.roundRect(20, 100, 216, 110, 12); c.fill();
    c.fillStyle = '#f4efe2';
    for (let i = 0; i < 3; i++) { c.beginPath(); c.roundRect(30 + i * 68, 110, 60, 90, 6); c.fill(); }
    c.font = '48px serif';
    ['7', '7', '7'].forEach((s, i) => { c.fillStyle = '#b3122e'; c.font = 'bold 60px Georgia, serif'; c.fillText(s, 60 + i * 68, 157); });
    c.fillStyle = '#1a1010'; c.fillRect(40, 232, 176, 40);
    for (let i = 0; i < 4; i++) { c.fillStyle = ['#ff2d55', '#2dff7a', '#27e6ff', '#ffd24a'][i]; c.beginPath(); c.arc(64 + i * 42, 252, 12, 0, Math.PI * 2); c.fill(); }
    const tex = toTexture(cv);
    const face = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.3 });
    const side = M.gold();
    const box = mesh(new THREE.BoxGeometry(0.3, 0.36, 0.25), [side, side, side, side, face, side], 0, 0.2, 0.02);
    g.add(box);
    g.add(mesh(new THREE.SphereGeometry(0.06, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.glow(0xff2d2d, 3), 0, 0.38, 0.02));
    const arm = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 8), M.silver(), -0.17, 0.28, 0.02);
    arm.rotation.z = 0.35;
    g.add(arm);
    g.add(mesh(new THREE.SphereGeometry(0.025, 12, 8), M.glow(0xff1a1a, 1.5), -0.205, 0.37, 0.02));
    return [{ bone: 'neck', obj: g }];
  },
  // ------------------------------ the Strip's own ---------------------------
  /** the showgirl's headdress: a jeweled band and a sunburst of plumes */
  plumes({ hs, color = '#d8a020' }) {
    const g = new THREE.Group();
    const band = mesh(new THREE.TorusGeometry(0.098, 0.014, 8, 32), M.gold(), 0, 0.02, 0);
    band.rotation.x = Math.PI / 2 - 0.25;
    band.scale.set(1, 1.12, 1);
    g.add(band);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      g.add(mesh(new THREE.OctahedronGeometry(0.009), M.glow(i % 3 ? 0xfff0d0 : 0xff4a9a, 1.4), Math.sin(a) * 0.1, 0.02 + Math.cos(a) * 0.024, Math.cos(a) * 0.11));
    }
    g.add(mesh(new THREE.OctahedronGeometry(0.026), M.glow(0xff2d78, 2.2), 0, 0.05, 0.115));
    const n = 11;
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * 2 - 1;                         // -1 .. 1 across the fan
      const f = feather(i % 2 ? '#ffffff' : color, 0.16, 0.62 - Math.abs(t) * 0.18);
      f.position.set(t * 0.07, 0.05, -0.03 - Math.abs(t) * 0.02);
      f.rotation.set(-0.25, 0, -t * 1.05);
      g.add(f);
    }
    g.scale.setScalar(hs);
    g.position.set(0, 0.17 * hs, 0.0);
    return [{ bone: 'head', obj: g }];
  },
  /** a great fan of tail plumes behind the hips */
  tailfeathers({ color = '#d8a020' }) {
    const g = new THREE.Group();
    const n = 13;
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * 2 - 1;
      const f = feather(i % 3 === 1 ? '#ffffff' : color, 0.3, 1.05 - Math.abs(t) * 0.3);
      f.position.set(t * 0.06, 0.02, -0.14);
      f.rotation.set(-0.55 + Math.abs(t) * 0.25, 0, -t * 1.25);
      g.add(f);
    }
    g.add(mesh(new THREE.SphereGeometry(0.06, 12, 8), M.gold(), 0, 0.02, -0.13));
    return [{ bone: 'hips', obj: g }];
  },
  pearls({ neckR = 0.056, chestZ = 0.12 }) {
    const g = new THREE.Group();
    const white = M.gloss(0xf4efe6);
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i <= 18; i++) {
        const t = i / 18, e = 2 * t - 1, bow = 1 - e * e;
        g.add(mesh(new THREE.SphereGeometry(0.008, 8, 6), white, e * (neckR + 0.028 + k * 0.012), 0.215 - (0.11 + k * 0.06) * bow, 0.004 + (chestZ + 0.012) * Math.sqrt(bow)));
      }
    }
    return [{ bone: 'chest', obj: g }];
  },
  /** the King's hair: a high black quiff and a ducktail at the back */
  pompadour({ hs }) {
    const g = new THREE.Group();
    const hair = M.gloss(0x0a0a0c);
    const quiff = mesh(new THREE.SphereGeometry(0.1, 18, 12), hair, 0, 0.07, 0.035);
    quiff.scale.set(0.95, 0.62, 1.12);
    quiff.rotation.x = -0.3;
    g.add(quiff);
    const roll = mesh(new THREE.CapsuleGeometry(0.045, 0.11, 6, 12), hair, 0, 0.1, 0.075);
    roll.rotation.z = Math.PI / 2;
    g.add(roll);
    const back = mesh(new THREE.SphereGeometry(0.1, 14, 10), hair, 0, 0.02, -0.035);
    back.scale.set(1, 0.8, 0.9);
    g.add(back);
    g.scale.setScalar(hs);
    g.position.set(0, 0.155 * hs, 0.0);
    return [{ bone: 'head', obj: g }];
  },
  /** 1930s: big white cartoon eyes with pie-cut pupils (the dead: lopsided, one lid drooping) */
  pieEyes(o) { return pieEyeProps(o, false); },
  pieEyesLiving(o) { return pieEyeProps(o, true); },
  /** big gold aviators with amber lenses */
  aviators({ hs }) {
    const g = new THREE.Group();
    const lens = M.glass(0xd8a040, 0.75);
    const frame = M.gold();
    for (const sx of [1, -1]) {
      const l = mesh(new THREE.SphereGeometry(0.03, 14, 10), lens, sx * 0.034, -0.004, 0);
      l.scale.set(1.1, 0.95, 0.22);
      g.add(l);
      const rim = mesh(new THREE.TorusGeometry(0.031, 0.0025, 6, 20), frame, sx * 0.034, -0.004, 0.004);
      rim.scale.set(1.1, 0.95, 1);
      g.add(rim);
      g.add(mesh(new THREE.BoxGeometry(0.003, 0.004, 0.09), frame, sx * 0.084, 0.006, -0.045));
    }
    g.add(mesh(new THREE.BoxGeometry(0.03, 0.004, 0.004), frame, 0, 0.012, 0.004));
    g.scale.setScalar(hs);
    g.position.set(0, 0.12 * hs, 0.092 * hs);
    return [{ bone: 'head', obj: g }];
  },
  /** the white cape with the gold lining and the stand-up collar */
  kingcape() {
    const geo = new THREE.PlaneGeometry(0.56, 1.08, 10, 14);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      const v = (0.54 - y) / 1.08;
      const u = x / 0.28;
      p.setXYZ(i, x * (1 + v * 0.55), y - 0.36, -0.17 - v * 0.08 + (u * u) * (0.1 - v * 0.02));
    }
    geo.computeVertexNormals();
    const outer = new THREE.Mesh(geo, mat('kingCapeOut', () => new THREE.MeshStandardMaterial({
      map: (() => {
        const cv = makeCanvas(256), c = cv.getContext('2d');
        c.fillStyle = '#f2eee4'; c.fillRect(0, 0, 256, 256);
        c.fillStyle = '#d8b23a';
        for (let i = 0; i < 30; i++) {
          const x = (i * 53) % 256, y = (i * 97) % 256;
          c.beginPath();
          for (let k = 0; k < 10; k++) { const a = Math.PI / 2 + (k / 10) * Math.PI * 2, r = k % 2 ? 5 : 12; c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
          c.fill();
        }
        return toTexture(cv, { repeat: [2, 3] });
      })(), roughness: 0.5, metalness: 0.2, side: THREE.BackSide })));
    const inner = new THREE.Mesh(geo, mat('kingCapeIn', () => new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.8, roughness: 0.3, side: THREE.FrontSide })));
    const g = new THREE.Group();
    g.add(outer, inner);
    const collar = mesh(new THREE.CylinderGeometry(0.1, 0.085, 0.14, 20, 1, true, Math.PI * 0.35, Math.PI * 1.3), mat('kingCollar', () => new THREE.MeshStandardMaterial({ color: 0xf2eee4, roughness: 0.4, side: THREE.DoubleSide })), 0, 0.28, -0.01);
    g.add(collar);
    g.position.set(0, 0.2, 0.02);
    g.userData.cape = true;
    return [{ bone: 'chest', obj: g }];
  },
  mic() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.014, 0.01, 0.14, 10), M.gloss(0x111111)));
    g.add(mesh(new THREE.SphereGeometry(0.026, 14, 10), M.silver(), 0, 0.085, 0));
    g.rotation.set(Math.PI / 2 - 0.4, 0, 0);
    g.position.set(0, -0.06, 0.04);
    return [{ bone: 'handR', obj: g }];
  },
  crown({ hs, lift = 0 }) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.04, 24, 1, true), M.gold()));
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const s = mesh(new THREE.ConeGeometry(0.014, 0.05, 6), M.gold(), Math.sin(a) * 0.072, 0.04, Math.cos(a) * 0.072);
      g.add(s);
      g.add(mesh(new THREE.SphereGeometry(0.008, 8, 6), M.glow(i % 2 ? 0xff1a3a : 0x2a8aff, 1.5), Math.sin(a) * 0.076, 0.0, Math.cos(a) * 0.076));
    }
    g.scale.setScalar(hs);
    g.position.set(0, (0.215 + lift) * hs, 0);
    g.rotation.z = 0.12;
    return [{ bone: 'head', obj: g }];
  },
};

export const HAT_PROPS = new Set(['trilby', 'pillbox', 'tophat', 'tophatMagic', 'tophatDealer', 'bowler', 'helmet', 'visor', 'plumes', 'pompadour']);

// templates are built once per (prop, body dims) and cloned per character —
// clones share geometry + materials, so hundreds of zombies cost no new GPU buffers
const _templates = new Map();

/** build a list of props; returns [{bone, obj, level?}] */
let _pieWhite = null, _pieBlack = null, _pieLid = null;
function pieEyeProps({ hs }, living) {
  const g = new THREE.Group();
  const white = _pieWhite || (_pieWhite = new THREE.MeshStandardMaterial({ color: 0xfbf6ea, roughness: 0.6, emissive: 0xfbf6ea, emissiveIntensity: 0.22 }));
  // pupils win the depth test against the eyeball (they sat a hair in front of it and flickered)
  const black = _pieBlack || (_pieBlack = new THREE.MeshBasicMaterial({ color: 0x120c0a, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  const lid = _pieLid || (_pieLid = new THREE.MeshStandardMaterial({ color: 0x5a6a4a, roughness: 0.8, side: THREE.DoubleSide }));
  for (const sx of [1, -1]) {
    // the dead are lopsided: one eye popped wide, one shrunk
    const k = living ? 1 : sx > 0 ? 1.14 : 0.88;
    const eye = mesh(new THREE.SphereGeometry(0.03, 16, 12), white, sx * 0.031, 0.006 + (living ? 0 : (sx > 0 ? 0.004 : -0.002)), 0);
    eye.scale.set(1.0 * k, 1.45 * k, 0.55);
    g.add(eye);
    const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.018 * k, 18, Math.PI * 0.18, Math.PI * 1.72), black);
    pupil.scale.set(0.8, 1.35, 1);
    pupil.position.set(sx * 0.024, -0.002 + (living ? 0 : (sx > 0 ? 0.004 : -0.004)), 0.0195);
    pupil.rotation.z = sx > 0 ? 0.25 : Math.PI - 0.25;
    pupil.name = 'pupil';
    g.add(pupil);
    for (const r of [0.8, -0.8]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.036, 0.008), black);
      bar.position.set(sx * 0.031, 0.004, 0.0195);
      bar.rotation.z = r;
      bar.name = 'xeye';
      bar.visible = false;
      g.add(bar);
    }
    // a heavy drooping lid over the small eye
    if (!living && sx < 0) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.031, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), lid);
      l.position.copy(eye.position);
      l.scale.set(1.03 * k, 1.47 * k, 0.7);
      l.rotation.z = -0.35;
      g.add(l);
    }
  }
  g.scale.setScalar(hs);
  g.position.set(0, 0.113 * hs, 0.09 * hs);
  return [{ bone: 'head', obj: g }];
}
export function buildProps(names, opts) {
  const out = [];
  const dimKey = [opts.hs, opts.neckR, opts.chestZ, opts.hipZ, opts.color].map((v) => (typeof v === 'number' ? v.toFixed(3) : v)).join('|');
  for (const n of names) {
    const b = BUILDERS[n];
    if (!b) continue;
    const key = n + '|' + dimKey;
    if (!_templates.has(key)) _templates.set(key, b(opts));
    for (const t of _templates.get(key)) {
      const obj = t.obj.clone(true);
      obj.userData = { ...t.obj.userData };
      out.push({ bone: t.bone, obj, level: t.level });
    }
  }
  return out;
}

export { M as PropMaterials };
