// shop.js — THE HOUSE SHOP. Between rounds the house lays out a random row of
// cards (Balatro-style): table cards (a seat at blackjack / roulette / poker at
// a set stake), slot pulls, supplies, charms, the odd mystery or upgrade. Every
// visit rolls fresh — some nights the shelf is stacked, some nights it's junk.
// Prices are random but pinned to your bankroll so most of it stays in reach.

import { CONFIG } from './config.js';
import { GUNS, LETHALS, TACTICALS } from './catalog.js';
import { gunBars } from './coatcheck.js';
import { Seed } from './rng.js';

// every shelf is dealt from the run's seed
const R = () => Seed.random('shop');

export const TABLE_GAMES = {
  blackjack: { name: 'BLACKJACK', icon: '♠', blurb: 'Beat the dealer to 21. Split pairs, double down. A natural pays a tier higher.' },
  roulette: { name: 'ROULETTE', icon: '◉', blurb: 'Put your chip on a color, a half or one number. A straight-up hit pays a tier up.' },
  poker: { name: 'FIVE CARD DRAW', icon: '♣', blurb: 'One draw vs the dealer. A flush or better pays a tier up.' },
};

export const TIERS = {
  common:    { label: 'COMMON', penalty: 'mild',     range: [45, 80],   cap: 0.55 },
  rare:      { label: 'RARE', penalty: 'moderate',   range: [100, 165], cap: 0.8 },
  legendary: { label: 'LEGENDARY', penalty: 'severe', range: [185, 290], cap: 1.1 },
};

const SUPPLIES = {
  heal:     { name: 'FIRST AID', icon: '✚', desc: '+35 health, right now.', range: [35, 60] },
  fullheal: { name: 'SMELLING SALTS', icon: '♥', desc: 'Back to full health.', range: [90, 140] },
  ammo:     { name: 'AMMO CRATE', icon: '⁍', desc: 'Every gun refilled, mags and reserves.', range: [50, 85] },
  armor:    { name: 'KEVLAR VEST', icon: '◆', desc: '+50 armor.', range: [70, 120] },
};

const SPECIALS = {
  charm:     { name: 'LUCKY CHARM', icon: '✤', desc: 'Your next table win pays one tier higher.', range: [55, 95] },
  insurance: { name: 'HOUSE INSURANCE', icon: '⛨', desc: 'Your next table loss brings no penalty.', range: [45, 85] },
  mystery:   { name: 'MYSTERY CARD', icon: '?', desc: 'Could be anything. Could be nothing.', range: [30, 70] },
};

const round5 = (n) => Math.max(5, Math.round(n / 5) * 5);
const rnd = (a, b) => a + R() * (b - a);
const weighted = (entries) => {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = R() * total;
  for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
  return entries[0][0];
};

export class Shop {
  constructor(game) {
    this.game = game;
    this.cards = [];
    this.rerolls = 0;
  }

  get slotCount() { return 4 + (this.game.vault?.value('regular', 0) ? 1 : 0); }
  get comped() { return this.game.vault?.value('comped', 1) || 1; }

  rerollCost() { return round5((20 + 12 * this.rerolls) * this.comped); }

  /**
   * random price in a range, scaled up a little each round, then pinned to the
   * bankroll: never above cap x chips unless that would undercut the range floor
   */
  _price(range, cap = 1.2) {
    const g = this.game;
    const scale = 1 + 0.06 * Math.max(0, g.round - 1);
    let p = rnd(range[0], range[1]) * scale;
    const within = Math.max(range[0], g.chips * cap);
    p = Math.min(p, within);
    return round5(p * this.comped);
  }

  _tableCard(game = null) {
    const g = this.game;
    const legendary = Math.min(0.25, 0.07 + 0.017 * g.round);
    const tier = weighted([['common', 0.6], ['rare', 0.32], ['legendary', legendary]]);
    game = game || weighted([['blackjack', 0.38], ['roulette', 0.34], ['poker', 0.28]]);
    return { kind: 'table', game, tier, price: this._price(TIERS[tier].range, TIERS[tier].cap) };
  }

  /** a lethal or tactical: usually a restock of what you carry, sometimes something new */
  _gearCard() {
    const g = this.game, p = g.player;
    const slot = R() < 0.5 ? 'lethal' : 'tactical';
    const table = slot === 'lethal' ? LETHALS : TACTICALS;
    const mine = slot === 'lethal' ? p.lethalId : p.tacticalId;
    const keys = Object.keys(table);
    const key = R() < 0.45 && mine ? mine : keys[Math.floor(R() * keys.length)];
    const def = table[key];
    const count = key === 'eye' ? 1 : R() < 0.35 ? 2 : 1;
    const base = key === 'eye' ? [95, 140] : key === 'jackpot' ? [70, 110] : slot === 'lethal' ? [40, 70] : [35, 65];
    const range = [base[0] * (count === 2 ? 1.7 : 1), base[1] * (count === 2 ? 1.7 : 1)];
    return { kind: 'gear', slot, key, count, price: this._price(range, 0.6), swap: key !== mine, def };
  }

  _weaponCard() {
    const g = this.game;
    const pool = Object.keys(GUNS).filter((id) => !g.weapons.owns(id) && GUNS[id].cat !== 'wonder');
    const id = pool[Math.floor(R() * pool.length)];
    const special = GUNS[id].cat === 'special';
    return { kind: 'weapon', gun: id, price: this._price(special ? [280, 380] : [170, 250], 1.4) };
  }

  _card() {
    const kind = weighted([['table', 0.36], ['slots', 0.08], ['supply', 0.2], ['gear', 0.18], ['special', 0.08], ['weapon', 0.06], ['upgrade', 0.04]]);
    if (kind === 'table') return this._tableCard();
    if (kind === 'slots') {
      const pulls = R() < 0.3 ? 5 : 3;
      return { kind: 'slots', pulls, price: this._price(pulls === 5 ? [85, 130] : [50, 85], 0.6) };
    }
    if (kind === 'supply') {
      const key = weighted([['heal', 0.3], ['fullheal', 0.15], ['ammo', 0.33], ['armor', 0.22]]);
      return { kind: 'supply', key, price: this._price(SUPPLIES[key].range, 0.7) };
    }
    if (kind === 'gear') return this._gearCard();
    if (kind === 'weapon') return this._weaponCard();
    if (kind === 'special') {
      const key = weighted([['charm', 0.34], ['insurance', 0.33], ['mystery', 0.33]]);
      return { kind: 'special', key, price: this._price(SPECIALS[key].range, 0.7) };
    }
    const g = this.game;
    // a straight-up attachment, no gamble — pricey, and not always there
    const pool = g.upgrades._attachmentCards('rare');
    if (!pool.length) return this._tableCard();
    const up = pool[Math.floor(R() * pool.length)];
    return { kind: 'upgrade', up, price: this._price([140, 220], 1.3) };
  }

  /** fresh shelf for this visit */
  roll() {
    const g = this.game;
    const cards = [];
    for (let i = 0; i < this.slotCount; i++) cards.push(this._card());
    // the odd sale
    for (const c of cards) {
      if (c.price > 0 && R() < 0.16) { c.sale = true; c.price = round5(c.price * 0.7); }
    }
    // broke? the house extends one free hand, once per visit
    const cheapest = Math.min(...cards.map((c) => c.price));
    if (g.chips < Math.max(45, cheapest) && !g.casino.houseCreditUsed) {
      const i = cards.findIndex((c) => c.kind !== 'table');
      cards[i >= 0 ? i : 0] = { kind: 'table', game: 'blackjack', tier: 'common', price: 0, credit: true };
    } else if (g.chips >= 30 && cards.every((c) => c.price > g.chips)) {
      // never a wall of nothing you can touch — mark the cheapest one down
      const c = cards.reduce((a, b) => (a.price < b.price ? a : b));
      c.sale = true;
      c.price = round5(Math.max(20, g.chips * 0.8) - 2);
    }
    cards.forEach((c, i) => { c.id = i; c.sold = false; });
    this.cards = cards;
    this._fresh = true;   // the next render deals the cards in
  }

  // ------------------------------- rendering --------------------------------
  describe(c) {
    if (c.kind === 'table') {
      const G = TABLE_GAMES[c.game], T = TIERS[c.tier];
      return {
        type: c.credit ? 'HOUSE CREDIT' : 'TABLE',
        badge: T.label, icon: G.icon, name: G.name,
        desc: G.blurb,
        terms: `<b>Win:</b> ${T.label.toLowerCase()} upgrade${c.credit ? '' : ', stake ×2'}<br><b>Lose:</b> ${T.penalty} penalty`,
      };
    }
    if (c.kind === 'slots') {
      const per = Math.round(c.price / c.pulls);
      return { type: 'SLOTS', badge: `${c.pulls} PULLS`, icon: '7', name: 'ONE-ARMED BANDIT',
        desc: `${c.pulls} pulls on LUCKY UNDEAD: sevens, BARs, cherries and wilds on five lines. Hearts heal, bells bring ammo.`,
        terms: `<b>${per}</b> chips a pull · <b>7·7·7</b> pays ${per * 20} a line<br>Pays back ~110% on average` };
    }
    if (c.kind === 'supply') {
      const S = SUPPLIES[c.key];
      return { type: 'SUPPLY', badge: '', icon: S.icon, name: S.name, desc: S.desc };
    }
    if (c.kind === 'special') {
      const S = SPECIALS[c.key];
      return { type: 'CHARM', badge: '', icon: S.icon, name: S.name, desc: S.desc };
    }
    if (c.kind === 'gear') {
      const p = this.game.player;
      const cur = c.slot === 'lethal' ? LETHALS[p.lethalId] : TACTICALS[p.tacticalId];
      return {
        type: c.slot === 'lethal' ? 'LETHAL · G' : 'TACTICAL · T', badge: `×${c.count}`, icon: c.def.icon, name: c.def.name, desc: c.def.blurb,
        terms: c.swap && cur ? `<b>Swaps out:</b> your ${cur.name}` : '<b>Restock</b> — tops up what you carry',
      };
    }
    if (c.kind === 'weapon') {
      const G = GUNS[c.gun];
      const w = this.game.weapons;
      const full = w.slots.slice(0, w.maxSlots).every(Boolean);
      const bars = gunBars(c.gun).filter(([n]) => n !== 'RELOAD')
        .map(([n, v]) => `<div class="co-bar"><span>${n}</span><i style="--v:${(v * 100).toFixed(0)}%"></i></div>`).join('');
      return {
        type: G.cat === 'special' ? 'HOUSE SPECIAL' : 'WEAPON', badge: G.cat === 'special' ? 'RARE FIND' : '', icon: G.icon, name: G.name,
        desc: G.blurb,
        terms: `<div class="co-bars sc-bars">${bars}</div>${full ? `<b>Swaps for:</b> the ${w.current.name} in your hands` : '<b>Fills</b> your empty slot'}`,
      };
    }
    // a straight-up attachment: show exactly what it does to that gun
    const rows = c.up.stats().map((s) => `<b>${s.label}</b> ${s.fmt(s.from)} → ${s.fmt(s.to)}${s.unit || ''}`).join('<br>');
    return { type: 'UPGRADE', badge: 'NO GAMBLE', icon: c.up.icon || '✦', name: c.up.title, desc: `On the <b>${c.up.sub}</b>: ${c.up.desc}`, terms: rows };
  }

  render(el, onBuy) {
    const g = this.game;
    const deal = this._fresh;
    this._fresh = false;
    el.innerHTML = '';
    this.cards.forEach((c, i) => {
      const d = this.describe(c);
      const poor = !c.sold && c.price > g.chips;
      const card = document.createElement('button');
      card.className = `scard kind-${c.kind}${c.tier ? ' tier-' + c.tier : ''}${c.kind === 'special' ? ' sp-' + c.key : ''}`
        + `${c.sold ? ' sold' : ''}${poor ? ' poor' : ''}${c.sale ? ' sale' : ''}${c.credit ? ' credit' : ''}${deal ? ' deal' : ''}`;
      card.style.animationDelay = `${i * 70}ms`;
      card.innerHTML = `
        <div class="sc-top"><span class="sc-type">${d.type}</span>${d.badge ? `<span class="sc-badge">${d.badge}</span>` : ''}</div>
        <div class="sc-icon">${d.icon}</div>
        <div class="sc-name">${d.name}</div>
        <div class="sc-desc">${d.desc}</div>
        ${d.terms ? `<div class="sc-terms">${d.terms}</div>` : ''}
        <div class="sc-foot">${c.sale ? '<span class="sc-sale">SALE</span>' : ''}<span class="sc-price">${c.price === 0 ? 'FREE' : c.price}</span></div>
        ${c.sold ? '<div class="sc-stamp">SOLD</div>' : ''}`;
      card.disabled = c.sold;
      card.onclick = () => onBuy(i);
      el.appendChild(card);
    });
  }
}

export { SUPPLIES, SPECIALS };
export const SHOP_INTERMISSION = CONFIG.intermissionSeconds;
