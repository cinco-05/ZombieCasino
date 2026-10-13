// input.js — the keys. Every action has a default key, picked by its place on
// the keyboard (event.code), so an AZERTY player gets the same hand shape as a
// QWERTY one. Every action can be rebound in Settings → Controls, and every
// on-screen key hint reads from here, labelled in the player's own layout.
//
// Mouse buttons past the first two (wheel click, the side buttons) can be bound
// too: they arrive as the codes Mouse1, Mouse3 and Mouse4.

const KEY = 'hotu_binds_v1';

export const ACTIONS = [
  { id: 'forward', label: 'Move forward', def: ['KeyW'] },
  { id: 'back', label: 'Move back', def: ['KeyS'] },
  { id: 'left', label: 'Strafe left', def: ['KeyA'] },
  { id: 'right', label: 'Strafe right', def: ['KeyD'] },
  { id: 'sprint', label: 'Sprint', def: ['ShiftLeft', 'ShiftRight'] },
  { id: 'jump', label: 'Jump', def: ['Space'] },
  { id: 'dash', label: 'Dash', def: ['KeyQ'] },
  { id: 'use', label: 'Use · buy · revive', def: ['KeyE'] },
  { id: 'reload', label: 'Reload', def: ['KeyR'] },
  { id: 'melee', label: 'Pistol-whip', def: ['KeyF'] },
  { id: 'lethal', label: 'Throw lethal', def: ['KeyG'] },
  { id: 'tactical', label: 'Use tactical', def: ['KeyT'] },
  { id: 'gun1', label: 'First gun', def: ['Digit1'] },
  { id: 'gun2', label: 'Second gun', def: ['Digit2'] },
  { id: 'gun3', label: 'Third gun', def: ['Digit3'] },
  { id: 'scores', label: 'Scoreboard (hold)', def: ['Tab'] },
];

/** keys the game keeps for itself: pause, fullscreen, the debug panel */
export const RESERVED = new Set(['Escape', 'F3', 'F11', 'Mouse0', 'Mouse2']);

const NAMES = {
  Space: 'SPACE', ShiftLeft: 'SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'CTRL', ControlRight: 'R-CTRL',
  AltLeft: 'ALT', AltRight: 'ALT GR', MetaLeft: 'WIN', MetaRight: 'WIN', Tab: 'TAB', CapsLock: 'CAPS',
  Enter: 'ENTER', Backspace: 'BKSP', Backquote: '`', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Mouse1: 'MOUSE 3', Mouse3: 'MOUSE 4', Mouse4: 'MOUSE 5', Insert: 'INS', Delete: 'DEL', PageUp: 'PG UP', PageDown: 'PG DN',
};

let layout = null;   // the player's keyboard layout, where the browser shares it
try {
  navigator.keyboard?.getLayoutMap?.().then((m) => { layout = m; globalThis.dispatchEvent?.(new Event('hotu-binds')); }).catch(() => {});
} catch { /* not offered */ }

const defaults = () => Object.fromEntries(ACTIONS.map((a) => [a.id, [...a.def]]));

export const Binds = {
  map: defaults(),

  load() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* defaults */ }
    this.map = defaults();
    for (const a of ACTIONS) {
      const v = saved[a.id];
      if (Array.isArray(v) && v.length && v.every((c) => typeof c === 'string' && !RESERVED.has(c))) this.map[a.id] = v.slice(0, 2);
    }
    return this;
  },

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.map)); } catch { /* private mode */ }
    globalThis.dispatchEvent?.(new Event('hotu-binds'));
  },

  reset() { this.map = defaults(); this.save(); },

  /** bind an action to a key. If another action had that key, the two swap,
      so nothing is ever left without a key. Returns the action it swapped with. */
  set(action, code) {
    if (RESERVED.has(code) || !this.map[action]) return null;
    const old = this.map[action][0];
    let swapped = null;
    for (const a of ACTIONS) {
      if (a.id === action) continue;
      const list = this.map[a.id];
      if (!list.includes(code)) continue;
      const rest = list.filter((c) => c !== code);
      this.map[a.id] = rest.length ? rest : [old];
      swapped = a.id;
    }
    this.map[action] = [code];
    this.save();
    return swapped;
  },

  /** the action a key (or extra mouse button) is bound to, if any */
  actionFor(code) {
    for (const a of ACTIONS) if (this.map[a.id].includes(code)) return a.id;
    return null;
  },

  /** is the action held right now? keys: the player's held-key table */
  held(keys, action) {
    const list = this.map[action];
    for (let i = 0; i < list.length; i++) if (keys[list[i]]) return true;
    return false;
  },

  /** how a key reads on screen ("W", "SHIFT", "MOUSE 4"…), in the player's layout */
  keyName(code) {
    if (!code) return '—';
    if (NAMES[code]) return NAMES[code];
    const local = layout?.get?.(code);
    if (local && local.trim()) return local.toUpperCase();
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Numpad')) return `NUM ${code.slice(6)}`;
    return code.toUpperCase();
  },

  /** the primary key of an action, as it reads on screen */
  label(action) { return this.keyName(this.map[action]?.[0]); },

  /** WASD, or whatever the four movement keys are now */
  moveLabel() {
    const k = ['forward', 'left', 'back', 'right'].map((a) => this.label(a));
    return k.join(k.every((s) => s.length === 1) ? '' : ' ');
  },
};

Binds.load();
