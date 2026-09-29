// cards.js — pure casino logic (no DOM, no THREE). Blackjack deck + dealer,
// European roulette wheel, and the NEW slot machine. Tested by test/cards.test.mjs.

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

// ================================ SLOTS (NEW) ================================
// Weighted 3-reel machine. One free single-reel re-spin per intermission.
export const SLOT_SYMBOLS = [
  { sym: '🍒', weight: 5 },
  { sym: '🔔', weight: 4 },
  { sym: '♥',  weight: 4 },
  { sym: '💀', weight: 3 },
  { sym: '7',  weight: 2 },
];

export function spinReel(rng = Math.random) {
  const total = SLOT_SYMBOLS.reduce((s, x) => s + x.weight, 0);
  let r = rng() * total;
  for (const x of SLOT_SYMBOLS) {
    r -= x.weight;
    if (r <= 0) return x.sym;
  }
  return SLOT_SYMBOLS[0].sym;
}

export function spinSlots(rng = Math.random) {
  return [spinReel(rng), spinReel(rng), spinReel(rng)];
}

// ---- 3x3 grid slots: 3 columns x 3 rows, 5 paylines ----
/** grid[col][row] — spin all three columns */
export function spinGrid(rng = Math.random) {
  return [0, 1, 2].map(() => [spinReel(rng), spinReel(rng), spinReel(rng)]);
}

export const SLOT_LINES = [
  { name: 'TOP LINE',  cells: [[0, 0], [1, 0], [2, 0]] },
  { name: 'MIDDLE',    cells: [[0, 1], [1, 1], [2, 1]] },
  { name: 'BOTTOM',    cells: [[0, 2], [1, 2], [2, 2]] },
  { name: 'DIAG \u2198', cells: [[0, 0], [1, 1], [2, 2]] },
  { name: 'DIAG \u2197', cells: [[0, 2], [1, 1], [2, 0]] },
];

function triplePay(sym) {
  switch (sym) {
    case '7':  return { chips: 400, label: '7·7·7 JACKPOT +400' };
    case '🍒': return { chips: 120, label: 'cherries +120' };
    case '🔔': return { ammo: true, label: 'bells: ammo refill' };
    case '♥':  return { heal: 35, label: 'hearts +35 HP' };
    case '💀': return { hurt: 15, label: 'skulls -15 HP' };
    default: return { chips: 0, label: '' };
  }
}

/** evaluate all 5 paylines -> { wins:[{name,sym,cells,label}], chips, heal, hurt, ammo } */
export function evalSlotsGrid(grid) {
  const out = { wins: [], chips: 0, heal: 0, hurt: 0, ammo: false };
  for (const line of SLOT_LINES) {
    const syms = line.cells.map(([c, r]) => grid[c][r]);
    if (syms[0] === syms[1] && syms[1] === syms[2]) {
      const pay = triplePay(syms[0]);
      out.wins.push({ name: line.name, sym: syms[0], cells: line.cells, label: pay.label });
      out.chips += pay.chips || 0;
      out.heal += pay.heal || 0;
      out.hurt += pay.hurt || 0;
      out.ammo = out.ammo || !!pay.ammo;
    }
  }
  return out;
}

/** -> { chips, heal, ammo, hurt, label } (legacy single-line machine) */
export function slotPayout(reels) {
  const count = {};
  for (const s of reels) count[s] = (count[s] || 0) + 1;
  const three = Object.keys(count).find((k) => count[k] === 3);
  const two = Object.keys(count).find((k) => count[k] === 2);
  if (three) {
    switch (three) {
      case '7':  return { chips: 400, label: '7 · 7 · 7 — JACKPOT! +400 chips' };
      case '🍒': return { chips: 120, label: 'Triple cherries! +120 chips' };
      case '🔔': return { ammo: true, label: 'Triple bells! Reserve ammo refilled' };
      case '♥':  return { heal: 35, label: 'Triple hearts! +35 health' };
      case '💀': return { hurt: 15, label: 'Triple skulls... -15 health' };
    }
  }
  if (two) {
    switch (two) {
      case '7':  return { chips: 90, label: 'Two sevens: +90 chips' };
      case '🍒': return { chips: 40, label: 'Two cherries: +40 chips' };
      case '🔔': return { chips: 25, label: 'Two bells: +25 chips' };
      case '♥':  return { heal: 10, label: 'Two hearts: +10 health' };
      case '💀': return { chips: 0, label: 'Two skulls: nothing... could be worse' };
    }
  }
  return { chips: 0, label: 'No match. The house smiles.' };
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

// ======================= 5x5 SLOTS (runs pay) ================================
// 5 columns x 5 rows. 7 paylines: all 5 rows + both main diagonals. A line
// pays on its longest run of 3+ identical symbols: x1 for 3, x3 for 4,
// x10 for the full 5.

export function spinGrid5(rng = Math.random) {
  return [0, 1, 2, 3, 4].map(() => Array.from({ length: 5 }, () => spinReel(rng)));
}

export const SLOT_LINES_5 = [
  ...[0, 1, 2, 3, 4].map((r) => ({
    name: r === 2 ? 'CENTER' : `ROW ${r + 1}`,
    cells: [0, 1, 2, 3, 4].map((c) => [c, r]),
  })),
  { name: 'DIAG \u2198', cells: [0, 1, 2, 3, 4].map((i) => [i, i]) },
  { name: 'DIAG \u2197', cells: [0, 1, 2, 3, 4].map((i) => [i, 4 - i]) },
];

const RUN_MULT = { 3: 1, 4: 3, 5: 10 };
const RUN_BASE = {
  '7':  { chips: 120 },
  '🍒': { chips: 40 },
  '🔔': { ammo: 1 },      // ammo units: 1 = +35% reserve; 3+ total = full refill
  '♥':  { heal: 12 },
  '💀': { hurt: 8 },
};

/** longest run of >=3 identical symbols in a line's symbol list */
function bestRun(syms) {
  let best = null;
  let start = 0;
  for (let i = 1; i <= syms.length; i++) {
    if (i === syms.length || syms[i] !== syms[start]) {
      const len = i - start;
      if (len >= 3 && (!best || len > best.len)) best = { sym: syms[start], start, len };
      start = i;
    }
  }
  return best;
}

/** -> { wins:[{name,sym,len,cells,label}], chips, heal, hurt, ammoUnits } */
export function evalSlotsGrid5(grid) {
  const out = { wins: [], chips: 0, heal: 0, hurt: 0, ammoUnits: 0 };
  for (const line of SLOT_LINES_5) {
    const syms = line.cells.map(([c, r]) => grid[c][r]);
    const run = bestRun(syms);
    if (!run) continue;
    const base = RUN_BASE[run.sym];
    const mult = RUN_MULT[run.len];
    const cells = line.cells.slice(run.start, run.start + run.len);
    const win = { name: line.name, sym: run.sym, len: run.len, cells };
    if (base.chips) {
      const pay = base.chips * mult;
      out.chips += pay;
      win.label = `${run.len}x ${run.sym} +${pay}`;
    } else if (base.ammo) {
      out.ammoUnits += base.ammo * mult;
      win.label = `${run.len}x 🔔 ammo`;
    } else if (base.heal) {
      const h = base.heal * mult;
      out.heal += h;
      win.label = `${run.len}x ♥ +${h} HP`;
    } else if (base.hurt) {
      const h = base.hurt * mult;
      out.hurt += h;
      win.label = `${run.len}x 💀 -${h} HP`;
    }
    out.wins.push(win);
  }
  return out;
}
