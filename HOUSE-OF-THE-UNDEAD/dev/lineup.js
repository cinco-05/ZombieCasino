// dev lineup: every character side by side with orbit controls, for tuning.
import * as THREE from 'three';
import { Character } from '../src/chars/character.js';
import { makeEnvironment } from '../src/gfx/env.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x140a1e);
scene.environment = makeEnvironment(renderer);
scene.environmentIntensity = 0.55;
const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 100);

scene.add(new THREE.HemisphereLight(0x9a86ff, 0x1a0e22, 0.6));
const key = new THREE.DirectionalLight(0xffe0c0, 2.2);
key.position.set(3, 6, 5);
scene.add(key);
const rim = new THREE.DirectionalLight(0x27e6ff, 1.2);
rim.position.set(-4, 3, -5);
scene.add(rim);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x241238, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const kinds = ['walker', 'sprinter', 'brute', 'spitter', 'gasbag', 'pitguard', 'collector', 'croupier', 'magician', 'jackpot', 'pitboss', 'housedealer'];
const scales = { brute: 1.2, gasbag: 1.1, pitguard: 1.1, pitboss: 1.6, housedealer: 1.45 };
const chars = [];
const params = new URLSearchParams(location.search);
const only = params.get('only');
const list = only ? only.split(',') : kinds;
list.forEach((k, i) => {
  const c = new Character(k, { elite: params.get('elite') === '1', variant: +(params.get('v') || 0) });
  c.root.position.set((i - (list.length - 1) / 2) * 1.3, 0, 0);
  c.root.scale.setScalar(scales[k] || 1);
  scene.add(c.root);
  chars.push(c);
});

// orbit
let yaw = +(params.get('yaw') || 0), pitch = +(params.get('pitch') || 0.12), dist = +(params.get('dist') || (only ? 3 : 9));
let target = new THREE.Vector3(0, +(params.get('ty') || 1.1), 0);
let drag = null;
addEventListener('mousedown', (e) => { drag = [e.clientX, e.clientY]; });
addEventListener('mouseup', () => { drag = null; });
addEventListener('mousemove', (e) => {
  if (!drag) return;
  yaw -= (e.clientX - drag[0]) * 0.005; pitch += (e.clientY - drag[1]) * 0.005;
  pitch = Math.max(-0.4, Math.min(1.3, pitch));
  drag = [e.clientX, e.clientY];
});
addEventListener('wheel', (e) => { dist *= Math.exp(e.deltaY * 0.001); });

let walking = params.get('walk') === '1', speed = 1.3;
const ui = document.getElementById('ui');
const btn = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; ui.appendChild(b); };
btn('walk', () => { walking = !walking; });
btn('attack', () => chars.forEach((c) => c.attack(c.kind === 'croupier' || c.kind === 'housedealer' ? 'throw' : c.kind === 'spitter' ? 'spit' : 'swipe')));
btn('flinch', () => chars.forEach((c) => c.flinch(1)));
btn('die', () => chars.forEach((c) => c.die()));
btn('rise', () => chars.forEach((c) => c.rise()));
btn('atlas', () => {
  const img = document.getElementById('atlas');
  img.style.display = img.style.display === 'block' ? 'none' : 'block';
  img.src = chars[0].skin.canvas.toDataURL();
});
window.LINEUP = { chars, setView: (y, p, d, ty) => { yaw = y; pitch = p; dist = d; if (ty !== undefined) target.y = ty; } };

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  for (const c of chars) c.update(dt, walking ? speed : 0);
  cam.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
  cam.lookAt(target);
  renderer.render(scene, cam);
});
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
});
