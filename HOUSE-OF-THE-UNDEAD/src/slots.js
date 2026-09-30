// slots.js — LUCKY UNDEAD, the one-armed bandit. A three-reel cabinet with a
// chasing-bulb marquee, a paytable behind the glass, LED meters and a coin
// tray. Grab the arm and drag it down (or hit SPIN / SPACE); the reels are
// real strips that spin up, blur, and clunk to a stop one at a time. STOP
// buttons (or 1–3) stop a reel early, like the skill-stop on a real machine
// (the result was decided when the arm dropped, as it is on a real one).
// The odds and paytable live in cards.js.

import {
  REELS, SLOT_LINES, SLOT_PAYTABLE, COINS_PER_PULL,
  spinSlotMachine, slotWindow, evalSlotWindow,
} from './cards.js';
import { Audio } from './audio.js';
import { Seed } from './rng.js';
import { leanWithMouse } from './tables.js';

const $ = (id) => document.getElementById(id);
const COPIES = 8;                 // strip repeats, so a reel can spin a long way
const N = REELS[0].length;
const BASE = N * (COPIES - 2);    // where a resting reel sits on its strip
const SPEED = 24;                 // symbols a second at full tilt
const LINE_COLORS = ['#ffd24a', '#ff3b5c', '#3bd1ff', '#7dff6a', '#ff8af0'];

const SYM = {
  seven: '<span class="s-seven">7</span>',
  bar1: '<span class="s-bar"><i>BAR</i></span>',
  bar2: '<span class="s-bar two"><i>BAR</i><i>BAR</i></span>',
  bar3: '<span class="s-bar three"><i>BAR</i><i>BAR</i><i>BAR</i></span>',
  cherry: '<span class="s-cherry"><i></i><i></i><b></b></span>',
  bell: '<span class="s-bell"><i></i><b></b></span>',
  heart: '<span class="s-heart">♥</span>',
  wild: '<span class="s-wild">★<small>WILD</small></span>',
  blank: '<span class="s-blank"></span>',
  any: '<span class="s-any">–</span>',
  anybar: '<span class="s-bar any"><i>BAR</i></span>',
};

const mod = (a, n) => ((a % n) + n) % n;
/** ease out with a little overshoot: the reel bumps past and settles back */
const settleEase = (t) => { const s = 1.4; t -= 1; return t * t * ((s + 1) * t + s) + 1; };

export class SlotMachine {
  constructor(game) {
    this.game = game;
    this.pulls = 0;
    this.bet = 10;
    this.spinning = false;
    this.built = false;
    this.reels = [];
    this.stops = [0, 0, 0];
  }

  // ------------------------------- building ----------------------------------
  _build() {
    if (this.built) return;
    this.built = true;
    const wrap = $('slot-reels');
    wrap.innerHTML = '';
    REELS.forEach((strip, r) => {
      const reel = document.createElement('div');
      reel.className = 'reel';
      const inner = document.createElement('div');
      inner.className = 'strip';
      let html = '';
      for (let k = 0; k < COPIES; k++) for (const s of strip) html += `<div class="sym sym-${s}">${SYM[s]}</div>`;
      inner.innerHTML = html;
      reel.appendChild(inner);
      wrap.appendChild(reel);
      this.reels.push({ el: reel, strip: inner, o: BASE + mod(r * 7 - 1, N), state: 'idle' });
    });
    // the marquee's bulbs
    for (const b of document.querySelectorAll('#slots-panel .bulbs')) b.innerHTML = '<i></i>'.repeat(28);
    // the arm: grab it and drag it down, or just click it
    const lever = $('slot-lever');
    let drag = null;
    const setPull = (f) => lever.style.setProperty('--pull', f.toFixed(3));
    lever.addEventListener('pointerdown', (e) => {
      if (this.spinning) return;
      drag = { y: e.clientY, moved: false, fired: false };
      lever.setPointerCapture(e.pointerId);
      lever.classList.add('held');
    });
    lever.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const f = Math.max(0, Math.min(1, (e.clientY - drag.y) / 140));
      if (f > 0.05) drag.moved = true;
      setPull(f);
      if (f > 0.8 && !drag.fired) { drag.fired = true; Audio.play('lever'); this.pull(false); }
    });
    const release = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      lever.classList.remove('held');
      if (!d.moved && !d.fired) { this.pull(); return; }   // a click: the arm pulls itself
      setPull(0);
    };
    lever.addEventListener('pointerup', release);
    lever.addEventListener('pointercancel', release);
    for (const b of document.querySelectorAll('#slots-panel .stop-btn')) {
      b.onclick = () => this.stop(parseInt(b.dataset.reel, 10));
    }
    $('slots-spin').onclick = () => this.pull();
    this._layout();
    addEventListener('resize', () => this._layout());
  }

  /** symbol height comes from the CSS (it scales with the window) */
  _layout() {
    const r = this.reels[0];
    if (!r) return;
    this.cell = r.el.clientHeight / 3 || 96;
    for (const reel of this.reels) this._place(reel);
  }

  _place(reel) {
    reel.strip.style.transform = `translate3d(0, ${(-reel.o * this.cell).toFixed(1)}px, 0)`;
  }

  // ------------------------------- the visit ---------------------------------
  /** sit down with pulls already paid for; bet = what each pull cost */
  open(pulls, bet) {
    this._build();
    leanWithMouse($('slots-panel'));
    this.pulls = pulls;
    this.bet = Math.max(5, bet);
    this.lastWin = 0;
    $('slots-win').textContent = '0';
    $('slot-coins').innerHTML = '';
    $('slot-paylines').innerHTML = '';
    this._lineTabs([]);
    this._renderPaytable([]);
    this._meters();
    this._status(`${pulls} pulls at ${this.bet} chips each. Five lines, every pull.`);
    requestAnimationFrame(() => this._layout());
  }

  _meters() {
    $('slots-pulls').textContent = this.pulls;
    $('slots-bet').textContent = this.bet;
    $('slots-chips').textContent = this.game.chips;
    const spin = $('slots-spin');
    spin.disabled = this.spinning || this.pulls <= 0;
    spin.textContent = this.pulls > 0 ? 'SPIN' : 'NO PULLS';
    const close = $('slots-close');
    close.disabled = this.spinning;
    close.textContent = this.pulls > 0 ? `LEAVE (${this.pulls} PULL${this.pulls === 1 ? '' : 'S'} UNUSED) ▸` : 'BACK TO THE SHOP ▸';
    for (const b of document.querySelectorAll('#slots-panel .stop-btn')) {
      const r = this.reels[parseInt(b.dataset.reel, 10)];
      b.disabled = !this.spinning || !r || r.state !== 'spin';
    }
  }

  _status(t) { $('slots-status').textContent = t; }

  /** chips a line pays at this bet */
  chipsFor(coins) { return Math.round(coins * this.bet / COINS_PER_PULL); }

  _renderPaytable(hitKeys) {
    const hit = new Set(hitKeys);
    $('slots-paytable').innerHTML = SLOT_PAYTABLE.map((row) => {
      const combo = row.combo.map((s) => `<span class="mini">${SYM[s] || ''}</span>`).join('');
      return `<div class="pt-row${hit.has(row.key) ? ' hit' : ''}"><span class="pt-combo">${combo}</span>`
        + `<span class="pt-pay">${this.chipsFor(row.coins)}${row.note ? ` <em>${row.note}</em>` : ''}</span></div>`;
    }).join('') + '<div class="pt-note">per line · a WILD in the line doubles it</div>';
  }

  _lineTabs(lines) {
    const on = new Set(lines);
    for (const t of document.querySelectorAll('#slots-panel .line-tabs i')) {
      const l = parseInt(t.dataset.line, 10);
      t.classList.toggle('on', on.has(l));
      t.style.setProperty('--lc', LINE_COLORS[l]);
    }
  }

  // --------------------------------- pulling ---------------------------------
  /** drop the arm: the result is decided now, then the reels have their show */
  pull(animateLever = true) {
    if (this.spinning || this.pulls <= 0) {
      if (!this.spinning) { Audio.play('dryfire'); this._status('No pulls left. Buy another bandit card in the shop.'); }
      return;
    }
    const g = this.game;
    this.pulls--;
    this.spinning = true;
    this.stops = spinSlotMachine(Seed.rng('slots'));
    $('slot-coins').innerHTML = '';
    $('slot-paylines').innerHTML = '';
    $('slots-win').textContent = '0';
    this._lineTabs([]);
    this._renderPaytable([]);
    $('slots-panel').classList.remove('party', 'jackpot');
    for (const el of document.querySelectorAll('#slot-reels .sym.win')) el.classList.remove('win');
    const lever = $('slot-lever');
    if (animateLever) {
      Audio.play('lever');
      lever.classList.add('auto');
      lever.style.setProperty('--pull', '1');
      setTimeout(() => { lever.style.setProperty('--pull', '0'); lever.classList.remove('auto'); }, 260);
    } else setTimeout(() => lever.style.setProperty('--pull', '0'), 60);
    const t0 = performance.now();
    this.reels.forEach((r, i) => {
      r.o = BASE + mod(r.o, N);                  // same symbols, top of the strip
      r.state = 'spin';
      r.start = t0;
      r.autoStop = t0 + 900 + i * 480;
      r.stopAt = r.autoStop;
      r.el.classList.add('spinning');
    });
    this._status('Round and round…');
    this._meters();
    g.saveRun();                                   // the pull is spent the moment the arm drops
    this._last = t0;
    Audio.play('slot_spin');
    requestAnimationFrame((t) => this._tick(t));
  }

  /** skill-stop: bring one reel in early */
  stop(i) {
    const r = this.reels[i];
    if (!this.spinning || !r || r.state !== 'spin') return;
    r.stopAt = Math.max(performance.now(), r.start + 320);
    // a reel can't pass the one to its left, the way the mechanism works
    for (let j = 0; j < i; j++) if (this.reels[j].state === 'spin') this.reels[j].stopAt = Math.min(this.reels[j].stopAt, r.stopAt);
  }

  /** press anything: stop the next reel still turning */
  stopNext() {
    const i = this.reels.findIndex((r) => r.state === 'spin');
    if (i >= 0) this.stop(i);
  }

  _tick(now) {
    const dt = Math.min(0.1, (now - this._last) / 1000);
    this._last = now;
    let live = false;
    this.reels.forEach((r, i) => {
      if (r.state === 'spin') {
        live = true;
        const age = (now - r.start) / 1000;
        // a little kick back up as the arm drops, then up to speed
        const v = age < 0.08 ? -6 : SPEED * Math.min(1, (age - 0.08) / 0.22);
        r.o -= v * dt;
        // told to stop: pick the next pass of the landing symbol, run on at
        // full speed until it's nearly in the window, then brake onto it
        if (now >= r.stopAt && age > 0.3 && r.to === undefined) {
          const want = mod(this.stops[i] - 1, N);
          let target = Math.floor(r.o - 2.6);
          target -= mod(target - want, N);
          r.to = target;
        }
        if (r.to !== undefined && r.o - r.to <= 2.6) {
          r.state = 'stopping';
          r.from = r.o; r.t = 0;
          r.dur = Math.max(0.25, (r.from - r.to) * 4.4 / SPEED);   // no lurch: brakes from the speed it had
        }
      } else if (r.state === 'stopping') {
        live = true;
        r.t += dt;
        const k = Math.min(1, r.t / r.dur);
        r.o = r.from + (r.to - r.from) * settleEase(k);
        if (k >= 1) {
          r.o = r.to;
          r.to = undefined;
          r.state = 'idle';
          r.el.classList.remove('spinning');
          Audio.play('reel_stop');
          this._meters();
        }
      }
      r.el.classList.toggle('blur', r.state === 'spin' && (now - r.start) > 180);
      this._place(r);
    });
    if (live) { requestAnimationFrame((t) => this._tick(t)); return; }
    this._settle();
  }

  // --------------------------------- paying ----------------------------------
  _settle() {
    const g = this.game;
    for (const r of this.reels) { r.o = BASE + mod(r.o, N); this._place(r); }
    const win = slotWindow(this.stops);
    const res = evalSlotWindow(win);
    const chips = this.chipsFor(res.coins);
    this.spinning = false;
    // light the winning symbols and lines
    for (const w of res.wins) {
      w.rows.forEach((row, reel) => {
        const r = this.reels[reel];
        const idx = Math.round(r.o) + row;
        r.strip.children[idx]?.classList.add('win');
      });
    }
    this._drawLines(res.wins);
    this._lineTabs(res.wins.map((w) => w.line));
    this._renderPaytable(res.wins.map((w) => w.key));
    if (chips > 0) {
      g.addChips(chips);
      this._countUp(chips);
      this._coins(chips);
      const top = res.wins.some((w) => w.key === 'wild' || w.key === 'seven');
      $('slots-panel').classList.add(top ? 'jackpot' : 'party');
      Audio.play(top || chips >= this.bet * 8 ? 'jackpot' : 'slot_win');
      if (top) g.ui.banner(res.wins.some((w) => w.key === 'wild') ? '★ ★ ★ WILD JACKPOT ★ ★ ★' : '7 · 7 · 7 — JACKPOT!', 'gold', 2600);
    }
    const extras = [];
    if (res.heal) {
      const lines = res.wins.filter((w) => w.key === 'heart').length;
      g.player.heal(20 * lines);
      extras.push(`+${20 * lines} HP`);
    }
    if (res.ammo) {
      const lines = res.wins.filter((w) => w.key === 'bell').length;
      if (lines >= 2) { g.weapons.refillAll(); extras.push('AMMO REFILLED'); }
      else { g.weapons.addReservePct(0.4); extras.push('+40% AMMO'); }
    }
    const names = res.wins.map((w) => w.name).join(' · ');
    this._status(res.wins.length
      ? `${names} — WIN ${chips} CHIPS${extras.length ? ' · ' + extras.join(' · ') : ''}`
      : (this.pulls > 0 ? 'Nothing on the lines. Pull again.' : 'Nothing on the lines. That was the last pull.'));
    this._meters();
    g.ui.updateHUD();
    g.saveRun();
  }

  _drawLines(wins) {
    const svg = $('slot-paylines');
    svg.innerHTML = wins.map((w) => {
      const pts = w.rows.map((row, reel) => `${50 + reel * 100},${50 + row * 100}`).join(' ');
      return `<polyline points="${pts}" style="--lc:${LINE_COLORS[w.line]}" />`;
    }).join('');
  }

  _countUp(total) {
    const el = $('slots-win');
    const t0 = performance.now(), dur = Math.min(1600, 400 + total * 3);
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = Math.round(total * k);
      if (k < 1) requestAnimationFrame(step);
      else $('slots-chips').textContent = this.game.chips;
    };
    requestAnimationFrame(step);
  }

  /** coins rattle down into the tray */
  _coins(chips) {
    const tray = $('slot-coins');
    const n = Math.min(40, 3 + Math.round(chips / (this.bet * 0.6)));
    let html = '';
    for (let i = 0; i < n; i++) {
      html += `<i class="coin" style="left:${(4 + Math.random() * 88).toFixed(1)}%;animation-delay:${(i * 45)}ms;--r:${(Math.random() * 60 - 30).toFixed(0)}deg;--y:${(Math.random() * 10).toFixed(0)}px"></i>`;
    }
    tray.innerHTML = html;
    for (let i = 0; i < Math.min(8, n); i++) setTimeout(() => Audio.play('coin_drop'), 120 + i * 90);
  }

  /** keys at the machine: SPACE pulls (or stops the next reel), 1–3 stop reels */
  key(code) {
    if (code === 'Space' || code === 'Enter') { if (this.spinning) this.stopNext(); else this.pull(); return true; }
    const i = { Digit1: 0, Digit2: 1, Digit3: 2 }[code];
    if (i !== undefined) { this.stop(i); return true; }
    return false;
  }
}
