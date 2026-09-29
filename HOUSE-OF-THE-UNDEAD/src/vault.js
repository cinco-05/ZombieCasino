// vault.js — meta progression. A cut of every run's final chips is deposited
// into a permanent vault (localStorage). Between runs you spend it on perks
// that make every future run start stronger. Losing runs are deposits now.

const KEY = 'hotu_vault_v1';

export const PERKS = [
  {
    key: 'kevlar', name: 'KEVLAR VEST', icon: '🦺',
    tiers: [
      { cost: 300, desc: 'Start every run with 25 armor' },
      { cost: 700, desc: 'Start every run with 50 armor' },
    ],
    values: [25, 50],
  },
  {
    key: 'pockets', name: 'DEEP POCKETS', icon: '💣',
    tiers: [
      { cost: 250, desc: '+1 lethal capacity, +1 at run start' },
      { cost: 600, desc: '+2 lethal capacity, +2 at run start' },
    ],
    values: [1, 2],
  },
  {
    key: 'front', name: 'FRONT MONEY', icon: '🪙',
    tiers: [
      { cost: 300, desc: 'Start every run with 100 chips' },
      { cost: 750, desc: 'Start every run with 250 chips' },
    ],
    values: [100, 250],
  },
  {
    key: 'comped', name: 'COMPED RATES', icon: '🏷️',
    tiers: [
      { cost: 350, desc: 'Shop prices (and rerolls) reduced 15%' },
      { cost: 800, desc: 'Shop prices (and rerolls) reduced 30%' },
    ],
    values: [0.85, 0.70],
  },
  {
    key: 'regular', name: "REGULAR'S CARD", icon: '🃏',
    tiers: [{ cost: 900, desc: 'The shop stocks a 5th card, and every upgrade offer shows a 4th' }],
    values: [1],
  },
  {
    key: 'locker', name: 'GUN LOCKER', icon: '🔓',
    tiers: [{ cost: 1200, desc: 'The Boneyard Special can be checked in at the Coat Check' }],
    values: [true],
  },
];

export class Vault {
  constructor(game) {
    this.game = game;
    this.data = this._load();
  }

  _load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && typeof d.banked === 'number' && d.perks) return d;
    } catch { /* fresh vault */ }
    return { banked: 0, perks: {}, lifetime: 0 };
  }

  _save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* private mode */ }
  }

  get banked() { return this.data.banked; }

  /** owned tier index for a perk, or -1 */
  tier(key) { return this.data.perks[key] ?? -1; }

  /** current effect value for a perk, or fallback if unowned */
  value(key, fallback) {
    const t = this.tier(key);
    if (t < 0) return fallback;
    const perk = PERKS.find((p) => p.key === key);
    return perk ? perk.values[t] : fallback;
  }

  deposit(amount) {
    if (amount <= 0) return;
    this.data.banked += amount;
    this.data.lifetime += amount;
    this._save();
  }

  buy(key) {
    const perk = PERKS.find((p) => p.key === key);
    if (!perk) return false;
    const next = this.tier(key) + 1;
    if (next >= perk.tiers.length) return false;
    const cost = perk.tiers[next].cost;
    if (this.data.banked < cost) return false;
    this.data.banked -= cost;
    this.data.perks[key] = next;
    this._save();
    return true;
  }

  /** draw the vault panel */
  render() {
    const bal = document.getElementById('vault-balance');
    bal.textContent = `${this.banked} CHIPS BANKED`;
    const wrap = document.getElementById('vault-perks');
    wrap.innerHTML = '';
    for (const perk of PERKS) {
      const owned = this.tier(perk.key);
      const next = owned + 1;
      const maxed = next >= perk.tiers.length;
      const card = document.createElement('div');
      card.className = `perk-card${owned >= 0 ? ' owned' : ''}${maxed ? ' maxed' : ''}`;
      const tierDots = perk.tiers.map((_, i) => i <= owned ? '●' : '○').join(' ');
      const line = maxed
        ? `<div class="perk-desc gold">MAXED — ${perk.tiers[owned].desc}</div>`
        : `<div class="perk-desc">${perk.tiers[next].desc}</div>`;
      card.innerHTML = `
        <div class="perk-head">${perk.icon} <b>${perk.name}</b> <span class="perk-dots">${tierDots}</span></div>
        ${line}`;
      if (!maxed) {
        const btn = document.createElement('button');
        const cost = perk.tiers[next].cost;
        btn.className = 'btn perk-buy';
        btn.textContent = `BUY — ${cost}`;
        btn.disabled = this.banked < cost;
        btn.onclick = () => {
          if (this.buy(perk.key)) {
            this.render();
            this.game._refreshMenu();
          }
        };
        card.appendChild(btn);
      }
      wrap.appendChild(card);
    }
  }
}
