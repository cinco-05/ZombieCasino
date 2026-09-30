// cards.js — pure casino logic (no DOM, no THREE). Blackjack deck, dealer and
// splits, the European roulette wheel, five card draw, and the three-reel
// one-armed bandit. Tested by test/cards.test.mjs.

// ============================== BLACKJACK ====================================
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function newDeck(rng = Math.random) {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function cardValue(rank) {
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return parseInt(rank, 10);
}

export function handValue(cards) {
  let total = cards.reduce((s, c) => s + cardValue(c.rank), 0);
  let aces = cards.filter((c) => c.rank === 'A').length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

export const isBlackjack = (cards) => cards.length === 2 && handValue(cards) === 21;

/** Dealer draws to 17 (stands on all 17s). Mutates & returns dealer hand. */
export function dealerPlay(deck, hand) {
  while (handValue(hand) < 17) hand.push(deck.pop());
  return hand;
}

/** -> 'blackjack' | 'win' | 'push' | 'loss' */
export function resolveBlackjack(player, dealer) {
  const pv = handValue(player), dv = handValue(dealer);
  if (pv > 21) return 'loss';
  if (isBlackjack(player) && !isBlackjack(dealer)) return 'blackjack';
  if (dv > 21) return 'win';
  if (pv > dv) return 'win';
  if (pv === dv) return 'push';
  return 'loss';
}

/** a pair you can split: two cards of the same value (any two tens count) */
export function canSplit(hand) {
  return hand.length === 2 && cardValue(hand[0].rank) === cardValue(hand[1].rank);
}

/**
 * settle one hand of a split round (a two-card 21 after a split is a plain 21,
 * not a natural). -> 'win' | 'push' | 'loss'
 */
export function resolveSplitHand(hand, dealer) {
  const pv = handValue(hand), dv = handValue(dealer);
  if (pv > 21) return 'loss';
  if (isBlackjack(dealer)) return 'loss';
  if (dv > 21 || pv > dv) return 'win';
  return pv === dv ? 'push' : 'loss';
}

// =============================== ROULETTE ====================================
// European single-zero wheel, physical pocket order.
export const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export function pocketColor(n) {
  if (n === 0) return 'green';
  return REDS.has(n) ? 'red' : 'black';
}

export function spinRoulette(rng = Math.random) {
  const idx = Math.floor(rng() * WHEEL_ORDER.length);
  return { index: idx, number: WHEEL_ORDER[idx] };
}

/** bet: {type:'red'|'black'|'odd'|'even'|'low'|'high'|'green'|'single', number?} -> won? */
export function evaluateRouletteBet(bet, number) {
  if (number === 0) return bet.type === 'green' || (bet.type === 'single' && bet.number === 0);
  switch (bet.type) {
    case 'red': return pocketColor(number) === 'red';
    case 'black': return pocketColor(number) === 'black';
    case 'odd': return number % 2 === 1;
    case 'even': return number % 2 === 0;
    case 'low': return number >= 1 && number <= 18;
    case 'high': return number >= 19 && number <= 36;
    case 'single': return bet.number === number;
    default: return false;
  }
}

// ============================ FIVE CARD DRAW =================================
const RANK_VAL = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13, A: 14 };
export const POKER_RANK_NAMES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];

/** 5 cards -> { rank: 0-8, name, tiebreak: number[] (desc importance) } */
export function evaluatePokerHand(cards) {
  const vals = cards.map((c) => RANK_VAL[c.rank]).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);
  const flush = suits.every((s) => s === suits[0]);

  const counts = {};
  for (const v of vals) counts[v] = (counts[v] || 0) + 1;
  // groups sorted by count desc then value desc — this IS the tiebreak order
  const groups = Object.entries(counts)
    .map(([v, n]) => ({ v: +v, n }))
    .sort((a, b) => b.n - a.n || b.v - a.v);
  const shape = groups.map((g) => g.n).join('');

  // straight (incl. the wheel A-5-4-3-2, which plays as 5-high)
  const uniq = [...new Set(vals)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5;
  }

  const tb = groups.flatMap((g) => Array(1).fill(g.v));
  const mk = (rank, tiebreak) => ({ rank, name: POKER_RANK_NAMES[rank], tiebreak });

  if (straightHigh && flush) return mk(8, [straightHigh]);
  if (shape === '41') return mk(7, tb);
  if (shape === '32') return mk(6, tb);
  if (flush) return mk(5, vals);
  if (straightHigh) return mk(4, [straightHigh]);
  if (shape === '311') return mk(3, tb);
  if (shape === '221') return mk(2, tb);
  if (shape === '2111') return mk(1, tb);
  return mk(0, vals);
}

/** -> 1 if a wins, -1 if b wins, 0 tie */
export function comparePoker(a, b) {
  if (a.rank !== b.rank) return a.rank > b.rank ? 1 : -1;
  for (let i = 0; i < Math.max(a.tiebreak.length, b.tiebreak.length); i++) {
    const av = a.tiebreak[i] ?? 0, bv = b.tiebreak[i] ?? 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

/** hand rank -> upgrade tier: pair or less = common, two pair-straight = rare, flush+ = legendary */
export function pokerTier(rank) {
  return rank >= 5 ? 'legendary' : rank >= 2 ? 'rare' : 'common';
}

/** simple dealer draw AI: hold any pair+; otherwise hold the two highest cards */
export function dealerHolds(cards) {
  const counts = {};
  for (const c of cards) counts[c.rank] = (counts[c.rank] || 0) + 1;
  if (Object.values(counts).some((n) => n >= 2)) {
    return cards.map((c) => counts[c.rank] >= 2);
  }
  const sorted = [...cards].sort((a, b) => RANK_VAL[b.rank] - RANK_VAL[a.rank]);
  const keep = new Set([sorted[0], sorted[1]]);
  return cards.map((c) => keep.has(c));
}

// ======================= SLOTS: THE ONE-ARMED BANDIT ==========================
// A classic three-reel machine: sevens, single / double / triple BARs,
// cherries, bells, hearts and a gold WILD star, with blanks between them the
// way real strips are cut. The glass shows three rows; one pull plays all five
// lines (the three rows and both diagonals). Pays are in coins, one coin per
// line, so a pull is five coins; the casino turns coins into chips at whatever
// a pull cost you. A WILD stands in for anything and doubles the line it helps
// (two of them: x4). Three hearts also heal you, three bells also bring ammo.
//
// Paying back more than it takes is on purpose: it's a game about the house
// losing. slotStats() works the exact figure out by trying every stop.

export const REELS = [
  ['seven', 'blank', 'cherry', 'blank', 'bar1', 'blank', 'bell', 'blank', 'bar2', 'blank', 'cherry',
    'blank', 'heart', 'blank', 'bar1', 'wild', 'bar3', 'cherry', 'bar1', 'bell', 'heart', 'bar2'],
  ['seven', 'blank', 'bar1', 'blank', 'cherry', 'blank', 'bell', 'blank', 'bar2', 'blank', 'heart',
    'blank', 'bar1', 'blank', 'wild', 'blank', 'bar3', 'cherry', 'bar1', 'bell', 'heart', 'bar2'],
  ['bar1', 'blank', 'seven', 'blank', 'heart', 'blank', 'bar2', 'blank', 'cherry', 'blank', 'bell',
    'blank', 'wild', 'blank', 'bar1', 'blank', 'bar3', 'bell', 'cherry', 'bar2', 'bar1', 'heart'],
];

/** rows[i] = which row of the glass each reel's symbol sits on for that line */
export const SLOT_LINES = [
  { name: 'TOP LINE', rows: [0, 0, 0] },
  { name: 'CENTER LINE', rows: [1, 1, 1] },
  { name: 'BOTTOM LINE', rows: [2, 2, 2] },
  { name: 'DIAGONAL ↘', rows: [0, 1, 2] },
  { name: 'DIAGONAL ↗', rows: [2, 1, 0] },
];
export const COINS_PER_PULL = SLOT_LINES.length;

/** three of a kind (wilds may stand in), in coins per line */
export const SLOT_PAYS = {
  wild: 300, seven: 100, bar3: 50, bar2: 25, bar1: 12, bell: 15, heart: 10, cherry: 10,
};
export const SLOT_ANY_BAR = 5;       // any mix of BARs
export const SLOT_TWO_CHERRIES = 3;  // cherries on the first two reels
export const SLOT_ONE_CHERRY = 1;    // a cherry on the first reel

/** the paytable as the glass shows it, best first */
export const SLOT_PAYTABLE = [
  { combo: ['wild', 'wild', 'wild'], coins: SLOT_PAYS.wild, key: 'wild' },
  { combo: ['seven', 'seven', 'seven'], coins: SLOT_PAYS.seven, key: 'seven' },
  { combo: ['bar3', 'bar3', 'bar3'], coins: SLOT_PAYS.bar3, key: 'bar3' },
  { combo: ['bar2', 'bar2', 'bar2'], coins: SLOT_PAYS.bar2, key: 'bar2' },
  { combo: ['bell', 'bell', 'bell'], coins: SLOT_PAYS.bell, key: 'bell', note: '+ AMMO' },
  { combo: ['bar1', 'bar1', 'bar1'], coins: SLOT_PAYS.bar1, key: 'bar1' },
  { combo: ['heart', 'heart', 'heart'], coins: SLOT_PAYS.heart, key: 'heart', note: '+ HEAL' },
  { combo: ['cherry', 'cherry', 'cherry'], coins: SLOT_PAYS.cherry, key: 'cherry' },
  { combo: ['anybar', 'anybar', 'anybar'], coins: SLOT_ANY_BAR, key: 'anybar' },
  { combo: ['cherry', 'cherry', 'any'], coins: SLOT_TWO_CHERRIES, key: 'cherry2' },
  { combo: ['cherry', 'any', 'any'], coins: SLOT_ONE_CHERRY, key: 'cherry1' },
];

const BARS = new Set(['bar1', 'bar2', 'bar3']);

/** pull the arm: where each reel stops */
export function spinSlotMachine(rng = Math.random) {
  return REELS.map((strip) => Math.floor(rng() * strip.length));
}

/** what the glass shows: win[reel][row], the stop on the middle row */
export function slotWindow(stops) {
  return REELS.map((strip, i) => [-1, 0, 1].map((d) => strip[(stops[i] + d + strip.length) % strip.length]));
}

/** one line's three symbols -> { coins, key } (key names the paytable row) */
export function slotLinePay(line) {
  const wilds = line.filter((s) => s === 'wild').length;
  if (wilds === 3) return { coins: SLOT_PAYS.wild, key: 'wild', wilds };
  const dbl = 2 ** wilds;
  let best = { coins: 0, key: null, wilds };
  const take = (coins, key) => { if (coins > best.coins) best = { coins, key, wilds }; };
  for (const [sym, pay] of Object.entries(SLOT_PAYS)) {
    if (sym !== 'wild' && line.every((s) => s === sym || s === 'wild')) take(pay * dbl, sym);
  }
  if (line.every((s) => BARS.has(s) || s === 'wild')) take(SLOT_ANY_BAR * dbl, 'anybar');
  const ch = (s) => s === 'cherry' || s === 'wild';
  if (ch(line[0]) && ch(line[1]) && (line[0] === 'cherry' || line[1] === 'cherry')) {
    take(SLOT_TWO_CHERRIES * 2 ** ((line[0] === 'wild') + (line[1] === 'wild')), 'cherry2');
  } else if (line[0] === 'cherry') take(SLOT_ONE_CHERRY, 'cherry1');
  return best;
}

/** the whole glass -> { coins, wins:[{line, name, rows, coins, key, wilds}], heal, ammo } */
export function evalSlotWindow(win) {
  const out = { coins: 0, wins: [], heal: false, ammo: false };
  SLOT_LINES.forEach((L, line) => {
    const syms = L.rows.map((row, reel) => win[reel][row]);
    const pay = slotLinePay(syms);
    if (!pay.coins) return;
    out.coins += pay.coins;
    out.wins.push({ line, name: L.name, rows: L.rows, ...pay });
    if (pay.key === 'heart') out.heal = true;
    if (pay.key === 'bell') out.ammo = true;
  });
  return out;
}

/** exact odds over every stop combination -> { rtp (coins back per coin in), hit, topPrize } */
export function slotStats() {
  const [A, B, C] = REELS.map((r) => r.length);
  let coins = 0, hits = 0, top = 0;
  for (let a = 0; a < A; a++) for (let b = 0; b < B; b++) for (let c = 0; c < C; c++) {
    const r = evalSlotWindow(slotWindow([a, b, c]));
    coins += r.coins;
    if (r.coins > 0) hits++;
    if (r.wins.some((w) => w.key === 'wild' || w.key === 'seven')) top++;
  }
  const n = A * B * C;
  return { rtp: coins / n / COINS_PER_PULL, hit: hits / n, topPrize: top / n };
}
