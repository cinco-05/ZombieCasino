// arena.js — the building. THE GRAND FLOOR (loud carpet, damask over wood
// wainscot, coffered ceiling, crystal chandeliers, slot banks, card tables,
// the roulette dais, the marble bar, the stage, the gold fountain) and three
// wings behind gilded doors you pay the doorman to open:
//   THE HIGH LIMIT ROOM            velvet, black marble, baccarat, a champagne tower
//   THE LITTLE CHAPEL OF THE DEAD  pews, stained glass, a coffin at the altar
//   THE COUNTING ROOM              concrete, cages, money carts, the vault door
// Plus the cocktail automats (perk machines) and THE BIG SIX money wheel.
// Collision is circles + boxes; the nav grid (nav.js) knows every room so the
// dead can follow you through the doors. Static decor merges into a few draws.

import * as THREE from 'three';
import { clamp } from './config.js';
import { Audio } from './audio.js';
import { toTexture, softBlobCanvas } from './gfx/texkit.js';
import * as CT from './gfx/casinotex.js';
import { mergeStatic } from './gfx/merge.js';
import { chipFaceTexture } from './gfx/models.js';
import { cardMesh } from './chars/props.js';
import { NavGrid } from './nav.js';
import { DRINKS, GUNS } from './catalog.js';
import { perkMachine, bigSixWheel, cocktailGlass } from './gfx/machines.js';
import { allInMachine, workbench, crapsTable, welcomeSign, kenoBoard, stripSkyline } from './gfx/vegas.js';
import { Character } from './chars/character.js';
import { STYLE, noInk } from './gfx/style.js';
const HEMI_SKY = STYLE.cartoon ? 0xfff0d8 : 0x7a60b8;

export const ARENA_HALF = 34;        // legacy: radius-ish of the grand floor
const FACE = 35.5;                    // the grand floor's wall faces
const DOOR_H = 3.6;

// the rooms. rect = walkable interior [x0, z0, x1, z1]; gap = the doorway
// tunnel through the grand floor's wall; side = which wall it's in
export const ZONES = [
  { key: 'floor', name: 'THE GRAND FLOOR', rect: [-35.3, -35.3, 35.3, 35.3], ceil: 7, price: 0 },
  { key: 'highlimit', name: 'THE HIGH LIMIT ROOM', sub: 'Invitation only', rect: [-14.8, -59.8, 14.8, -37], ceil: 5.6,
    price: 300, gap: [-3, -37, 3, -35.3], side: 'n' },
  { key: 'chapel', name: 'THE LITTLE CHAPEL OF THE DEAD', sub: 'Weddings 24 hours', rect: [-59.8, -12.8, -37, 12.8], ceil: 6.8,
    price: 250, gap: [-37, -3, -35.3, 3], side: 'w' },
  { key: 'counting', name: 'THE COUNTING ROOM', sub: 'Staff only', rect: [37, -12.8, 57.8, 12.8], ceil: 4.6,
    price: 250, gap: [35.3, -3, 37, 3], side: 'e' },
];

// where each cocktail automat stands: [x, z, facing]
const PERK_SPOTS = {
  daiquiri: [-34.75, -26, Math.PI / 2],
  fizz: [34.75, 22, -Math.PI / 2],
  liqueur: [-10, 34.75, Math.PI],
  stout: [-8, -59.25, 0],
  shooter: [8, -59.25, 0],
  spritz: [-41, -12.25, 0],
  dram: [-41, 12.25, Math.PI],
  sling: [45, -12.25, 0],
  punch: [45, 12.25, Math.PI],
};

const lathe = (pts, segs = 32) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);
/** place a mesh and hand it back (Object3D.position is read-only, so no Object.assign) */
const at = (m, x, y, z) => { m.position.set(x, y, z); return m; };

function repeatTex(t, rx, ry) {
  const c = t.clone();
  c.wrapS = c.wrapT = THREE.RepeatWrapping;
  c.repeat.set(rx, ry);
  c.needsUpdate = true;
  return c;
}
const tiled = (t) => repeatTex(t, 1, 1);
/** scale a geometry's UVs so a tiled texture keeps real-world size */
function uvScale(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}
const plane = (w, h, tw = 0, th = 0) => {
  const g = new THREE.PlaneGeometry(w, h);
  return tw ? uvScale(g, w / tw, h / th) : g;
};

export class Arena {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.static = new THREE.Group();
    this.group.add(this.static);
    this.colliders = [];     // circles {x, z, r, h}
    this.boxes = [];         // AABBs {x0, z0, x1, z1, h, zone?}
    this.redAlert = false;
    this.lowLight = false;
    this.pulseT = 0;
    this.flickerNeons = [];
    this.discoLights = [];
    this.doors = [];
    this.perkMachines = [];
    this._v = new THREE.Vector3();
    this._down = new THREE.Vector3(0, -1, 0);
    this._build();
    this._applyLights(1);          // start at the style's base intensities
    this.drawCalls = mergeStatic(this.static);
    this._buildNav();
    game.scene.add(this.group);
  }

  // ------------------------------- materials --------------------------------
  _mats() {
    const M = {};
    const carpet = CT.carpet();
    M.carpet = new THREE.MeshStandardMaterial({ map: repeatTex(carpet.map, 8, 8), bumpMap: repeatTex(carpet.bump, 8, 8), bumpScale: 2, roughness: 0.96 });
    const dm = CT.damask();
    M.wall = new THREE.MeshStandardMaterial({ map: tiled(dm.map), bumpMap: tiled(dm.bump), bumpScale: 1.5, roughness: 0.85 });
    const wp = CT.woodPanels();
    M.wains = new THREE.MeshStandardMaterial({ map: tiled(wp.map), bumpMap: tiled(wp.bump), bumpScale: 2, roughness: 0.45, metalness: 0.05 });
    M.gold = new THREE.MeshStandardMaterial({ color: 0xd8a830, metalness: 1, roughness: 0.34, envMapIntensity: 0.8 });
    M.brass = new THREE.MeshStandardMaterial({ color: 0xb8902a, metalness: 1, roughness: 0.4 });
    M.chrome = new THREE.MeshStandardMaterial({ color: 0xe8ecf4, metalness: 1, roughness: 0.12 });
    M.marble = new THREE.MeshStandardMaterial({ map: repeatTex(CT.marble(), 2, 2), roughness: 0.18, metalness: 0.1 });
    M.marbleW = new THREE.MeshStandardMaterial({ map: repeatTex(CT.marble('#d8d0c4', '#6a6a70', 5), 2, 2), roughness: 0.15 });
    M.ceiling = new THREE.MeshStandardMaterial({ map: repeatTex(CT.coffer(), 18, 18), roughness: 0.7, metalness: 0.2 });
    M.ceilingU = new THREE.MeshStandardMaterial({ map: tiled(CT.coffer()), roughness: 0.7, metalness: 0.2, color: 0x8a7a8a });
    M.wood = new THREE.MeshStandardMaterial({ color: 0x3a1c0a, roughness: 0.45, metalness: 0.05 });
    M.darkWood = new THREE.MeshStandardMaterial({ color: 0x1a0c06, roughness: 0.5 });
    M.leather = new THREE.MeshStandardMaterial({ color: 0x0c0a0c, roughness: 0.45 });
    M.redLeather = new THREE.MeshStandardMaterial({ color: 0x7a0a16, roughness: 0.42 });
    M.felt = new THREE.MeshStandardMaterial({ map: CT.blackjackFelt(), roughness: 0.95 });
    M.cabinet = new THREE.MeshStandardMaterial({ color: 0x1a1222, metalness: 0.55, roughness: 0.32 });
    M.base = new THREE.MeshStandardMaterial({ color: 0x0c0a10, roughness: 0.6 });
    M.velvet = new THREE.MeshStandardMaterial({ map: repeatTex(CT.velvet('#5a0f1f'), 6, 1), roughness: 0.95 });
    M.velvetU = new THREE.MeshStandardMaterial({ map: tiled(CT.velvet('#6a0f22')), roughness: 0.92 });
    M.rope = new THREE.MeshStandardMaterial({ color: 0x8a0a1c, roughness: 0.7 });
    M.mirror = new THREE.MeshStandardMaterial({ color: 0x8a8a9a, metalness: 1, roughness: 0.06 });
    M.bulb = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffd9a0, emissiveIntensity: 3 });
    M.crystal = new THREE.MeshStandardMaterial({ color: 0xeef4ff, emissive: 0xffe0b0, emissiveIntensity: 0.6, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.8 });
    M.lacquer = new THREE.MeshStandardMaterial({ color: 0x0a0608, metalness: 0.3, roughness: 0.2 });
    // back rooms
    // polished but not a mirror: a glassy floor catches the environment's hot spots
    M.blackMarble = new THREE.MeshStandardMaterial({ map: tiled(CT.marble('#0a080c', '#b8902a', 9)), roughness: 0.32, metalness: 0.1, envMapIntensity: 0.3 });
    M.rug = new THREE.MeshStandardMaterial({ map: CT.rug(), roughness: 0.95 });
    const pl = CT.plaster();
    M.plaster = new THREE.MeshStandardMaterial({ map: tiled(pl.map), bumpMap: tiled(pl.bump), bumpScale: 2, roughness: 0.95 });
    const pk = CT.planks();
    M.planks = new THREE.MeshStandardMaterial({ map: tiled(pk.map), bumpMap: tiled(pk.bump), bumpScale: 1.5, roughness: 0.7 });
    const cc = CT.concrete();
    M.concrete = new THREE.MeshStandardMaterial({ map: tiled(cc.map), bumpMap: tiled(cc.bump), bumpScale: 2, roughness: 0.9 });
    const sp = CT.steelPanels();
    M.steel = new THREE.MeshStandardMaterial({ map: tiled(sp.map), bumpMap: tiled(sp.bump), bumpScale: 1, metalness: 0.7, roughness: 0.45 });
    M.steelPlain = new THREE.MeshStandardMaterial({ color: 0x5a5e66, metalness: 0.85, roughness: 0.35 });
    M.chain = new THREE.MeshStandardMaterial({ map: repeatTex(CT.chainLink(), 1, 1), alphaTest: 0.5, transparent: false, side: THREE.DoubleSide, metalness: 0.8, roughness: 0.4 });
    M.hazard = new THREE.MeshStandardMaterial({ map: tiled(CT.hazard()), roughness: 0.7 });
    M.fluoro = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xe0fff0, emissiveIntensity: 2.6 });
    M.candle = new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.6 });
    M.flame = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa040, emissiveIntensity: 4 });
    M.rose = new THREE.MeshStandardMaterial({ color: 0x4a0008, roughness: 0.6, emissive: 0x1a0002 });
    M.paneGlow = new THREE.MeshStandardMaterial({ map: CT.doorPane(), emissiveMap: CT.doorPane(), emissive: 0xffd8a0, emissiveIntensity: 0.55, roughness: 0.3 });
    M.cash = new THREE.MeshStandardMaterial({ color: 0x5a7a4a, roughness: 0.8 });
    M.goldGlow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffc040, emissiveIntensity: 2.2 });
    M.screen = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x2dff7a, emissiveIntensity: 1.8 });
    return M;
  }

  _add(mesh, x = 0, y = 0, z = 0, parent = this.static) {
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  _box(x0, z0, x1, z1, h = 8, extra = {}) {
    const b = { x0, z0, x1, z1, h, ...extra };
    this.boxes.push(b);
    return b;
  }

  _build() {
    const M = this.M = this._mats();
    const S = this.static;
    const H = 7, L = FACE * 2 + 5;

    // --------------------------------- floor ---------------------------------
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(L, L), M.carpet);
    floor.rotation.x = -Math.PI / 2;
    S.add(floor);
    // gold inlay walkway ring around the dais
    // brushed (not mirror) so it doesn't catch the chandelier at grazing angles and bloom
    const inlay = new THREE.MeshStandardMaterial({ color: 0xb8902a, metalness: 0.85, roughness: 0.55, envMapIntensity: 0.35 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(7.5, 8.1, 96), inlay);
    ring.rotation.x = -Math.PI / 2;
    this._add(ring, 0, 0.012, -4);

    // --------------------------------- walls ---------------------------------
    // three doorways (north / west / east), each 6m wide under a gilded frame
    const gap = [[FACE - 3, FACE + 3]];
    this._wallRun(-FACE, -FACE, FACE, -FACE, H, 'hall', gap);     // north
    this._wallRun(FACE, -FACE, FACE, FACE, H, 'hall', gap);       // east
    this._wallRun(FACE, FACE, -FACE, FACE, H, 'hall');            // south
    this._wallRun(-FACE, FACE, -FACE, -FACE, H, 'hall', gap);     // west
    const T = 37.0, W = 35.3, E = 37.6;
    this._box(-E, -T, -3, -W); this._box(3, -T, E, -W);             // north
    this._box(-E, W, E, T);                                         // south
    this._box(-T, -E, -W, -3); this._box(-T, 3, -W, E);             // west
    this._box(W, -E, T, -3); this._box(W, 3, T, E);                 // east
    // corner columns in black marble
    for (const [x, z] of [[-35, -35], [35, -35], [-35, 35], [35, 35]]) {
      this._add(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, H, 24), M.marble), x, H / 2, z);
      this._add(new THREE.Mesh(lathe([[1.15, 0], [1.15, 0.12], [0.95, 0.3], [0.9, 0.34]]), M.gold), x, 0, z);
      this._add(new THREE.Mesh(lathe([[0.9, 0], [0.95, 0.04], [1.15, 0.22], [1.15, 0.34]]), M.gold), x, H - 0.34, z);
      this.colliders.push({ x, z, r: 1.0, h: H });
    }

    // -------------------------------- ceiling --------------------------------
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(L, L), M.ceiling);
    ceil.rotation.x = Math.PI / 2;
    this._add(ceil, 0, H, 0);
    const bulbGeo = new THREE.SphereGeometry(0.1, 8, 6);
    for (let bx = -30; bx <= 30; bx += 10) {
      for (let bz = -30; bz <= 30; bz += 10) {
        this._add(new THREE.Mesh(bulbGeo, M.bulb), bx, H - 0.1, bz);
      }
    }

    this._chandelier(0, H, -4);
    this._chandelier(-18, H, 22, 0.6);
    this._chandelier(18, H, -24, 0.6);
    this._signs();
    this._slotBanks();
    this._tables();
    this._dais();
    this._bar();
    this._stage();
    this._fountain();
    // the wings
    this._highLimit();
    this._chapel();
    this._counting();
    for (const z of ZONES) if (z.gap) this._doorway(z);
    this._perkMachines();
    this._bigSix();
    this._lights();

    this.game.scene.fog = new THREE.FogExp2(0x120818, 0.012);
    this.game.scene.background = new THREE.Color(0x0a0610);
  }

  // ------------------------------ wall builder -------------------------------
  /**
   * a finished wall from a to b; the room is on the left of a->b (the face
   * normal is (-u.z, u.x)). gaps: [[s0, s1]] distances along the run that are
   * doorways — the wall above them starts at door height.
   */
  _wallRun(ax, az, bx, bz, h, style, gaps = []) {
    const len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    const g = new THREE.Group();
    g.position.set(ax, 0, az);
    g.rotation.y = -Math.atan2(uz, ux);
    let s = 0;
    for (const [g0, g1] of [...gaps].sort((a, b) => a[0] - b[0])) {
      if (g0 > s) this._wallPiece(g, s, g0, 0, h, style);
      this._wallPiece(g, g0, g1, DOOR_H, h, style);
      s = g1;
    }
    if (s < len) this._wallPiece(g, s, len, 0, h, style);
    this.static.add(g);
  }

  /** one stretch of wall in a run's local frame (x along, +z toward the room) */
  _wallPiece(g, s0, s1, y0, h, style) {
    const M = this.M;
    const w = s1 - s0, mid = (s0 + s1) / 2;
    const add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
    const header = y0 > 0;
    if (style === 'hall' || style === 'velvet') {
      const wh = header ? 0 : style === 'hall' ? 1.4 : 1.1;
      const paperMat = style === 'hall' ? M.wall : M.velvetU;
      const ph = h - y0 - wh;
      add(new THREE.Mesh(plane(w, ph, style === 'hall' ? 2 : 1.6, style === 'hall' ? 1.87 : 3), paperMat), mid, y0 + wh + ph / 2, 0.02);
      if (wh) add(new THREE.Mesh(uvScale(new THREE.BoxGeometry(w, wh, 0.2), w / 3, 1), style === 'hall' ? M.wains : M.lacquer), mid, wh / 2, 0.1);
      const trims = style === 'hall'
        ? [[1.42, 0.1, 0.34], [0.06, 0.12, 0.3], [h - 0.2, 0.3, 0.4], [h - 0.42, 0.06, 0.34]]
        : [[1.12, 0.08, 0.3], [0.05, 0.1, 0.26], [h - 0.15, 0.24, 0.34]];
      for (const [y, th, d] of trims) {
        if (y < y0) continue;
        add(new THREE.Mesh(new THREE.BoxGeometry(w, th, d), M.gold), mid, y, d / 2 - 0.05);
      }
      if (header) add(new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, 0.34), M.gold), mid, y0 + 0.06, 0.12);
      if (!header && style === 'hall') {
        for (let sx = s0 + 4; sx < s1 - 2; sx += 8) {        // sconces
          add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 16), M.gold), sx, 3.2, 0.12).rotation.x = Math.PI / 2;
          add(new THREE.Mesh(lathe([[0.06, 0], [0.16, 0.18], [0.14, 0.2], [0.05, 0.02]], 16), M.bulb), sx, 3.15, 0.26);
        }
      }
      if (!header && style === 'velvet') {
        for (let sx = s0 + 2; sx <= s1 - 1.9; sx += 4) {     // gilded pilasters
          add(new THREE.Mesh(new THREE.BoxGeometry(0.26, h - 1.2, 0.12), M.gold), sx, 1.15 + (h - 1.2) / 2, 0.06);
        }
      }
    } else if (style === 'chapel') {
      const wh = header ? 0 : 1.2;
      const ph = h - y0 - wh;
      add(new THREE.Mesh(plane(w, ph, 3, 3), M.plaster), mid, y0 + wh + ph / 2, 0.02);
      if (wh) {
        add(new THREE.Mesh(uvScale(new THREE.BoxGeometry(w, wh, 0.16), w / 3, 1), M.wains), mid, wh / 2, 0.08);
        add(new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, 0.24), M.darkWood), mid, wh + 0.04, 0.1);
      }
      add(new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, 0.3), M.darkWood), mid, h - 0.15, 0.1);
    } else if (style === 'steel') {
      const ph = h - y0;
      add(new THREE.Mesh(plane(w, ph, 2, 2), M.steel), mid, y0 + ph / 2, 0.02);
      if (!header) add(new THREE.Mesh(uvScale(new THREE.BoxGeometry(w, 0.3, 0.06), w / 1.2, 1), M.hazard), mid, 0.15, 0.04);
      // pipes along the top
      for (const [y, r] of [[h - 0.25, 0.08], [h - 0.5, 0.05]]) {
        const p = add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 10), M.steelPlain), mid, y, 0.2);
        p.rotation.z = Math.PI / 2;
      }
    }
  }

  // --------------------------------- doorways --------------------------------
  /** gilded frame, the doorman's doors (they swing open), a velvet rope + price */
  _doorway(z) {
    const M = this.M;
    const frame = new THREE.Group();
    const rot = { n: 0, w: Math.PI / 2, e: -Math.PI / 2 }[z.side];
    const pos = { n: [0, -FACE], w: [-FACE, 0], e: [FACE, 0] }[z.side];
    frame.position.set(pos[0], 0, pos[1]);
    frame.rotation.y = rot;                         // local +z faces into the grand floor
    const add = (m, x, y, zz, parent = frame) => { m.position.set(x, y, zz); parent.add(m); return m; };
    const depth = 1.5;
    for (const sx of [-1, 1]) {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.34, DOOR_H + 0.4, 0.44), M.gold), sx * 3.17, (DOOR_H + 0.4) / 2, 0.12);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.12, DOOR_H, depth), M.darkWood), sx * 3.06, DOOR_H / 2, -depth / 2);
      add(new THREE.Mesh(lathe([[0.26, 0], [0.26, 0.1], [0.2, 0.2], [0.2, 0.24]], 16), M.gold), sx * 3.17, DOOR_H + 0.4, 0.12);
    }
    add(new THREE.Mesh(new THREE.BoxGeometry(6.7, 0.46, 0.46), M.gold), 0, DOOR_H + 0.2, 0.12);
    add(new THREE.Mesh(new THREE.BoxGeometry(6, 0.08, depth), M.darkWood), 0, DOOR_H + 0.02, -depth / 2);
    const plq = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.44), new THREE.MeshBasicMaterial({ map: CT.plaque(z.name), color: new THREE.Color(1.3, 1.3, 1.3) }));
    add(plq, 0, DOOR_H + 0.2, 0.36);
    this.static.add(frame);

    // the doors themselves (dynamic)
    const dyn = new THREE.Group();
    dyn.position.copy(frame.position);
    dyn.rotation.y = rot;
    dyn.userData.dynamic = true;
    const leaves = [];
    for (const sx of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(sx * 3.0, 0, -0.65);
      const leaf = new THREE.Group();
      leaf.position.x = -sx * 1.5;
      leaf.add(at(new THREE.Mesh(new THREE.BoxGeometry(2.96, DOOR_H - 0.04, 0.1), M.lacquer), 0, (DOOR_H - 0.04) / 2, 0));
      for (const zz of [0.056, -0.056]) {
        const pane = at(new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.6), M.paneGlow), 0, 2.0, zz);
        pane.rotation.y = zz > 0 ? 0 : Math.PI;
        leaf.add(pane);
        for (const [w2, h2, x2, y2] of [[2.36, 0.08, 0, 3.34], [2.36, 0.08, 0, 0.66], [0.08, 2.76, -1.14, 2.0], [0.08, 2.76, 1.14, 2.0], [2.36, 0.06, 0, 0.3]]) {
          leaf.add(at(new THREE.Mesh(new THREE.BoxGeometry(w2, h2, 0.02), M.gold), x2, y2, zz));
        }
      }
      // brass pull handle near the meeting edge
      leaf.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 8), M.brass), sx * 1.25, 1.5, 0.1));
      hinge.add(leaf);
      dyn.add(hinge);
      leaves.push({ hinge, sx });
    }
    // velvet rope across the front, with the price hanging off it
    const rope = new THREE.Group();
    const posts = [];
    for (const sx of [-1.7, 1.7]) {
      posts.push(new THREE.Vector3(sx, 0, 1.0));
      rope.add(at(new THREE.Mesh(lathe([[0.16, 0], [0.16, 0.03], [0.04, 0.08], [0.035, 0.95], [0.07, 1.0], [0.0, 1.06]], 14), M.gold), sx, 0, 1.0));
    }
    const curve = new THREE.QuadraticBezierCurve3(posts[0].clone().setY(0.92), new THREE.Vector3(0, 0.55, 1.0), posts[1].clone().setY(0.92));
    rope.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.035, 6), M.rope));
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.34), new THREE.MeshBasicMaterial({ map: CT.plaque(`${z.price} CHIPS`, 'pay the doorman', 512, 136), color: new THREE.Color(1.25, 1.25, 1.25), side: THREE.DoubleSide }));
    tag.position.set(0, 0.46, 1.0);
    rope.add(tag);
    dyn.add(rope);
    this.group.add(dyn);
    const zi = ZONES.indexOf(z);
    const barrier = this._box(z.gap[0], z.gap[1], z.gap[2], z.gap[3], 8, { door: zi });
    // where to stand to pay: just in front of the rope, on the grand floor
    const front = new THREE.Vector3(0, 0, 1.6).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).add(frame.position);
    this.doors.push({ zone: zi, def: z, group: dyn, leaves, rope, barrier, open: false, t: -1, front, frame });
  }

  // ------------------------------ the High Limit Room ------------------------
  _highLimit() {
    const M = this.M;
    const [x0, z0, x1, z1] = [-15, -60, 15, -36.8], h = 5.6;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
    const floor = this._add(new THREE.Mesh(plane(w, d, 3, 3), M.blackMarble), cx, 0, cz);
    floor.rotation.x = -Math.PI / 2;
    this._add(new THREE.Mesh(new THREE.PlaneGeometry(15, 11), M.rug), 0, 0.012, -47.5).rotation.x = -Math.PI / 2;
    this._add(new THREE.Mesh(plane(w, d, 3, 3), M.ceilingU), cx, h, cz).rotation.x = Math.PI / 2;
    this._wallRun(x0, z0, x1, z0, h, 'velvet');
    this._wallRun(x1, z0, x1, z1, h, 'velvet');
    this._wallRun(x1, z1, x0, z1, h, 'velvet', [[12, 18]]);
    this._wallRun(x0, z1, x0, z0, h, 'velvet');
    this._box(-16, -61, -14.8, -36.8); this._box(14.8, -61, 16, -36.8); this._box(-16, -61, 16, -59.8);
    this._chandelier(0, h + 0.3, -48, 0.72);
    // two baccarat tables
    this._addTable(-7, -45);
    this._addTable(7, -45);
    // the champagne tower on its own round table
    this._add(new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.06, 40), M.marbleW), 0, 0.95, -53.5);
    this._add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.34, 0.92, 16), M.gold), 0, 0.46, -53.5);
    const coupe = lathe([[0, 0], [0.05, 0], [0.006, 0.02], [0.006, 0.08], [0.075, 0.12], [0.08, 0.13], [0, 0.13]], 14);
    const fizzMat = new THREE.MeshStandardMaterial({ color: 0x3a2a08, emissive: 0xffd070, emissiveIntensity: 1.3, roughness: 0.1, metalness: 0.2 });
    for (let lv = 0; lv < 4; lv++) {
      const n = 4 - lv;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        this._add(new THREE.Mesh(coupe, fizzMat), (i - (n - 1) / 2) * 0.17, 0.98 + lv * 0.135, -53.5 + (j - (n - 1) / 2) * 0.17);
      }
    }
    this.colliders.push({ x: 0, z: -53.5, r: 1.2, h: 1.6 });
    // leather banquettes along the side walls
    for (const sx of [-1, 1]) {
      for (const bz of [-42, -51]) {
        const x = sx * 13.4;
        const sofa = new THREE.Group();
        sofa.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.42, 3.6), M.redLeather), 0, 0.21, 0));
        sofa.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.9, 3.6), M.redLeather), sx * 0.4, 0.62, 0));
        for (const az of [-1.9, 1.9]) sofa.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.62, 0.22), M.redLeather), 0, 0.31, az));
        sofa.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.05, 3.64), M.gold), 0, 0.02, 0));
        sofa.position.set(x, 0, bz);
        this.static.add(sofa);
        this._box(x - 0.6, bz - 2.0, x + 0.6, bz + 2.0, 1.1);
        // a low marble side table with a lamp
        this._add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.5, 20), M.marble), sx * 12.6, 0.25, bz + 2.9);
        this._add(new THREE.Mesh(lathe([[0.18, 0], [0.12, 0.3], [0.2, 0.32], [0.24, 0.62], [0.06, 0.64]], 16), M.goldGlow), sx * 12.6, 0.5, bz + 2.9);
        this.colliders.push({ x: sx * 12.6, z: bz + 2.9, r: 0.45, h: 1.1 });
      }
    }
    this._sign('HIGH LIMIT', '#ff2d55', 0, 5.05, -59.8, 0, 0.58);
    // ALL IN — the house's own forge, dead center against the back wall
    const ai = allInMachine();
    ai.position.set(0, 0, -58.95);
    this.group.add(ai);
    this._box(-1.65, -59.8, 1.75, -58.25, 4);
    this.allIn = { group: ai, ...ai.userData, pos: new THREE.Vector3(0, 0, -58.95), front: new THREE.Vector3(0, 0, -57.3), facing: new THREE.Vector3(0, 0, 1) };
    // the only window in the house: floor-to-ceiling glass over the Strip at night
    const sx = 14.9;
    const glass = this._add(new THREE.Mesh(new THREE.PlaneGeometry(21, 3.5), new THREE.MeshBasicMaterial({ map: stripSkyline(), color: new THREE.Color(1.25, 1.25, 1.25) })), sx, 2.95, -48.4);
    glass.rotation.y = -Math.PI / 2;
    glass.userData.dynamic = true;
    for (let z = -58.9; z <= -37.8; z += 3.0) this._add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.6, 0.1), M.gold), sx - 0.04, 2.95, z);
    for (const y of [1.18, 4.72]) this._add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 21.2), M.gold), sx - 0.05, y, -48.4);
    this._add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 21.2), M.marble), sx - 0.2, 1.12, -48.4);
    this.stripGlow = new THREE.Mesh(new THREE.PlaneGeometry(21, 3.5), new THREE.MeshBasicMaterial({ color: 0x5a2a6a, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.stripGlow.position.set(sx - 0.1, 2.95, -48.4);
    this.stripGlow.rotation.y = -Math.PI / 2;
    this.group.add(this.stripGlow);
  }

  // --------------------------- the Little Chapel of the Dead ------------------
  _chapel() {
    const M = this.M;
    const [x0, z0, x1, z1] = [-60, -13, -36.8, 13], h = 6.8;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
    this._add(new THREE.Mesh(plane(w, d, 4, 4), M.planks), cx, 0, cz).rotation.x = -Math.PI / 2;
    const runner = this._add(new THREE.Mesh(uvScale(new THREE.PlaneGeometry(19, 2.2), 3, 1), M.velvetU), -46.3, 0.012, 0);
    runner.rotation.x = -Math.PI / 2;
    this._add(new THREE.Mesh(plane(w, d, 3, 3), M.darkWood), cx, h, cz).rotation.x = Math.PI / 2;
    for (let bx = x0 + 2; bx < x1; bx += 3.2) this._add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, d), M.darkWood), bx, h - 0.25, cz);
    this._wallRun(x0, z0, x1, z0, h, 'chapel');
    this._wallRun(x1, z0, x1, z1, h, 'chapel', [[10, 16]]);
    this._wallRun(x1, z1, x0, z1, h, 'chapel');
    this._wallRun(x0, z1, x0, z0, h, 'chapel');
    this._box(-61, -14, -36.8, -12.8); this._box(-61, 12.8, -36.8, 14); this._box(-61, -14, -59.8, 14);
    // stained glass on both long walls + a tall one behind the altar
    const glassMat = (s) => new THREE.MeshBasicMaterial({ map: CT.stainedGlass(s), color: new THREE.Color(1.7, 1.7, 1.7) });
    const gm = [glassMat(0), glassMat(1), glassMat(2)];
    [-47, -53].forEach((x, i) => {
      this._add(new THREE.Mesh(new THREE.PlaneGeometry(1.7, 3.4), gm[i % 3]), x, 4.0, -12.96);
      this._add(new THREE.Mesh(new THREE.PlaneGeometry(1.7, 3.4), gm[(i + 1) % 3]), x, 4.0, 12.96).rotation.y = Math.PI;
    });
    this._add(new THREE.Mesh(new THREE.PlaneGeometry(2.0, 3.6), gm[2]), -59.95, 2.9, 0).rotation.y = Math.PI / 2;
    // pews: two columns, facing the altar (west)
    for (let row = 0; row < 4; row++) {
      const x = -42.5 - row * 3.1;
      for (const [za, zb] of [[-9, -1.6], [1.6, 9]]) {
        const len = zb - za, zc = (za + zb) / 2;
        this._add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, len), M.wood), x, 0.46, zc);
        this._add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.62, len), M.wood), x + 0.3, 0.8, zc);
        this._add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, len), M.darkWood), x + 0.3, 1.13, zc);
        for (const ez of [za, zb]) this._add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.08), M.darkWood), x + 0.05, 0.5, ez);
        this._box(x - 0.35, za, x + 0.4, zb, 1.1);
      }
    }
    // the altar: a step, a coffin on trestles, candelabras, an arch of dead roses
    this._add(new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.36, 10), M.darkWood), -57.4, 0.18, 0);
    this._add(new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.04, 10.1), M.gold), -57.4, 0.37, 0);
    this._box(-59.8, -5, -55, 5, 1.2);
    const coffinShape = new THREE.Shape();
    coffinShape.moveTo(0, -1.1); coffinShape.lineTo(0.3, -1.1); coffinShape.lineTo(0.42, 0.55); coffinShape.lineTo(0.28, 1.1);
    coffinShape.lineTo(-0.28, 1.1); coffinShape.lineTo(-0.42, 0.55); coffinShape.lineTo(-0.3, -1.1); coffinShape.closePath();
    const coffinGeo = new THREE.ExtrudeGeometry(coffinShape, { depth: 0.5, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
    coffinGeo.rotateX(-Math.PI / 2);
    const coffin = this._add(new THREE.Mesh(coffinGeo, M.lacquer), -57.6, 0.95, 0);
    coffin.rotation.y = Math.PI / 2;
    for (const tz of [-0.8, 0.8]) this._add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.1), M.darkWood), -57.6, 0.65, tz);
    for (const tz of [-0.6, 0, 0.6]) for (const sx of [-0.45, 0.45]) this._add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.2), M.brass), -57.6 + sx, 1.2, tz);
    for (let i = 0; i < 9; i++) this._add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), M.rose), -57.6 + (Math.random() - 0.5) * 0.3, 1.5, -0.2 + (Math.random() - 0.5) * 0.4);
    for (const tz of [-3.6, 3.6]) {
      this._add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.2, 1.7, 10), M.gold), -56.4, 1.2, tz);
      for (let k = -2; k <= 2; k++) {
        this._add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.28, 8), M.candle), -56.4, 2.2 + (k === 0 ? 0.12 : 0), tz + k * 0.2);
        this._add(new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), M.flame), -56.4, 2.4 + (k === 0 ? 0.12 : 0), tz + k * 0.2);
      }
    }
    for (let i = 0; i <= 26; i++) {                  // rose arch over the coffin
      const a = (i / 26) * Math.PI;
      const y = 0.4 + Math.sin(a) * 3.4, zz = Math.cos(a) * 2.8;
      this._add(new THREE.Mesh(new THREE.SphereGeometry(0.16 + (i % 3) * 0.03, 8, 6), i % 4 ? M.rose : M.darkWood), -58.9, y, zz);
    }
    this._sign('LITTLE CHAPEL OF THE DEAD', '#ff7ad0', -59.8, 5.6, 0, Math.PI / 2, 0.9);
    this._sign('♥ I DO. FOREVER. ♥', '#c27aff', -36.95, 5.4, 0, -Math.PI / 2, 0.7);
  }

  // ------------------------------- the Counting Room --------------------------
  _counting() {
    const M = this.M;
    const [x0, z0, x1, z1] = [36.8, -13, 58, 13], h = 4.6;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
    this._add(new THREE.Mesh(plane(w, d, 4, 4), M.concrete), cx, 0, cz).rotation.x = -Math.PI / 2;
    this._add(new THREE.Mesh(plane(w, d, 2, 2), M.steel), cx, h, cz).rotation.x = Math.PI / 2;
    this._wallRun(x0, z0, x1, z0, h, 'steel');
    this._wallRun(x1, z0, x1, z1, h, 'steel');
    this._wallRun(x1, z1, x0, z1, h, 'steel');
    this._wallRun(x0, z1, x0, z0, h, 'steel', [[10, 16]]);
    this._box(36.8, -14, 59, -12.8); this._box(36.8, 12.8, 59, 14); this._box(57.8, -14, 59, 14);
    // fluorescent tubes in rows
    for (let fx = 40; fx <= 56; fx += 4) for (const fz of [-7, 0, 7]) {
      this._add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 0.3), M.steelPlain), fx, h - 0.06, fz);
      this._add(new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.06, 0.12), M.fluoro), fx, h - 0.13, fz);
    }
    // the vault door, standing a little open with gold light behind it
    const vault = new THREE.Group();
    vault.position.set(57.75, 0, 0);
    vault.rotation.y = -Math.PI / 2;                // front faces -x (into the room)
    const frameDisc = at(new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.7, 0.3, 64), M.steelPlain), 0, 2.2, -0.1);
    frameDisc.rotation.x = Math.PI / 2;
    vault.add(frameDisc);
    vault.add(at(new THREE.Mesh(new THREE.CircleGeometry(2.3, 48), M.goldGlow), 0, 2.2, 0.06));
    const glowRing = new THREE.Mesh(new THREE.TorusGeometry(2.45, 0.07, 10, 64), M.goldGlow);
    glowRing.position.set(0, 2.2, 0.12);
    vault.add(glowRing);
    // gold bars stacked inside, lit by their own glow
    for (let i = 0; i < 9; i++) {
      vault.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.25), M.goldGlow), -0.9 + (i % 3) * 0.6, 0.6 + Math.floor(i / 3) * 0.17, -0.05));
    }
    const doorDisc = new THREE.Group();
    doorDisc.position.set(-2.3, 2.2, 0.1);          // hinge on the left edge
    doorDisc.rotation.y = -1.0;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 0.55, 64),
      [M.steelPlain, new THREE.MeshStandardMaterial({ map: CT.vaultFace(), metalness: 0.85, roughness: 0.3 }), M.steelPlain]);
    disc.rotation.x = Math.PI / 2;
    disc.position.set(2.3, 0, 0.28);
    disc.userData.dynamic = true;
    doorDisc.add(disc);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 8, 32), M.chrome);
    wheel.position.set(2.3, 0, 0.62);
    doorDisc.add(wheel);
    for (let i = 0; i < 3; i++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.3, 8), M.chrome);
      spoke.position.set(2.3, 0, 0.62);
      spoke.rotation.z = (i / 3) * Math.PI;
      doorDisc.add(spoke);
    }
    vault.add(doorDisc);
    for (const y of [0.9, 3.5]) vault.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.5), M.steelPlain), -2.5, y, 0.3));
    this.static.add(vault);
    this._box(55.2, -3.2, 57.8, 3.2, 5);
    this._box(53.5, -2.7, 55.2, 0.2, 5);            // the swung-open door
    this._add(new THREE.Mesh(uvScale(new THREE.PlaneGeometry(1.4, 7), 1, 7 / 1.2), M.hazard), 54.2, 0.011, 0).rotation.x = -Math.PI / 2;
    // the cash cage in the north-east corner
    const cage = [[49.5, -12.8, 49.5, -8.2], [49.5, -8.2, 57.8, -8.2]];
    for (const [ax, az, bx, bz] of cage) {
      const len = Math.hypot(bx - ax, bz - az);
      const panel = this._add(new THREE.Mesh(uvScale(new THREE.PlaneGeometry(len, 3.2), len / 0.5, 3.2 / 0.5), M.chain), (ax + bx) / 2, 1.6, (az + bz) / 2);
      panel.rotation.y = ax === bx ? Math.PI / 2 : 0;
      for (let t = 0; t <= 1; t += 0.25) this._add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.2, 8), M.steelPlain), ax + (bx - ax) * t, 1.6, az + (bz - az) * t);
    }
    this._box(49.3, -12.8, 57.8, -8.0, 3.2);
    for (let i = 0; i < 6; i++) {                     // chip crates behind the wire
      const bx = 51 + (i % 3) * 2.1, bz = -11.8 + Math.floor(i / 3) * 1.8;
      this._add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9 + (i % 2) * 0.5, 1.2), M.wood), bx, (0.9 + (i % 2) * 0.5) / 2, bz);
    }
    // counting tables with money counters and bricks of cash
    for (const tz of [-4.2, 4.2]) {
      this._add(new THREE.Mesh(new THREE.BoxGeometry(6, 0.08, 1.4), M.steelPlain), 45, 0.9, tz);
      for (const lx of [42.2, 47.8]) for (const lz of [-0.6, 0.6]) this._add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.06), M.steelPlain), lx, 0.45, tz + lz);
      for (const mx of [43, 46.5]) {
        this._add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.4), M.cabinet), mx, 1.09, tz);
        this._add(new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.1), M.screen), mx, 1.2, tz + (tz < 0 ? 0.201 : -0.201)).rotation.y = tz < 0 ? 0 : Math.PI;
      }
      for (let k = 0; k < 7; k++) this._add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.16), M.cash), 44.2 + k * 0.4, 0.99 + (k % 2) * 0.1, tz + (k % 3 - 1) * 0.3);
      this._box(41.9, tz - 0.8, 48.1, tz + 0.8, 1.0);
    }
    // pallets of shrink-wrapped chips along the south wall
    for (const px of [44, 50, 54]) {
      this._add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.14, 1.2), M.wood), px, 0.07, 11.6);
      this._add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 1.1), M.cabinet), px, 0.74, 11.6);
      this._box(px - 0.85, 10.9, px + 0.85, 12.8, 1.4);
    }
    this._sign('COUNT ROOM', '#27e6ff', 36.95, 3.6, 8, Math.PI / 2, 0.55);
    // THE CAGE: the repairs counter in front of the cash cage, where LADY LUCK gets built
    const wb = workbench();
    wb.position.set(53.5, 0, -7.55);
    this.group.add(wb);
    this._box(52.3, -8.0, 54.7, -7.1, 1.2);
    this.bench = { group: wb, ...wb.userData, pos: new THREE.Vector3(53.5, 0, -7.55), front: new THREE.Vector3(53.5, 0, -6.2), facing: new THREE.Vector3(0, 0, 1) };
  }

  // ----------------------------- cocktail automats ----------------------------
  _perkMachines() {
    for (const [key, [x, z, ry]] of Object.entries(PERK_SPOTS)) {
      const def = DRINKS[key];
      const m = perkMachine(def);
      m.position.set(x, 0, z);
      m.rotation.y = ry;
      m.traverse((o) => { o.userData.dynamic = true; });
      this.group.add(m);
      // a pool of the drink's color on the floor in front of it
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({
        map: this._blob(), color: new THREE.Color(def.color), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(x + Math.sin(ry) * 0.9, 0.02, z + Math.cos(ry) * 0.9);
      this.group.add(glow);
      this.colliders.push({ x, z, r: 0.8, h: 2.8 });
      const facing = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
      this.perkMachines.push({ key, def, group: m, pos: new THREE.Vector3(x, 0, z), facing, glow, zone: this.zoneAtRaw(x, z) });
    }
  }

  _blob() {
    return this._blobTex ||= toTexture(softBlobCanvas(128, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)'), { srgb: false });
  }

  // -------------------------------- THE BIG SIX -------------------------------
  _bigSix() {
    const segs = [];
    const pool = Object.entries(GUNS);
    // 16 wedges: every gun at least once, the house specials twice, one skull
    const order = ['whale', 'smg', 'derringer', 'magnum', 'tommy', 'shotgun', 'jubilee', 'shoe',
      'SKULL', 'rifle', 'magnum', 'pistol', 'whale', 'tommy', 'jubilee', 'shoe'];
    for (const k of order) {
      if (k === 'SKULL') { segs.push({ skull: true, label: 'THE HOUSE', icon: '☠', gun: null }); continue; }
      const gdef = GUNS[k] || pool[0][1];
      segs.push({ label: gdef.name.replace(/^THE /, ''), icon: gdef.icon, gun: k, gold: gdef.cat === 'special' });
    }
    const w = bigSixWheel(segs);
    w.group.position.set(0, 0, 34.75);
    w.group.rotation.y = Math.PI;
    w.group.traverse((o) => { if (o !== w.group) o.userData.dynamic = true; });
    this.group.add(w.group);
    this._box(-1.8, 33.3, 1.8, 35.3, 5);
    w.group.updateMatrixWorld(true);
    this.bigSix = {
      ...w, segs,
      pos: new THREE.Vector3(0, 0, 34.75),
      prizeWorld: w.group.localToWorld(w.prize.clone()),
      front: new THREE.Vector3(0, 0, 32.6),
      facing: new THREE.Vector3(0, 0, -1),
    };
  }

  // -------------------------- (existing grand floor) --------------------------
  _chandelier(x, top, z, s = 1) {
    const g = new THREE.Group();
    // (no ink on the chandeliers: their fine brass and crystal inked to a black tangle)
    const M = { gold: noInk(this.M.gold), marbleW: noInk(this.M.marbleW), bulb: noInk(this.M.bulb), crystal: noInk(this.M.crystal) };
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6), M.gold), 0, 1.4, 0));
    g.add(new THREE.Mesh(lathe([[0, -0.6], [0.2, -0.5], [0.28, -0.2], [0.12, 0.2], [0.06, 0.8]], 16), M.gold));
    const crystalGeo = new THREE.OctahedronGeometry(0.06);
    for (const [r, y] of [[1.6, 0], [1.15, 0.45], [0.65, 0.85]]) {
      const torus = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 8, 40), M.gold);
      torus.rotation.x = Math.PI / 2; torus.position.y = y;
      g.add(torus);
      const n = Math.round(r * 7);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const cand = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 6), M.marbleW);
        cand.position.set(Math.cos(a) * r, y + 0.1, Math.sin(a) * r);
        g.add(cand);
        const flame = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), M.bulb);
        flame.position.set(Math.cos(a) * r, y + 0.22, Math.sin(a) * r);
        g.add(flame);
        for (let k = 0; k < 2; k++) {
          const cr = new THREE.Mesh(crystalGeo, M.crystal);
          cr.scale.set(0.7, 1.6, 0.7);
          cr.position.set(Math.cos(a + 0.2) * r, y - 0.15 - k * 0.14, Math.sin(a + 0.2) * r);
          g.add(cr);
        }
      }
    }
    g.scale.setScalar(s);
    g.position.set(x, top - 1.9 * s, z);
    this.static.add(g);
  }

  _sign(text, color, x, y, z, ry = 0, scale = 1) {
    // long signs get a wider canvas (and a wider plane) so nothing is clipped
    const n = text.length;
    const cw = n > 11 ? 1024 : 512;
    const font = n > 20 ? 'bold 54px Georgia, serif' : n > 11 ? 'bold 66px Georgia, serif' : undefined;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(8 * scale * (cw / 512), 2 * scale),
      new THREE.MeshBasicMaterial({ map: CT.neonSign(text, color, cw, 128, font),
        transparent: true, depthWrite: false, color: new THREE.Color(2.4, 2.4, 2.4) }));
    m.position.set(x, y, z); m.rotation.y = ry;
    m.renderOrder = 2;
    this.group.add(m);
    this.flickerNeons.push(m);
    return m;
  }

  _signs() {
    const w = FACE - 0.12;              // just proud of the wallpaper
    this._sign('HOUSE OF THE UNDEAD', '#ff2d78', 0, 5.55, -w, 0, 1.05);
    this._sign('★ SLOTS ★', '#27e6ff', -20, 4.3, -w, 0, 1);
    this._sign('JACKPOT', '#ffd24a', 20, 4.3, -w, 0, 1);
    this._sign('TABLES', '#2dff7a', -w, 4.3, -13, Math.PI / 2, 1.1);
    this._sign('LIVE TONIGHT', '#ff7ad0', -w, 4.3, 16, Math.PI / 2, 0.9);
    this._sign('21', '#ff4a4a', w, 4.3, -12, -Math.PI / 2, 0.9);
    this._sign('★ LUCKY ★', '#c27aff', w, 4.3, 12, -Math.PI / 2, 1);
    this._sign('THE BIG SIX', '#ffb04a', 0, 5.75, w, Math.PI, 1.05);
    this._sign('BAR', '#ffb04a', -24, 4.3, w, Math.PI, 0.8);
    // the rest of the Strip's shouting
    this._sign('LOOSE SLOTS', '#ff2d78', -30, 4.4, -w, 0, 0.8);
    this._sign('99¢ SHRIMP COCKTAIL', '#ffd24a', -w, 4.5, -27, Math.PI / 2, 0.6);
    this._sign('OPEN 24 HOURS', '#2dff7a', w, 4.5, -26, -Math.PI / 2, 0.6);
    this._sign('LIVE ENTERTAINMENT', '#ff7ad0', w, 4.6, 26.5, -Math.PI / 2, 0.55);
    this._sign('FREE DRINKS', '#27e6ff', -14, 4.4, w, Math.PI, 0.7);
    this._sign('CRAPS', '#ffb04a', 0, 5.2, -16, 0, 0.6).userData.hanging = true;
    // a keno board on the north wall, drawing live
    this.keno = kenoBoard();
    this.keno.mesh.position.set(29.6, 3.25, -w + 0.02);
    this.group.add(this.keno.mesh);
  }

  // ------------------------------ slot banks --------------------------------
  _slotBanks() {
    const M = this.M;
    const bankPositions = [[-18, -10], [18, -10], [-18, 14], [18, 14], [-8, -22], [8, -22]];
    this.bankPositions = bankPositions;
    const bulbPositions = [];
    const bulbColors = [];
    const faceGeo = new THREE.PlaneGeometry(1.0, 2.0);
    const bodyGeo = new THREE.BoxGeometry(1.14, 2.0, 0.92);
    const themeMats = new Map();
    const matsFor = (theme) => {
      if (!themeMats.has(theme)) {
        const art = CT.slotFace(theme);
        const col = new THREE.Color(art.color);
        themeMats.set(theme, {
          col,
          side: new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.25), metalness: 0.7, roughness: 0.28 }),
          face: new THREE.MeshStandardMaterial({ map: art.map, emissiveMap: art.glow, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.35, metalness: 0.2 }),
          topper: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: col, emissiveIntensity: 2.2 }),
        });
      }
      return themeMats.get(theme);
    };
    const knobMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2a2a, emissiveIntensity: 1.5 });
    bankPositions.forEach(([bx, bz], bi) => {
      const bank = new THREE.Group();
      // face the middle of the room
      bank.rotation.y = Math.atan2(-bx, -bz);
      for (let i = -1; i <= 1; i++) {
        const theme = (bi * 3 + i + 1) % CT.SLOT_THEME_COUNT;
        const TM = matsFor(theme);
        const m = new THREE.Group();
        m.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.5, 1.0), M.base), 0, 0.25, 0));
        m.add(at(new THREE.Mesh(bodyGeo, TM.side), 0, 1.5, 0));
        const face = new THREE.Mesh(faceGeo, TM.face);
        face.position.set(0, 1.5, 0.465);
        m.add(face);
        for (const sx of [-0.56, 0.56]) m.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.02, 0.05), M.chrome), sx, 1.5, 0.47));
        const deck = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.34), M.cabinet);
        deck.position.set(0, 0.88, 0.6); deck.rotation.x = 0.28;
        m.add(deck);
        const topper = new THREE.Mesh(lathe([[0.0, 0], [0.5, 0], [0.46, 0.14], [0.2, 0.26], [0, 0.28]], 24), TM.topper);
        topper.scale.set(1, 1, 0.8);
        topper.position.y = 2.5;
        m.add(topper);
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8), M.chrome);
        arm.position.set(0.66, 1.55, 0.1); arm.rotation.z = -0.35;
        m.add(arm);
        m.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), knobMat), 0.78, 1.87, 0.1));
        // stool
        m.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.02, 20), M.chrome), 0, 0.01, 1.05));
        m.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.66, 8), M.chrome), 0, 0.34, 1.05));
        m.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.1, 20), M.redLeather), 0, 0.7, 1.05));
        m.position.x = i * 1.3;
        bank.add(m);
      }
      // marquee bulb strip (instanced, animated)
      bank.position.set(bx, 0, bz);
      bank.updateMatrixWorld(true);
      const glow = new THREE.Color(CT.slotFace(bi * 3).color);
      for (let k = 0; k <= 12; k++) {
        const p = new THREE.Vector3(-1.95 + k * 0.325, 2.88, 0.2).applyMatrix4(bank.matrixWorld);
        bulbPositions.push(p);
        bulbColors.push({ base: glow.clone(), phase: k * 0.6 + bi });
      }
      this.static.add(bank);
      this.colliders.push({ x: bx, z: bz, r: 3.1, h: 2.6 });
    });
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff }), bulbPositions.length);
    const mtx = new THREE.Matrix4();
    bulbPositions.forEach((p, i) => { mtx.makeTranslation(p.x, p.y, p.z); bulbs.setMatrixAt(i, mtx); bulbs.setColorAt(i, bulbColors[i].base); });
    bulbs.userData.dynamic = true;
    this.group.add(bulbs);
    this.marquee = { mesh: bulbs, bulbs: bulbColors, tmp: new THREE.Color() };
  }

  // ------------------------------- card tables -------------------------------
  _tableKit() {
    if (this._tk) return this._tk;
    const chipCols = ['#b3122e', '#1a3a9a', '#141414', '#1a7a3a', '#c9a227'];
    const stackMats = chipCols.map((c, i) => {
      const edge = document.createElement('canvas');
      edge.width = 64; edge.height = 16;
      const e = edge.getContext('2d');
      e.fillStyle = c; e.fillRect(0, 0, 64, 16);
      e.fillStyle = '#f4efe2'; for (let k = 0; k < 4; k++) e.fillRect(k * 16 + 4, 2, 6, 12);
      e.fillStyle = 'rgba(0,0,0,0.6)'; e.fillRect(0, 14, 64, 2);
      const t = toTexture(edge, { repeat: [3, 1] });
      return { edge: t, face: new THREE.MeshStandardMaterial({ map: chipFaceTexture(c), roughness: 0.4 }), i };
    });
    const poolMat = new THREE.MeshBasicMaterial({
      map: toTexture(softBlobCanvas(128, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)'), { srgb: false }),
      color: 0xffe8b0, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false });
    const shade = new THREE.MeshStandardMaterial({ color: 0x0d4a2a, metalness: 0.3, roughness: 0.3, side: THREE.DoubleSide, emissive: 0x0a3a1a, emissiveIntensity: 0.5 });
    this._tk = { stackMats, poolMat, shade, stackGeo: (n) => new THREE.CylinderGeometry(0.1, 0.1, 0.03 * n, 20) };
    return this._tk;
  }

  _addTable(x, z) {
    const M = this.M, K = this._tableKit();
    const t = new THREE.Group();
    t.add(at(new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.06, 48), [M.darkWood, M.felt, M.darkWood]), 0, 0.95, 0));
    const rail = new THREE.Mesh(new THREE.TorusGeometry(1.52, 0.1, 10, 56), M.leather);
    rail.rotation.x = Math.PI / 2; rail.position.y = 0.98;
    t.add(rail);
    t.add(at(new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.3, 0.22, 48), M.wood), 0, 0.82, 0));
    t.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.72, 16), M.darkWood), 0, 0.36, 0));
    t.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.06, 24), M.brass), 0, 0.03, 0));
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26 + x;
      const n = 3 + ((i * 7 + Math.abs(Math.round(x))) % 6);
      const sm = K.stackMats[(i + Math.abs(Math.round(z))) % K.stackMats.length];
      const edge = new THREE.MeshStandardMaterial({ map: sm.edge.clone(), roughness: 0.45 });
      edge.map.repeat.set(3, n); edge.map.needsUpdate = true;
      const st = new THREE.Mesh(K.stackGeo(n), [edge, sm.face, sm.face]);
      st.position.set(Math.cos(a) * 0.95, 0.98 + 0.015 * n, Math.sin(a) * 0.95);
      st.userData.dynamic = true;   // multi-material — keep as its own mesh
      t.add(st);
    }
    [['A', '♠'], ['K', '♥'], ['10', '♦'], ['J', '♣']].forEach(([r, s], i) => {
      const cd = cardMesh(r, s, 0.12, 0.17);
      cd.rotation.set(-Math.PI / 2, 0, i * 0.5 + x);
      cd.position.set(Math.cos(i * 1.6 + 0.3) * 0.5, 0.985, Math.sin(i * 1.6 + 0.3) * 0.5);
      t.add(cd);
    });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.6;
      const sx = Math.cos(a) * 2.05, sz = Math.sin(a) * 2.05;
      t.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 8), M.chrome), sx, 0.35, sz));
      t.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.2, 0.1, 18), M.redLeather), sx, 0.72, sz));
    }
    // pendant lamp
    t.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 3.2, 4), M.gold), 0, 5.3, 0));
    t.add(at(new THREE.Mesh(lathe([[0.05, 0.4], [0.18, 0.32], [0.5, 0.0], [0.48, -0.02]], 20), K.shade), 0, 3.35, 0));
    t.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), M.bulb), 0, 3.36, 0));
    t.position.set(x, 0, z);
    this.static.add(t);
    // fake pool of lamplight on the felt
    const pool = new THREE.Mesh(new THREE.CircleGeometry(1.4, 32), K.poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(x, 0.99, z);
    this.group.add(pool);
    this.colliders.push({ x, z, r: 1.9, h: 1.05 });
  }

  _tables() {
    for (const [x, z] of [[-9, 2], [9, 2], [-24, -4], [24, -4]]) this._addTable(x, z);
    this._craps(0, -16);
  }

  /** the craps table — roll the bones for THE LOADED DICE */
  _craps(x, z) {
    const c = crapsTable();
    c.group.position.set(x, 0, z);
    c.group.traverse((o) => { if (o.isMesh && o.userData.dynamic === undefined) o.userData.dynamic = false; });
    this.group.add(c.group);
    this._box(x - c.half[0] - 0.05, z - c.half[1] - 0.05, x + c.half[0] + 0.05, z + c.half[1] + 0.05, 1.1);
    // a pendant lamp over each end
    for (const dx of [-1.2, 1.2]) {
      this._add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 3.2, 4), this.M.gold), x + dx, 5.3, z);
      this._add(new THREE.Mesh(lathe([[0.05, 0.4], [0.18, 0.32], [0.5, 0.0], [0.48, -0.02]], 20), this._tableKit().shade), x + dx, 3.35, z);
      this._add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), this.M.bulb), x + dx, 3.36, z);
    }
    this.craps = { ...c, pos: new THREE.Vector3(x, 0, z) };
  }

  // ------------------------------ roulette dais ------------------------------
  _dais() {
    const M = this.M;
    this._add(new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.9, 48), M.marble), 0, 0.45, -4);
    this._add(new THREE.Mesh(new THREE.TorusGeometry(2.45, 0.05, 8, 64), M.gold), 0, 0.9, -4).rotation.x = Math.PI / 2;
    this._add(new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.05, 8, 64), M.gold), 0, 0.02, -4).rotation.x = Math.PI / 2;
    // the wheel spins — keep it dynamic
    const wheel = new THREE.Group();
    wheel.userData.dynamic = true;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.2, 0.12, 64),
      [M.wood, new THREE.MeshStandardMaterial({ map: CT.rouletteTop(), roughness: 0.35, metalness: 0.15 }), M.wood]);
    wheel.add(top);
    wheel.add(at(new THREE.Mesh(lathe([[0.3, 0], [0.18, 0.1], [0.06, 0.4], [0.1, 0.46], [0, 0.5]], 20), M.gold), 0, 0.06, 0));
    for (let k = 0; k < 4; k++) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 6), M.gold);
      arm.rotation.z = Math.PI / 2; arm.rotation.y = k * Math.PI / 4;
      arm.position.y = 0.42;
      wheel.add(arm);
    }
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.1 }));
    this.ball.position.set(1.7, 0.1, 0);
    wheel.add(this.ball);
    wheel.position.set(0, 0.97, -4);
    this.group.add(wheel);
    this.wheel = wheel;
    this.colliders.push({ x: 0, z: -4, r: 2.8, h: 1.2 });
    // velvet rope stanchions around it
    const posts = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const p = new THREE.Vector3(Math.cos(a) * 3.3, 0, -4 + Math.sin(a) * 3.3);
      this._add(new THREE.Mesh(lathe([[0.16, 0], [0.16, 0.03], [0.04, 0.08], [0.035, 0.95], [0.07, 1.0], [0.0, 1.06]], 14), M.gold), p.x, 0, p.z);
      posts.push(p);
    }
    for (let i = 0; i < 8; i++) {
      if (i === 1 || i === 5) continue;          // openings
      const a = posts[i], b = posts[(i + 1) % 8];
      const mid = a.clone().lerp(b, 0.5).setY(0.6);
      const curve = new THREE.QuadraticBezierCurve3(a.clone().setY(0.92), mid, b.clone().setY(0.92));
      this.static.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.03, 6), M.rope));
    }
  }

  // --------------------------------- the bar ---------------------------------
  _bar() {
    const M = this.M;
    const bx = -24, bz = 26;
    this._add(new THREE.Mesh(new THREE.BoxGeometry(9, 1.12, 1.3), M.wains), bx, 0.56, bz);
    this._add(new THREE.Mesh(new THREE.BoxGeometry(9.3, 0.08, 1.55), M.marble), bx, 1.16, bz);
    const rail = this._add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 9, 8), M.brass), bx, 0.18, bz - 0.78);
    rail.rotation.z = Math.PI / 2;
    // back bar: mirror, shelves, bottles
    this._add(new THREE.Mesh(new THREE.PlaneGeometry(9, 2.6), M.mirror), bx, 3.0, 30.25).rotation.y = Math.PI;
    for (const y of [2.1, 2.9, 3.7]) this._add(new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.06, 0.45), M.gold), bx, y, 30.0);
    const bottleGeo = lathe([[0, 0], [0.09, 0], [0.1, 0.02], [0.1, 0.34], [0.05, 0.44], [0.03, 0.56], [0.035, 0.6], [0, 0.6]], 12);
    const cols = [0x27e6ff, 0xff2d78, 0x2dff7a, 0xffd24a, 0xc27aff, 0xff7a4a, 0x3fd0ff, 0xb8ff4a];
    const glassMats = cols.map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.9, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.85 }));
    for (const y of [2.13, 2.93, 3.73]) {
      for (let i = 0; i < 16; i++) {
        const b = new THREE.Mesh(bottleGeo, glassMats[(i * 3 + Math.round(y * 7)) % glassMats.length]);
        b.position.set(bx - 4.2 + i * 0.56, y, 29.95);
        b.scale.setScalar(0.9 + ((i * 7) % 5) * 0.06);
        this.static.add(b);
      }
    }
    for (let i = 0; i < 6; i++) {
      const sx = bx - 3.6 + i * 1.45;
      this._add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.78, 8), M.chrome), sx, 0.39, bz - 1.35);
      this._add(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.02, 18), M.chrome), sx, 0.01, bz - 1.35);
      this._add(new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.21, 0.1, 18), M.redLeather), sx, 0.8, bz - 1.35);
    }
    for (let i = 0; i < 3; i++) {
      this._add(new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 2.2, 4), M.gold), bx - 3 + i * 3, 5.9, bz);
      this._add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa040, emissiveIntensity: 2.5 })), bx - 3 + i * 3, 4.75, bz);
    }
    this._box(bx - 4.7, bz - 0.85, bx + 4.7, bz + 0.85, 1.2);
    this._box(bx - 4.8, 29.6, bx + 4.8, 30.4, 4);
  }

  // -------------------------------- the stage --------------------------------
  _stage() {
    const M = this.M;
    const sx = 20, sz = 27;
    this._add(new THREE.Mesh(new THREE.BoxGeometry(14, 1.1, 6), M.wood), sx, 0.55, sz);
    this._add(new THREE.Mesh(new THREE.BoxGeometry(14.3, 0.12, 6.3), M.gold), sx, 1.12, sz);
    for (let i = 0; i < 6; i++) this._add(new THREE.Mesh(new THREE.BoxGeometry(13.6, 0.02, 0.02), M.darkWood), sx, 1.19, sz - 2.5 + i * 1);
    // pleated velvet curtain
    const cg = new THREE.PlaneGeometry(14, 5.8, 96, 1);
    const p = cg.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 4.5) * 0.14);
    cg.computeVertexNormals();
    const curtain = this._add(new THREE.Mesh(cg, M.velvet), sx, 4.05, 30.3);
    curtain.rotation.y = Math.PI;
    this._add(new THREE.Mesh(new THREE.BoxGeometry(14.6, 0.5, 0.4), M.gold), sx, 7.0 - 0.25, 30.2);
    // mic stand
    this._add(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.03, 16), M.chrome), sx, 1.2, 26.3);
    this._add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.5, 6), M.chrome), sx, 1.95, 26.3);
    this._add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), M.leather), sx, 2.72, 26.2);
    // stage light beams
    for (const [bx, col] of [[15, 0xff7ad0], [25, 0x27e6ff], [20, 0xffd24a]]) {
      const beam = new THREE.Mesh(new THREE.ConeGeometry(1.4, 5.6, 24, 1, true), this._beamMaterial(col, 0.12));
      beam.position.set(bx, 4.0, 26.5);
      this.group.add(beam);
      this._add(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 0.4, 12), M.leather), bx, 6.8, 26.5);
    }
    this._box(sx - 7.1, sz - 3.1, sx + 7.1, 35.3, 1.2);
    // the backdrop: the WELCOME TO FABULOUS LOST WAGES sign
    const ws = welcomeSign();
    ws.position.set(sx, 1.12, 29.5);
    ws.rotation.y = Math.PI;
    this.group.add(ws);
    this.welcome = ws.userData;
  }

  /**
   * the show must go on: a chorus line of dead showgirls kicking in time on
   * the stage (scenery — they don't come down). Built after the skins are painted.
   */
  addShow() {
    if (this.dancers) return;
    this.dancers = [];
    // a kick line of four, two either side of the WELCOME sign so it stays readable
    [[14.8, 27.3], [16.9, 27.1], [23.1, 27.1], [25.2, 27.3]].forEach(([x, z], i) => {
      const c = new Character('showgirl');
      c.root.position.set(x, 1.12, z);
      c.root.rotation.y = Math.PI;
      c.dance = { phase: i * 0.15 };                 // a ripple down the line
      this.group.add(c.root);
      this.dancers.push(c);
    });
  }

  _updateShow(dt) {
    if (!this.dancers) return;
    const t = STYLE.cartoon ? Math.floor(this.pulseT * 12) / 12 : this.pulseT;   // on twos
    for (const c of this.dancers) {
      c.update(dt, 0);
      const B = c.bones;
      // can-can: alternate high kicks on the beat, arms up and out, hips swinging
      const beat = t * 2.2 + c.dance.phase * Math.PI;
      const kickL = Math.max(0, Math.sin(beat)), kickR = Math.max(0, -Math.sin(beat));
      B.upperLegL.rotation.x = -kickL * 1.7;
      B.lowerLegL.rotation.x = kickL * 0.3;
      B.upperLegR.rotation.x = -kickR * 1.7;
      B.lowerLegR.rotation.x = kickR * 0.3;
      B.hips.rotation.z = Math.sin(beat) * 0.12;
      B.hips.position.y = c.rest.hips.y + Math.abs(Math.sin(beat)) * 0.04;
      B.spine.rotation.x = -0.1;
      B.upperArmL.rotation.set(-0.2, 0, 1.9 + Math.sin(beat * 0.5) * 0.15);
      B.upperArmR.rotation.set(-0.2, 0, -1.9 - Math.sin(beat * 0.5) * 0.15);
      B.foreArmL.rotation.set(-0.3, 0, 0);
      B.foreArmR.rotation.set(-0.3, 0, 0);
      B.head.rotation.z = Math.sin(beat) * 0.15 + c.headTilt;
    }
    // their heels on the boards, now and then
    this.tapT = (this.tapT ?? 0) - dt;
    if (this.tapT <= 0) { this.tapT = 0.45; this.game.audioAt('step_click', { x: 20, y: 1.2, z: 27.6 }, 'ambient'); }
  }

  // ------------------------------- the fountain ------------------------------
  _fountain() {
    const M = this.M;
    const fx = 0, fz = 14;
    this._add(new THREE.Mesh(lathe([[3.0, 0], [3.3, 0.05], [3.3, 0.7], [3.1, 0.82], [2.9, 0.82], [2.9, 0.3], [0, 0.3]], 48), M.marbleW), fx, 0, fz);
    this._add(new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.06, 8, 64), M.gold), fx, 0.8, fz).rotation.x = Math.PI / 2;
    const water = new THREE.Mesh(new THREE.CircleGeometry(2.95, 48), new THREE.MeshStandardMaterial({
      color: 0x0a3a44, emissive: 0x1ab8d0, emissiveIntensity: 0.9, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.88 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(fx, 0.72, fz);
    water.userData.dynamic = true;
    this.group.add(water);
    this.fountainWater = water;
    // tiers of gold with a giant chip on top
    this._add(new THREE.Mesh(lathe([[0.5, 0], [0.4, 0.8], [1.2, 1.0], [1.25, 1.1], [0.35, 1.2], [0.25, 2.0], [0.7, 2.15], [0.72, 2.25], [0.2, 2.3], [0.12, 2.8]], 32), M.gold), fx, 0.3, fz);
    const chip = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.14, 40),
      [M.gold, new THREE.MeshStandardMaterial({ map: chipFaceTexture('#b3122e'), roughness: 0.3, metalness: 0.3 }), M.gold]);
    chip.rotation.x = Math.PI / 2;
    chip.position.set(fx, 3.55, fz);
    chip.userData.dynamic = true;
    this.group.add(chip);
    this.fountainChip = chip;
    this.colliders.push({ x: fx, z: fz, r: 3.6, h: 0.9 });
  }

  // --------------------------------- lighting --------------------------------
  _lights() {
    const g = this.group;
    // low, cold fill: the room lives in the pools of light, not between them
    // (1930s: a warm, even studio fill — cartoons are flat colour, not pools of dark)
    this.hemi = new THREE.HemisphereLight(HEMI_SKY, STYLE.cartoon ? 0x5a4032 : 0x12060e, 0.3);
    g.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xffd8b0, 0.3);
    this.key.position.set(6, 10, 4);
    g.add(this.key);
    this.chandLight = new THREE.PointLight(0xffd9a0, 45, 26, 1.6);
    this.chandLight.position.set(0, 4.6, -4);
    g.add(this.chandLight);
    // the chandelier's hard pool of light — casts real shadows
    this.chandSpot = new THREE.SpotLight(0xffe0b0, 140, 34, 1.15, 0.65, 1.4);
    this.chandSpot.position.set(0, 4.55, -4);
    this.chandSpot.target.position.set(0, 0, -3);
    this.chandSpot.castShadow = true;
    this.chandSpot.shadow.mapSize.set(2048, 2048);
    this.chandSpot.shadow.camera.near = 0.5;
    this.chandSpot.shadow.camera.far = 30;
    this.chandSpot.shadow.bias = -0.0004;
    this.chandSpot.shadow.normalBias = 0.03;
    g.add(this.chandSpot, this.chandSpot.target);
    const barLight = new THREE.PointLight(0xffa850, 30, 16, 1.6);
    barLight.position.set(-24, 4, 26);
    g.add(barLight);
    const fountainLight = new THREE.PointLight(0x27d6ff, 26, 13, 1.6);
    fountainLight.position.set(0, 2.2, 14);
    g.add(fountainLight);
    const stageLight = new THREE.PointLight(0xff7ad0, 36, 18, 1.6);
    stageLight.position.set(20, 5.5, 24);
    g.add(stageLight);
    // the wings share ONE light that moves to whichever room you're in (or
    // the nearest open one) — three more always-on lights would tax every pixel
    this.wingDefs = {
      1: { pos: [0, 4.4, -48], color: 0xffc890, i: 40, dist: 24 },     // warm gold
      2: { pos: [-49, 5.0, 0], color: 0xd088ff, i: 60, dist: 30 },     // bruised violet
      3: { pos: [47, 3.9, 0], color: 0xd8ffe8, i: 30, dist: 24 },      // cold fluorescent
    };
    this.wingLight = new THREE.PointLight(0xffffff, 0, 24, 1.5);
    this.wingLight.position.set(0, -20, 0);
    g.add(this.wingLight);
    this.wingZone = 0; this.wingK = 0;
    this.points = [this.chandLight, barLight, fountainLight, stageLight];
    this.baseIntensity = new Map([[this.hemi, STYLE.cartoon ? 1.35 : 0.3], [this.key, STYLE.cartoon ? 1.1 : 0.3], [this.chandLight, 45], [this.chandSpot, 140], [barLight, 30], [fountainLight, 26], [stageLight, 36]]);

    // sweeping colored searchlights with visible beams
    const beamGeo = new THREE.ConeGeometry(1, 1, 24, 1, true);
    beamGeo.translate(0, -0.5, 0);           // apex at the origin, opening downward
    for (const [color, phase, x, z] of [[0xff2d78, 0, -12, -10], [0x27e6ff, 2.1, 12, -8], [0xffd24a, 4.2, 0, 10]]) {
      const sp = new THREE.SpotLight(color, 180, 32, 0.3, 0.55, 1.4);
      sp.position.set(x, 6.8, z);
      sp.target.position.set(x, 0, z);
      g.add(sp, sp.target);
      const beam = new THREE.Mesh(beamGeo, this._beamMaterial(color, 0.16));
      beam.position.copy(sp.position);
      g.add(beam);
      this.discoLights.push({ light: sp, beam, phase, baseColor: new THREE.Color(color), home: new THREE.Vector2(x, z) });
      this.baseIntensity.set(sp, 180);
    }
    // soft shafts falling out of the chandeliers
    for (const [x, z, s, y, hh] of [[0, -4, 1, 2.4, 4.8], [-18, 22, 0.6, 2.4, 4.8], [18, -24, 0.6, 2.4, 4.8], [0, -48, 0.72, 1.9, 3.8]]) {
      const shaft = new THREE.Mesh(new THREE.ConeGeometry(5.5 * s, hh, 32, 1, true), this._beamMaterial(0xffd9a0, 0.09));
      shaft.position.set(x, y, z);
      g.add(shaft);
    }
    this.flickerT = 25 + Math.random() * 20;
    this.flickering = 0;
  }

  /** soft volumetric-looking beam: fades toward its silhouette edges and its far end */
  _beamMaterial(color, opacity) {
    return new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        varying vec3 vN; varying vec3 vV; varying vec2 vUv;
        void main() {
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vV = normalize(-mv.xyz);
          vUv = uv;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uOpacity;
        varying vec3 vN; varying vec3 vV; varying vec2 vUv;
        void main() {
          // clamp: MSAA can extrapolate uv past the edge, and pow(<0) is NaN
          float face = pow(clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.2);
          float along = pow(clamp(vUv.y, 0.0, 1.0), 1.6);
          gl_FragColor = vec4(uColor, uOpacity * face * (0.12 + along));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
  }

  /** shadows: spotlight + every static prop and the floor */
  enableShadows(on, size = 2048) {
    this.chandSpot.castShadow = on;
    if (on && this.chandSpot.shadow.mapSize.x !== size) {
      this.chandSpot.shadow.mapSize.set(size, size);
      this.chandSpot.shadow.map?.dispose();
      this.chandSpot.shadow.map = null;
    }
    this.static.traverse((o) => { if (o.isMesh) { o.castShadow = on; o.receiveShadow = on; } });
  }

  // ------------------------------ the nav grid --------------------------------
  _buildNav() {
    const nav = this.nav = new NavGrid(-64, 128);
    this.nav2 = nav.fork();          // co-op: the field that leads to player 2
    ZONES.forEach((z, i) => {
      nav.markZone(i, ...z.rect);
      if (z.gap) nav.markZone(i, ...z.gap);
    });
    for (const c of this.colliders) nav.markCircle(c.x, c.z, c.r * 0.92);
    for (const b of this.boxes) if (b.door === undefined) nav.markBox(b.x0, b.z0, b.x1, b.z1);
    nav.zoneOpen[0] = 1;
    // spawn spots: open floor with room to stand, every other meter
    this.spawnPoints = [];
    const N = nav.N;
    for (let j = 1; j < N - 1; j += 2) {
      for (let i = 1; i < N - 1; i += 2) {
        const k = j * N + i;
        if (nav.zone[k] < 0 || nav.solid[k]) continue;
        let ok = true;
        for (let dj = -1; dj <= 1 && ok; dj++) for (let di = -1; di <= 1; di++) {
          const kk = k + dj * N + di;
          if (nav.solid[kk] || nav.zone[kk] !== nav.zone[k]) { ok = false; break; }
        }
        if (ok) this.spawnPoints.push({ x: nav.cx(k), z: nav.cz(k), zone: nav.zone[k] });
      }
    }
  }

  zoneAtRaw(x, z) {
    for (let i = ZONES.length - 1; i >= 0; i--) {
      const r = ZONES[i].rect;
      if (x >= r[0] - 0.5 && x <= r[2] + 0.5 && z >= r[1] - 0.5 && z <= r[3] + 0.5) return i;
    }
    return 0;
  }

  isZoneOpen(i) { return this.nav.zoneOpen[i] === 1; }
  walkable(x, z) { return this.nav.walkableAt(x, z); }
  ceilAt(x, z) { return ZONES[this.zoneAtRaw(x, z)].ceil; }

  /** a spot for a zombie to claw up: open rooms, not on top of you */
  spawnPoint(playerPos, fwd = null, minD = 11, maxD = 44) {
    const cands = [], weights = [];
    let total = 0;
    for (const s of this.spawnPoints) {
      if (!this.isZoneOpen(s.zone)) continue;
      const dx = s.x - playerPos.x, dz = s.z - playerPos.z;
      const d = Math.hypot(dx, dz);
      if (d < minD || d > maxD) continue;
      let w = 1;
      if (fwd && (dx * fwd.x + dz * fwd.z) / d < 0.2) w = 2.5;   // prefer out of sight
      cands.push(s); weights.push(w); total += w;
    }
    if (!cands.length) {
      const open = this.spawnPoints.filter((s) => this.isZoneOpen(s.zone) && Math.hypot(s.x - playerPos.x, s.z - playerPos.z) > 6);
      const s = open[Math.floor(Math.random() * open.length)] || { x: 0, z: -30 };
      return new THREE.Vector3(s.x, 0, s.z);
    }
    let r = Math.random() * total;
    for (let i = 0; i < cands.length; i++) { r -= weights[i]; if (r <= 0) return new THREE.Vector3(cands[i].x + (Math.random() - 0.5), 0, cands[i].z + (Math.random() - 0.5)); }
    const s = cands[cands.length - 1];
    return new THREE.Vector3(s.x, 0, s.z);
  }

  // --------------------------------- doors ------------------------------------
  /** pay the doorman: the doors swing into the room, the rope goes down */
  openZone(i, instant = false) {
    const d = this.doors.find((dd) => dd.zone === i);
    if (!d || d.open) return;
    d.open = true;
    this.nav.zoneOpen[i] = 1;
    this.boxes = this.boxes.filter((b) => b !== d.barrier);
    if (instant) {
      d.t = -1;
      for (const L of d.leaves) L.hinge.rotation.y = L.sx < 0 ? 1.62 : -1.62;
      d.rope.visible = false;
    } else {
      d.t = 0;
      this.game.audioAt('door', d.front);
    }
  }

  /** fresh run: every wing locked again */
  resetDoors() {
    for (const d of this.doors) {
      d.open = false; d.t = -1;
      this.nav.zoneOpen[d.zone] = 0;
      if (!this.boxes.includes(d.barrier)) this.boxes.push(d.barrier);
      for (const L of d.leaves) L.hinge.rotation.y = 0;
      d.rope.visible = true;
      d.rope.position.y = 0;
    }
  }

  openZones() { return this.doors.filter((d) => d.open).map((d) => d.zone); }

  // ------------------------------ ray vs world --------------------------------
  /** where a ray hits the room (floor/ceiling/walls/cover), for impact effects */
  rayHit(o, d, maxDist = 80) {
    let best = maxDist, normal = null;
    if (d.y < -1e-4) { const t = -o.y / d.y; if (t < best) { best = t; normal = new THREE.Vector3(0, 1, 0); } }
    const ch = this.ceilAt(o.x, o.z);
    if (d.y > 1e-4) { const t = (ch - o.y) / d.y; if (t < best) { best = t; normal = new THREE.Vector3(0, -1, 0); } }
    // boxes: slab test in XZ, then the height
    for (const b of this.boxes) {
      let t0 = 0, t1 = best, nAxis = null, nSign = 0;
      let ok = true;
      for (const [axis, lo, hi] of [['x', b.x0, b.x1], ['z', b.z0, b.z1]]) {
        const ov = o[axis], dv = d[axis];
        if (Math.abs(dv) < 1e-8) { if (ov < lo || ov > hi) { ok = false; break; } continue; }
        let ta = (lo - ov) / dv, tb = (hi - ov) / dv;
        let s = -1;
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; s = 1; }
        if (ta > t0) { t0 = ta; nAxis = axis; nSign = s; }
        if (tb < t1) t1 = tb;
        if (t0 > t1) { ok = false; break; }
      }
      if (!ok || !nAxis || t0 <= 0 || t0 >= best) continue;
      if (o.y + d.y * t0 > b.h) continue;
      best = t0;
      normal = new THREE.Vector3(nAxis === 'x' ? nSign : 0, 0, nAxis === 'z' ? nSign : 0);
    }
    for (const c of this.colliders) {
      // vertical cylinder: solve in XZ, then check height
      const ox = o.x - c.x, oz = o.z - c.z;
      const a = d.x * d.x + d.z * d.z;
      if (a < 1e-6) continue;
      const b = 2 * (ox * d.x + oz * d.z), cc = ox * ox + oz * oz - c.r * c.r * 0.72;
      const disc = b * b - 4 * a * cc;
      if (disc < 0) continue;
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t > 0 && t < best && o.y + d.y * t < (c.h || 1.5)) {
        best = t;
        normal = new THREE.Vector3(ox + d.x * t, 0, oz + d.z * t).normalize();
      }
    }
    if (!normal) return null;
    return { point: o.clone().addScaledVector(d, best), normal, dist: best };
  }

  /** is this point inside a wall (or out of the building entirely)? */
  solidAt(p) {
    for (const b of this.boxes) {
      if (p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1 && p.y < b.h) return true;
    }
    return Math.abs(p.x) > 62 || Math.abs(p.z) > 62;
  }

  /** does a straight line between two points pass through cover or walls? (2D) */
  lineBlocked(a, b, cover = true) {
    const ax = a.x, az = a.z, bx = b.x, bz = b.z;
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1) return false;
    if (cover) for (const c of this.colliders) {
      const da = Math.hypot(ax - c.x, az - c.z);
      const db = Math.hypot(bx - c.x, bz - c.z);
      if (da < c.r + 1.2 || db < c.r + 1.2) continue;
      const t = Math.max(0, Math.min(1, ((c.x - ax) * dx + (c.z - az) * dz) / len2));
      const px = ax + t * dx, pz = az + t * dz;
      if (Math.hypot(px - c.x, pz - c.z) < c.r * 0.85) return true;
    }
    for (const bb of this.boxes) {
      if (bb.h < 2) continue;                          // low furniture doesn't muffle
      let t0 = 0, t1 = 1, hit = true;
      for (const [o, dv, lo, hi] of [[ax, dx, bb.x0, bb.x1], [az, dz, bb.z0, bb.z1]]) {
        if (Math.abs(dv) < 1e-8) { if (o < lo || o > hi) { hit = false; break; } continue; }
        let ta = (lo - o) / dv, tb = (hi - o) / dv;
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) { hit = false; break; }
      }
      if (hit && t0 > 0.02 && t1 < 0.98) return true;
    }
    return false;
  }

  // ------------------------------ collision ---------------------------------
  /**
   * push a body (circle of radius r at pos, XZ) out of every collider; returns
   * true if it moved. y: the body's height — things flying over a table clear it
   */
  collide(pos, radius, y = -Infinity) {
    let moved = false;
    pos.x = clamp(pos.x, -62, 62);
    pos.z = clamp(pos.z, -62, 62);
    for (const c of this.colliders) {
      if (y > (c.h || 1.5)) continue;
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const r = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r && d2 > 1e-9) {
        const d = Math.sqrt(d2);
        pos.x = c.x + (dx / d) * r;
        pos.z = c.z + (dz / d) * r;
        moved = true;
      }
    }
    for (const b of this.boxes) {
      if (y > b.h) continue;
      if (pos.x < b.x0 - radius || pos.x > b.x1 + radius || pos.z < b.z0 - radius || pos.z > b.z1 + radius) continue;
      const qx = clamp(pos.x, b.x0, b.x1), qz = clamp(pos.z, b.z0, b.z1);
      const dx = pos.x - qx, dz = pos.z - qz;
      const d2 = dx * dx + dz * dz;
      if (d2 > 1e-9) {
        if (d2 < radius * radius) {
          const d = Math.sqrt(d2);
          pos.x = qx + (dx / d) * radius;
          pos.z = qz + (dz / d) * radius;
          moved = true;
        }
      } else {
        // center inside the box: shove out the shortest way
        const pen = [[pos.x - b.x0, -1, 0], [b.x1 - pos.x, 1, 0], [pos.z - b.z0, 0, -1], [b.z1 - pos.z, 0, 1]];
        pen.sort((p, q) => p[0] - q[0]);
        const [depth, sx, sz] = pen[0];
        pos.x += sx * (depth + radius);
        pos.z += sz * (depth + radius);
        moved = true;
      }
    }
    return moved;
  }

  // ---------------------------- lighting states -----------------------------
  setLowLight(on) {
    this.lowLight = on;
    this._applyLights(1);
  }

  setRedAlert(on) {
    this.redAlert = on;
    if (!on) {
      this.hemi.color.set(HEMI_SKY);
      for (const d of this.discoLights) d.light.color.copy(d.baseColor);
      this.chandLight.color.set(0xffd9a0);
      this.chandSpot.color.set(0xffe0b0);
    } else {
      this.hemi.color.set(0xff3333);
    }
    this._applyLights(1);
  }

  /** every light = its base x blackout dimming x the current flicker */
  _applyLights(flick) {
    this._flick = flick;
    const low = this.lowLight ? 0.22 : 1;
    for (const [light, base] of this.baseIntensity) light.intensity = base * low * flick;
    for (const d of this.discoLights) d.beam.material.uniforms.uOpacity.value = 0.16 * low * flick;
    this.game.scene.environmentIntensity = (this.lowLight ? 0.06 : (this.game.envIntensity ?? 0.22)) * (0.4 + 0.6 * flick);
  }

  /** the power stutters: lights flicker out for a moment, then catch */
  _flicker(dt) {
    const g = this.game;
    if (g.state !== 'COMBAT') { if (this.flickering > 0) { this.flickering = 0; this._applyLights(1); } return; }
    this.flickerT -= dt;
    if (this.flickerT <= 0 && this.flickering <= 0) {
      this.flickerT = 22 + Math.random() * 30;
      this.flickering = 1.1 + Math.random() * 0.8;
      this._flickHold = 0;
      g.audioAt('neon_buzz', g.player.pos);
      if (Math.random() < 0.5) setTimeout(() => g.audioAt('creak', { x: g.player.pos.x + 6, y: 5, z: g.player.pos.z }), 300);
    }
    if (this.flickering > 0) {
      this.flickering -= dt;
      this._flickHold -= dt;
      if (this._flickHold <= 0) {
        this._flickHold = 0.04 + Math.random() * 0.1;
        const rf = g.settings.reducedFlash;
        this._flickVal = rf ? 0.55 + Math.random() * 0.2 : (Math.random() < 0.45 ? 0.04 + Math.random() * 0.15 : 0.7 + Math.random() * 0.4);
      }
      this._applyLights(this.flickering > 0 ? this._flickVal : 1);
    }
  }

  /** spin the floor roulette for real; onLand fires when the ball drops */
  spinHouseWheel(onLand, dur = 4.2) {
    if (this.houseSpin && !this.houseSpin.done) return false;
    this.houseSpin = { t: 0, dur, ballA: 0, onLand, done: false };
    this.game.audioAt('wheel_spin', { x: 0, y: 1.2, z: -4 });
    return true;
  }

  /** the Strip's noise and glitter: bulbs, keno, smoke, the PA, the show */
  _updateVegas(dt) {
    const g = this.game, t = this.pulseT, rf = g.settings.reducedFlash;
    // bulbs chasing round the WELCOME sign and the ALL IN arch
    if (this.welcome) this.welcome.bulbs.forEach((b, i) => { b.material.emissiveIntensity = rf ? 2.4 : 1 + 2.4 * Math.max(0, Math.sin(t * 5 - i * 0.5)); });
    if (this.allIn && !this.allIn.busy) this.allIn.bulbs.forEach((b, i) => { b.material.emissiveIntensity = rf ? 2.4 : 1.2 + 2 * Math.max(0, Math.sin(t * 3 - i * 0.4)); });
    if (this.stripGlow) this.stripGlow.material.opacity = 0.06 + 0.03 * Math.sin(t * 0.7);
    // the keno board draws a ball every half second (a soft blip if you're near)
    if (this.keno?.tick(dt) && Math.hypot(g.player.pos.x - 29.6, g.player.pos.z + 35) < 14) g.audioAt('beep', { x: 29.6, y: 3, z: -35 }, 'ambient');
    this._updateShow(dt);
    // cigarette smoke curling up off the ashtrays at the slot banks and the bar
    this.smokeT = (this.smokeT ?? 0) - dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.3;
      const spots = this._ashtrays ||= [...this.bankPositions.map(([x, z]) => [x * 0.84, z * 0.84]), [-26, 24.8], [-21, 24.8], [22, -4], [-22, -4]];
      const [x, z] = spots[Math.floor(Math.random() * spots.length)];
      g.effects.spawnWisp(new THREE.Vector3(x + (Math.random() - 0.5), 1.0, z + (Math.random() - 0.5)));
    }
    if (g.state === 'MENU') return;
    // the casino PA, coins in a tray, a cheer from the craps table, the ghost at the piano
    const timer = (key, lo, hi, fn) => { this[key] = (this[key] ?? lo + Math.random() * (hi - lo)) - dt; if (this[key] <= 0) { this[key] = lo + Math.random() * (hi - lo); fn(); } };
    timer('paT', 25, 50, () => Audio.play('pa_chime'));
    timer('coinT', 9, 20, () => { const [x, z] = this.bankPositions[Math.floor(Math.random() * this.bankPositions.length)]; g.audioAt('coins', { x, y: 1, z }, 'ambient'); });
    timer('cheerT', 22, 45, () => g.audioAt('cheer', { x: 0, y: 1.2, z: -16 }, 'ambient'));
    timer('pianoT', 6, 9, () => g.audioAt('lounge_piano', { x: 20, y: 1.8, z: 27 }, 'ambient'));
  }

  /** the shared wing light: the room you're in, else the nearest open one */
  _updateWingLight(dt) {
    const p = this.game.player?.pos;
    let want = 0;
    if (p) {
      const z = this.zoneAtRaw(p.x, p.z);
      if (z > 0 && this.isZoneOpen(z)) want = z;
      else {
        let bd = 1e9;
        for (const [k, w] of Object.entries(this.wingDefs)) {
          if (!this.isZoneOpen(+k)) continue;
          const d = Math.hypot(p.x - w.pos[0], p.z - w.pos[2]);
          if (d < bd) { bd = d; want = +k; }
        }
      }
    }
    // fade out, hop rooms, fade back in
    if (want !== this.wingZone) {
      this.wingK = Math.max(0, this.wingK - dt * 4);
      if (this.wingK <= 0) {
        this.wingZone = want;
        const w = this.wingDefs[want];
        if (w) { this.wingLight.position.set(...w.pos); this.wingLight.color.set(w.color); this.wingLight.distance = w.dist; }
      }
    } else if (want) this.wingK = Math.min(1, this.wingK + dt * 3);
    const w = this.wingDefs[this.wingZone];
    const low = this.lowLight ? 0.22 : 1;
    this.wingLight.intensity = w ? w.i * this.wingK * low * (this._flick ?? 1) : 0;
  }

  // ------------------------------ animation ---------------------------------
  update(dt) {
    this.pulseT += dt;
    const t = this.pulseT;
    const rf = this.game.settings.reducedFlash;

    // a slot machine somewhere pays out for a ghost
    this.chimeT = (this.chimeT ?? 6) - dt;
    if (this.chimeT <= 0) {
      this.chimeT = 7 + Math.random() * 9;
      const banks = this.bankPositions;
      const [x, z] = banks[Math.floor(Math.random() * banks.length)];
      this.game.audioAt('ambient_chime', { x, y: 2, z }, 'ambient');
    }

    // roulette centerpiece slowly spins with the ball racing the other way —
    // unless someone paid to spin it for real (the house wheel)
    const hw = this.houseSpin;
    if (hw) {
      hw.t += dt;
      const k = Math.min(1, hw.t / hw.dur);
      const e = 1 - Math.pow(1 - k, 3);
      this.wheel.rotation.y += dt * (0.4 + 3.2 * (1 - e));
      hw.ballA -= dt * (1.3 + 11 * (1 - e) * (1 - e));
      const r = 1.72 - 0.2 * Math.min(1, k * 1.4);
      const bounce = k > 0.55 && k < 0.8 ? Math.abs(Math.sin(k * 60)) * 0.03 * (1 - k) : 0;
      // once it drops, the ball rides its pocket round with the wheel
      if (k >= 1) { hw.rest ??= hw.ballA - this.wheel.rotation.y; hw.ballA = this.wheel.rotation.y + hw.rest; }
      this.ball.position.set(Math.cos(hw.ballA - this.wheel.rotation.y) * r, 0.1 + bounce, Math.sin(hw.ballA - this.wheel.rotation.y) * r);
      if (k >= 1 && !hw.done) { hw.done = true; hw.onLand?.(); }
      if (hw.t > hw.dur + 3) this.houseSpin = null;
    } else {
      this.wheel.rotation.y += dt * 0.4;
      const ba = -t * 1.3;
      this.ball.position.set(Math.cos(ba) * 1.72, 0.1, Math.sin(ba) * 1.72);
    }
    this._updateVegas(dt);
    this.fountainChip.rotation.z += dt * 0.8;
    this.fountainWater.material.emissiveIntensity = 0.8 + 0.2 * Math.sin(t * 2);

    // the automats breathe
    for (const pm of this.perkMachines) {
      const k = rf ? 1 : 0.85 + 0.25 * Math.sin(t * 2.2 + pm.pos.x);
      pm.group.userData.glow[0].emissiveIntensity = 2.4 * k;
      pm.glow.material.opacity = 0.32 + 0.1 * k;
      pm.group.userData.glass.rotation.y += dt * 0.6;
    }

    this._updateWingLight(dt);

    // doors swinging open
    for (const d of this.doors) {
      if (d.t < 0) continue;
      d.t += dt;
      const k = Math.min(1, d.t / 1.4);
      const e = 1 - Math.pow(1 - k, 3);
      for (const L of d.leaves) L.hinge.rotation.y = (L.sx < 0 ? 1 : -1) * 1.62 * e;
      d.rope.position.y = -1.2 * Math.min(1, d.t / 0.6);
      if (d.t > 0.6) d.rope.visible = false;
      if (k >= 1) d.t = -1;
    }

    // searchlights sweep the floor, their beams following
    for (const d of this.discoLights) {
      const a = t * 0.33 + d.phase;
      const tx = d.home.x + Math.cos(a) * 7 + Math.sin(a * 1.7) * 3;
      const tz = d.home.y + Math.sin(a * 0.8) * 7;
      d.light.target.position.set(tx, 0, tz);
      const dir = this._v.set(tx, 0, tz).sub(d.light.position);
      const L = dir.length();
      const r = L * Math.tan(d.light.angle) * 0.9;
      d.beam.scale.set(r, L, r);
      d.beam.quaternion.setFromUnitVectors(this._down, dir.normalize());
    }
    this._flicker(dt);

    // marquee bulbs chase (steady glow when reduced flashing is on)
    const mq = this.marquee;
    for (let i = 0; i < mq.bulbs.length; i++) {
      const b = mq.bulbs[i];
      const k = rf ? 1 : 0.35 + 0.9 * Math.max(0, Math.sin(t * 4 + b.phase));
      mq.mesh.setColorAt(i, mq.tmp.copy(b.base).multiplyScalar(k * 1.6));
    }
    mq.mesh.instanceColor.needsUpdate = true;
    if (!rf && Math.random() < 0.004 && this.flickerNeons.length) {
      const sign = this.flickerNeons[Math.floor(Math.random() * this.flickerNeons.length)];
      sign.visible = false;
      setTimeout(() => { sign.visible = true; }, 60 + Math.random() * 90);
    }

    if (this.redAlert) {
      const pulse = rf ? 1 : 0.65 + 0.35 * Math.sin(t * 3);
      for (const d of this.discoLights) { d.light.color.set(0xff1a1a); d.light.intensity = 200 * pulse; }
      this.chandLight.color.set(0xff4444);
      this.chandSpot.color.set(0xff6a5a);
    }
  }
}

export { cocktailGlass };
