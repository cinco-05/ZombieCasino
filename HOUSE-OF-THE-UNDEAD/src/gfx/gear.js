// gear.js — the little objects you throw: lethals and tacticals, in the hand
// and on the floor. Each is a small procedural model around 10-25cm.

import * as THREE from 'three';
import { makeCanvas, toTexture } from './texkit.js';
import { chipBombMesh } from './models.js';
import { cocktailGlass } from './machines.js';

const lathe = (pts, segs = 20) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);
const at = (m, x, y, z) => { m.position.set(x, y, z); return m; };

let _G = null;
function mats() {
  if (_G) return _G;
  const face = (draw, s = 128) => { const cv = makeCanvas(s), c = cv.getContext('2d'); draw(c, s); return toTexture(cv); };
  _G = {
    gold: new THREE.MeshStandardMaterial({ color: 0xe0b040, metalness: 1, roughness: 0.25 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb8902a, metalness: 1, roughness: 0.35 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xeef0f4, metalness: 1, roughness: 0.1 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.4, metalness: 0.3 }),
    red: new THREE.MeshStandardMaterial({ color: 0x9a0a18, roughness: 0.3, metalness: 0.2 }),
    velvet: new THREE.MeshStandardMaterial({ color: 0x8a0a1c, roughness: 0.8 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xdfefff, roughness: 0.04, transparent: true, opacity: 0.35, depthWrite: false }),
    blueFlame: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x4a9aff, emissiveIntensity: 3.5, transparent: true, opacity: 0.85 }),
    orangeFlame: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff8a2a, emissiveIntensity: 3.2, transparent: true, opacity: 0.8 }),
    redLight: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff1a2a, emissiveIntensity: 4 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2d55, emissiveIntensity: 3 }),
    reels: new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 1.3, map: face((c, s) => {
      c.fillStyle = '#f4efe2'; c.fillRect(0, 0, s, s);
      c.fillStyle = '#b3122e'; c.font = `bold ${s * 0.38}px Georgia, serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      for (let i = 0; i < 3; i++) c.fillText('7', s * (0.2 + i * 0.3), s / 2);
      c.strokeStyle = '#1a1208'; c.lineWidth = 4;
      for (let i = 1; i < 3; i++) { c.beginPath(); c.moveTo(s * i / 3, 0); c.lineTo(s * i / 3, s); c.stroke(); }
    }) }),
    watch: new THREE.MeshStandardMaterial({ roughness: 0.3, map: face((c, s) => {
      c.fillStyle = '#f6f0e0'; c.beginPath(); c.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#1a1208'; c.font = `bold ${s * 0.1}px Georgia, serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      const R = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
      R.forEach((t, i) => { const a = (i / 12) * Math.PI * 2 - Math.PI / 2; c.fillText(t, s / 2 + Math.cos(a) * s * 0.38, s / 2 + Math.sin(a) * s * 0.38); });
      c.strokeStyle = '#1a1208'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(s / 2, s / 2); c.lineTo(s / 2, s * 0.2); c.stroke();
      c.beginPath(); c.moveTo(s / 2, s / 2); c.lineTo(s * 0.7, s * 0.56); c.stroke();
    }, 256) }),
  };
  return _G;
}

/** the thing in your hand / on the floor for a lethal or tactical */
export function gearMesh(key) {
  const G = mats();
  const g = new THREE.Group();
  if (key === 'chipbomb') return chipBombMesh();
  if (key === 'sambuca') {
    g.add(new THREE.Mesh(lathe([[0, 0], [0.028, 0], [0.034, 0.075], [0.03, 0.075], [0.024, 0.006], [0, 0.006]]), G.glass));
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.025, 0.05, 16), new THREE.MeshStandardMaterial({ color: 0x1a2a4a, emissive: 0x0a1a3a, transparent: true, opacity: 0.8 })), 0, 0.032, 0));
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.07, 10), G.blueFlame);
    flame.position.y = 0.1;
    g.add(flame);
    g.userData.flame = flame;
    return g;
  }
  if (key === 'rope') {
    g.add(new THREE.Mesh(lathe([[0.05, 0], [0.05, 0.012], [0.014, 0.03], [0.011, 0.3], [0.022, 0.32], [0, 0.34]], 14), G.brass));
    const rope = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 16, Math.PI), G.velvet);
    rope.position.set(0.05, 0.25, 0);
    rope.rotation.z = Math.PI;
    g.add(rope);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), G.redLight);
    light.position.y = 0.345;
    g.add(light);
    g.userData.light = light;
    return g;
  }
  if (key === 'jackpot') {
    g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.11), G.red), 0, 0.1, 0));
    g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.03, 0.12), G.gold), 0, 0.215, 0));
    g.add(at(new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.065), G.reels), 0, 0.13, 0.0555));
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 6), G.chrome);
    arm.position.set(0.095, 0.15, 0);
    g.add(arm);
    g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), G.redLight), 0.095, 0.205, 0));
    const lights = [];
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 4), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffd24a, emissiveIntensity: 3 }));
      b.position.set(-0.06 + i * 0.03, 0.235, 0.03);
      g.add(b);
      lights.push(b);
    }
    g.userData.lights = lights;
    return g;
  }
  if (key === 'bellini') {
    const glass = cocktailGlass('#ffb080');
    glass.scale.setScalar(1.1);
    g.add(glass);
    return g;
  }
  if (key === 'clock') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.016, 28), [G.gold, G.watch, G.gold]);
    body.rotation.x = Math.PI / 2;
    body.position.y = 0.05;
    g.add(body);
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.013, 0.003, 6, 14), G.gold);
    bow.position.y = 0.103;
    g.add(bow);
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.01, 8), G.gold), 0, 0.097, 0));
    return g;
  }
  if (key === 'flash') {
    const dish = new THREE.Mesh(lathe([[0.008, 0], [0.03, 0.02], [0.05, 0.05], [0.052, 0.055]], 20), new THREE.MeshStandardMaterial({ color: 0xf0f0f4, metalness: 1, roughness: 0.08, side: THREE.DoubleSide }));
    dish.rotation.x = Math.PI / 2;
    dish.position.set(0, 0.07, 0.01);
    g.add(dish);
    g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 1.2, transparent: true, opacity: 0.8 })), 0, 0.07, 0.03));
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.08, 10), G.black), 0, 0.03, 0));
    return g;
  }
  if (key === 'eye') {
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.04, 20), G.black), 0, 0.02, 0));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.068, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0a0a0e, metalness: 0.6, roughness: 0.05, transparent: true, opacity: 0.85 }));
    dome.rotation.x = Math.PI;
    dome.position.y = 0.04;
    g.add(dome);
    g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), G.lens), 0, -0.005, 0.045));
    return g;
  }
  return chipBombMesh();
}

/** the deployed EYE IN THE SKY: a tripod, a swiveling head with a dome camera and a barrel */
export function sentryMesh() {
  const G = mats();
  const g = new THREE.Group();
  const legs = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.012, 1.0, 8), G.chrome);
    leg.position.set(Math.cos(a) * 0.22, 0.46, Math.sin(a) * 0.22);
    leg.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45);
    legs.add(leg);
  }
  g.add(legs);
  const head = new THREE.Group();
  head.position.y = 0.95;
  head.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.32), G.black));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0a0a0e, metalness: 0.6, roughness: 0.05, transparent: true, opacity: 0.85 }));
  dome.rotation.x = Math.PI;
  dome.position.set(0, -0.07, 0.04);
  head.add(dome);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), G.lens);
  lens.position.set(0, -0.12, 0.1);
  head.add(lens);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.34, 10), G.chrome);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.3);
  head.add(barrel);
  head.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.02, 0.34), G.gold), 0, 0.08, 0));
  g.add(head);
  g.userData = { head, lens, legs, muzzle: new THREE.Vector3(0, 0.02, -0.48) };
  return g;
}
