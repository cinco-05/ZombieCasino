// gazette.js — THE EVENING GHOUL. Every run ends with its own front page:
// a headline picked from whatever was most remarkable about the night (a
// sweep at the slots, eights split at the worst moment, a round-one exit, the
// boss that finally got you), a short story built from what really happened,
// and a word from a witness. The same night never reads quite the same twice,
// and a bad night still gets a laugh. Pure text, no DOM: ui.js prints it.

/** how the paper names whoever got you */
const CULPRIT = {
  WALKER: 'a shuffling regular', SPRINTER: 'a valet in a terrible hurry', BRUTE: 'a bouncer the size of a vending machine',
  SPITTER: 'a spitter with no manners at all', GASBAG: 'a gasbag who would not stop talking', PITGUARD: 'a pit guard on overtime',
  CROUPIER: 'a croupier with a grudge', MAGICIAN: 'a magician who never did reappear the rabbit', JACKPOT: 'a walking jackpot',
  SHOWGIRL: 'the midnight chorus line', 'THE KING': 'The King himself', 'THE DEBT COLLECTOR': 'the Debt Collector',
  'THE GOLDEN GAMBLER': 'the Golden Gambler', 'THE PIT BOSS': 'the Pit Boss', 'THE HOUSE DEALER': 'the House Dealer',
};
const culprit = (cause) => CULPRIT[String(cause || '').toUpperCase()] || (cause && !/horde|test/i.test(cause) ? String(cause).toLowerCase() : 'the horde');

const WITNESSES = ['Mortimer, the night dealer', 'Bones Malone, of the craps table', 'Gravedigger Gus, a regular', 'Louie the Lid, the doorman',
  'Sleepy Sal, the cigarette girl', 'Deadeye Delores, from the cage', 'Digby, the house pianist', 'the late Mr. Finch'];

const QUOTES = {
  win: ['I haven\'t seen the house lose like that since Prohibition.', 'Somebody check the dice. Then check them again.',
    'They tipped the band. Nobody tips the band.', 'The boss wants a word. A long word. With lawyers.'],
  early: ['Didn\'t even finish their drink.', 'In and out. Like a ghost, only quicker.', 'I was still shuffling the deck.',
    'Sweet kid. Never stood a chance.'],
  boss: ['The boss always gets paid. Always.', 'Brave. Very brave. Very, very flat.', 'You don\'t walk into his floor and walk out. Usually.'],
  table: ['Never split tens, I told them. Never split anything.', 'The cards loved them right up until they didn\'t.',
    'They kept saying "one more hand." I\'ve heard that before.'],
  slots: ['That machine hasn\'t paid out since 1931. It\'s furious.', 'The bells went off and the whole floor turned around.'],
  shooter: ['Best shooting I\'ve seen on this floor, and I\'ve seen the floor.', 'Every shot a winner. Wish I could say that about my horses.'],
  plain: ['Nice enough. Bad with money.', 'They\'ll be back. They always come back.', 'Another night at the House. Pass the peanuts.',
    'The band played on. The band always plays on.'],
};

const pick = (list, rng) => list[Math.floor(rng() * list.length)];
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** the gun with the most kills (null if none) */
function favoriteGun(gunKills = {}) {
  let best = null, n = 0;
  for (const [gun, k] of Object.entries(gunKills)) if (k > n) { best = gun; n = k; }
  return best ? { gun: best, n } : null;
}

/**
 * write tonight's front page.
 * night: { name, won, cashedOut, round, rounds, cause, chips, coop, stats }
 * returns { masthead, dateline, headline, deck, story, quote, witness }
 */
export function writeGazette(night, rng = Math.random) {
  const s = night.stats || {};
  const who = (night.name || 'A LOCAL GAMBLER').toUpperCase();
  const r = night.round || 1;
  const bets = (s.wagersWon || 0) + (s.wagersLost || 0);
  const fav = favoriteGun(s.gunKills);

  // the headline: the most remarkable thing that happened, roughly in this order
  let headline, deck, mood;
  if (night.won && night.cashedOut) {
    headline = pick([`${who} BREAKS THE BANK, WALKS INTO SUNRISE`, `HOUSE FOLDS; ${who} CASHES OUT`], rng);
    deck = `Cashed out after round ${r} with ${night.chips || 0} chips; management "reviewing the cameras"`;
    mood = 'win';
  } else if (night.won) {
    headline = pick([`HOUSE DEALER FOLDS; ${who} PLAYS ON INTO THE NIGHT`, `${who} BEATS THE HOUSE, THEN KEEPS GAMBLING`], rng);
    deck = `Broke the bank, stayed for endless rounds, finally fell to ${culprit(night.cause)} on round ${r}`;
    mood = 'win';
  } else if (/PIT BOSS|HOUSE DEALER/i.test(night.cause || '')) {
    headline = /PIT BOSS/i.test(night.cause) ? pick(['PIT BOSS EVICTS ANOTHER REGULAR', 'THE PIT BOSS COLLECTS'], rng)
      : pick(['THE HOUSE DEALER CALLS IN THE MARKER', 'HOUSE DEALER: "THE HOUSE ALWAYS WINS"'], rng);
    deck = `${who} made it to round ${r} before the management stepped in personally`;
    mood = 'boss';
  } else if (r <= 1) {
    headline = pick([`NEWCOMER LASTS ONE ROUND; "I WAS LOOKING FOR THE BUFFET"`, `${who} ARRIVES, LEAVES, IN THAT ORDER`], rng);
    deck = `Undone by ${culprit(night.cause)} before the first drink was poured`;
    mood = 'early';
  } else if ((s.slotJackpots || 0) > 0) {
    headline = pick([`ONE-ARMED BANDIT LOSES ITS SHIRT TO ${who}`, `SEVENS ALL ACROSS! ${who} EMPTIES LUCKY UNDEAD`], rng);
    deck = `${plural(s.slotJackpots, 'jackpot')} at the slots; the biggest pull paid ${s.slotBest} chips`;
    mood = 'slots';
  } else if ((s.splits || 0) >= 2) {
    headline = pick([`${who} SPLITS ${s.splits} TIMES, REGRETS NOTHING`, 'LOCAL GAMBLER SPLITS EIGHTS; EIGHTS SPLIT BACK'], rng);
    deck = `A night of bold blackjack ends on round ${r} at the hands of ${culprit(night.cause)}`;
    mood = 'table';
  } else if ((s.bestCombo || 0) >= 20) {
    headline = pick([`${s.bestCombo}-KILL STREAK LEAVES CHORUS LINE SHORT-HANDED`, `${who} ON FIRE: ${s.bestCombo} IN A ROW`], rng);
    deck = `A hot streak for the ages, until ${culprit(night.cause)} cooled things off on round ${r}`;
    mood = 'shooter';
  } else if ((s.headshots || 0) >= 25) {
    headline = pick([`SHARPSHOOTER PARTS ${s.headshots} HAIRDOS`, `${who}: ${s.headshots} HEADSHOTS, NO WAITING`], rng);
    deck = `Precision on the casino floor, right up to round ${r}`;
    mood = 'shooter';
  } else if ((s.wagersLost || 0) >= 3 && (s.wagersLost || 0) > (s.wagersWon || 0)) {
    headline = pick([`${s.gambled} CHIPS VANISH AT THE TABLES; HOUSE "DELIGHTED"`, `${who} DISCOVERS THE HOUSE EDGE`], rng);
    deck = `Lost ${plural(s.wagersLost, 'bet')}, won ${s.wagersWon}; then ${culprit(night.cause)} settled the tab`;
    mood = 'table';
  } else if (s.secondChance) {
    headline = pick(['BACK FROM THE DEAD, STILL BROKE', `${who} GETS A SECOND CHANCE, USES IT UP`], rng);
    deck = `The house dealt one more hand; ${culprit(night.cause)} dealt the last one on round ${r}`;
    mood = 'plain';
  } else {
    headline = pick([`${culprit(night.cause).toUpperCase()} CLAIMS ANOTHER`, `ROUND ${r}: THE NIGHT ${who} RAN OUT OF LUCK`,
      'ANOTHER QUIET NIGHT AT THE HOUSE OF THE UNDEAD'], rng);
    deck = `${who} held the floor for ${plural(r, 'round')} before ${culprit(night.cause)} got the last word`;
    mood = 'plain';
  }

  // the story: what really happened, one sentence at a time
  const lines = [];
  lines.push(night.won
    ? `${who} beat the house tonight, and the house is still counting.`
    : `${who} walked onto the floor of the House of the Undead and stayed for ${plural(r, 'round')}.`);
  if (s.kills) {
    lines.push(`They sent ${plural(s.kills, 'of the departed', 'of the departed')} back to their seats${s.headshots ? `, ${s.headshots} with a single clean shot` : ''}${fav && fav.gun !== 'explosions' ? `, mostly with ${titleCase(fav.gun)}` : fav ? ', mostly by blowing things up' : ''}.`);
  } else {
    lines.push('Witnesses agree not one of the departed was inconvenienced.');
  }
  if (bets) {
    const table = `At the tables they put ${s.gambled || 0} chips on the felt and won ${s.wagersWon || 0} of ${plural(bets, 'bet')}`;
    const extras = [];
    if (s.naturals) extras.push(plural(s.naturals, 'natural blackjack'));
    if (s.splits) extras.push(`${plural(s.splits, 'split')}`);
    if (s.straightUp) extras.push(`${plural(s.straightUp, 'straight-up number')} on the wheel`);
    if (s.pokerBest) extras.push(`a winning ${s.pokerBest.toLowerCase()} at five card draw`);
    lines.push(`${table}${extras.length ? `, including ${listify(extras)}` : ''}.`);
  } else {
    lines.push('They never sat down at a table, which the dealers took personally.');
  }
  if (s.slotPulls) lines.push(`The slots took ${plural(s.slotPulls, 'pull')}${s.slotBest ? ` and paid as much as ${s.slotBest} chips at once` : ' and paid nothing, as is tradition'}.`);
  if (night.coop && s.revivesGiven) lines.push(`They picked a friend up off the carpet ${plural(s.revivesGiven, 'time')}.`);
  if (night.coop && !s.revivesGiven && (s.deaths || 0) > 0) lines.push(`Their friends picked them up off the carpet more than once. Nobody is keeping score. (Somebody is keeping score.)`);

  return {
    masthead: 'THE EVENING GHOUL',
    dateline: `LAS VEGAS · ROUND ${r} EDITION · PRICE TWO CHIPS`,
    headline, deck,
    story: lines.join(' '),
    quote: pick(QUOTES[mood] || QUOTES.plain, rng),
    witness: pick(WITNESSES, rng),
  };
}

function titleCase(s) { return String(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()); }
function listify(items) { return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`; }
