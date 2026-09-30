// game.js — the orchestrator. Owns THREE scene/camera/renderer, the state
// machine, the round loop, chips + the NEW combo multiplier, boss spawns,
// menus, and the render loop.

import * as THREE from 'three';

import { CONFIG, clamp } from './config.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { Player } from './player.js';
import { Arena } from './arena.js';
import { Pickups } from './pickups.js';
import { Weapons } from './weapons.js';
import { Enemies } from './enemies.js';
import { Casino } from './casino.js';
import { Upgrades } from './upgrades.js';
import { Effects } from './effects.js';
import { Vault } from './vault.js';
import { PitBoss, HouseDealer } from './bosses.js';
import { Equipment } from './equipment.js';
import { Perks } from './perks.js';
import { BigSix } from './bigsix.js';
import { CoatCheck } from './coatcheck.js';
import { Wonder } from './wonder.js';
import { AllIn } from './allin.js';
import { Net } from './net.js';
import { Rewards } from './rewards.js';
import { Progress } from './progress.js';
import { ZONES } from './arena.js';
import { LETHALS, TACTICALS } from './catalog.js';
import { Seed } from './rng.js';
import { makeEnvironment } from './gfx/env.js';
import { STYLE } from './gfx/style.js';
import { PostFX } from './gfx/postfx.js';
import { Character } from './chars/character.js';
import { skinFor, variantsOf, LOOKS } from './chars/skins.js';
import { bodyFor } from './chars/rig.js';

const $ = (id) => document.getElementById(id);

// special round modifiers — rolled on non-boss rounds 3+ (40% chance)
const SPECIAL_ROUNDS = [
  { name: 'HIGH STAKES', desc: 'Double chips. Half mercy.', minRound: 3,
    mods: { dmgMult: 1.5 }, chipMult: 2 },
  { name: 'BLACKOUT', desc: 'The power is out. They can smell you.', minRound: 3,
    mods: { lowLight: true, speedMult: 1.1 }, chipMult: 1.25 },
  { name: 'RUSH HOUR', desc: 'Valet shift change. All of them. At once.', minRound: 3,
    mods: { onlyKinds: ['sprinter'], countMult: 1.45 }, chipMult: 1.5 },
  { name: 'HEAVYWEIGHT NIGHT', desc: 'The big boys are on shift.', minRound: 6,
    mods: { heavyMix: true, countMult: 0.7 }, chipMult: 1.6 },
  { name: 'VIP NIGHT', desc: 'Every guest is a whale. Golden. Dangerous.', minRound: 5,
    mods: { elite: true, countMult: 0.65 }, chipMult: 2 },
  { name: 'CHORUS LINE', desc: 'The midnight show never ended. Here come the dancers.', minRound: 3,
    mods: { onlyKinds: ['showgirl'], countMult: 1.2 }, chipMult: 1.5 },
];

// optional round objectives — complete for a bonus, no penalty for missing
const OBJECTIVES = [
  { key: 'headhunter', label: (o) => `◎ HEADHUNTER — ${o.progress}/8 headshots`, goal: 8,
    reward: (g) => { g.addChips(120); return '+120 chips'; } },
  { key: 'untouchable', label: (o) => o.failed ? '✗ UNTOUCHABLE — failed' : '◎ UNTOUCHABLE — take no damage', goal: 0,
    reward: (g) => { g.addChips(150); g.player.heal(15); return '+150 chips, +15 HP'; } },
  { key: 'demolition', label: (o) => `◎ DEMOLITION DERBY — ${o.progress}/6 explosion kills`, goal: 6,
    reward: (g) => {
      g.player.grenades = Math.min(g.lethalMax(), g.player.grenades + 2);
      g.addChips(80); return '+2 lethals, +80 chips';
    } },
  { key: 'speedclear', label: (o) => `◎ SPEED CLEAR — ${Math.max(0, Math.ceil(60 - o.time))}s left`, goal: 0,
    reward: (g) => { g.addChips(100); return '+100 chips'; } },
];

export class Game {
  constructor() {
    // --- three.js core ---
    const canvas = document.getElementById('game-canvas');
    let savedQ = 'high';
    try { savedQ = JSON.parse(localStorage.getItem('hotu_settings') || '{}').quality || 'high'; } catch { /* default */ }
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: savedQ === 'low', powerPreference: 'high-performance', stencil: false });
    this.renderer.setSize(innerWidth, innerHeight);
    // a real graphics card (not the laptop's built-in chip) gets Ultra by default
    try {
      const gl = this.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      this.gpuName = name;
      this.gpuStrong = /GeForce|RTX|Quadro|Radeon (RX|Pro)|Arc\(TM\) A|Arc A/i.test(name) && !/SwiftShader|Basic Render|llvmpipe/i.test(name);
    } catch { this.gpuStrong = false; }
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;   // used when post-fx is off
    this.renderer.toneMappingExposure = 1.15;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CONFIG.player.fov, innerWidth / innerHeight, 0.1, 200);
    this.scene.add(this.camera);
    // image-based lighting so metal, leather and satin actually reflect
    this.scene.environment = makeEnvironment(this.renderer);
    this.envIntensity = 0.22;
    this.scene.environmentIntensity = this.envIntensity;
    this.post = new PostFX(this.renderer);

    // first-person overlay: the gun + hands render in their own pass on top
    this.vmScene = new THREE.Scene();
    this.vmScene.environment = this.scene.environment;
    this.vmScene.environmentIntensity = 1.25;
    this.vmCamera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.01, 6);
    this.vmHemi = new THREE.HemisphereLight(0xc8b0ff, 0x241018, 1.1);
    const vmKey = new THREE.DirectionalLight(0xffe0c0, 2.4);     // from behind-left of the eye
    vmKey.position.set(-0.4, 0.9, 0.7);
    const vmRim = new THREE.DirectionalLight(0x27e6ff, 0.9);
    vmRim.position.set(1, 0.3, -0.6);
    this.vmScene.add(this.vmHemi, vmKey, vmRim);

    // --- game state ---
    this.state = 'MENU';
    this.round = 0;
    this.chips = 0;
    this.debug = { invuln: false, forceBJ: null, forceRoulette: null, show: false };
    this.settings = {};   // populated by UI
    this.stats = this._freshStats();
    this.combo = 0;
    this.comboT = 0;
    this.bosses = [];
    this._countdownT = 0;
    this.specialRound = null;
    this.playerMods = this._freshPlayerMods();

    // --- systems (order matters: ui first for settings) ---
    this.net = new Net(this);             // co-op: room codes, the partner, the puppets
    this.ui = new UI(this);
    this.player = new Player(this);
    this.arena = new Arena(this);
    this.pickups = new Pickups(this);
    this.weapons = new Weapons(this);
    this.enemies = new Enemies(this);
    this.casino = new Casino(this);
    this.upgrades = new Upgrades(this);
    this.effects = new Effects(this);
    this.vault = new Vault(this);
    this.vice = 'none';
    this.equipment = new Equipment(this);
    this.perks = new Perks(this);
    this.bigSix = new BigSix(this);
    this.coatCheck = new CoatCheck(this);
    this.progress = new Progress(this);   // the loyalty card, markers, the chip set
    this.rewards = new Rewards(this);     // comps, streak tiers, the progressive, surprises
    this.wonder = new Wonder(this);       // LADY LUCK, built from three parts
    this.allIn = new AllIn(this);         // the house's pack-a-punch
    this.loadout = null;
    this._interactables = null;
    this.interactTarget = null;
    this.shakeAmp = 0;
    this.slowmoT = 0;
    this._audioMeterT = 0;
    this._fwd = new THREE.Vector3();
    this.dashBuffT = 0;
    this.objective = null;
    this.mode = 'normal';           // 'normal' | 'coop'
    this.beatHouse = false;         // cleared round 10 this run -> endless floor
    this.grudge = this._loadGrudge();

    this._wireMenus();
    this._refreshMenu();
    this.applyQuality(this.settings.quality || 'high');
    this.menuActors = [];
    this._menuT = 0;
    addEventListener('resize', () => {
      this.renderer.setSize(innerWidth, innerHeight);
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.vmCamera.aspect = innerWidth / innerHeight;
      this.vmCamera.updateProjectionMatrix();
    });

    // --- loop ---
    this.clock = new THREE.Clock();
    this._errCount = 0;
    this.renderer.setAnimationLoop(() => {
      // crash guard: a single bad frame should never hard-freeze the game
      try {
        this._tick();
        this._errCount = 0;
      } catch (err) {
        this._errCount++;
        console.error('[HOTU] frame error:', err);
        if (this._errCount > 60) {
          // something is genuinely broken — bail to menu instead of freezing
          this.renderer.setAnimationLoop(null);
          alert('HOUSE OF THE UNDEAD hit a fatal error — check the console (F12). ' + err.message);
        }
      }
    });
  }

  _freshStats() {
    return { kills: 0, headshots: 0, bestCombo: 0, gambled: 0, wagersWon: 0 };
  }

  _freshPlayerMods() {
    return {
      speed: 1,        // Running Shoes
      dashCd: 1,       // Quick Hands
      meleeDmg: 1,     // Steel Toe
      magnet: 1,       // Chip Magnet
      roundArmor: 0,   // Casino Insurance
      interest: 0,     // Card Counter: chips every intermission
      // per-run copies of values legendary cards used to mutate on CONFIG —
      // that leaked across runs (Demolition/Marked Cards were permanent). Fixed.
      lethalBonus: 0,       // extra lethal capacity (Deep Pockets, Demolition License)
      headshotBonus: CONFIG.chips.headshotBonus,
      // cursed upgrades (power with a downside)
      dmgAllMult: 1,        // Blood Pact
      critAdd: 0,           // Glass Cannon
      chipPickupMult: 1,    // Loaded Dice
      hitChipLoss: 0,       // Loaded Dice downside
      armorDisabled: false, // Glass Cannon downside
      reloadHpCost: 0,      // Devil's Reload
      markerDebt: 0,        // House Marker: next penalty upgraded
      // synergy attachments
      dashDamage: false,    // Dash & Cash
      critGrenade: false,   // Crit Comptroller
      chipHeal: false,      // Vampire Chips
      lastBullet: false,    // Last Call
      comboWindowAdd: 0,    // Combo Insurance
    };
  }

  // ------------------------------ equipment caps ------------------------------
  lethalMax() {
    const d = LETHALS[this.player.lethalId] || LETHALS.chipbomb;
    return d.max + this.playerMods.lethalBonus + (this.vice === 'packrat' ? 1 : 0);
  }
  tacticalMax() {
    const d = TACTICALS[this.player.tacticalId];
    return d ? d.max + (this.vice === 'packrat' ? 1 : 0) : 0;
  }

  /** swap in a different lethal/tactical (the shop): the count starts over */
  setLethal(id, count) {
    const p = this.player;
    if (p.lethalId !== id) { p.lethalId = id; p.grenades = 0; }
    p.grenades = Math.min(this.lethalMax(), p.grenades + count);
    this.ui.updateHUD();
  }
  setTactical(id, count) {
    const p = this.player;
    if (p.tacticalId !== id) { p.tacticalId = id; p.tacticals = 0; }
    p.tacticals = Math.min(this.tacticalMax(), p.tacticals + count);
    this.ui.updateHUD();
  }

  // --------------------------------- co-op -----------------------------------
  /** the nearest player still on their feet (sticky for a moment so they don't dither) */
  targetFor(e) {
    const p = this.player;
    if (!this.net.isHost) return p;
    const r = this.net.remote;
    if (!r.alive) return p;
    if (!p.alive) return r;
    const now = performance.now();
    if (!e._tgt || now > (e._tgtUntil || 0)) {
      const pos = e.mesh.position;
      const dp = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z), dr = Math.hypot(r.pos.x - pos.x, r.pos.z - pos.z);
      e._tgt = dr < dp * 0.9 ? 'r' : 'p';
      e._tgtUntil = now + 600 + Math.random() * 400;
    }
    return e._tgt === 'r' ? r : p;
  }

  /** every player the horde can still hurt */
  alivePlayers() {
    const out = this.player.alive ? [this.player] : [];
    if (this.net.isHost && this.net.remote.alive) out.push(this.net.remote);
    return out;
  }

  /** kill money straight into your pocket (co-op pays the shooter, no racing for stacks) */
  awardChips(amount, pos) {
    const amt = Math.round(amount * this.comboMult() * this.playerMods.chipPickupMult
      * (this.perkFx?.chipMult || 1) * (this.vice === 'hustler' ? 1.25 : 1));
    this.addChips(amt);
    if (this.playerMods.chipHeal) this.player.heal(Math.floor(amt / 25));
    Audio.play('chip');
    if (pos) this.ui.floatText(pos.clone().setY(1.6), `+${amt}`, 'chips');
  }

  /** both sides: a co-op run starts (the host deals; the guest waits for round 1) */
  coopNewRun(seed = '') {
    this.mode = 'coop';
    Seed.begin(seed);                            // both of you are dealt from the host's seed
    this.ui.hide('coop-panel');
    this.ui.hide('main-menu');
    this._resetRun(true, this.coatCheck.current());
    this.net.resetRun();
    this.progress.bump('coopRuns');
    if (this.net.isGuest) {
      this.player.pos.x += 1.6;                  // don't stand in each other
      this.round = 0;
      this.setState('INTERMISSION');
    } else {
      this.round = 1;
      this.beginRound();
    }
  }

  /** the boss title card (both sides) */
  _bossIntro(bossKind, then) {
    const final = bossKind === 'housedealer';
    const grudgeN = this.grudge[bossKind] || 0;
    $('boss-intro-title').textContent = final ? 'THE HOUSE DEALER' : 'THE PIT BOSS';
    $('boss-intro-sub').textContent = this.round > CONFIG.finalRound
      ? `Endless floor, round ${this.round}. Management is upset.${grudgeN ? ` And they remember you — ${grudgeN} debt${grudgeN === 1 ? '' : 's'} unpaid.` : ''}`
      : (final
        ? `Round 10. The house always wins. Prove it wrong.${grudgeN ? ` (He's beaten you ${grudgeN} time${grudgeN === 1 ? '' : 's'}.)` : ''}`
        : `Round 5. He handles "problem players" personally.${grudgeN ? ` You two have history — ${grudgeN} loss${grudgeN === 1 ? '' : 'es'}.` : ''}`);
    this.ui.hideAllPanels();
    this.ui.show('boss-intro');
    Audio.play('boss_phase');
    setTimeout(() => { this.ui.hide('boss-intro'); then(); }, 2200);
  }

  /** guest: the host started a round */
  guestBeginRound(m) {
    this.ui.hideAllPanels();
    this.ui.prompt('', 1);
    this.casino.timerRunning = false;
    this.casino.consumeMods();                 // our own boons/penalties are spent (the horde is the host's)
    this.round = m.round;
    this.specialRound = m.special || null;
    this.objective = null;
    if (!m.boss && this.round >= 2 && Seed.random('rounds') < 0.5) {
      const def = Seed.pick('rounds', OBJECTIVES);
      this.objective = { def, progress: 0, failed: false, time: 0, startHeadshots: this.stats.headshots };
    }
    this.arena.setLowLight(!!m.lowLight);
    this.rewards.hitThisRound = false;
    this.net.clearPuppets();
    this.pickups.clear();
    if (this.playerMods.roundArmor > 0) this.player.addArmor(this.playerMods.roundArmor);
    if (m.boss) this._bossIntro(m.boss, () => this._startCountdown());
    else {
      this._startCountdown();
      if (this.specialRound) {
        this.ui.banner(`★ ${this.specialRound.name} ★ — ${this.specialRound.desc}`, 'gold', 3000);
        Audio.play('warn');
      }
    }
  }

  // ------------------------------- interaction -------------------------------
  /** doors, automats, the wheel — rebuilt each run */
  _buildInteractables() {
    const list = [];
    for (const d of this.arena.doors) {
      const z = d.def;
      list.push({
        pos: d.front, radius: 3.4, zone: 0,
        facing: d.front.clone().sub(d.frame.position).setY(0).normalize(),
        label: () => (d.open ? null : { title: `OPEN ${z.name}`, sub: `${z.sub} — pay the doorman`, cost: z.price, icon: '🚪', color: '#e8c860' }),
        cost: () => (d.open ? null : z.price),
        use: () => this.buyDoor(d),
      });
    }
    list.push(...this.perks.interactables());
    list.push(this.bigSix.interactable());
    list.push(...this.wonder.interactables());
    list.push(this.allIn.interactable());
    this._interactables = list;
  }

  buyDoor(d) {
    if (d.open) return;
    const price = d.def.price;
    if (this.chips < price) { Audio.play('dryfire'); this.ui.prompt(`The doorman wants ${price} chips`); return; }
    this.chips -= price;
    this.arena.openZone(d.zone);
    this.enemies.navT = 0;
    this.net.send({ t: 'door', zone: d.zone });          // co-op: it opens for both of you
    this.progress.max('doorsRun', this.arena.openZones().length);
    this.ui.banner(`${d.def.name} IS OPEN`, 'gold', 2400);
    Audio.play('chip');
    this.ui.updateHUD();
  }

  /** which interactable are you looking at? (nearest in reach, roughly facing it) */
  _updateInteract() {
    if (!this._interactables) this._buildInteractables();
    if (!this.player.alive) { this.interactTarget = null; this.ui.interactPrompt(null); return; }
    if (this.weapons.drinkT > 0) { this.interactTarget = null; this.ui.interactPrompt(null); return; }
    const p = this.player.pos, fwd = this.player.forwardFlat();
    let best = null, bd = 1e9;
    for (const it of this._interactables) {
      if (!this.arena.isZoneOpen(it.zone ?? 0)) continue;
      const dx = it.pos.x - p.x, dz = it.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > it.radius) continue;
      // face it (loosely) and stand on its front side
      if (d > 0.6 && (dx * fwd.x + dz * fwd.z) / d < 0.2) continue;
      if (it.facing && (-dx * it.facing.x - dz * it.facing.z) < -0.4) continue;
      const lab = it.label();
      if (!lab) continue;
      if (d < bd) { bd = d; best = { it, lab }; }
    }
    this.interactTarget = best;
    this.ui.interactPrompt(best ? best.lab : null);
  }

  tryInteract() {
    if (this.state !== 'COMBAT' && this.state !== 'COUNTDOWN') return;
    if (!this.player.alive) return;
    const t = this.interactTarget;
    if (!t) return;
    t.it.use();
    this._updateInteract();
  }

  // --------------------------- graphics quality -----------------------------
  /** 'ultra' = 2x supersampled + MSAA x4, 'high' = MSAA x4 + bloom, 'medium' = MSAA x2 + bloom, 'low' = direct render */
  applyQuality(q) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    // ultra draws every frame at up to twice the screen's resolution and scales
    // it down: glassy-smooth edges and crisp ink, for a proper graphics card
    this.renderer.setPixelRatio(q === 'ultra' ? Math.min(2, dpr * 2) : q === 'high' ? Math.min(dpr, 1.5) : q === 'medium' ? Math.min(dpr, 1) : Math.min(dpr, 0.85));
    this.post.enabled = STYLE.cartoon || q !== 'low';   // the 1930s look lives in the post pass
    this.post.bloomOn = q !== 'low';
    const msaa = q === 'ultra' || q === 'high' ? 4 : q === 'medium' ? 2 : 0;
    this.post.inkAA = q === 'ultra' || q === 'high';     // soften the stair-steps on the ink lines
    if (msaa !== this.post.msaa) { this.post.msaa = msaa; this.post.size.set(0, 0); }
    // real-time shadows from the chandelier spotlight (off on low)
    this.renderer.shadowMap.enabled = q !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.arena?.enableShadows(q !== 'low', q === 'ultra' ? 4096 : q === 'high' ? 2048 : 1024);
    this._perf = { t: 0, frames: 0, slow: 0, done: q === 'low' };
  }

  /** the corner readout: real frames a second (not the capped step), and ping */
  _countFrames() {
    const now = performance.now();
    const c = this._fpsCount || (this._fpsCount = { t0: now, n: 0 });
    c.n++;
    if (now - c.t0 < 500) return;
    const fps = Math.round(c.n * 1000 / (now - c.t0));
    c.t0 = now; c.n = 0;
    if (this.settings.showPerf) this.ui.updatePerf(fps, Math.round(this.net.ping), this.net.connected);
  }

  /** watch the frame rate in combat; step quality down once if it's struggling */
  _watchPerf(rawDt) {
    const p = this._perf;
    if (!p || p.done || this.state !== 'COMBAT') return;
    p.t += rawDt; p.frames++;
    if (p.t < 3) return;
    const fps = p.frames / p.t;
    p.t = 0; p.frames = 0;
    p.slow = fps < 38 ? p.slow + 1 : 0;
    if (p.slow >= 2) {
      const next = this.quality === 'ultra' ? 'high' : this.quality === 'high' ? 'medium' : 'low';
      this.settings.quality = next;
      this.ui.saveSettings?.();
      this.applyQuality(next);
      this.ui.prompt(`Graphics set to ${next.toUpperCase()} for smoother play (Settings to change)`, 3500);
      if (next === 'low') this._perf.done = true;
    }
  }

  // -------------------- loading + the main menu backdrop --------------------
  /** paint every character skin up front so nothing hitches mid-fight */
  async preload(onProgress = () => {}) {
    const kinds = Object.keys(LOOKS);
    const jobs = [];
    for (const k of kinds) {
      bodyFor(LOOKS[k].build, LOOKS[k].buildExtra || {});
      for (let v = 0; v < variantsOf(k); v++) jobs.push([k, v]);
    }
    const frame = () => new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < jobs.length; i++) {
      skinFor(jobs[i][0], jobs[i][1]);
      onProgress((i + 1) / (jobs.length + 2), `Dressing the ${jobs[i][0] === 'housedealer' ? 'house dealer' : jobs[i][0] === 'pitboss' ? 'pit boss' : jobs[i][0]}s…`);
      await frame();
    }
    this.arena.addShow();          // the dead chorus line on the lounge stage
    onProgress((jobs.length + 1) / (jobs.length + 2), 'Warming up the tables…');
    await frame();
    this._buildMenuActors();
    // compile every shader now instead of on first sight
    const warm = kinds.map((k) => new Character(k, { elite: k === 'walker' }));
    for (const c of warm) { c.root.position.set(0, -50, 0); this.scene.add(c.root); }
    this._placeMenuCamera(0);
    try { this.renderer.compile(this.scene, this.camera); } catch { /* fine */ }
    this._render();
    for (const c of warm) { this.scene.remove(c.root); c.dispose(); }
    onProgress(1, 'Doors open.');
  }

  _buildMenuActors() {
    this._clearMenuActors();
    const spots = [
      ['walker', -3.2, 1.2, 0.4], ['brute', 3.6, 0.2, -2.2], ['croupier', -1.4, -8.5, 0.9],
      ['sprinter', 5.2, -7.6, -1.2], ['gasbag', -5.6, -6.2, 2.4], ['magician', 1.8, 3.2, 3.0],
    ];
    for (const [kind, x, z, face] of spots) {
      const c = new Character(kind);
      c.root.position.set(x, 0, z);
      c.root.rotation.y = face;
      c.root.scale.setScalar(kind === 'brute' ? 1.2 : kind === 'gasbag' ? 1.1 : 1);
      c.menu = { home: new THREE.Vector3(x, 0, z), phase: Math.random() * 6, speed: kind === 'sprinter' ? 0.5 : 0.35 };
      this.scene.add(c.root);
      this.menuActors.push(c);
    }
  }

  _clearMenuActors() {
    for (const c of this.menuActors || []) { this.scene.remove(c.root); c.dispose(); }
    this.menuActors = [];
  }

  _placeMenuCamera(t) {
    const a = t * 0.05 + 0.6;
    // (1930s: in closer and lower, so the cartoon cast fills the frame behind the title)
    const R = STYLE.cartoon ? 9.5 : 14.5, h = STYLE.cartoon ? 2.1 : 3.1;
    this.camera.position.set(Math.sin(a) * R, h + Math.sin(t * 0.3) * 0.25, -4 + Math.cos(a) * R);
    this.camera.lookAt(0, STYLE.cartoon ? 0.95 : 1.3, -4);
  }

  _updateMenu(dt) {
    this._menuT += dt;
    this._placeMenuCamera(this._menuT);
    for (const c of this.menuActors) {
      // wander slow circles around their spot
      const m = c.menu;
      m.phase += dt * m.speed * 0.4;
      const target = m.home.clone().add(new THREE.Vector3(Math.cos(m.phase) * 1.2, 0, Math.sin(m.phase) * 1.2));
      const to = target.sub(c.root.position);
      const d = to.length();
      if (d > 0.01) {
        c.root.position.addScaledVector(to.normalize(), Math.min(d, m.speed * dt * 2));
        const want = Math.atan2(to.x, to.z);
        let dy = want - c.root.rotation.y;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        c.root.rotation.y += dy * Math.min(1, dt * 2);
      }
      c.update(dt, m.speed * 2);
    }
    this.arena.update(dt);
    this.effects.update(dt);
  }

  /** world, then the first-person overlay, through the post pipeline */
  _render() {
    const showVM = this.state === 'COMBAT' || this.state === 'COUNTDOWN' || this.state === 'PAUSED';
    this.weapons.vm.visible = showVM;
    this.vmHemi.intensity = this.arena.lowLight ? 0.25 : 1.1;
    // mostly neutral so the gun reads as steel, with a hint of the room's mood
    this.vmHemi.color.copy(this.arena.hemi.color).lerp(this._white || (this._white = new THREE.Color(0xfff4e8)), 0.78);
    const overlay = showVM ? { scene: this.vmScene, camera: this.vmCamera } : null;
    if (this.post.enabled) {
      this.post.render(this.scene, this.camera, performance.now() / 1000, overlay);
    } else {
      const r = this.renderer;
      r.setRenderTarget(null);
      r.render(this.scene, this.camera);
      if (overlay) {
        r.autoClear = false;
        r.clearDepth();
        r.render(overlay.scene, overlay.camera);
        r.autoClear = true;
      }
    }
  }

  // ------------------------------ state ------------------------------------
  setState(s) {
    if (s !== 'PAUSED') $('pause-menu')?.classList.add('hidden');
    this.state = s;
    document.body.dataset.state = s;     // CSS hides the HUD on the menu + summary
    if (s !== 'COMBAT' && s !== 'COUNTDOWN') $('radar')?.classList.add('hidden');
    if (s === 'COMBAT' || s === 'COUNTDOWN') this.ui.requestPointer();
    else if (document.pointerLockElement) document.exitPointerLock();
  }

  pause() {
    if (this.state !== 'COMBAT' && this.state !== 'COUNTDOWN') return;
    this._stateBeforePause = this.state;
    this.player.keys = {};
    this.setState('PAUSED');
    $('pause-seed').textContent = Seed.text;
    if (this.net.active) this.ui.prompt('Co-op keeps playing while you\'re paused!', 2500);
    this.ui.show('pause-menu');
  }

  resume() {
    this.ui.hide('pause-menu');
    this.setState(this._stateBeforePause || 'COMBAT');
  }

  // ------------------------------ chips + combo -----------------------------
  addChips(n) {
    if (this.specialRound && this.state === 'COMBAT') n = Math.round(n * this.specialRound.chipMult);
    this.chips += n;
    this.progress?.max('maxChips', this.chips);
    this.ui.updateHUD();
    if (this.state === 'INTERMISSION' || this.state === 'SLOTS') this.casino.updateChipsUI();
  }

  /** positional sound with cheap occlusion: muffled if cover blocks the line */
  audioAt(name, pos, bus = 'sfx') {
    const muffled = this.arena.lineBlocked(this.player.pos, pos);
    Audio.playAt(name, pos, { muffled, bus });
  }

  /** screen shake — amplitude decays exponentially */
  addShake(a) {
    this.shakeAmp = Math.min(0.45, this.shakeAmp + a);
  }

  /** brief slow motion (real-time seconds) */
  slowmo(seconds) {
    this.slowmoT = Math.max(this.slowmoT, seconds);
  }

  /** boss rounds: 5, 10, then every 5th in endless */
  isBossRound(r = this.round) {
    return r === CONFIG.minibossRound || r === CONFIG.finalRound
      || (r > CONFIG.finalRound && r % 5 === 0);
  }

  // ------------------------- boss grudges (persistent) ----------------------
  _loadGrudge() {
    try { return JSON.parse(localStorage.getItem('hotu_grudge_v1') || 'null') || { pitboss: 0, housedealer: 0 }; }
    catch { return { pitboss: 0, housedealer: 0 }; }
  }

  _saveGrudge() {
    try { localStorage.setItem('hotu_grudge_v1', JSON.stringify(this.grudge)); } catch { /* fine */ }
  }

  /** the streak's chip multiplier: 5 → ×1.5, 10 → ×2, 20 → ×2.5, 35 → ×3, 50 → ×3.5 */
  comboMult() {
    return this.rewards ? this.rewards.streakMult(this.combo) : 1;
  }

  onKill(zombie) {
    this.stats.kills++;
    this.combo++;
    if (zombie.kind === 'jackpot') {
      this.ui.banner('JACKPOT CASHED OUT!', 'gold', 2000);
      Audio.play('jackpot');
    }
    if (this.objective?.def.key === 'demolition' && zombie.lastCause === 'explosion') {
      this.objective.progress++;
    }
    // last kill of the round: brief slow-mo + shake
    const alive = this.enemies.list.filter((z) => !z.dead).length + this.enemies.spawnQueue.length;
    const bossesAlive = this.bosses.some((b) => !b.dead);
    if (alive === 0 && !bossesAlive && this.state === 'COMBAT') {
      this.slowmo(0.7);
      this.addShake(0.12);
    }
    this.comboT = CONFIG.chips.comboWindow + this.playerMods.comboWindowAdd;
    if (this.combo > this.stats.bestCombo) this.stats.bestCombo = this.combo;
    this.rewards.onKill(zombie, !!zombie._lastHitHead);        // streak tiers, the progressive, XP
  }

  // ------------------------------- run flow ---------------------------------
  /** loadout: a class from the Coat Check {primary, sidearm, lethal, tactical, vice} */
  _resetRun(applyPerks = true, loadout = null) {
    this.ui.hideAllPanels();
    this._clearMenuActors();
    this.loadout = { ...(loadout || this.loadout || this.coatCheck.current()) };
    this.vice = this.loadout.vice || 'none';
    this.beatHouse = false;
    this.stats = this._freshStats();
    this.playerMods = this._freshPlayerMods();
    this.chips = 0;
    this.combo = 0;
    this.specialRound = null;
    this.bosses.forEach((b) => { if (b.mesh) { this.scene.remove(b.mesh); b.char?.dispose(); } });
    this.bosses = [];
    this.perks.reset();
    this.player.reset();
    this.weapons.reset(this.loadout);
    this.enemies.clearAll();
    this.pickups.clear();
    this.effects.clear();
    this.equipment.clear();
    this.bigSix.reset();
    this.rewards.reset();
    this.progress.beginRun();
    this.wonder.reset();
    this.allIn.reset();
    this.arena.resetDoors();
    this._interactables = null;
    this.shakeAmp = 0;
    this.slowmoT = 0;
    this.casino.reset();
    this.upgrades.reset();
    this.arena.setRedAlert(false);
    this.arena.setLowLight(false);
    Audio.setBossMode(false);

    // ---- the class: equipment + vice ----
    const p = this.player;
    p.lethalId = LETHALS[this.loadout.lethal] ? this.loadout.lethal : 'chipbomb';
    p.tacticalId = TACTICALS[this.loadout.tactical] ? this.loadout.tactical : 'bellini';
    const pack = this.vice === 'packrat';
    p.grenades = pack ? this.lethalMax() : LETHALS[p.lethalId].start;
    p.tacticals = pack ? this.tacticalMax() : TACTICALS[p.tacticalId].start;
    if (this.vice === 'hustler') { p.maxHp -= 20; p.hp = p.maxHp; }

    // ---- vault perks: every run starts with what you've banked for ----
    if (applyPerks) {
      const v = this.vault;
      this.playerMods.lethalBonus += v.value('pockets', 0);
      p.grenades = Math.min(this.lethalMax(), p.grenades + v.value('pockets', 0));
      p.addArmor(v.value('kevlar', 0));
      this.chips = v.value('front', 0);
    }
    this.progress.applyRunPerks();       // the loyalty card's perks
    this.vaultStartChips = this.chips;   // Front Money can't be re-deposited (farm fix)
    this.ui.updatePerks?.();
  }

  /** straight in with the class picked at the Coat Check. seed: the one typed
      at the Coat Check, or blank for a fresh random one */
  newRun(loadout = null, seed = '') {
    if (this.net.active) {
      // co-op: the host re-deals for both; the guest waits for the host
      if (this.net.isHost) this.net.startRun(); else this.ui.prompt('The host deals the next game', 2500);
      return;
    }
    this.mode = 'normal';
    this.clearSave();
    Seed.begin(seed);
    this._resetRun(true, loadout);
    this.round = 1;
    this.beginRound();
    this.ui.prompt(`SEED ${Seed.text}${Seed.custom ? ' — your pick' : ''} · same seed, same deal`, 3200);
  }

  /** restart: a seed you typed in sticks; a random one is re-dealt */
  restartRun() { this.newRun(null, Seed.custom ? Seed.text : ''); }

  // ------------------------- mid-run save (localStorage) --------------------
  saveRun() {
    if (this.round < 1 || this.mode === 'coop') return;   // co-op lives on the host
    const arsenal = {};
    for (const [id, w] of Object.entries(this.weapons.arsenal)) {
      arsenal[id] = { mag: w.mag, reserve: w.reserve, mods: { ...w.mods }, packed: w.packed };
    }
    const p = this.player;
    const data = {
      v: 2,
      round: this.round,
      chips: this.chips,
      loadout: { ...this.loadout },
      player: {
        hp: p.hp, maxHp: p.maxHp - (this.perkFx?.hpBonus || 0),
        armor: p.armor, grenades: p.grenades, lethalId: p.lethalId,
        tacticalId: p.tacticalId, tacticals: p.tacticals,
      },
      playerMods: { ...this.playerMods },
      slots: [...this.weapons.slots],
      slot: this.weapons.slot,
      arsenal,
      drinks: [...this.perks.owned],
      daiquiris: this.perks.daiquiris,
      wonder: this.wonder.save(),
      openZones: this.arena.openZones(),
      upgradesOwned: { ...this.upgrades.owned },
      pendingMods: this.casino.pendingMods,
      houseCreditUsed: this.casino.houseCreditUsed,
      charms: { ...this.casino.charms },
      stats: { ...this.stats },
      vaultStartChips: this.vaultStartChips || 0,
      beatHouse: this.beatHouse,
      seed: Seed.save(),              // where every stream stands, so a continue deals the same cards
    };
    try { localStorage.setItem('hotu_run_save_v1', JSON.stringify(data)); } catch { /* private mode */ }
  }

  _loadSave() {
    try {
      const d = JSON.parse(localStorage.getItem('hotu_run_save_v1') || 'null');
      return d && d.v === 2 ? d : null;           // older saves predate classes
    } catch { return null; }
  }

  clearSave() {
    try { localStorage.removeItem('hotu_run_save_v1'); } catch { /* fine */ }
  }

  continueRun() {
    const d = this._loadSave();
    if (!d) return;
    this.mode = 'normal';
    Seed.restore(d.seed);
    this._resetRun(true, d.loadout);
    this.round = d.round;
    this.chips = d.chips;
    this.playerMods = { ...this._freshPlayerMods(), ...d.playerMods };
    const p = this.player;
    p.maxHp = d.player.maxHp;
    p.armor = d.player.armor;
    p.lethalId = d.player.lethalId || p.lethalId;
    p.grenades = d.player.grenades;
    p.tacticalId = d.player.tacticalId || p.tacticalId;
    p.tacticals = d.player.tacticals ?? p.tacticals;
    for (const [id, wd] of Object.entries(d.arsenal || {})) {
      const w = this.weapons.arsenal[id];
      if (!w) continue;
      w.mods = { ...w.mods, ...wd.mods };
      if (wd.packed) { w.packed = true; this.weapons.gild(id, true); }
      w.mag = wd.mag;
      w.reserve = wd.reserve;
    }
    this.weapons.slots = [...(d.slots || this.weapons.slots)];
    this.weapons.slot = d.slot ?? 1;
    this.weapons.currentId = this.weapons.slots[this.weapons.slot] || this.weapons.slots[1];
    this.perks.restore(d.drinks || [], d.daiquiris || 0);   // adds the stout's health back
    p.hp = Math.min(p.maxHp, d.player.hp);
    for (const z of d.openZones || []) this.arena.openZone(z, true);
    this.wonder.restore(d.wonder);
    this.weapons._refreshViewmodel();
    this.upgrades.owned = { ...d.upgradesOwned };
    this.casino.pendingMods = d.pendingMods || [];
    this.casino.charms = { luck: 0, insurance: 0, ...(d.charms || {}) };
    this.stats = { ...this._freshStats(), ...d.stats };
    this.vaultStartChips = d.vaultStartChips || 0;
    this.beatHouse = !!d.beatHouse;
    this.setState('INTERMISSION');
    this.casino.beginIntermission();
    this.casino.houseCreditUsed = !!d.houseCreditUsed;   // after: beginIntermission resets it
    this.ui.updateHUD();
    this.ui.banner(`WELCOME BACK — ROUND ${this.round + 1} AWAITS`, 'gold', 2400);
  }

  /** main-menu chrome: continue button + vault balance */
  _refreshMenu() {
    const save = this._loadSave();
    const cont = $('btn-continue');
    cont.classList.toggle('hidden', !save);
    if (save) cont.textContent = `CONTINUE RUN — ROUND ${save.round + 1}`;
    $('btn-vault').textContent = `🏦 THE VAULT — ${this.vault.banked} banked`;
    this.ui.renderLoyalty();
  }

  startNextRound() {
    this.round++;
    this.beginRound();
  }

  beginRound() {
    const mods = this.casino.consumeMods();

    // roll an optional objective on non-boss rounds 2+ (50%)
    this.objective = null;
    const isBoss = this.isBossRound();
    mods.bossRound = isBoss;
    if (!isBoss && this.round >= 2 && Seed.random('rounds') < 0.5) {
      const def = Seed.pick('rounds', OBJECTIVES);
      this.objective = { def, progress: 0, failed: false, time: 0, startHeadshots: this.stats.headshots };
    }

    // roll a special round on non-boss rounds 3+
    this.specialRound = null;
    if (!isBoss && this.round >= 3 && Seed.random('rounds') < 0.4) {
      const pool = SPECIAL_ROUNDS.filter((sp) => this.round >= sp.minRound);
      this.specialRound = Seed.pick('rounds', pool);
      for (const [k, v] of Object.entries(this.specialRound.mods)) {
        if (typeof v === 'number' && typeof mods[k] === 'number') mods[k] *= v;
        else mods[k] = v;
      }
    }
    this.arena.setLowLight(!!mods.lowLight);
    this.enemies.buildRound(this.round, mods);
    this.rewards.planRound(this.round, isBoss);
    this.pickups.clear();
    if (this.playerMods.roundArmor > 0) this.player.addArmor(this.playerMods.roundArmor);

    let bossKind = null;
    if (this.round === CONFIG.minibossRound) bossKind = 'pitboss';
    else if (this.round === CONFIG.finalRound) bossKind = 'housedealer';
    else if (isBoss) bossKind = Seed.random('rounds') < 0.5 ? 'pitboss' : 'housedealer';   // endless

    if (this.net.isHost) {
      this.net.hostReady = false; this.net.guestReady = false;
      const sp = this.specialRound;
      this.net.send({ t: 'begin', round: this.round, special: sp ? { name: sp.name, desc: sp.desc, chipMult: sp.chipMult } : null, lowLight: !!mods.lowLight, boss: bossKind });
    }

    const spawnBoss = () => {
      this.bosses.push(bossKind === 'pitboss' ? new PitBoss(this) : new HouseDealer(this));
    };

    if (isBoss) {
      // dramatic intro card first
      this._bossIntro(bossKind, () => { spawnBoss(); this._startCountdown(); });
    } else {
      this._startCountdown();
      if (this.specialRound) {
        this.ui.banner(`★ ${this.specialRound.name} ★ — ${this.specialRound.desc}`, 'gold', 3000);
        Audio.play('warn');
      }
    }
  }

  _startCountdown() {
    this.setState('COUNTDOWN');
    this.ui.irisOpen();                                      // 1930s: the picture opens out of a pinpoint…
    this.ui.titleCard(this.round, this.isBossRound());       // …onto this round's title card
    this._countdownT = 3;
    this.ui.countdown(3);
    this.ui.updateHUD();
  }

  onRoundCleared(fromNet = false) {
    if (this.net.isGuest && !fromNet) return;                 // the host calls the round
    const coopPaused = this.net.active && this.state === 'PAUSED';
    if (this.state !== 'COMBAT' && !coopPaused) return;
    if (this.net.isHost) this.net.send({ t: 'cleared' });
    if (this.net.active) this.net.roundRevive();
    // settle the objective before the bonus (its reward gets special-round chips too)
    if (this.objective) {
      const o = this.objective;
      if (o.def.key === 'headhunter') o.progress = this.stats.headshots - o.startHeadshots;
      const done =
        (o.def.key === 'untouchable' && !o.failed) ||
        (o.def.key === 'speedclear' && o.time <= 60) ||
        (o.def.goal > 0 && o.progress >= o.def.goal);
      if (done) {
        const txt = o.def.reward(this);
        this.rewards.present({ rarity: 'rare', icon: '◎', title: 'OBJECTIVE COMPLETE', sub: `${txt}  (+20 XP)` });
        this.progress.gainXp(20, 'Objectives');
      }
      this.objective = null;
    }
    this.rewards.streakOver(this.combo, true);
    this.combo = 0;
    this.progress.gainXp(8 * this.round, 'Rounds');
    if (this.round >= 5 && !this.rewards.hitThisRound) this.progress.bump('cleanRounds');
    this.progress.flush();
    // anything still in motion on the floor settles before the doors shut
    this.pickups.collectParts();
    this.wonder.settle();
    this.allIn.settle();
    const bonus = CONFIG.chips.roundClearBonus + CONFIG.chips.roundClearStep * (this.round - 1);
    this.addChips(bonus);   // still boosted by the special — reward for surviving it
    this.specialRound = null;
    // the house comps the survivors: up to 50 health back after every round
    const p = this.player;
    const comp = Math.min(CONFIG.player.roundHeal ?? 50, Math.max(0, p.maxHp - p.hp));
    if (comp > 0) p.heal(comp);
    this.ui.banner(`ROUND ${this.round} CLEARED +${bonus} chips${comp > 0 ? ` · THE HOUSE COMPS YOU +${Math.round(comp)} HP` : ''}`, 'gold', 2600);
    this.ui.interactPrompt(null);
    this.weapons.clearShots();
    this.equipment.clear();
    if (this.round === CONFIG.finalRound && !this.beatHouse) {
      // you beat the house — but the floor reopens for those who want more
      this.beatHouse = true;
      this.ui.banner('YOU BEAT THE HOUSE — THE FLOOR REOPENS. ENDLESS ROUNDS AHEAD, OR CASH OUT.', 'gold', 4000);
      Audio.play('jackpot');
    }
    this.setState('INTERMISSION');
    this.casino.beginIntermission();
  }

  cashOut() {
    this.ui.showSummary(true, `You cashed out after round ${this.round} and walked into the sunrise.`);
  }

  onBossDefeated(kind) {
    if (this.net.isHost) this.net.send({ t: 'bossdown', kind });
    this.progress.bump(kind);
    this.progress.gainXp(kind === 'pitboss' ? 60 : 120, 'Bosses');
    this.rewards.present({ rarity: 'legendary', icon: kind === 'pitboss' ? '🥊' : '🃏', title: kind === 'pitboss' ? 'THE PIT BOSS IS DOWN' : 'THE HOUSE DEALER FOLDS',
      sub: kind === 'pitboss' ? '+250 chips — halfway to breaking the bank' : '+500 chips — YOU BROKE THE BANK', sound: 'jackpot', big: true });
    const debt = this.grudge[kind] || 0;
    if (debt > 0) {
      this.grudge[kind] = 0;
      this._saveGrudge();
      const payout = 75 * debt;
      this.addChips(payout);
      this.ui.banner(`GRUDGE SETTLED — ${debt} debt${debt === 1 ? '' : 's'} repaid +${payout} chips`, 'gold', 3000);
    }
    this.slowmo(1.0);
    this.addShake(0.3);
    this.effects.spawnBurst(this.player.pos.clone().add(this.player.forwardFlat().multiplyScalar(4)).setY(2), 0xc9a227, 20, 8);
    if (kind === 'pitboss') {
      this.addChips(250);
      this.ui.banner('THE PIT BOSS IS DOWN +250 chips', 'gold', 2600);
    } else {
      this.addChips(500);
      this.ui.banner('THE HOUSE DEALER FOLDS', 'gold', 3000);
    }
    Audio.play('jackpot');
  }

  onPlayerDeath(cause, fromNet = false) {
    if (this.state === 'SUMMARY') return;
    if (this.net.active) { this.net.inRun = false; $('coop-down')?.classList.add('hidden'); }
    // the bosses hold grudges — die to one and it remembers next run
    if (cause === 'THE PIT BOSS') { this.grudge.pitboss++; this._saveGrudge(); }
    if (cause === 'THE HOUSE DEALER') { this.grudge.housedealer++; this._saveGrudge(); }
    this.setState('SUMMARY');
    Audio.setBossMode(false);
    this.arena.setRedAlert(false);
    const won = this.beatHouse;   // dying deep in endless still counts as a win
    setTimeout(() => this.ui.irisSwap(() => this.ui.showSummary(won,
      won ? `The house got you on round ${this.round} — but you beat it first.`
          : `Taken down by ${cause} on round ${this.round}.`), 800), 700);
  }

  // ------------------------------- menus ------------------------------------
  _wireMenus() {
    // ENTER THE CASINO goes through the Coat Check first (pick / build a class)
    $('btn-start').onclick = () => { Audio.init(); this.coatCheck.open(); };
    $('btn-continue').onclick = () => { Audio.init(); this.continueRun(); };
    $('btn-seed').onclick = () => { Audio.init(); this.coatCheck.open(true); };
    $('btn-replay-seed').onclick = () => this.newRun(null, Seed.text);
    $('btn-cashout').onclick = () => this.cashOut();
    $('btn-vault').onclick = () => {
      this.ui.hide('main-menu');
      this.vault.render();
      this.ui.show('vault-panel');
    };
    $('btn-vault-close').onclick = () => {
      this.ui.hide('vault-panel');
      this._refreshMenu();
      this.ui.show('main-menu');
    };
    $('btn-play-again').onclick = () => this.newRun();
    const backToMenu = () => {
      if (this.net.active) this.net.leave();
      this.rewards.clearPresentation();
      this.progress.flush();
      this.enemies.clearAll();
      this.pickups.clear();
      this.effects.clear();
      this.equipment.clear();
      this.weapons.clearShots();
      this.bigSix.reset();
      this.allIn.reset();
      this.ui.interactPrompt(null);
      this.bosses.forEach((b) => { if (b.mesh) { this.scene.remove(b.mesh); b.char?.dispose(); } });
      this.bosses = [];
      this.arena.setRedAlert(false);
      this.arena.setLowLight(false);
      Audio.setBossMode(false);
      this.ui.hideAllPanels();
      this.setState('MENU');
      this._buildMenuActors();
      this.ui.renderHighscore();
      this._refreshMenu();
      this.ui.show('main-menu');
    };
    this.backToMenu = backToMenu;
    $('btn-main-menu').onclick = backToMenu;
    $('btn-resume').onclick = () => this.resume();
    $('btn-restart-pause').onclick = () => this.restartRun();
    $('btn-quit-pause').onclick = backToMenu;
    const openSettings = (from) => {
      this._settingsReturn = from;
      this.ui.hide(from);
      this.ui.show('settings-panel');
    };
    $('btn-settings-main').onclick = () => openSettings('main-menu');
    $('btn-markers').onclick = () => { this.ui.hide('main-menu'); this.ui.renderMarkers(); this.ui.show('markers-panel'); };
    $('btn-markers-close').onclick = () => { this.ui.hide('markers-panel'); this._refreshMenu(); this.ui.show('main-menu'); };
    $('btn-settings-pause').onclick = () => openSettings('pause-menu');
    $('btn-settings-close').onclick = () => {
      this.ui.hide('settings-panel');
      this.ui.show(this._settingsReturn || 'main-menu');
    };
  }

  // -------------------------------- loop ------------------------------------
  _tick() {
    const rawDt = Math.min(this.clock.getDelta(), 0.05);
    let dt = rawDt;
    if (this.slowmoT > 0) {
      this.slowmoT -= rawDt;          // slow-mo runs on real time
      dt = rawDt * 0.25;
    }

    this.net.update(rawDt);
    let state = this.state;
    this.rewards.update(rawDt, this.state === 'COMBAT' || (this.state === 'PAUSED' && this.net.active && this._stateBeforePause === 'COMBAT'));
    if (state === 'PAUSED' && this.net.active && this.net.inRun
      && (this._stateBeforePause === 'COMBAT' || this._stateBeforePause === 'COUNTDOWN')) state = this._stateBeforePause;

    switch (state) {
      case 'COUNTDOWN': {
        const before = Math.ceil(this._countdownT);
        this._countdownT -= dt;
        const after = Math.ceil(this._countdownT);
        if (after < before && after >= 0) this.ui.countdown(after);
        this.player.update(dt);
        this.weapons.update(dt);
        this.arena.update(dt);
        this.bigSix.update(dt);
        this.wonder.update(dt);
        this.allIn.update(dt);
        this._updateInteract();
        this.ui.updateRadar();
        if (this._countdownT <= 0) {
          if (this.state === 'PAUSED') this._stateBeforePause = 'COMBAT';
          else this.setState('COMBAT');
        }
        break;
      }
      case 'COMBAT': {
        // combo window decay
        if (this.comboT > 0) {
          this.comboT -= dt;
          if (this.comboT <= 0) { this.rewards.streakOver(this.combo); this.combo = 0; }
        }
        this.dashBuffT = Math.max(0, this.dashBuffT - dt);
        if (this.objective) this.objective.time += dt;
        this.player.update(dt);
        this.weapons.update(dt);
        this.enemies.update(dt);
        for (const b of this.bosses) b.update(dt);
        this.pickups.update(dt);
        this.equipment.update(dt);
        this.bigSix.update(dt);
        this.wonder.update(dt);
        this.allIn.update(dt);
        this.arena.update(dt);
        this.effects.update(dt);
        this._updateInteract();
        this.ui.updateThreatIndicator();
        this.ui.updateRadar();

        const bossesAlive = this.bosses.some((b) => !b.dead);
        if (this.enemies.remaining() === 0 && !bossesAlive) this.onRoundCleared();
        // co-op: both of you down at once — the house wins
        if (this.net.isHost && this.net.wiped()) {
          const cause = this.net.downCause || 'the horde';
          this.net.send({ t: 'over', cause });
          this.onPlayerDeath(cause, true);
        }
        this.ui.updateHUD();
        break;
      }
      case 'INTERMISSION':
        this.casino.updateTimer(dt);
        this.pickups.update(dt);
        break;
      case 'VICTORY':
        this.pickups.update(dt);
        break;
      case 'MENU':
        this._updateMenu(rawDt);
        break;
      case 'INTERMISSION':
      case 'SUMMARY':
      case 'BLACKJACK':
      case 'ROULETTE':
      case 'POKER':
      case 'SLOTS':
      case 'UPGRADE':
        // the floor keeps living behind the tables: lights, corpses settling, particles
        this.arena.update(rawDt);
        this.effects.update(rawDt);
        this.enemies._updateCorpses(rawDt);
        break;
      default:
        break;
    }
    this._watchPerf(rawDt);
    this._countFrames();

    // 3D audio: keep the listener glued to the camera
    if (Audio.ready) {
      this._fwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      Audio.updateListener(this.camera.position, this._fwd);
      // danger meter -> music intensity, ~2x/sec
      this._audioMeterT -= rawDt;
      if (this._audioMeterT <= 0) {
        this._audioMeterT = 0.45;
        if (this.state === 'COMBAT') {
          let near = 0;
          for (const z of this.enemies.list) {
            if (!z.dead && z.mesh.position.distanceTo(this.player.pos) < 14) near++;
          }
          const bossBoost = this.bosses.some((b) => !b.dead) ? 0.35 : 0;
          const hpFear = (1 - this.player.hp / this.player.maxHp) * 0.35;
          Audio.setIntensity(0.15 + Math.min(0.5, near / 8) + hpFear + bossBoost);
          Audio.setHealth(this.player.hp / this.player.maxHp);
        } else {
          Audio.setIntensity(this.state === 'MENU' ? 0.1 : 0.15);
          Audio.setHealth(1);
        }
      }
    }
    // low health: color drains, the edges pulse red
    const hpFrac = this.player.hp / this.player.maxHp;
    const lowWant = this.state === 'COMBAT' && hpFrac < 0.35 ? (0.35 - hpFrac) / 0.35 : 0;
    this.post.lowHealth += (lowWant - this.post.lowHealth) * Math.min(1, rawDt * 3);

    // screen shake: applied after all camera positioning, decays on real time
    if (this.shakeAmp > 0.002) {
      const a = this.shakeAmp * (this.settings.reducedFlash ? 0.6 : 1);
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a * 0.7;
      this.camera.position.z += (Math.random() - 0.5) * a;
      this.shakeAmp *= Math.exp(-7 * rawDt);
    } else this.shakeAmp = 0;

    this._render();
  }
}
