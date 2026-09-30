# HOUSE OF THE UNDEAD

The casino never closed. The gamblers never left.

An FPS roguelite: fight casino zombies for 10 rounds, bank chips, then spend
them in THE HOUSE SHOP between rounds — a random shelf of cards where a table
card sits you down to gamble for an upgrade, and losing brings a penalty.
Round 5: THE PIT BOSS. Round 10: THE HOUSE DEALER.

## Play it (Windows)

Double-click **`HOUSE OF THE UNDEAD.exe`** (one folder up from this one).
That's it — no server, no browser, no install. It opens fullscreen; F11
toggles a window, ESC pauses, QUIT on the main menu closes it.

The exe carries the whole game inside it and renders with the Edge WebView2
engine that ships with Windows 11 (and most Windows 10 PCs — if it's missing,
the exe says so and opens Microsoft's download page). Saves, settings and the
vault live in `%LOCALAPPDATA%\HouseOfTheUndead\profile`.

They are also mirrored to a real file, `%LOCALAPPDATA%\HouseOfTheUndead\save.json`,
with the previous copy kept as `save.json.bak`. If a write would suddenly
shrink the file by half, the old one is set aside as
`save.before-<date>.json` first. On launch, anything missing from the browser
store is restored from the file, so a wiped or damaged store never costs your
progress. The code is `src/persist.js` plus `SaveStore`/`LoadStore` in the
launcher. The .html version keeps its saves in the browser as before.

## Sending it to a friend

Send **`HOUSE OF THE UNDEAD.html`** (one folder up, next to the exe), not the
exe. It's the entire game in a single file: they double-click it and it opens
in Edge or Chrome. Nothing to install and no program for Windows to block.
Press F11 in the browser for fullscreen. (Their saves live in that browser.)

Why not the exe? Windows blocks unsigned programs downloaded from the
internet. SmartScreen shows "Windows protected your PC" (they can click
**More info → Run anyway**), and on PCs with **Smart App Control** turned on
there's no override at all. Only a paid code-signing certificate stops that;
the HTML file sidesteps it completely. Zipping the .html is fine too (Discord
and email are happier with a .zip).

After changing the game, rebuild the shareable file with:

```
powershell -ExecutionPolicy Bypass -File build-html.ps1
```

No PowerShell? `node build-html.mjs` builds the same file.

## Revamp 5: the lounge band, 3D tables, the bandit, and seeds

- **A jazz band in the lounge.** The haunted music box, the drone and the
  whispers are gone. A little combo (upright bass, piano, drums and horns)
  swings through three tunes in rotation: **When the Saints Go Marching In**
  (traditional, a Dixieland two-beat in F with trumpet and clarinet),
  **Lucky Seven Shuffle** (a Kansas City riff blues in Bb on tenor sax and
  muted trumpet) and **Last Call at the Golden Lounge** (a 32-bar ballad in Eb
  on vibes). Every tune plays several choruses with a different lead each
  time, a second horn on the harmony, drum fills into each chorus and a proper
  ending, then the next one starts. The fight feeds the band: the bass starts
  walking, the drums dig in, the tempo pushes a little. A boss gets the shout
  chorus with brass hits. Your heartbeat only comes in when you're nearly
  dead. The tune's name shows in the corner when it starts. Around the band,
  the casino: slot bells, coins, the PA. (The score is in `src/audio.js`.)
- **The tables are real tables now.** Blackjack, roulette and five card draw
  sit on tilted 3D felt with a padded leather rail, printed felt, a chip rack,
  a card shoe and a discard tray, and the table leans a little toward your
  mouse. Cards are printed like a real deck (pips, court cards, the house
  back), fly out of the shoe, and turn over in 3D. Chips stack in casino
  colors and slide across the felt when money changes hands. Result stamps
  land on each hand. (The felt is `src/tables.js`.)
- **Blackjack: split.** Split any pair, any two tens included, into up to four
  hands. Each new hand puts up the card's stake again, and you can double on
  any first two cards, split hands included. Split aces get one card each. The
  dealer peeks for a natural. Every hand settles on its own. Win more hands
  than you lose and the card pays out; sweep every hand of a split for a tier
  up. Keys: **H** hit, **S** stand, **D** double, **P** split.
- **Roulette on a real layout.** Click the number grid or an outside bet
  (red, black, odd, even, halves, or the green zero) and your chip slides
  there. The wheel sits in its wooden bowl with brass diamonds; the ball
  rattles over the frets and the dolly goes down on the winner. **SPACE**
  spins.
- **Five card draw** holds with a click or keys **1–5**, and shows what you're
  holding as you go. **SPACE** draws. Your discards fly to the tray.
- **LUCKY UNDEAD, a real one-armed bandit.** Three reels of sevens, single,
  double and triple BARs, cherries, bells, hearts and a gold WILD, on real reel
  strips with blanks. Every pull plays five lines. A WILD doubles its line
  (two WILDs: ×4). Grab the arm and drag it down (or hit SPIN or **SPACE**),
  then hit STOP (or **1–3**) to bring a reel in early. There's a chasing-bulb
  marquee, a paytable that lights up, LED meters, and coins that rattle into
  the tray. Pays scale with what the pull cost you. **The odds are better:**
  it pays back about **111%** on average and hits on about **half** of all
  pulls; 7·7·7 or three WILDs lands about once in 270. (`slotStats()` in
  `src/cards.js` works this out by trying every stop; the unit tests keep it
  above 100%.) Three hearts also heal you; three bells bring ammo.
- **Reward cards tell the whole truth.** Every upgrade card shows the gun it
  goes on, its tier (●●○), and each stat before → after, worked out from your
  gun's real numbers with everything else you've got. For example, Hair
  Trigger I on the Riverboat Scattergun shows FIRE RATE 1.50 → 1.68/s and
  DAMAGE/SEC 132 → 148. Player, synergy and cursed cards show their numbers
  too, and the downsides in red. Gun cards in the shop carry stat bars.
  Fixed along the way: an attachment used to overwrite Devil's Reload's
  faster reload instead of stacking with it.
- **Seeds.** Every run is dealt from a seed, and the same seed and the same
  choices give the same run: the same shelves in the shop, the same cards off
  the shoe, the same spins, pulls, hordes, specials and prizes. Each system
  draws from its own stream, so playing one table never shifts another's luck.
  Type a seed into the box at the Coat Check (or use **🎲 PLAY A SEED** on the
  main menu), or leave it blank for a random one. The seed is shown in the
  shop, on the pause menu and on the summary, which has a **REPLAY THIS SEED**
  button. RESTART keeps a seed you typed in. A saved run keeps its place in
  every stream. In co-op, the host's seed deals for both of you.
  (`src/rng.js`.)
- **The Daily Run is gone.** Seeds replace it: share one with a friend instead.
- **FPS and ping** in the top-right corner. Ping is the real round trip to
  your co-op partner, measured once a second, and reads 0 when you play alone.
  Settings → *Show FPS & ping* turns it off.

## The reward loop

Every few seconds something reacts, every few minutes something good drops,
every run moves a bar, and the summary shows what's next. Big moments get big
presentation. Small ones stay small.

**During a run** (`src/rewards.js`):

- **Streak tiers** replace the old combo. Chip multipliers climb:

  | Kills in a row | Tier | Chips | Bonus |
  |---|---|---|---|
  | 5 | HOT STREAK | ×1.5 | |
  | 10 | ON FIRE | ×2 | |
  | 20 | UNSTOPPABLE | ×2.5 | a Rare comp |
  | 35 | HOUSE ON FIRE | ×3 | an Epic comp |
  | 50 | LEGEND OF THE STRIP | ×3.5 | a Legendary comp |

  The left-side panel shows the tier, the window draining, and how many kills
  to the next tier. Each kill plays a note that climbs the scale as the streak
  grows. When a streak ends, it banks chips (×3 per kill) instead of just
  vanishing.
- **Comps** are power-ups the dead drop, in five rarities:

  | Rarity | Comps |
  |---|---|
  | Common | Free Refill, Comp'd Cocktail |
  | Uncommon | Hot Hand, Loose Slots |
  | Rare | High Roller, Free Spins |
  | Epic | The Whale's Blessing, Lucky Streak |
  | Legendary | The Big Jackpot |

  - Drop odds and rarity rise with the round, your streak, and the enemy
    (elites, specials, Golden Gamblers).
  - A bad-luck guard guarantees a Rare or better after a long dry spell, and
    there's a 4-second gap between drops so they don't spam.
  - Rare-and-up tokens throw a coloured light beam and show on the radar.
  - Each rarity has its own sting.
  - Active comps tick down at the top of the screen.
- **The Progressive Jackpot** is a meter that fills with every kill. Headshots,
  elites, specials and your streak fill it faster. At 100% it pays chips plus a
  Rare-or-better comp. Past 85% it pulses "ALMOST THERE". It fills a little
  slower after each payout so it stays special.
- **Surprises:** about one round in three from round 2, something happens
  mid-round:
  - HAPPY HOUR: 20 s of 2.5× comp drops and 1.5× chips.
  - A GOLDEN GAMBLER: a tough, gold-flashing walker with a guaranteed Epic
    comp.
  - A ghost's WINDFALL: a slot bank spills chips.
  - A commemorative chip glinting somewhere on the floor. Follow the light.
- **First Blood:** +25 chips on the first kill of a run.
- **Goals, top right:** always three.
  - What's next right now: the objective, the jackpot, or the next streak tier.
  - This run's goal: the round, and the next boss.
  - The long game: the next loyalty card.
- **Presentation hierarchy:**
  - Small things: floating numbers and side toasts.
  - Rare things: a card that flips in.
  - Epic and Legendary: the card plus a beat of slow motion, a burst and a
    fanfare.
  - Several cards at once play faster, so nothing queues for long.

**Between runs** (`src/progress.js`, saved every few seconds):

- **The Loyalty Card:** XP from kills, rounds, bosses, objectives, jackpots,
  discoveries and markers climbs you through 9 tiers, each with a permanent
  perk. Bronze gives +25 starting chips; later tiers make comps last longer,
  add a starting lethal, fill the jackpot faster, start you with a free Hot
  Hand, and so on up to THE HOUSE KNOWS YOUR NAME.
- **Markers:** 23 achievements with visible progress (NIGHT SHIFT 87 / 100),
  each worth XP.
- **The Commemorative Chip Set:** 12 chips found as glinting discoveries and
  rare drops. Duplicates cash in for chips.
- **Records:** best round, best streak, most chips, most jackpots.
- **The summary screen** shows:
  - the XP you earned, with the card's bar filling
  - what you unlocked this run
  - any new records
  - the three markers you're closest to
  - one "one more run gets you…" line pointing at the most reachable next thing
- **MARKERS & CHIPS** on the main menu shows the whole ladder, the set and
  every marker. The menu also shows your card and XP.

Nothing is bought with real money, and nothing is on a timer. The odds get
better as you play better, and every bar only goes up.

## Co-op: play with up to four

Main menu → **PLAY WITH FRIENDS (UP TO 4)**.

- **Your name:** type it at the top of the co-op screen. It goes over your
  head, on the scoreboard and in the table's banners, and it's remembered.
- **Host:** click **HOST A TABLE**. You get a 5-letter room code (COPY puts it
  on your clipboard). Send it to up to three friends. The four seats fill up
  as they sit down; click **DEAL US IN** when everyone's there. Want a
  particular seed? Type it at the Coat Check (CHANGE CLASS) before you deal.
- **Join:** type the code and click **JOIN**. A full table, a table already
  mid-game, or a different build of the game turns you away and says why.
- **Class:** each of you picks your own with CHANGE CLASS (the Coat Check).
- Works with either version of the game (exe or the .html file), as long as
  everyone has the same build and an internet connection.

How the table works:

- **The host runs the house.** The horde, bosses, rounds and drops all live on
  the host's game. Everyone else's shots, lethals and tacticals are sent over
  and applied there. The dead go after whoever is closest.
- **Four seats, four jackets.** Seat 1 (the host) wears red, seat 2 white,
  seat 3 green, seat 4 blue. Name tags, the radar and the scoreboard use the
  same colors.
- **Your own money.** Separate chips: kill money goes straight to whoever
  landed the killing blow (no racing for stacks). Ammo, health and Lady Luck
  parts on the floor go to whoever walks over them.
- **Your own shop.** Everyone plays the same seed, but each seat is dealt its
  own slice of it, so your shelf, your cards, your spins and your pulls are
  your own. Play the same seed from the same seat again and you get the same
  deal.
- **Shared doors.** A door anyone buys opens for everyone.
- **Your own everything else.** Your own cocktails, Lady Luck and ALL IN.
- **Rounds.** They start when everyone's done shopping, or when the host's
  timer runs out.
- **Going down.** You bleed out for 30 seconds. A red **REVIVE** cross floats
  over you (through walls, the same size at any distance) and blinks on
  everyone's radar. Any teammate who stands over you gets a **REVIVE** prompt;
  they hold **E** for 3 seconds (a bar fills) to deal you back in at half
  health. A revive beats anything else nearby that E would buy. Bleed out and
  you're back next round, if the table survives it. Everyone down at once and
  the house wins. Double Down Daiquiri still revives you on its own.
- **The scoreboard:** hold **TAB** for everyone at the table: ping, kills,
  deaths (every time you went down), damage dealt and chips in hand. It works
  alone too.
- **Ping** in the corner is your round trip to the host (the host reads 0).
- **Pausing** doesn't stop a co-op game.
- **If a guest leaves,** everyone else plays on (the host alone, if it was the
  last one). **If the host leaves,** the table closes. A game that crashes or
  loses its connection without saying goodbye is dropped after 45 seconds of
  silence. Alt-tabbing is fine: the heartbeat keeps going in the background.

Room codes go through the free **PeerJS** matchmaking service (0.peerjs.com).
After that each guest talks directly to the host (the host passes along what
the others need), with PeerJS's free relay servers as a fallback for strict
home networks. The library is `vendor/peerjs.min.js` (MIT, see
`vendor/PEERJS-LICENSE.txt`). The co-op code is in `src/net.js`.

The host should keep the game window open and on screen. A minimized browser
or game window stops rendering, which pauses the house for everyone.

## Art style: 1930s cartoon

The house now looks like a Golden Age cartoon, after early Fleischer Studios
and Disney shorts. Settings has an **Art style** switch, which restarts the
game to apply:

- **1930s Cartoon** (default): clean hand-inked outlines (anti-aliased, with
  just a hair of wobble). Soft cel-shaded light bands, lamp light in gentle
  painted rings, and full-detail textures leaning a little toward flat paint.
  A Technicolor grade with cream highlights and sepia blacks. A light touch of
  paper tooth, fine grain, rare dust and a warm vignette. A thin warm rim
  light separates characters and guns from the background. Only real light
  sources bloom, and the chandeliers are left un-inked so they read as brass
  and crystal.
- **1930s Black & White**: the same cartoon look as a silver-nitrate print, in
  the Betty Boop years. The HUD goes grey too.
- **Modern**: the original lit, glossy neon look.

The 1930s styles aren't just a filter. The characters, effects and UI are
built differently underneath:

- **Rubber-hose bodies.** The rig itself builds cartoon proportions:
  - a head 1.5× bigger, a round ball with a muzzle and button nose, seated
    down on the collar
  - everything below the neck at 82% height, so they sit low and cartoony
    without going lumpy
  - slim rubber-hose arms and legs
  - slightly narrow shoulders and a little bean of a belly
  - smooth, high-detail three-fingered white gloves with rolled cuffs
  - big round cartoon shoes
  - capes with real pleats and a scalloped hem
- **Ink-and-paint skins.** Each character's painted texture keeps its full
  detail (weave, stitching, buttons) with a lean toward flat cel colour, and
  gets anti-aliased ink lines where colours change. Hands are painted
  white, shoes glossy black. Zombie faces become a pale muzzle mask, a black
  button nose, heavy brows and a big toothy grin with a tongue. No gore.
  Everyone gets big pie-cut eyes (X X when knocked out). The dead are
  lopsided, with one eye popped wide and one drooping under a heavy lid, plus
  a stitched scar and sickly cartoon green-grey skin. The living players keep
  clean, even eyes.
- **Cartoon acting:**
  - smooth full-frame-rate animation (on-twos posing read as jitter next to
    the gliding bodies, so only the ink boil still runs at 12 a second)
  - they squash and stretch on every step and hop as they run
  - noodle arms swing and whip, heads bob on the beat
  - every hit squashes them flat for a beat before they spring back
  - dizzy stars circle a stunned or slipped head
  - runners kick up little dust clouds
  - a knocked-out zombie goes down in a puff with a little ghost floating up
    out of it
- **Hand-drawn effects** (drawn with deliberately wobbly lines):
  - impact stars and spark lines instead of blood
  - ink drops and ink-splat decals instead of blood pools
  - puffy ink-outlined cloud explosions with a spiky BANG in the middle
  - a spiky yellow BANG star for every muzzle flash
  - outlined smoke puffs
- **The print.** Early two-strip Technicolor colour (oranges and teals, no
  true blue), clean inked outlines, and a restrained film layer (faint paper
  fibre, fine grain, the odd dust speck, a whisper of flicker). The heavier
  pen skips, scratches and gate weave were dropped because they read as
  glitches on a modern screen.
- **1930s UI:**
  - every card and HUD box is a cream title card with a hand-inked border and
    a flat cartoon drop shadow
  - shop items are cream playing cards
  - lettering is Cooper Black and Showcard Gothic with inked outlines (Office
    fonts; without them it falls back to Rockwell/Georgia)
  - each round opens on its own cartoon title card ("A HOUSE OF THE UNDEAD
    CARTOON — THE GRAVEYARD SHUFFLE — ROUND 3"), irising in from a pinpoint
  - the shop and the end of a run iris out and back in

No bump maps in the 1930s modes. Cartoon surfaces are flat paint, and bumpy
normals made the carpet shimmer as pixels flipped across the cel-shading
bands. Modern mode is untouched by all of this. Where it lives:

| What | File |
|---|---|
| Style switch and shader patches | `src/gfx/style.js` |
| The film/ink pass | `TOON` in `src/gfx/postfx.js` |
| Rubber-hose bodies | `toonBody`, `toonHand`, `toonShoe` in `src/chars/rig.js` |
| Ink-and-paint skins and cartoon faces | `inkAndPaint`, `toonFace` in `src/chars/skins.js` |
| Acting, squash and stretch, dizzy stars | `src/chars/character.js` |
| The eyes | `pieEyes` in `src/chars/props.js` |
| Hand-drawn effect art | `src/gfx/toonart.js` (used by `src/effects.js`) |
| UI theme, iris and title cards | `body[data-art^="1930"]` rules in `styles/main.css`, and `ui.js` |

## Debug mode

Press **F3**, or pause (ESC) and click **DEBUG MODE**; it's also under
Settings. The panel has chips, heal, invulnerability, skip/jump rounds, rigged
blackjack/roulette, any gun, open every door, plus the new stuff: give Lady
Luck's parts (or Lady Luck herself), ALL IN the gun in your hands, spawn THE
KING / showgirls / a Jackpot, and teleport to THE CAGE, ALL IN, the craps
table or the house wheel. During a round, press ESC first to free the mouse,
then click.

### Rebuilding the exe after changing the game

```
powershell -ExecutionPolicy Bypass -File build-exe.ps1
```

Uses only what ships with Windows (the .NET Framework C# compiler) plus the
WebView2 SDK DLLs in `launcher\lib`, which get embedded into the exe.
`launcher\Launcher.cs` is the whole host program. Run the exe with `--windowed`
to start in a window, or `--debug` for DevTools (F12) and a remote-debugging
port on 9222.

### Developing in a browser

`python -m http.server 8000` in this folder, then http://localhost:8000.
`dev/lineup.html` shows every character side by side (walk / attack / die
buttons, atlas viewer); `dev/guns.html` shows the viewmodels.

No internet needed: Three.js is vendored locally, all sound is synthesized
live with WebAudio, and every texture is painted procedurally at load.

## The revamp

- **Real characters with skins.** Every zombie and both bosses are a single
  rigged, skinned body (torso, sculpted head with a face, neck, arms, hands
  with fingers, legs, shoes, optional coat tails) driven by a 20-bone
  skeleton — no more capsules. Each wears a painted 1024px texture atlas: suit
  jackets with lapels, pockets and buttons, vests, shirts, ties, creased
  trousers, leather shoes with laces, rotting skin with veins and wounds,
  sunken faces with teeth and glowing eyes, hair, blood and grime — plus
  roughness/metal maps and bump. Outfits are seeded so walkers vary (suit
  colors, ties, hats). 3D props: trilbies, top hats, bowler, pillbox cap,
  riot helmet, shades, earpiece, bow ties, a cocktail tray, briefcase,
  monocle, cape, pauldrons, gold chains, card fans, a slot-machine head.
- **Animation:** procedural gaits (shamble with a limp, heavy lurch, sprint,
  upright stalk), attack swipes / card throws / spits, hit flinches, rising
  out of the carpet on spawn, collapse-and-fall deaths, and heads that pop on
  headshot kills. Invisible bone-attached hitboxes are fitted to each body as
  built: an egg the shape of the head (a touch generous), and boxes that
  follow the torso and limb lengths, so they match the cartoon proportions.
- **The casino:** ornate carpet, damask wallpaper over wood wainscot, a
  coffered ceiling, crystal chandeliers, slot banks with lit art and stools,
  printed blackjack felt with chip stacks and cards, a spinning roulette dais
  behind velvet ropes, a marble bar with a back-lit bottle wall and mirror,
  the stage with pleated curtain and beams, a gold fountain. Static decor is
  merged into ~60 draw calls.
- **Lighting + post:** image-based reflections, HDR rendering, bloom (neon,
  eyes, slot screens, explosions), ACES tone mapping, vignette, grain.
  Graphics quality Ultra / High / Medium / Low in Settings (drops a step on
  its own if the frame rate struggles), plus a field-of-view slider. Ultra
  renders at up to 2x the screen resolution and scales down (supersampling)
  with 4x MSAA and a 4096 shadow map. It's picked automatically, once, when a
  dedicated graphics card (GeForce/RTX/Radeon RX/Arc) is detected. High and
  Ultra also anti-alias the ink lines.
- **Guns:** extruded, textured viewmodels (nickel + ivory revolver, walnut
  double-barrel, black SMG, brass lever-action with a bone stock) held in
  gloved hands with suit sleeves, drawn in their own pass so they never clip
  into walls. Star muzzle flashes, streak tracers, sparks where shots hit.
- **Effects:** GPU particle blood / smoke / fire / sparks, fireball
  explosions with shockwave rings and light flashes, blood pools and scorch
  decals, textured poker-chip pickups, spinning playing-card projectiles.
- **UI:** art-deco noir menus over a live 3D casino backdrop, a loading
  screen, new HUD (skewed bars, chip counter, weapon slots, CSS crosshair),
  real playing cards at the tables.

## Revamp 2: the shop, the score, the guns, the dark

- **THE HOUSE SHOP** (replaces picking a game + dialing in a bet). After every
  round the house deals 4 random cards; buy what you want, or nothing:
  - **Table cards** — BLACKJACK / ROULETTE / FIVE CARD DRAW with a tier
    printed on them. The price *is* the stake: buy it and you're seated.
    Win → an upgrade of that tier and your stake back ×2. Lose → that tier's
    penalty. COMMON 45–80 (mild), RARE 100–165 (moderate), LEGENDARY 185–290
    (severe). A natural blackjack, a flush-or-better poker hand, or a
    straight-up roulette hit pays a tier up.
  - **One-Armed Bandit** — a card of 3 or 5 prepaid pulls on LUCKY UNDEAD (see Revamp 5).
  - **Supplies** — first aid, smelling salts, ammo crate, kevlar.
  - **Lethals & tacticals** — a restock of what you carry, or a new one that
    swaps in for it (the card says which).
  - **Guns** — any gun you're not carrying; it swaps for the one in your hands
    if your slots are full. House specials show up as RARE FINDs.
  - **Charms** — Lucky Charm (next table win pays a tier up), House Insurance
    (next table loss is free), and the MYSTERY CARD (chips, a free upgrade, a
    heal and gear, a charm… or nothing).
  - **Upgrade cards** — occasionally an attachment for sale outright, no gamble.
  - Prices are rolled per card but kept within your means: they scale gently
    by round and are capped against your current bankroll, and the shelf
    always holds at least one card you can afford. Some shelves are great,
    some are junk — REROLL (20, +12 each time) or save your chips. Random SALE
    nights knock 30% off. Broke? The house fronts a free blackjack card.
- **The score** (since replaced by the jazz band in Revamp 5). Low health
  still muffles everything.
- **Real gun handling.** Recoil runs on damped springs, so every shot kicks,
  climbs, rolls and settles. The revolver's hammer falls and re-cocks while
  the cylinder indexes; the shotgun pumps after every shot; the rifle levers.
  Reloads are done by a real left hand: the revolver tips, swings its
  cylinder out, dumps six brass casings that bounce on the floor, then gets a
  speedloader, a twist, and a flick shut. The shotgun is rolled and fed
  shell by shell. The SMG's empty mag drops and clatters, then a fresh one is
  slapped in and the handle racked. The rifle gets cartridges through the
  gate and a lever cycle. Every step has its own foley. Pistol-whip swings,
  the chip bomb is wound up and thrown by hand, guns drop out and rise on a
  switch, and dry-firing clicks.
- **Immersion.** Head bob with footsteps, strafe lean, landing dips, a
  weapon that lags your mouse. When you're hit the view jolts away from the
  hit, a red arc points at the attacker, blood hits the screen, and the image
  splits for a moment. At low health the colour drains and the edges pulse
  red with your heartbeat. Dust hangs in the air and glows in the light.
- **Harsher light.** Real-time shadows from the chandeliers (off on Low).
  Three sweeping searchlights, visible light shafts under every chandelier,
  deeper blacks, and hotter bloom. The power stutters now and then mid-round:
  the lights flicker and the neon buzzes.

## Revamp 3: the building, the Coat Check, the bar, the gear

- **A bigger house.** The grand floor now has three wings behind gilded double
  doors. Walk up and **pay the doorman** (E) to open one — mid-round, CoD
  style. Opened wings stay open for the run, the dead can spawn in them, and
  they'll follow you through the doorways (real pathfinding now: a flow field
  over the whole building, straight chases when the line is clear). Bullets,
  spit and blasts all stop at walls; the radar draws the walls and doors.
  - **THE HIGH LIMIT ROOM** (300) — red velvet and gilded pilasters, black-and-
    gold marble, a spade rug, baccarat tables, leather banquettes, a
    champagne tower, its own chandelier.
  - **THE LITTLE CHAPEL OF THE DEAD** (250) — a 24-hour wedding chapel gone
    wrong: pews, an aisle runner, glowing stained glass, candelabras, an arch
    of dead roses and a coffin at the altar.
  - **THE COUNTING ROOM** (250) — concrete and steel, fluorescent tubes, the
    cash cage, counting tables, pallets of chips, and the vault door hanging
    open on a room full of gold.
- **THE COAT CHECK** (create-a-class). ENTER THE CASINO now goes through a
  screen with three claim tickets. Each is a class you name yourself: a
  **primary**, a **sidearm**, a **lethal**, a **tactical** and a **vice**.
  Tickets are saved. House picks to start: THE HIGH ROLLER, THE CARD SHARP,
  THE MOBSTER.
- **Ten guns** (you carry two, three with a Spritz; 1–3 or the mouse wheel):
  - Sidearms: **Lucky Seven** (revolver), **The Ace Up the Sleeve** (a
    two-shot pearl derringer that hits like a truck, break-open reload).
  - Primaries: **Riverboat Scattergun**, **Chip Spitter**, **The Loan Shark**
    (drum-fed tommy gun), **The Dealer's Shoe** (fires razor cards that slice
    through up to five zombies), **Boneyard Special** (needs the Vault's Gun
    Locker to check in).
  - House specials — only off THE BIG SIX or the shop: **The Magnum** (a
    champagne-bottle launcher firing exploding corks), **The Whale** (a
    big-game double rifle that punches through three), **Cherries Jubilee**
    (the bartender's flambé torch: a flamethrower that sets them burning).
  - Every new gun has its own model and real reload: the break-actions drop
    their barrels, kick the empties and take rounds from the left hand; the
    drum, the card deck and the fuel tank swap like magazines.
- **THE BIG SIX** — a real money wheel on the grand floor (120 a spin). The
  clapper ticks down the pegs; it lands on a gun that rises out of the
  pedestal for you to take — or on the skull, and the house keeps your chips.
- **The cocktail automats (perks)** — nine art-deco drink machines around the
  building; buy one mid-round (E) and your hand knocks the drink back. Four
  drinks max ("the house cuts you off"):
  - **DEAD WEIGHT STOUT** — max health doubled.
  - **DOUBLE DOWN DAIQUIRI** — go down and the house deals you back in at full
    health, throwing the crowd off you (3 per night).
  - **SLEIGHT OF HAND SLING** — reloads 45% faster, faster swaps.
  - **SNAKE EYES SHOOTER** — +30% fire rate, one hit in four lands twice.
  - **FAST MONEY FIZZ** — move 15% faster, dash back twice as quick.
  - **SPLIT THE PAIR SPRITZ** — a third gun slot.
  - **POWDER KEG PUNCH** — immune to explosions; every dash ends in a bang.
  - **LOOSE CHANGE LIQUEUR** — +30% chips, more drops, chips fly to you.
  - **DEAD EYE DRAM** — headshots +50%, +8% crit, steadier aim.
- **Lethals (G)**: **Chip Bomb**; **Flaming Sambuca** (a pool of fire that
  sets walkers alight); **The Velvet Rope** (a brass stanchion mine — nobody
  gets past the velvet rope); **False Jackpot** (a pocket slot machine rings a
  fake jackpot, every zombie in earshot crowds it, then it pays out in
  shrapnel).
- **Tacticals (T)**: **Butterfingers Bellini** (a spilled tray of drinks —
  the dead slip and land flat on their backs); **The Missing Clock** (a dome
  of slow time; even their spit crawls); **Paparazzi Flash** (blinds everything
  looking at it — don't look yourself); **Eye in the Sky** (the casino's dome
  camera on a tripod, with a gun, for 25 seconds).
- **Vices** (one per class): The Hustler (+25% chips, −20 health), Iron
  Stomach (five drinks, 10% pricier), Pack Rat (+1 lethal and tactical,
  −15% reserve ammo), Brawler (melee ×2.5 and heals, guns −10%), Quick Draw
  (swap twice as fast, sidearms +30%), Last Man Standing (+35% damage and
  +15% speed under 30% health), or Clean Living.
- Round-clear bonus now grows every round (60, then +12 per round).

## Revamp 4: LADY LUCK, ALL IN, and the Strip

- **LADY LUCK, the wonder weapon.** A gold-and-ivory ray gun with three slot
  reels on her flank, a green-glass chamber and a pair of loaded dice on a
  chain. Every shot throws a bolt of green luck that jumps from zombie to
  zombie (six of them, nine if she's gone ALL IN), stuns each one, and every
  kill spits chips. You build her from three parts, each won from a different
  game:
  - **THE GREEN ZERO**: land the ball on green. There's a new **GREEN 0** bet
    at the shop's roulette, and the floor roulette on the dais is now a real
    **HOUSE WHEEL** you can spin mid-round (60 a spin: red pays 2 to 1, black
    takes your chips). Any green counts. Until you have the part, the zero
    comes up more often after every miss, so nobody grinds forever.
  - **THE LOADED DICE**: roll a natural (7 or 11) at the new **craps table**
    on the grand floor (50 a roll). The dice really tumble across the felt
    and bounce off the back wall. 2, 3 or 12 is craps; any point gets half
    back.
  - **THE BANDIT'S ARM**: cash out a walking **JACKPOT** and its arm comes
    off. While you still need it, Jackpots show up far more often (from
    round 2).
  - Your parts show under the health bar, and they sit on a velvet tray at
    **THE CAGE** in the Counting Room. With all three, press E to assemble her
    (sparks fly) and take her. Once she's yours, the cage re-racks her ammo
    for 250.
- **ALL IN (pack-a-punch).** A gilded slot-press against the back wall of the
  High Limit Room. Push 1000 chips in and hand over the gun in your hands: the
  lever drops, the reels land on 7-7-7, the press slams, and the gun comes
  back gold-plated with a new name. It does double damage, holds 50% more in
  the mag and reserve, fires and reloads faster, crits more, and every kill
  pays chips. The gold names:
  - Lucky Seven: **SEVEN COME ELEVEN**
  - The Ace Up the Sleeve: **ACES HIGH**
  - Riverboat Scattergun: **THE RIVER CARD**
  - Chip Spitter: **THE MONEY PRINTER**
  - The Loan Shark: **THE COLLECTION AGENCY**
  - The Dealer's Shoe: **THE STACKED DECK**
  - Boneyard Special: **THE GRAVEYARD SHIFT**
  - The Magnum: **THE JEROBOAM**
  - The Whale: **THE WHITE WHALE**
  - Cherries Jubilee: **BAKED ALASKA**
  - Lady Luck: **LADY FORTUNE**
- **New dead on the floor:**
  - **SHOWGIRLS**: the midnight show never ended. Feather headdresses, tail
    plumes, pearls, fishnets. Fast, fragile, and they high-kick.
  - **THE KING**: white jumpsuit, gold cape, pompadour, aviators, a mic.
    Every few seconds he stops, strikes a pose and croons "uh-huh", and every
    zombie near him goes wild (faster, glowing pink). When he dies: "THE KING
    HAS LEFT THE BUILDING."
  - New special round **CHORUS LINE**: nothing but showgirls, for 1.5× chips.
- **More Las Vegas:**
  - The classic diamond **WELCOME TO FABULOUS LOST WAGES, NEVADA** sign, with
    chasing bulbs, as the lounge stage's backdrop, and a dead kick line of
    four showgirls doing the can-can in front of it.
  - The only window in the house: floor-to-ceiling glass in the High Limit
    Room looking out over the Strip at night (skyline, searchlights, the
    pyramid's beam).
  - A live **KENO** board drawing numbers, and new signs: LOOSE SLOTS, 99¢
    SHRIMP COCKTAIL, OPEN 24 HOURS, LIVE ENTERTAINMENT, FREE DRINKS, and a
    hanging CRAPS sign.
  - Sound: the casino PA's "ding-dong" and a muffled page, coins rattling
    into slot trays, the craps table cheering, a ghost playing the lounge
    piano, and cigarette smoke curling off the ashtrays.
- Packed guns show their gold names on the HUD. Saves keep your parts,
  Lady Luck, and every ALL IN gun.
- **The house comps you:** every cleared round gives back up to 50 health
  (`CONFIG.player.roundHeal` in `src/config.js`).
- The menus and HUD now use bold condensed signage caps, the way casino floor
  signs and slot cabinets do. Serif capitals are kept for the logo only, and
  there are no italics or extra-wide letter-spacing.

## Controls

| Key | Action |
|---|---|
| WASD | move |
| Mouse | look / LMB fire / RMB aim |
| Shift | sprint |
| Space | jump |
| **Q** | **dash** (brief invulnerability) |
| **G** | **lethal** (chip bomb, sambuca, velvet rope, false jackpot) |
| **T** | **tactical** (bellini, missing clock, paparazzi flash, eye in the sky) |
| **E** | **use / buy** — doors, cocktail automats, the Big Six |
| **F** | **melee** pistol-whip |
| R | reload |
| 1–3 / wheel | your guns (3 needs a Split the Pair Spritz) |
| Esc | pause |
| F11 | fullscreen / window |
| F3 | debug panel |
| TAB (hold) | scoreboard: ping, kills, deaths, damage, chips |
| H / S / D / P | blackjack: hit, stand, double, split |
| 1–5, SPACE | poker: hold, draw |
| SPACE, 1–3 | slots: pull (or stop the next reel), stop a reel |

## What's in this build

- **🎲 SEEDS**: every run is dealt from a seed; type one in at the Coat Check
  to play it (see Revamp 5)
- **♾ ENDLESS MODE**: beating round 10 no longer ends the run — the floor
  reopens. Keep going with a boss every 5th round (Pit Boss or House Dealer,
  scaling up), or hit CASH OUT at any intermission to bank the win. Dying deep
  in endless still counts as a victory, and deeper rounds mean fatter vault
  deposits
- **😤 THE BOSSES REMEMBER**: die to a boss and it holds the grudge across
  runs — +10% HP per unpaid debt (cap 5), personal taunts in the intro and on
  spawn. Finally beat it and you settle the grudge for +75 chips per debt

- The original four guns keep their fire animations: the Lucky Seven
  revolver's drum clicks around per shot, the Riverboat Scattergun racks its
  pump, the Chip Spitter's mag rattles on full auto, and the **Boneyard
  Special** swings its lever after every round (see Revamp 3 for the other six)
- 10 enemy types, all in casino dress: gambler walkers (trilby + loose tie),
  valet sprinters (red vest), bouncer brutes (suit + shades), cocktail-server
  spitters (serving tray of something toxic), high-roller gasbags (gold chain,
  explode on death), pit security guards (visor + pauldrons, weak head), and
  THE DEBT COLLECTOR (top hat + briefcase, steals chips — kill him to get them
  back with interest), plus three new faces: the CROUPIER (vest + green visor,
  flings 3-card razor bursts from range), the MAGICIAN (cape + top hat,
  teleports toward you in a purple poof), and the JACKPOT — a golden walking
  slot machine that flees; kill it inside 20 seconds for a 130-200 chip payout
  or it cashes out and leaves
- Blackjack with splits and doubles on 3D felt, cards dealt from the shoe,
  hole-card flip, and one-at-a-time dealer draws; roulette on a clickable
  layout with a counter-spinning ball that spirals into the winning pocket,
  plus a board of past spins; a win/lose glow on every table
- **Five card draw poker**: click cards to hold, one draw, beat the dealer —
  the card's tier sets the reward, and a flush or better bumps it a tier
- **Special rounds** (40% chance on non-boss rounds 3+): HIGH STAKES (double
  chips, +50% enemy damage), BLACKOUT (lights out), RUSH HOUR (all sprinters),
  HEAVYWEIGHT NIGHT (brutes and pit guards), VIP NIGHT (every zombie is a
  golden elite, chips x2). The chip multiplier applies to everything you earn
  that round, including the clear bonus
- **Round objectives** (50% chance on non-boss rounds 2+): optional side goals
  shown on the HUD — HEADHUNTER (8 headshots), UNTOUCHABLE (take no damage),
  DEMOLITION DERBY (6 explosion kills), SPEED CLEAR (under 60s). Complete for
  bonus chips, health, or grenades; no penalty for missing
- **Cursed upgrades** (purple cards, rare+ offers): real power with real
  downsides — Blood Pact (+40% damage, -25 max HP), Loaded Dice (+50% chip
  pickups, hits cost 5 chips), Devil's Reload (40% faster, 3 HP per reload),
  Glass Cannon (+25% crit, armor stops working), House Marker (+300 chips now,
  next wager loss is one penalty step nastier)
- **Synergy attachments**: Dash & Cash (+60% damage for 1.5s after dashing),
  Crit Comptroller (crits refund a chip bomb), Vampire Chips (chips heal you),
  Combo Insurance (+2s combo window), Last Call (final bullet in every mag
  deals triple)
- **LUCKY UNDEAD**, a three-reel one-armed bandit with five lines, played
  with the pulls on a One-Armed Bandit shop card (see Revamp 5)
- **Minimap radar**: top-left corner, rotates with your facing. Enemy dots
  colored by type (spitters green, the Debt Collector gold, brutes bigger),
  bosses as red rings, off-range threats pinned dim at the rim. Disabled by
  the same penalty that kills the threat indicator
- 6 weapon attachments x 3 tiers plus player upgrades: Running Shoes, Chip
  Magnet, Steel Toe, Quick Hands, Casino Insurance, Card Counter, High Roller
  Suite, Demolition License, Marked Cards
- Kill-combo chip multiplier (chain kills within 3.5s, up to x3)
- Loss penalties (mild/moderate/severe), boss phases, red-alert lighting
- **Bigger floor**: the arena grew ~40% (68m across) and gained a whole new
  wing — a raised stage with velvet curtain, mic stand, and colored
  spotlights ("LIVE TONIGHT"), a glowing fountain centerpiece, six slot banks,
  five card tables, and a longer bar. Spawns, radar range, boss teleports, and
  ambient chimes all scaled to match
- **Realistic casino undead**: corpse-flesh skin (every kind's color pulled
  toward grey-green decay), necks, festering wounds, lolling head tilts, torn
  suit trousers, gore-stained grasping hands, and per-zombie height variance —
  while keeping every casino outfit
- **Animation pass**: muzzle smoke that drifts up, bullet stagger on zombies,
  and varied death falls (sprinters corkscrew down) — gun handling is
  covered under Revamp 2 above
- **Full spatial 3D audio**: groans, deaths, acid spits, explosions, and boss
  telegraphs all pan and attenuate from their real positions — you hear the
  flank before you see it. Brutes, pit guards, and the Debt Collector have
  audible footsteps. Sounds coming from behind cover are muffled. The casino
  has a living ambient bed (crowd murmur, ghost slot payouts from the actual
  machine banks, neon buzz), and the score's tempo and tension scale with how
  many zombies are near you and how low your health is. All procedural
  WebAudio — still zero sound files
- **THE VAULT — meta progression**: 20% of every run's final chips (+2% per
  round reached, +10% for a win) banks permanently. Spend it on the main menu:
  Kevlar Vest (start with armor), Deep Pockets (+lethal capacity), Front Money
  (starting chips), Comped Rates (cheaper shop prices and rerolls),
  Regular's Card (a 5th shop card and a 4th upgrade card on every offer), Gun
  Locker (the Boneyard Special joins the Coat Check). Losing runs are deposits
  now. Farm-proof: only chips
  EARNED in the run deposit — Front Money starting chips are excluded
- **Mid-run saves**: your run snapshots at every intermission and after every
  purchase, table, and upgrade — closing the game resumes from the shop
  via a CONTINUE RUN button. Stakes save the moment they hit the table, so
  save-scumming a bad blackjack hand doesn't work
- Bug fix: Demolition License and Marked Cards were mutating global config and
  silently persisting across runs — now correctly per-run
- Reduced-flashing accessibility option, local high scores, F3 debug panel
- Feel pass: zombies walk with swinging limbs, lunge when they attack, and
  topple over when they die; muzzle flashes light the room; shell casings
  eject and bounce; blood / gold-spark impact particles; camera punch per
  shot; screen shake on explosions and boss slams; brief slow-mo on the last
  kill of a round and on boss defeats (shake is softened by reduced-flash)

## A note on this version

Only `index.html`, `main.js`, and `debug.js` survived from the previous build
(the folder upload came through empty), so every other module was rebuilt to
match those files' interfaces, then extended. Known crash sources fixed along
the way: the post-wager soft-lock (all panels hidden with no state resumed),
pointer-lock rejections when re-locking too fast after Esc, and a per-frame
crash guard so one bad frame logs to the console instead of freezing the game.

All chips and wagers are fictional game currency with no real-world value.
