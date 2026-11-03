# Cannon Catch Brainrot — Phase 3 launch content (gray box)

The game's Basic Launch content, still in gray-box art: charge the cannon, fly up, grab characters,
dodge hazards, open the parachute, land, then take the catch home. Characters on pads earn coins, and
coins buy five upgrade tracks and more pads. It covers Low Sky, Cloud Kingdom and the Storm Layer with
10 characters, scripts the design doc's first 5 minutes, and adds rebirth.

Still to come for Phase 3: final art, recorded voice lines and music. Those need assets from outside
this repo.

Design doc: https://claude.ai/artifact/EMeouczHhzvifYLtwFvrqL

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173. To test on a phone on the same Wi-Fi, run `npm run dev -- --host` and open
the Network URL it prints.

`npm run build` writes a static build to `dist/` (about 0.5 MB, 3 files).

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Charge, then fire | Hold and release Space or the mouse | Hold and release anywhere |
| Steer | Mouse position, or A/D or the arrow keys | Drag left and right |
| Parachute | Space or click | PARACHUTE button |
| At the base: walk, collect | Click a pad or the ground | Tap a pad or the ground |
| At the base: back to the cannon | Space, Launch!, or click the cannon | Launch!, or tap the cannon |

Release the charge in the green band for +15% height, or the gold band for +30%.

## Rules in this build

- The flight goes straight up and back down in one vertical plane.
- A full stack swaps its lowest-rarity character for a rarer one; equal or lower ones are passed by.
- A bird hit knocks off the lowest-rarity character, which tumbles down and can be caught again.
- Nothing can be grabbed under the parachute. Opening with under 0.6 s to impact tangles it.
- A crash drops 30% of the stack (no parachute: 50%), never the rarest one.
- Tutorial: flight 1 has one Common straight ahead, birds start on flight 3, flight 3 has a guaranteed
  Rare, and nothing is dropped during the first 3 flights. From flight 4, the apex shows a silhouette
  from the next locked zone and the cannon level that reaches it.
- At the base, catches fill free pads. A full base sells its weakest character to make room for a rarer
  catch, and sells catches that aren't better. Selling pays 60 seconds of income.
- Each pad piles up its income, capped at 10 minutes. Walk over a pad to collect it.
- Session gifts unlock at 5, 10, 20 and 40 minutes of play, worth 2 minutes of income (at least 100).
- Hints walk new players through collecting, the first cannon upgrade and the first base expansion.
- Each catch, and now and then a character at the base, chants its name with the browser's built-in
  text-to-speech. That's a stand-in for recorded voice lines.
- Hazards are birds below the Storm Layer, and prop planes and lightning clouds inside it. A flight
  that reaches the Storm Layer spawns nothing in Low Sky, which it crosses too fast to catch anything.
- Upgrades: cannon power (to level 37 in this build), carry limit, grab magnet (+10% grab radius each),
  steering (+6% turn speed each) and parachute (+5% safe window each).
- Rebirth unlocks at cannon level 28, whose normal launch reaches the Storm Layer. It resets coins,
  upgrades and pads, keeps the rarest character, adds +50% income per rebirth, and recolours the cannon.

Not in this build: offline earnings, character levels, fusion, sky events, the rival, the collection
book, and the CrazyGames SDK.

## Economy simulator

```bash
npm run sim
```

It plays the real cost and placement rules with a simple player model and prints the median time to
each milestone over 200 simulated players. Try other numbers without editing the config:

```bash
SIM='{"cannon":{"growth":1.3},"economy":{"firstExpansion":600}}' npm run sim
```

With the current costs: first upgrade at 1 minute, first Cloud Kingdom run at 4 minutes, rebirth
unlocked at about 55 minutes. The cannon (35 × 1.42 per level) and base expansions (1,000 × 5) were
retuned from the design doc's first-pass 50 × 1.18 and 400 × 3, which unlocked rebirth after 8 minutes.

## Tuning

Press **T** (or the Tune button) for the tuning panel: cannon level (1–37 in this build), carry limit,
hazards, a +1,000 coins button, and a full reset. **M** mutes. All first-pass numbers live in
`src/config.ts`.

## Code map

| File | What it does |
| --- | --- |
| `src/config.ts` | Rarities, roster, zones, height curve, upgrades, economy, and every tuning number |
| `src/game.ts` | The state machine: run, landing, base, shop, hints, and camera |
| `src/economy.ts` | Upgrade costs, income, pad expansion, and placing or selling catches |
| `src/base.ts` | The pad grid, characters on pads, and cash piles |
| `src/characters.ts` | The 10 character models and their idle animations |
| `src/world.ts` | Gray-box scene: sky, ground, cannon, player, hazards, labels |
| `src/fx.ts` | Particle bursts and wind streaks |
| `src/hud.ts` | HTML overlay: wallet, altitude, carry slots, meters, reveal, shop, gift, tuning panel |
| `src/input.ts` | Mouse, keyboard and touch input |
| `src/audio.ts` | Synthesised placeholder sounds |
| `src/store.ts` | Local save: coins, pads, upgrades, rebirths, flights, hints, settings |
| `scripts/sim.ts` | The economy simulator |

In dev builds, `window.game.debugStep(seconds)` advances the game at a fixed 60 fps,
`window.game.debugPaused = true` stops the frame loop, and opening the page with `?nosave` starts
fresh without reading or writing the real save. These are for scripted tests in throttled tabs.
