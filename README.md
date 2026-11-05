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
| At the base: walk (collects slots you cross) | WASD or arrows, relative to the camera | Drag on the left half (joystick) |
| At the base: turn the camera | Drag with the mouse | Drag on the right half |
| Open the gacha machine or merge station | Step on its platform, press E | Step on its platform, tap the action button |
| At the base: level up a brainrot | Click Level up under it | Tap Level up under it |
| At the base: store or sell the brainrot you stand on | E | The action button |
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
- **Gacha machine**, to the right of the cannon. Step on the glowing pink platform in front of it and
  press E (walking past doesn't open anything):
  - Basic pull, 10 gems: Common 62%, Uncommon 28%, Rare 8%, Epic 1.8%, Legendary 0.2%.
  - Super pull, 100 gems, unlocked once a flight reaches Cloud Kingdom: Uncommon 35%, Rare 40%, Epic
    18%, Legendary 7%.
  - Each tier has a ×10 button once you can afford ten.
  - The very first pull is at least Uncommon.
  - Hidden pity, never shown to the player: on Basic pulls, every 15th pull without an Uncommon or better
    is one, and likewise a Rare by 30, an Epic by 60 and a Legendary by 90. On Super pulls: a Rare by 5,
    an Epic by 12 and a Legendary by 30. Each counter resets when that rarity or better comes up, by luck
    or by pity, so an Uncommon on pull 2 means the next guaranteed one is pull 17, not pull 15.
  - Results go on display by themselves: empty slots fill best first, and a rarer pull swaps out a
    level-1 brainrot (which goes to the backpack with its coins collected). Levelled ones are never moved.
    The machine's panel then reopens with the results on top, so pulling again is one click.
- **Merge station**, a bubbling cauldron to the left of the cannon. Step on the purple platform in front
  of it and press E: 10 Common → 1 Uncommon, 8 Uncommon →
  1 Rare, 6 Rare → 1 Epic, 4 Epic → 1 Legendary, from the backpack. A merge gives a random character of
  the next rarity. Merge all runs every recipe from the bottom up in one click, and merged brainrots go
  on display if they beat what's there.
- **Backpack**: brainrots not on display. Sell one or all of a rarity (60 seconds of its income each),
  put one on display, or merge a rarity.
- **Showcase**: a stone hall with a red carpet down the middle and two rows of 5 slots either side,
  laid out like the sketch. 4 slots are open at the start; locked ones are roped off, and each base
  expansion in Upgrades opens 2 more (1,000, then 5,000, then 25,000 coins). Empty open slots pulse a
  ring of light.
- **Slots**: a brainrot on display earns coins once a second by rarity (Common 1/s up to Legendary 90/s),
  up to 10 minutes' worth. The coins waiting show as a big gold coin spinning slowly over its head, with
  the amount above it. Walk over a slot to collect. Under each brainrot a Level up button shows its XP
  (earned on display) and, once full, the price: click it to level up. Standing on a slot and pressing
  E opens its panel to store it in the backpack (back to level 1) or sell it. Slots glow in their
  brainrot's rarity colour.
- **Tutorial**: flight 1 is a straight line of 12 gems, enough for the first pull. Hazards start on
  flight 3, and nothing is lost to hits or crashes during the first 3 flights. At the base, a green
  arrow bobs over the next place to go (a station's platform, coins to collect, a brainrot ready to
  level up), and a gold
  arrow with a dark outline on the ground by the player points the way. When the next step is a
  button (Upgrades, Launch), that button bounces instead. From flight 4, the apex
  shows the next zone's gem value and the cannon level that reaches it.
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
- Session gifts unlock at 5, 10, 20 and 40 minutes of play.
- Each pull, and now and then a brainrot on display, chants its name with the browser's text-to-speech.

Older saves carry over: catches that were being carried go to the backpack, and bases bigger than 10
slots move their extra brainrots to the backpack.

Not in this build: fusion of named characters, sky events, the rival, the spin wheel, and ads.

## Look

- **UI**: chunky candy-coloured cartoon style. Lilita One for titles and numbers and Fredoka for text
  (from Google Fonts, with system fallbacks), glossy 3D buttons with thick ink outlines that press down,
  currency pills, a dock of icon tiles (Upgrades, Bag, Book), a prompt banner, and panels
  that open with a coloured ribbon.
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

With the current numbers: first pull after flight 1, first cannon upgrade at about 1 minute, first Cloud
Kingdom run at about 6 minutes, first Legendary on display at about 24 minutes, all 10 slots open at
about 40 minutes, and rebirth unlocked at about 88 minutes. Offline earnings aren't modelled.

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
