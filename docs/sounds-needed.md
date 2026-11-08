# Sounds to provide

Every sound in the game today is synthesised in code (`src/audio.ts`), so the game ships no audio files.
These are the sounds where a recorded or produced file would clearly beat what code can make. Drop the
files in `public/audio/` with these names (OGG or MP3, 44.1 kHz, as short as possible) and they can be
wired in to replace the synthesised versions.

## Music (the biggest gap)

| File | What | Length |
| --- | --- | --- |
| `music-base.ogg` | Upbeat, light loop for the base and showcase: bouncy, toy-like, not tiring on repeat | 60–90 s loop |
| `music-flight.ogg` | Faster, airier loop while flying; could layer over the base track | 30–60 s loop |
| `music-storm.ogg` | Darker, more dramatic variation for the Storm Layer | 30–60 s loop |

## Voices

| File | What |
| --- | --- |
| `voice-<character>.ogg` | One chanted voice line per brainrot (12 now: 10 + 2 Mythics), 2–3 s, a deep dramatic "narrator" saying the name, in the meme style. These replace the generated babble. |

## Big moments

| File | What |
| --- | --- |
| `reveal-legendary.ogg` | A short orchestral hit or choir "ahh" for a Legendary card turning |
| `reveal-mythic.ogg` | A bigger version for Mythic: hit, choir, sparkle tail |
| `fanfare-zone.ogg` | A short triumphant sting for reaching a new zone |
| `rebirth.ogg` | A grand whoosh-and-chime for rebirth |

## World and effects

| File | What |
| --- | --- |
| `cannon-boom.ogg` | A punchy cartoon cannon blast |
| `parachute-open.ogg` | Cloth snapping open |
| `landing-splat.ogg` | A comic splat or crash for a bad landing |
| `gacha-crank.ogg` | The machine's crank turning (only if you want a sound while it shakes) |
| `capsule-pop.ogg` | A plastic capsule popping open |
| `cauldron-loop.ogg` | Soft bubbling, looping, quiet, near the merge station |
| `ambient-base.ogg` | Very quiet birds and breeze at the base, looping |
| `footstep-grass.ogg`, `footstep-stone.ogg` | 2–3 soft variations each |

## Interface

| File | What |
| --- | --- |
| `ui-click.ogg` | A soft, rounded button click |
| `ui-buy.ogg` | A cheerful purchase "ka-ching" |
| `ui-error.ogg` | A gentle "nope" for when something can't be afforded |
