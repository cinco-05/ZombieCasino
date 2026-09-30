// test/cards.test.mjs — run with: npm test
import assert from 'node:assert';
import {
  newDeck, handValue, isBlackjack, dealerPlay, resolveBlackjack, canSplit, resolveSplitHand,
  WHEEL_ORDER, pocketColor, spinRoulette, evaluateRouletteBet,
  REELS, SLOT_LINES, spinSlotMachine, slotWindow, slotLinePay, evalSlotWindow, slotStats,
  evaluatePokerHand, comparePoker, pokerTier, dealerHolds,
} from '../src/cards.js';
import { Seed, hashStr, normalizeSeed, randomSeed } from '../src/rng.js';
import { SONGS } from '../src/audio.js';

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

test('split: pairs and any two tens split, mixed values do not', () => {
  const c = (rank) => ({ rank, suit: '♣' });
  assert.ok(canSplit([c('8'), c('8')]));
  assert.ok(canSplit([c('K'), c('10')]));
  assert.ok(canSplit([c('A'), c('A')]));
  assert.ok(!canSplit([c('9'), c('8')]));
  assert.ok(!canSplit([c('8'), c('8'), c('2')]));
});

test('split hands: a two-card 21 is a plain 21, a dealer natural beats it', () => {
  const c = (rank) => ({ rank, suit: '♦' });
  assert.equal(resolveSplitHand([c('A'), c('K')], [c('10'), c('9')]), 'win');
  assert.equal(resolveSplitHand([c('A'), c('K')], [c('10'), c('6'), c('5')]), 'push');
  assert.equal(resolveSplitHand([c('A'), c('K')], [c('A'), c('Q')]), 'loss');
  assert.equal(resolveSplitHand([c('10'), c('6'), c('9')], [c('10'), c('7')]), 'loss');
  assert.equal(resolveSplitHand([c('10'), c('8')], [c('10'), c('6'), c('9')]), 'win');
});

test('slots: three reels, five lines, the glass shows three rows', () => {
  assert.equal(REELS.length, 3);
  assert.equal(SLOT_LINES.length, 5);
  for (let i = 0; i < 200; i++) {
    const w = slotWindow(spinSlotMachine());
    assert.equal(w.length, 3);
    for (const col of w) assert.equal(col.length, 3);
  }
  // the middle row is the stop itself
  assert.equal(slotWindow([0, 0, 0])[0][1], REELS[0][0]);
});

test('slots: the paytable, wilds and cherries', () => {
  assert.equal(slotLinePay(['seven', 'seven', 'seven']).coins, 100);
  assert.equal(slotLinePay(['wild', 'wild', 'wild']).coins, 300);
  assert.equal(slotLinePay(['seven', 'wild', 'seven']).coins, 200);      // a wild doubles it
  assert.equal(slotLinePay(['wild', 'seven', 'wild']).coins, 400);       // two wilds: x4
  assert.equal(slotLinePay(['bar1', 'bar3', 'bar2']).coins, 5);          // any bar
  assert.equal(slotLinePay(['cherry', 'cherry', 'blank']).coins, 3);
  assert.equal(slotLinePay(['cherry', 'blank', 'cherry']).coins, 1);     // only the first reel counts
  assert.equal(slotLinePay(['blank', 'cherry', 'cherry']).coins, 0);
  assert.equal(slotLinePay(['wild', 'blank', 'blank']).coins, 0);        // a lone wild isn't a cherry
  const all7 = [['seven', 'seven', 'seven'], ['seven', 'seven', 'seven'], ['seven', 'seven', 'seven']];
  assert.equal(evalSlotWindow(all7).coins, 500);                         // five lines of sevens
  const hearts = [['blank', 'heart', 'blank'], ['blank', 'heart', 'blank'], ['blank', 'heart', 'blank']];
  assert.ok(evalSlotWindow(hearts).heal);
});

test('slots: the machine pays back more than it takes, and hits often', () => {
  const s = slotStats();
  assert.ok(s.rtp > 1.02 && s.rtp < 1.25, `payback ${s.rtp}`);
  assert.ok(s.hit > 0.4, `hit rate ${s.hit}`);
  assert.ok(s.topPrize > 0.001, `top prize ${s.topPrize}`);
});

test('seeds: same seed, same deal; streams stay independent', () => {
  Seed.begin('LUCKY-7');
  const deckA = newDeck(Seed.rng('blackjack')).map((c) => c.rank + c.suit).join();
  const spinA = spinSlotMachine(Seed.rng('slots')).join();
  Seed.begin('lucky-7');                                   // typed in lowercase: same seed
  Seed.random('shop'); Seed.random('shop');                 // another table's draws don't matter
  assert.equal(newDeck(Seed.rng('blackjack')).map((c) => c.rank + c.suit).join(), deckA);
  assert.equal(spinSlotMachine(Seed.rng('slots')).join(), spinA);
  Seed.begin('LUCKY-8');
  assert.notEqual(newDeck(Seed.rng('blackjack')).map((c) => c.rank + c.suit).join(), deckA);
});

test('seeds: a saved run picks up exactly where it left off', () => {
  Seed.begin('SAVE-ME');
  for (let i = 0; i < 5; i++) Seed.random('rounds');
  const saved = JSON.parse(JSON.stringify(Seed.save()));
  const next = [Seed.random('rounds'), Seed.random('roulette')];
  Seed.begin('SOMETHING-ELSE');
  Seed.restore(saved);
  assert.deepEqual([Seed.random('rounds'), Seed.random('roulette')], next);
  assert.equal(Seed.text, 'SAVE-ME');
});

test('seeds: typing is forgiving, random seeds are shareable', () => {
  assert.equal(normalizeSeed('  hello world! '), 'HELLOWORLD');
  assert.equal(normalizeSeed(''), '');
  assert.match(randomSeed(), /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(hashStr('abc'), hashStr('abc'));
  assert.equal(Seed.begin(''), Seed.text);
  assert.ok(!Seed.custom);
});

test('the band: three tunes, every bar adds up to four beats', () => {
  assert.equal(SONGS.length, 3);
  const beats = (txt) => (txt || '').trim().split(/\s+/).filter(Boolean).reduce((s, tok) => s + parseFloat(tok.split(':')[1]), 0);
  for (const song of SONGS) {
    assert.equal(song.melody.length, song.chords.length, `${song.title}: a melody bar for every chord bar`);
    for (const [i, bar] of song.melody.entries()) assert.equal(beats(bar), 4, `${song.title} bar ${i + 1}: "${bar}"`);
    assert.equal(beats(song.end), 4, `${song.title} ending`);
    for (const bar of song.introMelody) assert.ok(!bar || beats(bar) === 4, `${song.title} intro "${bar}"`);
    for (const c of song.chords.join(' ').split(' ')) assert.match(c, /^[A-G][#b]?(maj7|m7b5|dim7|m7|m6|m|6|7|9)?$/, `${song.title}: chord ${c}`);
    assert.ok(song.choruses.length >= 2);
  }
});

console.log(`\n${passed} tests passed.`);
