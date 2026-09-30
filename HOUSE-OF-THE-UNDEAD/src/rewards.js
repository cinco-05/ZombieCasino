// rewards.js — the run's reward loop. Anticipation → action → reward → power:
//
//   COMPS            temporary power-ups the house "comps" its best players,
//                    dropped by the dead in five rarities (common → legendary).
//                    Drop odds and rarity climb with the round, your streak and
//                    the enemy (elites, specials, the Golden Gambler); a
//                    bad-luck guard makes sure a Rare+ always turns up.
//   STREAK TIERS     5 HOT STREAK ×1.5 · 10 ON FIRE ×2 · 20 UNSTOPPABLE ×2.5
//                    (+Rare comp) · 35 HOUSE ON FIRE ×3 (+Epic) · 50 LEGEND
//                    OF THE STRIP ×3.5 (+Legendary). The window is on screen;
//                    a streak that ends still banks a little.
//   THE PROGRESSIVE  a jackpot meter that fills with every kill (headshots,
//                    elites and a hot streak fill it faster) and pays a big
//                    comp + chips when it hits 100%.
//   SURPRISES        a few times a night: HAPPY HOUR, a GOLDEN GAMBLER, a
//                    ghost's WINDFALL at the slots, a commemorative chip
//                    glinting somewhere on the floor.
//   PRESENTATION     a hierarchy so big moments stay big: float text → toast
//                    → card → card + slow motion + fanfare.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Audio } from './audio.js';
import { CHIPS } from './progress.js';
import { Seed } from './rng.js';

export const RARITY = {
  common:    { name: 'COMMON',    color: '#e8e2d0', hex: 0xe8e2d0, tier: 0 },
  uncommon:  { name: 'UNCOMMON',  color: '#5dff9a', hex: 0x5dff9a, tier: 1 },
  rare:      { name: 'RARE',      color: '#4aa8ff', hex: 0x4aa8ff, tier: 2 },
  epic:      { name: 'EPIC',      color: '#c27aff', hex: 0xc27aff, tier: 3 },
  legendary: { name: 'LEGENDARY', color: '#ffd24a', hex: 0xffd24a, tier: 4 },
};
const ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

/** the comps. t = seconds (timed), or instant */
export const COMPS = {
  refill:      { name: 'FREE REFILL', rarity: 'common', icon: '🥤', desc: 'The gun in your hands, topped right up' },
  drink:       { name: "COMP'D COCKTAIL", rarity: 'common', icon: '🍸', desc: '+25 health, on the house' },
  hothand:     { name: 'HOT HAND', rarity: 'uncommon', icon: '🔥', t: 15, desc: 'Fire 40% faster' },
  loose:       { name: 'LOOSE SLOTS', rarity: 'uncommon', icon: '🎰', t: 20, desc: 'Double chips from every kill' },
  highroller:  { name: 'HIGH ROLLER', rarity: 'rare', icon: '💰', t: 12, desc: 'Double damage' },
  freespins:   { name: 'FREE SPINS', rarity: 'rare', icon: '🌀', t: 10, desc: 'Bottomless magazine — no reloading' },
  whale:       { name: "THE WHALE'S BLESSING", rarity: 'epic', icon: '🐋', t: 12, desc: 'Double damage, faster fire, every kill spits chips' },
  luckystreak: { name: 'LUCKY STREAK', rarity: 'epic', icon: '🍀', t: 8, desc: 'Nothing can touch you' },
  jackpot:     { name: 'THE BIG JACKPOT', rarity: 'legendary', icon: '👑', desc: 'A pile of chips, every gun full, full health — and 10s of HIGH ROLLER + FREE SPINS' },
};
const BY_RARITY = {};
for (const [k, c] of Object.entries(COMPS)) (BY_RARITY[c.rarity] ||= []).push(k);

export const STREAKS = [
  { at: 5, name: 'HOT STREAK', mult: 1.5, rarity: 'uncommon' },
  { at: 10, name: 'ON FIRE', mult: 2, rarity: 'uncommon' },
  { at: 20, name: 'UNSTOPPABLE', mult: 2.5, rarity: 'rare', bonus: 'rare' },
  { at: 35, name: 'HOUSE ON FIRE', mult: 3, rarity: 'epic', bonus: 'epic' },
  { at: 50, name: 'LEGEND OF THE STRIP', mult: 3.5, rarity: 'legendary', bonus: 'legendary' },
];
const SPECIALS = new Set(['brute', 'pitguard', 'gasbag', 'croupier', 'magician', 'king', 'collector', 'spitter']);
const $ = (id) => document.getElementById(id);

// ------------------------------ the comp token -------------------------------
const _faceTex = {};
function faceTexture(key) {
  if (_faceTex[key]) return _faceTex[key];
  const c = COMPS[key], R = RARITY[c.rarity];
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const x = cv.getContext('2d');
  x.fillStyle = R.color; x.beginPath(); x.arc(64, 64, 62, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#1a1210'; x.beginPath(); x.arc(64, 64, 50, 0, Math.PI * 2); x.fill();
  for (let i = 0; i < 8; i++) {                         // the edge inlays of a real casino chip
    x.save(); x.translate(64, 64); x.rotate(i * Math.PI / 4);
    x.fillStyle = '#f4efe4'; x.fillRect(-6, -62, 12, 12); x.restore();
  }
  x.font = '52px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(c.icon, 64, 68);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return (_faceTex[key] = t);
}
/** a big spinning casino chip in its rarity colour (+ a light beam for Rare and up) */
export function compMesh(key) {
  const c = COMPS[key], R = RARITY[c.rarity];
  const g = new THREE.Group();
  const face = new THREE.MeshStandardMaterial({ map: faceTexture(key), emissive: 0xffffff, emissiveMap: faceTexture(key), emissiveIntensity: 0.95, roughness: 0.4 });
  const edge = new THREE.MeshStandardMaterial({ color: R.hex, emissive: R.hex, emissiveIntensity: 1.1, roughness: 0.4 });
  const chip = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 32), [edge, face, face]);
  chip.rotation.x = Math.PI / 2;
  g.add(chip);
  if (R.tier >= 2) {
    // a beam of light over it — you can see something good from across the floor
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.34, 6, 14, 1, true), new THREE.MeshBasicMaterial({
      color: R.hex, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 2.9;
    beam.userData.base = 0.3 + R.tier * 0.04;
    g.add(beam);
    g.userData.beam = beam;
  }
  g.userData.glowColor = R.hex;
  return g;
}
/** a commemorative chip for the set: gold rim, glinting */
export function collectibleMesh(id) {
  const c = CHIPS.find((x) => x.id === id) || CHIPS[0];
  const g = new THREE.Group();
  const col = new THREE.Color(c.color).getHex();
  const chip = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.05, 32), [
    new THREE.MeshStandardMaterial({ color: 0xffd24a, metalness: 1, roughness: 0.2, emissive: 0x6a4a10, emissiveIntensity: 0.6 }),
    new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.5 }),
    new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.5 }),
  ]);
  chip.rotation.x = Math.PI / 2;
  g.add(chip);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.32, 9, 12, 1, true), new THREE.MeshBasicMaterial({
    color: 0xfff0c0, transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 4.4;
  beam.userData.base = 0.36;
  g.add(beam);
  g.userData = { beam, glowColor: 0xffe8a0 };
  return g;
}

// ================================= Rewards ==================================
export class Rewards {
  constructor(game) {
    this.game = game;
    this.reset();
    this._cards = [];
    this._cardT = 0;
    this._hudT = 0;
  }

  reset() {
    this.active = {};              // comp key -> seconds left
    this.meter = 0;                // progressive jackpot, 0..100
    this.payouts = 0;
    this.streakTier = -1;          // index into STREAKS
    this.bestTierThisRun = -1;
    this.dryKills = 0;             // kills since the last Rare+ drop (bad-luck guard)
    this.lastDropAt = 0;
    this.firstBlood = false;
    this.happyT = 0;
    this.eventT = -1;              // countdown to this round's surprise
    this.hitThisRound = false;
    this.legendStreakPaid = false;
    this._cards = [];
    this._hideCard();
  }

  // ------------------------------ comps (power-ups) ---------------------------
  has(key) { return (this.active[key] || 0) > 0; }
  /** multiplier the rest of the game reads: 'damage' | 'fireRate' | 'chips' */
  mult(what) {
    let m = 1;
    if (what === 'damage') { if (this.has('highroller')) m *= 2; if (this.has('whale')) m *= 2; }
    if (what === 'fireRate') { if (this.has('hothand')) m *= 1.4; if (this.has('whale')) m *= 1.3; }
    if (what === 'chips') {
      if (this.has('loose')) m *= 2;
      if (this.happyT > 0) m *= 1.5;
      m *= this.game.progress?.fx.chipMult || 1;
    }
    return m;
  }
  get bottomless() { return this.has('freespins'); }
  get untouchable() { return this.has('luckystreak'); }

  grant(key, { quiet = false } = {}) {
    const g = this.game, c = COMPS[key];
    if (!c) return;
    const R = RARITY[c.rarity];
    const time = (c.t || 0) * (g.progress?.fx.compTime || 1);
    if (key === 'refill') {
      const w = g.weapons.current;
      w.mag = w.magSize; w.reserve = w.maxReserve;
    } else if (key === 'drink') g.player.heal(25);
    else if (key === 'jackpot') {
      const pile = 300 + 40 * g.round;
      g.addChips(pile);
      g.weapons.refillAll();
      g.player.heal(999);
      g.player.addArmor(50);
      this.active.highroller = Math.max(this.active.highroller || 0, 10);
      this.active.freespins = Math.max(this.active.freespins || 0, 10);
      g.ui.floatText(g.player.pos.clone().add(g.player.forwardFlat().multiplyScalar(2)), `+${pile}`, 'chips');
    }
    if (c.t) this.active[key] = Math.max(this.active[key] || 0, time);
    if (R.tier >= 3) g.progress?.bump(R.tier === 4 ? 'legendaries' : 'epics');
    g.ui.updateHUD();
    if (!quiet) this.present({ rarity: c.rarity, icon: c.icon, title: c.name, sub: c.t ? `${c.desc} — ${Math.round(time)}s` : c.desc });
    else this.toast({ rarity: c.rarity, icon: c.icon, title: c.name, sub: 'Loyalty perk: on the house' });
  }

  // ----------------------------------- kills ----------------------------------
  /** every kill (host, solo, and the guest's credited kills) */
  onKill(z, isHead = false) {
    const g = this.game;
    // the streak: tier up?
    const tier = this.tierFor(g.combo);
    if (tier > this.streakTier) {
      this.streakTier = tier;
      const S = STREAKS[tier];
      if (tier > this.bestTierThisRun) {
        this.bestTierThisRun = tier;
        // a new tier this run: a proper moment (and the big ones pay)
        this.present({ rarity: S.rarity, icon: '🔥', title: S.name, sub: `×${S.mult} chips on every kill${S.bonus ? ' — and a comp on the house' : ''}`, sound: 'streak_tier', small: !S.bonus });
        if (S.bonus && !(S.bonus === 'legendary' && this.legendStreakPaid)) {
          if (S.bonus === 'legendary') this.legendStreakPaid = true;
          setTimeout(() => this.grant(this._pick(S.bonus)), 900);
        }
      } else {
        g.ui.banner(`${S.name} ×${S.mult}`, 'cyan', 1100);
        Audio.play('streak_tier');
      }
    }
    Audio.comboTick?.(g.combo);
    if (this.has('whale') && z.mesh) g.awardChips(15, z.mesh.position);
    g.progress?.max('bestCombo', g.combo);

    // first blood: an easy early win
    if (!this.firstBlood) {
      this.firstBlood = true;
      g.addChips(25);
      this.toast({ rarity: 'uncommon', icon: '🩸', title: 'FIRST BLOOD', sub: '+25 chips — the night is young' });
    }

    // the progressive jackpot fills
    const special = SPECIALS.has(z.kind);
    const gain = (2.2 + (isHead ? 1.5 : 0) + (z.elite ? 4 : 0) + (special ? 2 : 0) + (z.golden ? 25 : 0) + Math.max(0, tier) * 0.6)
      * (g.progress?.fx.meterRate || 1) * Math.pow(0.88, this.payouts);
    const before = this.meter;
    this.meter = Math.min(100, this.meter + gain);
    if (before < 85 && this.meter >= 85 && this.meter < 100) Audio.play('glint');
    if (this.meter >= 100) this._payJackpot();

    // XP for the card
    g.progress?.gainXp(1 + (isHead ? 1 : 0) + (z.elite ? 2 : 0) + (special ? 1 : 0) + (z.golden ? 10 : 0), 'Kills');
    g.progress?.bump('kills');
    if (z.kind === 'king') g.progress?.bump('kings');
    if (z.golden) g.progress?.bump('golden');
  }

  tierFor(combo) {
    let t = -1;
    STREAKS.forEach((s, i) => { if (combo >= s.at) t = i; });
    return t;
  }
  /** the chip multiplier your streak gives */
  streakMult(combo) {
    const t = this.tierFor(combo);
    return t < 0 ? 1 : STREAKS[t].mult;
  }

  /** the window ran out (or the round ended): the streak banks a little */
  streakOver(combo, roundEnd = false) {
    const g = this.game;
    this.streakTier = -1;
    if (combo < 5) return;
    const bank = combo * 3;
    g.addChips(bank);
    if (roundEnd) this.toast({ rarity: 'common', icon: '🔥', title: `STREAK OF ${combo} BANKED`, sub: `+${bank} chips` });
    else {
      g.ui.prompt(`Streak over at ×${combo} — banked +${bank} chips`, 2200);
      Audio.play('streak_end');
    }
  }

  _payJackpot() {
    const g = this.game;
    this.meter = 0;
    this.payouts++;
    g.progress?.max('jackpotsRun', this.payouts);
    const pile = 80 + 30 * g.round;
    g.addChips(pile);
    const key = this._pick(this._rollRarity(2, 4 + this.payouts * 3));
    g.slowmo(0.45);
    this.present({ rarity: 'legendary', icon: '🎰', title: 'PROGRESSIVE JACKPOT!', sub: `+${pile} chips and ${COMPS[key].name}`, sound: 'jackpot', big: true });
    setTimeout(() => this.grant(key), 1200);
    g.progress?.gainXp(25, 'Jackpots');
  }

  // ------------------------------------ drops ----------------------------------
  /** host / solo: does this kill drop a comp? */
  rollDrop(z) {
    const g = this.game;
    const R = g.round;
    let chance = 0.035 + 0.01 * Math.min(R, 15);
    if (z.elite) chance += 0.2;
    if (SPECIALS.has(z.kind)) chance += 0.05;
    if (this.happyT > 0) chance *= 2.5;
    const sure = z.kind === 'jackpot' || z.golden;
    this.dryKills++;
    const pity = this.dryKills >= 45;
    const now = performance.now();
    if (!sure && !pity) {
      if (Seed.random('drops') > chance) return;
      if (now - this.lastDropAt < 4000) return;         // no spam: a drop has to feel like one
    }
    this.lastDropAt = now;
    const min = z.golden ? 3 : pity ? 2 : z.kind === 'jackpot' ? 1 : 0;
    const rarity = this._rollRarity(min, z.elite ? 6 : 0);
    if (RARITY[rarity].tier >= 2) this.dryKills = 0;
    g.pickups.spawnComp(z.mesh.position.clone(), this._pick(rarity));
    // and now and then, a commemorative chip
    const chipOdds = z.golden ? 0.3 : z.elite ? 0.03 : 0;
    const miss = g.progress?.missingChip();
    if (miss && Seed.random('drops') < chipOdds) g.pickups.spawnCollectible(z.mesh.position.clone().add(new THREE.Vector3(0.8, 0, 0.4)), miss.id);
  }

  _rollRarity(minTier = 0, bonus = 0) {
    const g = this.game;
    const luck = g.round * 0.6 + Math.max(0, this.streakTier) * 2.5 + bonus;
    const rb = g.progress?.fx.rareBoost || 1;
    const w = {
      common: Math.max(18, 58 - luck * 1.6), uncommon: 26,
      rare: (9 + luck * 0.45) * rb, epic: (2.6 + luck * 0.2) * rb, legendary: (0.5 + luck * 0.05) * rb,
    };
    ORDER.forEach((r, i) => { if (i < minTier) w[r] = 0; });
    let sum = 0;
    for (const r of ORDER) sum += w[r];
    let x = Seed.random('drops') * sum;
    for (const r of ORDER) { x -= w[r]; if (x <= 0) return r; }
    return 'legendary';
  }
  _pick(rarity) {
    const list = BY_RARITY[rarity];
    return Seed.pick('drops', list);
  }

  // --------------------------------- surprises ---------------------------------
  /** host / solo: maybe schedule a surprise into this round */
  planRound(round, bossRound) {
    this.hitThisRound = false;
    this.eventT = (!bossRound && round >= 2 && Seed.random('rounds') < 0.35) ? 12 + Seed.random('rounds') * 23 : -1;
  }

  _surprise() {
    const g = this.game;
    const choices = [['happyhour', 3], ['golden', 3], ['windfall', 2]];
    if (g.progress?.missingChip()) choices.push(['glint', 2.5]);
    let sum = 0;
    for (const [, w] of choices) sum += w;
    let x = Seed.random('rounds') * sum, pick = choices[0][0];
    for (const [k, w] of choices) { x -= w; if (x <= 0) { pick = k; break; } }
    const say = (text, color = 'gold', ms = 3200) => { g.ui.banner(text, color, ms); g.net?.send({ t: 'banner', text, color, ms }); };
    if (pick === 'happyhour') {
      this.happyT = 20;
      say('🍸 HAPPY HOUR — COMPS DROP 2.5× AND CHIPS PAY 1.5× FOR 20 SECONDS 🍸', 'cyan');
      Audio.play('happy_hour');
    } else if (pick === 'golden') {
      g.enemies.spawnQueue.unshift({ kind: 'walker', elite: true, golden: true });
      say('★ A GOLDEN GAMBLER IS ON THE FLOOR — TAKE HIM DOWN FOR AN EPIC COMP ★');
      Audio.play('jackpot');
    } else if (pick === 'windfall') {
      // a ghost hits big on a slot bank: chips spill out of it
      const banks = g.arena.bankPositions || [];
      const [bx, bz] = banks[Math.floor(Math.random() * banks.length)] || [0, 0];
      for (let i = 0; i < 6; i++) g.pickups.spawnChips(new THREE.Vector3(bx * 0.86 + (Math.random() - 0.5) * 3, 0, bz * 0.86 + (Math.random() - 0.5) * 3), 20 + g.round * 4);
      say('💰 A GHOST JUST HIT THE JACKPOT — THE SLOTS ARE SPILLING CHIPS 💰');
      g.audioAt('jackpot', { x: bx, y: 1.5, z: bz });
    } else if (pick === 'glint') {
      const c = g.progress.missingChip();
      const p = g.player.pos;
      const spots = g.arena.spawnPoints.filter((s) => g.arena.isZoneOpen(s.zone) && Math.hypot(s.x - p.x, s.z - p.z) > 14);
      const s = spots[Math.floor(Math.random() * spots.length)];
      if (s) {
        g.pickups.spawnCollectible(new THREE.Vector3(s.x, 0, s.z), c.id);
        say('✦ Something is glinting on the floor somewhere… follow the light ✦', 'gold', 3600);
        Audio.play('glint');
      }
    }
  }

  // ------------------------------------ tick -----------------------------------
  update(dt, live = true) {
    const g = this.game;
    if (live) for (const k of Object.keys(this.active)) {
      this.active[k] -= dt;
      if (this.active[k] <= 0) { delete this.active[k]; g.ui.prompt(`${COMPS[k].name} wore off`, 1400); }
    }
    if (this.happyT > 0 && live) this.happyT -= dt;
    if (this.eventT > 0 && g.state === 'COMBAT' && !g.net?.isGuest) {
      this.eventT -= dt;
      if (this.eventT <= 0) this._surprise();
    }
    // queued cards play one after another
    if (this._cardT > 0) {
      this._cardT -= dt;
      if (this._cardT <= 0) { this._hideCard(); this._nextCard(); }
    }
    this._hudT -= dt;
    if (this._hudT <= 0) { this._hudT = 0.1; this.hud(); }
    // bank XP and marker progress every few seconds — quitting mid-run loses nothing
    this._saveT = (this._saveT ?? 5) - dt;
    if (this._saveT <= 0) { this._saveT = 5; g.progress?.flush(); }
  }

  // -------------------------------- presentation --------------------------------
  /**
   * the reward hierarchy: common/uncommon (or small) -> a toast at the side;
   * rare -> a card; epic/legendary (or big) -> a card, slow motion, fanfare.
   */
  present({ rarity = 'common', icon = '★', title, sub = '', sound = null, big = false, small = false }) {
    const R = RARITY[rarity];
    if (small || (R.tier <= 1 && !big)) { this.toast({ rarity, icon, title, sub, sound }); return; }
    this._cards.push({ rarity, icon, title, sub, sound, big: big || R.tier >= 3 });
    if (this._cardT <= 0) this._nextCard();
  }

  toast({ rarity = 'common', icon = '★', title, sub = '', sound = null }) {
    const R = RARITY[rarity];
    const box = $('reward-toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = `rt rt-${rarity}`;
    el.style.setProperty('--c', R.color);
    el.innerHTML = `<span class="rt-icon">${icon}</span><span class="rt-text"><b>${title}</b><em>${sub}</em></span>`;
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3100);
    Audio.play(sound || `comp_${rarity}`);
  }

  _nextCard() {
    const c = this._cards.shift();
    if (!c) return;
    const g = this.game, R = RARITY[c.rarity];
    const el = $('reward-card');
    el.className = `rc-${c.rarity}`;
    el.style.setProperty('--c', R.color);
    $('rc-rarity').textContent = R.name;
    $('rc-icon').textContent = c.icon;
    $('rc-title').textContent = c.title;
    $('rc-sub').textContent = c.sub;
    void el.offsetWidth;                 // restart the animation
    el.classList.add('show');
    this._cardT = c.big ? 2.4 : 1.8;
    if (this._cards.length >= 2) this._cardT *= 0.6;        // a pile-up plays quicker, so nothing waits too long
    Audio.play(c.sound || `comp_${c.rarity}`);
    if (c.big) {
      g.slowmo(0.35);
      const at = g.player.pos.clone().add(g.player.forwardFlat().multiplyScalar(2.5)).setY(1.4);
      g.effects.spawnBurst?.(at, R.hex, 26, 7);
      g.effects.spawnBurst?.(at, 0xffffff, 10, 5);
      if (!g.settings.reducedFlash) g.ui.whiteout?.(0.18);
    }
  }
  _hideCard() { $('reward-card')?.classList.remove('show'); }

  /** the run's over (summary, menu): nothing left hanging over the screen */
  clearPresentation() {
    this._cards = [];
    this._cardT = 0;
    this._hideCard();
    const box = $('reward-toasts');
    if (box) box.innerHTML = '';
  }

  // ------------------------------------ HUD ------------------------------------
  hud() {
    const g = this.game;
    const inPlay = g.state === 'COMBAT' || g.state === 'COUNTDOWN' || g.state === 'PAUSED';
    // the progressive jackpot
    const jm = $('jackpot-meter');
    if (jm) {
      jm.classList.toggle('hidden', !inPlay || g.round < 1);
      const pct = Math.floor(this.meter);
      $('jm-fill').style.width = `${this.meter}%`;
      const close = pct >= 85;
      jm.classList.toggle('close', close);
      const txt = close ? `ALMOST THERE — ${pct}%` : `${pct}%`;
      if ($('jm-pct').textContent !== txt) $('jm-pct').textContent = txt;
    }
    // active comps with their clocks
    const ch = $('comps-hud');
    if (ch) {
      const items = Object.entries(this.active).map(([k, t]) => {
        const c = COMPS[k];
        return `<span class="comp" style="--c:${RARITY[c.rarity].color}">${c.icon}<b>${c.name}</b><i>${Math.ceil(t)}s</i></span>`;
      });
      if (this.happyT > 0) items.push(`<span class="comp" style="--c:#7ae8ff">🍸<b>HAPPY HOUR</b><i>${Math.ceil(this.happyT)}s</i></span>`);
      const html = inPlay ? items.join('') : '';
      if (html !== this._compHtml) { ch.innerHTML = html; this._compHtml = html; }
    }
    // the streak: tier, multiplier, the window draining, what's next
    const cb = $('combo-hud');
    if (cb) {
      if (g.combo >= 2 && inPlay) {
        cb.style.display = '';
        const t = this.tierFor(g.combo), S = STREAKS[t];
        const next = STREAKS[t + 1];
        const win = (g.comboT || 0) / (CONFIG.chips.comboWindow + (g.playerMods.comboWindowAdd || 0));
        const html = `<div class="cb-top"><b>×${g.combo}</b> <span>${S ? `${S.name} · ${S.mult}× chips` : 'STREAK'}</span></div>`
          + `<div class="cb-bar"><i style="width:${Math.max(0, Math.min(1, win)) * 100}%"></i></div>`
          + (next ? `<div class="cb-next">${next.at - g.combo} more → ${next.name}${next.bonus ? ' + a comp' : ''}</div>` : '<div class="cb-next">THE STRIP KNOWS YOUR NAME</div>');
        if (html !== this._cbHtml) { cb.innerHTML = html; this._cbHtml = html; }
        cb.dataset.tier = String(t);
      } else if (cb.style.display !== 'none') { cb.style.display = 'none'; this._cbHtml = ''; }
    }
    // three goals: now, this run, the long game
    const gh = $('goals-hud');
    if (gh) {
      if (!inPlay || g.round < 1) { if (gh.innerHTML) { gh.innerHTML = ''; this._gHtml = ''; } }
      else {
        const lines = [];
        if (g.objective && !g.objective.failed) lines.push(['◎', g.objective.def.label(g.objective)]);
        else if (this.meter >= 60) lines.push(['🎰', `Progressive jackpot at ${Math.floor(this.meter)}%`]);
        else {
          const nt = STREAKS[this.tierFor(g.combo) + 1];
          if (nt) lines.push(['🔥', `Streak ×${nt.at} → ${nt.name}`]);
        }
        const boss = g.isBossRound(g.round + 1) && g.round < 10 ? ` — then ${g.round + 1 === 5 ? 'THE PIT BOSS' : g.round + 1 === 10 ? 'THE HOUSE DEALER' : 'a boss'}` : '';
        lines.push(['▸', g.round <= 10 ? `Survive round ${g.round} of 10${boss}` : `Endless round ${g.round}`]);
        const P = g.progress;
        if (P) {
          const n = P.toNext();
          if (n.next) lines.push(['🎟', `${n.next.name} in ${n.need - n.into} XP`]);
          else {
            const c = P.closest(1)[0];
            if (c) lines.push(['🏆', `${c.m.name} ${c.have}/${c.m.goal}`]);
          }
        }
        const html = lines.map(([i, t]) => `<div><span>${i}</span>${t}</div>`).join('');
        if (html !== this._gHtml) { gh.innerHTML = html; this._gHtml = html; }
      }
    }
  }
}
