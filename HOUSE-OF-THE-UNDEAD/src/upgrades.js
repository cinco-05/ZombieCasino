// upgrades.js — the attachment system. Six attachments, three tiers each,
// applied per-weapon, plus legendary specials (rifle unlock, max HP, grenade
// pouch). Wagers are the only way to earn upgrades: offer(tier) shows 3 cards.

import { CONFIG, pick } from './config.js';
import { Audio } from './audio.js';
import { GUNS } from './catalog.js';

const $ = (id) => document.getElementById(id);

// attachment defs: key -> {name, stat, tiers:[t1,t2,t3], fmt}
const ATTACHMENTS = {
  mags:    { name: 'Extended Mags',  stat: 'mag',      tiers: [1.3, 1.6, 2.0],  fmt: (v) => `${Math.round((v - 1) * 100)}% magazine size` },
  trigger: { name: 'Hair Trigger',   stat: 'fireRate', tiers: [1.12, 1.25, 1.4], fmt: (v) => `${Math.round((v - 1) * 100)}% fire rate` },
  hollow:  { name: 'Hollow Points',  stat: 'damage',   tiers: [1.12, 1.25, 1.4], fmt: (v) => `${Math.round((v - 1) * 100)}% damage` },
  slide:   { name: 'Greased Slide',  stat: 'reload',   tiers: [0.85, 0.7, 0.55], fmt: (v) => `${Math.round((1 - v) * 100)}% faster reload` },
  chamber: { name: 'Lucky Chamber',  stat: 'crit',     tiers: [0.05, 0.10, 0.18], fmt: (v) => `+${Math.round(v * 100)}% crit chance`, add: true },
  blood:   { name: 'Blood Money',    stat: 'lifesteal', tiers: [0.01, 0.02, 0.04], fmt: (v) => `${(v * 100).toFixed(0)}% lifesteal`, add: true },
};
const TIER_NAMES = ['I', 'II', 'III'];

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
          title: `${att.name} ${TIER_NAMES[next]}`,
          sub: w.def.name,
          desc: att.fmt(att.tiers[next]),
          apply: () => this._applyAttachment(w, key, next),
        });
      }
    }
    return cards;
  }

  _legendaryCards() {
    const g = this.game;
    const cards = [];
    // a house special straight into your hands
    const specials = Object.keys(GUNS).filter((id) => GUNS[id].cat === 'special' && !g.weapons.owns(id));
    if (specials.length) {
      const id = pick(specials);
      cards.push({
        title: GUNS[id].name, sub: 'HOUSE SPECIAL WEAPON',
        desc: `${GUNS[id].blurb} (Swaps for the gun in your hands if your slots are full.)`,
        apply: () => g.weapons.give(id),
      });
    }
    cards.push({
      title: 'HIGH ROLLER SUITE', sub: 'PLAYER',
      desc: '+25 max health, and heal to full right now.',
      apply: () => { g.player.maxHp += 25; g.player.hp = g.player.maxHp; },
    });
    cards.push({
      title: 'DEMOLITION LICENSE', sub: 'PLAYER',
      desc: `+2 lethal capacity and +2 lethals now.`,
      apply: () => {
        g.playerMods.lethalBonus += 2;
        g.player.grenades = Math.min(g.lethalMax(), g.player.grenades + 2);
      },
    });
    cards.push({
      title: 'MARKED CARDS', sub: 'ECONOMY',
      desc: 'Headshot chip bonus tripled for the rest of the run.',
      apply: () => { g.playerMods.headshotBonus *= 3; },
    });
    return cards;
  }

  // --------------------------- player-level cards ----------------------------
  _playerCards(tier) {
    const g = this.game, m = g.playerMods;
    const cards = [];
    if (tier === 'common' || tier === 'rare') {
      if (m.speed < 1.25) cards.push({
        title: 'RUNNING SHOES', sub: 'PLAYER',
        desc: '+8% movement speed (stacks).',
        apply: () => { m.speed = Math.min(1.25, m.speed + 0.08); },
      });
      if (m.magnet < 2.2) cards.push({
        title: 'CHIP MAGNET', sub: 'ECONOMY',
        desc: 'Chips fly to you from 40% further away (stacks).',
        apply: () => { m.magnet = Math.min(2.2, m.magnet + 0.4); },
      });
      if (m.meleeDmg < 2.5) cards.push({
        title: 'STEEL TOE', sub: 'PLAYER',
        desc: '+50% melee damage (stacks).',
        apply: () => { m.meleeDmg += 0.5; },
      });
    }
    if (tier === 'rare' || tier === 'legendary') {
      if (m.dashCd > 0.55) cards.push({
        title: 'QUICK HANDS', sub: 'PLAYER',
        desc: 'Dash cooldown reduced 20% (stacks).',
        apply: () => { m.dashCd = Math.max(0.55, m.dashCd * 0.8); },
      });
      if (m.roundArmor < 50) cards.push({
        title: 'CASINO INSURANCE', sub: 'PLAYER',
        desc: '+25 armor at the start of every round (stacks).',
        apply: () => { m.roundArmor += 25; g.player.addArmor(25); },
      });
      if (m.interest < 120) cards.push({
        title: 'CARD COUNTER', sub: 'ECONOMY',
        desc: '+40 chips at every intermission (stacks).',
        apply: () => { m.interest += 40; },
      });
    }
    return cards;
  }

  // ------------------------ cursed cards (power at a price) ------------------
  _cursedCards(tier) {
    const g = this.game, m = g.playerMods;
    const cards = [];
    if (tier !== 'common') {
      if (m.dmgAllMult < 1.4) cards.push({
        cursed: true, title: 'BLOOD PACT', sub: 'CURSED',
        desc: '+40% damage on every weapon... but -25 max health.',
        apply: () => {
          m.dmgAllMult = 1.4;
          g.player.maxHp = Math.max(25, g.player.maxHp - 25);
          g.player.hp = Math.min(g.player.hp, g.player.maxHp);
        },
      });
      if (m.chipPickupMult < 1.5) cards.push({
        cursed: true, title: 'LOADED DICE', sub: 'CURSED',
        desc: '+50% chips from pickups... but every hit you take costs 5 chips.',
        apply: () => { m.chipPickupMult = 1.5; m.hitChipLoss = 5; },
      });
      if (m.reloadHpCost === 0) cards.push({
        cursed: true, title: "DEVIL'S RELOAD", sub: 'CURSED',
        desc: 'All reloads 40% faster... but each reload costs 3 health.',
        apply: () => {
          for (const w of Object.values(g.weapons.arsenal)) w.mods.reload *= 0.6;
          m.reloadHpCost = 3;
        },
      });
      cards.push({
        cursed: true, title: 'HOUSE MARKER', sub: 'CURSED',
        desc: '+300 chips right now... but your next wager loss is one penalty step nastier.',
        apply: () => { g.addChips(300); m.markerDebt++; },
      });
    }
    if (tier === 'legendary' && m.critAdd < 0.25) {
      cards.push({
        cursed: true, title: 'GLASS CANNON', sub: 'CURSED',
        desc: '+25% crit chance on everything... but armor no longer protects you at all.',
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
        title: 'DASH & CASH', sub: 'SYNERGY',
        desc: 'For 1.5s after a dash, your shots deal +60% damage.',
        apply: () => { m.dashDamage = true; },
      });
      if (!m.critGrenade) cards.push({
        title: 'CRIT COMPTROLLER', sub: 'SYNERGY',
        desc: 'Critical hits refund a lethal (2s cooldown).',
        apply: () => { m.critGrenade = true; },
      });
      if (!m.chipHeal) cards.push({
        title: 'VAMPIRE CHIPS', sub: 'SYNERGY',
        desc: 'Collecting chips heals you — 1 HP per 25 chips picked up.',
        apply: () => { m.chipHeal = true; },
      });
      if (m.comboWindowAdd === 0) cards.push({
        title: 'COMBO INSURANCE', sub: 'SYNERGY',
        desc: 'Kill-combo window extended by 2 seconds.',
        apply: () => { m.comboWindowAdd = 2; },
      });
    }
    if (tier === 'legendary' && !m.lastBullet) {
      cards.push({
        title: 'LAST CALL', sub: 'SYNERGY',
        desc: 'The final bullet in every magazine deals TRIPLE damage.',
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
        title: 'CHIP BONUS', sub: 'ECONOMY',
        desc: '+150 chips, no strings attached.',
        apply: () => g.addChips(150),
      });
    }
    // draw 3 distinct (4 with the REGULAR'S CARD vault perk)
    const want = 3 + (g.vault?.value('regular', 0) || 0);
    const cards = [];
    const bag = [...pool];
    while (cards.length < want && bag.length) {
      const i = Math.floor(Math.random() * bag.length);
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
      el.innerHTML = `<div class="uc-sub">${c.sub}</div><div class="uc-title">${c.title}</div><div class="uc-desc">${c.desc}</div>`;
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

  _applyAttachment(weapon, attKey, tierIdx) {
    const att = ATTACHMENTS[attKey];
    this.owned[`${weapon.id}.${attKey}`] = tierIdx;
    if (att.add) weapon.mods[att.stat] = att.tiers[tierIdx];
    else weapon.mods[att.stat] = att.tiers[tierIdx];
    // refill mag to new size on mag upgrades so it feels immediate
    if (att.stat === 'mag') weapon.mag = weapon.magSize;
    this.game.ui.banner(`${weapon.def.name}: ${att.name} ${TIER_NAMES[tierIdx]}`, 'gold');
  }

  _statLine() {
    const g = this.game;
    const w = g.weapons.current;
    return `${w.def.name}: ${Math.round(w.damage)} dmg · ${w.magSize} mag · `
      + `${(w.def.fireRate * w.mods.fireRate).toFixed(1)}/s · ${(w.critChance * 100).toFixed(0)}% crit`;
  }

  _close() {
    const g = this.game;
    g.ui.hide('upgrade-panel');
    let back = this.resumeAfter || 'INTERMISSION';
    this.resumeAfter = null;
    // never resume into a hidden casino sub-panel — land on intermission
    if (['UPGRADE', 'BLACKJACK', 'ROULETTE', 'SLOTS'].includes(back)) back = 'INTERMISSION';
    g.setState(back);
    if (back === 'INTERMISSION') {
      g.ui.show('intermission');
      g.casino.updateChipsUI();
      g.saveRun();
    }
  }
}
