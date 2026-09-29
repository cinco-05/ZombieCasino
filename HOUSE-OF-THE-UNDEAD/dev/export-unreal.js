// export-unreal.js — dev tool (not shipped): exports the game's procedural
// characters as glTF for the Unreal Engine rebuild
// (C:\Users\cj5st\UnrealProjects\HouseOfTheUndead\SourceArt).
//
// Each character becomes ONE skinned mesh: the body plus every prop (hats,
// eyes, cigars...) rigidly bound to its bone, sharing one 20-bone skeleton.
// The procedural acting (character.js) is baked into clips at 30 fps: Idle,
// Move (two gait cycles at the kind's speed), Attack, Hit, Rise, Death. The
// pivot's hop and squash-and-stretch ride on the root bone.
//
// Use from the running game's page (the preview serves this folder):
//   const X = await import('/dev/export-unreal.js');
//   const { glb, info } = await X.exportCharacter('walker');

import * as THREE from 'three';
import { GLTFExporter } from '../node_modules/three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from '../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';
import { Character } from '../src/chars/character.js';
import { CONFIG } from '../src/config.js';

const FPS = 30;
const STRIDE = { run: 1.9, lurch: 1.4, stalk: 1.3 };       // character.js _animate()
const ATTRS = ['position', 'normal', 'uv', 'skinIndex', 'skinWeight'];

/** strip what only the game needs: hitboxes, the contact shadow, sprites */
function strip(c) {
  const drop = [];
  c.root.traverse((o) => { if ((o.userData && o.userData.ref) || o === c.shadow || o.isSprite) drop.push(o); });
  for (const o of drop) o.parent?.remove(o);
}

const boneOf = (o) => { let p = o.parent; while (p && !p.isBone) p = p.parent; return p; };

/** one geometry with exactly ATTRS (props have no skinning; some have no uv) */
function normalise(geo, boneIndex = -1) {
  const n = geo.attributes.position.count, out = new THREE.BufferGeometry();
  if (!geo.attributes.normal) geo.computeVertexNormals();
  for (const a of ATTRS) {
    let src = geo.attributes[a];
    if (!src && a === 'uv') src = new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2);
    if (!src && a === 'skinIndex') src = new THREE.Uint16BufferAttribute(new Uint16Array(n * 4).map((_, i) => (i % 4 === 0 ? boneIndex : 0)), 4);
    if (!src && a === 'skinWeight') src = new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4);
    out.setAttribute(a, a === 'skinIndex'
      ? new THREE.Uint16BufferAttribute(Uint16Array.from(src.array), 4)
      : new THREE.Float32BufferAttribute(Float32Array.from(src.array), src.itemSize));
  }
  out.setIndex(geo.index ? Array.from(geo.index.array) : [...Array(n).keys()]);
  return out;
}

/** the body + every visible prop -> one SkinnedMesh on the same skeleton */
function mergeCharacter(c, kind) {
  const body = c.mesh, skel = body.skeleton;
  c.root.updateMatrixWorld(true);
  const toBody = new THREE.Matrix4().copy(body.matrixWorld).invert();
  const pieces = [], mats = [];
  const add = (geo, material, groups) => {
    const list = Array.isArray(material) ? material : [material];
    const gs = groups && groups.length ? groups : [{ start: 0, count: geo.index.count, materialIndex: 0 }];
    for (const g of gs) {
      const sub = geo.clone();
      sub.setIndex(Array.from(geo.index.array.slice(g.start, g.start + g.count)));
      pieces.push(sub); mats.push(list[g.materialIndex] || list[0]);
    }
  };
  add(normalise(body.geometry), body.material, body.geometry.groups);
  const props = [];
  c.root.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh && o.visible && o.material?.visible !== false) props.push(o); });
  for (const m of props) {
    const b = boneOf(m);
    if (!b) continue;
    const g = m.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toBody, m.matrixWorld));   // bind pose, body space
    const ng = normalise(g, skel.bones.indexOf(b));
    add(ng, m.material, null);
  }
  const merged = mergeGeometries(pieces, true);
  const uniq = [...new Set(mats)];
  merged.groups.forEach((g, i) => { g.materialIndex = uniq.indexOf(mats[i]); });
  // export copies: Unreal's glTF importer doesn't take EXT_materials_bump (and the cartoon paints flat anyway)
  const exportMats = uniq.map((m, i) => {
    const e = m.clone();
    if ('bumpMap' in e) { e.bumpMap = null; e.bumpScale = 1; }   // (the exporter writes the extension for any bumpScale ≠ 1)
    e.name = `M_HOTU_${kind}_${i}`;
    return e;
  });
  const one = new THREE.SkinnedMesh(merged, exportMats);
  one.name = `SK_HOTU_${kind}`;
  const rootBone = skel.bones.find((b) => !b.parent || !b.parent.isBone);
  body.parent.add(one);
  one.add(rootBone);                                  // the skeleton must stay in the exported scene
  for (const m of props) m.parent?.remove(m);
  body.parent.remove(body);
  one.bind(skel, body.bindMatrix);
  return { props: props.length, slots: uniq.length, verts: merged.attributes.position.count };
}

/** sample the procedural acting of a fresh copy into a clip */
function record(kind, variant, name, seconds, setup, speed) {
  const f = new Character(kind, { variant });
  f.phase = 0; f.t = 0;
  setup?.(f);
  const bones = f.mesh.skeleton.bones, root = bones.find((b) => !b.parent || !b.parent.isBone);
  const n = Math.round(seconds * FPS) + 1, times = [];
  const Q = bones.map(() => []), T = bones.map(() => []), S = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) f.update(1 / FPS, speed);
    times.push(i / FPS);
    bones.forEach((b, k) => {
      let q = b.quaternion, p = b.position;
      if (b === root) {                                 // fold the pivot (hop, squash) into the root bone
        q = f.pivot.quaternion.clone().multiply(b.quaternion);
        p = b.position.clone().multiply(f.pivot.scale).add(f.pivot.position);
        S.push(...f.pivot.scale.toArray());
      }
      Q[k].push(...q.toArray()); T[k].push(...p.toArray());
    });
  }
  const tracks = [];
  bones.forEach((b, k) => {
    tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, Q[k]));
    tracks.push(new THREE.VectorKeyframeTrack(`${b.name}.position`, times, T[k]));
  });
  tracks.push(new THREE.VectorKeyframeTrack(`${root.name}.scale`, times, S));
  f.dispose?.();
  return new THREE.AnimationClip(name, seconds, tracks);
}

// ------------------------------------------------------------ the casino --

/** a texture's repeat/offset folded into the UVs (so no importer has to understand KHR_texture_transform) */
function bakeUvTransform(geo, tex) {
  if (!tex || !geo.attributes.uv) return;
  const r = tex.repeat, o = tex.offset;
  if (r.x === 1 && r.y === 1 && o.x === 0 && o.y === 0 && !tex.rotation) return;
  tex.updateMatrix();
  const uv = geo.attributes.uv, v = new THREE.Vector2();
  for (let i = 0; i < uv.count; i++) { v.fromBufferAttribute(uv, i).applyMatrix3(tex.matrix); uv.setXY(i, v.x, v.y); }
}

function exportMaterial(m, i) {
  const e = m.clone();
  for (const k of ['map', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'normalMap', 'alphaMap', 'aoMap']) {
    if (e[k]) { e[k] = e[k].clone(); e[k].repeat.set(1, 1); e[k].offset.set(0, 0); e[k].rotation = 0; e[k].needsUpdate = true; }
  }
  if ('bumpMap' in e) { e.bumpMap = null; e.bumpScale = 1; }
  e.name = `M_Casino_${i}`;
  return e;
}

/**
 * The whole building as it stands on the menu: every visible mesh baked into
 * world space and merged per material (static decor is already merged that
 * way in-game). Additive glows (light shafts, halos) are left out — Unreal
 * rebuilds those with real volumetric light. Returns the glb plus a JSON
 * layout: collision boxes and circles, doors, zones, lights, spawn cells and
 * the machines, all in the original's coordinates (metres, y up).
 */
export async function exportCasino(arena, player) {
  arena.group.updateMatrixWorld(true);
  const byMat = new Map();
  const add = (geo, mat) => {
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat).push(geo);
  };
  let skipped = 0;
  arena.group.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    let p = o; while (p) { if (!p.visible) return; p = p.parent; }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some((m) => m.blending === THREE.AdditiveBlending || m.visible === false)) { skipped++; return; }
    const src = o.geometry;
    const one = (matrix) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', src.attributes.position.clone());
      if (src.attributes.normal) g.setAttribute('normal', src.attributes.normal.clone()); else g.computeVertexNormals();
      g.setAttribute('uv', src.attributes.uv ? src.attributes.uv.clone() : new THREE.Float32BufferAttribute(new Float32Array(src.attributes.position.count * 2), 2));
      if (src.index) g.setIndex(src.index.clone());
      g.applyMatrix4(matrix);
      return g.index ? g : g;                      // (non-indexed stays non-indexed; merge handles both via toNonIndexed below)
    };
    const matrices = [];
    if (o.isInstancedMesh) {
      const m = new THREE.Matrix4();
      for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); matrices.push(new THREE.Matrix4().multiplyMatrices(o.matrixWorld, m)); }
    } else matrices.push(o.matrixWorld);
    for (const mx of matrices) {
      const g = one(mx);
      if (src.groups.length && mats.length > 1) {
        for (const gr of src.groups) {
          const sub = g.index ? g.clone() : g.toNonIndexed();
          if (g.index) sub.setIndex(Array.from(g.index.array.slice(gr.start, gr.start + gr.count)));
          add(sub, mats[gr.materialIndex] || mats[0]);
        }
      } else add(g, mats[0]);
    }
  });
  const scene = new THREE.Scene();
  let i = 0, tris = 0;
  for (const [mat, geos] of byMat) {
    const norm = geos.map((g) => (g.index ? g.toNonIndexed() : g));
    norm.forEach((g) => bakeUvTransform(g, mat.map || mat.emissiveMap));
    const merged = mergeGeometries(norm, false);
    tris += merged.attributes.position.count / 3;
    const mesh = new THREE.Mesh(merged, exportMaterial(mat, i));
    mesh.name = `SM_Casino_${String(i).padStart(2, '0')}`;
    scene.add(mesh);
    i++;
  }
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true, maxTextureSize: 2048 });

  const light = (l) => ({
    type: l.type, color: '#' + l.color.getHexString(), intensity: l.intensity,
    position: l.position.toArray(), distance: l.distance ?? 0, decay: l.decay ?? 2,
    angle: l.angle ?? 0, penumbra: l.penumbra ?? 0,
    target: l.target ? l.target.position.toArray() : null,
    groundColor: l.groundColor ? '#' + l.groundColor.getHexString() : null,
  });
  const lights = [];
  arena.group.traverse((o) => { if (o.isLight && o.intensity > 0 && o.position.y > -5) lights.push(light(o)); });
  const layout = {
    units: 'metres, three.js axes: x east, y up, z south',
    playerStart: [0, 0, 8],
    boxes: arena.boxes.map((b) => ({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, h: b.h, door: b.door ?? null })),
    circles: arena.colliders.map((c) => ({ x: c.x, z: c.z, r: c.r, h: c.h ?? 3 })),
    doors: arena.doors.map((d) => ({ zone: d.zone, key: d.def.key, price: d.def.price, gap: d.def.gap, side: d.def.side })),
    spawnCells: arena.spawnPoints,
    lights,
    wingLights: arena.wingDefs,
    automats: arena.perkMachines.map((p) => ({ key: p.key, pos: p.pos.toArray(), facing: p.facing })),
    bigSix: arena.bigSix ? { pos: arena.bigSix.pos?.toArray?.() ?? null } : null,
  };
  return { glb, layout, info: { materials: i, tris: Math.round(tris), skippedGlows: skipped, kb: Math.round(glb.byteLength / 1024), lights: lights.length, boxes: layout.boxes.length, circles: layout.circles.length } };
}

// ------------------------------------------------------------- the guns --

/**
 * One first-person viewmodel (gun + gloved hands + sleeves) as a single
 * multi-material static mesh, in the model's own space (three.js camera
 * space: x right, y up, -z forward). Hidden parts (the spare fist, the
 * dropped mag) are left out. Returns the glb and where it sits: the game's
 * hip pose for this gun and the overall viewmodel rig offset/scale.
 */
export async function exportViewmodel(id, model, gunfx) {
  model.updateMatrixWorld(true);
  const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const byMat = new Map();
  model.traverse((o) => {
    if (!o.isMesh) return;
    let p = o; while (p && p !== model.parent) { if (!p.visible && p !== model) return; p = p.parent; }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some((m) => m.blending === THREE.AdditiveBlending || m.visible === false)) return;
    const g = new THREE.BufferGeometry();
    const s = o.geometry;
    g.setAttribute('position', s.attributes.position.clone());
    g.setAttribute('normal', s.attributes.normal ? s.attributes.normal.clone() : (s.computeVertexNormals(), s.attributes.normal.clone()));
    g.setAttribute('uv', s.attributes.uv ? s.attributes.uv.clone() : new THREE.Float32BufferAttribute(new Float32Array(s.attributes.position.count * 2), 2));
    if (s.index) g.setIndex(s.index.clone());
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toModel, o.matrixWorld));
    const flat = g.index ? g.toNonIndexed() : g;
    const mat = mats[0];
    bakeUvTransform(flat, mat.map);
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat).push(flat);
  });
  const geos = [], mats = [];
  let i = 0;
  for (const [mat, list] of byMat) { geos.push(mergeGeometries(list, false)); mats.push(exportMaterial(mat, i++)); }
  const merged = mergeGeometries(geos, true);
  mats.forEach((m, k) => { m.name = `M_VM_${id}_${k}`; });
  const mesh = new THREE.Mesh(merged, mats);
  mesh.name = `SM_VM_${id}`;
  const scene = new THREE.Scene(); scene.add(mesh);
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true, maxTextureSize: 1024 });
  const ud = model.userData || {};
  return {
    glb,
    placement: {
      hip: gunfx?.hip ?? null,                     // [x, y, z, yaw] in the viewmodel rig
      muzzle: ud.muzzle ? ud.muzzle.toArray() : null,
      port: ud.port ? ud.port.toArray() : null,
    },
    info: { id, slots: mats.length, tris: Math.round(merged.attributes.position.count / 3), kb: Math.round(glb.byteLength / 1024) },
  };
}

export async function exportCharacter(kind, variant = 0) {
  const c = new Character(kind, { variant });
  strip(c);
  const gait = c.gait;
  const speed = (CONFIG.enemies[kind] || { speed: 2.2 }).speed;
  const cycle = (STRIDE[gait] || 1.05) / speed;
  const clips = [
    record(kind, variant, 'Idle', 3, null, 0),
    record(kind, variant, 'Move', cycle * 2, null, speed),
    record(kind, variant, 'Attack', 0.7, (f) => f.attack('swipe', 0.45), 0),
    record(kind, variant, 'Hit', 0.5, (f) => f.flinch(1), 0),
    record(kind, variant, 'Rise', 1.4, (f) => f.rise(1.2), 0),
    record(kind, variant, 'Death', 2.5, (f) => f.die(), 0),
  ];
  const merge = mergeCharacter(c, kind);
  const glb = await new GLTFExporter().parseAsync(c.root, { binary: true, animations: clips, onlyVisible: true });
  return { glb, info: { kind, variant, gait, bones: c.bones ? Object.keys(c.bones).length : 0, clips: clips.map((k) => k.name), ...merge, kb: Math.round(glb.byteLength / 1024) } };
}
