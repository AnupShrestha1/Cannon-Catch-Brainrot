# Cannon Catch Brainrot — gems and gacha (gray box)

Charge the cannon, fly up through the sky collecting gems, dodge hazards, open the parachute and land.
Back at the base, spend gems on the gacha machine for brainrots, put them on display in the showcase
where they earn coins, and spend coins on upgrades. Extra brainrots can be sold or merged into rarer ones.
It covers Low Sky, Cloud Kingdom and the Storm Layer with 10 characters, and adds rebirth.

Still to come: final art, recorded voice lines and music. Those need assets from outside this repo.

Design doc: https://claude.ai/artifact/EMeouczHhzvifYLtwFvrqL (it still describes catching brainrots in
the sky; this build replaces that with gems and a gacha machine).

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173. To test on a phone on the same Wi-Fi, run `npm run dev -- --host` and open
the Network URL it prints.

`npm run build` writes a static build to `dist/` (3 files).

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Charge, then fire | Hold and release Space or the mouse | Hold and release anywhere |
| Steer | Mouse position, or A/D or the arrow keys | Drag left and right |
| Parachute | Space or click | PARACHUTE button |
| At the base: walk (collects from slots you walk up to) | WASD or arrows, relative to the camera | Drag on the left half (joystick) |
| At the base: turn the camera | Drag with the mouse | Drag on the right half |
| Open the gacha machine or merge station | Step on its platform, press E | Step on its platform, tap the action button |
| At the base: level up a brainrot | Click Level up under it | Tap Level up under it |
| At the base: store or sell the brainrot you're next to | E | The action button |
| Backpack | Bag in the dock, or B | Bag in the dock |

Release the charge in the green band for +15% height, or the gold band for +30%.

## Rules in this build

- **Gems in the sky.** Each flight passes rows of gems along its path. A gem is worth 1 in Low Sky, 3 in
  Cloud Kingdom and 8 in the Storm Layer. One in ten is a big gold gem worth 5 times as much, and now
  and then gems come in pairs. A hazard hit knocks 15% of the run's gems loose. A crash loses 30% of
  them, or 50% without a parachute. There's no result window: on landing the gems go into the wallet
  with a toast, and the player stays where they landed, ready to walk.
- **Parachute warning**: if the parachute is still closed as the ground bar's marker gets within 0.6
  seconds of the red crash zone (the last part of the gold zone), PARACHUTE NOW! flashes for 1.2 seconds.
- **Town** (`src/layout.ts`): six plots in two rows of three, facing each other across a shared street.
  Every plot is the same base, built in plot space (cannon at the origin, gate toward the street);
  `toPlot` and `fromPlot` convert to and from the world. This client's plot is the middle of the near
  row, at the world origin, so its gameplay, cameras and flights are unchanged. The street has a
  fountain in the middle, lanterns along both kerbs and two live leaderboards (Top Earners, Top Flyers)
  in the gaps between plots. Fences hold everywhere but the gates, for every plot, and the fountain is
  solid; launching from someone else's plot or the street walks you back through your gate.
- **Fake multiplayer** (`src/net.ts`, `src/remote.ts`): a pretend server simulates a real lobby. The
  other plots are played by bots that use the real rules (the same pull, merge, upgrade and level code
  and costs as you).
  - **They move like players.** They run with momentum, ease in and out, curve through corners (aiming
    a little ahead along their route), turn at a limited rate and weave slightly on long runs. Each has
    its own running speed. They jump a lot while running, look around when they stop, spin now and then,
    give each other room, and sidestep or give up on a waypoint when they get stuck.
  - **The lobby lives.** The server holds 6. You usually join with three to five others, and
    matchmaking fills a free slot within 10 to 45 seconds (now and then it stays open for a minute or
    two). Sessions last from a few minutes to an hour; about half of the leavers go AFK first (their tag
    reads "Name · AFK"), some say "gtg bye", then they vanish in a puff. Players also go AFK for a minute
    or two mid-session. Newcomers appear in a puff by the fountain and walk to their plot through the
    gate; most return to saved progress, some are brand new.
  - **They talk.** Speech bubbles over their heads and lines in the feed: hellos for newcomers,
    questions that someone else answers a few seconds later ("how do u get gems" / "launch higher,
    cloud kingdom gems are x3"), passing remarks, "LETS GOOO" on their own Legendaries and "lucky" on
    other people's (yours included), and nobody repeats a line for a while.
  - **They visit.** Bots stroll the street and visit each other's bases and yours, walking in through the
    gate, looking around and sometimes commenting on the best brainrot there ("how did u get Frigorifero
    Fenicottero").
  - Each bot joins with progress played out offline by the same loop as the economy simulator, launches
    from its own cannon (up, free fall, parachute), pulls, merges, buys upgrades, levels up and rebirths.
  - The feed (bottom left) shows joins and leaves, Epic and Legendary pulls and merges, new zones,
    rebirths and chat. The online counter shows the server name and player count.
  - You can visit too: walk into anyone's plot through their gate ("Visiting Mia's base"), and the owner
    may say hi. Walk up to one of their brainrots and press E to see its level and income and give it a
    👍 (they'll thank you). Their machines are theirs, though.
  - The game only reads what a real server would send (player snapshots and events) and sends what a
    real client would (its stats, visits, likes, big moments), so a real server can replace `net.ts`.
  - To keep the frame rate up, other players' brainrots are only drawn when you're in their plot or at
    its gate, without shadows, and every plot's fence posts, poles and lanterns are drawn in batches.
- **Base layout**, following the sketch and lined up with the launch camera: the cannon stands on a round
  paved plaza; the showcase hall is straight behind it, its red carpet running across the plaza to the
  cannon; the gacha machine (left) and merge station (right) stand on the plaza's edge facing the cannon.
  One rectangular fence with bunting encloses it all, with a gate and path at the front. Lanterns ring the
  plaza and line the hall, with flower beds along the hall's sides. Outside the fence, the windmill and
  cottage sit behind the base on either side and the pond is off to the right.
- **Gacha machine**, on the left of the cannon. Step on the glowing pink platform in front of it and
  press E (walking past doesn't open anything):
  - Basic pull, 10 gems: Common 62%, Uncommon 28%, Rare 8%, Epic 1.8%, Legendary 0.2%.
  - Super pull, 100 gems, unlocked once a flight reaches Cloud Kingdom: always Rare or better (Rare 50%,
    Epic 38%, Legendary 12%). For the same gems it beats ten Basic pulls on every count, with pity
    included: about 1.4× the Legendaries (one per ~600 gems against ~820), 1.5× the Epics or better, and
    1.2× the value if everything were merged up. So once it's unlocked, saving for Super is the better
    buy, and Basic stays the cheap way in.
  - Ultra pull, 400 gems, unlocked once a flight reaches the Storm Layer: Epic 20%, Legendary 55%,
    Mythic 25%, with a Legendary or better at least every 3 pulls and a Mythic every 6. Per gem it
    beats Super too (0.76 Mythics, 2.05 Legendary-or-better and 3.7 Legendaries of merged value per
    1,000 gems, against Super's 0, 1.65 and 2.8).
  - Mythic is the new top rarity (350 coins/s), with two characters from the design doc: Razzo
    Rinoceronte (a rhino strapped to a sputtering rocket) and Satellito Gattino (a kitten with satellite
    dish ears that sweep the sky). Mythics come from the Ultra pull, or from merging three Legendaries.
  - Opening: the machine shakes silently and the sound comes when the capsule pops open. On the cards,
    every flip whooshes and pops, and Rare and better get a fanfare that grows with rarity. Epic and
    better flash the screen in their colour, turn light rays behind the card, burst confetti and show a
    big rarity banner. Legendary and Mythic hold back first: the card shakes and blazes with a rising
    whoosh before it turns. A Mythic also quakes the whole screen and has a rainbow banner and edge.
  - Each tier has a ×10 button once you can afford ten.
  - The first 10 pulls are scripted to include at least two Uncommons and one Rare: the 1st is at least
    Uncommon, the 3rd at least Rare (a glowing card at about 100 s) and the 5th at least Uncommon. The
    rest roll the normal odds and can come out better; from the 11th pull on, it's the normal odds and
    pity only.
  - Hidden pity, never shown to the player: on Basic pulls, every 15th pull without an Uncommon or better
    is one, and likewise a Rare by 30, an Epic by 60 and a Legendary by 90. On Super pulls: an Epic or
    better by 4 and a Legendary by 10. Each counter resets when that rarity or better comes up, by luck
    or by pity, so an Uncommon on pull 2 means the next guaranteed one is pull 17, not pull 15.
  - Results go on display by themselves: empty slots fill best first, and a rarer pull swaps out a
    level-1 brainrot (which goes to the backpack with its coins collected). Levelled ones are never moved.
    Then the cards are revealed like trading cards (no pack to open): dealt face down, rarest last, each
    flipped with a tap (or Flip all, or Space). Rare and better glow through their backs and wobble first;
    the front is a framed card with the brainrot's art, income, rarity stars and a NEW badge, and Epic and
    better have holo foil. Continue goes back to the machine's panel, so pulling again is one click.
    Merges reveal their results the same way.
- **Merge station**, a bubbling cauldron on the right of the cannon. Step on the purple platform in front
  of it and press E: 10 Common → 1 Uncommon, 8 Uncommon →
  1 Rare, 6 Rare → 1 Epic, 4 Epic → 1 Legendary, 3 Legendary → 1 Mythic, from the backpack. A merge gives a random character of
  the next rarity. Merge all runs every recipe from the bottom up in one click, and merged brainrots go
  on display if they beat what's there.
- **Backpack**: brainrots not on display. Sell one or all of a rarity (60 seconds of its income each),
  put one on display, or merge a rarity.
- **Showcase**: a stone hall with a red carpet down the middle and two rows of 5 slots either side,
  laid out like the sketch. 4 slots are open at the start; locked ones are roped off, and each base
  expansion in Upgrades opens 2 more (600, then 3,600, then 21,600 coins). Empty open slots pulse a
  ring of light.
- **Slots**: a brainrot on display earns coins once a second by rarity (Common 1/s up to Legendary 90/s),
  up to 10 minutes' worth. The coins waiting show as a big gold coin spinning slowly over its head, with
  the amount above it. Pedestals are solid: walk up to one to collect its coins. Right under each
  brainrot within about 11 m, a Level up button shows its XP (earned on display) and, once full, the
  price: click it to level up. Standing next to a slot and pressing E opens its panel to store it in
  the backpack (back to level 1) or sell it. Slots glow in their brainrot's rarity colour.
- **Walking at the base**: the cannon, both stations, the pedestals and the showcase's low walls are
  solid (you slide around them), and you step up onto the station platforms and the showcase floor.
- **Tutorial**: flight 1 is a straight line of 12 gems, enough for the first pull. Hazards start on
  flight 3, and nothing is lost to hits or crashes during the first 3 flights. A coach guides new
  players: a big bouncing yellow banner says what to do, and a cartoon hand shows how. It presses and
  holds to charge, swipes to steer on flight 2, taps the parachute (or says to press Space), and at the
  base points down at the next button (the action button once you're on a platform, Upgrades, Launch).
  When the next step is to walk somewhere, it shows the WASD keys (a dragging thumb on touch) and a
  trail of gold chevrons on the ground flows from the player to the goal, with a green arrow bobbing
  over it. From flight 2, the apex shows the next zone's gem value and the cannon level that reaches it.
- **New zones**: entering a zone on the way up shows its name and gem value; the first time ever, it's a
  big NEW ZONE banner with a sparkle and a moment of slow motion. The cannon's first levels climb fast
  (90 m at level 1, 155 m at level 6), so a good launch reaches Cloud Kingdom within the first few
  minutes; after that, each level adds less (410 m at level 28).
- **Upgrades**: cannon power (to level 37 in this build), gem finder (+10% gems per pickup each), gem
  magnet (+10% grab radius each), steering (+6% turn speed each), parachute (+5% safe window each), and
  showcase slots.
- **Rebirth** unlocks at cannon level 28, whose normal launch reaches the Storm Layer. It resets coins,
  gems, upgrades, slots and the backpack, keeps the rarest brainrot, adds +50% income per rebirth, and
  recolours the cannon.
- Offline earnings: brainrots keep earning while you're away, at half rate for up to 2 hours.
- Daily rewards: a 7-day login streak (coins, a Rare on day 3, an Epic on day 7, both to the backpack).
- Collection book: every character as a silhouette until pulled, with a one-time reward per completed
  page (500, 5,000 and 50,000 coins).
- Session gifts: 20 gems at 2 minutes (two more pulls, to keep a new player going), then 30 gems and a
  minute of income at 5 minutes, 50 gems and 2 minutes at 10, 100 gems (a Super pull) and 2 minutes at
  20, and 200 gems and 4 minutes at 40.
- **Voices**: when a Rare or better is revealed, it sings its name in a generated babble (like the
  gibberish voices in cosy games), built from the syllables of its name with its own pitch and rhythm;
  rarer ones sing lower and longer with an echo. Brainrots no longer call out from the base while idle.
- **Sounds**, all synthesised: soft footsteps at the base, capsule pop, card flips, fanfares by rarity,
  suspense whoosh, cash register on upgrades, level-up scale, bubbling merge, new-zone call, panel
  whoosh, coins, gems, launch boom, wind, parachute, hits and landings.

Older saves carry over: catches that were being carried go to the backpack, and bases bigger than 10
slots move their extra brainrots to the backpack.

Not in this build: fusion of named characters, sky events, the rival, the spin wheel, and ads.

## Look

- **UI**: chunky candy-coloured cartoon style. Lilita One for titles and numbers and Fredoka for text
  (from Google Fonts, with system fallbacks), glossy 3D buttons with thick ink outlines that press down,
  currency pills, a dock of icon tiles (Upgrades, Bag, Book), a prompt banner, and panels
  that open with a coloured ribbon.
- **Cannon, gacha machine and cauldron**: smooth and glossy. The cannon is a turned barrel with brass
  bands, trunnions and a muzzle ring, on a carriage with spoked wheels over a round stone base; the gacha
  machine has a rounded body and a shiny glass globe of capsules; the cauldron has a rounded belly on
  three legs over a crackling fire, a gold rim and handles, and a bubbling, glowing brew.
- **Brainrot icons**: every card shows that character's own portrait, rendered once from its 3D model
  and cached. Characters not yet pulled show as a dark silhouette in the book.
- The player is a blocky avatar with rounded edges: a square head with a drawn face, a cap, a T-shirt,
  jeans and sneakers. It has a walk cycle at the base, reaches up on the way up, flails in free fall and
  hangs from the straps under the parachute.
- Brainrots are cel-shaded with a dark outline, round cartoon eyes with a shine, and a smile. On display
  they bounce gently, and land with a squash when placed.
- The world around the base has a gradient sky with a sun, sun shadows, swaying trees, mountains, a
  windmill, a cottage, a pond, lanterns, bunting and butterflies.

## CrazyGames

The CrazyGames HTML5 SDK v3 loads from `index.html`, and `src/platform.ts` wraps it so the game runs
the same without it (blocked script, offline, or any domain other than localhost or CrazyGames).

- Loading start and stop around game setup.
- Gameplay start once the cannon (or the base) is ready. Gameplay stop and start around menus and the
  landing result.
- Saves go through the SDK's data module, which follows a signed-in player across devices.
- CrazyGames' mute setting overrides the game's own. Test it locally with `?muteAudio=true`.
- A happytime celebration on Legendary pulls and merges, and on rebirth.
- No ads: CrazyGames disables them during Basic Launch.

On localhost the SDK runs in its local mode and logs every call to the console.

### Upload

```bash
npm run build
```

Then zip the contents of `dist/` (not the folder itself) and upload the zip in the CrazyGames developer
portal.

## Economy simulator

```bash
npm run sim
```

It plays the real cost, gacha and merge rules with a simple player model and prints the median time to
each milestone over 200 simulated players. Try other numbers without editing the config:

```bash
SIM='{"cannon":{"growth":1.3},"gems":{"bigChance":0.2}}' npm run sim
```

It reports the first two minutes (the hook) and the long game. With the current numbers:

| When | What happens |
| --- | --- |
| 33 s | First pull (an Uncommon or better) |
| 67 s | First cannon upgrade |
| 100 s | Third pull: a guaranteed Rare, the first glowing card |
| 101 s | First brainrot level-up |
| 2 min | Gift: 20 gems, two more pulls |
| 2.3 min | First Cloud Kingdom run: new-zone banner, gems worth 3× |
| 4.6 min | Super pull unlocked and used |
| 5 min | First Epic |
| 7 min | First showcase expansion |
| 11 min | First Legendary on display |
| 25 min | All 10 slots open |
| 37 min | First Storm Layer run |
| ~60 min | Rebirth unlocks |

By 2 minutes the median player has had 8 rewards (pulls, upgrades and level-ups), has cannon level 5
and earns about 12 coins a second, and every simulated player has a Rare. Each big milestone after
that takes roughly twice as long as the one before. Offline earnings aren't modelled.

It also prints each gacha tier's value per 1,000 gems, pity included, so a pricier tier is always
checked to be worth more per gem (Super: 1.67 Legendaries and 5.6 Epic-or-better per 1,000 gems,
against Basic's 1.21 and 3.5).

## Tuning

Press **T** (or the Tune button) for the tuning panel: cannon level (1–37 in this build), hazards, coin
buttons (+1K to +1B), gem buttons (+10 to +10K), and a full reset that needs a second tap. **M** mutes.
All first-pass numbers live in `src/config.ts`.

## Code map

| File | What it does |
| --- | --- |
| `src/config.ts` | Rarities, roster, zones and their gem values, gacha tiers, merge recipe, upgrades, economy |
| `src/game.ts` | The state machine: run, landing, base, gacha, merging, backpack, level-up buttons, shop, tutorial arrows, camera |
| `src/economy.ts` | Upgrade costs, income, slots, pulls with hidden pity, merging and selling |
| `src/meta.ts` | Offline earnings, the daily streak, and collection book pages |
| `src/platform.ts` | The CrazyGames SDK wrapper |
| `src/base.ts` | The showcase hall, its pedestals, brainrots and coins, and the gacha machine and merge station by the cannon |
| `src/characters.ts` | The 10 character models and their idle animations |
| `src/world.ts` | Sky pieces, cannon, player avatar, gems, hazards, guide arrows, labels |
| `src/layout.ts` | The town: plot slots, the street, fences and walking limits, for multiplayer |
| `src/net.ts` | The fake multiplayer server: bot players on the real economy, events, chat, standings |
| `src/remote.ts` | Draws other players (avatars, name tags, poses, parachutes) and their plots from server snapshots |
| `src/scenery.ts` | Sky dome, ground, hills, mountains, path, lanterns, fence and bunting, swaying trees, cottage, windmill, pond, butterflies |
| `src/fx.ts` | Particle bursts and wind streaks |
| `src/hud.ts` | HTML overlay: wallet and gems, altitude, run gems, meters, dock, shop, modals, level-up buttons, tuning panel |
| `src/icons.ts` | Brainrot portraits for cards, rendered from the 3D models |
| `src/input.ts` | Mouse, keyboard and touch input |
| `src/audio.ts` | Synthesised placeholder sounds |
| `src/store.ts` | Local save: coins, gems, slots, backpack, upgrades, rebirths, flights, hints, settings |
| `scripts/sim.ts` | The economy simulator |

In dev builds, `window.game.debugStep(seconds)` advances the game at a fixed 60 fps,
`window.game.debugPaused = true` stops the frame loop, and opening the page with `?nosave` starts
fresh without reading or writing the real save. These are for scripted tests in throttled tabs.
