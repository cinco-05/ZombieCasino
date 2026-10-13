// whimsy.js — things that are only here to make you smile. None of it changes
// a single number in the game.
//
//  · The neon UNDEAD on the main menu is a xylophone: hover a letter and it
//    wobbles, click it and it plays a note. Spell it out, U-N-D-E-A-D, and the
//    band answers and it rains chips.
//  · The dead wandering behind the menu can be poked. Click one: it jumps out
//    of its skin and says something.
//  · Shoot the casino and it answers: slot machines ding (and now and then
//    TILT, or pay out a magnificent +0), chandeliers tinkle, the fountain
//    splashes, the bottles behind the bar ring.
//  · Leave the game paused and the dead get restless.
//  · Every menu button ticks under the mouse and clacks like a chip.

import * as THREE from 'three';
import { Audio } from './audio.js';

const $ = (id) => document.getElementById(id);

const QUIPS = [
  'Spare a chip, pal?', 'I\'m up! I\'m up!', 'Is this the line for the buffet?', 'Don\'t tell the Pit Boss I\'m on break.',
  'Hot streak. Since 1931.', 'Watch the suit, it\'s rented.', 'Boo. Sorry. Reflex.', 'Have you tried the shrimp cocktail? Don\'t.',
  'I\'d tip, but my hand keeps falling off.', 'Hit me. No, not like that.', 'I\'m not dead, I\'m on a losing streak.',
  'The band only knows three songs. I\'ve counted.', 'Personal space, please. I\'m decomposing.', 'You lookin\' at my chips?',
  'Back in my day, the slots took nickels.', 'Shh. I\'m counting cards. Badly.',
];

const PAUSE_LINES = [
  'The zombies wait politely.', 'The zombies are checking their watches.', 'One of them has started a crossword.',
  'They\'ve ordered a round of drinks. On your tab.', 'A small card game has broken out.', 'Somebody\'s teaching the brute to waltz.',
  'They\'re taking bets on whether you\'re coming back.', 'The odds are not in your favor. They checked.',
];

// U  N  D  E  A  D  — a little vibraphone arpeggio
const TITLE_NOTES = [72, 76, 79, 81, 84, 88];

export class Whimsy {
  constructor(game) {
    this.game = game;
    this.bubble = null;      // { el, actor, t }
    this.propsT = new Map(); // a prop's cooldown, so a shotgun blast is one ding
    this._typed = [];
    this._wireTitle();
    this._wireButtons();
    this._wireMenuPoke();
    this._wirePause();
  }

  // ------------------------------- the title ---------------------------------
  _wireTitle() {
    const word = document.querySelector('#main-menu .t-undead');
    if (!word) return;
    word.innerHTML = [...word.textContent].map((ch, i) => `<span class="lt" data-i="${i}">${ch}</span>`).join('');
    word.addEventListener('pointerover', (e) => {
      const lt = e.target.closest('.lt');
      if (lt) this._wobble(lt, 'wobble');
    });
    word.addEventListener('click', (e) => {
      const lt = e.target.closest('.lt');
      if (!lt) return;
      Audio.init();
      const i = +lt.dataset.i;
      this._wobble(lt, 'boing');
      Audio.note(TITLE_NOTES[i] ?? 72, 'vibes', 0.6, 1.2);
      // spell it out: U, N, D, E, A, D in order
      this._typed = [...this._typed, i].slice(-6);
      if (this._typed.join() === '0,1,2,3,4,5') { this._typed = []; this._encore(word); }
    });
  }

  _wobble(el, cls) {
    el.classList.remove('wobble', 'boing');
    void el.offsetWidth;        // restart the animation
    el.classList.add(cls);
  }

  /** they spelled UNDEAD: the band plays them out and it rains chips */
  _encore(word) {
    Audio.sting('win');
    for (const lt of word.querySelectorAll('.lt')) setTimeout(() => this._wobble(lt, 'boing'), +lt.dataset.i * 70);
    const colors = ['red', 'black', 'green', 'purple', 'white'];
    for (let i = 0; i < 46; i++) {
      const c = document.createElement('i');
      c.className = `chip rain-chip ${colors[i % colors.length]}`;
      c.style.left = `${Math.random() * 100}vw`;
      c.style.animationDelay = `${Math.random() * 1.2}s`;
      c.style.animationDuration = `${1.6 + Math.random() * 1.4}s`;
      c.style.setProperty('--spin', `${(Math.random() - 0.5) * 1440}deg`);
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 4600);
    }
  }

  // ------------------------------ the buttons --------------------------------
  _wireButtons() {
    const SEL = '.menu-item, .btn, .tbtn, .set-tab, .bind-key, .stop-btn, .spin-btn';
    let last = null, lastT = 0;
    document.addEventListener('pointerover', (e) => {
      const b = e.target.closest?.(SEL);
      if (!b || b === last || b.disabled) { if (!b) last = null; return; }
      last = b;
      const t = performance.now();
      if (t - lastT > 45) { lastT = t; Audio.play('ui_hover'); }
    });
    document.addEventListener('click', (e) => {
      const b = e.target.closest?.(SEL);
      if (b && !b.disabled) Audio.play('ui_click');
    }, true);
  }

  // --------------------------- the dead on the menu ----------------------------
  /** the menu zombie nearest a screen point (within reach), if any */
  _actorAt(x, y) {
    const g = this.game;
    let best = null, bd = 80;
    const v = new THREE.Vector3();
    for (const c of g.menuActors || []) {
      v.copy(c.root.position);
      v.y += 1.35 * c.root.scale.y;
      v.project(g.camera);
      if (v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight;
      const d = Math.hypot(sx - x, sy - y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  _wireMenuPoke() {
    const menu = $('main-menu');
    if (!menu) return;
    const open = (e) => !e.target.closest('button, input, select, a, .menu-column, .menu-controls');
    menu.addEventListener('mousemove', (e) => {
      menu.style.cursor = open(e) && this._actorAt(e.clientX, e.clientY) ? 'pointer' : '';
    });
    menu.addEventListener('click', (e) => {
      if (!open(e)) return;
      const c = this._actorAt(e.clientX, e.clientY);
      if (c) this.poke(c);
    });
  }

  /** a poked zombie jumps out of its skin, turns round and says something */
  poke(c) {
    Audio.init();
    Audio.play('boing');
    c.menu.hop = 0.55;
    c.menu.base ??= c.root.scale.x;
    const cam = this.game.camera.position;
    c.root.rotation.y = Math.atan2(cam.x - c.root.position.x, cam.z - c.root.position.z);
    this.bubble?.el.remove();
    const el = document.createElement('div');
    el.className = 'quip';
    let q;
    do { q = QUIPS[Math.floor(Math.random() * QUIPS.length)]; } while (q === this._lastQuip && QUIPS.length > 1);
    this._lastQuip = q;
    el.textContent = q;
    document.body.appendChild(el);
    this.bubble = { el, actor: c, t: 2.2 + q.length * 0.03 };
    c.menu.hold = this.bubble.t;                       // it stands still while it talks
    this._placeBubble();
  }

  /** the bubble goes the moment the menu does (a run starting, a panel opening) */
  clearBubble() {
    this.bubble?.el.remove();
    this.bubble = null;
  }

  _placeBubble() {
    const b = this.bubble;
    if (!b) return;
    const v = b.actor.root.position.clone();
    v.y += 2.15 * b.actor.root.scale.y;
    v.project(this.game.camera);
    b.el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
    b.el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
  }

  /** per frame on the menu: hops, and the speech bubble following its zombie */
  updateMenu(dt) {
    for (const c of this.game.menuActors || []) {
      const m = c.menu;
      if (!m?.hop) continue;
      m.hop = Math.max(0, m.hop - dt);
      const k = 1 - m.hop / 0.55;                          // 0 → 1 over the hop
      c.root.position.y = Math.sin(k * Math.PI) * 0.55;
      const squash = k < 0.15 ? 1 - k * 2 : 1 + Math.sin(k * Math.PI) * 0.12;
      c.root.scale.set(m.base / Math.sqrt(squash), m.base * squash, m.base / Math.sqrt(squash));
      if (!m.hop) { c.root.position.y = 0; c.root.scale.setScalar(m.base); }
    }
    const b = this.bubble;
    if (b) {
      b.t -= dt;
      this._placeBubble();
      if (b.t < 0.3) b.el.classList.add('gone');
      if (b.t <= 0 || this.game.state !== 'MENU' || $('main-menu').classList.contains('hidden')) this.clearBubble();
    }
  }

  // ------------------------------- the pause -----------------------------------
  _wirePause() {
    const line = document.querySelector('#pause-menu .deco-card > p.dim');
    if (!line) return;
    let n = 0;
    setInterval(() => {
      const paused = this.game.state === 'PAUSED' && !$('pause-menu').classList.contains('hidden');
      if (!paused) { if (n) { n = 0; line.textContent = PAUSE_LINES[0]; } return; }
      n++;
      // a new complaint every twelve seconds
      if (n % 12 === 0) line.textContent = PAUSE_LINES[Math.min(PAUSE_LINES.length - 1, n / 12)];
    }, 1000);
  }

  // --------------------------- the casino answers back ---------------------------
  _props() {
    if (this._list) return this._list;
    const a = this.game.arena, list = [];
    for (const [bx, bz] of a.bankPositions || []) {
      const ry = Math.atan2(-bx, -bz);
      for (let i = -1; i <= 1; i++) {
        const lx = i * 1.3;
        // (slack: a bank's collision box takes in the stools, so a shot at a machine stops short of its face)
        list.push({ kind: 'slot', c: new THREE.Vector3(bx + lx * Math.cos(ry), 1.5, bz - lx * Math.sin(ry)), r: 0.75, slack: 2.2 });
      }
    }
    for (const ch of a.chandeliers || []) list.push({ kind: 'chandelier', c: new THREE.Vector3(ch.x, ch.y + 0.35 * ch.s, ch.z), r: 1.7 * ch.s });
    list.push({ kind: 'fountain', c: new THREE.Vector3(0, 0.75, 14), r: 3.1 });
    list.push({ kind: 'bottles', box: [-28.4, 2.0, 29.5, -19.6, 4.4, 30.4] });
    list.forEach((p, i) => { p.id = i; });
    this._list = list;
    return list;
  }

  /** a shot that got as far as `dist` along dir: did it hit something that answers? */
  shot(o, d, dist) {
    let hit = null, best = Infinity;
    for (const p of this._props()) {
      const t = p.box ? rayBox(o, d, p.box) : raySphere(o, d, p.c, p.r);
      if (t != null && t < dist + (p.slack ?? 0.4) && t < best) { best = t; hit = p; }
    }
    if (!hit) return;
    const now = performance.now();
    if ((this.propsT.get(hit.id) || 0) > now) return;
    this.propsT.set(hit.id, now + 260);
    const g = this.game;
    const at = o.clone().addScaledVector(d, best);           // (on the machine's face, not the stools' box)
    switch (hit.kind) {
      case 'slot': {
        g.audioAt(Math.random() < 0.5 ? 'reel_stop' : 'ambient_chime', at);
        g.effects.spawnBurst(at, 0xffd24a, 8, 3.5);
        const r = Math.random();
        if (r < 0.06) { g.ui.floatText(at, '+0', 'chips'); g.audioAt('coins', at); }       // the house always wins
        else if (r < 0.3) g.ui.floatText(at, 'TILT!', 'dmg crit');
        break;
      }
      case 'chandelier':
        g.audioAt('glass_clink', at);
        setTimeout(() => g.audioAt('glass_clink', at), 90);
        g.effects.spawnBurst(at, 0xd8f4ff, 10, 2.5, 6);
        break;
      case 'fountain':
        g.audioAt('splash', at);
        g.effects.spawnBurst(at.setY(Math.max(at.y, 0.8)), 0x27d6ff, 12, 4);
        if (Math.random() < 0.15) g.ui.floatText(at, 'SPLOOSH', 'heal');
        break;
      case 'bottles':
        g.audioAt('glass_clink', at);
        g.effects.spawnBurst(at, [0x27e6ff, 0xff2d78, 0x2dff7a, 0xffd24a][Math.floor(Math.random() * 4)], 7, 3);
        break;
      default: break;
    }
  }
}

function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : null;
}

function rayBox(o, d, [x0, y0, z0, x1, y1, z1]) {
  let t0 = 0, t1 = 1e9;
  for (const [ov, dv, lo, hi] of [[o.x, d.x, x0, x1], [o.y, d.y, y0, y1], [o.z, d.z, z0, z1]]) {
    if (Math.abs(dv) < 1e-9) { if (ov < lo || ov > hi) return null; continue; }
    let a = (lo - ov) / dv, b = (hi - ov) / dv;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0 > 0 ? t0 : null;
}
