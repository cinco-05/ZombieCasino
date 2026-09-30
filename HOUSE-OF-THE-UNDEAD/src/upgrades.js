// upgrades.js — the attachment system. Six attachments, three tiers each,
// applied per-weapon, plus legendary specials (house guns, max HP, lethal
// capacity). Wagers are the only way to earn upgrades: offer(tier) deals 3
// cards (4 with the Regular's Card).
//
// Every card tells you exactly what it does to YOUR numbers: the gun it goes
// on, its tier, and each stat before → after, worked out from the weapon's
// live stats (other attachments, cocktails and ALL IN included).

import { CONFIG } from './config.js';
import { Audio } from './audio.js';
import { GUNS } from './catalog.js';
import { Seed } from './rng.js';

const $ = (id) => document.getElementById(id);

// attachment defs: key -> {name, stat, tiers:[t1,t2,t3], fmt}
const ATTACHMENTS = {
  mags:    { name: 'Extended Mags',  stat: 'mag',      tiers: [1.3, 1.6, 2.0],  glyph: '▮',
             fmt: (v) => `+${Math.round((v - 1) * 100)}% magazine size`, flavor: 'Longer mags, cut from a slot machine\'s coin chute.' },
  trigger: { name: 'Hair Trigger',   stat: 'fireRate', tiers: [1.12, 1.25, 1.4], glyph: '⚡',
             fmt: (v) => `+${Math.round((v - 1) * 100)}% fire rate`, flavor: 'Filed so fine it goes off if you think about it too hard.' },
  hollow:  { name: 'Hollow Points',  stat: 'damage',   tiers: [1.12, 1.25, 1.4], glyph: '✸',
             fmt: (v) => `+${Math.round((v - 1) * 100)}% damage`, flavor: 'Soft-nosed rounds. The dead don\'t walk these off.' },
  slide:   { name: 'Greased Slide',  stat: 'reload',   tiers: [0.85, 0.7, 0.55], glyph: '↻',
             fmt: (v) => `${Math.round((1 - v) * 100)}% faster reload`, flavor: 'A dab of bar grease and the action slicks right through.' },
  chamber: { name: 'Lucky Chamber',  stat: 'crit',     tiers: [0.05, 0.10, 0.18], glyph: '✤', add: true,
             fmt: (v) => `+${Math.round(v * 100)}% crit chance`, flavor: 'One chamber was kissed by a showgirl. Nobody knows which.' },
  blood:   { name: 'Blood Money',    stat: 'lifesteal', tiers: [0.01, 0.02, 0.04], glyph: '♥', add: true,
             fmt: (v) => `${(v * 100).toFixed(0)}% of the damage you deal heals you`, flavor: 'Every hit pays you back. The house calls it a rebate.' },
};
const TIER_NAMES = ['I', 'II', 'III'];

// number formats for the stat rows
const f0 = (v) => String(Math.round(v));
const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const f2 = (v) => v.toFixed(2);
const pct = (v) => `${Math.round(v * 100)}%`;
const secs = (v) => `${v.toFixed(2)}s`;

/** a stat row: label, before, after, format, and the value a full bar stands for */
const stat = (label, from, to, fmt = f0, max = null, opts = {}) => ({ label, from, to, fmt, max, ...opts });

export class Upgrades {
  constructor(game) {
    this.game = game;
    this.owned = {};        // `${weaponId}.${attKey}` -> tier index (0..2)
    this.resumeAfter = null;
  }

  reset() { this.owned = {}; }

  tierOf(weaponId, attKey) {
    return this.owned[`${weaponId}.${attKey}`] ?? -1;
  }

  // ------------------------------ live numbers -------------------------------
  /** what a gun's numbers are now (or with one mod swapped for a moment) */
  _gunNumbers(w, override = null) {
    const saved = override ? w.mods[override.stat] : null;
    if (override) w.mods[override.stat] = override.value;
    const def = w.def;
    const pellets = def.pellets || 1;
    const dmg = w.damage * (this.game.playerMods.dmgAllMult || 1);
    const rate = 1 / w.fireInterval;
    const out = {
      damage: dmg, pellets, rate, mag: w.magSize, reload: w.reloadTime,
      crit: w.critChance + (this.game.playerMods.critAdd || 0), lifesteal: w.mods.lifesteal,
      dps: dmg * pellets * rate * (def.fire === 'cork' ? 1.6 : 1),
    };
    if (override) w.mods[override.stat] = saved;
    return out;
  }

  /** the mod value a new tier gives, keeping every other multiplier riding on it */
  _modAfter(w, att, cur, next) {
    const now = w.mods[att.stat];
    if (att.add) return now - (cur >= 0 ? att.tiers[cur] : 0) + att.tiers[next];
    return now / (cur >= 0 ? att.tiers[cur] : 1) * att.tiers[next];
  }

  _attachmentStats(w, key, cur, next) {
    const att = ATTACHMENTS[key];
    const a = this._gunNumbers(w);
    const b = this._gunNumbers(w, { stat: att.stat, value: this._modAfter(w, att, cur, next) });
    const per = a.pellets > 1 ? ` ×${a.pellets}` : '';
    switch (att.stat) {
      case 'mag': return [stat('MAGAZINE', a.mag, b.mag, f0, 60, { unit: ' rds' })];
      case 'fireRate': return [stat('FIRE RATE', a.rate, b.rate, f2, 12.5, { unit: '/s' }), stat('DAMAGE / SEC', a.dps, b.dps, f0, 400)];
      case 'damage': return [stat('DAMAGE', a.damage, b.damage, f1, 240 / a.pellets, { unit: per }), stat('DAMAGE / SEC', a.dps, b.dps, f0, 400)];
      case 'reload': return [stat('RELOAD', a.reload, b.reload, secs, null, { lowGood: true })];
      case 'crit': return [stat('CRIT CHANCE', a.crit, b.crit, pct, 0.6)];
      default: return [stat('LIFESTEAL', a.lifesteal, b.lifesteal, pct, 0.05)];
    }
  }

  // ------------------------------ card pools ---------------------------------
  _attachmentCards(tier) {
    const g = this.game;
    const cards = [];
    const unlockedWeapons = g.weapons.owned().map((id) => g.weapons.arsenal[id]);
    // tier: common bumps 1 tier, rare can bump to tier 2, legendary to tier 3
    const maxTier = tier === 'legendary' ? 2 : tier === 'rare' ? 1 : 0;
    for (const w of unlockedWeapons) {
      for (const [key, att] of Object.entries(ATTACHMENTS)) {
        const cur = this.tierOf(w.id, key);
        const next = Math.min(cur + 1, maxTier);
        if (next <= cur || next > 2) continue;
        cards.push({
          kind: 'ATTACHMENT',
          title: `${att.name} ${TIER_NAMES[next]}`,
          sub: w.name,
          icon: GUNS[w.id]?.icon || '✦', glyph: att.glyph,
          pips: { have: cur + 1, get: next + 1 },
          desc: `${att.fmt(att.tiers[next])} on this gun${cur >= 0 ? ` (replaces tier ${TIER_NAMES[cur]})` : ''}.`,
          stats: () => this._attachmentStats(w, key, cur, next),
          flavor: att.flavor,
          apply: () => this._applyAttachment(w, key, next),
        });
      }
    }
    return cards;
  }

  _legendaryCards() {
    const g = this.game, p = g.player, m = g.playerMods;
    const cards = [];
    // a house special straight into your hands
    const specials = Object.keys(GUNS).filter((id) => GUNS[id].cat === 'special' && !g.weapons.owns(id));
    if (specials.length) {
      const id = Seed.pick('rewards', specials);
      const d = CONFIG.weapons[id];
      const w = g.weapons;
      const full = w.slots.slice(0, w.maxSlots).every(Boolean);
      cards.push({
        kind: 'HOUSE SPECIAL', title: GUNS[id].name, sub: 'A GUN FOR YOUR HANDS', icon: GUNS[id].icon,
        desc: `${GUNS[id].blurb} ${full ? `Swaps for the ${w.current.name} in your hands.` : 'Goes in your empty slot.'}`,
        stats: () => [
          stat('DAMAGE', 0, d.damage, f0, 240 / (d.pellets || 1), { unit: (d.pellets || 1) > 1 ? ` ×${d.pellets}` : '', only: true }),
          stat('FIRE RATE', 0, d.fireRate, f1, 12.5, { unit: '/s', only: true }),
          stat('MAGAZINE', 0, d.mag, f0, 60, { unit: ' rds', only: true }),
        ],
        flavor: 'Only the house deals these. Tonight it dealt one to you.',
        apply: () => g.weapons.give(id),
      });
    }
    cards.push({
      kind: 'PLAYER', title: 'HIGH ROLLER SUITE', sub: 'YOU', icon: '♛',
      desc: '+25 max health, and you heal to full right now.',
      stats: () => [stat('MAX HEALTH', p.maxHp, p.maxHp + 25, f0, 250), stat('HEALTH NOW', p.hp, p.maxHp + 25, f0, 250)],
      flavor: 'A night in the suite. You come back a new man.',
      apply: () => { p.maxHp += 25; p.hp = p.maxHp; },
    });
    cards.push({
      kind: 'PLAYER', title: 'DEMOLITION LICENSE', sub: 'YOUR LETHALS', icon: '●',
      desc: '+2 lethal capacity for the run, and +2 lethals right now.',
      stats: () => [stat('CARRY UP TO', g.lethalMax(), g.lethalMax() + 2, f0, 10), stat('IN YOUR POCKET', p.grenades, Math.min(g.lethalMax() + 2, p.grenades + 2), f0, 10)],
      flavor: 'Signed by the fire marshal. He\'s dead, but it still counts.',
      apply: () => {
        m.lethalBonus += 2;
        p.grenades = Math.min(g.lethalMax(), p.grenades + 2);
      },
    });
    cards.push({
      kind: 'ECONOMY', title: 'MARKED CARDS', sub: 'HEADSHOTS', icon: '◎',
      desc: 'Every headshot pays three times the chips, for the rest of the run.',
      stats: () => [stat('CHIPS / HEADSHOT', m.headshotBonus, m.headshotBonus * 3, f0, 30)],
      flavor: 'A dab of shine on the corners. Aim for the face cards.',
      apply: () => { m.headshotBonus *= 3; },
    });
    return cards;
  }

  // --------------------------- player-level cards ----------------------------
  _playerCards(tier) {
    const g = this.game, m = g.playerMods;
    const cards = [];
    if (tier === 'common' || tier === 'rare') {
      if (m.speed < 1.25) cards.push({
        kind: 'PLAYER', title: 'RUNNING SHOES', sub: 'YOUR LEGS', icon: '👞',
        desc: '+8% movement speed (stacks to +25%).',
        stats: () => [stat('MOVE SPEED', m.speed, Math.min(1.25, m.speed + 0.08), pct, 1.4)],
        flavor: 'Crepe soles. Quiet on the carpet, quick on the stairs.',
        apply: () => { m.speed = Math.min(1.25, m.speed + 0.08); },
      });
      if (m.magnet < 2.2) cards.push({
        kind: 'ECONOMY', title: 'CHIP MAGNET', sub: 'PICKUPS', icon: '🧲',
        desc: 'Chips fly to you from 40% further away (stacks).',
        stats: () => [stat('PULL RANGE', 5 * m.magnet, 5 * Math.min(2.2, m.magnet + 0.4), f1, 12, { unit: ' m' })],
        flavor: 'A horseshoe magnet, sewn into the lining.',
        apply: () => { m.magnet = Math.min(2.2, m.magnet + 0.4); },
      });
      if (m.meleeDmg < 2.5) cards.push({
        kind: 'PLAYER', title: 'STEEL TOE', sub: 'YOUR PISTOL-WHIP', icon: '✊',
        desc: '+50% melee damage (stacks).',
        stats: () => {
          const v = CONFIG.melee.damage * (g.vice === 'brawler' ? 2.5 : 1);
          return [stat('MELEE HIT', v * m.meleeDmg, v * (m.meleeDmg + 0.5), f0, 300)];
        },
        flavor: 'The pit boss\'s old boots. Still steel-capped.',
        apply: () => { m.meleeDmg += 0.5; },
      });
    }
    if (tier === 'rare' || tier === 'legendary') {
      if (m.dashCd > 0.55) cards.push({
        kind: 'PLAYER', title: 'QUICK HANDS', sub: 'YOUR DASH', icon: '»',
        desc: 'Dash comes back 20% sooner (stacks).',
        stats: () => {
          const perk = g.perkFx?.dashCd || 1;
          return [stat('DASH COOLDOWN', CONFIG.player.dashCooldown * m.dashCd * perk, CONFIG.player.dashCooldown * Math.max(0.55, m.dashCd * 0.8) * perk, secs, null, { lowGood: true })];
        },
        flavor: 'A card sharp\'s reflexes, bought off a card sharp.',
        apply: () => { m.dashCd = Math.max(0.55, m.dashCd * 0.8); },
      });
      if (m.roundArmor < 50) cards.push({
        kind: 'PLAYER', title: 'CASINO INSURANCE', sub: 'EVERY ROUND', icon: '◆',
        desc: '+25 armor at the start of every round (stacks), and +25 now.',
        stats: () => [stat('ARMOR / ROUND', m.roundArmor, m.roundArmor + 25, f0, 100, { plus: true })],
        flavor: 'The house pays out, in kevlar.',
        apply: () => { m.roundArmor += 25; g.player.addArmor(25); },
      });
      if (m.interest < 120) cards.push({
        kind: 'ECONOMY', title: 'CARD COUNTER', sub: 'EVERY INTERMISSION', icon: '✎',
        desc: '+40 chips at every intermission (stacks).',
        stats: () => [stat('CHIPS / VISIT', m.interest, m.interest + 40, f0, 160, { plus: true })],
        flavor: 'Keep a tally. The house hates it. Collect anyway.',
        apply: () => { m.interest += 40; },
      });
    }
    return cards;
  }

  // ------------------------ cursed cards (power at a price) ------------------
  _cursedCards(tier) {
    const g = this.game, m = g.playerMods, p = g.player;
    const cards = [];
    if (tier !== 'common') {
      if (m.dmgAllMult < 1.4) cards.push({
        cursed: true, kind: 'CURSED', title: 'BLOOD PACT', sub: 'EVERY GUN', icon: '🩸',
        desc: '+40% damage on every weapon... but -25 max health.',
        stats: () => [stat('ALL DAMAGE', m.dmgAllMult, 1.4, pct, 1.6), stat('MAX HEALTH', p.maxHp, Math.max(25, p.maxHp - 25), f0, 250, { bad: true })],
        flavor: 'Sign here. And here. And in red, here.',
        apply: () => {
          m.dmgAllMult = 1.4;
          p.maxHp = Math.max(25, p.maxHp - 25);
          p.hp = Math.min(p.hp, p.maxHp);
        },
      });
      if (m.chipPickupMult < 1.5) cards.push({
        cursed: true, kind: 'CURSED', title: 'LOADED DICE', sub: 'CHIPS', icon: '⚅',
        desc: '+50% chips from pickups... but every hit you take costs 5 chips.',
        stats: () => [stat('CHIP PICKUPS', m.chipPickupMult, 1.5, pct, 2), stat('COST PER HIT', m.hitChipLoss, 5, f0, 10, { bad: true, unit: ' chips' })],
        flavor: 'They always come up sevens. Somebody always notices.',
        apply: () => { m.chipPickupMult = 1.5; m.hitChipLoss = 5; },
      });
      if (m.reloadHpCost === 0) cards.push({
        cursed: true, kind: 'CURSED', title: "DEVIL'S RELOAD", sub: 'EVERY GUN', icon: '↺',
        desc: 'All reloads 40% faster... but each reload costs 3 health.',
        stats: () => {
          const w = g.weapons.current;
          return [stat('RELOAD', w.reloadTime, w.reloadTime * 0.6, secs, null, { lowGood: true }), stat('HEALTH / RELOAD', 0, 3, f0, 10, { bad: true })];
        },
        flavor: 'Faster than any living hand. That\'s the problem.',
        apply: () => {
          for (const w of Object.values(g.weapons.arsenal)) w.mods.reload *= 0.6;
          m.reloadHpCost = 3;
        },
      });
      cards.push({
        cursed: true, kind: 'CURSED', title: 'HOUSE MARKER', sub: 'A LOAN', icon: '✉',
        desc: '+300 chips right now... but your next wager loss is one penalty step nastier.',
        stats: () => [stat('CHIPS', g.chips, g.chips + 300, f0, null), stat('MARKERS OWED', m.markerDebt, m.markerDebt + 1, f0, 5, { bad: true })],
        flavor: 'Easy money. The house always collects.',
        apply: () => { g.addChips(300); m.markerDebt++; },
      });
    }
    if (tier === 'legendary' && m.critAdd < 0.25) {
      cards.push({
        cursed: true, kind: 'CURSED', title: 'GLASS CANNON', sub: 'EVERY GUN', icon: '◇',
        desc: '+25% crit chance on everything... but armor no longer protects you at all.',
        stats: () => [stat('BONUS CRIT', m.critAdd, 0.25, pct, 0.5), stat('ARMOR WORKS', 1, 0, (v) => (v ? 'YES' : 'NO'), null, { bad: true })],
        flavor: 'Hits like a freight train. Breaks like a champagne flute.',
        apply: () => { m.critAdd = 0.25; m.armorDisabled = true; },
      });
    }
    return cards;
  }

  // --------------------- synergy attachments (combo pieces) ------------------
  _synergyCards(tier) {
    const g = this.game, m = g.playerMods;
    const cards = [];
    if (tier !== 'common') {
      if (!m.dashDamage) cards.push({
        kind: 'SYNERGY', title: 'DASH & CASH', sub: 'DASH, THEN SHOOT', icon: '»',
        desc: 'For 1.5s after a dash, your shots deal +60% damage.',
        stats: () => [stat('DAMAGE AFTER A DASH', 0, 0.6, (v) => `+${Math.round(v * 100)}%`, 1)],
        flavor: 'In, out, and paid before they turn around.',
        apply: () => { m.dashDamage = true; },
      });
      if (!m.critGrenade) cards.push({
        kind: 'SYNERGY', title: 'CRIT COMPTROLLER', sub: 'CRITS → LETHALS', icon: '✤',
        desc: 'Critical hits refund a lethal (once every 2 seconds).',
        stats: () => [stat('YOUR CRIT CHANCE', 0, g.weapons.current.critChance + (m.critAdd || 0), pct, 0.6, { same: true })],
        flavor: 'Every lucky shot gets itemized. And reimbursed.',
        apply: () => { m.critGrenade = true; },
      });
      if (!m.chipHeal) cards.push({
        kind: 'SYNERGY', title: 'VAMPIRE CHIPS', sub: 'CHIPS → HEALTH', icon: '♥',
        desc: 'Collecting chips heals you: 1 HP for every 25 chips picked up.',
        stats: () => [stat('HP PER 100 CHIPS', 0, 4, f0, 10)],
        flavor: 'Money can\'t buy life. These chips can.',
        apply: () => { m.chipHeal = true; },
      });
      if (m.comboWindowAdd === 0) cards.push({
        kind: 'SYNERGY', title: 'COMBO INSURANCE', sub: 'YOUR STREAK', icon: '⧗',
        desc: 'Your kill streak waits 2 seconds longer before it breaks.',
        stats: () => [stat('STREAK WINDOW', CONFIG.chips.comboWindow, CONFIG.chips.comboWindow + 2, secs, 8)],
        flavor: 'A hot hand, on a slower clock.',
        apply: () => { m.comboWindowAdd = 2; },
      });
    }
    if (tier === 'legendary' && !m.lastBullet) {
      const w = g.weapons.current;
      cards.push({
        kind: 'SYNERGY', title: 'LAST CALL', sub: 'EVERY MAG', icon: '🥃',
        desc: 'The final bullet in every magazine deals TRIPLE damage.',
        stats: () => [stat('LAST ROUND', w.damage, w.damage * 3, f0, 240)],
        flavor: 'Last call, last round, last word.',
        apply: () => { m.lastBullet = true; },
      });
    }
    return cards;
  }

  // ------------------------------- offer flow --------------------------------
  /** show 3 cards for a tier; player picks one. Debug panel calls this too. */
  offer(tier) {
    const g = this.game;
    let pool = [...this._attachmentCards(tier), ...this._playerCards(tier),
      ...this._synergyCards(tier), ...this._cursedCards(tier)];
    if (tier === 'legendary') pool = [...this._legendaryCards(), ...pool];
    if (tier === 'rare') {
      pool.push({
        kind: 'ECONOMY', title: 'CHIP BONUS', sub: 'NO STRINGS', icon: '$',
        desc: '+150 chips, no strings attached.',
        stats: () => [stat('CHIPS', g.chips, g.chips + 150, f0, null)],
        flavor: 'An envelope with your name on it. Don\'t ask.',
        apply: () => g.addChips(150),
      });
    }
    // draw 3 distinct (4 with the REGULAR'S CARD vault perk)
    const want = 3 + (g.vault?.value('regular', 0) || 0);
    const cards = [];
    const bag = [...pool];
    while (cards.length < want && bag.length) {
      const i = Seed.int('rewards', bag.length);
      cards.push(bag.splice(i, 1)[0]);
    }
    if (!cards.length) {
      g.ui.banner('Everything is already maxed. Take 200 chips instead.', 'gold');
      g.addChips(200);
      return;
    }

    this.resumeAfter = g.state;
    g.setState('UPGRADE');
    $('upgrade-tier-label').textContent = `${tier.toUpperCase()} REWARD — CHOOSE ONE`;
    $('upgrade-tier-label').className = tier === 'legendary' ? 'gold' : tier === 'rare' ? 'cyan' : '';
    const wrap = $('upgrade-cards');
    wrap.innerHTML = '';
    for (const c of cards) {
      const el = document.createElement('button');
      el.className = `upgrade-card ${tier}${c.cursed ? ' cursed' : ''}`;
      el.innerHTML = this.cardHtml(c, tier);
      el.onclick = () => {
        c.apply();
        Audio.play('wager_win');
        g.ui.updateHUD();
        this._close();
      };
      wrap.appendChild(el);
    }
    $('upgrade-stats').textContent = this._statLine();
    g.ui.show('upgrade-panel');
  }

  /** the card itself: kind, art, name, tier pips, stat rows, the fine print */
  cardHtml(c, tier) {
    const rows = (c.stats ? c.stats() : []).map((s) => this._statRow(s)).join('');
    const pips = c.pips
      ? `<div class="uc-pips">${[0, 1, 2].map((i) => `<i class="${i < c.pips.have ? 'have' : i < c.pips.get ? 'get' : ''}"></i>`).join('')}<span>TIER ${TIER_NAMES[c.pips.get - 1]} OF III</span></div>`
      : '';
    return `<div class="uc-top"><span class="uc-kind">${c.kind || ''}</span><span class="uc-rarity">${tier.toUpperCase()}</span></div>
      <div class="uc-art"><span class="uc-icon">${c.icon || '✦'}</span>${c.glyph ? `<span class="uc-glyph">${c.glyph}</span>` : ''}</div>
      <div class="uc-title">${c.title}</div>
      <div class="uc-sub">${c.sub}</div>${pips}
      ${rows ? `<div class="uc-stats">${rows}</div>` : ''}
      <div class="uc-desc">${c.desc}</div>
      ${c.flavor ? `<div class="uc-flavor">“${c.flavor}”</div>` : ''}`;
  }

  _statRow(s) {
    const fill = (v) => (s.max ? Math.max(0, Math.min(1, v / s.max)) : null);
    const better = s.same ? false : s.lowGood ? s.to < s.from : s.to > s.from;
    const cls = s.bad ? 'bad' : better ? 'up' : '';
    const unit = s.unit ? `<small>${s.unit}</small>` : '';
    const plus = s.plus ? '+' : '';
    const val = s.only || s.same
      ? `<b class="to">${plus}${s.fmt(s.to)}${unit}</b>`
      : `<b>${plus}${s.fmt(s.from)}</b><i>→</i><b class="to">${plus}${s.fmt(s.to)}${unit}</b>`;
    let bar = '';
    const a = fill(s.only || s.same ? 0 : s.from), b = fill(s.to);
    if (a !== null && b !== null) {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      bar = `<div class="uc-bar"><i style="width:${(lo * 100).toFixed(1)}%"></i><em style="left:${(lo * 100).toFixed(1)}%;width:${((hi - lo) * 100).toFixed(1)}%"></em></div>`;
    }
    return `<div class="uc-stat ${cls}"><span>${s.label}</span><div class="uc-val">${val}</div>${bar}</div>`;
  }

  _applyAttachment(weapon, attKey, tierIdx) {
    const att = ATTACHMENTS[attKey];
    const cur = this.tierOf(weapon.id, attKey);
    // swap only this attachment's share of the stat, so whatever else rides on
    // it (Devil's Reload, say) survives the upgrade
    weapon.mods[att.stat] = this._modAfter(weapon, att, cur, tierIdx);
    this.owned[`${weapon.id}.${attKey}`] = tierIdx;
    // refill mag to new size on mag upgrades so it feels immediate
    if (att.stat === 'mag') weapon.mag = weapon.magSize;
    this.game.ui.banner(`${weapon.name}: ${att.name} ${TIER_NAMES[tierIdx]}`, 'gold');
  }

  _statLine() {
    const w = this.game.weapons.current;
    const n = this._gunNumbers(w);
    return `IN YOUR HANDS — ${w.name}: ${f1(n.damage)} dmg${n.pellets > 1 ? ` ×${n.pellets}` : ''} · ${f2(n.rate)} shots/s · `
      + `${n.mag} mag · ${secs(n.reload)} reload · ${pct(n.crit)} crit · ${f0(n.dps)} damage/sec`;
  }

  _close() {
    const g = this.game;
    g.ui.hide('upgrade-panel');
    let back = this.resumeAfter || 'INTERMISSION';
    this.resumeAfter = null;
    // never resume into a hidden casino sub-panel — land on intermission
    if (['UPGRADE', 'BLACKJACK', 'ROULETTE', 'POKER', 'SLOTS'].includes(back)) back = 'INTERMISSION';
    g.setState(back);
    if (back === 'INTERMISSION') {
      g.ui.show('intermission');
      g.casino.updateChipsUI();
      g.saveRun();
    }
  }
}
