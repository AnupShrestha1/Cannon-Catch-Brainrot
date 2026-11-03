# Cannon Catch Brainrot — Phase 2 vertical slice

A gray-box build of the core loop: charge the cannon, fly up, grab characters, dodge birds, open the
parachute, land, then take the catch home. At the base, characters on pads earn coins, and coins buy
cannon power, carry limit and more pads. It covers Low Sky and Cloud Kingdom with 6 characters, and
scripts the design doc's first 5 minutes. Its job is the Phase 2 gate: the first 5 minutes hook new
testers.

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

Not in this slice: offline earnings, character levels, rebirth, fusion, sky events, the rival, the
collection book, and the CrazyGames SDK.

## Tuning

Press **T** (or the Tune button) for the tuning panel: cannon level (1–20 in this slice), carry limit,
hazards, a +1,000 coins button, and a full reset. **M** mutes. All first-pass numbers live in
`src/config.ts`.

## Code map

| File | What it does |
| --- | --- |
| `src/config.ts` | Rarities, roster, zones, height curve, upgrades, economy, and every tuning number |
| `src/game.ts` | The state machine: run, landing, base, shop, hints, and camera |
| `src/economy.ts` | Upgrade costs, income, pad expansion, and placing or selling catches |
| `src/base.ts` | The pad grid, characters on pads, and cash piles |
| `src/characters.ts` | The 6 character models and their idle animations |
| `src/world.ts` | Gray-box scene: sky, ground, cannon, player, birds, labels |
| `src/fx.ts` | Particle bursts and wind streaks |
| `src/hud.ts` | HTML overlay: wallet, altitude, carry slots, meters, reveal, shop, gift, tuning panel |
| `src/input.ts` | Mouse, keyboard and touch input |
| `src/audio.ts` | Synthesised placeholder sounds |
| `src/store.ts` | Local save: coins, pads, upgrades, flights, hints, settings |

In dev builds, `window.game.debugStep(seconds)` advances the game at a fixed 60 fps,
`window.game.debugPaused = true` stops the frame loop, and opening the page with `?nosave` starts
fresh without reading or writing the real save. These are for scripted tests in throttled tabs.
