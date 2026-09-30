// main.js — bootstrap + input wiring. Everything else lives in the systems.

import { STYLE } from './gfx/style.js';
import { Game } from './game.js';

document.body.dataset.art = STYLE.name;   // lets the CSS dress the HUD for the era
import { initDebug } from './debug.js';
import { Audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const loadStatus = (k, msg) => {
  $('load-bar-fill').style.width = `${Math.round(k * 100)}%`;
  if (msg) $('load-status').textContent = msg;
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
$('btn-coop-copy').onclick = () => { navigator.clipboard?.writeText(game.net.code || '').then(() => { $('btn-coop-copy').textContent = 'COPIED'; setTimeout(() => { $('btn-coop-copy').textContent = 'COPY'; }, 1500); }).catch(() => {}); };
$('btn-coop-start').onclick = () => game.net.startRun();
$('btn-coop-back').onclick = () => { game.net.leave(true); game.ui.hide('coop-panel'); game.ui.show('main-menu'); };

const canvas = game.renderer.domElement;
await game.preload(loadStatus);
$('main-menu').classList.remove('hidden');
$('loading-screen').classList.add('fade');
setTimeout(() => $('loading-screen').remove(), 700);

// ---------- pointer lock ----------
canvas.addEventListener('click', () => {
  Audio.init(); // first user gesture unlocks WebAudio
  if (game.state === 'COMBAT' || game.state === 'COUNTDOWN') game.ui.requestPointer();
});
document.addEventListener('pointerdown', () => Audio.init(), { once: true });

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

// ---------- mouse buttons ----------
document.addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== canvas) return;
  if (e.button === 0) {
    game.weapons.triggerHeld = true;
    game.weapons.tryFire();
  } else if (e.button === 2) {
    game.player.aiming = true;
  }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) game.weapons.triggerHeld = false;
  if (e.button === 2) game.player.aiming = false;
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
// the mouse wheel flips between your guns
document.addEventListener('wheel', (e) => {
  if (document.pointerLockElement !== canvas) return;
  game.weapons.cycle(e.deltaY > 0 ? 1 : -1);
}, { passive: true });

// ---------- keyboard ----------
document.addEventListener('keydown', (e) => {
  // typing a class name at the Coat Check shouldn't fire off grenades
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  // hold TAB: the scoreboard
  if (e.code === 'Tab') { e.preventDefault(); game.ui.scoreboard(true); return; }
  // at the tables: hit / stand / double / split, holds, spins and the slot arm
  if (!e.repeat && game.casino.key(e.code)) { e.preventDefault(); return; }
  game.player.keys[e.code] = true;
  if (e.repeat) return;
  // down on the carpet: you can look and shoot, nothing else
  if (!game.player.alive && ['KeyQ', 'KeyG', 'KeyT', 'KeyE', 'KeyF', 'KeyR', 'Digit1', 'Digit2', 'Digit3', 'Space'].includes(e.code)) return;
  if (e.code === 'KeyR') game.weapons.startReload();
  if (e.code === 'Digit1') game.weapons.switchSlot(0);
  if (e.code === 'Digit2') game.weapons.switchSlot(1);
  if (e.code === 'Digit3') game.weapons.switchSlot(2);
  if (e.code === 'KeyQ') game.player.tryDash();
  if (e.code === 'KeyG') game.equipment.throwLethal();
  if (e.code === 'KeyT') game.equipment.useTactical();
  if (e.code === 'KeyE') game.tryInteract();
  if (e.code === 'KeyF') game.weapons.tryMelee();
  if (e.code === 'F3') { e.preventDefault(); debugPanel.toggle(); }
  if (e.code === 'F11') { e.preventDefault(); window.HOTU_toggleFullscreen(); }
  if (e.code === 'Space' && document.pointerLockElement === canvas) e.preventDefault();
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Tab') game.ui.scoreboard(false);
  game.player.keys[e.code] = false;
});

// losing focus during combat pauses too (alt-tab, minimizing the window)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.pause();
});
window.addEventListener('blur', () => {
  for (const k of Object.keys(game.player.keys)) game.player.keys[k] = false;
  game.ui.scoreboard(false);
  game.weapons.triggerHeld = false;
});
