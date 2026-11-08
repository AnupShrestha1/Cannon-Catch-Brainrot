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
  GIFT_COINS,
  MERGE,
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
  thirdPull: number;
  firstRare: number;
  firstUpgrade: number;
  firstLevelUp: number;
  cloudKingdom: number;
  superPull: number;
  firstExpansion: number;
  firstEpic: number;
  firstLegendary: number;
  allSlots: number;
  stormLayer: number;
  stormCannon: number;
}

/** What a player has at the 2-minute mark: the hook window. */
interface AtTwo {
  pulls: number;
  bestRarity: number;
  income: number;
  cannon: number;
  levelUps: number;
  /** Pulls, cannon upgrades and level-ups: rewarding moments in the first 2 minutes. */
  rewards: number;
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
  for (;;) {
    // Once the Super pull is open, save gems for it instead of spending them on Basic pulls.
    const tier = [...GACHA].reverse().find((t) => tierUnlocked(save, t))!;
    const got = pull(save, tier);
    if (!got) break;
    save.inventory.pop();
    if (!display(save, got)) save.inventory.push(got);
  }
  // Merge up while possible, displaying anything that earns more.
  for (let r = 0; r < 5; r++) {
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

function simulate(minutes: number): { m: Milestones; two: AtTwo } {
  const save = defaultSave();
  const m = Object.fromEntries(
    [
      'firstPull',
      'thirdPull',
      'firstRare',
      'firstUpgrade',
      'firstLevelUp',
      'cloudKingdom',
      'superPull',
      'firstExpansion',
      'firstEpic',
      'firstLegendary',
      'allSlots',
      'stormLayer',
      'stormCannon',
    ].map((k) => [k, NaN]),
  ) as unknown as Milestones;
  const mark = (key: keyof Milestones, t: number) => {
    if (Number.isNaN(m[key])) m[key] = t;
  };
  const two: AtTwo = { pulls: 0, bestRarity: -1, income: 0, cannon: 1, levelUps: 0, rewards: 0 };
  let levelUps = 0;
  let upgrades = 0;
  let bestRarity = -1;
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
    while (gift < GIFTS.length && t >= GIFTS[gift].at) {
      save.coins += Math.max(GIFT_COINS.min, incomePerSecond(save) * GIFTS[gift].incomeSeconds);
      save.gems += GIFTS[gift].gems;
      gift++;
    }

    save.flightNo += 1;
    const grab = save.flightNo === 1 ? 1 : GRAB_RATE;
    save.gems += Math.round(gemsPassed(apex, save.flightNo) * grab * trackBoost(save, 'finder'));
    save.best = Math.max(save.best, apex);
    if (apex >= 150) mark('cloudKingdom', t);
    if (apex >= REBIRTH.unlockHeight) mark('stormLayer', t);

    const before = { pulls: save.pulls, pads: save.pads.length, levels: levelsOf(save), cannon: save.cannon };
    const superBefore = save.pity.super ? 1 : 0;
    gacha(save);
    for (const slot of save.pads) if (slot) bestRarity = Math.max(bestRarity, slot.rarity);
    for (const o of save.inventory) bestRarity = Math.max(bestRarity, o.rarity);
    if (save.pulls > 0) mark('firstPull', t);
    if (save.pulls >= 3) mark('thirdPull', t);
    if (bestRarity >= 2) mark('firstRare', t);
    if (bestRarity >= 3) mark('firstEpic', t);
    if (save.pity.super && !superBefore) mark('superPull', t);
    if (save.pads.some((slot) => slot && slot.rarity >= 4)) mark('firstLegendary', t);
    shop(save);
    if (save.cannon > 1) mark('firstUpgrade', t);
    if (levelsOf(save) > before.levels) mark('firstLevelUp', t);
    if (save.pads.length > ECONOMY.startPads) mark('firstExpansion', t);
    if (save.pads.length >= ECONOMY.maxPads) mark('allSlots', t);
    if (save.cannon >= REBIRTH.cannonLevel) mark('stormCannon', t);
    levelUps += Math.max(0, levelsOf(save) - before.levels);
    upgrades += save.cannon - before.cannon;
    if (t <= 120) {
      two.pulls = save.pulls;
      two.bestRarity = bestRarity;
      two.income = incomePerSecond(save);
      two.cannon = save.cannon;
      two.levelUps = levelUps;
      two.rewards = save.pulls + upgrades + levelUps;
    }
  }
  return { m, two };
}

/** Levels gained by everything on display, for counting level-ups. */
function levelsOf(save: Save): number {
  return save.pads.reduce((n, slot) => n + (slot ? (slot.level ?? 1) - 1 : 0), 0);
}

const results = Array.from({ length: 300 }, () => simulate(240));
const runs = results.map((r) => r.m);
const median = (key: keyof Milestones) => {
  const values = runs.map((r) => r[key]).filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
  if (!values.length) return 'not reached';
  const mid = values[Math.floor(values.length / 2)];
  const text = mid < 120 ? `${Math.round(mid)} s` : `${(mid / 60).toFixed(1)} min`;
  return `${text}${values.length < runs.length ? ` (${values.length}/${runs.length} runs)` : ''}`;
};
const mid = (pick: (two: AtTwo) => number) => {
  const values = results.map((r) => pick(r.two)).sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
};
const share = (test: (two: AtTwo) => boolean) => `${Math.round((results.filter((r) => test(r.two)).length / results.length) * 100)}%`;
const RARITY = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Secret'];
console.log(`Median over ${results.length} simulated players, 4 hours each.`);
console.log('');
console.log('The first 2 minutes (the hook):');
console.log(`  first gacha pull          ${median('firstPull')}`);
console.log(`  first cannon upgrade      ${median('firstUpgrade')}`);
console.log(`  third pull                ${median('thirdPull')}`);
console.log(`  first Rare                ${median('firstRare')}`);
console.log(`  first brainrot level-up   ${median('firstLevelUp')}`);
console.log(`  at 2 min: ${mid((x) => x.pulls)} pulls, ${mid((x) => x.rewards)} rewards, cannon Lv ${mid((x) => x.cannon)}, ${mid((x) => x.income)} coins/s, best ${RARITY[mid((x) => x.bestRarity)] ?? 'none'}; ${share((x) => x.bestRarity >= 2)} have a Rare`);
console.log('');
console.log('The long game:');
console.log(`  first Cloud Kingdom run   ${median('cloudKingdom')}`);
console.log(`  first Super pull          ${median('superPull')}`);
console.log(`  first slot expansion      ${median('firstExpansion')}`);
console.log(`  first Epic                ${median('firstEpic')}`);
console.log(`  first Legendary on show   ${median('firstLegendary')}`);
console.log(`  all 10 slots open         ${median('allSlots')}`);
console.log(`  first Storm Layer run     ${median('stormLayer')}`);
console.log(`  rebirth unlocks           ${median('stormCannon')}`);

// Gacha value per gem, pity included: a tier that costs more must be worth more per gem, or players should
// (and will) skip it. Value counts each pull at what it would be worth merged up into Commons.
const mergeValue = [1];
for (let r = 1; r < 6; r++) mergeValue[r] = mergeValue[r - 1] * MERGE[r - 1];
console.log('');
console.log('Gacha value per 1,000 gems (pity included):');
for (const tier of GACHA) {
  const save = defaultSave();
  save.pulls = 10;
  save.best = 1_000;
  save.gems = 2_000_000;
  const spent = save.gems;
  const counts = [0, 0, 0, 0, 0, 0, 0];
  while (save.gems >= tier.cost) counts[pull(save, tier)!.rarity]++;
  const per = (n: number) => ((n / spent) * 1000).toFixed(2);
  const value = counts.reduce((sum, n, r) => sum + n * (mergeValue[r] ?? 0), 0);
  console.log(
    `  ${tier.name.padEnd(10)} Mythic ${per(counts[5])}, Legendary+ ${per(counts[4] + counts[5])}, Epic+ ${per(counts[3] + counts[4] + counts[5])}, ` +
      `merged-up value ${((value / mergeValue[4] / spent) * 1000).toFixed(2)} Legendaries`,
  );
}
