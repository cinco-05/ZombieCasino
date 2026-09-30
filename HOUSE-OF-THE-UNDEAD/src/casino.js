// casino.js — the between-rounds loop. THE HOUSE SHOP (shop.js) lays out a
// random row of cards each visit; buying a TABLE card seats you straight at
// that game at that stake (no game picker, no bet slider). Win: the card's
// upgrade tier + your stake back double. Lose: the card's penalty next round.
// Also here: the games themselves, played on 3D felt (tables.js): blackjack
// with splits and doubles, roulette on a real layout, five card draw, the
// one-armed bandit (slots.js), plus charms and penalty resolution. Every
// card, spin and pull is dealt from the run's seed (rng.js).

import { CONFIG, clamp } from './config.js';
import {
  newDeck, handValue, isBlackjack, resolveBlackjack, canSplit, resolveSplitHand, cardValue,
  spinRoulette, evaluateRouletteBet, WHEEL_ORDER, pocketColor,
  evaluatePokerHand, comparePoker, pokerTier, dealerHolds,
} from './cards.js';
import { Audio } from './audio.js';
import { Shop, TIERS, TABLE_GAMES } from './shop.js';
import { LETHALS, TACTICALS, DRINKS } from './catalog.js';
import { Seed } from './rng.js';
import { SlotMachine } from './slots.js';
import {
  dealCard, flipUp, sweepCards, chipStacksHtml, flyChips, stamp, leanWithMouse, rackHtml, dealerName,
} from './tables.js';

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const TIER_UP = { common: 'rare', rare: 'legendary', legendary: 'legendary' };

// ---------------------------- penalties -------------------------------------
const PENALTIES = {
  mild: [
    { label: 'Enemies move 10% faster', mod: { speedMult: 1.1 } },
    { label: '15% more enemies next round', mod: { countMult: 1.15 } },
    { label: '-20% reserve ammunition', immediate: (g) => g.weapons.applyReservePenalty(0.8) },
    { label: 'Healing drops are scarcer', mod: { healDropMult: 0.4 } },
  ],
  moderate: [
    { label: 'An extra special enemy joins the round', mod: { extraSpecial: 1 } },
    { label: 'Enemies deal 15% more damage', mod: { dmgMult: 1.15 } },
    { label: 'Threat indicator disabled', mod: { noIndicator: true } },
    { label: 'The lights go low', mod: { lowLight: true } },
    { label: '30% more enemies next round', mod: { countMult: 1.3 } },
  ],
  severe: [
    { label: 'THE DEBT COLLECTOR is coming for you', mod: { debtCollector: true } },
    { label: 'Two moderate penalties at once', compound: 2 },
    { label: 'Reserve ammunition halved', immediate: (g) => g.weapons.applyReservePenalty(0.5) },
    { label: 'Elite zombies join the horde', mod: { elite: true } },
    { label: 'Double special enemies', mod: { extraSpecial: 2, countMult: 1.15 } },
  ],
};

export class Casino {
  constructor(game) {
    this.game = game;
    this.timer = 0;
    this.timerRunning = false;
    this.houseCreditUsed = false;
    this.pendingMods = [];    // penalties queued for next round: {label, mod}
    this.roundMods = {};      // merged mods active THIS round
    this.currentWager = null; // the table card in play: {amount, tier, penalty, credit, game}
    this.charms = { luck: 0, insurance: 0 };
    this.bj = null;
    this.poker = null;
    this.rouletteBet = null;
    this.shop = new Shop(game);
    this.slots = new SlotMachine(game);
    this._wireStaticButtons();
  }

  reset() {
    this.pendingMods = [];
    this.roundMods = {};
    this.currentWager = null;
    this.houseCreditUsed = false;
    this.timerRunning = false;
    this.charms = { luck: 0, insurance: 0 };
  }

  activePenaltyLabels() { return this.pendingMods.map((p) => p.label); }

  // ============================ intermission =================================
  beginIntermission() {
    const g = this.game;
    this.houseCreditUsed = false;
    this.timer = CONFIG.intermissionSeconds;
    this.timerRunning = true;
    if (g.playerMods.interest > 0) {
      g.addChips(g.playerMods.interest);
      g.ui.banner(`CARD COUNTER: +${g.playerMods.interest} chips`, 'cyan', 1600);
    }
    $('inter-round').textContent = g.round >= 10 && g.beatHouse
      ? `ROUND ${g.round} CLEARED — THE FLOOR STAYS OPEN`
      : `ROUND ${g.round} CLEARED`;
    $('inter-next').textContent = `NEXT: ROUND ${g.round + 1}${g.isBossRound(g.round + 1) ? ' — BOSS' : ''}`;
    $('btn-cashout').style.display = g.beatHouse ? '' : 'none';
    $('shop-seed').innerHTML = `SEED <b>${Seed.text}</b>`;
    this.shop.rerolls = 0;
    this.shop.roll();
    this.updateChipsUI();
    g.ui.irisSwap(() => { if (g.state === 'INTERMISSION') g.ui.show('intermission'); });   // 1930s: iris out, iris in on the shop
    Audio.play('door');
    g.saveRun();
  }

  updateTimer(dt) {
    if (!this.timerRunning) return;
    this.timer -= dt;
    $('inter-timer').textContent = `The doors open in ${Math.max(0, Math.ceil(this.timer))}s`;
    if (this.timer <= 0) this.startNextRound();
  }

  startNextRound() {
    if (this.game.net.active && !this.game.net.readyToGo(this)) return;   // co-op: both gamblers ready
    this.game.ui.prompt('', 1);
    this.timerRunning = false;
    this.game.ui.hideAllPanels();
    this.game.startNextRound();
  }

  updateChipsUI() {
    const g = this.game;
    for (const el of document.querySelectorAll('.chip-balance')) {
      el.textContent = `${g.chips} CHIPS`;
    }
    const sc = $('slots-chips');
    if (sc && !this.slots.spinning) sc.textContent = g.chips;
    this.renderShop();
  }

  // ================================ the shop ==================================
  renderShop() {
    const el = $('shop-cards');
    if (!el) return;
    this.shop.render(el, (i) => this.buy(i));
    const cost = this.shop.rerollCost();
    const rr = $('btn-reroll');
    rr.innerHTML = `REROLL <span class="rr-cost">${cost}</span>`;
    rr.classList.toggle('poor', this.game.chips < cost);
    // where you stand: health, armor, bombs, ammo
    const g = this.game, p = g.player, w = g.weapons.current;
    const L = LETHALS[p.lethalId], T = TACTICALS[p.tacticalId];
    $('shop-vitals').innerHTML =
      `<span class="sv hp${p.hp < 35 ? ' low' : ''}">♥ ${Math.ceil(p.hp)}<small>/${p.maxHp}</small></span>`
      + (p.armor > 0 ? `<span class="sv ar">◆ ${Math.round(p.armor)}</span>` : '')
      + `<span class="sv bm" title="${L.name}">${L.icon} ${p.grenades}</span>`
      + (T ? `<span class="sv tc" title="${T.name}">${T.icon} ${p.tacticals}</span>` : '')
      + `<span class="sv am">⁍ ${w.mag}<small>/${w.reserve}</small></span>`
      + (g.perks.owned.length ? `<span class="sv dr">${g.perks.owned.map((k) => DRINKS[k].icon).join('')}</span>` : '');
    // queued penalties + charms in play
    const bits = [];
    if (this.charms.luck) bits.push(`<span class="chip-tag luck">✤ LUCKY CHARM ×${this.charms.luck}</span>`);
    if (this.charms.insurance) bits.push(`<span class="chip-tag ins">⛨ INSURED ×${this.charms.insurance}</span>`);
    for (const p of this.pendingMods) bits.push(`<span class="chip-tag pen">⚠ ${p.label}</span>`);
    $('shop-status').innerHTML = bits.join('');
  }

  reroll() {
    const g = this.game;
    const cost = this.shop.rerollCost();
    if (g.chips < cost) { Audio.play('dryfire'); g.ui.prompt('Not enough chips to reroll.'); return; }
    g.chips -= cost;
    this.shop.rerolls++;
    this.shop.roll();
    Audio.play('shuffle');
    this.updateChipsUI();
    g.ui.updateHUD();
  }

  buy(i) {
    const g = this.game;
    const c = this.shop.cards[i];
    if (!c || c.sold) return;
    if (g.chips < c.price) { Audio.play('dryfire'); g.ui.prompt('Not enough chips.'); return; }
    g.chips -= c.price;
    c.sold = true;
    g.saveRun();

    if (c.kind === 'table') {
      if (c.credit) this.houseCreditUsed = true;
      g.stats.gambled += c.price;
      this.currentWager = {
        game: c.game, amount: c.price, tier: c.tier, penalty: TIERS[c.tier].penalty, credit: !!c.credit,
      };
      Audio.play('card');
      this.updateChipsUI();
      g.ui.hide('intermission');
      if (c.game === 'blackjack') { g.setState('BLACKJACK'); this.startBlackjack(); }
      else if (c.game === 'poker') { g.setState('POKER'); this.startPokerHand(); }
      else { g.setState('ROULETTE'); this.startRoulette(); }
      return;
    }
    if (c.kind === 'slots') {
      g.stats.gambled += c.price;
      Audio.play('chip');
      this.openSlots(c.pulls, Math.round(c.price / c.pulls));
      return;
    }
    Audio.play('chip');
    if (c.kind === 'supply') this._applySupply(c.key);
    else if (c.kind === 'special') this._applySpecial(c);
    else if (c.kind === 'gear') {
      if (c.slot === 'lethal') g.setLethal(c.key, c.count); else g.setTactical(c.key, c.count);
      g.ui.banner(`${c.def.icon} ${c.def.name} ×${c.count}`, 'gold', 1600);
    } else if (c.kind === 'weapon') {
      g.weapons.give(c.gun);
      Audio.play('ammo');
    } else if (c.kind === 'upgrade') {
      c.up.apply();
      Audio.play('wager_win');
    }
    this.updateChipsUI();
    g.ui.updateHUD();
    g.saveRun();
  }

  _applySupply(key) {
    const g = this.game;
    if (key === 'heal') g.player.heal(35);
    if (key === 'fullheal') g.player.heal(999);
    if (key === 'ammo') g.weapons.refillAll();
    if (key === 'armor') g.player.addArmor(50);
    const msg = { heal: '+35 HEALTH', fullheal: 'FULLY HEALED', ammo: 'AMMO REFILLED', armor: '+50 ARMOR' };
    g.ui.banner(msg[key], 'gold', 1400);
  }

  _applySpecial(c) {
    const g = this.game;
    if (c.key === 'charm') { this.charms.luck++; g.ui.banner('LUCKY CHARM — your next table win pays higher', 'cyan', 2200); }
    if (c.key === 'insurance') { this.charms.insurance++; g.ui.banner('INSURED — your next table loss is forgiven', 'cyan', 2200); }
    if (c.key === 'mystery') {
      const r = Seed.random('house');
      if (r < 0.32) {
        const win = Math.round(c.price * 2.5 + 20);
        g.chips += win;
        g.ui.banner(`MYSTERY: A FAT ENVELOPE — +${win} CHIPS`, 'gold', 2400);
        Audio.play('jackpot');
      } else if (r < 0.5) {
        g.ui.banner('MYSTERY: A GIFT FROM THE HOUSE', 'gold', 2000);
        Audio.play('wager_win');
        setTimeout(() => g.upgrades.offer('common'), 500);
      } else if (r < 0.64) {
        g.player.heal(30);
        g.player.grenades = Math.min(g.lethalMax(), g.player.grenades + 1);
        g.player.tacticals = Math.min(g.tacticalMax(), g.player.tacticals + 1);
        g.ui.banner('MYSTERY: +30 HEALTH, +1 LETHAL, +1 TACTICAL', 'gold', 2200);
      } else if (r < 0.78) {
        this.charms.luck++;
        g.ui.banner('MYSTERY: A LUCKY CHARM', 'cyan', 2200);
      } else {
        g.ui.banner('MYSTERY: THE CARD IS BLANK', 'red', 2200);
        Audio.play('wager_lose');
      }
    }
  }

  /** result: 'win' | 'loss' | 'push' | 'blackjack'; opts.tierBump for special wins */
  resolveWager(result, opts = {}) {
    const g = this.game;
    const w = this.currentWager;
    this.currentWager = null;
    g.ui.hideAllPanels();

    // whatever happens we land back in the shop
    g.setState('INTERMISSION');
    g.ui.show('intermission');

    // opts.payout: chips coming back, when the game settled it hand by hand (splits)
    if (result === 'push') {
      const back = opts.payout ?? (w.credit ? 0 : w.amount);
      g.chips += back;
      g.ui.banner(back ? `PUSH — ${back} chips back` : 'PUSH — no harm done', 'cyan');
      Audio.play('card');
    } else if (result === 'win' || result === 'blackjack') {
      g.stats.wagersWon++;
      let tier = w.tier;
      const reasons = [];
      if (result === 'blackjack' || opts.tierBump) {
        tier = TIER_UP[tier];
        reasons.push(result === 'blackjack' ? 'BLACKJACK!' : opts.bumpLabel || 'STRAIGHT UP!');
      }
      if (this.charms.luck > 0) {
        this.charms.luck--;
        tier = TIER_UP[tier];
        reasons.push('LUCKY CHARM');
      }
      if (reasons.length) {
        g.ui.banner(`${reasons.join(' + ')} Reward tier upgraded!`, 'gold', 2400);
        Audio.play('jackpot');
      } else {
        Audio.play('wager_win');
      }
      g.chips += opts.payout ?? (w.credit ? 0 : w.amount * 2);   // even-money chips back
      this.updateChipsUI();
      g.saveRun();
      setTimeout(() => g.upgrades.offer(tier), 500);
      return;
    } else {
      Audio.play('wager_lose');
      if (opts.payout) g.chips += opts.payout;   // the hands you did win still pay
      if (this.charms.insurance > 0) {
        this.charms.insurance--;
        g.ui.banner('INSURANCE PAYS OUT — no penalty', 'cyan', 2200);
      } else {
        this.applyPenalty(w.penalty);
        g.ui.banner('THE HOUSE TAKES IT', 'red');
      }
    }
    this.updateChipsUI();
    g.saveRun();
  }

  // ============================== penalties ==================================
  applyPenalty(kind) {
    const g = this.game;
    // HOUSE MARKER: the house collects — next penalty is one step nastier
    if (g.playerMods.markerDebt > 0 && kind !== 'severe') {
      g.playerMods.markerDebt--;
      kind = kind === 'mild' ? 'moderate' : 'severe';
      g.ui.prompt('THE HOUSE REMEMBERS YOUR MARKER — penalty upgraded', 3000);
    }
    const p = Seed.pick('house', PENALTIES[kind]);
    if (p.compound) {
      for (let i = 0; i < p.compound; i++) this.applyPenalty('moderate');
      return;
    }
    if (p.immediate) {
      p.immediate(g);
      g.ui.prompt(`PENALTY: ${p.label}`, 3000);
    } else {
      this.pendingMods.push({ label: p.label, mod: p.mod });
      g.ui.prompt(`PENALTY NEXT ROUND: ${p.label}`, 3000);
    }
    g.ui.updateHUD();
    this.renderShop();
  }

  /** merge queued penalties into this round's mods; called by game.beginRound */
  consumeMods() {
    const merged = {};
    for (const { mod } of this.pendingMods) {
      for (const [k, v] of Object.entries(mod)) {
        if (typeof v === 'number' && typeof merged[k] === 'number') merged[k] *= v;
        else merged[k] = v;
      }
    }
    this.pendingMods = [];
    this.roundMods = merged;
    return merged;
  }

  // ============================ the felt (shared) =============================
  /** sit down: a fresh dealer, the rack, the stake on the felt, the lean */
  _seat(panelId) {
    const panel = $(panelId);
    panel.classList.remove('win-flash', 'lose-flash', 'push-flash', 'win-steady', 'lose-steady', 'dealt');
    for (const n of panel.querySelectorAll('.dealer-name')) n.textContent = dealerName();
    const rack = panel.querySelector('.dealer-rack');
    if (rack) rack.innerHTML = rackHtml();
    leanWithMouse(panel);
    this.updateChipsUI();
    this.game.ui.show(panelId);
    requestAnimationFrame(() => panel.classList.add('dealt'));   // the table swings up into view
    return panel;
  }

  /** the table glows with how it went */
  _flash(panel, result) {
    const rf = this.game.settings.reducedFlash;
    const won = result === 'win' || result === 'blackjack';
    panel.classList.add(won ? (rf ? 'win-steady' : 'win-flash') : result === 'push' ? 'push-flash' : (rf ? 'lose-steady' : 'lose-flash'));
  }

  _wagerInfo(id) { $(id).innerHTML = this._wagerInfoText(); }

  // ============================== blackjack ==================================
  // Split any pair (any two tens too) into up to four hands, each putting up
  // the card's stake again. Double on any first two cards, split hands
  // included. Split aces get one card each. The dealer peeks for a natural.
  startBlackjack() {
    const g = this.game, w = this.currentWager;
    const deck = newDeck(Seed.rng('blackjack'));
    // dealt the way a real table deals: you, the dealer, you, the dealer's hole card
    const p1 = deck.pop(), d1 = deck.pop(), p2 = deck.pop(), d2 = deck.pop();
    const b = this.bj = {
      deck, dealer: [d1, d2], dealerEls: [], hole: null, holeShown: false,
      hands: [{ cards: [p1, p2], stake: w.amount, done: false, aces: false, els: [] }],
      active: 0, busy: true, over: false, base: w.amount,
    };
    const panel = this._seat('blackjack-panel');
    this._wagerInfo('bj-wager-info');
    $('bj-dealer-cards').innerHTML = '';
    $('bj-hands').innerHTML = '';
    $('bj-status').textContent = 'Cards in the air…';
    this._bjBuildHands();
    const shoe = panel.querySelector('.shoe');
    const h = b.hands[0];
    const snd = () => Audio.play('card');
    h.els.push(dealCard(h.fan, p1, { from: shoe, delay: 250, sound: snd }));
    b.dealerEls.push(dealCard($('bj-dealer-cards'), d1, { from: shoe, delay: 520, sound: snd }));
    h.els.push(dealCard(h.fan, p2, { from: shoe, delay: 790, sound: snd }));
    b.hole = dealCard($('bj-dealer-cards'), d2, { from: shoe, delay: 1060, faceDown: true, sound: snd });
    b.dealerEls.push(b.hole);
    this._bjUpdate();
    setTimeout(() => this._bjAfterDeal(), 1500);
  }

  _bjAfterDeal() {
    const g = this.game, b = this.bj;
    if (!b) return;
    b.busy = false;
    const rig = g.debug.forceBJ;
    if (rig) {
      g.debug.forceBJ = null;
      this._bjFinish(rig === 'win' ? 'win' : rig === 'push' ? 'push' : 'loss', {}, 'THE DEBUG PANEL SAYS SO');
      return;
    }
    const h = b.hands[0];
    const up = cardValue(b.dealer[0].rank);
    // the dealer peeks under an ace or a ten
    if ((up === 11 || up === 10) && isBlackjack(b.dealer)) {
      this._bjRevealHole();
      const push = isBlackjack(h.cards);
      stamp(h.el, push ? 'PUSH' : 'LOSE', push ? 'push' : 'lose');
      setTimeout(() => this._bjFinish(push ? 'push' : 'loss', {}, 'THE DEALER HAS BLACKJACK'), 700);
      return;
    }
    if (isBlackjack(h.cards)) {
      this._bjRevealHole();
      stamp(h.el, 'BLACKJACK!', 'win');
      Audio.play('jackpot');
      setTimeout(() => this._bjFinish('blackjack', {}, 'BLACKJACK!'), 900);
      return;
    }
    this._bjUpdate();
  }

  /** each hand is a fan of cards over a betting spot */
  _bjBuildHands() {
    const wrap = $('bj-hands');
    for (const h of this.bj.hands) {
      if (!h.el) {
        h.el = document.createElement('div');
        h.el.className = 'bj-hand';
        h.el.innerHTML = '<div class="card-fan"></div><div class="hand-badge"></div><div class="bet-spot"><span class="stacks"></span><b></b></div>';
        h.fan = h.el.querySelector('.card-fan');
        h.el.onclick = () => { /* the active hand is the one being played; clicks just look */ };
      }
      wrap.appendChild(h.el);                 // re-appending keeps them in hand order
    }
    wrap.dataset.n = this.bj.hands.length;
  }

  _bjCanAfford(amount) { return this.currentWager?.credit || this.game.chips >= amount; }

  _bjUpdate() {
    const b = this.bj;
    if (!b) return;
    const multi = b.hands.length > 1;
    b.hands.forEach((h, i) => {
      const v = handValue(h.cards);
      const hard = h.cards.reduce((s, c) => s + (c.rank === 'A' ? 1 : cardValue(c.rank)), 0);
      const soft = hard !== v;                // an ace is still counting as 11
      const badge = h.el.querySelector('.hand-badge');
      badge.innerHTML = `${multi ? `<small>HAND ${i + 1}</small>` : ''}${v > 21 ? 'BUST' : v}${soft && v < 21 ? '<small>SOFT</small>' : ''}`;
      badge.classList.toggle('bust', v > 21);
      h.el.classList.toggle('active', !b.busy && !b.over && i === b.active && !h.done);
      h.el.classList.toggle('done', h.done);
      h.el.querySelector('.stacks').innerHTML = chipStacksHtml(h.stake);
      h.el.querySelector('.bet-spot b').textContent = this.currentWager?.credit ? 'ON THE HOUSE' : h.stake;
    });
    const dv = $('bj-dealer-value');
    dv.textContent = b.holeShown ? handValue(b.dealer) : `${handValue([b.dealer[0]])} + ?`;
    dv.classList.toggle('bust', b.holeShown && handValue(b.dealer) > 21);
    // what you're allowed to do with the hand in front of you
    const h = b.hands[b.active];
    const live = !b.busy && !b.over && h && !h.done;
    const two = live && h.cards.length === 2 && !h.aces;
    $('bj-hit').disabled = !live;
    $('bj-stand').disabled = !live;
    $('bj-double').disabled = !(two && this._bjCanAfford(h.stake));
    $('bj-split').disabled = !(live && canSplit(h.cards) && b.hands.length < 4 && !h.aces && this._bjCanAfford(b.base));
    const credit = this.currentWager?.credit;
    $('bj-double').innerHTML = `<kbd>D</kbd>DOUBLE${credit || !h ? '' : ` <small>+${h.stake}</small>`}`;
    $('bj-split').innerHTML = `<kbd>P</kbd>SPLIT${credit ? '' : ` <small>+${b.base}</small>`}`;
    if (live) {
      const opts = ['hit', 'stand'];
      if (!$('bj-double').disabled) opts.push('double');
      if (!$('bj-split').disabled) opts.push('split');
      $('bj-status').textContent = `${multi ? `Hand ${b.active + 1} of ${b.hands.length}: ` : ''}${opts.join(', ').replace(/, ([^,]*)$/, ' or $1')}?`
        .replace(/^./, (c) => c.toUpperCase());
    }
  }

  _bjShoe() { return $('blackjack-panel').querySelector('.shoe'); }

  bjHit() {
    const b = this.bj;
    if (!b || b.busy || b.over) return;
    const h = b.hands[b.active];
    if (!h || h.done) return;
    b.busy = true;
    const c = b.deck.pop();
    h.cards.push(c);
    h.els.push(dealCard(h.fan, c, { from: this._bjShoe(), sound: () => Audio.play('card') }));
    this._bjUpdate();
    setTimeout(() => { b.busy = false; this._bjCheck(h); }, 420);
  }

  bjStand() {
    const b = this.bj;
    if (!b || b.busy || b.over) return;
    const h = b.hands[b.active];
    if (!h || h.done) return;
    h.done = true;
    Audio.play('chip');
    this._bjNext();
  }

  bjDouble() {
    const g = this.game, b = this.bj, w = this.currentWager;
    if (!b || b.busy || b.over || $('bj-double').disabled) return;
    const h = b.hands[b.active];
    if (!w.credit) {
      g.chips -= h.stake;
      g.stats.gambled += h.stake;
      w.amount += h.stake;
      flyChips(document.querySelector('#blackjack-panel .ts-bank'), h.el.querySelector('.bet-spot'), 5, 'red');
    }
    h.stake *= 2;
    h.doubled = true;
    this.updateChipsUI();
    this._wagerInfo('bj-wager-info');
    Audio.play('chip');
    b.busy = true;
    const c = b.deck.pop();
    h.cards.push(c);
    h.els.push(dealCard(h.fan, c, { from: this._bjShoe(), sideways: true, delay: 150, sound: () => Audio.play('card') }));
    this._bjUpdate();
    setTimeout(() => {
      b.busy = false;
      h.done = true;
      if (handValue(h.cards) > 21) { stamp(h.el, 'BUST', 'lose'); Audio.play('wager_lose'); }
      this._bjNext();
    }, 650);
  }

  bjSplit() {
    const g = this.game, b = this.bj, w = this.currentWager;
    if (!b || b.busy || b.over || $('bj-split').disabled) return;
    const i = b.active, h = b.hands[i];
    if (!w.credit) {
      g.chips -= b.base;
      g.stats.gambled += b.base;
      w.amount += b.base;
    }
    this.updateChipsUI();
    this._wagerInfo('bj-wager-info');
    const aces = h.cards[0].rank === 'A';
    const moved = h.els.pop();
    const nh = { cards: [h.cards.pop()], stake: b.base, done: false, aces, els: [moved] };
    h.aces = aces;
    b.hands.splice(i + 1, 0, nh);
    this._bjBuildHands();
    // the second card slides over to its own spot
    moved.classList.add('slide');
    nh.fan.appendChild(moved);
    if (!w.credit) flyChips(document.querySelector('#blackjack-panel .ts-bank'), nh.el.querySelector('.bet-spot'), 5, 'red');
    Audio.play('shuffle');
    b.busy = true;
    const shoe = this._bjShoe();
    const c1 = b.deck.pop(), c2 = b.deck.pop();
    h.cards.push(c1);
    h.els.push(dealCard(h.fan, c1, { from: shoe, delay: 260, sound: () => Audio.play('card') }));
    nh.cards.push(c2);
    nh.els.push(dealCard(nh.fan, c2, { from: shoe, delay: 540, sound: () => Audio.play('card') }));
    this._bjUpdate();
    setTimeout(() => {
      b.busy = false;
      if (aces) { h.done = true; nh.done = true; this._bjNext(); return; }   // split aces: one card each
      this._bjCheck(h);
    }, 950);
  }

  /** after a card lands: bust, a made 21, or play on */
  _bjCheck(h) {
    const v = handValue(h.cards);
    if (v > 21) {
      h.done = true;
      stamp(h.el, 'BUST', 'lose');
      Audio.play('wager_lose');
      this._bjNext();
    } else if (v === 21) {
      h.done = true;
      this._bjNext();
    } else this._bjUpdate();
  }

  _bjNext() {
    const b = this.bj;
    const i = b.hands.findIndex((h) => !h.done);
    if (i >= 0) {
      b.active = i;
      const h = b.hands[i];
      if (handValue(h.cards) === 21) { h.done = true; this._bjNext(); return; }
      this._bjUpdate();
      return;
    }
    this._bjDealerPlays();
  }

  _bjRevealHole() {
    const b = this.bj;
    if (b.holeShown) return;
    b.holeShown = true;
    flipUp(b.hole);
    Audio.play('card');
    this._bjUpdate();
  }

  async _bjDealerPlays() {
    const b = this.bj;
    b.busy = true;
    this._bjUpdate();
    $('bj-status').textContent = 'The dealer turns the hole card…';
    await wait(350);
    this._bjRevealHole();
    await wait(700);
    // nothing left to beat? the dealer doesn't bother drawing
    const alive = b.hands.some((h) => handValue(h.cards) <= 21);
    while (alive && handValue(b.dealer) < 17) {
      $('bj-status').textContent = `The dealer has ${handValue(b.dealer)}, and draws…`;
      const c = b.deck.pop();
      b.dealer.push(c);
      b.dealerEls.push(dealCard($('bj-dealer-cards'), c, { from: this._bjShoe(), sound: () => Audio.play('card') }));
      this._bjUpdate();
      await wait(720);
      if (this.bj !== b) return;
    }
    this._bjSettle();
  }

  _bjSettle() {
    const b = this.bj, w = this.currentWager;
    const multi = b.hands.length > 1;
    const dv = handValue(b.dealer);
    let payout = 0, won = 0, lost = 0;
    const rack = document.querySelector('#blackjack-panel .dealer-rack');
    for (const h of b.hands) {
      const r = multi ? resolveSplitHand(h.cards, b.dealer) : resolveBlackjack(h.cards, b.dealer);
      h.result = r;
      const spot = h.el.querySelector('.bet-spot');
      if (r === 'win' || r === 'blackjack') {
        won++; payout += h.stake * 2;
        stamp(h.el, 'WIN', 'win');
        flyChips(rack, spot, 6, 'green');
      } else if (r === 'push') {
        payout += h.stake;
        stamp(h.el, 'PUSH', 'push');
      } else {
        lost++;
        if (!h.el.querySelector('.hand-stamp')) stamp(h.el, 'LOSE', 'lose');
        flyChips(spot, rack, 4, 'red');
      }
    }
    const opts = { payout: w.credit ? 0 : payout };
    let result, line;
    if (!multi) {
      result = b.hands[0].result;
      line = dv > 21 ? `THE DEALER BUSTS WITH ${dv}` : `THE DEALER STANDS ON ${dv}`;
    } else {
      result = won > lost ? 'win' : lost > won ? 'loss' : 'push';
      if (won === b.hands.length) { opts.tierBump = true; opts.bumpLabel = 'SPLIT SWEEP!'; }
      line = `${won} WON · ${lost} LOST · ${b.hands.length - won - lost} PUSHED`;
    }
    this._bjFinish(result, opts, line);
  }

  _bjFinish(result, opts, line) {
    const b = this.bj;
    if (!b || b.over) return;
    b.over = true;
    b.busy = true;
    this._bjUpdate();
    const head = result === 'blackjack' ? 'BLACKJACK!' : result === 'win' ? 'YOU WIN' : result === 'push' ? 'PUSH' : 'THE HOUSE WINS';
    $('bj-status').textContent = `${head} — ${line}`;
    this._flash($('blackjack-panel'), result);
    setTimeout(() => { this.bj = null; this.resolveWager(result, opts); }, 1900);
  }

  // =============================== roulette ==================================
  _buildLayout() {
    const el = $('rou-layout');
    if (el.dataset.built) return;
    el.dataset.built = '1';
    let nums = '';
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 12; c++) {
        const n = 3 * (c + 1) - r;
        nums += `<button class="rl-cell ${pocketColor(n)}" data-bet="single" data-n="${n}"><span>${n}</span></button>`;
      }
    }
    el.innerHTML = `
      <button class="rl-cell green rl-zero" data-bet="green" data-n="0"><span>0</span></button>
      <div class="rl-nums">${nums}</div>
      <div class="rl-outside">
        <button class="rl-cell out" data-bet="low">1 – 18</button>
        <button class="rl-cell out" data-bet="even">EVEN</button>
        <button class="rl-cell out red" data-bet="red"><i class="diamond red"></i></button>
        <button class="rl-cell out black" data-bet="black"><i class="diamond black"></i></button>
        <button class="rl-cell out" data-bet="odd">ODD</button>
        <button class="rl-cell out" data-bet="high">19 – 36</button>
      </div>
      <i id="rou-chip" class="chip bet-chip hidden"></i>
      <i id="rou-dolly" class="dolly hidden"></i>`;
    for (const b of el.querySelectorAll('.rl-cell')) b.onclick = () => this._selectBet(b);
  }

  startRoulette() {
    const g = this.game;
    this.rouletteBet = null;
    this.spinning = false;
    this.rouHistory = this.rouHistory || [];
    this._buildLayout();
    this._seat('roulette-panel');
    this._wagerInfo('rou-wager-info');
    const w = g.wonder;
    $('rou-status').textContent = w && !w.has('zero') && !w.built
      ? 'Place your chip on the layout. Land on green and the house gives up THE GREEN ZERO.'
      : 'Place your chip on the layout.';
    $('rou-spin').disabled = true;
    for (const c of document.querySelectorAll('#rou-layout .rl-cell')) c.classList.remove('selected', 'hit');
    $('rou-chip').classList.add('hidden');
    $('rou-dolly').classList.add('hidden');
    this._renderRouHistory();
    this._drawWheel(this._wheelAngle || 0);
  }

  _renderRouHistory() {
    const el = $('rou-history');
    el.innerHTML = `<div class="tote-head">LAST SPINS</div>${this.rouHistory?.length
      ? this.rouHistory.map((h, i) => `<span class="rou-hist ${h.color}${i === 0 ? ' latest' : ''}">${h.n}</span>`).join('')
      : '<span class="tote-empty">—</span>'}`;
  }

  _selectBet(cell) {
    if (this.spinning) return;
    const type = cell.dataset.bet;
    const n = parseInt(cell.dataset.n, 10);
    this.rouletteBet = type === 'single' ? { type, number: clamp(n, 0, 36) } : { type };
    for (const c of document.querySelectorAll('#rou-layout .rl-cell')) c.classList.toggle('selected', c === cell);
    // the chip slides onto the spot you picked
    const chip = $('rou-chip');
    const lay = $('rou-layout');
    chip.style.left = `${cell.offsetLeft + cell.offsetWidth / 2 + (cell.offsetParent === lay ? 0 : cell.offsetParent.offsetLeft)}px`;
    chip.style.top = `${cell.offsetTop + cell.offsetHeight / 2 + (cell.offsetParent === lay ? 0 : cell.offsetParent.offsetTop)}px`;
    chip.classList.remove('hidden');
    Audio.play('chip');
    $('rou-status').textContent = type === 'single'
      ? `Straight up on ${n}: a hit pays a tier up!`
      : type === 'green'
        ? 'All on the green zero: a hit pays a tier up (and feeds LADY LUCK).'
        : `On ${({ red: 'RED', black: 'BLACK', odd: 'ODD', even: 'EVEN', low: '1 TO 18', high: '19 TO 36' })[type]}. Spin when you're ready.`;
    $('rou-spin').disabled = false;
  }

  spinTheWheel() {
    const g = this.game;
    if (!this.rouletteBet || this.spinning) return;
    this.spinning = true;
    $('rou-spin').disabled = true;
    $('rou-status').textContent = 'No more bets!';
    Audio.play('wheel_spin');
    const rng = Seed.rng('roulette');
    // pick the result now; rig if the debug panel asked
    let result = spinRoulette(rng);
    const rig = g.debug.forceRoulette;
    if (rig) {
      g.debug.forceRoulette = null;
      for (let i = 0; i < 500; i++) {
        result = spinRoulette(rng);
        if ((rig === 'win') === evaluateRouletteBet(this.rouletteBet, result.number)) break;
      }
    } else if (g.wonder && result.number !== 0) {
      // the pity timer: while LADY LUCK still needs her heart, the zero comes up more
      const base = 1 / 37, p = g.wonder.greenChance();
      if (p > base && rng() < (p - base) / (1 - base)) result = { index: WHEEL_ORDER.indexOf(0), number: 0 };
    }

    // the wheel turns one way, the ball whips the other, both ease out so the
    // ball drops into the winning pocket right under the marker
    const start = this._wheelAngle || 0;
    const turns = 4;
    const finalAngle = start - (start % (Math.PI * 2)) + turns * Math.PI * 2 + (result.index / 37) * Math.PI * 2;
    const ballTurns = 7;
    const dur = 4.2;
    const t0 = performance.now();
    let lastTickPocket = -1, bounced = 0;
    const anim = () => {
      const t = Math.min(1, (performance.now() - t0) / (dur * 1000));
      const ease = 1 - Math.pow(1 - t, 3);
      const easeBall = 1 - Math.pow(1 - t, 4);
      const angle = start + (finalAngle - start) * ease;
      const ballAngle = -Math.PI / 2 - (1 - easeBall) * ballTurns * Math.PI * 2;
      // the ball rides the rim, then drops and rattles across the frets
      let ballR = t < 0.55 ? 0.93 : 0.93 - 0.2 * Math.min(1, (t - 0.55) / 0.3);
      if (t > 0.6 && t < 0.9) ballR += Math.abs(Math.sin(t * 60)) * 0.03 * (1 - (t - 0.6) / 0.3);
      if (t > 0.6 && bounced < 4 && Math.sin(t * 60) > 0.97) { bounced++; Audio.play('ball_rattle'); }
      this._drawWheel(angle, ballAngle, ballR);
      const pocket = Math.floor((((angle / (Math.PI * 2)) % 1) + 1) % 1 * 37);
      if (pocket !== lastTickPocket && t < 0.85) { Audio.play('wheel_tick'); lastTickPocket = pocket; }
      if (t < 1) requestAnimationFrame(anim);
      else { this._wheelAngle = angle % (Math.PI * 2); this._rouletteLanded(result); }
    };
    requestAnimationFrame(anim);
  }

  _rouletteLanded(result) {
    const won = evaluateRouletteBet(this.rouletteBet, result.number);
    const color = pocketColor(result.number);
    $('rou-status').textContent = `${result.number} ${color.toUpperCase()} — ${won ? 'YOU WIN' : 'THE HOUSE WINS'}`;
    this.rouHistory.unshift({ n: result.number, color });
    this.rouHistory = this.rouHistory.slice(0, 10);
    this._renderRouHistory();
    // the dolly goes down on the winning number
    const cell = document.querySelector(`#rou-layout .rl-cell[data-n="${result.number}"]`);
    if (cell) {
      cell.classList.add('hit');
      const lay = $('rou-layout'), d = $('rou-dolly');
      const px = cell.offsetParent === lay ? 0 : cell.offsetParent.offsetLeft;
      const py = cell.offsetParent === lay ? 0 : cell.offsetParent.offsetTop;
      d.style.left = `${cell.offsetLeft + cell.offsetWidth / 2 + px}px`;
      d.style.top = `${cell.offsetTop + cell.offsetHeight / 2 + py}px`;
      d.classList.remove('hidden');
    }
    const chip = $('rou-chip');
    if (won) flyChips(document.querySelector('#roulette-panel .rou-bowl'), chip, 6, 'green');
    else flyChips(chip, document.querySelector('#roulette-panel .rou-bowl'), 3, 'red');
    this._flash($('roulette-panel'), won ? 'win' : 'loss');
    Audio.play(won ? 'wager_win' : 'chip');
    const tierBump = won && (this.rouletteBet.type === 'single' || this.rouletteBet.type === 'green');
    // green is green, whatever you bet on: the zero goes on LADY LUCK's tray
    const wd = this.game.wonder;
    if (wd) {
      if (result.number === 0 && !wd.has('zero') && !wd.built) {
        wd.collect('zero');
        $('rou-status').textContent += ' · THE GREEN ZERO IS YOURS';
      } else if (result.number !== 0) wd.missGreen();
    }
    setTimeout(() => {
      this.spinning = false;
      this.resolveWager(won ? 'win' : 'loss', { tierBump });
    }, 1900);
  }

  /** the wheel from above (the CSS tips it back into a bowl) */
  _drawWheel(angle, ballAngle = null, ballR = 0.85) {
    const cv = $('roulette-canvas');
    const ctx = cv.getContext('2d');
    const cx = cv.width / 2, cy = cv.height / 2, R = cv.width / 2 - 4;
    const Rp = R * 0.8;                              // the pocket ring
    ctx.clearRect(0, 0, cv.width, cv.height);
    // the wooden bowl and its ball track
    const wood = ctx.createRadialGradient(cx, cy, R * 0.8, cx, cy, R);
    wood.addColorStop(0, '#2a1206'); wood.addColorStop(0.5, '#6a3414'); wood.addColorStop(0.85, '#8a4a1c'); wood.addColorStop(1, '#3a1a08');
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = wood; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.92, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,220,160,0.25)'; ctx.lineWidth = 2; ctx.stroke();
    // brass diamonds on the track that knock the ball about
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + Math.PI / 8;
      ctx.save(); ctx.translate(cx + Math.cos(a) * R * 0.87, cy + Math.sin(a) * R * 0.87); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(0, -3.5); ctx.lineTo(7, 0); ctx.lineTo(0, 3.5); ctx.closePath();
      ctx.fillStyle = '#e8c860'; ctx.fill(); ctx.restore();
    }
    const seg = (Math.PI * 2) / 37;
    for (let i = 0; i < 37; i++) {
      const n = WHEEL_ORDER[i];
      const a0 = -Math.PI / 2 - seg / 2 + i * seg - angle;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, Rp, a0, a0 + seg);
      const c = pocketColor(n);
      ctx.fillStyle = c === 'green' ? '#0f7a3d' : c === 'red' ? '#b3122e' : '#15151d';
      ctx.fill();
      ctx.strokeStyle = '#d8b23a'; ctx.lineWidth = 1.2; ctx.stroke();
      const mid = a0 + seg / 2;
      ctx.save();
      ctx.translate(cx + Math.cos(mid) * (Rp - 15), cy + Math.sin(mid) * (Rp - 15));
      ctx.rotate(mid + Math.PI / 2);
      ctx.fillStyle = '#f4efe2';
      ctx.font = 'bold 13px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(n), 0, 4);
      ctx.restore();
    }
    // the cone and the turret
    const hub = ctx.createRadialGradient(cx - Rp * 0.1, cy - Rp * 0.1, 4, cx, cy, Rp * 0.62);
    hub.addColorStop(0, '#f6dc84'); hub.addColorStop(0.3, '#9a5a24'); hub.addColorStop(1, '#2a1406');
    ctx.beginPath(); ctx.arc(cx, cy, Rp * 0.62, 0, Math.PI * 2); ctx.fillStyle = hub; ctx.fill();
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-angle);
    ctx.strokeStyle = '#e8c860'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    for (let k = 0; k < 4; k++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(Rp * 0.34, 0); ctx.stroke(); }
    ctx.restore();
    ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.fillStyle = '#f6dc84'; ctx.fill();
    // the marker at twelve o'clock
    ctx.beginPath();
    ctx.moveTo(cx - 9, cy - R + 2); ctx.lineTo(cx + 9, cy - R + 2); ctx.lineTo(cx, cy - R + 18);
    ctx.fillStyle = '#f4efe2'; ctx.fill();
    if (ballAngle !== null) {
      const bx = cx + Math.cos(ballAngle) * R * ballR;
      const by = cy + Math.sin(ballAngle) * R * ballR;
      ctx.beginPath(); ctx.arc(bx + 2, by + 3, 7, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
      const ball = ctx.createRadialGradient(bx - 2, by - 2, 1, bx, by, 7);
      ball.addColorStop(0, '#ffffff'); ball.addColorStop(1, '#bdbdbd');
      ctx.beginPath(); ctx.arc(bx, by, 7, 0, Math.PI * 2); ctx.fillStyle = ball; ctx.fill();
    }
  }

  // ========================= poker: five card draw ===========================
  // Beat the dealer and the card's tier pays out; a flush or better bumps it.
  startPokerHand() {
    const deck = newDeck(Seed.rng('poker'));
    const pk = this.poker = {
      deck, player: [], dealer: [], pEls: [], dEls: [],
      held: [false, false, false, false, false], phase: 'dealing',
    };
    for (let i = 0; i < 5; i++) { pk.player.push(deck.pop()); pk.dealer.push(deck.pop()); }
    const panel = this._seat('poker-panel');
    this._wagerInfo('poker-wager-info');
    $('poker-player-cards').innerHTML = '';
    $('poker-dealer-cards').innerHTML = '';
    $('poker-dealer-hand').textContent = '';
    $('poker-status').textContent = 'Dealing…';
    $('poker-draw').disabled = true;
    $('poker-draw').innerHTML = '<kbd>SPACE</kbd>DRAW 5';
    const shoe = panel.querySelector('.shoe');
    for (let i = 0; i < 5; i++) {
      const el = dealCard($('poker-player-cards'), pk.player[i], { from: shoe, delay: 200 + i * 260, sound: () => Audio.play('card') });
      el.onclick = () => this.pokerHold(i);
      pk.pEls.push(el);
      pk.dEls.push(dealCard($('poker-dealer-cards'), pk.dealer[i], { from: shoe, faceDown: true, delay: 330 + i * 260 }));
    }
    this._pokerLabel();
    setTimeout(() => {
      if (this.poker !== pk) return;
      pk.phase = 'draw';
      $('poker-draw').disabled = false;
      $('poker-status').textContent = 'Click cards (or press 1–5) to HOLD, then draw.';
      for (const el of pk.pEls) el.classList.add('clickable');
    }, 200 + 5 * 260 + 300);
  }

  /** what you're holding right now, named */
  _pokerLabel() {
    const pk = this.poker;
    const e = evaluatePokerHand(pk.player);
    $('poker-player-hand').innerHTML = `${e.name}<small>${pokerTier(e.rank) === 'legendary' ? 'PAYS A TIER UP' : 'YOUR HAND'}</small>`;
  }

  pokerHold(i) {
    const pk = this.poker;
    if (!pk || pk.phase !== 'draw') return;
    pk.held[i] = !pk.held[i];
    pk.pEls[i].classList.toggle('held', pk.held[i]);
    Audio.play('card');
    const n = pk.held.filter(Boolean).length;
    $('poker-draw').innerHTML = `<kbd>SPACE</kbd>${n === 5 ? 'STAND PAT' : `DRAW ${5 - n}`}`;
  }

  async pokerDraw() {
    const g = this.game, pk = this.poker;
    if (!pk || pk.phase !== 'draw') return;
    pk.phase = 'showdown';
    $('poker-draw').disabled = true;
    const panel = $('poker-panel');
    const shoe = panel.querySelector('.shoe'), tray = panel.querySelector('.discard');
    let drew = 0;
    for (const el of pk.pEls) el.classList.remove('clickable');
    for (let i = 0; i < 5; i++) {
      if (pk.held[i]) continue;
      const old = pk.pEls[i];
      pk.player[i] = pk.deck.pop();
      pk.pEls[i] = dealCard($('poker-player-cards'), pk.player[i], { from: shoe, before: old, delay: 120 + drew * 200, sound: () => Audio.play('card') });
      sweepCards([old], tray);
      drew++;
    }
    for (const el of pk.pEls) el.classList.remove('held');
    this._pokerLabel();
    $('poker-status').textContent = drew ? `Drew ${drew}. The dealer draws…` : 'Standing pat. The dealer draws…';
    await wait(300 + drew * 200);
    const holds = dealerHolds(pk.dealer);
    let dd = 0;
    for (let i = 0; i < 5; i++) {
      if (holds[i]) continue;
      const old = pk.dEls[i];
      pk.dealer[i] = pk.deck.pop();
      pk.dEls[i] = dealCard($('poker-dealer-cards'), pk.dealer[i], { from: shoe, before: old, faceDown: true, delay: dd * 200, sound: () => Audio.play('card') });
      sweepCards([old], tray);
      dd++;
    }
    $('poker-status').textContent = `The dealer draws ${dd || 'none'}. Showdown…`;
    await wait(500 + dd * 200);
    if (this.poker !== pk) return;
    pk.dEls.forEach((el, i) => flipUp(el, i * 140));
    Audio.play('card');
    await wait(900);
    const pe = evaluatePokerHand(pk.player);
    const de = evaluatePokerHand(pk.dealer);
    const cmp = comparePoker(pe, de);
    $('poker-dealer-hand').innerHTML = `${de.name}<small>DEALER</small>`;
    $('poker-status').textContent = `Your ${pe.name} vs the dealer's ${de.name}`;
    await wait(900);
    if (cmp > 0) {
      const monster = pokerTier(pe.rank) === 'legendary';
      this._flash(panel, 'win');
      $('poker-status').textContent = `${pe.name.toUpperCase()} WINS${monster ? ' — A MONSTER HAND' : ''}`;
      flyChips(panel.querySelector('.ts-nameplate'), panel.querySelector('.ts-bank'), 6, 'green');
      setTimeout(() => this.resolveWager('win', { tierBump: monster, bumpLabel: pe.name.toUpperCase() + '!' }), 1500);
    } else if (cmp < 0) {
      this._flash(panel, 'loss');
      $('poker-status').textContent = `THE DEALER'S ${de.name.toUpperCase()} TAKES IT`;
      setTimeout(() => this.resolveWager('loss'), 1500);
    } else {
      this._flash(panel, 'push');
      $('poker-status').textContent = 'A DEAD HEAT — PUSH';
      setTimeout(() => this.resolveWager('push'), 1500);
    }
    this.poker = null;
  }

  // ============================ the one-armed bandit ==========================
  openSlots(pulls, bet) {
    const g = this.game;
    g.setState('SLOTS');
    g.ui.hide('intermission');
    this.slots.open(pulls, bet);
    this.updateChipsUI();
    g.ui.show('slots-panel');
  }

  closeSlots() {
    if (this.slots.spinning) return;
    this.slots.pulls = 0;
    this.game.ui.hide('slots-panel');
    this.game.setState('INTERMISSION');
    this.game.ui.show('intermission');
    this.renderShop();
    this.game.saveRun();
  }

  // ============================== the keyboard ================================
  /** keys at the tables; true if one was used */
  key(code) {
    const s = this.game.state;
    if (s === 'SLOTS') return this.slots.key(code);
    if (s === 'BLACKJACK') {
      const fn = { KeyH: 'bjHit', KeyS: 'bjStand', KeyD: 'bjDouble', KeyP: 'bjSplit' }[code];
      if (fn) { this[fn](); return true; }
    }
    if (s === 'POKER') {
      const i = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4 }[code];
      if (i !== undefined) { this.pokerHold(i); return true; }
      if (code === 'Space' || code === 'Enter') { this.pokerDraw(); return true; }
    }
    if (s === 'ROULETTE' && (code === 'Space' || code === 'Enter')) { this.spinTheWheel(); return true; }
    return false;
  }

  // ============================= wiring ======================================
  _wagerInfoText() {
    const w = this.currentWager;
    if (!w) return '';
    const T = TIERS[w.tier];
    return w.credit
      ? `<b class="tier-${w.tier}">HOUSE CREDIT</b> — win a ${T.label.toLowerCase()} upgrade · lose: a ${w.penalty} penalty`
      : `<b class="tier-${w.tier}">${T.label} STAKES</b> · <b>${w.amount}</b> chips on the felt — win: ${T.label.toLowerCase()} upgrade + stake ×2 · lose: ${w.penalty} penalty`;
  }

  _wireStaticButtons() {
    $('btn-skip-gamble').onclick = () => this.startNextRound();
    $('btn-reroll').onclick = () => this.reroll();

    $('bj-hit').onclick = () => this.bjHit();
    $('bj-stand').onclick = () => this.bjStand();
    $('bj-double').onclick = () => this.bjDouble();
    $('bj-split').onclick = () => this.bjSplit();

    $('rou-spin').onclick = () => this.spinTheWheel();
    $('poker-draw').onclick = () => this.pokerDraw();
    $('slots-close').onclick = () => this.closeSlots();
  }
}

export { TABLE_GAMES };
