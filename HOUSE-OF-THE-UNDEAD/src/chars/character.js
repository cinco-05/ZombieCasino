// character.js — one animated, skinned, dressed character. Owns:
//   root  (world placement + facing) > pivot (lean/topple) > SkinnedMesh + bones
//   props on bones, invisible hitboxes (head / torso / limbs), a contact shadow.
// Animation is procedural: gait cycles (shamble, lurch, run, stalk), attack
// swings, hit flinches, collapse-and-fall deaths, rising out of the floor.

import * as THREE from 'three';
import { bodyFor, makeSkeleton, BUILDS } from './rig.js';
import { LOOKS, skinFor, variantsOf } from './skins.js';
import { buildProps, HAT_PROPS } from './props.js';
import { toTexture, softBlobCanvas } from '../gfx/texkit.js';
import { STYLE, toonRim } from '../gfx/style.js';
import { dizzyStarMaterial } from '../gfx/toonart.js';

const GAITS = {
  gambler: 'stalk', gambler2: 'stalk',
  walker: 'shamble', gasbag: 'shamble', collector: 'stalk',
  brute: 'lurch', pitguard: 'lurch', pitboss: 'lurch',
  sprinter: 'run', jackpot: 'run',
  croupier: 'stalk', magician: 'stalk', spitter: 'stalk', housedealer: 'stalk',
  showgirl: 'run', king: 'stalk',
};

// ------------------------------ materials ------------------------------------
const _eyeMats = new Map();
function eyeMaterial(color) {
  if (!_eyeMats.has(color)) {
    _eyeMats.set(color, new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: 2.2, roughness: 0.2 }));
  }
  return _eyeMats.get(color);
}

function bodyMaterial(skin, { elite = false, double = false, share = null } = {}) {
  const m = new THREE.MeshStandardMaterial({
    map: skin.map,
    roughnessMap: skin.orm, metalnessMap: skin.orm, roughness: 1, metalness: 1,
    bumpMap: skin.bump, bumpScale: 1.4,
    emissiveMap: skin.glow || null, emissive: skin.glow ? 0xffffff : 0x000000, emissiveIntensity: 1,
    side: double ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (elite) m.color.set(0xffd98a);
  const flash = share ? share.flash : { value: 0 };
  const flashColor = share ? share.flashColor : { value: new THREE.Color(1.0, 0.82, 0.7) };
  const glowBoost = share ? share.glowBoost : { value: 0 };
  m.userData.flash = flash;
  m.userData.flashColor = flashColor;
  m.userData.glowBoost = glowBoost;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFlash = flash;
    sh.uniforms.uFlashColor = flashColor;
    sh.uniforms.uGlowBoost = glowBoost;
    sh.fragmentShader = 'uniform float uFlash;\nuniform vec3 uFlashColor;\nuniform float uGlowBoost;\n' + sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
       totalEmissiveRadiance *= 1.0 + uGlowBoost;
       totalEmissiveRadiance += uFlashColor * uFlash;
       ${elite ? 'totalEmissiveRadiance += vec3(0.16, 0.11, 0.02) * pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 2.0) * 3.0;' : ''}`);
  };
  m.customProgramCacheKey = () => (elite ? 'hotu-body-elite' : 'hotu-body');
  return toonRim(m, 0.2);
}

let _shadowTex = null;
function shadowTexture() {
  if (!_shadowTex) _shadowTex = toTexture(softBlobCanvas(128, 'rgba(0,0,0,0.8)', 'rgba(0,0,0,0)'), { srgb: false });
  return _shadowTex;
}
const _hbMat = new THREE.MeshBasicMaterial({ visible: false });
const _geoCache = new Map();
function cachedGeo(key, make) {
  if (!_geoCache.has(key)) _geoCache.set(key, make());
  return _geoCache.get(key);
}
const _shadowGeo = new THREE.PlaneGeometry(1, 1);

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ease = (t) => t * t * (3 - 2 * t);

// ------------------------------- Character -----------------------------------
export class Character {
  /**
   * kind: key in LOOKS. opts: { variant, elite, hitRef (object hitboxes point to), height }
   */
  constructor(kind, opts = {}) {
    const look = LOOKS[kind];
    this.kind = kind;
    this.look = look;
    const variant = opts.variant ?? Math.floor(Math.random() * variantsOf(kind));
    this.variant = variant;          // co-op sends it so both screens dress them alike
    const body = bodyFor(look.build, look.buildExtra || {});
    const b = body.build;
    const skin = skinFor(kind, variant);
    this.skin = skin;

    this.root = new THREE.Group();
    this.pivot = new THREE.Group();
    this.root.add(this.pivot);

    const { bones, skeleton } = makeSkeleton(body.joints);
    this.bones = bones;
    this.rest = {};
    for (const [n, bone] of Object.entries(bones)) this.rest[n] = bone.position.clone();

    this.mat = bodyMaterial(skin, { elite: opts.elite });
    const mats = [this.mat, eyeMaterial(opts.elite ? 0xffd24a : look.eyes)];
    if (b.coat) {
      this.matDouble = bodyMaterial(skin, { elite: opts.elite, double: true, share: this.mat.userData });
      mats.push(this.matDouble);
    }
    this.mesh = new THREE.SkinnedMesh(body.geometry, mats);
    this.mesh.add(bones.root);
    this.mesh.bind(skeleton);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    // (1930s: no self-shadowing — it flickers across the cel bands; the floor shadow stays)
    this.mesh.receiveShadow = !STYLE.cartoon;
    this.pivot.add(this.mesh);

    // --- props ---
    const dims = {
      hs: b.head, neckR: 0.056 * b.neck,
      chestZ: 0.121 * b.chest + b.belly * 0.035,
      hipZ: 0.096 + b.belly * 0.085,
      color: skin.outfit.propColor,
      sq: body.mapY(1) / 1,            // how squat the body was built (capes shorten to match)
    };
    let propNames = (look.props || []).filter((p) => Math.random() < (look.propChance?.[p] ?? 1));
    if (opts.elite) propNames = propNames.filter((p) => !HAT_PROPS.has(p)).concat('crown');
    // 1930s: everybody gets the big pie-cut cartoon eyes (unless shades hide them)
    if (STYLE.cartoon && !look.hideHead && !propNames.some((p) => p === 'shades' || p === 'aviators')) propNames.push(kind.startsWith('gambler') ? 'pieEyesLiving' : 'pieEyes');
    this.props = buildProps(propNames, dims);
    this.levelProps = [];
    this.cape = null;
    for (const p of this.props) {
      bones[p.bone].add(p.obj);
      p.obj.traverse((o) => { if (o.isMesh && !o.material.transparent) o.castShadow = true; });
      if (p.level) { p.baseQuat = p.obj.quaternion.clone(); this.levelProps.push(p); }
      if (p.obj.userData.cape) this.cape = p.obj;
    }
    if (look.hideHead) bones.head.scale.setScalar(0.001);

    // --- hitboxes (invisible, raycast targets) ---
    const ref = opts.hitRef || this;
    const box = (w, h, d) => cachedGeo(`b${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`, () => new THREE.BoxGeometry(w, h, d));
    const hb = (bone, geo, x, y, z, isHead = false) => {
      const m = new THREE.Mesh(geo, _hbMat);
      m.position.set(x, y, z);
      m.userData = { ref, isHead };
      bones[bone].add(m);
      return m;
    };
    // fitted to the body as built (heights are given on the full-size figure and
    // mapped onto this one, so the squat cartoon bodies get squat boxes too)
    const J = body.joints, my = body.mapY;
    const span = (bone, y0, y1, w, d, z = 0) => {
      const a = my(y0), c = my(y1);
      return hb(bone, box(w, Math.abs(a - c), d), 0, (a + c) / 2 - J[bone].y, z);
    };
    this.hitboxes = [];
    if (look.hideHead) this.hitboxes.push(hb('neck', box(0.32, 0.38, 0.28), 0, 0.2, 0.02, true));
    else {
      // an egg the shape of the head, a touch generous so honest headshots always count
      const hs = b.head, toon = !!b.toon;
      const r = toon ? [0.092, 0.108, 0.1] : [0.09, 0.116, 0.104];
      const head = hb('head', cachedGeo('unitSphere', () => new THREE.SphereGeometry(1, 12, 10)),
        0, body.headC.y - J.head.y, body.headC.z - J.head.z + (toon ? 0.012 * hs : 0), true);
      head.scale.set(r[0] * hs, r[1] * hs, r[2] * hs);
      this.hitboxes.push(head);
    }
    this.hitboxes.push(
      span('chest', 1.14, 1.5, 0.38 * b.shoulders + b.belly * 0.04, 0.24 * b.chest + b.belly * 0.06),
      span('hips', 0.84, 1.14, 0.34 * b.hips + b.belly * 0.04, 0.23 + b.belly * 0.1, 0.01),
    );
    const gloves = b.toon ? 0.09 : 0;
    for (const s of ['L', 'R']) {
      this.hitboxes.push(
        span('upperArm' + s, 1.46, 1.16, 0.11 * b.arms, 0.11 * b.arms),
        span('foreArm' + s, 1.16, 0.84, Math.max(0.1 * b.arms, gloves), Math.max(0.1 * b.arms, gloves)),
        span('upperLeg' + s, 0.93, 0.5, 0.16 * b.legs, 0.16 * b.legs),
        span('lowerLeg' + s, 0.5, 0.03, 0.12 * b.legs, 0.13 * b.legs),
      );
    }

    // --- contact shadow ---
    this.shadow = new THREE.Mesh(_shadowGeo, new THREE.MeshBasicMaterial({
      map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.7, color: 0x000000,
    }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.012;
    this.shadow.scale.set(0.9 * b.shoulders, 0.75 + b.belly * 0.2, 1);
    this.shadow.renderOrder = -1;
    this.root.add(this.shadow);

    // --- animation state ---
    this.gait = GAITS[kind] || 'shamble';
    this.phase = Math.random() * Math.PI * 2;
    this.t = Math.random() * 10;
    this.hunch = this.gait === 'shamble' ? 0.18 + Math.random() * 0.14 : this.gait === 'lurch' ? 0.12 : this.gait === 'run' ? 0.28 : 0.05;
    this.headTilt = (Math.random() - 0.5) * 0.4;
    this.limp = this.gait === 'shamble' ? 0.25 + Math.random() * 0.35 : 0;
    this.limpSide = Math.random() < 0.5 ? 1 : -1;
    this.lungeT = 0; this.lungeDur = 0.45; this.attackStyle = 'swipe';
    this.hitT = 0;
    this.riseT = 0;
    this.dying = null;
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
  }

  get position() { return this.root.position; }

  setFlash(v, color = null) {
    this.mat.userData.flash.value = v;
    if (color !== null) this.mat.userData.flashColor.value.set(color);
  }
  setGlow(v) { this.mat.userData.glowBoost.value = v; }

  attack(style = 'swipe', dur = 0.45) { this.lungeT = dur; this.lungeDur = dur; this.attackStyle = style; }
  flinch(amount = 1) {
    this.hitT = Math.min(1, this.hitT + amount);
    if (STYLE.cartoon) this._hitSq = Math.min(1, (this._hitSq || 0) + amount);   // cartoon: SQUASH on impact
  }
  rise(seconds = 0.7) { this.riseT = seconds; this.riseDur = seconds; }
  /** feet go out from under them: flat on the back, legs up, then clamber up */
  slip(seconds = 2.2) { this.slipT = seconds; this.slipDur = seconds; this.slipSide = Math.random() < 0.5 ? 1 : -1; }
  /** blinded: arms up over the face, reeling on the spot */
  daze(seconds = 3) { this.dazeT = Math.max(this.dazeT || 0, seconds); }

  /** kill: style 'forward' | 'back' | 'side' | 'spin'; headPop removes the head */
  die(style = null, headPop = false) {
    if (this.dying) return;
    const styles = ['forward', 'back', 'back', 'side'];
    this.dying = { t: 0, style: style || styles[Math.floor(Math.random() * styles.length)], sign: Math.random() < 0.5 ? 1 : -1, arms: Math.random() };
    if (headPop && !this.look.hideHead) this.bones.head.scale.setScalar(0.001);
    this.setFlash(0);
    if (STYLE.cartoon) {
      // X X — knocked clean out
      for (const p of this.props || []) p.obj.traverse((o) => { if (o.name === 'pupil') o.visible = false; if (o.name === 'xeye') o.visible = true; });
      if (this._dizzy) this._dizzy.visible = false;
    }
  }

  /** advance animation. s = { speed (m/s), dt } ; returns true when a death has fully played out */
  update(dt, speed = 0) {
    if (!STYLE.cartoon) return this._animate(dt, speed);
    // 1930s: rubber-hose acting and squash & stretch on every footfall. (Poses
    // used to change "on twos" — 12 a second — but with the bodies gliding at
    // full frame rate that read as glitchy, so they animate smoothly now.)
    const step = dt;
    const done = this._animate(step, speed);
    const P = this.pivot;
    this._updateDizzy(step);
    // (the body is built squat already — rig.js — this just fattens them a touch)
    const SQY = 1, SQX = 1.06;
    if (this.dying || this.slipT > 0) { P.scale.set(SQX, SQY, SQX); return done; }
    const moving = speed > 0.15;
    const k = moving ? Math.min(1, speed / 3) : 0;
    this._rubberHose(moving, k);
    let sq = moving ? 1 + (0.07 + 0.06 * k) * Math.cos(this.phase * 2) : 1 + 0.035 * Math.sin(this.t * 3.1);
    if (this._hitSq > 0) {
      sq *= 1 - 0.28 * this._hitSq;                         // flattened by the hit, then boing back
      this._hitSq = Math.max(0, this._hitSq - step * 5);
    }
    const lunge = this.lungeT > 0 ? 0.12 * Math.sin(Math.PI * (1 - this.lungeT / this.lungeDur)) : 0;
    const y = sq + lunge, xz = 1 / Math.sqrt(y);
    P.scale.set(xz * SQX, y * SQY, xz * SQX);
    P.position.y = moving ? Math.max(0, -Math.cos(this.phase * 2)) * 0.07 * (0.5 + k) : 0;
    return done;
  }

  /** rubber hose: noodle arms whip and loop behind the body, the head bobs on the beat */
  _rubberHose(moving, k) {
    const B = this.bones, p = this.phase, t = this.t;
    const sw = moving ? 0.5 + 0.35 * k : 0.12;
    B.upperArmL.rotation.x += Math.sin(p) * sw * 0.55;
    B.upperArmR.rotation.x -= Math.sin(p) * sw * 0.55;
    B.foreArmL.rotation.x += Math.sin(p - 1.2) * sw * 0.6;              // the noodle lags behind
    B.foreArmR.rotation.x -= Math.sin(p - 1.2) * sw * 0.6;
    B.upperArmL.rotation.z += 0.2 + Math.sin(t * 2.3) * 0.05;          // elbows out
    B.upperArmR.rotation.z -= 0.2 + Math.sin(t * 2.3 + 1) * 0.05;
    B.handL.rotation.x += Math.sin(p - 2) * 0.4 * sw;
    B.handR.rotation.x -= Math.sin(p - 2) * 0.4 * sw;
    B.head.rotation.z += Math.sin(p * 2) * 0.1 * (moving ? 1 : 0.4);
    B.head.rotation.x += Math.cos(p * 2) * 0.05;
  }

  /** little yellow stars circling the head while stunned or flattened */
  _updateDizzy(dt) {
    const on = (this.dazeT > 0 || this.slipT > 0) && !this.dying;
    if (!on && !this._dizzy) return;
    if (!this._dizzy) {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const s = new THREE.Sprite(dizzyStarMaterial());
        s.scale.setScalar(0.13);
        g.add(s);
      }
      g.position.set(0, 0.26, 0.02);
      this.bones.head.add(g);
      this._dizzy = g;
    }
    this._dizzy.visible = on;
    if (!on) return;
    this._dizzyA = (this._dizzyA || 0) + dt * 5;
    this._dizzy.children.forEach((s, i) => {
      const a = this._dizzyA + (i / 3) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.2, Math.sin(a * 2) * 0.02, Math.sin(a) * 0.2);
    });
  }

  _animate(dt, speed = 0) {
    this.t += dt;
    const B = this.bones, R = this.rest;
    const g = this.gait;

    if (this.dying) return this._updateDeath(dt);

    // gait phase advances with distance travelled
    const stride = g === 'run' ? 1.9 : g === 'lurch' ? 1.4 : g === 'stalk' ? 1.3 : 1.05;
    const moving = speed > 0.15;
    this.phase += (moving ? speed / stride : 0) * Math.PI * 2 * dt;
    const p = this.phase;
    const amp = moving ? Math.min(1, speed / 1.2) : 0;

    // ---------------- legs ----------------
    const legA = (g === 'run' ? 0.85 : g === 'lurch' ? 0.42 : g === 'stalk' ? 0.4 : 0.46) * amp;
    const kneeA = (g === 'run' ? 1.5 : 0.75) * amp;
    for (const [s, off] of [['L', 0], ['R', Math.PI]]) {
      const limpK = this.limp && ((s === 'L') === (this.limpSide > 0)) ? 1 - this.limp : 1;
      const thigh = -Math.sin(p + off) * legA * limpK - (g === 'run' ? 0.25 * amp : 0);
      const knee = 0.08 + kneeA * Math.max(0, Math.cos(p + off)) * limpK + (g === 'lurch' ? 0.12 : 0);
      B['upperLeg' + s].rotation.set(thigh, 0, (s === 'L' ? 1 : -1) * (g === 'lurch' ? 0.06 : 0.02));
      B['lowerLeg' + s].rotation.set(knee, 0, 0);
      B['foot' + s].rotation.set(-(thigh + knee) * 0.85, 0, 0);
    }

    // ---------------- torso ----------------
    const bob = moving ? Math.abs(Math.cos(p)) : 0;
    B.hips.position.copy(R.hips);
    B.hips.position.y += (-0.035 + 0.03 * bob) * amp - (g === 'lurch' ? 0.03 : 0);
    B.hips.rotation.set(0, Math.sin(p) * 0.12 * amp, Math.sin(p) * (g === 'shamble' ? 0.07 : 0.035) * amp);
    const breathe = Math.sin(this.t * 1.6) * 0.02;
    B.spine.rotation.set(this.hunch * 0.5 + breathe, -Math.sin(p) * 0.1 * amp, -Math.sin(p) * 0.04 * amp);
    B.chest.rotation.set(this.hunch * 0.5, -Math.sin(p) * 0.06 * amp, 0);
    B.neck.rotation.set(-this.hunch * 0.4, 0, 0);
    const loll = Math.sin(this.t * 0.9) * 0.1 + Math.sin(this.t * 2.3) * 0.04;
    B.head.rotation.set(-this.hunch * 0.35 + 0.08 + (g === 'shamble' ? Math.sin(p * 2) * 0.04 : 0), loll * 0.5, this.headTilt + loll);

    // ---------------- arms ----------------
    const sx = { L: 1, R: -1 };
    for (const s of ['L', 'R']) {
      const off = s === 'L' ? Math.PI : 0;
      const ua = B['upperArm' + s], fa = B['foreArm' + s], hd = B['hand' + s];
      if (g === 'run') {
        ua.rotation.set(Math.sin(p + off) * 0.95 * amp - 0.15, 0, sx[s] * 0.12);
        fa.rotation.set(-1.25 - Math.max(0, Math.sin(p + off)) * 0.4, 0, 0);
        hd.rotation.set(0.2, 0, 0);
      } else if (g === 'stalk') {
        ua.rotation.set(Math.sin(p + off) * 0.35 * amp + 0.05, 0, sx[s] * 0.07);
        fa.rotation.set(-0.3 - Math.max(0, -Math.sin(p + off)) * 0.25 * amp, 0, 0);
        hd.rotation.set(0.1, 0, 0);
      } else {
        // the classic zombie reach
        const reach = g === 'lurch' ? -1.05 : -1.32;
        const sway = Math.sin(p + off + (s === 'L' ? 0.4 : 0)) * 0.1 + Math.sin(this.t * 1.3 + (s === 'L' ? 1 : 0)) * 0.06;
        ua.rotation.set(reach + sway, 0, sx[s] * (g === 'lurch' ? 0.22 : -0.02));
        fa.rotation.set(-0.22 - Math.sin(this.t * 1.7 + off) * 0.08, 0, 0);
        hd.rotation.set(0.45, 0, sx[s] * 0.2);
      }
    }
    // held items override one arm
    const props = this.look.props || [];
    if (props.includes('tray')) {
      B.upperArmL.rotation.set(-0.45, 0, 0.05);
      B.foreArmL.rotation.set(-1.15, 0, 0);
      B.handL.rotation.set(0, 0, 0);
    }
    if (props.includes('briefcase')) {
      B.upperArmR.rotation.set(Math.sin(p) * 0.18 * amp + 0.04, 0, -0.1);
      B.foreArmR.rotation.set(-0.05, 0, 0);
      B.handR.rotation.set(0, 0, 0);
      B.upperArmL.rotation.set(-1.25 + Math.sin(this.t * 1.1) * 0.08, 0, 0.0);
      B.foreArmL.rotation.set(-0.35, 0, 0);
    }
    if (props.includes('cardsHand') || props.includes('wand')) {
      B.upperArmR.rotation.set(-0.55 + Math.sin(this.t * 1.4) * 0.06, 0, -0.1);
      B.foreArmR.rotation.set(-0.9, 0, 0);
      B.handR.rotation.set(-0.2, 0.3, 0);
    }

    // ---------------- attack ----------------
    if (this.lungeT > 0) {
      this.lungeT = Math.max(0, this.lungeT - dt);
      const t = 1 - this.lungeT / this.lungeDur;                 // 0 -> 1
      const wind = ease(clamp01(t / 0.35)), strike = ease(clamp01((t - 0.35) / 0.3)), back = ease(clamp01((t - 0.7) / 0.3));
      const k = Math.sin(t * Math.PI);
      if (this.attackStyle === 'throw') {
        B.upperArmR.rotation.set(lerp(lerp(-0.5, -2.6, wind), -0.9, strike) * (1 - back) + -0.55 * back, 0, -0.25);
        B.foreArmR.rotation.set(lerp(-1.4, -0.2, strike), 0, 0);
        B.spine.rotation.y += (wind - strike) * 0.35;
        B.spine.rotation.x += strike * (1 - back) * 0.2;
      } else if (this.attackStyle === 'kick') {
        // a chorus-line high kick, right into your face
        const up = strike * (1 - back);
        B.upperLegR.rotation.x = lerp(B.upperLegR.rotation.x, -1.95, up);
        B.lowerLegR.rotation.x = lerp(0.9 * wind, 0.05, up);
        B.upperLegL.rotation.x = lerp(B.upperLegL.rotation.x, 0.15, up);
        B.spine.rotation.x -= 0.3 * up;
        B.upperArmL.rotation.set(-0.3, 0, 1.2 * k);
        B.upperArmR.rotation.set(-0.3, 0, -1.2 * k);
      } else if (this.attackStyle === 'pose') {
        // THE KING strikes a pose: mic to the lips, a finger to the sky
        const hold = Math.min(1, wind * 1.5) * (1 - back);
        B.upperArmR.rotation.set(lerp(B.upperArmR.rotation.x, -1.3, hold), 0, -0.25 * hold);
        B.foreArmR.rotation.set(lerp(B.foreArmR.rotation.x, -1.95, hold), 0, 0);
        B.upperArmL.rotation.set(lerp(B.upperArmL.rotation.x, -2.75, hold), 0, 0.35 * hold);
        B.foreArmL.rotation.set(-0.1 * hold, 0, 0);
        B.hips.rotation.z += 0.18 * hold * Math.sin(this.t * 6);
        B.upperLegL.rotation.z = 0.25 * hold;
        B.upperLegR.rotation.z = -0.25 * hold;
        B.head.rotation.x -= 0.25 * hold;
        B.spine.rotation.x -= 0.15 * hold;
      } else if (this.attackStyle === 'spit') {
        B.neck.rotation.x += -0.4 * wind * (1 - strike) + 0.5 * strike * (1 - back);
        B.head.rotation.x += -0.3 * wind * (1 - strike) + 0.4 * strike * (1 - back);
        B.spine.rotation.x += 0.25 * strike * (1 - back);
      } else {
        for (const s of ['L', 'R']) {
          const ua = B['upperArm' + s];
          ua.rotation.x = lerp(lerp(ua.rotation.x, -2.3, wind), -0.35, strike) * (1 - back) + ua.rotation.x * back;
          B['foreArm' + s].rotation.x = lerp(-0.2, -0.6, k);
        }
        B.spine.rotation.x += 0.4 * k;
        B.head.rotation.x += 0.25 * k;
      }
      this.pivot.position.z = this.attackStyle === 'pose' ? 0 : 0.12 * k;
    } else this.pivot.position.z = 0;

    // ---------------- flinch ----------------
    if (this.hitT > 0) {
      const h = this.hitT;
      this.hitT = Math.max(0, this.hitT - dt * 5);
      B.spine.rotation.x -= 0.35 * h;
      B.chest.rotation.x -= 0.2 * h;
      B.head.rotation.x -= 0.4 * h;
      B.upperArmL.rotation.x -= 0.4 * h;
      B.upperArmR.rotation.x -= 0.4 * h;
    }

    // ---------------- rising from the floor ----------------
    if (this.riseT > 0) {
      this.riseT = Math.max(0, this.riseT - dt);
      const k = 1 - this.riseT / this.riseDur;
      this.pivot.position.y = -1.9 * Math.pow(1 - k, 2);
      this.pivot.rotation.x = 0.5 * (1 - k);
      this.shadow.material.opacity = 0.7 * k;
    } else if (!this.dying) {
      this.pivot.position.y = 0;
      this.pivot.rotation.x = 0;
      this.pivot.rotation.z = 0;
    }

    // ---------------- slipped in the drinks ----------------
    if (this.slipT > 0) {
      this.slipT = Math.max(0, this.slipT - dt);
      const e = 1 - this.slipT / this.slipDur;
      const down = e < 0.14 ? ease(e / 0.14) : e < 0.74 ? 1 : 1 - ease((e - 0.74) / 0.26);
      const kick = e < 0.3 ? Math.sin((e / 0.3) * Math.PI) : 0;
      this.pivot.rotation.x = -down * 1.42;
      this.pivot.rotation.z = down * 0.18 * this.slipSide;
      this.pivot.position.y = down * 0.14;
      B.upperLegL.rotation.x -= kick * 1.3 + down * 0.35;
      B.upperLegR.rotation.x -= kick * 0.9 + down * 0.25;
      B.lowerLegL.rotation.x = 0.2 + down * 0.3;
      B.lowerLegR.rotation.x = 0.4 + down * 0.4;
      B.upperArmL.rotation.set(-0.4 - kick * 1.2, 0, 0.6 + kick * 0.8);
      B.upperArmR.rotation.set(-0.4 - kick * 1.1, 0, -0.6 - kick * 0.8);
      B.spine.rotation.x = -0.2 * down;
      B.head.rotation.x = 0.4 * down - 0.3 * kick;
      if (e > 0.74) B.spine.rotation.x += 0.6 * Math.sin(((e - 0.74) / 0.26) * Math.PI);   // hauling up
    }

    // ---------------- blinded ----------------
    if (this.dazeT > 0) {
      this.dazeT = Math.max(0, this.dazeT - dt);
      const k = Math.min(1, this.dazeT * 3);
      const reel = Math.sin(this.t * 5) * 0.25;
      B.upperArmL.rotation.set(-2.2 * k + B.upperArmL.rotation.x * (1 - k), 0, 0.3 * k);
      B.upperArmR.rotation.set(-2.1 * k + B.upperArmR.rotation.x * (1 - k), 0, -0.3 * k);
      B.foreArmL.rotation.x = -1.7 * k;
      B.foreArmR.rotation.x = -1.8 * k;
      B.head.rotation.x -= 0.3 * k;
      B.spine.rotation.z = reel * k;
      B.spine.rotation.x -= 0.2 * k;
    }

    // cape flutters with speed
    if (this.cape) this.cape.rotation.x = -0.12 * amp - Math.sin(this.t * 3) * 0.04 * amp;

    this._levelProps();
    return false;
  }

  _levelProps() {
    if (!this.levelProps.length) return;
    this.root.updateMatrixWorld(true);
    this.root.getWorldQuaternion(this._q2);
    for (const p of this.levelProps) {
      p.obj.parent.getWorldQuaternion(this._q).invert();
      p.obj.quaternion.copy(this._q).multiply(this._q2);
    }
  }

  _updateDeath(dt) {
    const d = this.dying;
    d.t += dt;
    const B = this.bones;
    const t = d.t;
    // 1) legs buckle and the body slumps
    const slump = ease(clamp01(t / 0.35));
    for (const s of ['L', 'R']) {
      B['upperLeg' + s].rotation.x = lerp(B['upperLeg' + s].rotation.x, -0.9, slump * 0.2);
      B['lowerLeg' + s].rotation.x = lerp(B['lowerLeg' + s].rotation.x, 1.3, slump * 0.2);
      const armGoal = d.style === 'back' ? -2.2 * d.arms : 0.3 - d.arms * 0.5;
      B['upperArm' + s].rotation.x = lerp(B['upperArm' + s].rotation.x, armGoal, 0.08);
      B['upperArm' + s].rotation.z = lerp(B['upperArm' + s].rotation.z, (s === 'L' ? 1 : -1) * 0.9 * d.arms, 0.06);
      B['foreArm' + s].rotation.x = lerp(B['foreArm' + s].rotation.x, -0.2, 0.08);
    }
    B.spine.rotation.x = lerp(B.spine.rotation.x, d.style === 'back' ? -0.3 : 0.5, 0.1);
    B.head.rotation.x = lerp(B.head.rotation.x, d.style === 'back' ? -0.6 : 0.7, 0.1);
    B.head.rotation.z = lerp(B.head.rotation.z, 0.5 * d.sign, 0.05);
    // 2) topple over, accelerating like it has weight, with a small bounce
    const f = clamp01((t - 0.12) / 0.55);
    let tip = f * f;
    if (t > 0.67) tip = 1 - Math.abs(Math.sin((t - 0.67) * 14)) * Math.exp(-(t - 0.67) * 9) * 0.06;
    const angle = tip * Math.PI / 2 * 0.97;
    const s = d.style;
    this.pivot.rotation.set(s === 'forward' ? angle : s === 'back' ? -angle : 0, 0, s === 'side' ? angle * d.sign : 0);
    this.pivot.position.y = 0.1 * tip - 0.25 * slump * (1 - tip);
    if (s === 'spin') this.root.rotation.y += dt * 4 * (1 - tip);
    // 3) lie there, then sink into the carpet
    if (t > 3.0) {
      this.pivot.position.y -= (t - 3.0) * 0.5;
      this.shadow.material.opacity = Math.max(0, 0.7 - (t - 3.0));
    }
    return t > 4.2;
  }

  dispose() {
    this.mat.dispose();
    if (this.matDouble) this.matDouble.dispose();
    this.shadow.material.dispose();
  }
}

export { LOOKS, BUILDS };
