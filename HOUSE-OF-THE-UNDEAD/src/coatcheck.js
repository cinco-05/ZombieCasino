// coatcheck.js — THE COAT CHECK: create-a-class. Three claim tickets, each a
// named class: a primary, a sidearm, a lethal (G), a tactical (T) and a vice.
// The house specials (Magnum, Whale, Jubilee) can't be checked in — they only
// come off THE BIG SIX or the shop. The Boneyard Special needs the Vault's Gun
// Locker. Tickets persist between sessions.

import { CONFIG } from './config.js';
import { Audio } from './audio.js';
import { GUNS, LETHALS, TACTICALS, VICES, DEFAULT_CLASSES } from './catalog.js';
import { normalizeSeed, randomSeed } from './rng.js';

const $ = (id) => document.getElementById(id);
const KEY = 'hotu_classes_v1';
const SLOTS = [
  { key: 'primary', label: 'PRIMARY' },
  { key: 'sidearm', label: 'SIDEARM' },
  { key: 'lethal', label: 'LETHAL · G' },
  { key: 'tactical', label: 'TACTICAL · T' },
  { key: 'vice', label: 'VICE' },
];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 0..1 bars so guns can be compared at a glance (the shop's gun cards use them too) */
export function gunBars(id) {
  const d = CONFIG.weapons[id];
  const per = d.fire === 'cork' ? d.damage * 1.6 : d.damage * d.pellets * (d.pierce ? 1 + (d.pierce - 1) * 0.3 : 1);
  const dps = per * d.fireRate;
  return [
    ['POWER', Math.min(1, per / 240)],
    ['RATE', Math.min(1, d.fireRate / 12.5)],
    ['DPS', Math.min(1, dps / 330)],
    ['MAG', Math.min(1, d.mag / 60)],
    ['RELOAD', Math.min(1, 1.05 / d.reload)],
  ];
}

export class CoatCheck {
  constructor(game) {
    this.game = game;
    this.slot = 'primary';
    this._load();
    this._wire();
  }

  _load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* defaults */ }
    const base = DEFAULT_CLASSES.map((c) => ({ ...c }));
    this.classes = Array.isArray(saved?.classes) && saved.classes.length === 3
      ? saved.classes.map((c, i) => ({ ...base[i], ...c }))
      : base;
    this.selected = Math.max(0, Math.min(2, saved?.selected ?? 0));
  }

  _save() {
    try { localStorage.setItem(KEY, JSON.stringify({ classes: this.classes, selected: this.selected })); } catch { /* private mode */ }
  }

  _locked(slot, id) {
    if (slot === 'primary' && GUNS[id]?.locker) return !this.game.vault?.value('locker', false);
    return false;
  }

  /** the ticket you'd walk in with, with anything no longer allowed swapped for a default */
  current() {
    const c = { ...this.classes[this.selected] };
    if (!GUNS[c.primary] || GUNS[c.primary].cat !== 'primary' || this._locked('primary', c.primary)) c.primary = 'shotgun';
    if (!GUNS[c.sidearm] || GUNS[c.sidearm].cat !== 'sidearm') c.sidearm = 'pistol';
    if (!LETHALS[c.lethal]) c.lethal = 'chipbomb';
    if (!TACTICALS[c.tactical]) c.tactical = 'bellini';
    if (!VICES[c.vice]) c.vice = 'none';
    return c;
  }

  // --------------------------------- screen -----------------------------------
  /** focusSeed: came in through PLAY A SEED — put the cursor in the seed box */
  open(focusSeed = false) {
    this.game.ui.hide('main-menu');
    this.render();
    // the guest plays the host's seed, so only the host (or a solo run) picks one
    $('coat-seed-row').classList.toggle('hidden', this.game.net.role === 'guest');
    this.game.ui.show('coatcheck-panel');
    if (focusSeed) setTimeout(() => { $('coat-seed').focus(); $('coat-seed').select(); }, 60);
  }

  /** what's typed in the seed box ('' = deal a random one) */
  seed() { return normalizeSeed($('coat-seed')?.value); }

  close() {
    this.game.ui.hide('coatcheck-panel');
    // picking a class for a co-op table? back to the lobby
    if (this.game.net.role) { this.game.ui.show('coop-panel'); this.game.refreshCoopClass?.(); }
    else this.game.ui.show('main-menu');
  }

  _wire() {
    $('btn-coat-back').onclick = () => { this._save(); this.close(); };
    $('btn-coat-go').onclick = () => {
      this._save();
      if (this.game.net.role && !this.game.net.inRun) { this.close(); return; }   // co-op lobby: just pick
      this.game.ui.hide('coatcheck-panel');
      Audio.play('door');
      this.game.newRun(this.current(), this.seed());
    };
    $('btn-seed-dice').onclick = () => { $('coat-seed').value = randomSeed(); Audio.play('dice_roll'); };
    // capitals, digits and dashes as you type (the ends get tidied when you walk in)
    $('coat-seed').addEventListener('input', (e) => {
      const v = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
      if (v !== e.target.value) e.target.value = v;
    });
    $('coat-seed').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-coat-go').click(); });
    $('btn-coat-reset').onclick = () => {
      this.classes[this.selected] = { ...DEFAULT_CLASSES[this.selected] };
      this._save();
      Audio.play('shuffle');
      this.render();
    };
    $('coat-name').addEventListener('input', (e) => {
      this.classes[this.selected].name = e.target.value.toUpperCase().slice(0, 22) || `TICKET ${this.selected + 1}`;
      this._save();
      this._renderTickets();
    });
  }

  render() {
    this._renderTickets();
    $('coat-name').value = this.classes[this.selected].name;
    this._renderSlots();
    this._renderPicker();
  }

  _renderTickets() {
    const el = $('coat-tickets');
    el.innerHTML = '';
    this.classes.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = `coat-ticket${i === this.selected ? ' on' : ''}`;
      b.innerHTML = `<span class="ct-no">No. ${i + 1}</span><span class="ct-name">${esc(c.name)}</span>`;
      b.onclick = () => { this.selected = i; this._save(); Audio.play('card'); this.render(); };
      el.appendChild(b);
    });
  }

  _itemFor(slot, id) {
    if (slot === 'primary' || slot === 'sidearm') return GUNS[id];
    if (slot === 'lethal') return LETHALS[id];
    if (slot === 'tactical') return TACTICALS[id];
    return VICES[id];
  }

  _renderSlots() {
    const c = this.current();
    const el = $('coat-slots');
    el.innerHTML = '';
    for (const s of SLOTS) {
      const it = this._itemFor(s.key, c[s.key]);
      const b = document.createElement('button');
      b.className = `coat-slot${s.key === this.slot ? ' on' : ''} cs-${s.key}`;
      b.innerHTML = `<div class="cs-label">${s.label}</div><div class="cs-icon">${it.icon}</div><div class="cs-name">${esc(it.name)}</div>`;
      b.onclick = () => { this.slot = s.key; Audio.play('card'); this._renderSlots(); this._renderPicker(); };
      el.appendChild(b);
    }
  }

  _options(slot) {
    if (slot === 'primary') return Object.keys(GUNS).filter((id) => GUNS[id].cat === 'primary');
    if (slot === 'sidearm') return Object.keys(GUNS).filter((id) => GUNS[id].cat === 'sidearm');
    if (slot === 'lethal') return Object.keys(LETHALS);
    if (slot === 'tactical') return Object.keys(TACTICALS);
    return Object.keys(VICES);
  }

  _renderPicker() {
    const slot = this.slot;
    const c = this.classes[this.selected];
    const title = SLOTS.find((s) => s.key === slot).label;
    const specials = Object.values(GUNS).filter((g) => g.cat === 'special').map((g) => g.name);
    $('coat-picker-title').innerHTML = slot === 'primary'
      ? `${title} <small>— house specials (${specials.join(', ')}) can't be checked in: find them on THE BIG SIX</small>`
      : title;
    const el = $('coat-picker');
    el.innerHTML = '';
    for (const id of this._options(slot)) {
      const it = this._itemFor(slot, id);
      const locked = this._locked(slot, id);
      const b = document.createElement('button');
      b.className = `coat-opt${c[slot] === id ? ' on' : ''}${locked ? ' locked' : ''}`;
      let stats = '';
      if (slot === 'primary' || slot === 'sidearm') {
        stats = `<div class="co-bars">${gunBars(id).map(([n, v]) => `<div class="co-bar"><span>${n}</span><i style="--v:${(v * 100).toFixed(0)}%"></i></div>`).join('')}</div>`;
      } else if (slot === 'lethal' || slot === 'tactical') {
        stats = `<div class="co-carry">Walk in with ${it.start} · carry up to ${it.max}</div>`;
      }
      b.innerHTML = `<div class="co-icon">${it.icon}</div><div class="co-body"><div class="co-name">${esc(it.name)}${locked ? ' <em>🔒 VAULT: GUN LOCKER</em>' : ''}</div>`
        + `<div class="co-blurb">${esc(it.blurb)}</div>${stats}</div>`;
      b.onclick = () => {
        if (locked) { Audio.play('dryfire'); return; }
        c[slot] = id;
        this._save();
        Audio.play('chip');
        this._renderSlots();
        this._renderPicker();
      };
      el.appendChild(b);
    }
  }
}
