// config.js — every tunable balance number in one place. If the game feels
// too easy or too hard, this is the file to edit.

export const CONFIG = {
  rounds: 10,
  minibossRound: 5,
  finalRound: 10,
  intermissionSeconds: 60,   // time to browse the shop

  player: {
    roundHeal: 50,           // health comped back after every cleared round
    hp: 100,
    speed: 6.2,
    sprintMult: 1.45,
    jumpVel: 7.5,
    gravity: 22,
    eyeHeight: 1.7,
    radius: 0.55,
    fov: 75,
    aimFov: 55,
    dashSpeed: 22,          // NEW: dash burst
    dashTime: 0.22,
    dashCooldown: 3.5,
    dashIFrames: 0.35,
    hurtIFrames: 0.35,
    armorAbsorb: 0.6,       // 60% of damage goes to armor first
  },

  melee: {                   // NEW: panic pistol-whip (F)
    damage: 45,
    range: 2.6,
    arcDot: 0.55,            // how forward-facing a target must be
    cooldown: 0.8,
    knockback: 9,
  },

  grenade: {                 // chip bombs (G)
    damage: 90,
    radius: 5.5,
    fuse: 1.4,
    throwSpeed: 16,
    start: 2,
    max: 5,
    price: 60,
  },

  // the rest of the lethals (G) and the tacticals (T) — see catalog.js for who's who
  equipment: {
    sambuca: { radius: 3.2, time: 6, dps: 24, burnDps: 12, burnTime: 3 },
    rope:    { arm: 0.9, trigger: 2.4, radius: 4.8, damage: 170, life: 90 },
    jackpot: { lure: 6.5, pull: 32, radius: 6.5, damage: 230 },
    bellini: { radius: 3.3, time: 10, slip: 2.3, slow: 0.55 },
    clock:   { radius: 6.5, time: 7.5, slow: 0.3 },
    flash:   { radius: 11, stun: 3.6 },
    eye:     { life: 25, range: 22, rate: 5, damage: 16 },
  },

  bigSix: { price: 120, claimTime: 12 },   // the money wheel (mystery gun)

  // balance pass v3: pistol buffed (starter should feel snappy), shotgun
  // buffed (harder slap, faster reload), smg per-shot nerf but faster + bigger
  // mag (same DPS, sprayier), rifle buffed hard (it's a legendary unlock).
  // you carry two (three with the Split the Pair Spritz). fire: 'ray' (hitscan,
  // default), 'card' (piercing projectile), 'cork' (arcing explosive), 'flame'
  weapons: {
    pistol: {
      name: 'Lucky Seven', auto: false,
      damage: 38, fireRate: 4.2, mag: 12, reserve: 48, maxReserve: 120,
      reload: 1.25, spread: 0.011, pellets: 1, critChance: 0.10, zoomOk: true,
    },
    derringer: {             // two barrels, enormous hits, snap-quick reload
      name: 'The Ace Up the Sleeve', auto: false,
      damage: 95, fireRate: 3.4, mag: 2, reserve: 30, maxReserve: 64,
      reload: 1.05, spread: 0.008, pellets: 1, critChance: 0.2, zoomOk: true,
    },
    shotgun: {
      name: 'Riverboat Scattergun', auto: false,
      damage: 11, fireRate: 1.5, mag: 6, reserve: 24, maxReserve: 60,
      reload: 2.0, spread: 0.05, pellets: 8, critChance: 0.04, zoomOk: false,
    },
    smg: {
      name: 'Chip Spitter', auto: true,
      damage: 8, fireRate: 12.5, mag: 35, reserve: 105, maxReserve: 245,
      reload: 1.7, spread: 0.032, pellets: 1, critChance: 0.05, zoomOk: false,
    },
    tommy: {                 // the drum: heavier hits than the Spitter, a longer reload
      name: 'The Loan Shark', auto: true,
      damage: 14, fireRate: 11, mag: 50, reserve: 150, maxReserve: 300,
      reload: 2.5, spread: 0.026, pellets: 1, critChance: 0.06, zoomOk: true,
    },
    shoe: {                  // razor cards pierce up to five bodies
      name: "The Dealer's Shoe", auto: false, fire: 'card', pierce: 5, speed: 58,
      damage: 52, fireRate: 2.8, mag: 12, reserve: 48, maxReserve: 108,
      reload: 1.9, spread: 0.004, pellets: 1, critChance: 0.12, zoomOk: true,
    },
    rifle: {                 // a legendary, hits like one
      name: 'Boneyard Special', auto: false,
      damage: 70, fireRate: 1.8, mag: 8, reserve: 40, maxReserve: 96,
      reload: 2.0, spread: 0.003, pellets: 1, critChance: 0.22, zoomOk: true,
    },
    magnum: {                // explosive corks, a lobbed arc
      name: 'The Magnum', auto: false, fire: 'cork', radius: 4.2, speed: 30,
      damage: 150, fireRate: 1.25, mag: 1, reserve: 14, maxReserve: 24,
      reload: 1.3, spread: 0.006, pellets: 1, critChance: 0, zoomOk: false,
    },
    whale: {                 // punches through three
      name: 'The Whale', auto: false, pierce: 3,
      damage: 240, fireRate: 1.1, mag: 2, reserve: 16, maxReserve: 30,
      reload: 2.4, spread: 0.002, pellets: 1, critChance: 0.25, zoomOk: true,
    },
    jubilee: {               // fuel ticks; damage is per tick, plus it sets them burning
      name: 'Cherries Jubilee', auto: true, fire: 'flame', range: 7.5, burn: 14,
      damage: 7, fireRate: 12, mag: 120, reserve: 240, maxReserve: 360,
      reload: 2.6, spread: 0, pellets: 1, critChance: 0, zoomOk: false,
    },
    luck: {                  // the wonder weapon: a bolt that chains from one of them to the next
      name: 'Lady Luck', auto: false, fire: 'luck', chain: 6, chainRange: 8.5,
      damage: 190, fireRate: 1.5, mag: 8, reserve: 48, maxReserve: 72,
      reload: 2.2, spread: 0, pellets: 1, critChance: 0, zoomOk: false,
    },
  },

  // ALL IN — the house's pack-a-punch: one push per gun
  allIn: { price: 1000, time: 3.6, damage: 2, flameDamage: 1.6, mag: 1.5, reserve: 1.5, fireRate: 1.1, reload: 0.85, crit: 0.1, killChips: 6 },
  // LADY LUCK's parts
  houseWheel: { price: 60 },        // spin the floor roulette for the green zero
  craps: { price: 50 },             // roll the bones for the loaded dice
  critMult: 2.0,
  headshotMult: 2.0,

  enemies: {
    walker:   { hp: 55,  speed: 2.2, damage: 12, chips: [8, 14],  scale: 1.0 },
    sprinter: { hp: 32,  speed: 5.6, damage: 9,  chips: [10, 16], scale: 0.85 },
    brute:    { hp: 220, speed: 1.6, damage: 26, chips: [30, 45], scale: 1.45 },
    spitter:  { hp: 45,  speed: 2.6, damage: 14, chips: [14, 22], scale: 0.95,  // NEW ranged
                projSpeed: 12, attackRange: 14, attackCd: 2.4 },
    gasbag:   { hp: 70,  speed: 1.9, damage: 30, chips: [18, 28], scale: 1.15,  // NEW exploder
                blastRadius: 4.5 },
    pitguard: { hp: 160, speed: 2.4, damage: 20, chips: [25, 40], scale: 1.2,   // NEW armored
                bodyResist: 0.7 },  // body shots do 30% damage; head is normal + headshot mult
    collector:{ hp: 140, speed: 4.6, damage: 8,  chips: [60, 90], scale: 1.05,  // severe penalty hunter
                stealOnHit: 25 },
    croupier: { hp: 60,  speed: 2.8, damage: 11, chips: [16, 26], scale: 0.95,  // NEW: razor-card burst
                projSpeed: 14, attackRange: 13, attackCd: 3.0, burst: 3 },
    magician: { hp: 50,  speed: 2.4, damage: 15, chips: [20, 32], scale: 0.9,   // NEW: teleports at you
                blinkCd: 4.5 },
    jackpot:  { hp: 110, speed: 3.4, damage: 6,  chips: [130, 200], scale: 1.1, // NEW: golden bonus target,
                despawn: 20 },                                                  // flees, escapes if ignored
    showgirl: { hp: 48,  speed: 4.3, damage: 13, chips: [14, 22], scale: 0.95 }, // high-kicking chorus girls
    king:     { hp: 300, speed: 2.5, damage: 24, chips: [90, 140], scale: 1.12, // THE KING: struts, poses,
                poseCd: 7, hype: 4 },                                           // and whips the crowd up
  },
  eliteMult: { hp: 2.2, speed: 1.25, chips: 3 },

  // round composition: counts scale off these
  spawn: {
    baseCount: 8,
    perRound: 3,
    maxAlive: 17,   // bigger floor holds a bigger crowd
    hpScalePerRound: 0.14,
    dmgScalePerRound: 0.06,
  },

  chips: {
    roundClearBonus: 60,     // + roundClearStep per round after the first
    roundClearStep: 12,
    headshotBonus: 3,
    comboWindow: 3.5,        // NEW: killstreak combo
    comboMaxMult: 3.0,
    comboStep: 0.25,         // +25% chips per combo stage
  },

  shop: {
    smallHeal: { price: 50, amount: 35 },
    fullHeal: { price: 120 },
    ammo: { price: 75 },
    armor: { price: 100, amount: 50 },
    grenade: { price: 60 },
    rifleUnlock: { price: 450 },   // alternative path to the new gun
  },

  // choose-your-stake wagers: bet ANY amount from minBet to everything.
  // Reward tier is earned by risk — both an absolute floor and a fraction of
  // your bankroll, so the rich can't buy legendaries with pocket change and
  // the broke can't get them for 8 chips:
  //   COMMON    any stake >= minBet            (lose: mild penalty)
  //   RARE      >= 150 chips AND >= 40% of it  (lose: moderate)
  //   LEGENDARY >= 300 chips AND >= 85% of it  (lose: severe)
  wagers: {
    minBet: 50,
    rare:      { min: 150, frac: 0.40 },
    legendary: { min: 300, frac: 0.85 },
    houseCreditTier: 'common',
  },

  slots: { price: 60 },      // 5x5 machine, 7 paylines, runs of 3+ pay
  poker: { minAnte: 50 },    // five card draw — ante is your choice; hand rank
                             // sets the tier; a legendary-risk ante bumps it +1
};

// ------------------------------ tiny helpers --------------------------------
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
