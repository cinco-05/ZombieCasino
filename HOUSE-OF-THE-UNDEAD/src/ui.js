// ui.js — everything DOM: HUD updates, banners, floating text, hitmarkers,
// threat indicator, settings persistence, local high scores, panel show/hide.

import { CONFIG, clamp } from './config.js';
import { Audio } from './audio.js';
import { GUNS, LETHALS, TACTICALS, DRINKS, PARTS } from './catalog.js';
import { RARITY, COMPS } from './rewards.js';
import { STYLE } from './gfx/style.js';

// every round is a new short, with a proper 1930s title
const CARTOON_TITLES = [
  'THE GRAVEYARD SHUFFLE', 'BONES ON THE HOUSE', 'MIDNIGHT AT THE ROULETTE', "DEAD MAN'S STOMP", 'SKELETON SWING',
  'THE BOOGIE-WOOGIE BONEYARD', 'CURTAINS FOR THE CROUPIER', 'THE HAUNTED HIGH ROLLER', 'GHOSTS OF THE GAMING FLOOR',
  'SNAKE EYES & SPOOKS', 'THE LAST CALL ROUNDUP', 'A NIGHT AT THE CASINO', 'JITTERBUG JAMBOREE', 'THE JACKPOT JAMBOREE',
  'A RATTLING GOOD TIME', 'THE SPOOKY SPIN', 'MOONLIGHT MADNESS', 'THE SWING SHIFT SCARE', 'HOT DICE, COLD FEET',
  'THE DEALER DEALS A DOOZY', 'CHIPS AHOY, MATEY!', 'THE CAN-CAN CATASTROPHE', 'WHEN THE SLOTS GO MARCHING IN',
];
import { LOYALTY, MARKERS, CHIPS } from './progress.js';

const $ = (id) => document.getElementById(id);
const HS_KEY = 'hotu_highscore_v1';

/** painted once: blood spattered around the screen edges, clear in the middle */
let _bloodImg = null;
function bloodOverlayImage() {
  if (_bloodImg) return _bloodImg;
  const W = 960, H = 540, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  let s = 17;
  const R = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const edge = () => {
    const side = Math.floor(R() * 4), t = R();
    return side === 0 ? [t * W, R() * 90] : side === 1 ? [t * W, H - R() * 90] : side === 2 ? [R() * 110, t * H] : [W - R() * 110, t * H];
  };
  for (let i = 0; i < 40; i++) {
    const [x, y] = edge();
    const r = 12 + R() * 55;
    const g = c.createRadialGradient(x, y, r * 0.2, x, y, r);
    g.addColorStop(0, 'rgba(110,4,8,0.95)'); g.addColorStop(0.7, 'rgba(80,2,6,0.8)'); g.addColorStop(1, 'rgba(60,0,4,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    for (let k = 0; k < 8; k++) {
      c.fillStyle = 'rgba(90,3,6,0.85)';
      c.beginPath(); c.arc(x + (R() - 0.5) * r * 3, y + (R() - 0.5) * r * 3, 1 + R() * 5, 0, Math.PI * 2); c.fill();
    }
    if (R() < 0.5) {   // runs down the lens
      c.strokeStyle = 'rgba(90,3,6,0.7)'; c.lineWidth = 2 + R() * 4; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + (R() - 0.5) * 8, y + 30 + R() * 120); c.stroke();
    }
  }
  _bloodImg = cv.toDataURL();
  return _bloodImg;
}

export class UI {
  constructor(game) {
    this.game = game;
    this.promptTimer = 0;
    this.bannerTimer = 0;
    this._wireSettings();
    this.renderHighscore();
  }

  // ------------------------------ panels ------------------------------------
  show(id) { $(id).classList.remove('hidden'); }
  hide(id) { $(id).classList.add('hidden'); }
  hideAllPanels() {
    for (const id of ['main-menu', 'pause-menu', 'settings-panel', 'boss-intro', 'coatcheck-panel', 'coop-panel', 'markers-panel',
      'intermission', 'blackjack-panel',
      'roulette-panel', 'slots-panel', 'poker-panel', 'upgrade-panel', 'summary-panel', 'vault-panel']) {
      this.hide(id);
    }
  }

  requestPointer() {
    // Chrome rejects/throws if this is called too soon after Esc released the
    // lock — one of the intermittent "crashes". Swallow it; the click handler
    // in main.js re-requests on the next click.
    try {
      const p = this.game.renderer.domElement.requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* ignore */ }
  }

  // ------------------------------- HUD --------------------------------------
  updateHUD() {
    const g = this.game, p = g.player, w = g.weapons.current;
    $('hp-text').textContent = Math.ceil(p.hp);
    $('hp-fill').style.width = `${clamp(p.hp / p.maxHp * 100, 0, 100)}%`;
    $('hp-fill').classList.toggle('low', p.hp < 30);

    const armorWrap = $('armor-wrap');
    armorWrap.style.display = p.armor > 0 ? '' : 'none';
    $('armor-fill').style.width = `${clamp(p.armor, 0, 100)}%`;

    $('chips-hud').textContent = g.chips;
    const wn = $('weapon-name');
    wn.textContent = w.name + (g.weapons.reloading ? ' — RELOADING' : '');
    wn.classList.toggle('packed', !!w.packed);                  // ALL IN guns read in gold
    $('ammo-mag').textContent = w.mag;
    $('ammo-reserve').textContent = w.reserve;

    // weapon slots: a plate per gun you carry, the live one lit gold
    const W = g.weapons;
    const slotsHtml = [0, 1, 2].map((i) => {
      const id = W.slots[i];
      if (i >= W.maxSlots) return '';
      if (!id) return `<span class="wslot empty"><b>${i + 1}</b>—</span>`;
      const on = W.slot === i;
      const short = W.arsenal[id].name.replace(/^THE /i, '').split(' ').slice(0, 2).join(' ');
      return `<span class="wslot${on ? ' on' : ''}${W.arsenal[id].packed ? ' packed' : ''}"><b>${i + 1}</b>${short}</span>`;
    }).join('');
    if (slotsHtml !== this._slotsHtml) { $('weapon-slots').innerHTML = slotsHtml; this._slotsHtml = slotsHtml; }

    // lethal (G) + tactical (T) + dash + combo
    const L = LETHALS[p.lethalId], T = TACTICALS[p.tacticalId];
    const gearHtml = `<span class="gear" style="--c:${L?.color || '#e0303c'}" title="${L?.name}"><kbd>G</kbd>${L?.icon}<b>${p.grenades}</b></span>`
      + (T ? `<span class="gear" style="--c:${T.color}" title="${T.name}"><kbd>T</kbd>${T.icon}<b>${p.tacticals}</b></span>` : '');
    if (gearHtml !== this._gearHtml) { $('gear-hud').innerHTML = gearHtml; this._gearHtml = gearHtml; }
    const dashPct = clamp(1 - p.dashCd / p.dashCooldown, 0, 1);
    $('dash-fill').style.width = `${dashPct * 100}%`;
    $('dash-wrap').classList.toggle('ready', dashPct >= 1);

    // (the streak panel is drawn by rewards.js: tier, window, what's next)

    $('round-hud').textContent = g.round > 0
      ? (g.round > CONFIG.rounds ? `ROUND ${g.round} — ENDLESS` : `ROUND ${g.round} / ${CONFIG.rounds}`)
      : '—';
    const obj = $('objective-hud');
    if (g.objective && (g.state === 'COMBAT' || g.state === 'COUNTDOWN')) {
      obj.style.display = '';
      obj.textContent = g.objective.def.label(g.objective);
      obj.classList.toggle('failed', !!g.objective.failed);
    } else obj.style.display = 'none';
    $('enemies-hud').textContent = g.state === 'COMBAT'
      ? `☠ ${g.enemies.remaining() + g.bosses.filter((b) => !b.dead).length}` : '';

    // penalties list + active special round
    const pen = g.casino.activePenaltyLabels();
    let penHtml = pen.map((t) => `<div class="pen">⚠ ${t}</div>`).join('');
    if (g.specialRound && (g.state === 'COMBAT' || g.state === 'COUNTDOWN')) {
      penHtml = `<div class="pen special">★ ${g.specialRound.name} — chips x${g.specialRound.chipMult}</div>` + penHtml;
    }
    $('penalties-hud').innerHTML = penHtml;

    // boss bar
    const boss = g.bosses.find((b) => !b.dead);
    $('boss-bar').classList.toggle('hidden', !boss);
    if (boss) {
      $('boss-name').textContent = boss.name;
      $('boss-fill').style.width = `${clamp(boss.hp / boss.maxHp * 100, 0, 100)}%`;
    }

    // low-hp vignette pulse (steady when reduced flash)
    const v = $('damage-vignette');
    if (p.hp < 30 && p.hp > 0) {
      const a = this.game.settings.reducedFlash ? 0.35
        : 0.25 + 0.15 * Math.sin(performance.now() / 220);
      v.style.boxShadow = `inset 0 0 140px rgba(200,20,30,${a})`;
    } else if (!this.hurtFlashUntil || performance.now() > this.hurtFlashUntil) {
      v.style.boxShadow = 'none';
    }
  }

  /** corner minimap radar: enemy dots relative to where you're FACING */
  updateRadar() {
    const g = this.game;
    const cv = $('radar');
    const active = (g.state === 'COMBAT' || g.state === 'COUNTDOWN') && !g.casino.roundMods.noIndicator;
    cv.classList.toggle('hidden', !active);
    if (!active) return;

    const ctx = cv.getContext('2d');
    const cx = cv.width / 2, cy = cv.height / 2;
    const R = cv.width / 2 - 4;
    const RANGE = 32;                       // meters shown edge to edge
    const scale = R / RANGE;
    ctx.clearRect(0, 0, cv.width, cv.height);

    // dish
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8, 5, 16, 0.72)'; ctx.fill();
    ctx.strokeStyle = 'rgba(201,162,39,0.7)'; ctx.lineWidth = 2; ctx.stroke();
    for (const rr of [R * 0.33, R * 0.66]) {
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(201,162,39,0.18)'; ctx.lineWidth = 1; ctx.stroke();
    }

    const fwd = g.player.forwardFlat();
    const right = g.player.rightFlat();
    // walls + closed doors, drawn in your facing frame and clipped to the dish
    const toScreen = (x, z) => {
      const rx = x - g.player.pos.x, rz = z - g.player.pos.z;
      return [cx + (rx * right.x + rz * right.z) * scale, cy - (rx * fwd.x + rz * fwd.z) * scale];
    };
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R - 1, 0, Math.PI * 2); ctx.clip();
    const px = g.player.pos.x, pz = g.player.pos.z;
    for (const b of g.arena.boxes) {
      if (b.h < 2 && b.door === undefined) continue;
      if (b.x1 < px - RANGE * 1.5 || b.x0 > px + RANGE * 1.5 || b.z1 < pz - RANGE * 1.5 || b.z0 > pz + RANGE * 1.5) continue;
      const pts = [toScreen(b.x0, b.z0), toScreen(b.x1, b.z0), toScreen(b.x1, b.z1), toScreen(b.x0, b.z1)];
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fillStyle = b.door !== undefined ? 'rgba(232,200,96,0.75)' : 'rgba(150,120,170,0.38)';
      ctx.fill();
    }
    // the automats + the wheel as little markers
    for (const pm of g.arena.perkMachines) {
      if (!g.arena.isZoneOpen(pm.zone)) continue;
      const [sx, sy] = toScreen(pm.pos.x, pm.pos.z);
      ctx.fillStyle = pm.def.color; ctx.globalAlpha = 0.9;
      ctx.fillRect(sx - 2.5, sy - 2.5, 5, 5);
      ctx.globalAlpha = 1;
    }
    const b6 = g.arena.bigSix;
    if (b6) { const [sx, sy] = toScreen(b6.pos.x, b6.pos.z); ctx.fillStyle = '#ffb04a'; ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();

    const dot = (worldPos, color, size, ring = false) => {
      const relX = worldPos.x - g.player.pos.x;
      const relZ = worldPos.z - g.player.pos.z;
      let sx = relX * right.x + relZ * right.z;   // facing-up projection
      let sy = relX * fwd.x + relZ * fwd.z;
      const d = Math.hypot(sx, sy);
      let alpha = 1;
      if (d > RANGE) {                            // clamp to the rim, dimmer
        sx *= RANGE / d; sy *= RANGE / d; alpha = 0.45;
      }
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(cx + sx * scale, cy - sy * scale, size, 0, Math.PI * 2);
      if (ring) { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke(); }
      else { ctx.fillStyle = color; ctx.fill(); }
      ctx.globalAlpha = 1;
    };

    const KIND_COLORS = {
      walker: '#ff4a4a', sprinter: '#ff7ad0', brute: '#ff8a3a',
      spitter: '#7aff4a', gasbag: '#d6ff4a', pitguard: '#8fa4ff', collector: '#ffd24a',
      croupier: '#e8ffe8', magician: '#c27aff', jackpot: '#ffe97a', showgirl: '#ff9ad0', king: '#ffffff',
    };
    for (const z of g.enemies.list) {
      if (z.dead) continue;
      dot(z.mesh.position, z.golden || (z.flags & 16) ? '#ffd24a' : (KIND_COLORS[z.kind] || '#ff4a4a'), z.golden ? 5 : z.kind === 'brute' ? 4 : 3);
    }
    for (const b of g.bosses) {
      if (!b.dead) dot(b.mesh.position, '#ff2d2d', 7, true);
    }
    // good things on the floor: Rare+ comps and commemorative chips show up as diamonds
    for (const q of g.pickups.list) {
      if (q.kind === 'collectible') dot(q.mesh.position, '#ffe8a0', 5, true);
      else if (q.kind === 'comp') { const r = RARITY[COMPS[q.key].rarity]; if (r.tier >= 2) dot(q.mesh.position, r.color, 4, true); }
    }
    // your partner
    if (g.net?.avatar) dot(g.net.avatar.root.position, '#7ae8ff', 4, true);

    // you: center dot + facing wedge (always up)
    ctx.fillStyle = '#e8e2d0';
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx, cy - 11); ctx.lineTo(cx - 4, cy - 4); ctx.lineTo(cx + 4, cy - 4);
    ctx.closePath();
    ctx.fillStyle = 'rgba(232,226,208,0.85)'; ctx.fill();
  }

  /** the drinks you're carrying, as little glowing badges over the health bar */
  updatePerks() {
    const g = this.game;
    const html = (g.perks?.owned || []).map((k) => {
      const d = DRINKS[k];
      return `<span class="perk" style="--c:${d.color}" title="${d.name}">${d.icon}</span>`;
    }).join('');
    const el = $('perk-hud');
    if (el && html !== this._perkHtml) { el.innerHTML = html; this._perkHtml = html; }
  }

  /** LADY LUCK's three parts under the health bar while you're collecting them */
  updateParts() {
    const w = this.game.wonder;
    const el = $('parts-hud');
    if (!el || !w) return;
    const show = !w.built ? w.parts.size > 0 : w.state === 'ready';
    el.classList.toggle('hidden', !show);
    if (!show) return;
    const html = '<span>🍀</span>' + Object.entries(PARTS).map(([k, d]) =>
      `<span class="pt${w.has(k) || w.built ? ' got' : ''}" style="color:${d.color}" title="${d.name}">${d.icon}</span>`).join('')
      + (w.complete || w.built ? '<span class="ready">TO THE CAGE</span>' : '');
    if (html !== this._partsHtml) { el.innerHTML = html; this._partsHtml = html; }
  }

  // ------------------------------ 1930s transitions -----------------------------
  /** animate the iris hole's radius (px) */
  _iris(from, to, ms, done) {
    const el = $('iris');
    el.style.display = 'block';
    const t0 = performance.now();
    cancelAnimationFrame(this._irisRaf);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      el.style.setProperty('--r', `${to}px`);
      if (to > from) el.style.display = 'none';
      done?.();
    };
    const step = () => {
      if (finished) return;
      const k = Math.min(1, (performance.now() - t0) / ms);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      el.style.setProperty('--r', `${from + (to - from) * e}px`);
      if (k < 1) this._irisRaf = requestAnimationFrame(step);
      else finish();
    };
    this._irisRaf = requestAnimationFrame(step);
    // and on a timer, so it always completes even if the page isn't being painted
    clearTimeout(this._irisTo);
    this._irisTo = setTimeout(finish, ms + 250);
  }
  _irisMax() { return Math.hypot(innerWidth, innerHeight) / 2 + 20; }
  /** iris closes on this scene, cb swaps what's behind, iris opens on the next (1930s only) */
  irisSwap(cb, ms = 520) {
    if (!STYLE.cartoon) { cb(); return; }
    this._iris(this._irisMax(), 0, ms, () => { cb(); setTimeout(() => this._iris(0, this._irisMax(), ms), 120); });
  }
  /** the picture opens out of a pinpoint (a round starts) */
  irisOpen(ms = 700) {
    if (!STYLE.cartoon) return;
    this._iris(0, this._irisMax(), ms);
  }
  /** the title card of this round's cartoon */
  titleCard(round, boss) {
    if (!STYLE.cartoon) return;
    const t = boss ? (round === 5 ? 'THE PIT BOSS PUNCHES IN' : round === 10 ? "THE HOUSE DEALER'S LAST HAND" : 'MANAGEMENT MAKES A HOUSE CALL')
      : CARTOON_TITLES[(round * 7 + Math.floor(Math.random() * 3)) % CARTOON_TITLES.length];
    $('tc-title').textContent = t;
    $('tc-round').textContent = `ROUND ${round}`;
    const el = $('title-card');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  /** [E] prompt for doors, automats, the wheel. lab: {title, sub, cost, action, icon, color} | null */
  interactPrompt(lab) {
    const el = $('interact-prompt');
    if (!lab) {
      if (this._ip) { el.classList.remove('show'); this._ip = null; }
      return;
    }
    const g = this.game;
    const can = lab.cost == null || g.chips >= lab.cost;
    const key = `${lab.title}|${lab.sub}|${lab.cost}|${can}`;
    if (key === this._ip) return;
    this._ip = key;
    const cost = lab.cost != null ? `<span class="ip-cost${can ? '' : ' poor'}"><i class="chip-icon"></i>${lab.cost}</span>` : '';
    const act = lab.cost != null || lab.action ? `<kbd>E</kbd>` : '';
    el.innerHTML = `<div class="ip-row">${act}<span class="ip-icon" style="--c:${lab.color || '#e8c860'}">${lab.icon || ''}</span>`
      + `<span class="ip-title">${lab.title}</span>${cost}</div><div class="ip-sub">${lab.sub || ''}</div>`;
    el.classList.add('show');
  }

  /** a camera flash in your own eyes */
  whiteout(amount) {
    const el = $('whiteout');
    const a = clamp(amount, 0, 1) * (this.game.settings.reducedFlash ? 0.35 : 0.95);
    if (a < 0.05) return;
    el.style.transition = 'none';
    el.style.opacity = a;
    clearTimeout(this._wo);
    this._wo = setTimeout(() => { el.style.transition = 'opacity 1.6s ease-out'; el.style.opacity = 0; }, 90);
  }

  hurtFlash(amount = 0.5) {
    const v = $('damage-vignette');
    this.hurtFlashUntil = performance.now() + 250;
    v.style.boxShadow = `inset 0 0 ${120 + amount * 80}px rgba(220,30,40,${0.35 + amount * 0.35})`;
    // blood on the lens: splashes in, then slowly runs off
    const b = $('blood-overlay');
    if (!b.style.backgroundImage) b.style.backgroundImage = `url(${bloodOverlayImage()})`;
    this._blood = Math.min(1, (this._blood || 0) + 0.25 + amount * 0.5);
    b.style.transform = `scale(${Math.random() < 0.5 ? -1 : 1}, ${Math.random() < 0.3 ? -1 : 1})`;
    b.style.transition = 'none';
    b.style.opacity = this._blood * (this.game.settings.reducedFlash ? 0.5 : 0.85);
    clearTimeout(this._bloodT);
    this._bloodT = setTimeout(() => {
      b.style.transition = 'opacity 2.2s ease-in';
      b.style.opacity = 0;
      this._blood = 0;
    }, 350);
  }

  /** red arc at the screen edge pointing to where a hit came from (angle: + = right) */
  damageFrom(angle) {
    const layer = $('dmg-dir');
    const el = document.createElement('div');
    el.className = 'dmg-arc';
    el.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  hitmarker(crit = false) {
    const h = $('hitmarker');
    h.className = crit ? 'crit show' : 'show';
    clearTimeout(this._hm);
    this._hm = setTimeout(() => { h.className = ''; }, 90);
  }

  reloadBar(t) {
    const bar = $('reload-bar');
    if (t === null) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    $('reload-fill').style.width = `${t * 100}%`;
  }

  crosshairSpread(px) {
    const gap = Math.round(4 + px * 0.9);
    if (gap !== this._gap) { $('crosshair').style.setProperty('--gap', `${gap}px`); this._gap = gap; }
  }

  // --------------------------- text feedback --------------------------------
  banner(text, color = 'gold', ms = 1800) {
    const b = $('banner-el');
    b.textContent = text;
    b.className = `show ${color}`;
    clearTimeout(this._bt);
    this._bt = setTimeout(() => { b.className = ''; }, ms);
  }

  prompt(text, ms = 2200) {
    const p = $('prompt');
    p.textContent = text;
    p.classList.add('show');
    clearTimeout(this._pt);
    this._pt = setTimeout(() => p.classList.remove('show'), ms);
  }

  countdown(n) {
    const c = $('countdown-el');
    c.textContent = n > 0 ? n : 'FIGHT';
    c.className = 'show';
    Audio.play(n > 0 ? 'countdown' : 'go');
    clearTimeout(this._ct);
    this._ct = setTimeout(() => { c.className = ''; }, 800);
  }

  /** floating text at a world position (chips, damage numbers) */
  floatText(worldPos, text, cls = 'chips') {
    const v = worldPos.clone().project(this.game.camera);
    if (v.z > 1) return; // behind camera
    const el = document.createElement('div');
    el.className = `floater ${cls}`;
    el.textContent = text;
    el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
    el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
    $('float-layer').appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  /** edge arrows pointing at off-screen enemies (disabled by a penalty) */
  updateThreatIndicator() {
    const layer = $('threat-layer');
    layer.innerHTML = '';
    const g = this.game;
    if (g.state !== 'COMBAT' || g.casino.roundMods.noIndicator) return;
    const fwd = g.player.forwardFlat();
    let worst = null, worstD = 1e9;
    const threats = [...g.enemies.list, ...g.bosses.filter((b) => !b.dead)];
    for (const e of threats) {
      const d = e.mesh.position.distanceTo(g.player.pos);
      if (d < worstD) { worstD = d; worst = e; }
    }
    if (!worst || worstD > 30) return;
    const to = worst.mesh.position.clone().sub(g.player.pos); to.y = 0; to.normalize();
    const cross = fwd.x * to.z - fwd.z * to.x;
    const dot = fwd.x * to.x + fwd.z * to.z;
    if (dot > 0.5) return; // roughly on screen
    const arrow = document.createElement('div');
    arrow.className = 'threat-arrow';
    arrow.textContent = '⮜';
    const side = cross > 0 ? 'left' : 'right';
    arrow.style[side] = '30px';
    arrow.style.top = '50%';
    if (side === 'right') arrow.style.transform = 'translateY(-50%) rotate(180deg)';
    else arrow.style.transform = 'translateY(-50%)';
    layer.appendChild(arrow);
  }

  // ------------------------------ settings ----------------------------------
  _wireSettings() {
    const g = this.game;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('hotu_settings') || '{}'); } catch { /* defaults */ }
    g.settings = {
      sensitivity: saved.sensitivity ?? 1,
      master: saved.master ?? 0.8,
      music: saved.music ?? 0.5,
      sfx: saved.sfx ?? 0.9,
      reducedFlash: saved.reducedFlash ?? false,
      quality: saved.quality ?? (g.gpuStrong ? 'ultra' : 'high'),
      fov: saved.fov ?? CONFIG.player.fov,
      artStyle: saved.artStyle ?? '1930s',
      ultraOffer: saved.ultraOffer ?? false,
    };
    // Ultra arrived after some saves already said 'high': upgrade those once on a
    // strong card (the frame-rate watchdog still steps it back if it struggles)
    if (g.gpuStrong && !g.settings.ultraOffer) {
      g.settings.ultraOffer = true;
      if (g.settings.quality === 'high') g.settings.quality = 'ultra';
      try { localStorage.setItem('hotu_settings', JSON.stringify(g.settings)); } catch { /* private mode */ }
    }
    $('set-art').value = g.settings.artStyle;
    // the art style rewrites the shaders: save, then reload into the new look
    $('set-art').addEventListener('change', () => {
      g.settings.artStyle = $('set-art').value;
      this.saveSettings();
      location.reload();
    });
    $('set-sensitivity').value = g.settings.sensitivity;
    $('set-master').value = g.settings.master;
    $('set-music').value = g.settings.music;
    $('set-sfx').value = g.settings.sfx;
    $('set-reduced-flash').checked = g.settings.reducedFlash;
    $('set-quality').value = g.settings.quality;
    $('set-fov').value = g.settings.fov;
    $('fov-val').textContent = g.settings.fov + '°';

    const apply = () => {
      g.settings.sensitivity = parseFloat($('set-sensitivity').value);
      g.settings.master = parseFloat($('set-master').value);
      g.settings.music = parseFloat($('set-music').value);
      g.settings.sfx = parseFloat($('set-sfx').value);
      g.settings.reducedFlash = $('set-reduced-flash').checked;
      g.settings.fov = parseInt($('set-fov').value, 10);
      $('fov-val').textContent = g.settings.fov + '°';
      const q = $('set-quality').value;
      if (q !== g.settings.quality) {
        g.settings.quality = q;
        if (g.applyQuality) g.applyQuality(q);
      }
      Audio.setVolumes(g.settings.master, g.settings.sfx, g.settings.music);
      this.saveSettings();
    };
    for (const id of ['set-sensitivity', 'set-master', 'set-music', 'set-sfx', 'set-reduced-flash', 'set-fov', 'set-quality']) {
      $(id).addEventListener('input', apply);
      $(id).addEventListener('change', apply);
    }
    $('btn-fullscreen').onclick = () => window.HOTU_toggleFullscreen?.();
    apply();
  }

  saveSettings() {
    const g = this.game;
    try { localStorage.setItem('hotu_settings', JSON.stringify(g.settings)); } catch { /* private mode */ }
    const q = $('set-quality');
    if (q && q.value !== g.settings.quality) q.value = g.settings.quality;
  }

  // ----------------------------- high score ---------------------------------
  loadHighscore() {
    try { return JSON.parse(localStorage.getItem(HS_KEY) || 'null') || { bestRound: 0, bestChips: 0, wins: 0, runs: 0 }; }
    catch { return { bestRound: 0, bestChips: 0, wins: 0, runs: 0 }; }
  }

  // ------------------------- one more run: the payoff -------------------------
  /** what this run earned, what it unlocked, and what you're closest to next */
  _summaryProgress() {
    const g = this.game, P = g.progress;
    P.bump('runs');
    P.record('round', g.round, `Best round — ${g.round}`);
    P.record('combo', g.stats.bestCombo, `Best streak — ×${g.stats.bestCombo}`);
    P.record('chips', g.chips, `Most chips held — ${g.chips}`);
    P.record('jackpots', g.rewards.payouts, `Most progressive jackpots — ${g.rewards.payouts}`);
    P.save();
    const run = P.run;
    const n0 = P.toNext(run.startXp), n1 = P.toNext();
    const tiered = n1.i > n0.i;
    const lines = Object.entries(run.lines).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span>${k} <b>+${v}</b></span>`).join('');
    const item = (icon, text, cls = '') => `<div class="sp-item ${cls}"><span>${icon}</span>${text}</div>`;
    let html = `<div class="sp-card" style="--c:${n1.cur.color}">
      <div class="sp-head"><span class="sp-tier">🎟 ${n1.cur.name}</span><span class="sp-xp">+${run.xp} XP</span></div>
      <div class="sp-bar"><i id="sp-fill" style="width:${tiered ? 0 : n0.frac * 100}%"></i></div>
      <div class="sp-next">${n1.next ? `<b>${n1.need - n1.into} XP</b> to <b style="color:${n1.next.color}">${n1.next.name}</b> — ${n1.next.perk}` : 'The house knows your name. There is no higher card.'}</div>
      <div class="sp-lines">${lines || '<span>Kill something next time!</span>'}</div>
    </div>`;
    if (run.unlocked.length || run.found.length || run.records.length) {
      html += '<div class="sp-sec"><h4>THIS RUN</h4>'
        + run.unlocked.map((u) => item(u.icon, u.text, 'gold')).join('')
        + run.found.map((f) => item('⛁', `Found ${f}`, 'gold')).join('')
        + run.records.map((r) => item('★', `NEW BEST: ${r}`, 'cyan')).join('')
        + '</div>';
    }
    const close = P.closest(3);
    if (close.length) {
      html += '<div class="sp-sec"><h4>SO CLOSE</h4>' + close.map(({ m, have, frac }) =>
        `<div class="sp-mk"><div><b>${m.name}</b> <em>${m.desc}</em></div><div class="sp-mbar"><i style="width:${frac * 100}%"></i><span>${have} / ${m.goal}</span></div></div>`).join('') + '</div>';
    }
    // the hook: the single most reachable next thing
    let hook = '';
    const top = close[0];
    if (n1.next && n1.need - n1.into <= Math.max(60, run.xp)) hook = `One more run gets you to <b>${n1.next.name}</b>: ${n1.next.perk}.`;
    else if (top && top.frac >= 0.6) hook = `<b>${top.m.name}</b> is ${top.have} / ${top.m.goal} — one more run could do it.`;
    else hook = `${P.data.collection.length} / ${CHIPS.length} commemorative chips found. Somewhere on the floor, something is glinting…`;
    html += `<div class="sp-hook">${hook}</div>`;
    $('summary-progress').innerHTML = html;
    setTimeout(() => { const f = $('sp-fill'); if (f) f.style.width = `${n1.frac * 100}%`; }, 350);
    if (tiered) Audio.play('level_up');
  }

  /** the loyalty card on the main menu */
  renderLoyalty() {
    const P = this.game.progress, el = $('menu-loyalty');
    if (!P || !el) return;
    const n = P.toNext();
    const done = Object.keys(P.data.markers).length;
    el.innerHTML = `<div class="ml-card" style="--c:${n.cur.color}"><b>🎟 ${n.cur.name}</b>`
      + `<div class="ml-bar"><i style="width:${n.frac * 100}%"></i></div>`
      + `<span>${n.next ? `${n.need - n.into} XP to ${n.next.name}` : 'Top of the house'}</span></div>`
      + `<div class="ml-sub">🏆 ${done} / ${MARKERS.length} markers · ⛁ ${P.data.collection.length} / ${CHIPS.length} chips</div>`;
  }

  /** everything you're chasing, on one page */
  renderMarkers() {
    const P = this.game.progress;
    const ti = P.tierIndex();
    const ladder = LOYALTY.map((t, i) => `<div class="mk-tier${i <= ti ? ' got' : ''}${i === ti ? ' now' : ''}" style="--c:${t.color}"><b>${t.name}</b><span>${t.xp} XP</span><em>${t.perk}</em></div>`).join('');
    const marks = MARKERS.map((m) => {
      const done = !!P.data.markers[m.id];
      const have = Math.min(m.goal, P.stat(m.stat));
      return `<div class="mk${done ? ' done' : ''}"><div><b>${done ? '🏆' : '◻'} ${m.name}</b><em>${m.desc}</em></div>`
        + `<div class="sp-mbar"><i style="width:${(have / m.goal) * 100}%"></i><span>${done ? 'DONE' : `${have} / ${m.goal}`}</span></div><small>+${m.xp} XP</small></div>`;
    }).join('');
    const chips = CHIPS.map((c) => (P.hasChip(c.id)
      ? `<div class="mk-chip got" style="--c:${c.color}"><i></i><span>${c.name}</span></div>`
      : '<div class="mk-chip"><i></i><span>? ? ?</span></div>')).join('');
    const b = P.data.best;
    $('markers-body').innerHTML = `
      <h4>THE LOYALTY CARD — ${P.data.xp} XP</h4><div class="mk-ladder">${ladder}</div>
      <h4>THE COMMEMORATIVE CHIP SET — ${P.data.collection.length} / ${CHIPS.length}</h4>
      <p class="dim small">They glint on the floor now and then — follow the light — and Golden Gamblers sometimes carry one.</p>
      <div class="mk-chips">${chips}</div>
      <h4>MARKERS — ${Object.keys(P.data.markers).length} / ${MARKERS.length}</h4><div class="mk-grid">${marks}</div>
      <h4>RECORDS</h4><div class="mk-records">
        <span>Best round <b>${b.round || 0}</b></span><span>Best streak <b>×${b.combo || 0}</b></span>
        <span>Most chips <b>${b.chips || 0}</b></span><span>Most jackpots <b>${b.jackpots || 0}</b></span>
        <span>Runs <b>${P.stat('runs')}</b></span><span>Zombies <b>${P.stat('kills')}</b></span></div>`;
  }

  saveRunResult(won, round, chips, kills) {
    const hs = this.loadHighscore();
    hs.runs += 1;
    if (won) hs.wins += 1;
    hs.bestRound = Math.max(hs.bestRound, round);
    hs.bestChips = Math.max(hs.bestChips, chips);
    hs.totalKills = (hs.totalKills || 0) + kills;
    try { localStorage.setItem(HS_KEY, JSON.stringify(hs)); } catch { /* private mode */ }
    this.renderHighscore();
  }

  renderHighscore() {
    const hs = this.loadHighscore();
    $('highscore-display').textContent = hs.runs
      ? `BEST: Round ${hs.bestRound} · ${hs.bestChips} chips · ${hs.wins} win${hs.wins === 1 ? '' : 's'} in ${hs.runs} runs`
      : 'No runs yet. The house is waiting.';
  }

  // ------------------------------ summary -----------------------------------
  showSummary(won, cause) {
    const g = this.game;
    $('summary-title').textContent = won ? 'YOU BEAT THE HOUSE' : 'THE HOUSE WINS';
    $('summary-title').className = won ? 'gold' : 'red';
    $('summary-cause').textContent = cause;
    $('summary-stats').innerHTML = `
      <div>Rounds survived: <b>${g.round}</b> / ${CONFIG.rounds}</div>
      <div>Zombies destroyed: <b>${g.stats.kills}</b></div>
      <div>Headshots: <b>${g.stats.headshots}</b></div>
      <div>Best combo: <b>x${g.stats.bestCombo}</b></div>
      <div>Chips at the end: <b>${g.chips}</b></div>
      <div>Chips gambled: <b>${g.stats.gambled}</b> · Wagers won: <b>${g.stats.wagersWon}</b></div>
      <div class="gold vault-line">🏦 Vault deposit: <b>+${(() => {
        const rate = Math.min(0.5, 0.2 + 0.02 * g.round + (won ? 0.1 : 0));
        const dep = Math.round(g.chips * rate);
        g.vault.deposit(dep);
        g.clearSave();
        this._lastDeposit = { dep, rate };
        return dep;
      })()}</b> chips (${Math.round(this._lastDeposit.rate * 100)}% cut) — vault holds ${g.vault.banked}</div>`;
    if (g.mode === 'daily') {
      const score = g.dailyScore();
      $('summary-stats').innerHTML += `<div class="cyan">⚡ DAILY SCORE: <b>${score}</b> — new seed at midnight</div>`;
      g._endDailyMode(score);
    }
    this.saveRunResult(won, g.round, g.chips, g.stats.kills);
    g.rewards.clearPresentation();
    this._summaryProgress();
    g._refreshMenu();
    this.hideAllPanels();
    this.show('summary-panel');
  }
}
