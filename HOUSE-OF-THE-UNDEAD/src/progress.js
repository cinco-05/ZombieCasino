// progress.js — everything you keep between runs, besides the Vault's chips:
//   THE LOYALTY CARD  XP from every run climbs you through nine casino
//                     status tiers; each one adds a permanent perk
//   MARKERS           achievements with visible progress ("87 / 100")
//   THE CHIP SET      twelve commemorative chips, found as hidden
//                     discoveries and rare drops
//   RECORDS           best round, best streak, most chips, most jackpots
// A run earns XP as it goes; the summary screen banks it, shows what you
// unlocked, and what you're closest to next.

const KEY = 'hotu_progress_v1';

/** status tiers: cumulative XP to reach, and the perk each one adds */
export const LOYALTY = [
  { name: 'PAPER TICKET', xp: 0, color: '#b8b0a0', perk: 'Welcome to the house' },
  { name: 'BRONZE CARD', xp: 150, color: '#cd8a4a', perk: '+25 chips at the start of every run' },
  { name: 'SILVER CARD', xp: 450, color: '#d8dde6', perk: 'Comps last 20% longer' },
  { name: 'GOLD CARD', xp: 900, color: '#ffd24a', perk: '+1 lethal at the start of every run' },
  { name: 'PLATINUM CARD', xp: 1600, color: '#e8f4ff', perk: 'The progressive jackpot fills 15% faster' },
  { name: 'DIAMOND CARD', xp: 2600, color: '#7ae8ff', perk: 'Every run starts with a free HOT HAND' },
  { name: 'BLACK CARD', xp: 4000, color: '#a0a0b8', perk: '+10% chips from everything' },
  { name: 'WHALE STATUS', xp: 6000, color: '#c27aff', perk: 'Rare comps drop 25% more often' },
  { name: 'THE HOUSE KNOWS YOUR NAME', xp: 9000, color: '#ff2d55', perk: 'Every run starts with a free HIGH ROLLER' },
];

/** stat: counter it reads; kind 'max' keeps the best single value */
export const MARKERS = [
  { id: 'kills100', name: 'NIGHT SHIFT', desc: 'Destroy 100 zombies', stat: 'kills', goal: 100, xp: 40 },
  { id: 'kills1000', name: 'GRAVEYARD SHIFT', desc: 'Destroy 1,000 zombies', stat: 'kills', goal: 1000, xp: 200 },
  { id: 'heads100', name: 'DEAD EYE', desc: 'Land 100 headshots', stat: 'headshots', goal: 100, xp: 60 },
  { id: 'round5', name: 'PROBLEM PLAYER', desc: 'Put THE PIT BOSS down', stat: 'pitboss', goal: 1, xp: 80 },
  { id: 'round10', name: 'BREAK THE BANK', desc: 'Beat THE HOUSE DEALER', stat: 'housedealer', goal: 1, xp: 300 },
  { id: 'combo20', name: 'UNSTOPPABLE', desc: 'Reach a x20 streak', stat: 'bestCombo', kind: 'max', goal: 20, xp: 50 },
  { id: 'combo50', name: 'LEGEND OF THE STRIP', desc: 'Reach a x50 streak', stat: 'bestCombo', kind: 'max', goal: 50, xp: 200 },
  { id: 'luck', name: 'LADY LUCK', desc: 'Build the wonder weapon', stat: 'luckBuilt', goal: 1, xp: 100 },
  { id: 'allin', name: 'ALL IN', desc: 'Push a gun ALL IN', stat: 'packed', goal: 1, xp: 60 },
  { id: 'allin5', name: 'THE GOLDEN TOUCH', desc: 'Push 5 guns ALL IN', stat: 'packed', goal: 5, xp: 150 },
  { id: 'jackpot3', name: 'PROGRESSIVE', desc: 'Hit the progressive jackpot 3 times in one run', stat: 'jackpotsRun', kind: 'max', goal: 3, xp: 120 },
  { id: 'rare', name: 'SOMETHING SPECIAL', desc: 'Pick up an Epic comp', stat: 'epics', goal: 1, xp: 40 },
  { id: 'legendary', name: 'ONCE IN A BLUE MOON', desc: 'Pick up a Legendary comp', stat: 'legendaries', goal: 1, xp: 150 },
  { id: 'collect6', name: 'CHIP COLLECTOR', desc: 'Find 6 commemorative chips', stat: 'collection', kind: 'max', goal: 6, xp: 100 },
  { id: 'collect12', name: 'THE FULL SET', desc: 'Complete the commemorative chip set', stat: 'collection', kind: 'max', goal: 12, xp: 400 },
  { id: 'golden', name: 'GOLD DIGGER', desc: 'Take down 5 Golden Gamblers', stat: 'golden', goal: 5, xp: 90 },
  { id: 'king', name: 'THANK YOU VERY MUCH', desc: 'Put THE KING down 10 times', stat: 'kings', goal: 10, xp: 80 },
  { id: 'clean', name: 'UNTOUCHABLE', desc: 'Clear a round (5+) without taking a hit', stat: 'cleanRounds', goal: 1, xp: 90 },
  { id: 'rich', name: 'HIGH ROLLER', desc: 'Hold 2,000 chips at once', stat: 'maxChips', kind: 'max', goal: 2000, xp: 70 },
  { id: 'doors', name: 'ALL ACCESS', desc: 'Open every door in one run', stat: 'doorsRun', kind: 'max', goal: 3, xp: 60 },
  { id: 'coop', name: 'TWO FOR ONE', desc: 'Play a co-op run', stat: 'coopRuns', goal: 1, xp: 50 },
  { id: 'revive', name: 'GOOD SAMARITAN', desc: 'Pick a teammate up 10 times', stat: 'revives', goal: 10, xp: 80 },
  { id: 'runs10', name: 'REGULAR', desc: 'Play 10 runs', stat: 'runs', goal: 10, xp: 60 },
];

/** the commemorative set — found as glinting discoveries on the floor and as rare drops */
export const CHIPS = [
  { id: 'acegraves', name: 'ACE OF GRAVES', color: '#e8e2d0' },
  { id: 'colddeck', name: 'THE COLD DECK', color: '#7ae8ff' },
  { id: 'snakeeyes', name: 'SNAKE EYES SALOON', color: '#5dff9a' },
  { id: 'marquee', name: 'THE MIDNIGHT MARQUEE', color: '#c27aff' },
  { id: 'buffet', name: 'THE BONEYARD BUFFET', color: '#ff9a4a' },
  { id: 'velvet', name: 'THE VELVET COFFIN', color: '#b3122e' },
  { id: 'lastcall', name: 'THE LAST CALL LOUNGE', color: '#ff7ad0' },
  { id: 'luckystiff', name: 'THE LUCKY STIFF', color: '#ffd24a' },
  { id: 'wake', name: 'THE WAKE & BREAKFAST', color: '#d8dde6' },
  { id: 'tombola', name: 'THE TOMBOLA TOMB', color: '#4aa8ff' },
  { id: 'crypt', name: 'CRAPS IN THE CRYPT', color: '#2dff7a' },
  { id: 'housechip', name: 'THE HOUSE CHIP', color: '#ff2d55' },
];

export class Progress {
  constructor(game) {
    this.game = game;
    this.data = this._load();
    this.beginRun();
  }

  _load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* fresh */ }
    return {
      xp: 0, stats: {}, markers: {}, collection: [], best: {},
      ...(d || {}),
    };
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* private mode */ } }

  // ------------------------------- loyalty -----------------------------------
  tierIndex(xp = this.data.xp) {
    let i = 0;
    while (i + 1 < LOYALTY.length && xp >= LOYALTY[i + 1].xp) i++;
    return i;
  }
  get tier() { return LOYALTY[this.tierIndex()]; }
  /** has the player reached tier i (by name index)? */
  has(i) { return this.tierIndex() >= i; }
  /** progress toward the next tier: { cur, next, into, need, frac } */
  toNext(xp = this.data.xp) {
    const i = this.tierIndex(xp);
    const cur = LOYALTY[i], next = LOYALTY[i + 1] || null;
    if (!next) return { cur, next: null, into: 0, need: 0, frac: 1, i };
    return { cur, next, into: xp - cur.xp, need: next.xp - cur.xp, frac: (xp - cur.xp) / (next.xp - cur.xp), i };
  }

  /** the loyalty perks that change numbers in a run */
  get fx() {
    return {
      compTime: this.has(2) ? 1.2 : 1,
      meterRate: this.has(4) ? 1.15 : 1,
      chipMult: this.has(6) ? 1.1 : 1,
      rareBoost: this.has(7) ? 1.25 : 1,
    };
  }

  /** start-of-run perks */
  applyRunPerks() {
    const g = this.game;
    if (this.has(1)) g.chips += 25;
    if (this.has(3)) g.player.grenades = Math.min(g.lethalMax() + 1, g.player.grenades + 1);
    if (this.has(5)) g.rewards.grant('hothand', { quiet: true });
    if (this.has(8)) g.rewards.grant('highroller', { quiet: true });
  }

  // --------------------------------- a run -----------------------------------
  beginRun() {
    this.run = { xp: 0, lines: {}, unlocked: [], found: [], tierFrom: this.tierIndex(), startXp: this.data.xp, records: [] };
  }

  /** XP earned in this run (banked into the card as it's earned) */
  gainXp(n, why) {
    if (!n) return;
    n = Math.round(n);
    const before = this.tierIndex();
    this.data.xp += n;
    this.run.xp += n;
    this.run.lines[why] = (this.run.lines[why] || 0) + n;
    const after = this.tierIndex();
    if (after > before) {
      const t = LOYALTY[after];
      this.game.rewards?.present({ rarity: 'legendary', icon: '🎟', title: `${t.name}`, sub: `LOYALTY UP — ${t.perk}`, sound: 'level_up', big: true });
      this.run.unlocked.push({ icon: '🎟', text: `${t.name} — ${t.perk}` });
    }
    this._dirty = true;
  }

  // -------------------------------- markers ----------------------------------
  stat(key) { return this.data.stats[key] || 0; }
  bump(key, n = 1) {
    this.data.stats[key] = (this.data.stats[key] || 0) + n;
    this._check(key);
  }
  max(key, v) {
    if (v > (this.data.stats[key] || 0)) { this.data.stats[key] = v; this._check(key); }
  }
  _check(key) {
    for (const m of MARKERS) {
      if (m.stat !== key || this.data.markers[m.id]) continue;
      if (this.stat(key) >= m.goal) {
        this.data.markers[m.id] = Date.now();
        this.run.unlocked.push({ icon: '🏆', text: `${m.name} — ${m.desc}` });
        this.game.rewards?.present({ rarity: 'epic', icon: '🏆', title: m.name, sub: `MARKER — ${m.desc}  (+${m.xp} XP)`, sound: 'achievement' });
        this.gainXp(m.xp, 'Markers');
      }
    }
    this._dirty = true;
  }
  /** the unfinished markers you're closest to */
  closest(n = 3) {
    return MARKERS.filter((m) => !this.data.markers[m.id])
      .map((m) => ({ m, have: Math.min(m.goal, this.stat(m.stat)), frac: Math.min(1, this.stat(m.stat) / m.goal) }))
      .sort((a, b) => b.frac - a.frac)
      .slice(0, n);
  }

  // ------------------------------ the chip set -------------------------------
  hasChip(id) { return this.data.collection.includes(id); }
  /** a chip you don't have yet (or null if the set is done) */
  missingChip() {
    const miss = CHIPS.filter((c) => !this.hasChip(c.id));
    return miss.length ? miss[Math.floor(Math.random() * miss.length)] : null;
  }
  collect(id) {
    const c = CHIPS.find((x) => x.id === id);
    if (!c) return;
    const g = this.game;
    if (this.hasChip(id)) {                             // a duplicate still pays
      g.addChips(60);
      g.rewards?.present({ rarity: 'uncommon', icon: '⛁', title: c.name, sub: 'A duplicate — the cashier pays 60 chips for it' });
      return;
    }
    this.data.collection.push(id);
    this.run.found.push(c.name);
    const n = this.data.collection.length;
    g.rewards?.present({ rarity: n === CHIPS.length ? 'legendary' : 'rare', icon: '⛁', title: c.name, sub: n === CHIPS.length ? 'THE SET IS COMPLETE!' : `COMMEMORATIVE CHIP ${n} / ${CHIPS.length}`, sound: 'discovery', big: n === CHIPS.length });
    this.gainXp(30, 'Discoveries');
    this.max('collection', n);
  }

  // -------------------------------- records ----------------------------------
  record(key, v, label) {
    const prev = this.data.best[key] || 0;
    if (v > prev) {
      this.data.best[key] = v;
      if (prev > 0) this.run.records.push(label);
    }
  }

  flush() { if (this._dirty) { this._dirty = false; this.save(); } }
}
