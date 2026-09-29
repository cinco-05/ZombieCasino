// vmanim.js — first-person gun choreography. Every gun is a little machine:
//   recoil      damped springs (kick back, muzzle climb, roll) that overshoot
//   actions     hammer falls + re-cocks, the cylinder indexes, the trigger
//               travels, the pump racks, the lever cycles after each shot
//   reloads     keyframed per gun, with the left hand doing the work —
//               revolver: tip, swing the cylinder out, eject, speedloader,
//                         flick it shut;
//               shotgun:  roll, thumb shells into the port one by one, rack;
//               SMG:      drop the mag, slap a fresh one, work the handle;
//               rifle:    roll, feed cartridges through the gate, work the lever
//   extras      pistol-whip, chip-bomb throw, weapon switch, sprint carry
// update() writes part transforms and returns the gun's offset pose.

import * as THREE from 'three';

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const mixv = (a, b, k) => (typeof a === 'number' ? lerp(a, b, k) : a.map((v, i) => lerp(v, b[i], k)));

/** smoothstep-interpolated keyframes: [[t, value], ...] (value: number | [x,y,z]) */
export function track(p, keys) {
  if (p <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
    if (p <= t1) return mixv(v0, v1, smooth((p - t0) / Math.max(1e-6, t1 - t0)));
  }
  return keys[keys.length - 1][1];
}
const inRange = (p, a, b) => p >= a && p < b;
const Z3 = [0, 0, 0];

class Spring {
  constructor(k = 175, c = 15) { this.k = k; this.c = c; this.x = 0; this.v = 0; }
  kick(v) { this.v += v; }
  step(dt) {
    const a = -this.k * this.x - this.c * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
  }
}

const RECOIL = {
  pistol:    { z: 0.95, y: 0.2, rx: 3.4, rz: 0.7, ry: 0.35 },
  derringer: { z: 1.1, y: 0.35, rx: 4.4, rz: 0.9, ry: 0.4 },
  shotgun:   { z: 1.5, y: 0.35, rx: 4.6, rz: 1.0, ry: 0.5 },
  smg:       { z: 0.32, y: 0.07, rx: 0.8, rz: 0.45, ry: 0.55 },
  tommy:     { z: 0.42, y: 0.09, rx: 0.95, rz: 0.5, ry: 0.6 },
  shoe:      { z: 0.38, y: 0.05, rx: 0.9, rz: 0.2, ry: 0.25 },
  rifle:     { z: 1.3, y: 0.28, rx: 4.0, rz: 0.6, ry: 0.3 },
  magnum:    { z: 1.7, y: 0.5, rx: 5.2, rz: 0.6, ry: 0.4 },
  whale:     { z: 2.1, y: 0.5, rx: 6.2, rz: 1.1, ry: 0.5 },
  jubilee:   { z: 0.06, y: 0.02, rx: 0.12, rz: 0.15, ry: 0.15 },
  luck:      { z: 0.7, y: 0.25, rx: 2.4, rz: 0.5, ry: 0.3 },
};
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _eu = new THREE.Euler();

const COCKED = -0.75, FIRED = 0.28;

// The left forearm is modelled pointing back along the gun's +Z, so whenever
// the gun tips (every reload) it would swing straight at the lens. Each frame
// it's re-aimed at a virtual left shoulder, pivoting on whatever the hand holds.
const ARM_LOCAL = new THREE.Vector3(-0.45, -0.65, 1).normalize();   // leftFist's sleeve
const SHOULDER = new THREE.Vector3(-0.26, -0.55, 0.12);             // view space
const ARM_CONE = 0.2;                                                // slack (rad) before correcting
const _qg = new THREE.Quaternion(), _qf = new THREE.Quaternion(), _qk = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const _e = new THREE.Euler(), _d = new THREE.Vector3(), _h = new THREE.Vector3(), _goal = new THREE.Vector3();
const _axis = new THREE.Vector3(), _piv = new THREE.Vector3(), _tmp = new THREE.Vector3();

export class GunAnimator {
  constructor(models) {
    this.models = models;
    this.sp = { z: new Spring(), y: new Spring(), rx: new Spring(150, 13), ry: new Spring(), rz: new Spring(160, 12) };
    this.st = {};
    for (const id of Object.keys(models)) {
      this.st[id] = { since: 9, interval: 0.25, drumTarget: 0, drumAngle: 0, trig: 0, cycle: -1 };
    }
    this.reload = null;
    this.meleeT = -1;
    this.throwT = -1;
    this.sprint = 0;
    this.out = { pos: [0, 0, 0], rot: [0, 0, 0] };
  }

  // ------------------------------- triggers ---------------------------------
  fire(id, interval) {
    const R = RECOIL[id], s = this.st[id];
    const j = () => (Math.random() - 0.5) * 2;
    this.sp.z.kick(R.z * (0.9 + Math.random() * 0.2));
    this.sp.y.kick(R.y);
    this.sp.rx.kick(R.rx * (0.9 + Math.random() * 0.2));
    this.sp.rz.kick(R.rz * j());
    this.sp.ry.kick(R.ry * j());
    s.since = 0;
    s.interval = interval;
    s.trig = 1;
    if (id === 'pistol') s.drumTarget -= Math.PI / 3;
    if (id === 'shotgun' || id === 'rifle') s.cycle = 0;
    if (id === 'luck') s.reelV = 26;
  }

  dryFire(id) { this.st[id].trig = 1; if (id === 'pistol' || id === 'derringer') this.st[id].since = 0; }

  startReload(id, need, dur) {
    this.reload = { id, need, cycles: Math.max(1, Math.min(4, need)), dur, p: 0, fired: new Set() };
  }

  cancelReload() { this.reload = null; }
  melee() { this.meleeT = 0; }
  throw() { this.throwT = 0; }
  land(v) { this.sp.y.kick(-Math.min(1.2, v * 0.09)); this.sp.rx.kick(-Math.min(1.5, v * 0.1)); }

  // -------------------------------- update ----------------------------------
  /** ctx: { reloadP, switchProg, sprinting, onEvent(name) } -> {pos, rot} for the model */
  update(dt, id, ctx) {
    const ud = this.models[id].userData;
    const s = this.st[id];
    // undo last frame's arm-aim counter-rotation before anything is keyed
    if (this._nudged) { this._nudged.quaternion.copy(this._nudgedQ); this._nudged = null; }
    for (const k in this.sp) this.sp[k].step(Math.min(dt, 0.033));
    s.since += dt;
    s.trig = Math.max(0, s.trig - dt * 9);
    this.sprint += ((ctx.sprinting ? 1 : 0) - this.sprint) * Math.min(1, dt * 8);

    // ---------- resting part state + post-shot mechanics ----------
    if (ud.trigger) ud.trigger.rotation.x = -0.5 * smooth(s.trig);
    if (ud.fist && !ud.fistRest) ud.fist.visible = false;
    if (ud.fistRest) { ud.fist.position.copy(ud.fistRest); ud.fist.rotation.set(0, 0, 0); ud.fist.visible = true; }
    if (ud.carry?.chip) ud.carry.chip.visible = false;
    let gunPos = Z3, gunRot = Z3;

    if (id === 'pistol') {
      const rec = Math.max(0.05, s.interval * 0.7);
      ud.hammer.rotation.x = s.since < 0.035 ? FIRED : lerp(FIRED, COCKED, smooth(clamp01((s.since - 0.035) / rec)));
      s.drumAngle += (s.drumTarget - s.drumAngle) * Math.min(1, dt * 24);
      ud.drum.rotation.z = s.drumAngle;
      ud.crane.rotation.z = 0;
      ud.rounds.visible = true;
      ud.rounds.position.z = 0;
      ud.carry.speedloader.visible = false;
      ud.carry.speedloader.userData.rounds.visible = true;
      ud.carry.speedloader.rotation.z = 0;
    }
    if (id === 'shotgun') {
      let pz = 0;
      if (s.cycle >= 0) {
        s.cycle += dt;
        const c = s.cycle;
        if (c >= 0.1 && !s.cb) { s.cb = true; ctx.onEvent('pump_back'); }
        if (c >= 0.23 && !s.cf) { s.cf = true; ctx.onEvent('pump_fwd'); }
        pz = track(c, [[0.1, 0], [0.2, 0.1], [0.34, 0]]);
        gunRot = [track(c, [[0.1, 0], [0.2, 0.06], [0.34, 0]]), 0, 0];
        if (c > 0.36) { s.cycle = -1; s.cb = s.cf = false; }
      }
      ud.pump.position.z = -0.32 + pz;
      ud.support.visible = true;
      ud.support.position.copy(ud.supportBase);
      ud.support.position.z += pz;
      ud.carry.shell.visible = false;
    }
    if (id === 'rifle') {
      let lv = 0;
      if (s.cycle >= 0) {
        s.cycle += dt;
        const c = s.cycle;
        if (c >= 0.1 && !s.cb) { s.cb = true; ctx.onEvent('lever'); }
        lv = track(c, [[0.1, 0], [0.22, 1.1], [0.38, 0]]);
        gunRot = [track(c, [[0.1, 0], [0.22, -0.05], [0.38, 0]]), 0, track(c, [[0.1, 0], [0.22, 0.08], [0.38, 0]])];
        if (c > 0.4) { s.cycle = -1; s.cb = false; }
      }
      ud.lever.rotation.x = lv;
      ud.support.visible = true;
      ud.support.position.copy(ud.supportBase);
      ud.carry.cartridge.visible = false;
    }
    if (ud.kind === 'mag') {
      ud.mag.visible = true;
      ud.mag.position.copy(ud.magBase);
      ud.carry.mag.visible = false;
      if (ud.charger) {
        ud.chargerBase ||= ud.charger.position.clone();
        ud.charger.position.copy(ud.chargerBase);
        if (id === 'smg' || id === 'tommy') ud.charger.position.z += s.since < 0.05 ? 0.01 : 0;   // bolt jiggle
      }
      if (ud.support) { ud.support.visible = true; ud.support.position.copy(ud.supportBase); }
      // the shoe deals the next card forward out of its mouth
      if (ud.card) ud.card.position.z = ud.cardRest.z + 0.06 * (1 - smooth(clamp01(s.since / 0.16)));
      // the jubilee's pilot light breathes
      if (ud.pilot) ud.pilot.scale.setScalar(0.85 + Math.sin(performance.now() / 45) * 0.12 + Math.random() * 0.1);
      // LADY LUCK: the reels whirl after every shot and click to a stop, the
      // rings throb, the green zero pulses, the dice swing on their chain
      if (ud.reels) {
        s.reelV = (s.reelV || 0) * Math.exp(-dt * 3.5);
        ud.reels.forEach((r, i) => {
          r.userData.a = (r.userData.a || 0) + s.reelV * dt * (1 + i * 0.35);
          // settle on a symbol (8 per turn) once the spin runs down
          const step = Math.PI * 2 / 8;
          if (s.reelV < 0.5) r.userData.a += (Math.round(r.userData.a / step) * step - r.userData.a) * Math.min(1, dt * 10);
          r.rotation.z = r.userData.a;
        });
        const k = Math.max(0, 1 - s.since * 3);
        const now = performance.now() / 1000;
        ud.rings.forEach((r, i) => r.scale.setScalar(1 + k * 0.25 * (1 - i * 0.2) + Math.sin(now * 4 + i) * 0.03));
        ud.zero.scale.setScalar(1 + Math.sin(now * 3) * 0.12 + k * 0.5);
        ud.tip.scale.setScalar(1 + k * 1.2);
        ud.dice.rotation.x = Math.sin(now * 2.2) * 0.25 - this.sp.rx.x * 0.1;
        ud.dice.rotation.z = Math.sin(now * 1.7) * 0.2 + this.sp.rz.x * 0.1;
      }
    }
    if (ud.kind === 'break') {
      ud.hinge.rotation.x = 0;
      ud.rounds.visible = true;
      ud.rounds.position.z = 0;
      for (const c of Object.values(ud.carry)) c.visible = false;
      if (ud.support) { ud.support.visible = true; ud.support.position.copy(ud.supportBase); }
      if (ud.hammer) {
        const rec = Math.max(0.05, s.interval * 0.6);
        ud.hammer.rotation.x = s.since < 0.035 ? FIRED : lerp(FIRED, COCKED, smooth(clamp01((s.since - 0.035) / rec)));
      }
    }

    // ---------------------------- reload ----------------------------
    const R = this.reload;
    if (R && R.id === id) {
      const p = ctx.reloadP;
      R.p = p;
      const ev = (t, name) => { if (p >= t && !R.fired.has(t + name)) { R.fired.add(t + name); ctx.onEvent(name); } };
      const fn = { pistol: '_pistolReload', shotgun: '_shotgunReload', rifle: '_rifleReload' }[id]
        || (ud.kind === 'break' ? '_breakReload' : '_magReload');
      const pose = this[fn](p, ud, R, ev);
      gunPos = pose.pos; gunRot = pose.rot;
      if (p >= 1) this.reload = null;
    } else if (R && R.id !== id) {
      this.reload = null;
    }

    // ------------------------- melee + throw -------------------------
    if (this.meleeT >= 0) {
      this.meleeT += dt / 0.42;
      const m = this.meleeT;
      gunPos = addv(gunPos, track(m, [[0, Z3], [0.18, [0.06, 0.02, 0.05]], [0.4, [-0.2, -0.03, -0.13]], [0.62, [-0.12, -0.04, -0.06]], [1, Z3]]));
      gunRot = addv(gunRot, track(m, [[0, Z3], [0.18, [0.25, -0.55, -0.45]], [0.4, [0.12, 0.95, 0.75]], [0.62, [0.08, 0.6, 0.4]], [1, Z3]]));
      if (m >= 1) this.meleeT = -1;
    }
    let thr = -1;
    if (this.throwT >= 0) {
      this.throwT += dt / 0.55;
      const t = thr = Math.min(1, this.throwT);
      gunPos = addv(gunPos, track(t, [[0, Z3], [0.2, [0.05, -0.13, 0.05]], [0.7, [0.05, -0.13, 0.05]], [1, Z3]]));
      gunRot = addv(gunRot, track(t, [[0, Z3], [0.2, [-0.4, -0.3, -0.35]], [0.7, [-0.4, -0.3, -0.35]], [1, Z3]]));
      ud.fist.visible = true;
      if (ud.support) ud.support.visible = t < 0.05 || t > 0.9;
      ud.carry.chip.visible = inRange(t, 0.12, 0.47);
      if (!ud.fistRest && t > 0.9) ud.fist.visible = false;
      if (t >= 1) this.throwT = -1;
    }

    // --------------------- switch + sprint carry ---------------------
    const sw = ctx.switchProg > 0 ? Math.sin(ctx.switchProg * Math.PI) : 0;
    const k = this.sprint * (this.reload || this.meleeT >= 0 ? 0 : 1);
    const o = this.out;
    o.pos[0] = gunPos[0] + 0.02 * sw + 0.03 * k;
    o.pos[1] = gunPos[1] - 0.3 * sw - 0.06 * k - this.sp.y.x;
    o.pos[2] = gunPos[2] + this.sp.z.x * 0.075 + 0.05 * sw + 0.03 * k;
    o.rot[0] = gunRot[0] + this.sp.rx.x * 0.075 - 0.9 * sw - 0.35 * k;
    o.rot[1] = gunRot[1] + this.sp.ry.x * 0.05 + 0.25 * sw + 0.55 * k;
    o.rot[2] = gunRot[2] + this.sp.rz.x * 0.06 + 0.4 * sw + 0.4 * k;
    if (thr >= 0) this._throwHand(id, ud, thr, o);
    this._aimArm(id, ud, o);
    return o;
  }

  /** the throwing hand is keyed in view space — the gun drops away under it */
  _throwHand(id, ud, t, o) {
    const f = ud.fist, vm = this.models[id].parent, s = vm ? vm.scale.x : 1;
    _qg.setFromEuler(_e.set(o.rot[0], o.rot[1], o.rot[2]));
    const toView = (v) => {
      v.applyQuaternion(_qg).add(_tmp.fromArray(o.pos)).multiplyScalar(s);
      return vm ? v.applyQuaternion(vm.quaternion).add(vm.position) : v;
    };
    const fromView = (v) => {
      if (vm) v.sub(vm.position).applyQuaternion(_qi.copy(vm.quaternion).invert());
      return v.divideScalar(s).sub(_tmp.fromArray(o.pos)).applyQuaternion(_qi.copy(_qg).invert());
    };
    const rest = ud.fistRest ? toView(_h.copy(ud.fistRest)).toArray() : [-0.3, -0.5, -0.25];
    // drop below frame, rise to the wind-up by the cheek, snap forward, fall away
    const vp = track(t, [[0, rest], [0.12, [-0.24, -0.32, -0.3]], [0.3, [-0.11, -0.05, -0.27]],
      [0.48, [-0.03, 0.03, -0.56]], [0.66, [-0.2, -0.34, -0.4]], [0.9, rest], [1, rest]]);
    f.position.copy(fromView(_h.fromArray(vp)));
    const fr = track(t, [[0, Z3], [0.3, [0.7, 0.2, 0.3]], [0.48, [-0.6, 0, 0]], [0.8, Z3]]);
    _qf.setFromEuler(_e.set(fr[0], fr[1], fr[2])).premultiply(_qi.copy(_qg).invert());
    // guns whose hand rests on the gun ease between gun space and view space
    const w = ud.fistRest ? track(t, [[0, 0], [0.12, 1], [0.8, 1], [0.9, 0]]) : 1;
    f.quaternion.identity().slerp(_qf, w);
  }

  /** keep the left forearm coming from the lower left, whatever the gun is doing */
  _aimArm(id, ud, o) {
    const f = ud.fist;
    if (!f || !f.visible) return;
    const model = this.models[id], vm = model.parent;
    const s = vm ? vm.scale.x : 1;
    _qg.setFromEuler(_e.set(o.rot[0], o.rot[1], o.rot[2]));
    // hand position in view space
    _h.copy(f.position).applyQuaternion(_qg).add(_tmp.fromArray(o.pos)).multiplyScalar(s);
    if (vm) _h.applyQuaternion(vm.quaternion).add(vm.position);
    _goal.copy(SHOULDER).sub(_h).normalize();
    if (vm) _goal.applyQuaternion(_qi.copy(vm.quaternion).invert());   // back into the vm frame
    // forearm direction, same frame
    _qf.copy(f.quaternion);
    _d.copy(ARM_LOCAL).applyQuaternion(_qf).applyQuaternion(_qg);
    const ang = Math.acos(Math.max(-1, Math.min(1, _d.dot(_goal)))) - ARM_CONE;
    if (ang <= 0) return;
    _axis.crossVectors(_d, _goal);
    if (_axis.lengthSq() < 1e-8) return;
    _qk.setFromAxisAngle(_axis.normalize(), ang);
    // into the gun's frame: K = Qg^-1 * Kview * Qg
    _qi.copy(_qg).invert();
    _qk.premultiply(_qi).multiply(_qg);
    // pivot on the held item so it stays exactly where the choreography put it
    let item = null;
    for (const c of Object.values(ud.carry || {})) if (c.visible && c.parent === f) { item = c; break; }
    if (item) _piv.copy(item.position).applyQuaternion(_qf).add(f.position);
    else _piv.copy(f.position);
    f.position.sub(_piv).applyQuaternion(_qk).add(_piv);
    f.quaternion.premultiply(_qk);
    if (item) {
      // counter-rotate the item: Qf'^-1 * Qf * q
      this._nudged = item;
      this._nudgedQ = (this._nudgedQ || new THREE.Quaternion()).copy(item.quaternion);
      item.quaternion.premultiply(_qf).premultiply(_qi.copy(f.quaternion).invert());
    }
  }

  // --------------------------- reload choreography --------------------------
  /** revolver: tip, swing out, eject, speedloader, flick shut */
  _pistolReload(p, ud, R, ev) {
    ev(0.02, 'reload');
    ev(0.13, 'cyl_open');
    ev(0.28, 'casings');
    ev(0.57, 'shell_in');
    ev(0.76, 'cyl_close');
    ev(0.8, 'cyl_spin');
    ev(0.93, 'hammer');
    ud.crane.rotation.z = track(p, [[0.1, 0], [0.18, 1.25], [0.74, 1.25], [0.78, 0]]);
    ud.rounds.position.z = track(p, [[0.24, 0], [0.27, 0.035], [0.29, 0.035]]);
    ud.rounds.visible = p < 0.29 || p > 0.585;
    if (inRange(p, 0.78, 0.92)) ud.drum.rotation.z = this.st.pistol.drumAngle - (p - 0.78) * 60;
    // the left hand brings the speedloader to the open cylinder
    const f = ud.fist, sl = ud.carry.speedloader;
    f.visible = sl.visible = inRange(p, 0.33, 0.74);
    const off = [-0.2, -0.3, 0.22], near = [-0.042, -0.052, 0.075], seat = [-0.042, -0.052, 0.025];
    const fp = track(p, [[0.33, off], [0.48, near], [0.55, seat], [0.6, seat], [0.66, [-0.06, -0.08, 0.1]], [0.74, off]]);
    f.position.set(fp[0], fp[1], fp[2]);
    f.rotation.set(track(p, [[0.33, 0.5], [0.48, 0], [0.66, 0], [0.74, 0.5]]), 0, 0);
    sl.rotation.z = track(p, [[0.55, 0], [0.59, 0.6]]);
    sl.userData.rounds.visible = p < 0.59;
    return {
      pos: track(p, [[0, Z3], [0.12, [-0.09, 0.06, 0.05]], [0.3, [-0.09, 0.07, 0.05]], [0.38, [-0.08, 0.04, 0.05]], [0.7, [-0.08, 0.04, 0.05]], [0.8, [-0.04, 0.03, 0.02]], [1, Z3]]),
      rot: track(p, [[0, Z3], [0.12, [0.15, 0.35, -0.85]], [0.2, [0.15, 0.35, -0.85]], [0.27, [0.9, 0.3, -0.7]], [0.31, [0.9, 0.3, -0.7]], [0.4, [-0.3, 0.4, -0.75]], [0.7, [-0.3, 0.4, -0.75]], [0.76, [0.1, 0.1, 0.35]], [0.84, [0, 0, -0.06]], [1, Z3]]),
    };
  }

  /** shotgun: roll it over, feed shells into the port one at a time, rack */
  _shotgunReload(p, ud, R, ev) {
    const n = R.cycles, a = 0.12, b = 0.84;
    ev(0.02, 'reload');
    const f = ud.fist, shell = ud.carry.shell;
    const rest = ud.supportBase.toArray();
    const fetch = [-0.15, -0.24, 0.12];
    const port = ud.port, off = [0, 0.05, -0.012];
    const under = [port.x - off[0], port.y - off[1] - 0.035, port.z - off[2] + 0.04];
    const inside = [port.x - off[0], port.y - off[1] + 0.004, port.z - off[2] - 0.012];
    let fp = rest, showShell = false;
    if (p < a) fp = track(p, [[0.05, rest], [a, fetch]]);
    else if (p < b) {
      const q = ((p - a) / (b - a)) * n, i = Math.floor(q), c = q - i;
      fp = track(c, [[0, fetch], [0.4, under], [0.68, inside], [0.8, inside], [1, fetch]]);
      showShell = c > 0.06 && c < 0.7;
      ev(a + ((i + 0.7) / n) * (b - a), 'shell_in');
    } else fp = track(p, [[b, fetch], [0.9, rest]]);
    ud.support.visible = p < 0.06 || p > 0.9;
    f.visible = !ud.support.visible;
    f.position.set(fp[0], fp[1], fp[2]);
    f.rotation.set(0.25, 0, 0);
    shell.visible = f.visible && showShell;
    // rack it to finish
    ev(0.905, 'pump_back');
    ev(0.95, 'pump_fwd');
    const pz = track(p, [[0.9, 0], [0.935, 0.1], [0.975, 0]]);
    ud.pump.position.z = -0.32 + pz;
    ud.support.position.z = ud.supportBase.z + pz;
    return {
      pos: track(p, [[0, Z3], [0.1, [-0.07, 0.05, 0.03]], [0.84, [-0.07, 0.05, 0.03]], [0.9, [-0.02, 0.01, 0.01]], [1, Z3]]),
      rot: track(p, [[0, Z3], [0.1, [0.2, 0.28, -0.7]], [0.84, [0.2, 0.28, -0.7]], [0.9, [0.08, 0.05, -0.1]], [0.94, [0.12, 0, 0]], [1, Z3]]),
    };
  }

  /**
   * any box-magazine gun (SMG, the tommy's drum, the shoe's deck, the
   * jubilee's fuel tank): dump the old one, fetch a fresh one off the belt,
   * seat it, slap it home, then work the charger if the gun has one
   */
  _magReload(p, ud, R, ev) {
    ev(0.02, 'reload');
    ev(0.22, 'mag_out');
    ev(0.235, 'magdrop');
    ev(0.59, 'mag_in');
    const charger = ud.charger;
    if (charger) ev(0.735, ud.chargeSfx || 'bolt');
    const f = ud.fist;
    // guns whose left hand lives elsewhere bring the fist in from off-screen
    const onGun = !!ud.fistRest;
    const rest = onGun ? ud.fistRest.toArray() : [-0.2, -0.36, 0.2];
    if (!onGun) {
      ud.support.visible = p < 0.09 || p > 0.9;
      f.visible = !ud.support.visible;
    }
    // the old mag slides out and drops away (weapons.js spawns the falling copy)
    ud.mag.position.copy(ud.magBase).addScaledVector(ud.magDrop, track(p, [[0.2, 0], [0.235, 1], [0.58, 0.66], [0.61, 0]]));
    ud.mag.visible = p < 0.235 || p >= 0.58;
    const b = ud.magBase, o = ud.handMagOffset;
    const well = [b.x - o.x, b.y - o.y, b.z - o.z];
    const grab = [well[0], well[1] + 0.095, well[2] - 0.046];
    const belt = [-0.16, -0.42, 0.1];
    const keys = [[0.12, rest], [0.2, grab], [0.27, belt], [0.42, belt],
      [0.54, [well[0], well[1] - 0.05, well[2] + 0.02]], [0.58, well], [0.6, well], [0.62, [well[0], well[1] + 0.02, well[2]]]];
    const roll = ud.chargerRoll ?? (charger && Math.abs(ud.chargerAxis.z) > 0 && ud.chargerGrab.y < 0 ? 0.9 : 0);
    if (charger) {
      const cp = ud.chargerBase.clone().add(ud.chargerGrab);
      const cq = cp.clone().add(ud.chargerAxis);
      keys.push([0.67, [cp.x - 0.01, cp.y - 0.06, cp.z]], [0.71, cp.toArray()], [0.74, cq.toArray()], [0.77, cp.toArray()], [0.88, rest], [1, rest]);
      charger.position.copy(ud.chargerBase).addScaledVector(ud.chargerAxis, track(p, [[0.71, 0], [0.74, 1], [0.765, 0]]));
    } else {
      keys.push([0.76, rest], [1, rest]);
    }
    const fp = track(p, keys);
    f.position.set(fp[0], fp[1], fp[2]);
    f.rotation.set(track(p, [[0.12, 0], [0.27, 0.6], [0.5, 0.12], [0.62, 0.12], [0.7, -0.3], [0.8, -0.3], [0.9, 0]]), 0,
      track(p, [[0.62, 0], [0.7, roll], [0.8, roll], [0.9, 0]]));
    ud.carry.mag.visible = inRange(p, 0.3, 0.58);
    const done = charger ? 0.85 : 0.72;
    return {
      pos: track(p, [[0, Z3], [0.12, [-0.05, 0.05, 0.03]], [0.6, [-0.05, 0.05, 0.03]], [0.62, [-0.05, 0.065, 0.03]], [0.66, [-0.05, 0.05, 0.03]], [done, [-0.04, 0.04, 0.02]], [1, Z3]]),
      rot: track(p, [[0, Z3], [0.12, [0.18, 0.2, -0.45]], [0.58, [0.18, 0.2, -0.45]], [0.62, [0.28, 0.2, -0.4]], [0.66, [0.2, 0.2, -0.45]],
        ...(charger ? [[0.7, [0.05, -0.12, roll ? 0.35 : -0.1]], [0.85, [0.05, -0.12, roll ? 0.35 : -0.1]]] : []), [1, Z3]]),
    };
  }

  /** hinge point (hinge-local) -> gun space, at a given opening angle */
  _hingePoint(ud, v, angle, out) {
    return out.copy(v).applyEuler(_eu.set(angle, 0, 0)).add(ud.hinge.position);
  }

  /**
   * break-actions (derringer, Magnum, Whale): the barrels drop open, the empties
   * kick out, the left hand seats fresh rounds straight down the bores, and the
   * gun snaps shut with a flick
   */
  _breakReload(p, ud, R, ev) {
    ev(0.02, 'reload');
    ev(0.13, 'break_open');
    if (ud.casings) ev(0.25, 'casings');
    ev(0.57, 'shell_in');
    ev(0.8, 'break_close');
    const A = ud.openAngle;
    const open = track(p, [[0.1, 0], [0.18, A], [0.76, A], [0.8, 0]]);
    ud.hinge.rotation.x = open;
    ud.rounds.visible = p < 0.25 || p > 0.585;
    ud.rounds.position.z = p < 0.25 ? track(p, [[0.2, 0], [0.24, 0.025]]) : 0;
    if (ud.support) ud.support.visible = p < 0.1 || p > 0.86;
    const f = ud.fist;
    const carry = ud.carry.rounds || ud.carry.shell;
    f.visible = inRange(p, 0.3, 0.74);
    carry.visible = f.visible && p < 0.585;
    // aim the carried rounds straight down the (open) bores
    const ch = _v1.set(0, 0, 0);
    for (const c of ud.chambers) ch.add(c);
    ch.multiplyScalar(1 / ud.chambers.length);
    const fistAt = (dy, dz) => {
      const tgt = this._hingePoint(ud, _v2.copy(ch).add({ x: 0, y: dy, z: dz }), A, new THREE.Vector3());
      const off = carry.position.clone().applyEuler(_eu.set(A, 0, 0));
      return tgt.sub(off).toArray();
    };
    const off = [-0.2, -0.32, 0.22];
    const near = fistAt(0.03, 0.08), seat = fistAt(0, 0.012), back = fistAt(0.035, 0.09);
    const fp = track(p, [[0.3, off], [0.46, near], [0.54, seat], [0.6, seat], [0.66, back], [0.74, off]]);
    f.position.set(fp[0], fp[1], fp[2]);
    f.rotation.set(track(p, [[0.3, 0.4], [0.46, A], [0.66, A], [0.74, 0.4]]), 0, 0);
    return {
      pos: track(p, [[0, Z3], [0.12, [-0.07, 0.05, 0.04]], [0.76, [-0.07, 0.05, 0.04]], [0.8, [-0.06, 0.075, 0.03]], [0.88, [-0.03, 0.02, 0.01]], [1, Z3]]),
      rot: track(p, [[0, Z3], [0.12, [0.25, 0.3, -0.45]], [0.2, [-0.1, 0.35, -0.5]], [0.76, [-0.1, 0.35, -0.5]], [0.8, [0.22, 0.2, -0.3]], [0.88, [0.02, 0, -0.05]], [1, Z3]]),
    };
  }

  /** lever rifle: roll the gate up, feed cartridges, work the lever */
  _rifleReload(p, ud, R, ev) {
    const n = R.cycles, a = 0.14, b = 0.78;
    ev(0.02, 'reload');
    const f = ud.fist, cart = ud.carry.cartridge;
    const rest = ud.supportBase.toArray();
    const fetch = [0.14, -0.26, 0.12];
    const gate = ud.gate, off = [0, 0.05, -0.014];
    const near = [gate.x - off[0] + 0.01, gate.y - off[1] - 0.012, gate.z - off[2] + 0.05];
    const inside = [gate.x - off[0] + 0.004, gate.y - off[1] - 0.004, gate.z - off[2] - 0.004];
    let fp = rest, show = false;
    if (p < a) fp = track(p, [[0.06, rest], [a, fetch]]);
    else if (p < b) {
      const q = ((p - a) / (b - a)) * n, i = Math.floor(q), c = q - i;
      fp = track(c, [[0, fetch], [0.42, near], [0.7, inside], [0.8, inside], [1, fetch]]);
      show = c > 0.06 && c < 0.7;
      ev(a + ((i + 0.7) / n) * (b - a), 'shell_in');
    } else fp = track(p, [[b, fetch], [0.84, rest]]);
    ud.support.visible = p < 0.07 || p > 0.84;
    f.visible = !ud.support.visible;
    f.position.set(fp[0], fp[1], fp[2]);
    f.rotation.set(0.2, -0.4, -0.3);
    cart.visible = f.visible && show;
    ev(0.865, 'lever');
    ud.lever.rotation.x = track(p, [[0.86, 0], [0.9, 1.1], [0.96, 0]]);
    return {
      pos: track(p, [[0, Z3], [0.12, [-0.07, 0.05, 0.04]], [0.8, [-0.07, 0.05, 0.04]], [0.86, [0, 0, 0]], [0.9, [0, -0.01, 0.01]], [1, Z3]]),
      rot: track(p, [[0, Z3], [0.12, [0.12, -0.2, 0.6]], [0.8, [0.12, -0.2, 0.6]], [0.86, [0.02, 0, 0]], [0.9, [-0.06, 0, 0.08]], [1, Z3]]),
    };
  }
}

function addv(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
