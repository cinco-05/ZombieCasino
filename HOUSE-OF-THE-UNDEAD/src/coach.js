// coach.js — the first night's tips. A small card on the left of the screen
// that shows each tip once, the first time it matters: how to move, what the
// chips are for, how to buy, how to get out of trouble. It never blocks a shot
// and never repeats itself. Settings → "Tips for new players" brings them back.

import { Binds } from './input.js';

const KEY = 'hotu_tips_v1';
const $ = (id) => document.getElementById(id);

const k = (a) => `<kbd>${Binds.label(a)}</kbd>`;

export const TIPS = {
  move: () => ['THE FLOOR IS OPEN', `<kbd>${Binds.moveLabel()}</kbd> move · <kbd>MOUSE</kbd> aim · <kbd>LEFT CLICK</kbd> fire · <kbd>RIGHT CLICK</kbd> iron sights. ${k('dash')} dashes straight through a crowd.`],
  chips: () => ['EVERY KILL PAYS', 'The dead pay out in chips, and dropped stacks fly to you. Kill fast to build a <b>streak</b>: the payout climbs with it.'],
  buy: () => ['SPEND IT ON THE FLOOR', `Walk up to anything glowing and press ${k('use')}: cocktail perks, doors to new wings, the Big Six wheel.`],
  hurt: () => ['GETTING CHEWED ON?', `${k('dash')} out of the crowd. The house comps you up to 50 HP after every round you clear.`],
  reload: () => ['OUT OF ROUNDS', `${k('reload')} reloads. ${k('melee')} pistol-whips anything too close. ${k('lethal')} throws your lethal.`],
  gear: () => ['YOUR GEAR', `${k('lethal')} throws a chip bomb (or whatever lethal you packed). ${k('tactical')} uses your tactical. Spend them well: mystery cards in the shop restock them.`],
  guns: () => ['A NEW GUN', `${k('gun1')} ${k('gun2')} ${k('gun3')} or the <kbd>WHEEL</kbd> switch guns.`],
  objective: () => ['A SIDE BET', 'Some rounds come with a side bet (top right). Make it for bonus chips. Missing it costs nothing.'],
  coop: () => ['PLAYING WITH FRIENDS', `Hold ${k('scores')} to see everyone's ping, kills and chips. If a friend goes down, stand over them and hold ${k('use')}.`],
};

export class Coach {
  constructor(game) {
    this.game = game;
    try { this.seen = new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { this.seen = new Set(); }
    this.queue = [];
    this.showing = null;
    this.t = 0;
  }

  get on() { return this.game.settings.tips !== false; }

  /** show a tip the first time it comes up (queued behind the one on screen) */
  tip(id) {
    if (!this.on || this.seen.has(id) || !TIPS[id]) return;
    if (this.showing === id || this.queue.includes(id)) return;
    if (id === 'move') this.queue.unshift(id);       // first things first
    else this.queue.push(id);
  }

  /** forget every tip, so a new player on this machine sees them all */
  reset() {
    this.seen.clear();
    this._save();
  }

  _save() { try { localStorage.setItem(KEY, JSON.stringify([...this.seen])); } catch { /* private mode */ } }

  /** per frame (combat only; anywhere else the card waits) */
  update(dt) {
    const el = $('coach');
    if (!el) return;
    const g = this.game;
    if (g.state !== 'COMBAT') { if (this.showing) this._hide(el, false); return; }
    if (this.showing) {
      this.t -= dt;
      if (this.t <= 0) this._hide(el, true);
      return;
    }
    if (this._gap > 0) { this._gap -= dt; return; }
    const id = this.queue.shift();
    if (!id) return;
    if (this.seen.has(id)) return;
    const [title, body] = TIPS[id]();
    el.innerHTML = `<div class="coach-tag">TIP</div><div class="coach-title">${title}</div><div class="coach-body">${body}</div><i class="coach-timer"></i>`;
    el.classList.add('show');
    this.showing = id;
    this.t = 7.5;
    el.style.setProperty('--life', `${this.t}s`);
  }

  _hide(el, done) {
    if (done) { this.seen.add(this.showing); this._save(); }
    else this.queue.unshift(this.showing);           // interrupted: it comes back next fight
    el.classList.remove('show');
    this.showing = null;
    this._gap = 1.2;
  }
}
