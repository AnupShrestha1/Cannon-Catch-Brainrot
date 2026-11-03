# Cannon Catch Brainrot — Phase 1 prototype

A gray-box build of one run: charge the cannon, fly up through Low Sky, grab characters, dodge birds,
open the parachute and land. Its job is the Phase 1 gate in the design doc: testers want another run
even without upgrades. There is no base, income or upgrades yet.

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

Release the charge in the green band for +15% height, or the gold band for +30%.

## Rules in this build

- The flight goes straight up and back down in one vertical plane.
- A full stack swaps its lowest-rarity character for a rarer one; equal or lower ones are passed by.
- A bird hit knocks off the lowest-rarity character, which tumbles down and can be caught again.
- Nothing can be grabbed under the parachute. Opening with under 0.6 s to impact tangles it.
- A crash drops 30% of the stack (no parachute: 50%), never the rarest one.
- Tutorial: flight 1 has one Common straight ahead, birds start on flight 3, flight 3 has a guaranteed
  Rare, and nothing is dropped during the first 3 flights.

## Tuning

Press **T** (or the Tune button) for the tuning panel: cannon level 1–60, carry limit and hazards. It
can also reset the tutorial. **M** mutes. All first-pass numbers live in `src/config.ts`.

## Code map

| File | What it does |
| --- | --- |
| `src/config.ts` | Rarities, roster, zones, height curve, and every tuning number |
| `src/game.ts` | The run's state machine, flight, collisions, landing and camera |
| `src/world.ts` | Gray-box meshes: sky, ground, cannon, player, characters, birds |
| `src/fx.ts` | Particle bursts and wind streaks |
| `src/hud.ts` | HTML overlay: altitude, carry slots, meters, reveal screen, tuning panel |
| `src/input.ts` | Mouse, keyboard and touch input |
| `src/audio.ts` | Synthesised placeholder sounds |
| `src/store.ts` | Local save (flight count, best height, tuning) |

In dev builds, `window.game.debugStep(seconds)` advances the game at a fixed 60 fps and
`window.game.debugPaused = true` stops the frame loop, for scripted tests in throttled tabs.
