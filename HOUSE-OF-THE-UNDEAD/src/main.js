// main.js — bootstrap + input wiring. Everything else lives in the systems.

import { STYLE } from './gfx/style.js';
import { Game } from './game.js';

document.body.dataset.art = STYLE.name;   // lets the CSS dress the HUD for the era
import { initDebug } from './debug.js';
import { Audio } from './audio.js';
import { Binds } from './input.js';

const $ = (id) => document.getElementById(id);
const loadLog = window.HOTU_loadLog = [];   // [ms since page start, step] — how long loading takes, for tuning
const loadStatus = (k, msg) => {
  $('load-bar-fill').style.width = `${Math.round(k * 100)}%`;
  if (msg) $('load-status').textContent = msg;
  loadLog.push([Math.round(performance.now()), msg || '']);
};

// running inside the desktop exe (WebView2)? then the host window does fullscreen + quit
const host = window.chrome && window.chrome.webview;
window.HOTU_toggleFullscreen = () => {
  if (host) host.postMessage('fullscreen:toggle');
  else if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
};
if (!host) $('btn-quit').classList.add('hidden');
$('btn-quit').onclick = () => { if (host) host.postMessage('quit'); else window.close(); };

loadStatus(0.05, 'Building the casino floor…');
// let the loading screen paint before the heavy lifting starts
await new Promise((r) => setTimeout(r, 30));

if (!window.HOTU_glOk) {
  window.HOTU_fail?.('THIS BROWSER CAN\'T DRAW THE CASINO',
    'The game needs WebGL 2 (3D graphics in the browser). Turn on "hardware acceleration" in your browser settings, update your graphics driver, or open the game in an up-to-date Chrome, Edge or Firefox.');
  throw new Error('WebGL 2 unavailable');
}
const game = new Game();
const debugPanel = initDebug(game);
for (const id of ['btn-debug-pause', 'btn-debug-settings']) document.getElementById(id).onclick = () => debugPanel.toggle();
window.HOTU = game; // handy for console poking

// ------------------------------ co-op lobby ----------------------------------
const coopClass = () => { const c = game.coatCheck.current(); $('coop-class').textContent = `Your class: ${c.name || 'the house pick'}`; };
game.refreshCoopClass = coopClass;
$('btn-coop-class').onclick = () => { game.ui.hide('coop-panel'); game.coatCheck.open(); };
$('btn-coop').onclick = () => { Audio.init(); game.ui.hide('main-menu'); coopClass(); $('coop-name').value = game.net.name; game.net.renderSeats(); game.ui.show('coop-panel'); };
$('coop-name').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
$('coop-name').addEventListener('change', (e) => { game.net.setName(e.target.value); e.target.value = game.net.name; });
$('btn-coop-host').onclick = () => { Audio.init(); game.net.setName($('coop-name').value); game.net.host(); };
$('btn-coop-join').onclick = () => { Audio.init(); game.net.setName($('coop-name').value); game.net.join($('coop-join-code').value); };
$('coop-join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-coop-join').click(); });
$('coop-join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
/** copy text, with the old select-and-copy for browsers that refuse the clipboard API */
const copyText = async (text) => {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  try {
    const t = document.createElement('textarea');
    t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  } catch { return false; }
};
const copyButton = (id, text, label) => {
  copyText(text).then((ok) => {
    $(id).textContent = ok ? 'COPIED ✓' : 'COPY FAILED: SELECT IT BY HAND';
    setTimeout(() => { $(id).textContent = label; }, 1600);
  });
};
$('btn-coop-copy').onclick = () => copyButton('btn-coop-copy', game.net.code || '', 'COPY CODE');
$('btn-coop-invite').onclick = () => copyButton('btn-coop-invite', game.net.inviteLink() || '', '🔗 COPY INVITE LINK');
$('btn-coop-start').onclick = () => game.net.startRun();
$('btn-coop-back').onclick = () => { game.net.leave(true); game.ui.hide('coop-panel'); game.ui.show('main-menu'); };

const canvas = game.renderer.domElement;
await game.preload(loadStatus);
$('main-menu').classList.remove('hidden');
loadLog.push([Math.round(performance.now()), 'menu']);
// a phone or tablet with no mouse: say so up front
if (!matchMedia('(any-pointer: fine)').matches) $('touch-note').classList.remove('hidden');
// opened from an invite link (?join=CODE): straight to the co-op table
const invite = new URLSearchParams(location.search).get('join');
if (invite) {
  history.replaceState(null, '', location.pathname);
  $('btn-coop').click();
  $('coop-join-code').value = invite.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  game.net.setName($('coop-name').value);
  game.net.join($('coop-join-code').value);
}
$('loading-screen').classList.add('fade');
setTimeout(() => $('loading-screen').remove(), 700);

// ---------- pointer lock ----------
canvas.addEventListener('click', () => {
  Audio.init(); // first user gesture unlocks WebAudio
  if (game.state === 'COMBAT' || game.state === 'COUNTDOWN') game.ui.requestPointer();
});
document.addEventListener('pointerdown', () => Audio.init());
document.addEventListener('keydown', () => Audio.init());

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (!locked && (game.state === 'COMBAT' || game.state === 'COUNTDOWN')) {
    game.pause(); // Esc released the pointer → pause menu
  }
});

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) {
    game.player.onMouseMove(e.movementX, e.movementY);
  }
});

// ---------- actions (see input.js: every key here can be rebound) ----------
const locked = () => document.pointerLockElement === canvas;
/** a bound key went down (not a repeat) */
function pressAction(act) {
  if (!act) return;
  // down on the carpet: you can look and shoot, nothing else
  if (!game.player.alive && act !== 'scores') return;
  switch (act) {
    case 'reload': game.weapons.startReload(); break;
    case 'gun1': game.weapons.switchSlot(0); break;
    case 'gun2': game.weapons.switchSlot(1); break;
    case 'gun3': game.weapons.switchSlot(2); break;
    case 'dash': game.player.tryDash(); break;
    case 'lethal': game.equipment.throwLethal(); break;
    case 'tactical': game.equipment.useTactical(); break;
    case 'use': game.tryInteract(); break;
    case 'melee': game.weapons.tryMelee(); break;
    case 'sprint': if (game.settings.sprintToggle) game.player.sprintLatch = !game.player.sprintLatch; break;
    default: break;
  }
}

// ---------- mouse buttons ----------
// left fires and right aims; the wheel click and side buttons can be bound
document.addEventListener('mousedown', (e) => {
  if (!locked()) return;
  if (e.button === 0) {
    game.weapons.triggerHeld = true;
    game.weapons.tryFire();
  } else if (e.button === 2) {
    game.player.aiming = game.settings.aimToggle ? !game.player.aiming : true;
  } else {
    e.preventDefault();                     // side buttons would otherwise go "back" a page
    const code = `Mouse${e.button}`;
    game.player.keys[code] = true;
    const act = Binds.actionFor(code);
    if (act === 'scores') game.ui.scoreboard(true);
    else pressAction(act);
  }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) game.weapons.triggerHeld = false;
  else if (e.button === 2) { if (!game.settings.aimToggle) game.player.aiming = false; }
  else {
    if (locked()) e.preventDefault();
    const code = `Mouse${e.button}`;
    game.player.keys[code] = false;
    if (Binds.actionFor(code) === 'scores') game.ui.scoreboard(false);
  }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
// the mouse wheel flips between your guns
document.addEventListener('wheel', (e) => {
  if (!locked()) return;
  game.weapons.cycle(e.deltaY > 0 ? 1 : -1);
}, { passive: true });

// ---------- keyboard ----------
// Esc backs out of the menus (pausing mid-fight is the pointer lock's job)
const ESC_BACK = [
  ['settings-panel', 'btn-settings-close'], ['howto-panel', 'btn-howto-go'], ['markers-panel', 'btn-markers-close'],
  ['vault-panel', 'btn-vault-close'], ['coatcheck-panel', 'btn-coat-back'],
];
document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && !locked()) {
    if (e.target?.blur && e.target !== document.body) e.target.blur();
    for (const [panel, btn] of ESC_BACK) {
      if (!$(panel).classList.contains('hidden')) { e.preventDefault(); $(btn).click(); return; }
    }
  }
  // typing a class name at the Coat Check shouldn't fire off grenades
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
  if (e.code === 'F3') { e.preventDefault(); debugPanel.toggle(); return; }
  if (e.code === 'F11') { e.preventDefault(); window.HOTU_toggleFullscreen(); return; }
  const act = Binds.actionFor(e.code);
  // hold the scoreboard key (TAB): everyone at the table
  if (act === 'scores') { e.preventDefault(); game.ui.scoreboard(true); return; }
  // at the tables: hit / stand / double / split, holds, spins and the slot arm
  if (!e.repeat && game.casino.key(e.code)) { e.preventDefault(); return; }
  if (act && locked()) e.preventDefault();   // no page scrolling on SPACE mid-fight
  game.player.keys[e.code] = true;
  if (!e.repeat) pressAction(act);
});
document.addEventListener('keyup', (e) => {
  if (Binds.actionFor(e.code) === 'scores') game.ui.scoreboard(false);
  game.player.keys[e.code] = false;
});

// losing focus during combat pauses too (alt-tab, minimizing the window)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.pause();
});
window.addEventListener('blur', () => {
  for (const k of Object.keys(game.player.keys)) game.player.keys[k] = false;
  game.player.sprintLatch = false;
  game.ui.scoreboard(false);
  game.weapons.triggerHeld = false;
});
