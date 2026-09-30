// net.js — co-op with a friend over the internet, by room code.
//
// PeerJS (vendor/peerjs.min.js) introduces the two games through its free
// public matchmaking server, then they talk directly (WebRTC; PeerJS's relay
// servers step in when a home network won't allow a direct line).
//
// The HOST runs the real house: the horde, the bosses, the rounds, the drops.
// The GUEST runs their own gambler (movement, guns, gear, shop, perks) and sees
// the horde as PUPPETS — the same rigged characters, moved by the host's
// snapshots 20 times a second. Everything the guest does TO the horde (shots,
// blasts, stuns, slips, fire) is sent to the host and applied there. Kills pay
// whoever landed the killing blow; doors are shared; each has their own chips,
// shop, cocktails, LADY LUCK and ALL IN. Down in co-op means bleeding out for
// 30 seconds — your partner holds E on you to deal you back in.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Audio } from './audio.js';
import { Character } from './chars/character.js';
import { buildWorldGun } from './gfx/viewmodels.js';
import { GUNFX } from './weapons.js';
import { STYLE } from './gfx/style.js';
import { randomSeed } from './rng.js';

const PROTO = 1;
const PREFIX = 'hotu-coop-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';    // no I/L/O/0/1 to misread
const SEND_DT = 1 / 20;
const REVIVE_TIME = 3;
export const BLEED_TIME = 30;
const $ = (id) => document.getElementById(id);
const r2 = (v) => Math.round(v * 100) / 100;

// ============================ the partner, as the AI sees them =============
class RemotePlayer {
  constructor(game) {
    this.game = game;
    this.isRemote = true;
    this.reset();
  }
  reset() {
    this.pos = new THREE.Vector3(1.6, CONFIG.player.eyeHeight, 8);
    this.yaw = Math.PI; this.pitch = 0;
    this.onGround = true;
    this.hp = 100; this.maxHp = 100;
    this.down = false; this.bled = false;
    this.gun = 'shotgun'; this.packed = false;
    this.shots = 0;
    this.seen = false;
  }
  get alive() { return this.seen && !this.down && !this.bled; }
  get nav() { return this.game.arena.nav2; }
  forwardFlat() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  /** the host's horde hurts the partner: tell their game */
  takeDamage(amount, source = null, blast = false) {
    const g = this.game;
    if (!this.alive || g.state === 'SUMMARY') return false;
    const at = source?.mesh?.position;
    g.net.send({ t: 'hurt', d: r2(amount), n: source?.def?.name || null, x: at ? r2(at.x) : null, z: at ? r2(at.z) : null, b: blast ? 1 : 0 });
    return true;
  }
}

// ============================ the partner's body ===========================
class Avatar {
  constructor(game, look) {
    this.game = game;
    this.char = new Character(look, {});
    this.root = this.char.root;
    game.scene.add(this.root);
    this.target = new THREE.Vector3(1.6, 0, 8);
    this.root.position.copy(this.target);
    this.yaw = Math.PI; this.pitch = 0;
    this.speed = 0;
    this.gunId = null; this.gun = null;
    this.down = false; this.bled = false; this.hp = 100; this.maxHp = 100;
    // a name tag you can see through walls, with their health under it
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 72;
    this.tagCv = cv;
    this.tagTex = new THREE.CanvasTexture(cv);
    this.tagTex.colorSpace = THREE.SRGBColorSpace;
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tagTex, depthTest: false, depthWrite: false, transparent: true }));
    this.tag.scale.set(0.95, 0.27, 1);
    this.tag.position.y = 2.35;
    this.tag.renderOrder = 999;
    this.root.add(this.tag);
    this._tagKey = '';
    this._drawTag();
  }

  setGun(id, packed) {
    const key = id + (packed ? '*' : '');
    if (key === this.gunId) return;
    this.gunId = key;
    if (this.gun) { this.gun.parent?.remove(this.gun); this.gun = null; }
    if (!id) return;
    try {
      const m = buildWorldGun(id);
      if (packed) m.traverse((o) => { if (o.isMesh && o.material?.color) { o.material = o.material.clone(); o.material.color.lerp(new THREE.Color(0xe8b84a), 0.7); } });
      m.scale.setScalar(0.95);
      m.rotation.set(0, Math.PI / 2, 0);
      m.position.set(0.02, -0.04, 0.06);
      this.char.bones.handR.add(m);
      this.gun = m;
    } catch { /* a gun with no world model: empty hands */ }
  }

  _drawTag() {
    const key = `${Math.round(this.hp)}|${this.down}|${this.bled}`;
    if (key === this._tagKey) return;
    this._tagKey = key;
    const c = this.tagCv.getContext('2d');
    c.clearRect(0, 0, 256, 72);
    c.font = 'bold 30px Bahnschrift, "Segoe UI", sans-serif';
    c.textAlign = 'center';
    c.lineWidth = 6; c.strokeStyle = 'rgba(0,0,0,0.85)';
    const label = this.bled ? 'PARTNER — OUT' : this.down ? 'PARTNER — DOWN!' : 'PARTNER';
    c.strokeText(label, 128, 30);
    c.fillStyle = this.down || this.bled ? '#ff5a6a' : '#7ae8ff';
    c.fillText(label, 128, 30);
    c.fillStyle = 'rgba(0,0,0,0.7)'; c.fillRect(38, 44, 180, 14);
    c.fillStyle = this.down ? '#ff3a4a' : '#5dff9a';
    c.fillRect(40, 46, 176 * Math.max(0, Math.min(1, this.hp / this.maxHp)), 10);
    this.tagTex.needsUpdate = true;
  }

  update(dt) {
    const prev = this.root.position.clone();
    this.root.position.lerp(this.target, Math.min(1, dt * 14));
    const v = prev.distanceTo(this.root.position) / Math.max(dt, 1e-4);
    this.speed += (Math.min(v, 9) - this.speed) * Math.min(1, dt * 8);
    let want = this.yaw + Math.PI;
    let d = want - this.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.root.rotation.y += d * Math.min(1, dt * 16);
    const floored = this.down || this.bled;
    // down: flat on the carpet
    this.root.rotation.z += ((floored ? 1.45 : 0) - this.root.rotation.z) * Math.min(1, dt * 6);
    this.root.position.y = floored ? 0.28 : this.root.position.y;
    this.char.update(dt, floored ? 0 : this.speed);
    // aim the gun where they're looking (after the gait has posed the body)
    if (!floored) {
      const B = this.char.bones;
      B.upperArmR.rotation.set(-1.42 - this.pitch, 0.12, 0.05);
      B.foreArmR.rotation.set(-0.08, 0, 0);
      B.upperArmL.rotation.set(-1.25 - this.pitch, -0.45, -0.1);
      B.foreArmL.rotation.set(-0.45, 0, 0);
    }
    this._drawTag();
  }

  muzzle() {
    const p = new THREE.Vector3();
    (this.gun || this.char.bones.handR).getWorldPosition(p);
    return p;
  }

  dispose() {
    this.game.scene.remove(this.root);
    this.char.dispose();
    this.tagTex.dispose();
  }
}

// ======================== the host's zombies, on the guest =================
class Puppet {
  constructor(game, a) {
    const [id, kind, variant, elite, sc, x, z, ry, hp, maxHp, fl] = a;
    this.game = game;
    this.nid = id;
    this.kind = kind;
    this.isPuppet = true;
    this.elite = !!elite;
    this.def = { name: kind === 'king' ? 'THE KING' : kind === 'collector' ? 'THE DEBT COLLECTOR' : kind.toUpperCase(), ...CONFIG.enemies[kind] };
    this.char = new Character(kind, { variant, elite: this.elite, hitRef: this });
    this.mesh = this.char.root;
    this.mesh.scale.setScalar(sc);
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = ry;
    this.parts = this.char.hitboxes;
    this.target = new THREE.Vector3(x, 0, z);
    this.ry = ry;
    this.hp = hp; this.maxHp = maxHp;
    this.flags = fl;
    this.fx = { slowT: 0, stunT: 0, slipT: 0, slipCd: 0, burnT: 0, hypeT: 0, slowMult: 1 };
    this.dead = false;
    this.hitFlash = 0;
    this.animSpeed = 0;
    this._prev = new THREE.Vector3(x, 0, z);
    if (fl & 1) this.char.rise(0.75);
    game.scene.add(this.mesh);
  }
  get disabled() { return false; }

  /** our shot landed: tell the host, and show it right away */
  takeDamage(dmg, strong, point, cause = 'hit', isHead = false) {
    if (this.dead) return;
    const g = this.game;
    g.net.send({ t: 'hit', id: this.nid, d: r2(dmg), s: strong ? 1 : 0, c: cause, h: isHead ? 1 : 0 });
    let felt = dmg;
    if (this.kind === 'pitguard' && !isHead) felt *= (1 - this.def.bodyResist);
    this.hitFlash = 0.08;
    this.char.flinch(strong ? 0.9 : 0.5);
    this._noFlinch = 0.15;
    this.lastCause = cause;
    this._lastHitHead = isHead;
    if (point) g.ui.floatText(point, Math.round(felt), strong ? 'dmg crit' : 'dmg');
    this.hp -= felt;
    if (this.hp <= 0) g.net.predictDeath(this);      // don't wait a round-trip to see them drop
  }
  // our tacticals and lethals on the host's zombies
  slow(mult, t) { this.game.net.send({ t: 'zfx', id: this.nid, f: 'slow', a: [mult, t] }); this.fx.slowT = t; }
  stun(t) { this.game.net.send({ t: 'zfx', id: this.nid, f: 'stun', a: [t] }); this.char.daze(t); }
  slip(t = 2.2) { this.game.net.send({ t: 'zfx', id: this.nid, f: 'slip', a: [t] }); return true; }
  ignite(dps, t) { this.game.net.send({ t: 'zfx', id: this.nid, f: 'ignite', a: [dps, t] }); this.fx.burnT = t; }
  knockback(dir, force) { this.game.net.send({ t: 'zfx', id: this.nid, f: 'knock', a: [r2(dir.x), r2(dir.z), force] }); }

  /** a host-side animation happened: play it here too */
  event(fn, a) {
    const c = this.char;
    if (fn === 'attack') c.attack(...a);
    else if (fn === 'slip') c.slip(...a);
    else if (fn === 'daze') c.daze(...a);
    else if (fn === 'rise') c.rise(...a);
    else if (fn === 'flinch' && !(this._noFlinch > 0)) c.flinch(...a);
    else if (fn === 'die') this.game.net.puppetDie(this, a[0], a[1]);
  }

  update(dt) {
    if (this.dead) return;
    this._noFlinch = (this._noFlinch || 0) - dt;
    this.mesh.position.lerp(this.target, Math.min(1, dt * 12));
    let d = this.ry - this.mesh.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.mesh.rotation.y += d * Math.min(1, dt * 12);
    const moved = this._prev.distanceTo(this.mesh.position) / Math.max(dt, 1e-4);
    this._prev.copy(this.mesh.position);
    this.animSpeed += (Math.min(moved, 12) - this.animSpeed) * Math.min(1, dt * 8);
    this.char.update(dt, this.animSpeed / this.mesh.scale.y);
    const g = this.game;
    if (this.hitFlash > 0) { this.hitFlash -= dt; this.char.setFlash(STYLE.cartoon ? 0.45 : 0.9, 0xffd8b0); }
    else if (this.flags & 16) this.char.setFlash(0.32 + 0.14 * Math.sin(performance.now() / 110), 0xffd24a);
    else if (this.flags & 8) this.char.setFlash(0.25 + 0.25 * Math.sin(performance.now() / (g.settings.reducedFlash ? 400 : 120)), 0x9dff4a);
    else if (this.flags & 4) this.char.setFlash(0.18 + 0.12 * Math.sin(performance.now() / 90), 0xff4aa0);
    else this.char.setFlash(0);
    if ((this.flags & 2) && Math.random() < 0.4) g.effects.spawnFire(this.mesh.position.clone().setY(0.4 + Math.random() * 1.3 * this.mesh.scale.y), 0.7);
  }
}

class BossPuppet extends Puppet {
  constructor(game, a) {
    // [id, kind, scale, x, z, ry, hp, maxHp, flags, name]
    const [id, kind, sc, x, z, ry, hp, maxHp, fl, name] = a;
    super(game, [id, kind, 0, 0, sc, x, z, ry, hp, maxHp, 0]);
    this.name = name;
    this.def = { name, scale: 2 };
    this.isBoss = true;
    this.flags = fl;
  }
  takeDamage(dmg, strong, point) {
    if (this.dead) return;
    const g = this.game;
    g.net.send({ t: 'hit', id: this.nid, d: r2(dmg), s: strong ? 1 : 0, c: 'hit', h: 0 });
    this.hitFlash = 0.08;
    this.char.flinch(0.25);
    this._noFlinch = 0.15;
    if (point) g.ui.floatText(point, Math.round(dmg * (this.flags & 1 ? 2 : 1)), strong ? 'dmg crit' : 'dmg');
  }
  slow() {} stun() {} slip() { return false; } ignite() {} knockback() {}
  update(dt) {
    super.update(dt);
    if (!this.dead && !(this.hitFlash > 0)) this.char.setGlow(this.flags & 1 ? 5 + 3 * Math.sin(performance.now() / 100) : 0);
  }
}

// ================================== Net =====================================
export class Net {
  constructor(game) {
    this.game = game;
    this.role = null;           // 'host' | 'guest'
    this.peer = null;
    this.conn = null;
    this.code = null;
    this.connected = false;
    this.inRun = false;
    this.nextId = 1;
    this.remote = new RemotePlayer(game);
    this.avatar = null;
    this.events = [];
    this.sendT = 0;
    this.puppets = new Map();
    this.bossPuppets = new Map();
    this.recentDead = new Map();
    this.remoteRemaining = 0;
    this.pickMeshes = new Map();
    this.projMeshes = [];
    this.guestReady = false; this.hostReady = false;
    this.reviveT = 0;
    this.partnerShots = 0;
    this.ping = 0;            // round trip to your partner, ms (0 alone)
    this._pingT = 0;
  }

  get active() { return this.connected && !!this.role; }
  get isHost() { return this.active && this.role === 'host'; }
  get isGuest() { return this.active && this.role === 'guest'; }

  // --------------------------------- lobby -----------------------------------
  _status(text, cls = '') {
    const el = $('coop-status');
    if (el) { el.textContent = text; el.className = cls; }
  }

  _newPeer(id) {
    if (!window.Peer) { this._status('Co-op is missing its network library (vendor/peerjs.min.js).', 'bad'); return null; }
    return new window.Peer(id, { debug: 0 });
  }

  host() {
    this.leave(true);
    this.role = 'host';
    this.code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    this._status('Opening a table…');
    const peer = this.peer = this._newPeer(PREFIX + this.code.toLowerCase());
    if (!peer) return;
    peer.on('open', () => {
      $('coop-code').textContent = this.code;
      $('coop-code-wrap').classList.remove('hidden');
      this._status('Send your friend this code. Waiting for them to sit down…');
    });
    peer.on('connection', (conn) => {
      if (this.conn) { conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); }); return; }
      this._wire(conn);
    });
    peer.on('error', (e) => this._peerError(e));
  }

  join(code) {
    code = (code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) { this._status('Type the room code your friend sent you.', 'bad'); return; }
    this.leave(true);
    this.role = 'guest';
    this.code = code;
    this._status(`Looking for table ${code}…`);
    const peer = this.peer = this._newPeer(undefined);
    if (!peer) return;
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code.toLowerCase(), { serialization: 'json', reliable: true });
      this._wire(conn);
      setTimeout(() => { if (!this.connected && this.role === 'guest') this._status('Still knocking… check the code, and that your friend is on the co-op screen.', 'bad'); }, 9000);
    });
    peer.on('error', (e) => this._peerError(e));
  }

  _peerError(e) {
    const t = e?.type;
    if (t === 'unavailable-id' && this.role === 'host') { this.host(); return; }        // code taken: deal a new one
    if (t === 'peer-unavailable') this._status('No table with that code. Check it and try again.', 'bad');
    else if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') this._status("Can't reach the matchmaking server — check your internet connection.", 'bad');
    else if (t === 'browser-incompatible') this._status('This browser can’t do co-op (no WebRTC). Try Edge or Chrome.', 'bad');
    else this._status(`Connection trouble (${t || 'unknown'}). Try again.`, 'bad');
    if (!this.connected) { this.peer?.destroy(); this.peer = null; this.role = null; }
  }

  _wire(conn) {
    this.conn = conn;
    conn.on('open', () => {
      this.connected = true;
      this.send({ t: 'hello', v: PROTO });
      if (this.role === 'host') {
        this._status('Your friend is at the table!', 'good');
        $('btn-coop-start').classList.remove('hidden');
      } else this._status('Seated! Waiting for the host to deal you in…', 'good');
      Audio.play('chip');
    });
    conn.on('data', (m) => { try { this._onMsg(m); } catch (err) { console.error('[net]', err); } });
    conn.on('close', () => this._lost());
    conn.on('error', () => this._lost());
  }

  send(m) {
    if (this.conn && this.conn.open) { try { this.conn.send(m); } catch { /* closing */ } }
  }

  /** walk away from the table */
  leave(quiet = false) {
    const had = this.connected;
    this.connected = false;
    this.inRun = false;
    try { this.conn?.close(); } catch { /* gone */ }
    try { this.peer?.destroy(); } catch { /* gone */ }
    this.conn = null; this.peer = null; this.role = null;
    this.ping = 0;
    this._clearWorld();
    if (!quiet && had) this._status('Left the table.');
    $('btn-coop-start')?.classList.add('hidden');
    $('coop-code-wrap')?.classList.add('hidden');
    $('coop-hud')?.classList.add('hidden');
    $('coop-down')?.classList.add('hidden');
  }

  _lost() {
    if (!this.connected) return;
    const g = this.game;
    const wasGuest = this.role === 'guest';
    const midRun = this.inRun;
    this.leave(true);
    this._status('Your friend left the table.', 'bad');
    if (!midRun) return;
    // the host plays on alone — unless they were lying on the carpet waiting for a hand
    if (!wasGuest && !g.player.alive) { g.onPlayerDeath(this.downCause || 'the horde'); return; }
    g.ui.banner(wasGuest ? 'THE HOST LEFT — THE TABLE IS CLOSED' : 'YOUR PARTNER LEFT THE TABLE — YOU PLAY ON ALONE', 'red', 4000);
    if (wasGuest) setTimeout(() => g.backToMenu?.(), 2500);
    else if (g.state === 'INTERMISSION' && this.hostReady) g.casino.startNextRound();
  }

  // --------------------------------- runs ------------------------------------
  /** host: deal both of you in */
  startRun() {
    if (!this.isHost) return;
    const seed = this.game.coatCheck.seed() || randomSeed();   // both of you get the host's deal
    this.send({ t: 'start', seed });
    this.game.coopNewRun(seed);
  }

  /** both sides, at the start of a co-op run */
  resetRun() {
    this.inRun = true;
    this._clearWorld();
    this.remote.reset();
    this.avatar = new Avatar(this.game, this.role === 'host' ? 'gambler2' : 'gambler');
    this.events = [];
    this.guestReady = false; this.hostReady = false;
    this.reviveT = 0;
    this.partnerShots = 0;
    $('coop-hud').classList.remove('hidden');
  }

  _clearWorld() {
    const g = this.game;
    for (const p of this.puppets.values()) { g.scene.remove(p.mesh); p.char.dispose(); }
    for (const p of this.bossPuppets.values()) { g.scene.remove(p.mesh); p.char.dispose(); }
    this.puppets.clear(); this.bossPuppets.clear(); this.recentDead.clear();
    if (this.role === 'guest' || !this.role) {
      g.enemies.list = g.enemies.list.filter((z) => !z.isPuppet);
      g.bosses = g.bosses.filter((b) => !b.isPuppet);
    }
    for (const m of this.pickMeshes.values()) g.pickups._remove({ mesh: m });
    this.pickMeshes.clear();
    for (const m of this.projMeshes) g.scene.remove(m);
    this.projMeshes = [];
    if (this.avatar) { this.avatar.dispose(); this.avatar = null; }
  }

  /** guest: a new round — clear what's left of the last one */
  clearPuppets() {
    const g = this.game;
    for (const p of this.puppets.values()) { g.scene.remove(p.mesh); p.char.dispose(); }
    for (const p of this.bossPuppets.values()) { g.scene.remove(p.mesh); p.char.dispose(); }
    this.puppets.clear(); this.bossPuppets.clear(); this.recentDead.clear();
    g.enemies.list = [];
    g.bosses = [];
  }

  // ----------------------------- host hooks ----------------------------------
  /** host: every anim a zombie plays is mirrored on the guest's puppet */
  hookChar(o) {
    const c = o.char;
    for (const fn of ['attack', 'slip', 'daze', 'die', 'rise', 'flinch']) {
      const orig = c[fn].bind(c);
      c[fn] = (...a) => { if (this.isHost) this.events.push([o.nid, fn, ...a]); return orig(...a); };
    }
  }

  /** host: who gets paid for this kill */
  creditKill(z, amt) {
    const g = this.game;
    if (this.isHost && z.lastHitBy === 'guest') {
      this.send({ t: 'credit', a: amt, x: r2(z.mesh.position.x), z: r2(z.mesh.position.z), k: z.kind, c: z.lastCause || 'hit' });
    } else g.awardChips(amt, z.mesh.position);
  }

  sendBoom(pos, radius, hostile) {
    if (this.active) this.send({ t: 'boom', x: r2(pos.x), y: r2(pos.y), z: r2(pos.z), r: radius, h: hostile ? 1 : 0 });
  }

  // --------------------------- intermission sync -----------------------------
  /** casino.startNextRound asks: may we go? (co-op waits for both gamblers) */
  readyToGo(casino) {
    const g = this.game;
    if (this.isGuest) {
      if (!this.guestReadySent) { this.guestReadySent = true; this.send({ t: 'ready' }); }
      casino.timerRunning = false;
      g.ui.hideAllPanels();
      g.ui.prompt('Waiting for your partner to finish at the tables…', 600000);
      return false;
    }
    this.hostReady = true;
    if (this.guestReady || casino.timer <= 0) { this.hostReady = false; this.guestReady = false; return true; }
    g.ui.hideAllPanels();
    g.ui.prompt(`Waiting for your partner… (the doors open anyway in ${Math.max(0, Math.ceil(casino.timer))}s)`, 600000);
    return false;
  }

  // ------------------------------ down + revive ------------------------------
  /** co-op: the local player hit zero */
  goDown(cause) {
    const g = this.game, p = g.player;
    if (p.downed || p.bledOut) return;
    p.downed = true;
    p.downT = BLEED_TIME;
    p.hp = 0;
    this.downCause = cause;
    g.weapons.reloading = false;
    Audio.play('boss_phase');
    g.ui.banner("YOU'RE DOWN — YOUR PARTNER CAN DEAL YOU BACK IN", 'red', 3000);
    this._sendState();
  }

  /** your partner picked you up */
  _revived() {
    const g = this.game, p = g.player;
    if (!p.downed) return;
    p.downed = false;
    p.hp = Math.round(p.maxHp * 0.5);
    p.iFrames = 2;
    g.ui.banner('BACK ON YOUR FEET', 'green', 1800);
    Audio.play('revive');
    this._sendState();
  }

  /** the round's over: anyone down or out comes back */
  roundRevive() {
    const p = this.game.player;
    if (p.downed || p.bledOut) {
      p.downed = false; p.bledOut = false;
      p.hp = Math.round(p.maxHp * 0.5);
    }
  }

  /** host: is everybody down? */
  wiped() {
    const p = this.game.player;
    return !p.alive && !this.remote.alive && this.remote.seen;
  }

  // --------------------------------- ticking ---------------------------------
  update(dt) {
    // ping: once a second, stamp a message and time it coming back
    if (this.connected) {
      this._pingT -= dt;
      if (this._pingT <= 0) { this._pingT = 1; this.send({ t: 'pi', ts: performance.now() }); }
    }
    if (!this.active || !this.inRun) return;
    const g = this.game;
    const inPlay = g.state === 'COMBAT' || g.state === 'COUNTDOWN' || (g.state === 'PAUSED' && (g._stateBeforePause === 'COMBAT' || g._stateBeforePause === 'COUNTDOWN'));
    // bleeding out
    const p = g.player;
    if (p.downed && inPlay) {
      p.downT -= dt;
      if (p.downT <= 0) {
        p.downed = false; p.bledOut = true;
        g.ui.banner('YOU BLED OUT — BACK NEXT ROUND IF YOUR PARTNER HOLDS ON', 'red', 3500);
        this._sendState();
      }
    }
    // reviving the partner: stand over them and hold E
    const av = this.avatar;
    if (av && av.down && p.alive && inPlay && g.state !== 'PAUSED') {
      const d = Math.hypot(av.root.position.x - p.pos.x, av.root.position.z - p.pos.z);
      if (d < 2.2) {
        if (p.keys['KeyE']) {
          this.reviveT += dt * (g.perkFx?.reload ? 1 / g.perkFx.reload : 1);
          if (this.reviveT >= REVIVE_TIME) { this.reviveT = 0; this.send({ t: 'revive' }); Audio.play('revive'); g.ui.banner('YOU DEALT YOUR PARTNER BACK IN', 'green', 1800); g.progress?.bump('revives'); g.progress?.gainXp(15, 'Teamwork'); }
        } else this.reviveT = 0;
        g.ui.interactPrompt({ title: this.reviveT > 0 ? `REVIVING… ${Math.round(this.reviveT / REVIVE_TIME * 100)}%` : 'REVIVE YOUR PARTNER', sub: 'Hold E', cost: null, action: 'HOLD', icon: '✚', color: '#5dff9a' });
      } else this.reviveT = 0;
    } else this.reviveT = 0;

    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = SEND_DT;
      this._sendState();
      if (this.isHost) this.send(this._snapshot());
    }
    if (av) {
      av.update(dt);
      av.hp = this.remote.hp; av.maxHp = this.remote.maxHp;
    }
    if (this.isGuest) this._animateRemote(dt);
    this._hud();
  }

  _sendState() {
    const g = this.game, p = g.player, w = g.weapons.current;
    this.send({
      t: 'ps', x: r2(p.pos.x), y: r2(p.pos.y), z: r2(p.pos.z), yaw: r2(p.yaw), pitch: r2(p.pitch),
      gun: g.weapons.currentId, pk: w?.packed ? 1 : 0, hp: Math.round(p.hp), mhp: p.maxHp,
      dn: p.downed ? 1 : 0, bo: p.bledOut ? 1 : 0, dt: Math.ceil(p.downT || 0), sh: g.weapons.shotCount || 0, og: p.onGround ? 1 : 0,
    });
  }

  _snapshot() {
    const g = this.game;
    const z = [];
    for (const e of g.enemies.list) {
      if (e.dead) continue;
      const fl = (e.riseT > 0 ? 1 : 0) | (e.fx.burnT > 0 ? 2 : 0) | (e.fx.hypeT > 0 ? 4 : 0)
        | (e.kind === 'gasbag' && e.hp < e.maxHp * 0.35 ? 8 : 0);
      z.push([e.nid, e.kind, e.char.variant ?? 0, e.elite ? 1 : 0, r2(e.mesh.scale.x), r2(e.mesh.position.x), r2(e.mesh.position.z), r2(e.mesh.rotation.y), Math.round(e.hp), Math.round(e.maxHp), fl | (e.golden ? 16 : 0)]);
    }
    const b = [];
    for (const x of g.bosses) {
      if (x.dead) continue;
      b.push([x.nid, x.kind, r2(x.mesh.scale.x), r2(x.mesh.position.x), r2(x.mesh.position.z), r2(x.mesh.rotation.y), Math.round(x.hp), Math.round(x.maxHp), x.vulnT > 0 ? 1 : 0, x.name]);
    }
    const pr = g.enemies.projectiles.map((q) => [q.kind === 'card' ? 1 : 0, r2(q.mesh.position.x), r2(q.mesh.position.y), r2(q.mesh.position.z)]);
    const pk = g.pickups.list.map((q) => [q.id, q.kind, q.amount || 0, r2(q.mesh.position.x), r2(q.mesh.position.z), q.part || q.key || 0]);
    return { t: 'snap', z, b, pr, pk, ev: this.events.splice(0), rem: g.enemies.remaining() };
  }

  // ------------------------------- messages ----------------------------------
  _find(id) {
    const g = this.game;
    return g.enemies.list.find((e) => e.nid === id) || g.bosses.find((e) => e.nid === id);
  }

  _onMsg(m) {
    const g = this.game;
    switch (m.t) {
      case 'pi':
        this.send({ t: 'po', ts: m.ts });
        break;
      case 'po': {
        const rtt = Math.max(0, performance.now() - m.ts);
        this.ping = this.ping ? this.ping * 0.7 + rtt * 0.3 : rtt;
        break;
      }
      case 'hello':
        if (m.v !== PROTO) { this._status('Your friend has a different version of the game — you both need the same build.', 'bad'); this.leave(true); }
        break;
      case 'full':
        this._status('That table is full.', 'bad');
        this.leave(true);
        break;
      case 'start':
        if (this.role === 'guest') g.coopNewRun(m.seed || '');
        break;
      case 'ps': {
        const R = this.remote;
        R.pos.set(m.x, m.y, m.z); R.yaw = m.yaw; R.pitch = m.pitch;
        R.onGround = !!m.og; R.hp = m.hp; R.maxHp = m.mhp;
        R.down = !!m.dn; R.bled = !!m.bo; R.downT = m.dt; R.seen = true;
        R.gun = m.gun; R.packed = !!m.pk;
        const av = this.avatar;
        if (av) {
          av.target.set(m.x, 0, m.z);
          av.yaw = m.yaw; av.pitch = m.pitch;
          av.down = R.down; av.bled = R.bled;
          av.setGun(m.gun, R.packed);
          if (m.sh > this.partnerShots && g.state !== 'INTERMISSION') {
            const fx = GUNFX[m.gun];
            if (fx?.sfx) g.audioAt(fx.sfx, av.root.position.clone().setY(1.4));
            const mz = av.muzzle();
            g.effects.spawnBurst?.(mz, 0xffc060, 3, 2);
          }
          this.partnerShots = m.sh;
        }
        break;
      }
      // ---- guest -> host: our shots and tricks on the horde ----
      case 'hit': {
        const e = this._find(m.id);
        if (!e || e.dead) break;
        e._byGuest = true;
        e.takeDamage(m.d, !!m.s, null, m.c || 'hit', !!m.h);
        e._byGuest = false;
        break;
      }
      case 'zfx': {
        const e = this._find(m.id);
        if (!e || e.dead) break;
        e._byGuest = true;
        if (m.f === 'knock') e.knockback(new THREE.Vector3(m.a[0], 0, m.a[1]), m.a[2]);
        else if (typeof e[m.f] === 'function') e[m.f](...m.a);
        e._byGuest = false;
        break;
      }
      case 'lure':
        g.enemies.lure = { pos: new THREE.Vector3(m.x, 0, m.z), radius: m.r, t: m.time };
        break;
      case 'door':
        if (!g.arena.isZoneOpen(m.zone)) { g.arena.openZone(m.zone); g.enemies.navT = 0; g.ui.banner(`YOUR PARTNER OPENED ${g.arena.doors.find((d) => d.zone === m.zone)?.def.name || 'A DOOR'}`, 'gold', 2200); }
        break;
      case 'boom':
        g.enemies.boomFx(new THREE.Vector3(m.x, m.y, m.z), m.r, !!m.h);
        break;
      case 'ready':
        this.guestReady = true;
        if (this.hostReady && g.state === 'INTERMISSION') g.casino.startNextRound();
        else if (g.state === 'INTERMISSION') g.ui.prompt('Your partner is ready for the next round', 2500);
        break;
      case 'revive':
        this._revived();
        break;
      case 'banner':
        g.ui.banner(m.text, m.color, m.ms);
        break;
      // ---- host -> guest ----
      case 'snap':
        if (this.isGuest) this._applySnap(m);
        break;
      case 'hurt': {
        const p = g.player;
        if (m.b && g.perkFx?.blastProof) break;
        const src = m.x != null ? { mesh: { position: new THREE.Vector3(m.x, 0, m.z) }, def: { name: m.n || 'the horde' } } : (m.n ? { def: { name: m.n } } : null);
        p.takeDamage(m.d, src);
        break;
      }
      case 'credit': {
        const at = new THREE.Vector3(m.x, 1.2, m.z);
        g.onKill({ kind: m.k, lastCause: m.c });
        g.awardChips(m.a, at);
        break;
      }
      case 'pick':
        g.pickups.collectRemote(m);
        break;
      case 'begin':
        this.guestReadySent = false;
        g.guestBeginRound(m);
        break;
      case 'cleared':
        g.onRoundCleared(true);
        break;
      case 'bossdown':
        g.onBossDefeated(m.kind);
        break;
      case 'over':
        g.onPlayerDeath(m.cause || 'the horde', true);
        break;
      default: break;
    }
  }

  // ----------------------------- guest: puppets ------------------------------
  _applySnap(m) {
    const g = this.game;
    this.remoteRemaining = m.rem;
    const now = performance.now();
    const seen = new Set();
    for (const a of m.z) {
      const id = a[0];
      seen.add(id);
      const rd = this.recentDead.get(id);
      if (rd && now - rd < 1200) continue;                  // we already dropped it; the host is catching up
      let p = this.puppets.get(id);
      if (!p) {
        p = new Puppet(g, a);
        this.puppets.set(id, p);
        g.enemies.list.push(p);
      }
      p.target.set(a[5], 0, a[6]);
      p.ry = a[7];
      if (!(p.hitFlash > 0)) p.hp = a[8];
      p.maxHp = a[9];
      p.flags = a[10];
    }
    // bosses
    const bseen = new Set();
    for (const a of m.b) {
      const id = a[0];
      bseen.add(id);
      let p = this.bossPuppets.get(id);
      if (!p) {
        p = new BossPuppet(g, a);
        this.bossPuppets.set(id, p);
        g.bosses.push(p);
      }
      p.target.set(a[3], 0, a[4]);
      p.ry = a[5];
      p.hp = a[6]; p.maxHp = a[7]; p.flags = a[8];
    }
    // animations that happened on the host
    for (const [id, fn, ...args] of m.ev) {
      const p = this.puppets.get(id) || this.bossPuppets.get(id);
      if (p) p.event(fn, args);
    }
    // gone without a death (escaped jackpot, a gasbag that blew): poof
    for (const [id, p] of this.puppets) {
      if (!seen.has(id)) { this._vanish(p); this.puppets.delete(id); }
    }
    for (const [id, p] of this.bossPuppets) {
      if (!bseen.has(id) && !p.dead) this.puppetDie(p, 'back', false);
    }
    for (const [id, t] of this.recentDead) if (now - t > 5000) this.recentDead.delete(id);
    this._syncProjectiles(m.pr);
    this._syncPickups(m.pk);
  }

  /** a puppet goes down (the host said so, or our shot plainly killed it) */
  puppetDie(p, style, headPop) {
    const g = this.game;
    if (p.dead) return;
    p.dead = true;
    const top = p.mesh.position.clone().setY(1.55 * p.mesh.scale.y);
    if (headPop) g.effects.spawnHeadPop?.(top.setY(1.7 * p.mesh.scale.y)); else g.effects.spawnBlood?.(top, 10, 3.5);
    g.effects.spawnDecal?.(p.mesh.position, 1.1 + Math.random() * 0.8);
    p.char.die(style, headPop);
    if (STYLE.cartoon) {
      g.effects.toonCloud?.(p.mesh.position.clone().setY(1.2 * p.mesh.scale.y), 1.1);
      g.effects.spawnGhost?.(p.mesh.position.clone().setY(1.6 * p.mesh.scale.y));
    }
    g.audioAt('zombie_die', p.mesh.position);
    g.enemies.list = g.enemies.list.filter((z) => z !== p);
    g.bosses = g.bosses.filter((b) => b !== p);
    this.puppets.delete(p.nid);
    this.bossPuppets.delete(p.nid);
    g.enemies.corpses.push({ char: p.char, mesh: p.mesh });
  }

  predictDeath(p) {
    this.recentDead.set(p.nid, performance.now());
    const style = p.lastCause === 'explosion' ? 'back' : null;
    this.puppetDie(p, style, p._lastHitHead && p.lastCause !== 'explosion' && Math.random() < 0.7);
  }

  _vanish(p) {
    const g = this.game;
    if (p.kind === 'gasbag') g.effects.spawnGibs?.(p.mesh.position.clone().setY(1.2), 0x7a8a2a);
    else g.effects.spawnPoof?.(p.mesh.position.clone().setY(1.2), 0xffd24a);
    g.scene.remove(p.mesh);
    p.char.dispose();
    g.enemies.list = g.enemies.list.filter((z) => z !== p);
  }

  _syncProjectiles(list) {
    const g = this.game;
    while (this.projMeshes.length > list.length) g.scene.remove(this.projMeshes.pop());
    list.forEach(([card, x, y, z], i) => {
      let m = this.projMeshes[i];
      if (!m || m.userData.card !== card) {
        if (m) g.scene.remove(m);
        m = card ? new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.22), new THREE.MeshBasicMaterial({ color: 0xf4efe2, side: THREE.DoubleSide }))
          : new THREE.Mesh(g.enemies._acidGeo, g.enemies._acidMat);
        m.userData.card = card;
        g.scene.add(m);
        this.projMeshes[i] = m;
      }
      m.userData.to = new THREE.Vector3(x, y, z);
      if (!m.userData.placed) { m.position.copy(m.userData.to); m.userData.placed = true; }
    });
  }

  _syncPickups(list) {
    const g = this.game;
    const seen = new Set();
    for (const [id, kind, amount, x, z, part] of list) {
      seen.add(id);
      let m = this.pickMeshes.get(id);
      if (!m) {
        m = g.pickups.remoteMesh(kind, amount, part, new THREE.Vector3(x, 0, z));
        this.pickMeshes.set(id, m);
      }
      m.userData.to = new THREE.Vector3(x, 0, z);
    }
    for (const [id, m] of this.pickMeshes) if (!seen.has(id)) { g.pickups._remove({ mesh: m }); this.pickMeshes.delete(id); }
  }

  _animateRemote(dt) {
    const t = performance.now() / 1000;
    for (const m of this.projMeshes) {
      if (m.userData.to) m.position.lerp(m.userData.to, Math.min(1, dt * 14));
      if (m.userData.card) m.rotation.z += dt * 18;
    }
    let i = 0;
    for (const m of this.pickMeshes.values()) {
      if (m.userData.to) m.position.lerp(m.userData.to, Math.min(1, dt * 10));
      const { model, glow } = m.userData;
      model.rotation.y += dt * 2.2;
      model.position.y = 0.45 + Math.sin(t * 3 + i) * 0.06;
      glow.material.opacity = 0.4 + Math.sin(t * 4 + i) * 0.15;
      i++;
    }
  }

  // ----------------------------------- HUD -----------------------------------
  _hud() {
    const g = this.game, R = this.remote, p = g.player;
    const fill = $('coop-hp');
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, (R.hp / R.maxHp) * 100))}%`;
    const st = $('coop-state');
    if (st) {
      const txt = !R.seen ? 'connecting…' : R.bled ? 'BLED OUT — back next round' : R.down ? `DOWN — ${R.downT}s — go pick them up!` : `${Math.round(R.hp)} HP`;
      if (st.textContent !== txt) st.textContent = txt;
      st.className = R.down || R.bled ? 'bad' : 'dim small';
    }
    const dn = $('coop-down');
    const floored = p.downed || p.bledOut;
    dn.classList.toggle('hidden', !floored);
    if (floored) {
      const txt = p.bledOut ? 'OUT FOR THE ROUND' : `YOU'RE DOWN — ${Math.max(0, Math.ceil(p.downT))}s`;
      const b = $('coop-down-t');
      if (b.textContent !== txt) b.textContent = txt;
      $('coop-down-sub').textContent = p.bledOut ? 'Your partner has to clear the round' : 'Hang on — your partner can hold E on you to deal you back in';
    }
  }
}
