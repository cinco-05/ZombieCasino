// env.js — image-based lighting without image files: a tiny procedural
// "casino interior" (dark room, warm chandeliers, neon strips) is rendered
// into a prefiltered environment map so metal, leather and satin reflect.

import * as THREE from 'three';

export function makeEnvironment(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0810);
  const room = new THREE.Mesh(new THREE.BoxGeometry(40, 14, 40),
    new THREE.MeshBasicMaterial({ color: 0x1a1016, side: THREE.BackSide }));
  room.position.y = 5;
  scene.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0x2a1030 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.9;
  scene.add(floor);
  const panel = (color, intensity, w, h, x, y, z, ry = 0, rx = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    scene.add(m);
  };
  // warm overhead chandeliers
  panel(0xffd9a0, 6, 6, 6, 0, 11.9, 0, 0, Math.PI / 2);
  panel(0xffc070, 3, 3, 3, -9, 11.9, 8, 0, Math.PI / 2);
  panel(0xffc070, 3, 3, 3, 10, 11.9, -7, 0, Math.PI / 2);
  // neon strips around the walls
  panel(0xff2d78, 4, 14, 0.8, 0, 4, -19.9);
  panel(0x27e6ff, 4, 14, 0.8, -19.9, 5, 0, Math.PI / 2);
  panel(0xffd24a, 3, 12, 0.8, 19.9, 4.5, 4, -Math.PI / 2);
  panel(0x2dff7a, 2, 10, 0.6, 3, 3.5, 19.9, Math.PI);
  // soft key from the front-top
  panel(0xfff0e0, 1.5, 12, 6, 0, 6, 19.8, Math.PI);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.04);
  pmrem.dispose();
  scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return rt.texture;
}
