// Economy simulator: plays the game's real cost, gacha and merge rules with a simple player model and
// reports when milestones land. Run with `npm run sim`.
//
// The player model: launches land green 40% and perfect 25% of the time, each run collects 60% of the gems
// it passes, a run plus the base visit takes 2.2 × the ascent time + 20 s, and at the base the player pulls
// the best gacha tier they can (saving for the Super pull once it's unlocked), displays a pull if it beats
// the weakest slot (selling the old one), merges whenever the backpack has enough, sells what's left, and
// then buys the cheapest thing they can afford, character levels included. Offline earnings aren't modelled.
import {
  CHARGE,
  ECONOMY,
  FLIGHT,
  GACHA,
  GEMS,
  GIFTS,
  MAX_ZONE,
  REBIRTH,
  TRACKS,
  UPGRADES,
  ZONES,
  launchHeight,
  zoneIndexAt,
  type Track,
} from '../src/config';
import {
  buyUpgrade,
  expansionCost,
  incomePerSecond,
  levelCost,
  gainXp,
  levelReady,
  merge,
  mergeNeed,
  padIncome,
  pull,
  sellValue,
  tierUnlocked,
  trackBoost,
  upgradeCost,
} from '../src/economy';
import { defaultSave, type Owned, type Save } from '../src/store';

// Try other numbers without editing config, e.g.
// SIM='{"cannon":{"growth":1.3},"economy":{"firstExpansion":600}}' npm run sim
declare const process: { env: Record<string, string | undefined> };
const overrides = JSON.parse(process.env.SIM ?? '{}') as Record<string, Record<string, number>>;
for (const [key, values] of Object.entries(overrides)) {
  Object.assign(key === 'economy' ? ECONOMY : key === 'gems' ? GEMS : UPGRADES[key as Track], values);
}

const MUZZLE_Y = 3.2;
const GRAB_RATE = 0.6;

interface Milestones {
  firstPull: number;
  firstUpgrade: number;
  cloudKingdom: number;
  firstLegendary: number;
  allSlots: number;
  stormLayer: number;
  stormCannon: number;
}

/** Gems a run passes, placed the way Game.spawnRun places them (pairs and big gems on average). */
function gemsPassed(apex: number, flight: number): number {
  if (flight === 1) return GEMS.tutorialLine;
  const tUp = FLIGHT.ascentTime(apex);
  const v0 = (2 * (apex - MUZZLE_Y)) / tUp;
  const g = v0 / tUp;
  const apexZone = Math.min(zoneIndexAt(apex), MAX_ZONE);
  const floor = apexZone >= 2 ? ZONES[apexZone - 1].from : 14;
  let total = 0;
  let lastY = -Infinity;
  for (let t = 0.6; t < tUp - 0.1; t += FLIGHT.pickupStep) {
    const y = MUZZLE_Y + v0 * t - 0.5 * g * t * t;
    if (y < floor || y - lastY < FLIGHT.pickupMinGap) continue;
    lastY = y;
    const value = ZONES[Math.min(zoneIndexAt(y), MAX_ZONE)].gems;
    total += value * (1 + GEMS.bigChance * (GEMS.bigMultiplier - 1)) + (Math.random() < 0.3 ? value : 0);
  }
  return total;
}

/** Displays a brainrot if there's room or it beats the weakest slot; otherwise it stays in the backpack. */
function display(save: Save, o: Owned): boolean {
  const empty = save.pads.findIndex((slot) => slot === null);
  if (empty >= 0) {
    save.pads[empty] = { ...o, cash: 0, level: 1 };
    return true;
  }
  let weakest = 0;
  save.pads.forEach((slot, k) => {
    if (slot && padIncome(save, slot) < padIncome(save, save.pads[weakest]!)) weakest = k;
  });
  const old = save.pads[weakest]!;
  if (padIncome(save, { rarity: o.rarity }) <= padIncome(save, old)) return false;
  save.coins += sellValue(save, old);
  save.pads[weakest] = { ...o, cash: 0, level: 1 };
  return true;
}

function gacha(save: Save): void {
  const top = GACHA[GACHA.length - 1];
  for (;;) {
    // Once the Super pull is open, save gems for it instead of spending them on Basic pulls.
    const tier = tierUnlocked(save, top) ? top : GACHA[0];
    const got = pull(save, tier);
    if (!got) break;
    save.inventory.pop();
    if (!display(save, got)) save.inventory.push(got);
  }
  // Merge up while possible, displaying anything that earns more.
  for (let r = 0; r < 4; r++) {
    while (mergeNeed(r) !== null && merge(save, r)) {
      const made = save.inventory.pop()!;
      if (!display(save, made)) save.inventory.push(made);
    }
  }
}

function shop(save: Save): void {
  for (;;) {
    const options: { cost: number; buy: () => void }[] = [];
    for (const track of TRACKS) {
      const cost = upgradeCost(save, track);
      if (cost !== null) options.push({ cost, buy: () => buyUpgrade(save, track) });
    }
    for (const slot of save.pads) {
      const cost = slot && levelReady(slot) ? levelCost(slot) : null;
      if (slot && cost !== null) {
        options.push({
          cost,
          buy: () => {
            slot.level = (slot.level ?? 1) + 1;
            slot.xp = 0;
          },
        });
      }
    }
    const pads = expansionCost(save);
    if (pads !== null && save.pads.every(Boolean)) {
      options.push({ cost: pads, buy: () => save.pads.push(...Array.from({ length: ECONOMY.padStep }, () => null)) });
    }
    const pick = options.filter((o) => o.cost <= save.coins).sort((a, b) => a.cost - b.cost)[0];
    if (!pick) return;
    save.coins -= pick.cost;
    pick.buy();
  }
}

function simulate(minutes: number): Milestones {
  const save = defaultSave();
  const m: Milestones = {
    firstPull: NaN,
    firstUpgrade: NaN,
    cloudKingdom: NaN,
    firstLegendary: NaN,
    allSlots: NaN,
    stormLayer: NaN,
    stormCannon: NaN,
  };
  const mark = (key: keyof Milestones, t: number) => {
    if (Number.isNaN(m[key])) m[key] = t;
  };
  let t = 0;
  let gift = 0;
  while (t < minutes * 60) {
    const roll = Math.random();
    const bonus = roll < 0.25 ? CHARGE.perfectBonus : roll < 0.65 ? CHARGE.greenBonus : 0;
    const apex = launchHeight(save.cannon) * (1 + bonus);
    const runTime = 2.2 * FLIGHT.ascentTime(apex) + 20;
    save.coins += incomePerSecond(save) * runTime;
    for (const slot of save.pads) if (slot) gainXp(slot, runTime);
    t += runTime;
    if (gift < GIFTS.at.length && t >= GIFTS.at[gift]) {
      save.coins += Math.max(GIFTS.min, incomePerSecond(save) * GIFTS.incomeSeconds);
      gift++;
    }

    save.flightNo += 1;
    const grab = save.flightNo === 1 ? 1 : GRAB_RATE;
    save.gems += Math.round(gemsPassed(apex, save.flightNo) * grab * trackBoost(save, 'finder'));
    save.best = Math.max(save.best, apex);
    if (apex >= 150) mark('cloudKingdom', t);
    if (apex >= REBIRTH.unlockHeight) mark('stormLayer', t);

    const pullsBefore = save.pulls;
    gacha(save);
    if (save.pulls > 0 && pullsBefore === 0) mark('firstPull', t);
    if (save.pads.some((slot) => slot && slot.rarity >= 4)) mark('firstLegendary', t);
    shop(save);
    if (save.cannon > 1) mark('firstUpgrade', t);
    if (save.pads.length >= ECONOMY.maxPads) mark('allSlots', t);
    if (save.cannon >= REBIRTH.cannonLevel) mark('stormCannon', t);
  }
  return m;
}

const runs = Array.from({ length: 200 }, () => simulate(240));
const median = (key: keyof Milestones) => {
  const values = runs.map((r) => r[key]).filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
  if (!values.length) return 'not reached';
  const mid = values[Math.floor(values.length / 2)];
  return `${(mid / 60).toFixed(1)} min${values.length < runs.length ? ` (${values.length}/${runs.length} runs)` : ''}`;
};
console.log('Median time to each milestone over 200 simulated players, 4 hours each:');
console.log(`  first gacha pull          ${median('firstPull')}   target: after flight 1`);
console.log(`  first cannon upgrade      ${median('firstUpgrade')}   target: by minute 2`);
console.log(`  first Cloud Kingdom run   ${median('cloudKingdom')}   target: by minute 5`);
console.log(`  first Legendary on show   ${median('firstLegendary')}`);
console.log(`  all 10 slots open         ${median('allSlots')}`);
console.log(`  first Storm Layer run     ${median('stormLayer')}`);
console.log(`  rebirth unlocks           ${median('stormCannon')}   target: 60 to 90 min`);
