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
| Aim the cannon (a slight swing) | Mouse position, or A/D or the arrow keys | Drag left and right |
| Charge, then fire | Hold and release Space or the mouse | Hold and release anywhere |
| Steer | Mouse position, or A/D or the arrow keys | Drag left and right |
| Parachute | Space or click | PARACHUTE button |
| At the base: walk (collects from slots you walk up to) | WASD or arrows, relative to the camera | Drag on the left half (joystick) |
| At the base: jump | Space | |
| At the base: turn and tilt the camera (drag up to look up at people flying) | Drag with the mouse | Drag on the right half |
| Pull a gacha machine | Stand on its ×1 or ×10 pad, press E | Stand on a pad, tap the action button |
| Merge station, shop | Step on the cauldron's platform or the shop's rug, press E | Same, tap the action button |
| Launch | Launch button or F (walks over from nearby, teleports from afar) | Launch button |
| Get in the cannon / climb out | E next to the cannon, any side / Exit button or Q | Action button / Exit button |
| Go between your base's floors | Walk up or down the stairs outside its side | Same |
| Unlock 2 more slots | Unlock button over the next locked pair, or E beside it | Tap the Unlock button |
| Rebirth | Stand on the rebirth station's gold pad, press E | Same, tap the action button |
| Upgrades | Upgrades in the dock (teleports you to the shop) | Same |
| At the base: level up a brainrot | Click Level up under it | Tap Level up under it |
| At the base: store or sell the brainrot you're next to | E | The action button |
| Backpack | Bag in the dock, or B | Bag in the dock |
| Chat | Enter (or the Chat button), type, Enter to send, Esc to close | Chat button |
| Scroll a panel (book, backpack, shop) | Drag it, or the mouse wheel | Drag it |

Release the charge in the green band for +15% height, or the gold band for +30%.

## Rules in this build

- **Gems in the sky.** Each flight passes rows of gems along its path. A gem is worth 1 in Low Sky, 6 in
  Cloud Kingdom, 18 in the Storm Layer, 45 at the Edge of Space and 150 in Outer Space. One in ten is a big gold gem worth 5 times as much, and now
  and then gems come in pairs. A hazard hit knocks 15% of the run's gems loose. A crash loses 15% of
  them, or 25% without a parachute. There's no result window: on landing the gems go into the wallet
  with a toast, and the player stays where they landed, ready to walk.
- **Parachute bar**: while falling, a compact bar rides beside your character on screen (a little to
  their right, slightly see-through), so you can watch both at once. It's titled PARACHUTE, with GROUND
  under it. A thick
  marker slides down it with your height in a bubble beside it, toward the gold PERFECT zone and the red
  CRASH zone at the bottom, each labelled at its side.
- **Bullseye**: a thin striped gold band inside the PERFECT zone, about 80% of the way down (0.24 s wide,
  about a third of the gold zone), labelled ×1.5. Open the parachute while the marker is on it (it lights
  up) for "BULLSEYE!" and ×1.5 gems from that flight. Tight enough to need care, wide enough to hit.
- **Parachute alarm**: from 0.9 seconds before the gold zone (about 2.2 seconds before impact), on every
  flight: OPEN PARACHUTE! flashes, the screen's edges pulse red, the parachute button bounces and glows,
  the coach's hand taps it, a banner says to press Space (or tap), and it beeps until the parachute opens.
- **Opening high**: a parachute opened high comes down fast (up to 85% of free-fall speed), slowing to a
  gentle 6 m/s for the last stretch, so it never drifts for long: opened at 327 m it lands in 10.5 s, not
  55. The canopy flutters harder the faster it falls.
- **Town** (`src/layout.ts`), following the sketch: two columns of four plots facing each other across a
  central lane, with no fences, so it feels like neighbours. At the lane's end is a shared hub: looking
  down the lane toward it, the cannon, the merge cauldron and the upgrade shop are on the right, and the
  row of gacha machines is on the left. Everyone uses the same cannon, cauldron, shop and machines; a plot
  is only its owner's showcase. Plots stand 4 m back from the lane, reached by a short tiled path, with
  9 m of grass between neighbours, and run away from the lane (as in the second sketch). A smooth
  three-tier fountain with arcing water closes the far end of the lane. The hub, the lane, the plot paths
  and the fountain's circle are paved in subtle Lego-style tiles (each square a slightly different shade,
  with a soft stud), and each surface sits at its own height so edges never overlap or flicker. Only things standing on the ground are solid (pedestals, machines, the cannon, the stall, the
  cauldron, the fountain). The shared cannon is at the world origin, so flights and their cameras are
  unchanged. With real multiplayer the server assigns each player a plot; this client is the first plot
  on the cannon side.
- **Fake multiplayer** (`src/net.ts`, `src/remote.ts`): a pretend server simulates a real lobby. The
  other plots are played by bots that use the real rules (the same pull, merge, upgrade and level code
  and costs as you).
  - **They move like players.** They run with momentum, ease in and out, curve through corners (aiming
    a little ahead along their route), turn at a limited rate and weave slightly on long runs. Each has
    its own running speed. They jump a lot while running, look around when they stop, spin now and then,
    give each other room, and sidestep or give up on a waypoint when they get stuck.
  - **They're busy.** They share the hub with you: they queue for the cannon (and wait while you're in
    it), dive in and get fired off with a boom you hear across town, often heading straight back for
    another go; they stand on the machines' pads and spin them, stir the cauldron, and walk to the shop
    stall to buy upgrades. In 10 simulated minutes, seven bots fire about 75 shots and spin about 60
    pulls.
  - **The lobby lives.** The server holds 8, one per plot. You usually join with three to five others, and
    matchmaking fills a free slot within 10 to 45 seconds (now and then it stays open for a minute or
    two). Sessions last from a few minutes to an hour; about half of the leavers go AFK first (their tag
    reads "Name · AFK"), some say "gtg bye", then they vanish in a puff. Players also go AFK for a minute
    or two mid-session. Newcomers appear in a puff by the fountain and walk down the lane to their plot;
    most return to saved progress, some are brand new.
  - **They talk.** Speech bubbles over their heads and lines in the feed: hellos for newcomers,
    questions that someone else answers a few seconds later ("how do u get gems" / "launch higher,
    cloud kingdom gems are x3"), passing remarks, "LETS GOOO" on their own Legendaries and "lucky" on
    other people's (yours included), and nobody repeats a line for a while.
  - **They visit.** Bots stroll the lane, round the fountain and about the hub, and visit each other's
    plots and yours, sometimes commenting on the best brainrot there ("how did u get Frigorifero
    Fenicottero"). They route through the lane, so nobody walks through pedestals.
  - Each bot joins with progress played out offline by the same loop as the economy simulator, launches
    from the shared cannon (dive, up, free fall, parachute), pulls, merges, buys upgrades, levels up and
    rebirths. Their helmets go on in the cannon, like yours.
  - The feed (bottom left) shows joins and leaves, Epic and Legendary pulls and merges, new zones,
    rebirths and chat. The online counter shows the server name and player count.
  - You can visit too: walk into anyone's plot ("Visiting Mia's base"), and the owner may say hi. Walk up
    to one of their brainrots and press E to see its level and income and give it a 👍 (they'll thank
    you).
  - The game only reads what a real server would send (player snapshots and events) and sends what a
    real client would (its stats, visits, likes, big moments), so a real server can replace `net.ts`.
  - To keep the frame rate up, other players' brainrots are only drawn within about 22 m of their plot,
    without shadows, and the sun's shadows follow the player (the town is too long for one shadow map).
    About 400 draw calls in the hub.
- **Launching**: within about 14 m of the cannon, Launch walks you over (round its side if you're behind
  it); from further away, or from an upper floor, it teleports you there in a puff, with a squash-and-stretch
  pop-in and a camera cut. Standing next to the cannon on any side, E gets you in too (the dive starts from where you stand). Either way, a short comic dive
  always follows (under a second): a
  crouch, a leap in an arc turning head first, stuck in the muzzle with legs kicking while the cannon
  gulps, then slurped in. You pop back up out of the muzzle and a crash helmet drops onto your head with
  a bounce and a clonk. The helmet stays on through the flight and the landing. A small Exit button (or
  Q) climbs back out: you spring from the muzzle and land at the cannon's foot.
- **Aiming**: in the cannon, the mouse (or A/D, or a drag) swings it up to 17° either way, chasing the aim
  on a spring so it eases in and settles with a little overshoot. The flight mechanics are unchanged; a
  swung shot just starts as if you'd been steering that way (up to three quarters of the way across) and
  hands over to your own steering within a second. The barrel kicks and springs back when it fires, for
  you and for every bot.
- **Gacha machines**: six, one per tier, in a row on the left of the hub, each a different machine and
  grander as the price goes up. Each has two glowing pads in front, ×1 and ×10: stand on one and press E
  (or tap the action button) and the machine spins, then the cards are dealt. No panels.
  - Each machine gives only its own band of rarities, never anything above it, so ×10 on a cheap machine
    can't farm what a better one gives; to aim higher, use a higher machine.
  - BASIC (10 gems), the red capsule machine with a glass globe and a crank: Common 72%, Uncommon 28%.
  - LUCKY (20 gems, unlocks at 130 m), a mint machine with a tall dome of capsules that whirl like a
    tornado, a gold horseshoe and a four-leaf clover: Common 40%, Uncommon 42%, Rare 18%.
  - SUPER (100 gems, 190 m), a blue-and-gold slot machine with three reels, chasing bulbs and a lever:
    Uncommon 40%, Rare 40%, Epic 20%.
  - ULTRA (300 gems, 290 m), a tall purple slot machine with an arched marquee and a crown: Rare 45%,
    Epic 40%, Legendary 15%.
  - COSMIC (800 gems, 600 m), a black-and-gold pedestal under a glowing orb in two whirling gimbal rings,
    with stars in orbit: Epic 52%, Legendary 40%, Mythic 8%.
  - GALAXY (1,500 gems, 700 m), the same orb machine in white and rose gold with a rainbow orb: Legendary
    80%, Mythic 20%.
  - Mythics are very rare: only Cosmic and Galaxy give them, or merging 8 Legendaries.
  - Every machine shows its odds on a little board beside it: each rarity it can give, in that rarity's
    colour, with its chance. (The pity guarantees stay hidden.)
  - Each tier is worth more per gem than the one below (`npm run sim`, merged-up value in Legendaries per
    1,000 gems): Basic 0.20, Lucky 0.59, Super 0.76, Ultra 0.98, Cosmic 1.50, Galaxy 1.59. To keep the pace
    with the lower machines capped, gems are worth more higher up and Ultra unlocks at 230 m: the first
    Legendary lands at about 18 minutes and rebirth unlocks at about 83 (it was about 65).
  - A locked machine is dimmed and grey, chained, with a gold padlock, and its sign says the height that
    unlocks it, your best so far and a progress bar. The first time you come back from a flight that
    reached it, the padlock shakes, bursts off spinning, and the machine lights up with a chime and
    confetti; the coach then points you at it once.
  - Pulling: the machine squats (anticipation), spins (the crank turns; capsules rattle or whirl; slot
    reels spin and stop left to right; the Cosmic orb dips, then blazes as its rings whirl), then pops up
    and settles with an overshoot, spitting out a capsule (just for show): it arcs out of the chute,
    bounces with a squash and a click, rolls to a stop in front of the machine between the pads, wobbles
    and swells, and pops open in a burst as the cards are dealt. The capsule is the best result's rarity
    colour (glowing for Epic or better) and bigger for ×10. Bots' pulls spit capsules too. Not enough gems
    or not unlocked: the machine shakes its head.
  - Mythic is the new top rarity (350 coins/s), with two characters from the design doc: Razzo
    Rinoceronte (a rhino strapped to a sputtering rocket) and Satellito Gattino (a kitten with satellite
    dish ears that sweep the sky). Mythics come from the Ultra and Cosmic machines, or from merging eight
    Legendaries. Mythic statues shimmer with a moving rainbow over their whole body (keeping their cel
    shading).
  - Opening: the machine shakes silently and the sound comes when the capsule pops open. On the cards,
    every flip whooshes and pops, and Rare and better get a fanfare that grows with rarity. Epic and
    better flash the screen in their colour, turn light rays behind the card, burst confetti and show a
    big rarity banner. Legendary and Mythic hold back first: the card shakes and blazes with a rising
    whoosh before it turns. A Mythic also quakes the whole screen and has a rainbow banner and edge.
  - Hidden pity, never shown to the player: Basic gives an Uncommon at least every 6 pulls, Lucky a Rare
    every 8, Super an Epic every 9, Ultra a Legendary every 10, Cosmic a Legendary every 4 and a Mythic
    every 45, and Galaxy a Mythic every 15. Each counter resets when that rarity or better comes up.
  - Results go on display by themselves: empty slots fill best first, and a rarer pull swaps out a
    level-1 brainrot (which goes to the backpack with its coins collected). Levelled ones are never moved.
    Then the cards are revealed like trading cards (no pack to open): dealt face down, rarest last, each
    flipped with a tap (or Flip all, or Space). Rare and better glow through their backs and wobble first;
    the front is a framed card with the brainrot's art, income, rarity stars and a NEW badge, and Epic and
    better have holo foil. Continue goes back to the world, still standing on the pad, so pulling again
    is one more press. Merges reveal their results the same way.
- **Merge station**, a bubbling cauldron behind the cannon. Step on the purple platform in front of it
  and press E (the pot jumps and wobbles on each merge): 10 Common → 1 Uncommon, 8 Uncommon →
  1 Rare, 6 Rare → 1 Epic, 4 Epic → 1 Legendary, 8 Legendary → 1 Mythic, 5 Mythic → 1 Celestial, from the backpack. A merge gives a random character of
  the next rarity. You choose what goes in: the station lists your backpack by rarity, one card per character
  with how many you have; tap a card to pick one more of it (once all are picked, a tap clears them), or
  Pick 10 (or whatever the recipe needs) to fill a recipe at once, then Merge picked (in as many full groups
  as you picked). Auto merge runs every recipe from the bottom up in one click. Merged brainrots go on
  display if they beat what's there.
- **Backpack**: brainrots not on display. Sell one or all of a rarity (60 seconds of its income each),
  put one on display, or merge a rarity.
- **Shop**: a market stall with a striped awning and goods on the counter, and a keeper with an apron and
  a moustache who turns to watch customers and waves when you arrive. Upgrades in the dock teleports you
  to its counter and opens the shop (from the cannon too); standing on its rug and pressing E opens it. The
  shop sells flight upgrades only (cannon, gem finder, magnet, steering, parachute); slots are bought at the
  base and rebirth has its own station.
- **Your base** is easy to spot without shouting: a gold star turns slowly high over its name board (over
  the top floor, once it has more), and its path in from the lane is tiled in warm gold.
- **Showcase**: each plot is a tiled area edged by a low, rounded kerb in its owner's colour (gold for
  yours), open at the front where its path comes in from the lane: a subtle edge, not a fence, that you
  can step over. Inside, two lines of 5 pedestals run back from the lane either side of an aisle (filled in
  pairs from the front), with the brainrots turned toward the lane and the aisle, and the owner's name
  board stands tall at the back. Walking down the aisle collects from both lines. 4 slots are open at the
  start; locked ones are roped off. Unlocking is done at the base: an Unlock button floats over the next
  locked pair (or press E beside it), 2 slots at a time (600, 3,600, 21,600, then each pair about 1.9×
  the last). Empty open slots pulse a ring of light.
- **Floors**: the first two rebirths each add a floor to the base, a deck on pillars over the one below
  with a white railing, holding another 10 slots (4 open straight away, and every slot below it opens
  too). Stairs climb the outside of the base, one flight per floor, alternating sides (Floor 2's on the
  right, Floor 3's on the left): chunky steps on wooden stringers with a handrail and a landing at each
  end. Walk up them and step off the top landing through a gap in the deck's railing; walk down to go
  back. Up on a deck the railing holds you except at those gaps. Other players' bases grow floors and
  stairs too.
- **Collect all**: from the second rebirth, a gold pad with a coin on it appears beside the path into your
  base (on the grass, leaving the way in clear), under a COLLECT ALL sign that shows the coins waiting
  across all your slots. Step on it and every slot on every floor pays out at once, with coins
  bursting from each and one total.
- **Upgrade all**: from the second rebirth too, a green pad with an up arrow on the other side of the path.
  Step on it and every slot that's ready (full XP) and affordable levels up, cheapest first; its sign
  shows how many are ready and what they'd cost all together. It fires once each time you step on.
- **Slots**: a brainrot on display earns coins once a second by rarity (Common 1/s up to Legendary 90/s),
  up to 10 minutes' worth. The coins waiting show as a big gold coin spinning slowly over its head, with
  the amount above it. Pedestals are solid: walk up to one to collect its coins. Right under each
  brainrot within about 11 m, a Level up button shows the slot's XP (earned while something's on it) and,
  once full, the price: click it to level up.
- **Levels belong to slots, not brainrots.** A slot keeps its level and XP when its brainrot is swapped
  out, stored or sold, and whatever goes on it earns at that level: income is the brainrot's rarity rate
  × the slot's level bonus (+25% a level, up to Lv 10). So a rarer pull dropped onto a Lv 6 slot earns
  at Lv 6 straight away, with no levelling again. A level costs the same whatever is on the slot (80
  coins for Lv 2, then about 2.1× each). Rebirth resets slot levels. Standing next to a slot and pressing
  E opens its panel to store it in the backpack or sell it. Slots glow in their brainrot's rarity colour.
- **Camera at the base**: drag sideways to turn it and up or down to tilt it. Tilting up brings it low and
  close behind the player, with their head at the bottom of the screen, to look up at people flying from
  the cannon (up to about 54° above the horizon).
- **Walking**: the cannon, the cauldron, the machines, the stall, the pedestals and the fountain are
  solid (you slide around them), and you step up onto the pads, the cauldron's platform and showcase
  floors. Returning players start in the lane in front of their plot, looking at it.
- **Hazards** only appear where the climb has slowed enough to dodge them (under 60 m/s): at high cannon
  levels the first stretch flashes by too fast, so it's left clear. At cannon Lv 30 they start at about
  300 m.
- **Tutorial**: flight 1 is a straight line of 12 gems, enough for the first pull. Hazards start on
  flight 3, and nothing is lost to hits or crashes during the first 3 flights. A coach guides new
  players: a big bouncing yellow banner, low on the screen just above the buttons so it never hides the
  sky or the town, says what to do, and a cartoon hand shows how. It presses and
  holds to charge, swipes to steer on flight 2, taps the parachute (or says to press Space), and at the
  base points down at the next button (the action button once you're on a platform, Upgrades, Launch).
  When the next step is to walk somewhere, it shows the WASD keys (a dragging thumb on touch) and a
  trail of gold chevrons on the ground flows from the player to the goal, with a green arrow bobbing
  over it. From flight 2, the apex shows the next zone's gem value and the cannon level that reaches it.
- **New zones**: entering a zone on the way up shows its name and gem value; the first time ever, it's a
  big NEW ZONE banner with a sparkle and a moment of slow motion. The cannon's first levels climb fast
  (90 m at level 1, 155 m at level 6), so a good launch reaches Cloud Kingdom within the first few
  minutes; after that, each level adds less.
- **Each rebirth opens the next area.** Before the first rebirth, flights top out just under the Storm
  Layer (at 394 m): the apex shows "Storm Layer: rebirth to break through!" and the cannon can't be
  upgraded past the rebirth's level (21), so no coins go into upgrades that couldn't help. After the
  rebirth the ceiling lifts, and the Storm Layer (400 m) is reached at about cannon Lv 25 (a perfect launch
  from about Lv 22). The same happens one area up: until the second rebirth, flights stop just under the
  Edge of Space and the cannon stops at that rebirth's level (25); after it, the Edge of Space is reached at
  about cannon Lv 31 (a perfect launch from about Lv 27).
- **Edge of Space** (650 m and up): the fourth area. The sky turns deep navy, the haze clears and stars come
  out, the clouds are left below, and gems are worth 45 each. Its hazards are meteors: cratered rocks
  tumbling across with a blazing tail. The Galaxy machine (700 m) unlocks up here.
- **Outer Space** (1,000 m and up): the end-game area, opened by the third rebirth and reached around cannon
  Lv 36 (the cannon now goes to Lv 51). The sky is nearly black and full of stars, meteors fly, and its gems
  are celestial: worth 150 each, shimmering through every colour.
- **Celestial**: the end-game rarity, above Mythic. It's never pulled from a machine: the only way to get one
  is to merge 5 Mythics. Each earns 3,000 coins/s (a Mythic earns 350). Two characters: Galattico Gufo, an
  owl made of the night sky with a crown of stars and a ringed planet in orbit, and Pianeta Pinguino, a
  penguin who is also a planet, circled by a tilted ring of moons. Celestials are shaded as a slow-moving
  nebula of deep blue, violet and cyan, flecked with twinkling gold stars. Each one is a trophy: merging it
  sets off a "TROPHY!" banner with fireworks, a gold cup appears on top of your name board for each one you
  own, and the book has a Celestial · Trophies page (5,000,000 coins when complete).
- **Shields** (in the shop): each level adds one shield, and each shield blocks one hazard hit per flight
  (no gems lost, no stun). They're stingy: 300 coins for the first (a few minutes in), then ten times the
  last for each (3K, 30K, 300K, 3M), up to 5. In flight a faint cyan bubble surrounds you with a ring
  orbiting per shield left, and a counter under the run's gems shows how many; a block flares the bubble
  with a glassy ping ("BLOCKED! 1 shield left"), and the last one pops it. Shields refill every flight
  and reset on rebirth.
- **Upgrades** (the shop): cannon power (to level 51), gem finder (+10% gems per pickup
  each), gem magnet (+10% grab radius each), steering (+6% turn speed each), parachute (+5% safe window
  each).
- **Rebirth** has its own station in the hub: a marble dais under a floating golden crystal in turning
  rings, with a pillar of light once you can rebirth; its sign says what you'd get, or the cannon level
  still needed with a progress bar. The first unlocks at cannon level 21 (about 40 minutes in), and each one
  after asks for 4 more levels (25, 29, 33, then the top level, 37). Stand on
  its gold pad, press E and confirm. It resets coins, gems, upgrades, slot levels and the backpack, locks the gacha
  machines again (they unlock as this run's flights reach their heights; your all-time best stays on the
  leaderboard),
  keeps the rarest brainrot and every open slot, multiplies income by ×1.5 again with every rebirth (compounding: ×1.5, ×2.25, ×3.4, ×5.1... and you can
  rebirth as many times as you like), and recolours the cannon;
  the first two also add a floor to your base. It's grand and short (about three seconds): the crystal
  dips and blasts up in a pillar of light with a shockwave across the ground, the screen flashes gold, a
  huge REBIRTH! banner slams in over turning rays and confetti, the camera tilts up, and a volley of
  fireworks whistles up behind the station and bursts in colour with a crackle. Bots rebirth at the
  station too, with a smaller show.
- Offline earnings: brainrots keep earning while you're away, at half rate for up to 2 hours.
- The game keeps running when its window is behind another one or its tab is in the background: a timer
  carries on where animation frames stop, and whatever time the browser held back is caught up on return
  (up to 20 seconds played out in full, flights and bots included, and longer gaps as income).
- Daily rewards: a 7-day login streak (coins, a Rare on day 3, an Epic on day 7, both to the backpack).
- Collection book: every character as a silhouette until pulled, with a one-time reward per completed
  page (500, 5,000 and 50,000 coins). Drag it (or any panel) up and down to scroll, with a little glide.
- **Chat**: press Enter or the Chat button, type and press Enter. Your message shows in the feed and in a
  bubble over your head. Bots answer like people do: nearly always a hello ("hey 👋", sometimes two of
  them), often "how are you", thanks, goodbyes and questions about the game (gems, Mythics, merging, the
  shop, rebirth, trading), now and then anything else, and they ignore the rest. Name someone and they'll
  usually answer. Replies take as long as they'd take to type. While typing, keys don't move or fire.
- Session gifts: 20 gems at 2 minutes (two more pulls, to keep a new player going), then 30 gems and a
  minute of income at 5 minutes, 50 gems and 2 minutes at 10, 100 gems (a Super pull) and 2 minutes at
  20, and 200 gems and 4 minutes at 40.
- **Voices**: when a Rare or better is revealed, it sings its name in a generated babble (like the
  gibberish voices in cosy games), built from the syllables of its name with its own pitch and rhythm;
  rarer ones sing lower and longer with an echo. Brainrots no longer call out from the base while idle.
- **Sounds**, all synthesised: soft footsteps at the base, capsule pop, card flips, fanfares by rarity,
  suspense whoosh, cash register on upgrades, level-up scale, bubbling merge, new-zone call, panel
  whoosh, coins, gems, launch boom (a layered crack, deep thump, roaring blast, whoosh, a ring from the barrel and an echo), wind, parachute, hits and landings; and now a teleport zip, the dive's
  whoop, the cannon's gulp, the helmet's clonk, the parachute alarm's beeps, a machine-unlock chime, a
  ratchet while a machine spins, and other players' cannon shots, quieter with distance.
- **Animation** follows the classic principles where it can: anticipation (the dive's crouch, a machine's
  squat, the lever yanked down, the padlock shaking before it bursts), squash and stretch (pop-ins, the
  dive, the cannon's charge, kick and gulp, the cauldron), slow in and out (springs and eased spins),
  arcs (the dive), follow-through and overshoot (the cannon's swing settling, machines popping up and
  settling, the helmet's bounce), secondary action (the keeper waving, bulbs chasing, capsules rattling,
  water arcing, the canopy fluttering), and staging (a three-quarter camera for the dive, a camera cut
  for teleports).

Older saves carry over: catches that were being carried go to the backpack, and bases bigger than 10
slots move their extra brainrots to the backpack.

Not in this build: fusion of named characters, sky events, the rival, the spin wheel, and ads.

## Look

- **UI**: chunky candy-coloured cartoon style. Lilita One for titles and numbers and Fredoka for text
  (from Google Fonts, with system fallbacks), glossy 3D buttons with thick ink outlines that press down,
  currency pills, a dock of icon tiles (Upgrades, Bag, Book), a prompt banner, and panels
  that open with a coloured ribbon.
- **Cannon, machines, cauldron, stall and fountain**: smooth and glossy. The cannon is a turned barrel with
  brass bands, trunnions and a muzzle ring, on a carriage with spoked wheels over a round stone base; the
  cauldron has a rounded belly on three legs over a crackling fire, a gold rim and handles, and a bubbling,
  glowing brew; the fountain is turned on a lathe, with gold bands and a turning gold gem on top.
- **Less clutter**: the far snowy mountains (which looked half there from high up), the bunting, lanterns, flower beds, street lamps and cottage are gone, and the
  ground cover around the town is about half as dense. A smooth wooden fence with gold-capped posts runs
  round the town's edge, where walking stops. Paving marks the hub, the lane (with gold studs
  down the middle) and the fountain's circle; the gacha corner has a pink carpet.
- **Brainrots**: smooth and rounded (soft-edged boxes, finely divided balls and cylinders, so the cel
  shading reads as clean bands), with big glossy eyes (two shines each) that blink now and then, rosy
  cheeks and fuller smiles. Each has details that sell its joke: the cannon pigeon has wings, a tail,
  wheels and a fizzing fuse and kicks back as it puffs smoke rings; the toaster's toast has butter and pops
  with a squash; the snail crawls like an inchworm under a threaded, glowing bulb, its eye stalks wobbling;
  the ostrich's toothbrush neck has blue-and-white bristles and toothpaste; the gelato gymnast has
  sprinkles, a cherry and a drip; the pelican's pizza has pepperoni and it flaps as it shows it off; the
  fan turtle paddles its feet under a plated shell; the macchiato ninja has latte art, steam and
  fluttering headband tails; the helicopter hippo has ears, nostrils and a tail rotor and tips forward as
  it lifts; the fridge flamingo has magnets on its door and a pink wing.
- **Brainrot icons**: every card shows that character's own portrait, rendered once from its 3D model
  and cached. Characters not yet pulled show as a dark silhouette in the book.
- The player is a blocky avatar with rounded edges: a square head with a drawn face, a cap, a T-shirt,
  jeans and sneakers, and a glossy crash helmet with goggles in the cannon and in flight. It has a walk
  cycle at the base, reaches up on the way up, flails in free fall and
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
| `src/base.ts` | A plot's showcase (floor, name board, pedestals, brainrots, coins), and what's solid and how high the floor is, town-wide |
| `src/hub.ts` | The shared hub: paving, the cauldron, the shop stall and keeper, the five gacha machines with their pads and locks, the fountain |
| `src/tiles.ts` | The Lego-style tile texture for paving and plot floors |
| `src/characters.ts` | The 12 character models, their idle animations, blinking, and the Mythic rainbow |
| `src/world.ts` | Sky pieces, cannon, player avatar, gems, hazards, guide arrows, labels |
| `src/layout.ts` | The town: the lane, the eight plot slots, where the hub's things stand, and walking limits |
| `src/net.ts` | The fake multiplayer server: bot players on the real economy, events, chat, standings |
| `src/remote.ts` | Draws other players (avatars, name tags, poses, parachutes) and their plots from server snapshots |
| `src/scenery.ts` | Sky dome, ground, hills, mountains, swaying trees, ground cover, windmill, pond, butterflies, the leaderboards |
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
