// Economy simulator: plays the game's real cost and placement rules with a simple player model and
// reports when milestones land. Run with `npm run sim`.
//
// The player model: launches land green 40% and perfect 25% of the time, each run grabs 60% of the
// characters it passes and keeps the best ones the carry limit allows, a run plus the base visit takes
// 2.2 × the ascent time + 17 s, and at the base the player buys the cheapest thing they can afford,
// character levels included. Time away (offline earnings) isn't modelled.
import {
  CHARGE,
  ECONOMY,
  FLIGHT,
  GIFTS,
  MAX_ZONE,
  REBIRTH,
  TRACKS,
  UPGRADES,
  ZONES,
  launchHeight,
  rollRarity,
  zoneIndexAt,
  type Track,
} from '../src/config';
import {
  buyUpgrade,
  carryLimit,
  expansionCost,
  incomePerSecond,
  levelCost,
  placeCatches,
  upgradeCost,
} from '../src/economy';
import { defaultSave, type Save } from '../src/store';

// Try other numbers without editing config, e.g.
// SIM='{"cannon":{"growth":1.3},"economy":{"firstExpansion":600}}' npm run sim
declare const process: { env: Record<string, string | undefined> };
const overrides = JSON.parse(process.env.SIM ?? '{}') as Record<string, Record<string, number>>;
for (const [key, values] of Object.entries(overrides)) {
  Object.assign(key === 'economy' ? ECONOMY : UPGRADES[key as Track], values);
}

const MUZZLE_Y = 3.2;
const GRAB_RATE = 0.6;

interface Milestones {
  firstUpgrade: number;
  cloudKingdom: number;
  stormLayer: number;
  stormCannon: number;
  maxCannon: number;
}

/** Rarities of the characters a run passes, placed the way Game.spawnRun places them. */
function encountered(apex: number): number[] {
  const tUp = FLIGHT.ascentTime(apex);
  const v0 = (2 * (apex - MUZZLE_Y)) / tUp;
  const g = v0 / tUp;
  const rarities: number[] = [];
  const apexZone = Math.min(zoneIndexAt(apex), MAX_ZONE);
  const floor = apexZone >= 2 ? ZONES[apexZone - 1].from : 14;
  let lastY = -Infinity;
  for (let t = 0.6; t < tUp - 0.1; t += FLIGHT.pickupStep) {
    const y = MUZZLE_Y + v0 * t - 0.5 * g * t * t;
    if (y < floor || y - lastY < FLIGHT.pickupMinGap) continue;
    lastY = y;
    rarities.push(rollRarity(y));
  }
  return rarities;
}

function shop(save: Save): void {
  for (;;) {
    const options: { cost: number; buy: () => void }[] = [];
    for (const track of TRACKS) {
      const cost = upgradeCost(save, track as Track);
      if (cost !== null) options.push({ cost, buy: () => buyUpgrade(save, track as Track) });
    }
    for (const slot of save.pads) {
      const cost = slot ? levelCost(slot) : null;
      if (slot && cost !== null) options.push({ cost, buy: () => (slot.level = (slot.level ?? 1) + 1) });
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
  const m: Milestones = { firstUpgrade: NaN, cloudKingdom: NaN, stormLayer: NaN, stormCannon: NaN, maxCannon: NaN };
  let t = 0;
  let gift = 0;
  while (t < minutes * 60) {
    const roll = Math.random();
    const bonus = roll < 0.25 ? CHARGE.perfectBonus : roll < 0.65 ? CHARGE.greenBonus : 0;
    const apex = launchHeight(save.cannon) * (1 + bonus);
    const runTime = 2.2 * FLIGHT.ascentTime(apex) + 17;
    save.coins += incomePerSecond(save) * runTime;
    t += runTime;
    if (gift < GIFTS.at.length && t >= GIFTS.at[gift]) {
      save.coins += Math.max(GIFTS.min, incomePerSecond(save) * GIFTS.incomeSeconds);
      gift++;
    }

    const grabbed = encountered(apex).filter(() => Math.random() < GRAB_RATE);
    const kept = grabbed.sort((a, b) => b - a).slice(0, carryLimit(save));
    placeCatches(
      save,
      kept.map((rarity) => ({ name: '', rarity })),
    );

    if (apex >= 150 && Number.isNaN(m.cloudKingdom)) m.cloudKingdom = t;
    if (apex >= REBIRTH.unlockHeight && Number.isNaN(m.stormLayer)) m.stormLayer = t;
    const before = save.cannon;
    shop(save);
    if (save.cannon > 1 && Number.isNaN(m.firstUpgrade)) m.firstUpgrade = t;
    if (save.cannon >= REBIRTH.cannonLevel && Number.isNaN(m.stormCannon)) m.stormCannon = t;
    if (save.cannon !== before && upgradeCost(save, 'cannon') === null && Number.isNaN(m.maxCannon)) m.maxCannon = t;
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
console.log(`  first cannon upgrade      ${median('firstUpgrade')}   target: by minute 2`);
console.log(`  first Cloud Kingdom run   ${median('cloudKingdom')}   target: by minute 5`);
console.log(`  first Storm Layer run     ${median('stormLayer')}`);
console.log(`  rebirth unlocks           ${median('stormCannon')}   target: 60 to 90 min`);
console.log(`  cannon maxed out          ${median('maxCannon')}`);
