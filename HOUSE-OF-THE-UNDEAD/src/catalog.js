// catalog.js — everything on the menu, by name. Guns (who they are, not their
// numbers — those live in config.js), lethals and tacticals, the cocktail
// automats' drinks, the vices a class can carry, and the house's pre-made
// classes. Data only: no imports, safe to pull in from anywhere.

// ---------------------------------- guns -------------------------------------
// cat: 'sidearm' | 'primary' | 'special' (special = only off the Big Six wheel
// or the shop; never checked in at the Coat Check)
export const GUNS = {
  pistol:    { name: 'LUCKY SEVEN', cat: 'sidearm', icon: '7',
               blurb: 'Nickel six-shooter with a gold drum. Snappy, honest, lucky.' },
  derringer: { name: 'THE ACE UP THE SLEEVE', cat: 'sidearm', icon: 'A',
               blurb: 'A two-shot pearl derringer. Pure cheating — each barrel hits like a closing casino.' },
  shotgun:   { name: 'RIVERBOAT SCATTERGUN', cat: 'primary', icon: '⁂',
               blurb: 'Double-barrel pump from the paddle-steamer days. Up close, it settles every argument.' },
  smg:       { name: 'CHIP SPITTER', cat: 'primary', icon: '≡',
               blurb: 'Black polymer bullet hose. Spits them faster than a broken slot pays out.' },
  tommy:     { name: 'THE LOAN SHARK', cat: 'primary', icon: '◎',
               blurb: 'A drum-fed typewriter from the old days. Collects in full, with interest.' },
  shoe:      { name: "THE DEALER'S SHOE", cat: 'primary', icon: '♠',
               blurb: 'Deals razor-edged cards at the speed of a bad night — each one slices through a whole line.' },
  rifle:     { name: 'BONEYARD SPECIAL', cat: 'primary', icon: '☠', locker: true,
               blurb: 'Brass lever-action with a bone stock. Every round a verdict. (Vault: Gun Locker)' },
  magnum:    { name: 'THE MAGNUM', cat: 'special', icon: '🍾',
               blurb: 'Fires explosive champagne corks. Somebody is always celebrating.' },
  whale:     { name: 'THE WHALE', cat: 'special', icon: '⚓',
               blurb: 'A big-game double rifle for the biggest players. Punches clean through three of them.' },
  jubilee:   { name: 'CHERRIES JUBILEE', cat: 'special', icon: '🔥',
               blurb: "The bartender's flambé torch, turned all the way up. Sets the dead alight." },
  // the wonder weapon: never on the wheel, never in the shop — you build her
  luck:      { name: 'LADY LUCK', cat: 'wonder', icon: '🍀',
               blurb: 'A gilded raygun built from a roulette ball, a pair of loaded dice and a one-armed bandit\'s arm. Her luck jumps from one of them to the next.' },
};

// ------------------------------ ALL IN (pack-a-punch) ------------------------
// what every gun is called once it's been pushed all in
export const PACKED = {
  pistol: 'SEVEN COME ELEVEN',
  derringer: 'ACES HIGH',
  shotgun: 'THE RIVER CARD',
  smg: 'THE MONEY PRINTER',
  tommy: 'THE COLLECTION AGENCY',
  shoe: 'THE STACKED DECK',
  rifle: 'THE GRAVEYARD SHIFT',
  magnum: 'THE JEROBOAM',
  whale: 'THE WHITE WHALE',
  jubilee: 'BAKED ALASKA',
  luck: 'LADY FORTUNE',
};

// ------------------------------ LADY LUCK's parts ----------------------------
export const PARTS = {
  zero: { name: 'THE GREEN ZERO', icon: '●', color: '#2dff7a',
          how: 'Land the ball on green — at a roulette table in the shop, or on the house wheel on the floor.' },
  dice: { name: 'THE LOADED DICE', icon: '⚅', color: '#ff2d55',
          how: 'Roll a natural (7 or 11) at the craps table.' },
  arm:  { name: "THE BANDIT'S ARM", icon: '🎰', color: '#ffd24a',
          how: 'Cash out THE JACKPOT — the walking slot machine drops its arm.' },
};

// ------------------------------- equipment -----------------------------------
// lethals go on G, tacticals on T. start = how many you walk in with, max = cap
export const LETHALS = {
  chipbomb: { name: 'CHIP BOMB', icon: '●', color: '#e0303c', start: 2, max: 4,
              blurb: 'A poker chip packed with powder. Bounces, blinks, cashes out.' },
  sambuca:  { name: 'FLAMING SAMBUCA', icon: '🔥', color: '#ff8a2a', start: 2, max: 3,
              blurb: 'Lit on the way out of your hand. Shatters into a pool of fire that burns anything walking through.' },
  rope:     { name: 'THE VELVET ROPE', icon: '⚜', color: '#c9a227', start: 2, max: 3,
              blurb: 'A brass stanchion that plants where it lands. Nobody gets past the velvet rope — it goes off when they try.' },
  jackpot:  { name: 'FALSE JACKPOT', icon: '🎰', color: '#ffd24a', start: 1, max: 2,
              blurb: 'A pocket slot machine rings a fake jackpot. Every zombie in earshot comes to cash in. Then it pays out in shrapnel.' },
};

export const TACTICALS = {
  bellini:  { name: 'BUTTERFINGERS BELLINI', icon: '🍸', color: '#ff9ad0', start: 2, max: 3,
              blurb: 'A whole tray of drinks, hurled. The dead slip in the puddle and land flat on their backs.' },
  clock:    { name: 'THE MISSING CLOCK', icon: '⏱', color: '#8ad8ff', start: 1, max: 2,
              blurb: 'Casinos hide their clocks for a reason. Inside this one\'s tick, the dead crawl at a third speed.' },
  flash:    { name: 'PAPARAZZI FLASH', icon: '📸', color: '#ffffff', start: 2, max: 3,
              blurb: 'One camera flash from the VIP line. Everything that sees it staggers blind.' },
  eye:      { name: 'EYE IN THE SKY', icon: '👁', color: '#ff2d55', start: 1, max: 1,
              blurb: 'The casino\'s own surveillance dome, on a tripod, with a gun. Watches your back for 25 seconds.' },
};

// ------------------------------ the automats ---------------------------------
// perk cocktails, bought from machines on the floor mid-round
export const DRINKS = {
  stout:    { name: 'DEAD WEIGHT STOUT', icon: '🍺', color: '#e04a2a', price: 300,
              blurb: 'Thick as a coffin lid. Max health doubled.' },
  daiquiri: { name: 'DOUBLE DOWN DAIQUIRI', icon: '🍹', color: '#7dff4a', price: 200, limit: 3,
              blurb: 'Go down, and the house deals you back in. One hand per glass (3 per night).' },
  sling:    { name: 'SLEIGHT OF HAND SLING', icon: '🍸', color: '#27e6ff', price: 250,
              blurb: 'Reloads 45% faster, and your hands swap guns like a magician.' },
  shooter:  { name: 'SNAKE EYES SHOOTER', icon: '🎲', color: '#ffd24a', price: 250,
              blurb: '+30% fire rate, and one shot in four hits twice.' },
  fizz:     { name: 'FAST MONEY FIZZ', icon: '🥂', color: '#ff9a2a', price: 200,
              blurb: 'Move 15% faster, and the dash comes back twice as quick.' },
  spritz:   { name: 'SPLIT THE PAIR SPRITZ', icon: '🍷', color: '#c27aff', price: 300,
              blurb: 'Split your pair: carry a third gun (slot 3).' },
  punch:    { name: 'POWDER KEG PUNCH', icon: '💥', color: '#ff5a1a', price: 250,
              blurb: 'Explosions — yours, theirs — can\'t touch you. Every dash ends with a bang.' },
  liqueur:  { name: 'LOOSE CHANGE LIQUEUR', icon: '🪙', color: '#c8ff4a', price: 200,
              blurb: 'The dead pay out 30% more, drop supplies more often, and chips come running.' },
  dram:     { name: 'DEAD EYE DRAM', icon: '🎯', color: '#8ad8ff', price: 200,
              blurb: 'Headshots hit 50% harder, +8% crit, and your aim settles like a dealer\'s hands.' },
};
export const DRINK_LIMIT = 4;          // the house cuts you off at four

// --------------------------------- vices -------------------------------------
// a class's personal trait — most are a deal with a catch
export const VICES = {
  none:     { name: 'CLEAN LIVING', icon: '·', blurb: 'No vices. No edge. No catch.' },
  hustler:  { name: 'THE HUSTLER', icon: '$', blurb: '+25% chips from every pickup. You bruise easy: -20 max health.' },
  stomach:  { name: 'IRON STOMACH', icon: '♜', blurb: 'Hold FIVE drinks instead of four. The bartender charges you 10% more.' },
  packrat:  { name: 'PACK RAT', icon: '▣', blurb: 'Carry +1 lethal and +1 tactical and start topped up. -15% max reserve ammo.' },
  brawler:  { name: 'BRAWLER', icon: '✊', blurb: 'Pistol-whips hit 2.5x harder and every melee kill heals 5. Guns deal 10% less.' },
  quickdraw:{ name: 'QUICK DRAW', icon: '⚡', blurb: 'Swap guns twice as fast, and sidearms hit 30% harder.' },
  laststand:{ name: 'LAST MAN STANDING', icon: '♞', blurb: 'Under 30% health you deal +35% damage and move 15% faster.' },
};

// ------------------------------ house classes --------------------------------
export const DEFAULT_CLASSES = [
  { name: 'THE HIGH ROLLER', primary: 'shotgun', sidearm: 'pistol', lethal: 'chipbomb', tactical: 'bellini', vice: 'hustler' },
  { name: 'THE CARD SHARP', primary: 'shoe', sidearm: 'derringer', lethal: 'rope', tactical: 'clock', vice: 'quickdraw' },
  { name: 'THE MOBSTER', primary: 'tommy', sidearm: 'pistol', lethal: 'sambuca', tactical: 'eye', vice: 'packrat' },
];
