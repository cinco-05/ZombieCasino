// net.js — co-op for up to four gamblers over the internet, by room code.
//
// PeerJS (vendor/peerjs.min.js) introduces the games through its free public
// matchmaking server, then they talk directly (WebRTC; PeerJS's relay servers
// step in when a home network won't allow a direct line).
//
// The HOST runs the real house: the horde, the bosses, the rounds, the drops.
// Up to three GUESTS connect to the host (a star: guests never talk to each
// other directly; the host passes along what they need to see). Each guest
// runs their own gambler (movement, guns, gear, shop, perks) and sees the horde
// as PUPPETS — the same rigged characters, moved by the host's snapshots 20
// times a second. Everything a guest does TO the horde (shots, blasts, stuns,
// slips, fire) is sent to the host and applied there, tagged with their seat.
// Kills pay whoever landed the killing blow; doors are shared; everyone has
// their own chips, shop (dealt from their own seat's slice of the seed),
// cocktails, LADY LUCK and ALL IN. Down in co-op means bleeding out for 30
// seconds — anyone standing over you can hold E to deal you back in.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Audio } from './audio.js';
import { Character } from './chars/character.js';
import { buildWorldGun } from './gfx/viewmodels.js';
import { GUNFX } from './weapons.js';
import { STYLE } from './gfx/style.js';
import { randomSeed } from './rng.js';

const PROTO = 2;
const PREFIX = 'hotu-coop-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';    // no I/L/O/0/1 to misread
const SEND_DT = 1 / 20;
export const MAX_PLAYERS = 4;
export const REVIVE_TIME = 3;
const REVIVE_RANGE = 2.6;
const SILENT_DROP = 45000;       // ms without a word (pings go every second) before a line counts as dead
export const BLEED_TIME = 30;
// seat 0 is the host; each seat has its own dinner jacket and color
const SEAT_LOOK = ['gambler2', 'gambler', 'gambler3', 'gambler4'];
export const SEAT_COLOR = ['#ff6a7a', '#f4e8c8', '#6aff9a', '#7ab8ff'];
const NAME_KEY = 'hotu_name_v1';
const $ = (id) => document.getElementById(id);
const r2 = (v) => Math.round(v * 100) / 100;
const cleanName = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9 .'!-]/g, '').trim().slice(0, 16);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loadName() {
  let n = '';
  try { n = cleanName(localStorage.getItem(NAME_KEY)); } catch { /* private mode */ }
  if (n) return n;
  const nick = ['LUCKY', 'ACE', 'DEUCE', 'JOKER', 'DICE', 'ROYAL', 'SNAKE EYES', 'HIGH ROLLER'][Math.floor(Math.random() * 8)];
  return `${nick} ${10 + Math.floor(Math.random() * 90)}`;
}

// ====================== another gambler, as this game sees them ============
export class RemotePlayer {
  constructor(game, seat, name) {
    this.game = game;
    this.seat = seat;
    this.name = name || `PLAYER ${seat + 1}`;
    this.isRemote = true;
    this.avatar = null;
    this.ping = 0;                // host: measured to them; guest: what they report
    this.stats = { kills: 0, deaths: 0, damage: 0, chips: 0 };
    this.ready = false;
    this.reset();
  }
  reset() {
    this.pos = new THREE.Vector3(1.6 * this.seat, CONFIG.player.eyeHeight, 8);
    this.yaw = Math.PI; this.pitch = 0;
    this.onGround = true;
    this.hp = 100; this.maxHp = 100;
    this.down = false; this.bled = false; this.downT = 0;
    this.gun = 'shotgun'; this.packed = false;
    this.shots = 0;
    this.seen = false;
    this.ready = false;
    this.reviveSent = 0;
  }
  get alive() { return this.seen && !this.down && !this.bled; }
  get nav() { return this.game.arena.navFor(this.seat); }
  forwardFlat() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  /** the host's horde hurts this gambler: tell their game */
  takeDamage(amount, source = null, blast = false) {
    const g = this.game;
    if (!this.alive || g.state === 'SUMMARY') return false;
    const at = source?.mesh?.position;
    g.net.sendTo(this.seat, { t: 'hurt', d: r2(amount), n: source?.def?.name || null, x: at ? r2(at.x) : null, z: at ? r2(at.z) : null, b: blast ? 1 : 0 });
    return true;
  }
  dispose() { if (this.avatar) { this.avatar.dispose(); this.avatar = null; } }
}

// ============================ a gambler's body =============================
export class Avatar {
  constructor(game, player) {
    this.game = game;
    this.player = player;
    this.char = new Character(SEAT_LOOK[player.seat] || 'gambler', {});
    this.root = this.char.root;
    game.scene.add(this.root);
    this.target = new THREE.Vector3(1.6 * player.seat, 0, 8);
    this.root.position.copy(this.target);
    this.yaw = Math.PI; this.pitch = 0;
    this.speed = 0;
    this.gunId = null; this.gun = null;
    this.down = false; this.bled = false; this.hp = 100; this.maxHp = 100;
    // things that float over them (and don't tip over when they do)
    this.float = new THREE.Group();
    game.scene.add(this.float);
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
    this.float.add(this.tag);
    // the revive marker: a red cross that shows through walls, the same size at any range
    const rc = document.createElement('canvas');
    rc.width = 128; rc.height = 160;
    const c = rc.getContext('2d');
    c.beginPath(); c.arc(64, 62, 54, 0, Math.PI * 2);
    c.fillStyle = '#d0102a'; c.fill();
    c.lineWidth = 8; c.strokeStyle = '#fff4e8'; c.stroke();
    c.fillStyle = '#fff4e8';
    c.fillRect(52, 28, 24, 68); c.fillRect(30, 50, 68, 24);
    c.font = 'bold 30px Bahnschrift, "Segoe UI", sans-serif';
    c.textAlign = 'center';
    c.lineWidth = 7; c.strokeStyle = 'rgba(0,0,0,0.9)'; c.strokeText('REVIVE', 64, 150);
    c.fillText('REVIVE', 64, 150);
    this.reviveTex = new THREE.CanvasTexture(rc);
    this.reviveTex.colorSpace = THREE.SRGBColorSpace;
    this.reviveIcon = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.reviveTex, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false }));
    this.reviveIcon.renderOrder = 1000;
    this.reviveIcon.position.y = 1.35;
    this.reviveIcon.visible = false;
    this.float.add(this.reviveIcon);
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
    const P = this.player;
    const key = `${P.name}|${Math.round(this.hp)}|${this.down}|${this.bled}|${this.down ? Math.ceil(P.downT) : 0}`;
    if (key === this._tagKey) return;
    this._tagKey = key;
    const c = this.tagCv.getContext('2d');
    c.clearRect(0, 0, 256, 72);
    c.font = 'bold 28px Bahnschrift, "Segoe UI", sans-serif';
    c.textAlign = 'center';
    c.lineWidth = 6; c.strokeStyle = 'rgba(0,0,0,0.85)';
    const label = this.bled ? `${P.name} — OUT` : this.down ? `${P.name} — DOWN ${Math.ceil(P.downT)}s` : P.name;
    c.strokeText(label, 128, 30, 250);
    c.fillStyle = this.down || this.bled ? '#ff5a6a' : SEAT_COLOR[P.seat] || '#7ae8ff';
    c.fillText(label, 128, 30, 250);
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
    // the tag and the cross ride above them, upright
    this.float.position.set(this.root.position.x, 0, this.root.position.z);
    this.tag.position.y = floored ? 1.25 : 2.35;
    this.reviveIcon.visible = this.down;
    if (this.down) {
      const urgent = this.player.downT < 10;
      const s = 0.135 * (1 + 0.12 * Math.sin(performance.now() / (urgent ? 90 : 220)));
      this.reviveIcon.scale.set(s, s * 1.25, 1);
      this.reviveIcon.position.y = 1.85;
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
    this.game.scene.remove(this.float);
    this.char.dispose();
    this.tagTex.dispose();
    this.reviveTex.dispose();
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
    g.stats.damage = (g.stats.damage || 0) + Math.max(0, Math.min(felt, this.hp));   // the scoreboard
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
    g.stats.damage = (g.stats.damage || 0) + Math.max(0, Math.min(dmg * (this.flags & 1 ? 2 : 1), this.hp));
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
    this.conn = null;           // guest: the line to the host
    this.links = new Map();     // host: seat -> the line to that guest
    this.code = null;
    this.mySeat = 0;
    this.welcomed = false;      // guest: the host gave us a seat
    this.players = new Map();   // everyone else at the table: seat -> RemotePlayer
    this.name = loadName();
    this.inRun = false;
    this.nextId = 1;
    this.events = [];
    this.sendT = 0;
    this.puppets = new Map();
    this.bossPuppets = new Map();
    this.recentDead = new Map();
    this.remoteRemaining = 0;
    this.pickMeshes = new Map();
    this.projMeshes = [];
    this.hostReady = false;
    this.guestReadySent = false;
    this.reviveT = 0;           // how long you've held E over someone
    this.reviving = null;       // …and who
    this.ping = 0;              // guest: round trip to the host, ms (0 alone, 0 hosting)
  }

  /** once a second, on a timer (it keeps beating while the window is hidden and
      the game isn't drawing): a ping to measure the line, and a check for lines
      that have gone quiet for good (a crashed or killed game) */
  _startBeat() {
    clearInterval(this._beat);
    this._beat = setInterval(() => {
      if (!this.role) return;
      const now = performance.now();
      this.send({ t: 'pi', ts: now });
      if (this.role === 'host') {
        for (const c of [...this.links.values()]) if (now - (c._last || now) > SILENT_DROP) { try { c.close(); } catch { /* gone */ } this._dropConn(c); }
      } else if (this.welcomed && now - (this._hostLast || now) > SILENT_DROP) this._hostGone();
    }, 1000);
  }

  get connected() { return this.role === 'host' ? this.links.size > 0 : !!(this.conn && this.conn.open && this.welcomed); }
  get active() { return this.connected && !!this.role; }
  get isHost() { return this.active && this.role === 'host'; }
  get isGuest() { return this.active && this.role === 'guest'; }
  remotes() { return [...this.players.values()]; }
  /** the other gamblers the horde can still hurt */
  aliveRemotes() { return this.remotes().filter((r) => r.alive); }
  /** host: a kill another seat should be paid for */
  creditedElsewhere(z) { return this.isHost && (z.lastHitBy ?? 0) !== 0 && this.links.has(z.lastHitBy); }
  nameOf(seat) { return seat === this.mySeat ? this.name : this.players.get(seat)?.name || `PLAYER ${seat + 1}`; }

  setName(n) {
    const v = cleanName(n);
    if (!v) return;
    this.name = v;
    try { localStorage.setItem(NAME_KEY, v); } catch { /* private mode */ }
    if (this.role === 'host') this._rosterOut();
    else if (this.role === 'guest' && this.conn?.open) this.send({ t: 'name', name: v });
  }

  // --------------------------------- lobby -----------------------------------
  _status(text, cls = '') {
    const el = $('coop-status');
    if (el) { el.textContent = text; el.className = cls; }
  }

  _newPeer(id) {
    if (!window.Peer) { this._status('Co-op is missing its network library (vendor/peerjs.min.js).', 'bad'); return null; }
    return new window.Peer(id, { debug: 0 });
  }

  /** the four seats in the lobby: who's sitting where */
  renderSeats() {
    const el = $('coop-seats');
    if (!el) return;
    // seated at a table: the host / join controls step aside
    const panel = $('coop-panel');
    if (this.role) panel.dataset.role = this.role; else delete panel.dataset.role;
    if (!this.role) { el.innerHTML = ''; return; }
    const rows = [];
    for (let s = 0; s < MAX_PLAYERS; s++) {
      const here = s === this.mySeat || this.players.has(s);
      const name = here ? this.nameOf(s) : 'an empty seat';
      rows.push(`<div class="seat${here ? '' : ' empty'}${s === this.mySeat ? ' me' : ''}" style="--c:${SEAT_COLOR[s]}"><b>${s + 1}</b><span>${esc(name)}</span>`
        + `${s === 0 ? '<em>HOST</em>' : ''}${s === this.mySeat ? '<em>YOU</em>' : ''}</div>`);
    }
    el.innerHTML = rows.join('');
    $('btn-coop-start')?.classList.toggle('hidden', !(this.role === 'host' && this.links.size > 0 && !this.inRun));
  }

  host() {
    this.leave(true);
    this.role = 'host';
    this.mySeat = 0;
    this._startBeat();
    this.code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    this._status('Opening a table…');
    const peer = this.peer = this._newPeer(PREFIX + this.code.toLowerCase());
    if (!peer) return;
    peer.on('open', () => {
      $('coop-code').textContent = this.code;
      $('coop-code-wrap').classList.remove('hidden');
      this._status(`Send your friends this code — up to ${MAX_PLAYERS - 1} of them. Waiting for them to sit down…`);
      this.renderSeats();
    });
    peer.on('connection', (conn) => {
      conn.on('data', (m) => { try { this._hostData(conn, m); } catch (err) { console.error('[net]', err); } });
      conn.on('close', () => this._dropConn(conn));
      conn.on('error', () => this._dropConn(conn));
    });
    peer.on('error', (e) => this._peerError(e));
  }

  /** host: a message on one of the guest lines */
  _hostData(conn, m) {
    conn._last = performance.now();
    if (m.t === 'hello') {
      if (conn._seat != null) return;
      const refuse = (why) => { try { conn.send({ t: 'full', why }); } catch { /* gone */ } setTimeout(() => conn.close(), 400); };
      if (m.v !== PROTO) { refuse('version'); return; }
      if (this.inRun) { refuse('run'); return; }
      let seat = 1;
      while (this.links.has(seat)) seat++;
      if (seat >= MAX_PLAYERS) { refuse('full'); return; }
      conn._seat = seat;
      this.links.set(seat, conn);
      this.players.set(seat, new RemotePlayer(this.game, seat, cleanName(m.name) || `PLAYER ${seat + 1}`));
      conn.send({ t: 'welcome', seat });
      this._rosterOut();
      this._status(`${this.players.get(seat).name} sat down at seat ${seat + 1}. Deal when everyone's in.`, 'good');
      Audio.play('chip');
      return;
    }
    if (conn._seat == null) return;
    this._onMsg(m, conn._seat);
  }

  /** host: everyone's seat and name, to everyone */
  _rosterOut() {
    const list = [{ seat: 0, name: this.name }, ...this.remotes().map((r) => ({ seat: r.seat, name: r.name }))];
    this.send({ t: 'roster', list });
    this.renderSeats();
    this.game.ui.renderScoreboard?.();
  }

  /** guest: the host's list of who's at the table */
  _syncRoster(list) {
    const seats = new Set();
    for (const { seat, name } of list) {
      if (seat === this.mySeat) continue;
      seats.add(seat);
      const r = this.players.get(seat);
      if (r) r.name = name;
      else {
        const nr = new RemotePlayer(this.game, seat, name);
        this.players.set(seat, nr);
        if (this.inRun) nr.avatar = new Avatar(this.game, nr);
      }
    }
    for (const [seat, r] of this.players) if (!seats.has(seat)) { r.dispose(); this.players.delete(seat); }
    this.renderSeats();
    if (this.inRun) this._buildHud();
  }

  join(code) {
    code = (code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) { this._status('Type the room code your friend sent you.', 'bad'); return; }
    this.leave(true);
    this.role = 'guest';
    this.code = code;
    this._hostLast = 0;
    this._startBeat();
    this._status(`Looking for table ${code}…`);
    const peer = this.peer = this._newPeer(undefined);
    if (!peer) return;
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code.toLowerCase(), { serialization: 'json', reliable: true });
      this.conn = conn;
      conn.on('open', () => { conn.send({ t: 'hello', v: PROTO, name: this.name }); this._status('Knocking…'); });
      conn.on('data', (m) => { this._hostLast = performance.now(); try { this._onMsg(m, 0); } catch (err) { console.error('[net]', err); } });
      conn.on('close', () => this._hostGone());
      conn.on('error', () => this._hostGone());
      setTimeout(() => { if (!this.welcomed && this.role === 'guest') this._status('Still knocking… check the code, and that your friend is on the co-op screen.', 'bad'); }, 9000);
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
    if (!this.connected) { this.peer?.destroy(); this.peer = null; this.role = null; this.renderSeats(); }
  }

  /** guest → host; host → every guest */
  send(m) {
    if (this.role === 'host') { for (const c of this.links.values()) this._put(c, m); }
    else if (this.conn) this._put(this.conn, m);
  }
  /** to one seat (a guest reaching another guest goes through the host) */
  sendTo(seat, m) {
    if (this.role === 'host') { const c = this.links.get(seat); if (c) this._put(c, m); }
    else if (seat === 0) this.send(m);
    else this.send({ t: 'relay', to: seat, m });
  }
  /** host: to every guest but one */
  _broadcast(m, except) {
    for (const [seat, c] of this.links) if (seat !== except) this._put(c, m);
  }
  _put(c, m) { if (c && c.open) { try { c.send(m); } catch { /* closing */ } } }

  /** walk away from the table */
  leave(quiet = false) {
    const had = this.connected;
    clearInterval(this._beat);
    this.inRun = false;
    for (const c of this.links.values()) { try { c.close(); } catch { /* gone */ } }
    try { this.conn?.close(); } catch { /* gone */ }
    try { this.peer?.destroy(); } catch { /* gone */ }
    this.links.clear();
    this.conn = null; this.peer = null; this.role = null;
    this.welcomed = false;
    this.mySeat = 0;
    this.ping = 0;
    this._clearWorld();
    for (const r of this.players.values()) r.dispose();
    this.players.clear();
    if (!quiet && had) this._status('Left the table.');
    $('btn-coop-start')?.classList.add('hidden');
    $('coop-code-wrap')?.classList.add('hidden');
    $('coop-hud')?.classList.add('hidden');
    $('coop-down')?.classList.add('hidden');
    this.renderSeats();
  }

  /** host: a guest's line closed */
  _dropConn(conn) {
    const seat = conn._seat;
    if (seat == null || this.links.get(seat) !== conn) return;
    const g = this.game;
    const r = this.players.get(seat);
    const name = r?.name || `PLAYER ${seat + 1}`;
    this.links.delete(seat);
    r?.dispose();
    this.players.delete(seat);
    this.send({ t: 'left', seat, name });
    this._rosterOut();
    if (!this.inRun) { this._status(`${name} left the table.`, 'bad'); return; }
    if (this.links.size === 0) {
      // nobody left: the host plays on alone — unless they were lying on the carpet waiting for a hand
      this.leave(true);
      this._status('Everyone left the table.', 'bad');
      if (!g.player.alive) { g.onPlayerDeath(this.downCause || 'the horde'); return; }
      g.ui.banner('EVERYONE LEFT THE TABLE — YOU PLAY ON ALONE', 'red', 4000);
      if (g.state === 'INTERMISSION' && this.hostReady) g.casino.startNextRound();
      return;
    }
    g.ui.banner(`${name} LEFT THE TABLE`, 'red', 3000);
    this._buildHud();
    this._checkReady();
  }

  /** guest: the host's line closed */
  _hostGone() {
    if (this.role !== 'guest') return;
    const g = this.game;
    const midRun = this.inRun;
    const wasSeated = this.welcomed;
    this.leave(true);
    this._status(wasSeated ? 'The host closed the table.' : 'Couldn’t sit down at that table.', 'bad');
    if (!midRun) return;
    g.ui.banner('THE HOST LEFT — THE TABLE IS CLOSED', 'red', 4000);
    setTimeout(() => g.backToMenu?.(), 2500);
  }

  // --------------------------------- runs ------------------------------------
  /** host: deal everybody in */
  startRun() {
    if (!this.isHost) return;
    const seed = this.game.coatCheck.seed() || randomSeed();   // one seed; each seat gets its own slice of it
    this.send({ t: 'start', seed });
    this.game.coopNewRun(seed);
  }

  /** everyone, at the start of a co-op run */
  resetRun() {
    this.inRun = true;
    this._clearWorld();
    for (const r of this.players.values()) {
      r.reset();
      r.stats = { kills: 0, deaths: 0, damage: 0, chips: 0 };
      r.avatar = new Avatar(this.game, r);
    }
    this.events = [];
    this.resetReady();
    this.reviveT = 0; this.reviving = null;
    this.renderSeats();
    this._buildHud();
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
    for (const r of this.players.values()) if (r.avatar) { r.avatar.dispose(); r.avatar = null; }
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
  /** host: every anim a zombie plays is mirrored on the guests' puppets */
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
    if (this.creditedElsewhere(z)) {
      this.sendTo(z.lastHitBy, { t: 'credit', a: amt, x: r2(z.mesh.position.x), z: r2(z.mesh.position.z), k: z.kind, c: z.lastCause || 'hit' });
    } else g.awardChips(amt, z.mesh.position);
  }

  sendBoom(pos, radius, hostile) {
    if (this.active) this.send({ t: 'boom', x: r2(pos.x), y: r2(pos.y), z: r2(pos.z), r: radius, h: hostile ? 1 : 0 });
  }

  // --------------------------- intermission sync -----------------------------
  resetReady() {
    this.hostReady = false;
    this.guestReadySent = false;
    for (const r of this.players.values()) r.ready = false;
  }

  /** casino.startNextRound asks: may we go? (co-op waits for every gambler) */
  readyToGo(casino) {
    const g = this.game;
    if (this.isGuest) {
      if (!this.guestReadySent) { this.guestReadySent = true; this.send({ t: 'ready' }); }
      casino.timerRunning = false;
      g.ui.hideAllPanels();
      g.ui.prompt('Waiting for everyone to finish at the tables…', 600000);
      return false;
    }
    this.hostReady = true;
    const waiting = this.remotes().filter((r) => !r.ready);
    if (!waiting.length || casino.timer <= 0) { this.resetReady(); return true; }
    g.ui.hideAllPanels();
    g.ui.prompt(`Waiting for ${waiting.map((r) => r.name).join(', ')}… (the doors open anyway in ${Math.max(0, Math.ceil(casino.timer))}s)`, 600000);
    return false;
  }

  /** host: someone got up from the tables — are we all set? */
  _checkReady() {
    const g = this.game;
    if (!this.isHost || g.state !== 'INTERMISSION') return;
    if (this.hostReady && this.remotes().every((r) => r.ready)) g.casino.startNextRound();
    else if (this.hostReady) this.readyToGo(g.casino);
  }

  // ------------------------------ down + revive ------------------------------
  /** co-op: the local player hit zero */
  goDown(cause) {
    const g = this.game, p = g.player;
    if (p.downed || p.bledOut) return;
    p.downed = true;
    p.downT = BLEED_TIME;
    p.hp = 0;
    g.stats.deaths = (g.stats.deaths || 0) + 1;
    this.downCause = cause;
    g.weapons.reloading = false;
    Audio.play('boss_phase');
    g.ui.banner("YOU'RE DOWN — A TEAMMATE CAN HOLD E ON YOU TO DEAL YOU BACK IN", 'red', 3200);
    this._sendState();
  }

  /** somebody picked you up */
  _revived(bySeat) {
    const g = this.game, p = g.player;
    if (!p.downed) return;
    p.downed = false;
    p.hp = Math.round(p.maxHp * 0.5);
    p.iFrames = 2;
    g.ui.banner(`${this.nameOf(bySeat)} DEALT YOU BACK IN`, 'green', 2000);
    Audio.play('revive');
    this._sendState();
  }

  /** the downed teammate you're standing over, if any */
  reviveCandidate() {
    const g = this.game, p = g.player;
    if (!this.active || !this.inRun || !p.alive) return null;
    let best = null, bd = REVIVE_RANGE;
    const now = performance.now();
    for (const r of this.players.values()) {
      if (!r.down || !r.avatar || now - r.reviveSent < 1500) continue;
      const a = r.avatar.root.position;
      const d = Math.hypot(a.x - p.pos.x, a.z - p.pos.z);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
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
    const seen = this.remotes().filter((r) => r.seen);
    return !this.game.player.alive && seen.length > 0 && seen.every((r) => !r.alive);
  }

  // --------------------------------- ticking ---------------------------------
  update(dt) {
    // ping: once a second, stamp a message and time it coming back
    if (!this.active || !this.inRun) return;
    const g = this.game;
    const inPlay = g.state === 'COMBAT' || g.state === 'COUNTDOWN' || (g.state === 'PAUSED' && (g._stateBeforePause === 'COMBAT' || g._stateBeforePause === 'COUNTDOWN'));
    // bleeding out
    const p = g.player;
    if (p.downed && inPlay) {
      p.downT -= dt;
      if (p.downT <= 0) {
        p.downed = false; p.bledOut = true;
        g.ui.banner('YOU BLED OUT — BACK NEXT ROUND IF THE TABLE HOLDS ON', 'red', 3500);
        this._sendState();
      }
    }
    // reviving: stand over a downed teammate and hold E (game.js shows the prompt)
    const rv = inPlay && g.state !== 'PAUSED' ? this.reviveCandidate() : null;
    if (rv && p.keys.KeyE) {
      // real seconds, so a slow machine doesn't make it a longer hold (a hitch counts at most a quarter second)
      const now = performance.now();
      if (this.reviving !== rv) { this.reviving = rv; this.reviveT = 0; this._reviveAt = now; }
      this.reviveT += Math.min(0.25, (now - this._reviveAt) / 1000) * (g.perkFx?.reload ? 1 / g.perkFx.reload : 1);
      this._reviveAt = now;
      if (this.reviveT >= REVIVE_TIME) {
        this.sendTo(rv.seat, { t: 'revive', from: this.mySeat });
        rv.reviveSent = performance.now();
        this.reviveT = 0; this.reviving = null;
        Audio.play('revive');
        g.ui.banner(`YOU DEALT ${rv.name} BACK IN`, 'green', 1800);
        g.progress?.bump('revives');
        g.progress?.gainXp(15, 'Teamwork');
      }
    } else { this.reviveT = 0; this.reviving = null; }

    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = SEND_DT;
      this._sendState();
      if (this.isHost) this.send(this._snapshot());
    }
    for (const r of this.players.values()) {
      const av = r.avatar;
      if (!av) continue;
      av.hp = r.hp; av.maxHp = r.maxHp;
      av.update(dt);
    }
    if (this.isGuest) this._animateRemote(dt);
    this._hud();
  }

  _sendState() {
    const g = this.game, p = g.player, w = g.weapons.current;
    this.send({
      t: 'ps', id: this.mySeat, x: r2(p.pos.x), y: r2(p.pos.y), z: r2(p.pos.z), yaw: r2(p.yaw), pitch: r2(p.pitch),
      gun: g.weapons.currentId, pk: w?.packed ? 1 : 0, hp: Math.round(p.hp), mhp: p.maxHp,
      dn: p.downed ? 1 : 0, bo: p.bledOut ? 1 : 0, dt: Math.ceil(p.downT || 0), sh: g.weapons.shotCount || 0, og: p.onGround ? 1 : 0,
      // the scoreboard
      nm: this.name, k: g.stats.kills, dd: g.stats.deaths || 0, dm: Math.round(g.stats.damage || 0), ch: g.chips, pg: Math.round(this.ping),
    });
  }

  /** a gambler's state, from their own game */
  _applyState(r, m) {
    const g = this.game;
    r.pos.set(m.x, m.y, m.z); r.yaw = m.yaw; r.pitch = m.pitch;
    r.onGround = !!m.og; r.hp = m.hp; r.maxHp = m.mhp;
    r.down = !!m.dn; r.bled = !!m.bo; r.downT = m.dt; r.seen = true;
    r.gun = m.gun; r.packed = !!m.pk;
    if (m.nm) r.name = m.nm;
    r.stats = { kills: m.k || 0, deaths: m.dd || 0, damage: m.dm || 0, chips: m.ch || 0 };
    if (!this.isHost) r.ping = m.id === 0 ? 0 : (m.pg || 0);
    const av = r.avatar;
    if (!av) return;
    av.target.set(m.x, 0, m.z);
    av.yaw = m.yaw; av.pitch = m.pitch;
    av.down = r.down; av.bled = r.bled;
    av.setGun(m.gun, r.packed);
    if (m.sh > r.shots && g.state !== 'INTERMISSION') {
      const fx = GUNFX[m.gun];
      if (fx?.sfx) g.audioAt(fx.sfx, av.root.position.clone().setY(1.4));
      g.effects.spawnBurst?.(av.muzzle(), 0xffc060, 3, 2);
    }
    r.shots = m.sh;
  }

  /** the scoreboard's rows: you and everyone at the table, by seat */
  scoreRows() {
    const g = this.game, p = g.player;
    const rows = [{
      seat: this.mySeat, name: this.name, me: true,
      ping: this.role === 'guest' ? Math.round(this.ping) : 0,
      kills: g.stats.kills, deaths: g.stats.deaths || 0, damage: Math.round(g.stats.damage || 0), chips: g.chips,
      state: p.bledOut ? 'OUT' : p.downed ? 'DOWN' : '',
    }];
    for (const r of this.players.values()) {
      rows.push({
        seat: r.seat, name: r.name, me: false, ping: Math.round(r.ping),
        kills: r.stats.kills, deaths: r.stats.deaths, damage: r.stats.damage, chips: r.stats.chips,
        state: r.bled ? 'OUT' : r.down ? 'DOWN' : '',
      });
    }
    return rows.sort((a, b) => a.seat - b.seat);
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

  _find(id) {
    const g = this.game;
    return g.enemies.list.find((e) => e.nid === id) || g.bosses.find((e) => e.nid === id);
  }

  // ------------------------------- messages ----------------------------------
  /** from: the seat it came from (a guest only ever hears from the host, seat 0) */
  _onMsg(m, from) {
    const g = this.game;
    const host = this.role === 'host';
    switch (m.t) {
      // ---- both ways ----
      case 'pi':
        this.sendTo(from, { t: 'po', ts: m.ts });
        break;
      case 'po': {
        const rtt = Math.max(0, performance.now() - m.ts);
        const smooth = (v) => (v ? v * 0.7 + rtt * 0.3 : rtt);
        if (host) { const r = this.players.get(from); if (r) r.ping = smooth(r.ping); }
        else this.ping = smooth(this.ping);
        break;
      }
      case 'relay':                        // host: one guest to another (or to us)
        if (!host) break;
        if (m.to === 0) this._onMsg({ ...m.m, from }, from);
        else this.sendTo(m.to, { ...m.m, from });
        break;
      case 'ps': {
        const seat = host ? from : m.id;
        const r = this.players.get(seat);
        if (!r) break;
        this._applyState(r, m);
        if (host) this._broadcast({ ...m, id: seat }, seat);   // everyone else sees them too
        break;
      }
      case 'name': {
        const r = host && this.players.get(from);
        if (r) { r.name = cleanName(m.name) || r.name; this._rosterOut(); }
        break;
      }
      case 'door':
        if (!g.arena.isZoneOpen(m.zone)) {
          g.arena.openZone(m.zone); g.enemies.navT = 0;
          const who = this.nameOf(host ? from : (m.by ?? 0));
          g.ui.banner(`${who} OPENED ${g.arena.doors.find((d) => d.zone === m.zone)?.def.name || 'A DOOR'}`, 'gold', 2200);
        }
        if (host) this._broadcast({ ...m, by: from }, from);
        break;
      case 'boom':
        g.enemies.boomFx(new THREE.Vector3(m.x, m.y, m.z), m.r, !!m.h);
        if (host) this._broadcast(m, from);
        break;
      case 'revive':
        this._revived(m.from ?? from);
        break;
      case 'banner':
        g.ui.banner(m.text, m.color, m.ms);
        break;
      // ---- guest -> host: shots and tricks on the horde, tagged with the seat ----
      case 'hit': {
        const e = host && this._find(m.id);
        if (!e || e.dead) break;
        e._by = from;
        e.takeDamage(m.d, !!m.s, null, m.c || 'hit', !!m.h);
        e._by = null;
        break;
      }
      case 'zfx': {
        const e = host && this._find(m.id);
        if (!e || e.dead) break;
        e._by = from;
        if (m.f === 'knock') e.knockback(new THREE.Vector3(m.a[0], 0, m.a[1]), m.a[2]);
        else if (typeof e[m.f] === 'function') e[m.f](...m.a);
        e._by = null;
        break;
      }
      case 'lure':
        if (host) g.enemies.lure = { pos: new THREE.Vector3(m.x, 0, m.z), radius: m.r, t: m.time };
        break;
      case 'ready': {
        const r = host && this.players.get(from);
        if (!r) break;
        r.ready = true;
        if (g.state === 'INTERMISSION' && !this.hostReady) g.ui.prompt(`${r.name} is ready for the next round`, 2500);
        this._checkReady();
        break;
      }
      // ---- host -> guest ----
      case 'welcome':
        this.mySeat = m.seat;
        this.welcomed = true;
        this._status(`Seated at seat ${m.seat + 1}! Waiting for the host to deal you in…`, 'good');
        Audio.play('chip');
        this.renderSeats();
        break;
      case 'roster':
        if (!host) this._syncRoster(m.list);
        break;
      case 'full':
        this._status(m.why === 'version' ? 'That table runs a different version of the game — you all need the same build.'
          : m.why === 'run' ? 'That table is in the middle of a game. Wait for it to finish.' : `That table is full (${MAX_PLAYERS} players).`, 'bad');
        this.leave(true);
        break;
      case 'left':
        if (!host && this.inRun) g.ui.banner(`${m.name} LEFT THE TABLE`, 'red', 3000);
        break;
      case 'start':
        if (!host) g.coopNewRun(m.seed || '');
        break;
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
  /** one row per teammate: name, health, and whether they need you */
  _buildHud() {
    const el = $('coop-hud');
    if (!el) return;
    el.innerHTML = this.remotes().sort((a, b) => a.seat - b.seat).map((r) =>
      `<div class="coop-row" data-seat="${r.seat}" style="--c:${SEAT_COLOR[r.seat]}"><div class="coop-name"></div>`
      + '<div class="bar bar-thin"><div class="fill fill-hp"></div></div><div class="coop-state dim small"></div></div>').join('');
  }

  _hud() {
    const g = this.game, p = g.player;
    for (const row of document.querySelectorAll('#coop-hud .coop-row')) {
      const r = this.players.get(parseInt(row.dataset.seat, 10));
      if (!r) continue;
      const nm = row.querySelector('.coop-name');
      if (nm.textContent !== r.name) nm.textContent = r.name;
      row.querySelector('.fill').style.width = `${Math.max(0, Math.min(100, (r.hp / r.maxHp) * 100))}%`;
      const st = row.querySelector('.coop-state');
      const txt = !r.seen ? 'connecting…' : r.bled ? 'BLED OUT — back next round' : r.down ? `DOWN — ${r.downT}s — hold E on them!` : `${Math.round(r.hp)} HP`;
      if (st.textContent !== txt) st.textContent = txt;
      row.classList.toggle('down', r.down || r.bled);
    }
    const dn = $('coop-down');
    const floored = p.downed || p.bledOut;
    dn.classList.toggle('hidden', !floored);
    if (floored) {
      const txt = p.bledOut ? 'OUT FOR THE ROUND' : `YOU'RE DOWN — ${Math.max(0, Math.ceil(p.downT))}s`;
      const b = $('coop-down-t');
      if (b.textContent !== txt) b.textContent = txt;
      $('coop-down-sub').textContent = p.bledOut ? 'The rest of the table has to clear the round'
        : 'Hang on — a teammate can stand over you and hold E to deal you back in';
    }
  }
}
