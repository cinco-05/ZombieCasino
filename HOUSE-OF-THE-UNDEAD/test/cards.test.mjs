// test/cards.test.mjs — run with: npm test
import assert from 'node:assert';
import {
  newDeck, handValue, isBlackjack, dealerPlay, resolveBlackjack,
  WHEEL_ORDER, pocketColor, spinRoulette, evaluateRouletteBet,
  spinSlots, slotPayout, SLOT_SYMBOLS,
  spinGrid, evalSlotsGrid, SLOT_LINES,
  evaluatePokerHand, comparePoker, pokerTier, dealerHolds,
  spinGrid5, evalSlotsGrid5, SLOT_LINES_5,
} from '../src/cards.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok -', name); }

test('deck has 52 unique cards', () => {
  const d = newDeck();
  assert.equal(d.length, 52);
  assert.equal(new Set(d.map((c) => c.rank + c.suit)).size, 52);
});

test('hand values with soft aces', () => {
  const c = (rank) => ({ rank, suit: '♠' });
  assert.equal(handValue([c('A'), c('K')]), 21);
  assert.equal(handValue([c('A'), c('A')]), 12);
  assert.equal(handValue([c('A'), c('9'), c('5')]), 15);
  assert.equal(handValue([c('K'), c('Q'), c('5')]), 25);
});

test('blackjack detection', () => {
  const c = (rank) => ({ rank, suit: '♥' });
  assert.ok(isBlackjack([c('A'), c('J')]));
  assert.ok(!isBlackjack([c('A'), c('5'), c('5')]));
});

test('dealer stands on 17', () => {
  const c = (rank) => ({ rank, suit: '♦' });
  const deck = [c('9'), c('2')]; // pops from the end
  const hand = dealerPlay(deck, [c('K'), c('5')]); // 15 -> +2 = 17 stop
  assert.equal(handValue(hand), 17);
  assert.equal(deck.length, 1);
});

test('blackjack resolution', () => {
  const c = (rank) => ({ rank, suit: '♣' });
  assert.equal(resolveBlackjack([c('K'), c('K'), c('5')], [c('K'), c('7')]), 'loss'); // bust
  assert.equal(resolveBlackjack([c('A'), c('K')], [c('K'), c('7')]), 'blackjack');
  assert.equal(resolveBlackjack([c('K'), c('9')], [c('K'), c('K'), c('5')]), 'win'); // dealer bust
  assert.equal(resolveBlackjack([c('K'), c('9')], [c('K'), c('9')]), 'push');
  assert.equal(resolveBlackjack([c('K'), c('7')], [c('K'), c('9')]), 'loss');
});

test('wheel has all 37 pockets', () => {
  assert.equal(WHEEL_ORDER.length, 37);
  assert.equal(new Set(WHEEL_ORDER).size, 37);
  assert.equal(pocketColor(0), 'green');
  assert.equal(pocketColor(32), 'red');
  assert.equal(pocketColor(15), 'black');
});

test('spin always lands on a real pocket', () => {
  for (let i = 0; i < 200; i++) {
    const { index, number } = spinRoulette();
    assert.equal(WHEEL_ORDER[index], number);
  }
});

test('roulette bet evaluation', () => {
  assert.ok(evaluateRouletteBet({ type: 'red' }, 32));
  assert.ok(!evaluateRouletteBet({ type: 'red' }, 15));
  assert.ok(evaluateRouletteBet({ type: 'odd' }, 7));
  assert.ok(evaluateRouletteBet({ type: 'even' }, 8));
  assert.ok(evaluateRouletteBet({ type: 'low' }, 18));
  assert.ok(evaluateRouletteBet({ type: 'high' }, 19));
  assert.ok(evaluateRouletteBet({ type: 'single', number: 7 }, 7));
  assert.ok(!evaluateRouletteBet({ type: 'single', number: 7 }, 8));
  // zero beats every outside bet
  for (const t of ['red', 'black', 'odd', 'even', 'low', 'high']) {
    assert.ok(!evaluateRouletteBet({ type: t }, 0), t + ' vs 0');
  }
  assert.ok(evaluateRouletteBet({ type: 'single', number: 0 }, 0));
});

test('slots: reels only produce known symbols', () => {
  const known = new Set(SLOT_SYMBOLS.map((s) => s.sym));
  for (let i = 0; i < 300; i++) {
    for (const s of spinSlots()) assert.ok(known.has(s));
  }
});

test('slots payouts', () => {
  assert.equal(slotPayout(['7', '7', '7']).chips, 400);
  assert.equal(slotPayout(['🍒', '🍒', '🍒']).chips, 120);
  assert.ok(slotPayout(['🔔', '🔔', '🔔']).ammo);
  assert.equal(slotPayout(['♥', '♥', '♥']).heal, 35);
  assert.equal(slotPayout(['💀', '💀', '💀']).hurt, 15);
  assert.equal(slotPayout(['7', '7', '🍒']).chips, 90);
  assert.equal(slotPayout(['7', '🍒', '♥']).chips, 0);
});

test('3x3 grid: shape and symbols valid', () => {
  const known = new Set(SLOT_SYMBOLS.map((s) => s.sym));
  for (let i = 0; i < 50; i++) {
    const g = spinGrid();
    assert.equal(g.length, 3);
    for (const col of g) { assert.equal(col.length, 3); for (const s of col) assert.ok(known.has(s)); }
  }
});

test('3x3 grid: 5 paylines evaluated', () => {
  assert.equal(SLOT_LINES.length, 5);
  // all cherries -> all 5 lines win
  const allCherry = [['🍒','🍒','🍒'],['🍒','🍒','🍒'],['🍒','🍒','🍒']];
  const r = evalSlotsGrid(allCherry);
  assert.equal(r.wins.length, 5);
  assert.equal(r.chips, 600);
  // only middle row is sevens
  const mid7 = [['🍒','7','♥'],['💀','7','🔔'],['♥','7','🍒']];
  const r2 = evalSlotsGrid(mid7);
  assert.equal(r2.wins.length, 1);
  assert.equal(r2.wins[0].name, 'MIDDLE');
  assert.equal(r2.chips, 400);
  // diagonal hearts heal
  const diag = [['♥','🍒','7'],['💀','♥','🔔'],['7','🍒','♥']];
  const r3 = evalSlotsGrid(diag);
  assert.equal(r3.wins.length, 1);
  assert.equal(r3.heal, 35);
});

test('poker hand ranks', () => {
  const H = (str) => str.split(' ').map((t) => ({ rank: t.slice(0, -1), suit: t.slice(-1) }));
  assert.equal(evaluatePokerHand(H('A♠ K♦ 9♣ 5♥ 2♠')).rank, 0);
  assert.equal(evaluatePokerHand(H('A♠ A♦ 9♣ 5♥ 2♠')).rank, 1);
  assert.equal(evaluatePokerHand(H('A♠ A♦ 9♣ 9♥ 2♠')).rank, 2);
  assert.equal(evaluatePokerHand(H('A♠ A♦ A♣ 9♥ 2♠')).rank, 3);
  assert.equal(evaluatePokerHand(H('6♠ 5♦ 4♣ 3♥ 2♠')).rank, 4);
  assert.equal(evaluatePokerHand(H('A♠ 5♦ 4♣ 3♥ 2♠')).rank, 4, 'wheel');
  assert.equal(evaluatePokerHand(H('A♠ 5♦ 4♣ 3♥ 2♠')).tiebreak[0], 5, 'wheel is 5-high');
  assert.equal(evaluatePokerHand(H('K♠ 9♠ 7♠ 5♠ 2♠')).rank, 5);
  assert.equal(evaluatePokerHand(H('A♠ A♦ A♣ 9♥ 9♠')).rank, 6);
  assert.equal(evaluatePokerHand(H('A♠ A♦ A♣ A♥ 9♠')).rank, 7);
  assert.equal(evaluatePokerHand(H('6♠ 5♠ 4♠ 3♠ 2♠')).rank, 8);
});

test('poker compare + tiers', () => {
  const H = (str) => str.split(' ').map((t) => ({ rank: t.slice(0, -1), suit: t.slice(-1) }));
  const pairA = evaluatePokerHand(H('A♠ A♦ 9♣ 5♥ 2♠'));
  const pairK = evaluatePokerHand(H('K♠ K♦ 9♣ 5♥ 2♠'));
  assert.equal(comparePoker(pairA, pairK), 1);
  // kicker decides equal pairs
  const pA9 = evaluatePokerHand(H('A♠ A♦ 9♣ 5♥ 2♠'));
  const pA8 = evaluatePokerHand(H('A♣ A♥ 8♣ 5♦ 2♦'));
  assert.equal(comparePoker(pA9, pA8), 1);
  assert.equal(comparePoker(pA9, pA9), 0);
  assert.equal(pokerTier(0), 'common');
  assert.equal(pokerTier(1), 'common');
  assert.equal(pokerTier(2), 'rare');
  assert.equal(pokerTier(4), 'rare');
  assert.equal(pokerTier(5), 'legendary');
  assert.equal(pokerTier(8), 'legendary');
});

test('dealer hold logic', () => {
  const H = (str) => str.split(' ').map((t) => ({ rank: t.slice(0, -1), suit: t.slice(-1) }));
  // holds the pair
  assert.deepEqual(dealerHolds(H('A♠ A♦ 9♣ 5♥ 2♠')), [true, true, false, false, false]);
  // no pair: holds two highest
  assert.deepEqual(dealerHolds(H('A♠ K♦ 9♣ 5♥ 2♠')), [true, true, false, false, false]);
});

test('5x5 grid: shape, lines, symbols', () => {
  const known = new Set(SLOT_SYMBOLS.map((s) => s.sym));
  const g = spinGrid5();
  assert.equal(g.length, 5);
  for (const col of g) { assert.equal(col.length, 5); for (const s of col) assert.ok(known.has(s)); }
  assert.equal(SLOT_LINES_5.length, 7);
});

test('5x5 runs pay: 3/4/5-length multipliers', () => {
  const col = (a) => a;   // grid[col][row]
  // top row: 7 7 7 x x  -> 3-run of 7s = 120
  const g1 = [col(['7','♥','💀','♥','💀']), col(['7','♥','💀','♥','💀']), col(['7','♥','💀','♥','💀']),
              col(['🍒','♥','💀','♥','💀']), col(['🔔','♥','💀','♥','💀'])];
  // careful: rows 1-4 also form runs of ♥/💀 — count only row 0 by breaking them up
  const g = [['7','♥','💀','🍒','🔔'], ['7','💀','♥','🔔','🍒'], ['7','♥','💀','🍒','🔔'],
             ['🍒','💀','♥','🔔','🍒'], ['🔔','♥','💀','🍒','🔔']];
  const r = evalSlotsGrid5(g);
  const row1 = r.wins.find((w) => w.name === 'ROW 1');
  assert.ok(row1 && row1.len === 3);
  assert.equal(row1.cells.length, 3);
  // full row of sevens pays 10x
  const g5 = [['7','♥','💀','🍒','🔔'], ['7','💀','♥','🔔','🍒'], ['7','♥','💀','🍒','🔔'],
              ['7','💀','♥','🔔','🍒'], ['7','♥','💀','🍒','🔔']];
  const r5 = evalSlotsGrid5(g5);
  const row = r5.wins.find((w) => w.name === 'ROW 1');
  assert.equal(row.len, 5);
  assert.equal(r5.chips, 1200);
  // diagonal hearts: [i][i] all ♥ -> heal
  const gd = [['♥','💀','🍒','🔔','7'], ['💀','♥','🍒','🔔','7'], ['🍒','🔔','♥','7','💀'],
              ['🔔','7','💀','♥','🍒'], ['7','💀','🍒','🔔','♥']];
  const rd = evalSlotsGrid5(gd);
  const diag = rd.wins.find((w) => w.name.startsWith('DIAG \u2198'));
  assert.ok(diag && diag.len === 5);
  assert.equal(rd.heal, 120);
});

console.log(`\n${passed} tests passed.`);
