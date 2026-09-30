// rng.js — every run is dealt from a seed. The same seed and the same choices
// give the same run: the same shelves in the shop, the same cards off the
// shoe, the same spins, specials, hordes and prizes. Each system draws from
// its own named stream, so playing one table never shifts another table's
// luck, and cosmetic randomness (sparks, dust, voices) never touches any of it.
//
// Streams in use: 'rounds' (objectives, specials, surprises), 'horde' (who
// walks in), 'drops', 'shop', 'rewards' (upgrade offers), 'house' (mystery
// cards, penalties), 'blackjack', 'roulette', 'poker', 'slots', 'floor' (the
// Big Six, the house wheel, craps).

const SEED_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no I/L/O/0/1 to misread

/** FNV-1a: a string to a 32-bit seed */
export function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** mulberry32 with its state out in the open, so a run can be saved mid-deal */
class Stream {
  constructor(state) { this.s = state >>> 0; }
  next() {
    let t = (this.s = (this.s + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

/** what a typed seed turns into: capitals, digits and dashes, 20 at most */
export function normalizeSeed(text) {
  return String(text ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 20);
}

/** a fresh seed to share: XXXX-XXXX */
export function randomSeed() {
  let s = '';
  for (let i = 0; i < 8; i++) s += SEED_CHARS[Math.floor(Math.random() * SEED_CHARS.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export const Seed = {
  text: '',
  custom: false,          // typed in by the player (restarts keep it)
  salt: '',               // co-op: each seat's own slice of the seed ('' alone)
  _streams: new Map(),

  /** start a run on this seed (blank = a fresh random one); returns the seed.
      salt: co-op seats pass their own, so everyone's shop and cards differ
      but the seed still replays the same table */
  begin(text = '', salt = '') {
    const typed = normalizeSeed(text);
    this.custom = !!typed;
    this.text = typed || randomSeed();
    this.salt = salt;
    this._streams = new Map();
    return this.text;
  },

  stream(name) {
    let s = this._streams.get(name);
    if (!s) { s = new Stream(hashStr(`${this.text}/${this.salt}${name}`)); this._streams.set(name, s); }
    return s;
  },

  /** a Math.random-shaped function drawing from one stream */
  rng(name) { const s = this.stream(name); return () => s.next(); },
  random(name) { return this.stream(name).next(); },
  int(name, n) { return Math.floor(this.stream(name).next() * n); },
  pick(name, list) { return list[Math.floor(this.stream(name).next() * list.length)]; },

  save() {
    const s = {};
    for (const [k, v] of this._streams) s[k] = v.s;
    return { text: this.text, custom: this.custom, salt: this.salt, s };
  },
  restore(d) {
    if (!d || !d.text) { this.begin(); return; }
    this.text = d.text;
    this.custom = !!d.custom;
    this.salt = d.salt || '';
    this._streams = new Map(Object.entries(d.s || {}).map(([k, v]) => [k, new Stream(v)]));
  },
};
