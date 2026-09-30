import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handValue, isBlackjack, resolveBlackjack, evaluateRouletteBet,
  pocketColor, slotLinePay, slotStats, WHEEL_ORDER,
} from '../src/cards.js';

const card = (rank, suit = '♠') => ({ rank, suit });

test('aces are valued without busting', () => {
  assert.equal(handValue([card('A'), card('9'), card('A')]), 21);
  assert.equal(handValue([card('A'), card('K')]), 21);
});

test('blackjack outcomes cover natural, push, win and loss', () => {
  assert.equal(isBlackjack([card('A'), card('K')]), true);
  assert.equal(resolveBlackjack([card('A'), card('K')], [card('10'), card('9')]), 'blackjack');
  assert.equal(resolveBlackjack([card('10'), card('8')], [card('9'), card('9')]), 'push');
  assert.equal(resolveBlackjack([card('10'), card('9')], [card('10'), card('8')]), 'win');
  assert.equal(resolveBlackjack([card('10'), card('7')], [card('10'), card('8')]), 'loss');
});

test('European roulette uses all 37 unique pockets and zero loses even-money bets', () => {
  assert.equal(WHEEL_ORDER.length, 37);
  assert.equal(new Set(WHEEL_ORDER).size, 37);
  assert.equal(pocketColor(0), 'green');
  assert.equal(evaluateRouletteBet({ type: 'red' }, 0), false);
  assert.equal(evaluateRouletteBet({ type: 'single', number: 7 }, 7), true);
  assert.equal(evaluateRouletteBet({ type: 'high' }, 22), true);
});

test('slot payouts expose concrete rewards', () => {
  assert.equal(slotLinePay(['seven', 'seven', 'seven']).coins, 100);
  assert.equal(slotLinePay(['heart', 'heart', 'heart']).key, 'heart');
  assert.equal(slotLinePay(['bell', 'bell', 'bell']).key, 'bell');
  assert.ok(slotStats().rtp > 1);
});
