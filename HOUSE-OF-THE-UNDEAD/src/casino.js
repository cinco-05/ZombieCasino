// casino.js — the between-rounds loop. THE HOUSE SHOP (shop.js) lays out a
// random row of cards each visit; buying a TABLE card seats you straight at
// that game at that stake (no game picker, no bet slider). Win: the card's
// upgrade tier + your stake back double. Lose: the card's penalty next round.
// Also here: playable blackjack, fair animated roulette, five card draw,
// the 5x5 slot machine, charms, and penalty resolution.

import { CONFIG, pick, clamp } from './config.js';
import {
  newDeck, handValue, isBlackjack, resolveBlackjack,
  spinRoulette, evaluateRouletteBet, WHEEL_ORDER, pocketColor,
  spinReel, spinGrid5, evalSlotsGrid5,
  evaluatePokerHand, comparePoker, pokerTier, dealerHolds,
} from './cards.js';
import { Audio } from './audio.js';
import { Shop, TIERS, TABLE_GAMES } from './shop.js';
import { LETHALS, TACTICALS, DRINKS } from './catalog.js';

const $ = (id) => document.getElementById(id);

/** card face markup: corner index + big center pip */
const cardFace = (c) => `<span class="cr">${c.rank}<br>${c.suit}</span><span class="cs">${c.suit}</span>`;
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
    this.slotRespinUsed = false;
    this.slotPulls = 0;
    this.bj = null;
    this.rouletteBet = null;
    this.shop = new Shop(game);
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
    this.slotRespinUsed = false;
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
      this.slotPulls = c.pulls;
      Audio.play('chip');
      this.openSlots();
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
      const r = Math.random();
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

    if (result === 'push') {
      if (!w.credit) g.chips += w.amount;   // stake returned
      g.ui.banner('PUSH — stake returned', 'cyan');
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
      if (!w.credit) g.chips += w.amount * 2;   // even-money chips back
      this.updateChipsUI();
      g.saveRun();
      setTimeout(() => g.upgrades.offer(tier), 500);
      return;
    } else {
      Audio.play('wager_lose');
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
    const pool = PENALTIES[kind];
    const p = pick(pool);
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

  // ============================== blackjack ==================================
  startBlackjack() {
    const g = this.game;
    this.bj = { deck: newDeck(), player: [], dealer: [], doubled: false, done: false };
    const b = this.bj;
    b.player.push(b.deck.pop(), b.deck.pop());
    b.dealer.push(b.deck.pop(), b.deck.pop());
    this._bjSeen = { p: 0, d: 0 };          // for deal-in animation
    this._holeRevealed = false;
    const panel = $('blackjack-panel');
    panel.classList.remove('win-flash', 'lose-flash', 'push-flash', 'win-steady', 'lose-steady');
    $('bj-wager-info').innerHTML = this._wagerInfoText() + this._stakeChipsHtml();
    $('bj-double').style.display = '';
    g.ui.show('blackjack-panel');
    for (let i = 0; i < 4; i++) setTimeout(() => Audio.play('card'), i * 170);

    // debug rigging
    const rig = g.debug.forceBJ;
    if (rig) {
      g.debug.forceBJ = null;
      this._renderBlackjack(false);
      setTimeout(() => this._finishBlackjack(rig === 'win' ? 'win' : rig === 'push' ? 'push' : 'loss'), 1600);
      return;
    }

    if (isBlackjack(b.player)) {
      this._renderBlackjack(true);
      setTimeout(() => this._finishBlackjack(resolveBlackjack(b.player, b.dealer)), 1800);
      return;
    }
    this._renderBlackjack(false);
  }

  bjHit() {
    const b = this.bj;
    if (!b || b.done) return;
    Audio.play('card');
    b.player.push(b.deck.pop());
    $('bj-double').style.display = 'none';
    if (handValue(b.player) > 21) {
      this._renderBlackjack(true);
      setTimeout(() => this._finishBlackjack('loss'), 700);
    } else this._renderBlackjack(false);
  }

  bjStand() {
    const b = this.bj;
    if (!b || b.done) return;
    b.done = 'dealing';                     // lock inputs during the draw-out
    this._renderBlackjack(true);            // flip the hole card first
    const drawNext = () => {
      if (handValue(b.dealer) < 17) {
        b.dealer.push(b.deck.pop());
        Audio.play('card');
        this._renderBlackjack(true);
        setTimeout(drawNext, 620);
      } else {
        b.done = false;
        setTimeout(() => this._finishBlackjack(resolveBlackjack(b.player, b.dealer)), 500);
      }
    };
    setTimeout(drawNext, 750);
  }

  bjDouble() {
    // double down: one card only, stake doubles (if affordable)
    const g = this.game, b = this.bj, w = this.currentWager;
    if (!b || b.done || b.player.length !== 2) return;
    if (!w.credit && g.chips >= w.amount) {
      g.chips -= w.amount;
      g.stats.gambled += w.amount;
      w.amount *= 2;
      this.updateChipsUI();
      $('bj-wager-info').innerHTML = this._wagerInfoText() + this._stakeChipsHtml();
    }
    Audio.play('card');
    b.player.push(b.deck.pop());
    if (handValue(b.player) > 21) {
      this._renderBlackjack(true);
      setTimeout(() => this._finishBlackjack('loss'), 700);
      return;
    }
    this.bjStand();
  }

  _finishBlackjack(result) {
    if (!this.bj || this.bj.done === true) return;
    this.bj.done = true;
    $('bj-status').textContent =
      result === 'blackjack' ? 'BLACKJACK!' :
      result === 'win' ? 'YOU WIN' :
      result === 'push' ? 'PUSH' : 'THE HOUSE WINS';
    const panel = $('blackjack-panel');
    const rf = this.game.settings.reducedFlash;
    panel.classList.add(
      (result === 'win' || result === 'blackjack') ? (rf ? 'win-steady' : 'win-flash')
      : result === 'push' ? 'push-flash' : (rf ? 'lose-steady' : 'lose-flash'));
    setTimeout(() => this.resolveWager(result), 1400);
  }

  _stakeChipsHtml() {
    const w = this.currentWager;
    if (!w || w.credit) return '';
    const stacks = Math.min(6, 1 + Math.floor(w.amount / 60));
    return `<div class="stake-chips">${'<span class="gchip"></span>'.repeat(stacks)} <b>${w.amount}</b> on the felt</div>`;
  }

  _renderBlackjack(revealDealer) {
    const b = this.bj;
    const initial = this._bjSeen.p === 0;   // first render: stagger the whole deal
    const cardHtml = (c, hidden, isNew, delay, flip) => {
      const cls = ['pcard'];
      if (hidden) cls.push('back');
      else if (c.suit === '♥' || c.suit === '♦') cls.push('red');
      if (isNew) cls.push('deal');
      if (flip) cls.push('flip');
      const style = delay ? ` style="animation-delay:${delay}ms"` : '';
      return `<span class="${cls.join(' ')}"${style}>${hidden ? '' : cardFace(c)}</span>`;
    };
    const flipNow = revealDealer && !this._holeRevealed;
    if (revealDealer) this._holeRevealed = true;

    $('bj-player-cards').innerHTML = b.player.map((c, i) =>
      cardHtml(c, false, initial ? true : i >= this._bjSeen.p, initial ? i * 340 : 0, false)).join('');
    $('bj-dealer-cards').innerHTML = b.dealer.map((c, i) => {
      const hidden = !revealDealer && i === 1;
      return cardHtml(c, hidden, initial ? true : i >= this._bjSeen.d,
        initial ? 170 + i * 340 : 0, flipNow && i === 1);
    }).join('');
    this._bjSeen = { p: b.player.length, d: b.dealer.length };
    if (flipNow) Audio.play('card');

    $('bj-player-value').textContent = handValue(b.player);
    $('bj-dealer-value').textContent = revealDealer ? handValue(b.dealer)
      : (b.dealer.length ? handValue([b.dealer[0]]) + ' + ?' : '');
    if (!b.done) $('bj-status').textContent = handValue(b.player) === 21 ? '21!' : 'Hit or stand?';
  }

  // =============================== roulette ==================================
  startRoulette() {
    const g = this.game;
    this.rouletteBet = null;
    this.spinning = false;
    this.rouHistory = this.rouHistory || [];
    const panel = $('roulette-panel');
    panel.classList.remove('win-flash', 'lose-flash', 'win-steady', 'lose-steady');
    $('rou-wager-info').innerHTML = this._wagerInfoText() + this._stakeChipsHtml();
    const w = g.wonder;
    $('rou-status').textContent = w && !w.has('zero') && !w.built
      ? 'Place your bet. Land on green and the house gives up THE GREEN ZERO.'
      : 'Place your bet.';
    $('rou-spin').disabled = true;
    for (const b of document.querySelectorAll('.rou-bet')) b.classList.remove('selected');
    this._renderRouHistory();
    this._drawWheel(0);
    g.ui.show('roulette-panel');
  }

  _renderRouHistory() {
    const el = $('rou-history');
    if (!this.rouHistory?.length) { el.innerHTML = '<span class="dim small">past spins appear here</span>'; return; }
    el.innerHTML = this.rouHistory.map((h) =>
      `<span class="rou-hist ${h.color}">${h.n}</span>`).join('');
  }

  _selectBet(type, btn) {
    if (this.spinning) return;
    this.rouletteBet = type === 'single'
      ? { type, number: clamp(parseInt($('rou-number').value || '7', 10), 0, 36) }
      : { type };
    for (const b of document.querySelectorAll('.rou-bet')) b.classList.remove('selected');
    btn.classList.add('selected');
    $('rou-status').textContent = type === 'single'
      ? `Straight up on ${this.rouletteBet.number} — a hit upgrades your reward tier!`
      : type === 'green'
        ? 'All on the green zero — a hit upgrades your reward tier (and feeds LADY LUCK).'
        : `Betting ${type.toUpperCase()}.`;
    $('rou-spin').disabled = false;
  }

  spinTheWheel() {
    const g = this.game;
    if (!this.rouletteBet || this.spinning) return;
    this.spinning = true;
    $('rou-spin').disabled = true;

    // pick the result now; rig if the debug panel asked
    let result = spinRoulette();
    const rig = g.debug.forceRoulette;
    if (rig) {
      g.debug.forceRoulette = null;
      for (let i = 0; i < 500; i++) {
        result = spinRoulette();
        const won = evaluateRouletteBet(this.rouletteBet, result.number);
        if ((rig === 'win') === won) break;
      }
    } else if (g.wonder && result.number !== 0) {
      // the pity timer: while LADY LUCK still needs her heart, the zero comes up more
      const base = 1 / 37, p = g.wonder.greenChance();
      if (p > base && Math.random() < (p - base) / (1 - base)) result = { index: WHEEL_ORDER.indexOf(0), number: 0 };
    }

    // animate: wheel turns one way, the ball whips the other way, both
    // easing out so the ball drops into the winning pocket at the pointer
    const target = result.index;
    const turns = 4;
    const finalAngle = turns * Math.PI * 2 + (target / 37) * Math.PI * 2;
    const ballTurns = 7;
    const dur = 3.6;
    const t0 = performance.now();
    let lastTickPocket = -1;
    const anim = () => {
      const t = Math.min(1, (performance.now() - t0) / (dur * 1000));
      const ease = 1 - Math.pow(1 - t, 3);
      const easeBall = 1 - Math.pow(1 - t, 4);
      const angle = finalAngle * ease;
      const ballAngle = -Math.PI / 2 - (1 - easeBall) * ballTurns * Math.PI * 2;
      const ballR = 0.98 - 0.16 * t;
      this._drawWheel(angle, ballAngle, ballR);
      const pocket = Math.floor(((angle / (Math.PI * 2)) % 1) * 37);
      if (pocket !== lastTickPocket) { Audio.play('wheel_tick'); lastTickPocket = pocket; }
      if (t < 1) requestAnimationFrame(anim);
      else this._rouletteLanded(result);
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
    const rf = this.game.settings.reducedFlash;
    $('roulette-panel').classList.add(won ? (rf ? 'win-steady' : 'win-flash') : (rf ? 'lose-steady' : 'lose-flash'));
    const tierBump = won && (this.rouletteBet.type === 'single' || this.rouletteBet.type === 'green');
    // green is green, whatever you bet on: the zero goes on LADY LUCK's tray
    const wd = this.game.wonder;
    if (wd) {
      if (result.number === 0 && !wd.has('zero') && !wd.built) {
        wd.collect('zero');
        $('rou-status').textContent += ' · THE GREEN ZERO IS YOURS';
      }
      else if (result.number !== 0) wd.missGreen();
    }
    setTimeout(() => {
      this.spinning = false;
      this.resolveWager(won ? 'win' : 'loss', { tierBump });
    }, 1500);
  }

  _drawWheel(angle, ballAngle = null, ballR = 0.85) {
    const cv = $('roulette-canvas');
    const ctx = cv.getContext('2d');
    const cx = cv.width / 2, cy = cv.height / 2, R = cv.width / 2 - 8;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const seg = (Math.PI * 2) / 37;
    for (let i = 0; i < 37; i++) {
      const n = WHEEL_ORDER[i];
      const a0 = -Math.PI / 2 + i * seg - angle;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a0, a0 + seg);
      const c = pocketColor(n);
      ctx.fillStyle = c === 'green' ? '#0f7a3d' : c === 'red' ? '#b3122e' : '#15151d';
      ctx.fill();
      ctx.strokeStyle = 'rgba(216,178,58,0.6)'; ctx.lineWidth = 1; ctx.stroke();
      const mid = a0 + seg / 2;
      ctx.save();
      ctx.translate(cx + Math.cos(mid) * (R - 16), cy + Math.sin(mid) * (R - 16));
      ctx.rotate(mid + Math.PI / 2);
      ctx.fillStyle = '#f4efe2';
      ctx.font = 'bold 11px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(n), 0, 0);
      ctx.restore();
    }
    const hub = ctx.createRadialGradient(cx, cy, 4, cx, cy, R * 0.55);
    hub.addColorStop(0, '#f6dc84'); hub.addColorStop(0.35, '#6a3a14'); hub.addColorStop(1, '#2a1406');
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.55, 0, Math.PI * 2); ctx.fillStyle = hub; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, 26, 0, Math.PI * 2);
    ctx.fillStyle = '#d8b23a'; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 8, 6); ctx.lineTo(cx + 8, 6); ctx.lineTo(cx, 24);
    ctx.fillStyle = '#f4efe2'; ctx.fill();
    if (ballAngle !== null) {
      const bx = cx + Math.cos(ballAngle) * R * ballR;
      const by = cy + Math.sin(ballAngle) * R * ballR;
      ctx.beginPath(); ctx.arc(bx, by, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#f5f5f5'; ctx.fill();
      ctx.beginPath(); ctx.arc(bx - 2, by - 2, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff'; ctx.fill();
    }
  }

  // ========================= poker: five card draw ===========================
  // Beat the dealer and the card's tier pays out; a flush or better bumps it.
  startPokerHand() {
    const g = this.game;
    const deck = newDeck();
    this.poker = {
      deck,
      player: [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()],
      dealer: [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()],
      held: [false, false, false, false, false],
      phase: 'draw',
    };
    const panel = $('poker-panel');
    panel.classList.remove('win-flash', 'lose-flash', 'push-flash', 'win-steady', 'lose-steady');
    $('poker-wager-info').innerHTML = this._wagerInfoText() + this._stakeChipsHtml();
    $('poker-status').textContent = 'Click cards to HOLD, then draw.';
    $('poker-draw').disabled = false;
    this._renderPoker(false, true);
    g.ui.show('poker-panel');
    for (let i = 0; i < 5; i++) setTimeout(() => Audio.play('card'), i * 140);
  }

  _renderPoker(revealDealer, initial = false) {
    const pk = this.poker;
    const card = (c, i, hidden, clickable, held, dealDelay) => {
      const cls = ['pcard'];
      if (hidden) cls.push('back');
      else if (c.suit === '♥' || c.suit === '♦') cls.push('red');
      if (clickable) cls.push('clickable');
      if (held) cls.push('held');
      if (dealDelay !== null) cls.push('deal');
      const style = dealDelay ? ` style="animation-delay:${dealDelay}ms"` : '';
      return `<span class="${cls.join(' ')}" data-idx="${i}"${style}>${hidden ? '' : cardFace(c)}</span>`;
    };
    $('poker-player-cards').innerHTML = pk.player.map((c, i) =>
      card(c, i, false, pk.phase === 'draw', pk.held[i], initial ? i * 140 : null)).join('');
    $('poker-dealer-cards').innerHTML = pk.dealer.map((c, i) =>
      card(c, i, !revealDealer, false, false, initial ? 70 + i * 140 : (revealDealer && !this._pokerRevealed ? 0 : null))).join('');
    if (revealDealer && !this._pokerRevealed) {
      this._pokerRevealed = true;
      for (const el of document.querySelectorAll('#poker-dealer-cards .pcard')) el.classList.add('flip');
      Audio.play('card');
    }
    if (!revealDealer) this._pokerRevealed = false;
    if (pk.phase === 'draw') {
      for (const el of document.querySelectorAll('#poker-player-cards .pcard')) {
        el.onclick = () => {
          const i = parseInt(el.dataset.idx, 10);
          pk.held[i] = !pk.held[i];
          Audio.play('card');
          this._renderPoker(false);
        };
      }
    }
  }

  pokerDraw() {
    const g = this.game, pk = this.poker;
    if (!pk || pk.phase !== 'draw') return;
    pk.phase = 'showdown';
    $('poker-draw').disabled = true;
    let drew = 0;
    for (let i = 0; i < 5; i++) if (!pk.held[i]) { pk.player[i] = pk.deck.pop(); drew++; }
    const holds = dealerHolds(pk.dealer);
    for (let i = 0; i < 5; i++) if (!holds[i]) pk.dealer[i] = pk.deck.pop();
    for (let i = 0; i < Math.max(1, drew); i++) setTimeout(() => Audio.play('card'), i * 130);
    this._renderPoker(false);
    $('poker-status').textContent = drew ? `Drew ${drew}. The dealer draws...` : 'Standing pat. The dealer draws...';

    setTimeout(() => {
      const pe = evaluatePokerHand(pk.player);
      const de = evaluatePokerHand(pk.dealer);
      const cmp = comparePoker(pe, de);
      this._renderPoker(true);
      $('poker-status').textContent = `Your ${pe.name} vs the dealer's ${de.name}`;
      const rf = g.settings.reducedFlash;
      const panel = $('poker-panel');
      setTimeout(() => {
        if (cmp > 0) {
          const monster = pokerTier(pe.rank) === 'legendary';
          panel.classList.add(rf ? 'win-steady' : 'win-flash');
          $('poker-status').textContent = `${pe.name} WINS${monster ? ' — A MONSTER HAND' : ''}`;
          setTimeout(() => this.resolveWager('win', { tierBump: monster, bumpLabel: pe.name.toUpperCase() + '!' }), 1300);
        } else if (cmp < 0) {
          panel.classList.add(rf ? 'lose-steady' : 'lose-flash');
          setTimeout(() => this.resolveWager('loss'), 1300);
        } else {
          panel.classList.add('push-flash');
          setTimeout(() => this.resolveWager('push'), 1300);
        }
      }, 1300);
    }, 1400);
  }

  // ===================== slots: 5x5, 7 paylines, runs pay ====================
  openSlots() {
    const g = this.game;
    g.setState('SLOTS');
    this.slotGrid = null;
    this.slotRespinUsed = false;
    $('slots-status').textContent = `${this.slotPulls} pulls paid for. 7 paylines, runs of 3+ pay (x1 / x3 / x10).`;
    this._renderSlotGrid(null);
    $('slots-respin-row').style.display = 'none';
    this._refreshSlotButton();
    this.updateChipsUI();
    g.ui.hide('intermission');
    g.ui.show('slots-panel');
  }

  _refreshSlotButton() {
    const b = $('slots-spin');
    b.textContent = this.slotPulls > 0 ? `PULL THE ARM — ${this.slotPulls} LEFT` : 'OUT OF PULLS';
    b.disabled = this.slotPulls <= 0;
  }

  /** cells are laid out column-major: index = col*5 + row */
  _renderSlotGrid(grid, winCells = []) {
    const winSet = new Set(winCells.map(([c, r]) => c * 5 + r));
    let html = '';
    const rf = this.game.settings.reducedFlash;
    for (let c = 0; c < 5; c++) {
      for (let r = 0; r < 5; r++) {
        const sym = grid ? grid[c][r] : '❔';
        const idx = c * 5 + r;
        html += `<span class="cell${winSet.has(idx) ? (rf ? ' win-steady-cell' : ' win') : ''}${r === 2 ? ' mid' : ''}">${sym}</span>`;
      }
    }
    $('slots-reels').innerHTML = html;
  }

  slotsSpin() {
    if (this.slotSpinning || this.slotPulls <= 0) return;
    this.slotPulls--;
    this._refreshSlotButton();
    $('slots-status').textContent = '...';
    this._animateSlots(spinGrid5(), () => this._slotsSettle());
  }

  slotsRespin(col) {
    if (this.slotSpinning || this.slotRespinUsed || !this.slotGrid) return;
    this.slotRespinUsed = true;
    const grid = this.slotGrid.map((c) => [...c]);
    grid[col] = Array.from({ length: 5 }, () => spinReel());
    this._animateSlots(grid, () => this._slotsSettle(), col);
  }

  _animateSlots(finalGrid, onDone, onlyCol = null) {
    this.slotSpinning = true;
    let ticks = 0;
    const iv = setInterval(() => {
      ticks++;
      Audio.play('slot_spin');
      const rolling = [0, 1, 2, 3, 4].map((c) => (onlyCol !== null && c !== onlyCol) ? false : ticks < 6 + c * 4);
      const shown = finalGrid.map((colSyms, c) =>
        rolling[c] ? Array.from({ length: 5 }, () => spinReel()) : colSyms);
      this._renderSlotGrid(shown);
      if (!rolling.some(Boolean)) {
        clearInterval(iv);
        this.slotGrid = finalGrid;
        this.slotSpinning = false;
        onDone();
      }
    }, 85);
  }

  _slotsSettle() {
    const g = this.game;
    const res = evalSlotsGrid5(this.slotGrid);
    const winCells = res.wins.flatMap((w) => w.cells);
    this._renderSlotGrid(this.slotGrid, winCells);
    $('slots-status').textContent = res.wins.length
      ? res.wins.map((w) => `${w.name}: ${w.label}`).join('  ·  ')
      : 'No runs. The house smiles.';
    const fiveOfSevens = res.wins.some((w) => w.sym === '7' && w.len === 5);
    if (fiveOfSevens || res.chips >= 400) Audio.play('jackpot');
    else if (res.chips > 0 || res.heal || res.ammoUnits) Audio.play('wager_win');
    else if (res.hurt) Audio.play('hurt');
    if (res.chips) g.addChips(res.chips);
    if (res.heal) g.player.heal(res.heal);
    if (res.ammoUnits >= 3) g.weapons.refillAll();
    else if (res.ammoUnits > 0) g.weapons.addReservePct(0.35 * res.ammoUnits);
    if (res.hurt) { g.player.hp = Math.max(1, g.player.hp - res.hurt); } // slots can't kill you
    this.updateChipsUI();
    g.ui.updateHUD();
    g.saveRun();
    $('slots-respin-row').style.display = this.slotRespinUsed ? 'none' : '';
  }

  closeSlots() {
    if (this.slotSpinning) return;
    this.slotPulls = 0;
    this.game.ui.hide('slots-panel');
    this.game.setState('INTERMISSION');
    this.game.ui.show('intermission');
    this.renderShop();
  }

  // ============================= wiring ======================================
  _wagerInfoText() {
    const w = this.currentWager;
    if (!w) return '';
    const T = TIERS[w.tier];
    return w.credit
      ? `HOUSE CREDIT — win a ${T.label} upgrade, lose for a ${w.penalty} penalty`
      : `${T.label} STAKES · ${w.amount} chips on the line — win: ${T.label.toLowerCase()} upgrade + ${w.amount * 2} back · lose: ${w.penalty} penalty`;
  }

  _wireStaticButtons() {
    $('btn-skip-gamble').onclick = () => this.startNextRound();
    $('btn-reroll').onclick = () => this.reroll();

    $('bj-hit').onclick = () => this.bjHit();
    $('bj-stand').onclick = () => this.bjStand();
    $('bj-double').onclick = () => this.bjDouble();

    for (const b of document.querySelectorAll('.rou-bet')) {
      b.onclick = () => this._selectBet(b.dataset.bet, b);
    }
    $('rou-spin').onclick = () => this.spinTheWheel();
    $('poker-draw').onclick = () => this.pokerDraw();

    $('slots-spin').onclick = () => this.slotsSpin();
    $('slots-close').onclick = () => this.closeSlots();
    for (const b of document.querySelectorAll('.respin-btn')) {
      b.onclick = () => this.slotsRespin(parseInt(b.dataset.reel, 10));
    }
  }
}

export { TABLE_GAMES };
