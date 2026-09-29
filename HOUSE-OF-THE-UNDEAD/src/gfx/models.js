// models.js — small shared props: poker chips (pickups + the chip bomb),
// ammo boxes, first-aid tins. Geometry/materials are built once and reused.

import * as THREE from 'three';
import { makeCanvas, toTexture, noiseCanvas } from './texkit.js';

const _cache = new Map();
const once = (key, make) => {
  if (!_cache.has(key)) _cache.set(key, make());
  return _cache.get(key);
};

/** a casino chip face: colored disc, white edge spots, inlay ring, label */
export function chipFaceTexture(color = '#b3122e', label = '☠', ink = '#f4efe2') {
  return once('chipface' + color + label, () => {
    const S = 256, cv = makeCanvas(S), c = cv.getContext('2d');
    c.fillStyle = color;
    c.beginPath(); c.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); c.fill();
    c.fillStyle = ink;
    for (let i = 0; i < 8; i++) {
      c.beginPath();
      c.moveTo(S / 2, S / 2);
      c.arc(S / 2, S / 2, S / 2, (i / 8) * Math.PI * 2 - 0.16, (i / 8) * Math.PI * 2 + 0.16);
      c.closePath(); c.fill();
    }
    c.fillStyle = color;
    c.beginPath(); c.arc(S / 2, S / 2, S * 0.36, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#d8b23a'; c.lineWidth = 6;
    c.beginPath(); c.arc(S / 2, S / 2, S * 0.33, 0, Math.PI * 2); c.stroke();
    c.setLineDash([6, 8]); c.lineWidth = 3;
    c.beginPath(); c.arc(S / 2, S / 2, S * 0.28, 0, Math.PI * 2); c.stroke();
    c.setLineDash([]);
    c.fillStyle = ink;
    c.font = 'bold 90px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(label, S / 2, S / 2 + 6);
    c.globalAlpha = 0.2;
    c.globalCompositeOperation = 'multiply';
    c.drawImage(noiseCanvas(256, 8, 3, 3, 1.3), 0, 0);
    return toTexture(cv);
  });
}

function chipEdgeTexture(color) {
  return once('chipedge' + color, () => {
    const cv = makeCanvas(256, 16), c = cv.getContext('2d');
    c.fillStyle = color; c.fillRect(0, 0, 256, 16);
    c.fillStyle = '#f4efe2';
    for (let i = 0; i < 8; i++) c.fillRect(i * 32 + 4, 0, 12, 16);
    return toTexture(cv);
  });
}

const CHIP_COLORS = ['#b3122e', '#1a3a9a', '#141414', '#1a7a3a', '#c9a227'];

export function chipMesh(color = '#b3122e', r = 0.2, h = 0.045) {
  const geo = once('chipgeo' + r + h, () => new THREE.CylinderGeometry(r, r, h, 32));
  const mats = once('chipmats' + color, () => {
    const face = new THREE.MeshStandardMaterial({ map: chipFaceTexture(color), roughness: 0.35, metalness: 0.05 });
    const edge = new THREE.MeshStandardMaterial({ map: chipEdgeTexture(color), roughness: 0.4 });
    return [edge, face, face];
  });
  return new THREE.Mesh(geo, mats);
}

/** a small tumbling stack for chip pickups */
export function chipStack(amount = 20) {
  const g = new THREE.Group();
  const n = Math.min(5, 1 + Math.floor(amount / 25));
  for (let i = 0; i < n; i++) {
    const m = chipMesh(CHIP_COLORS[(i + Math.floor(amount)) % CHIP_COLORS.length], 0.16, 0.036);
    m.position.set((Math.random() - 0.5) * 0.03, i * 0.038, (Math.random() - 0.5) * 0.03);
    m.rotation.y = Math.random() * 6;
    g.add(m);
  }
  const gold = n >= 4;
  g.userData.glowColor = gold ? 0xffd24a : 0xff6a4a;
  return g;
}

/** the player's chip bomb: a fat red chip with a blinking fuse light */
export function chipBombMesh() {
  const g = new THREE.Group();
  const chip = chipMesh('#b3122e', 0.17, 0.08);
  g.add(chip);
  const light = new THREE.Mesh(once('bomblightgeo', () => new THREE.SphereGeometry(0.035, 10, 8)),
    once('bomblightmat', () => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff3a2a, emissiveIntensity: 5 })));
  light.position.y = 0.05;
  g.add(light);
  g.userData.light = light;
  return g;
}

export function ammoBoxMesh() {
  const g = new THREE.Group();
  const mats = once('ammomats', () => {
    const cv = makeCanvas(256, 128), c = cv.getContext('2d');
    c.fillStyle = '#3a4a2a'; c.fillRect(0, 0, 256, 128);
    c.globalAlpha = 0.35; c.drawImage(noiseCanvas(256, 8, 4, 12, 1.4), 0, 0, 256, 128); c.globalAlpha = 1;
    c.fillStyle = '#d8c070'; c.fillRect(0, 44, 256, 40);
    c.fillStyle = '#1a1a10'; c.font = 'bold 34px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('AMMO', 128, 65);
    c.strokeStyle = '#1a2010'; c.lineWidth = 6; c.strokeRect(3, 3, 250, 122);
    const side = new THREE.MeshStandardMaterial({ map: toTexture(cv), roughness: 0.7, metalness: 0.3 });
    const top = new THREE.MeshStandardMaterial({ color: 0x2e3a22, roughness: 0.6, metalness: 0.4 });
    return [side, side, top, top, side, side];
  });
  g.add(new THREE.Mesh(once('ammogeo', () => new THREE.BoxGeometry(0.42, 0.24, 0.3)), mats));
  const brass = once('brass', () => new THREE.MeshStandardMaterial({ color: 0xd4a83a, metalness: 1, roughness: 0.25 }));
  const bullet = once('bulletgeo', () => new THREE.CylinderGeometry(0.018, 0.018, 0.09, 10));
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(bullet, brass);
    b.position.set(-0.12 + i * 0.06, 0.16, 0);
    g.add(b);
  }
  g.userData.glowColor = 0x27e6ff;
  return g;
}

export function medkitMesh() {
  const g = new THREE.Group();
  const mats = once('medmats', () => {
    const cv = makeCanvas(128), c = cv.getContext('2d');
    c.fillStyle = '#e8e4da'; c.fillRect(0, 0, 128, 128);
    c.fillStyle = '#c4122e';
    c.fillRect(48, 20, 32, 88); c.fillRect(20, 48, 88, 32);
    c.globalAlpha = 0.25; c.drawImage(noiseCanvas(128, 6, 3, 21, 1.2), 0, 0); c.globalAlpha = 1;
    const face = new THREE.MeshStandardMaterial({ map: toTexture(cv), roughness: 0.4 });
    const body = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.45 });
    return [body, body, face, body, face, face];
  });
  g.add(new THREE.Mesh(once('medgeo', () => new THREE.BoxGeometry(0.36, 0.26, 0.26)), mats));
  const handle = new THREE.Mesh(once('medhandle', () => new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI)),
    once('medhandlemat', () => new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5 })));
  handle.position.y = 0.13;
  g.add(handle);
  g.userData.glowColor = 0xff2d55;
  return g;
}
