// merge.js — bake static decor into one mesh per material (world transforms
// applied). Hundreds of props become a handful of draw calls.

import * as THREE from 'three';

function mergeGeos(geos) {
  let vCount = 0, iCount = 0;
  const hasUV = geos.every((g) => g.attributes.uv);
  for (const g of geos) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3), nrm = new Float32Array(vCount * 3);
  const uv = hasUV ? new Float32Array(vCount * 2) : null;
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vo = 0, io = 0;
  for (const g of geos) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, n * 3), vo * 3);
    nrm.set(g.attributes.normal.array.subarray(0, n * 3), vo * 3);
    if (uv) uv.set(g.attributes.uv.array.subarray(0, n * 2), vo * 2);
    if (g.index) for (let k = 0; k < g.index.count; k++) idx[io++] = g.index.array[k] + vo;
    else for (let k = 0; k < n; k++) idx[io++] = vo + k;
    vo += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/** merge every static single-material mesh under root; skips userData.dynamic */
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  const remove = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material)) return;
    let p = o, dyn = false;
    while (p && p !== root) { if (p.userData.dynamic) { dyn = true; break; } p = p.parent; }
    if (dyn) return;
    const g = o.geometry.index ? o.geometry.clone() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (!buckets.has(o.material)) buckets.set(o.material, []);
    buckets.get(o.material).push(g);
    remove.push(o);
  });
  for (const o of remove) o.parent.remove(o);
  let calls = 0;
  for (const [mat, geos] of buckets) {
    const m = new THREE.Mesh(mergeGeos(geos), mat);
    m.matrixAutoUpdate = false;
    m.renderOrder = mat.transparent ? 1 : 0;
    root.add(m);
    for (const g of geos) g.dispose();
    calls++;
  }
  return calls;
}
