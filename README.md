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
| At the base: walk (collects pads you cross) | WASD or arrows, relative to the camera | Drag on the left half (joystick) |
| At the base: turn the camera | Drag with the mouse | Drag on the right half |
| At the base: place a catch, or open a pad | Stand on the pad, press E | Stand on the pad, tap the action button |
| At the base: choose which catch to place | Q, Tab or 1–8 | Next button in the top tray |
| At the base: sell a carried catch | Its Sell button in the top tray | Its Sell button in the top tray |

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
- After landing, the player carries the catch home on their head. A tray at the top shows what's
  carried; the chosen one is highlighted (Q or Next changes it), and each card can be sold there (60
  seconds of its income). Stand on an empty pad and press E (or tap the action button) to place the
  chosen character. On a full pad, its panel can swap the chosen one in, selling the old one. The cannon stays locked until everything carried is placed or sold, and carried
  characters are saved.
- Each pad piles up its income, capped at 10 minutes. Walk over a pad to collect it.
- Character levels: characters gain XP from time on their pad (offline time counts). Once the XP bar
  on the pad's badge fills, open the pad's panel to level up for coins. Level 2 needs 1 minute of XP and
  30 seconds of the character's base income in coins; each level after needs 1.5× the XP and 1.6× the
  coins, up to level 10, and each level adds +25% income. The panel also sells the character (two
  taps).
- Pads glow in the rarity colour of their character.
- The base uses a third-person camera behind the player. Drag to turn it; WASD and the touch joystick
  move relative to it, easing in and out over about a tenth of a second, and the character turns
  smoothly toward where it's heading. Clicking and tapping don't move or select anything.
- The player has a walk cycle at the base, reaches up like Superman on the way up, flails spread-eagle
  with a wobble in free fall, and hangs from the straps under the parachute.
- Carry limit: 3 at the start, at most 8. Carry upgrades unlock once a run has reached Cloud Kingdom.
- Session gifts unlock at 5, 10, 20 and 40 minutes of play, worth 2 minutes of income (at least 100).
- Hints walk new players through collecting, the first cannon upgrade and the first base expansion.
- Each catch, and now and then a character at the base, chants its name with the browser's built-in
  text-to-speech, in a slow, deep delivery. It picks the best voice the device has: Italian first, then
  natural or online voices (Edge's Microsoft natural voices, Chrome's Google voices). That's a stand-in
  for recorded voice lines, and it sounds only as good as the voices installed.
- Hazards are birds below the Storm Layer, and prop planes and lightning clouds inside it. A flight
  that reaches the Storm Layer spawns nothing in Low Sky, which it crosses too fast to catch anything.
- Upgrades: cannon power (to level 37 in this build), carry limit (to 8), grab magnet (+10% grab radius each),
  steering (+6% turn speed each) and parachute (+5% safe window each).
- Rebirth unlocks at cannon level 28, whose normal launch reaches the Storm Layer. It resets coins,
  upgrades and pads, keeps the rarest character, adds +50% income per rebirth, and recolours the cannon.

- Offline earnings: characters keep earning while you're away, at half rate for up to 2 hours, paid on
  a welcome-back screen.
- Daily rewards: a 7-day login streak (coins, a guaranteed Rare on day 3, a guaranteed Epic on day 7).
  Missing a day restarts it. A brand-new player's first session skips it so play starts instantly.
- Collection book: every character as a silhouette until caught, with a one-time reward per completed
  zone (500, 5,000 and 50,000 coins).

Not in this build: fusion, sky events, the rival, the spin wheel, and ads.

## CrazyGames

The CrazyGames HTML5 SDK v3 loads from `index.html`, and `src/platform.ts` wraps it so the game runs
the same without it (blocked script, offline, or any domain other than localhost or CrazyGames).

- Loading start and stop around game setup.
- Gameplay start once the cannon (or the base) is ready, which is where CrazyGames measures the
  initial download. Gameplay stop and start around the shop and the landing reveal.
- Saves go through the SDK's data module, which follows a signed-in player across devices.
- CrazyGames' mute setting overrides the game's own. Test it locally with `?muteAudio=true`.
- A happytime celebration on Legendary catches and rebirths.
- No ads: CrazyGames disables them during Basic Launch. Rewarded ads come with Full Launch.

On localhost the SDK runs in its local mode and logs every call to the console.

### Upload

```bash
npm run build
```

Then zip the contents of `dist/` (not the folder itself) and upload the zip in the CrazyGames developer
portal. The build is 3 files and about 150 KB zipped, far under the 20 MB limit for the mobile
homepage.

## Economy simulator

```bash
npm run sim
```

It plays the real cost and placement rules with a simple player model and prints the median time to
each milestone over 200 simulated players. Try other numbers without editing the config:

```bash
SIM='{"cannon":{"growth":1.3},"economy":{"firstExpansion":600}}' npm run sim
```

With the current costs (cannon 25 × 1.5 per level), XP-gated levels and the carry unlock: first
upgrade at 1 minute, first Cloud Kingdom run at about 4 minutes, rebirth unlocked at about 63 minutes.
Offline earnings aren't modelled, so players who come and go will move faster. The cannon and base
expansions (1,000 × 5) were retuned from the design doc's first-pass 50 × 1.18 and 400 × 3, which
unlocked rebirth after 8 minutes.

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
| `src/meta.ts` | Offline earnings, the daily streak, and collection book pages |
| `src/platform.ts` | The CrazyGames SDK wrapper |
| `src/base.ts` | The pad grid, characters on pads, and cash piles |
| `src/characters.ts` | The 10 character models and their idle animations |
| `src/world.ts` | Gray-box scene: sky, cannon, player, hazards, labels |
| `src/scenery.ts` | Ground, hills, path, fence, trees, flowers, rocks and the pond |
| `src/fx.ts` | Particle bursts and wind streaks |
| `src/hud.ts` | HTML overlay: wallet, altitude, carry slots, meters, reveal, shop, gift, tuning panel |
| `src/input.ts` | Mouse, keyboard and touch input |
| `src/audio.ts` | Synthesised placeholder sounds |
| `src/store.ts` | Local save: coins, pads, upgrades, rebirths, flights, hints, settings |
| `scripts/sim.ts` | The economy simulator |

In dev builds, `window.game.debugStep(seconds)` advances the game at a fixed 60 fps,
`window.game.debugPaused = true` stops the frame loop, and opening the page with `?nosave` starts
fresh without reading or writing the real save. These are for scripted tests in throttled tabs.
