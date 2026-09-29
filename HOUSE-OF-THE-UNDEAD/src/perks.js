// perks.js — the cocktail automats. Walk up to one mid-round, press E, pay,
// and your hands knock back the drink (weapons.drink plays it). Four drinks
// max — the house cuts you off (five with the IRON STOMACH vice). Go down with
// a DOUBLE DOWN DAIQUIRI in you and the house deals you back in; go down
// without one and it's over. Every drink's effect lands in game.perkFx, which
// the rest of the game reads.

import * as THREE from 'three';
import { Audio } from './audio.js';
import { DRINKS, DRINK_LIMIT } from './catalog.js';

/** what a set of drinks adds up to (neutral values when you're sober) */
export function perkEffects(owned) {
  const has = (k) => owned.includes(k);
  return {
    hpBonus: has('stout') ? 100 : 0,
    reload: has('sling') ? 0.55 : 1,
    switchMult: has('sling') ? 0.6 : 1,
    fireRate: has('shooter') ? 1.3 : 1,
    doubleTap: has('shooter') ? 0.25 : 0,
    speed: has('fizz') ? 1.15 : 1,
    dashCd: has('fizz') ? 0.5 : 1,
    slots: has('spritz') ? 3 : 2,
    blastProof: has('punch'),
    dashBlast: has('punch'),
    chipMult: has('liqueur') ? 1.3 : 1,
    dropMult: has('liqueur') ? 1.7 : 1,
    magnet: has('liqueur') ? 1.5 : 1,
    headMult: has('dram') ? 1.5 : 1,
    critAdd: has('dram') ? 0.08 : 0,
    adsSpread: has('dram') ? 0.5 : 1,
    revive: has('daiquiri'),
  };
}

export class Perks {
  constructor(game) {
    this.game = game;
    this.owned = [];                  // drink keys, in the order drunk
    this.daiquiris = 0;               // bought this run (3 max)
    this.busy = false;
    game.perkFx = perkEffects([]);
  }

  get limit() { return DRINK_LIMIT + (this.game.vice === 'stomach' ? 1 : 0); }
  price(key) { return Math.round(DRINKS[key].price * (this.game.vice === 'stomach' ? 1.1 : 1) / 5) * 5; }
  has(key) { return this.owned.includes(key); }

  reset() {
    this.owned = [];
    this.daiquiris = 0;
    this.busy = false;
    this._apply();
  }

  /** set drinks directly (continuing a saved run) */
  restore(list, daiquiris = 0) {
    this.owned = [...list];
    this.daiquiris = daiquiris;
    this._apply(false);
  }

  /** recompute game.perkFx and push the numbers that live elsewhere */
  _apply(heal = true) {
    const g = this.game;
    const before = g.perkFx || perkEffects([]);
    g.perkFx = perkEffects(this.owned);
    const p = g.player;
    // DEAD WEIGHT STOUT: +100 max health (and the new health with it)
    const dHp = g.perkFx.hpBonus - before.hpBonus;
    if (dHp !== 0) {
      p.maxHp = Math.max(25, p.maxHp + dHp);
      p.hp = dHp > 0 && heal ? Math.min(p.maxHp, p.hp + dHp) : Math.min(p.hp, p.maxHp);
    }
    if (g.perkFx.slots < before.slots) g.weapons.dropExtraSlots();
    g.ui.updatePerks?.();
    g.ui.updateHUD();
  }

  // ------------------------------- the automats -------------------------------
  /** interactables for every machine (registered by game.js) */
  interactables() {
    return this.game.arena.perkMachines.map((pm) => ({
      pos: pm.pos, facing: pm.facing, radius: 2.3, zone: pm.zone,
      label: () => this._label(pm.key),
      cost: () => this.price(pm.key),
      use: () => this.buy(pm.key),
    }));
  }

  _label(key) {
    const d = DRINKS[key];
    if (this.has(key)) return { title: d.name, sub: 'You\'ve already got one in you', cost: null, icon: d.icon, color: d.color };
    if (key === 'daiquiri' && this.daiquiris >= (d.limit || 99)) return { title: d.name, sub: 'The bartender\'s done serving you these tonight', cost: null, icon: d.icon, color: d.color };
    if (this.owned.length >= this.limit) return { title: d.name, sub: `The house cuts you off at ${this.limit} drinks`, cost: null, icon: d.icon, color: d.color };
    return { title: d.name, sub: d.blurb, cost: this.price(key), icon: d.icon, color: d.color };
  }

  buy(key) {
    const g = this.game;
    const d = DRINKS[key];
    if (this.busy || g.weapons.drinkT > 0) return;
    if (this.has(key) || this.owned.length >= this.limit) { Audio.play('dryfire'); return; }
    if (key === 'daiquiri' && this.daiquiris >= (d.limit || 99)) { Audio.play('dryfire'); return; }
    const cost = this.price(key);
    if (g.chips < cost) { Audio.play('dryfire'); g.ui.prompt(`${d.name} costs ${cost} chips`); return; }
    g.chips -= cost;
    g.ui.updateHUD();
    Audio.play('chip');
    this.busy = true;
    const pm = g.arena.perkMachines.find((m) => m.key === key);
    if (pm) g.effects.spawnBurst(pm.pos.clone().setY(1.5).addScaledVector(pm.facing, 0.5), 0xffd060, 6, 3);
    g.weapons.drink(d, () => {
      this.busy = false;
      if (this.has(key)) return;
      this.owned.push(key);
      if (key === 'daiquiri') this.daiquiris++;
      this._apply();
      g.ui.banner(`${d.icon} ${d.name}`, 'gold', 2200);
      Audio.play('perk_get');
    });
  }

  // --------------------------------- going down --------------------------------
  /** called when the player's health hits zero; returns true if dealt back in */
  tryRevive() {
    const g = this.game;
    if (!this.has('daiquiri')) return false;
    // the house deals you back in — the daiquiri is spent, everything else stays down
    this.owned = this.owned.filter((k) => k !== 'daiquiri');
    this._apply(false);
    const p = g.player;
    p.hp = p.maxHp;
    p.iFrames = 3;
    g.slowmo(1.2);
    g.addShake(0.3);
    // a shockwave throws the crowd off you
    for (const z of g.enemies.list) {
      const to = z.mesh.position.clone().sub(p.pos).setY(0);
      const d = to.length();
      if (d < 7) {
        z.knockback(to.normalize(), 14 * (1 - d / 7) + 4);
        z.stun?.(1.2);
      }
    }
    g.effects.spawnPoof(p.pos.clone().setY(1), 0x7dff4a);
    g.effects.spawnBurst(p.pos.clone().setY(1), 0xffd060, 18, 9);
    g.ui.banner('DOUBLE DOWN — THE HOUSE DEALS YOU BACK IN', 'cyan', 3200);
    Audio.play('revive');
    return true;
  }
}

export { DRINKS };
export const perkVec = new THREE.Vector3();
