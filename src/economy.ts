// Coins, gems, upgrades, pads, the gacha, merging and selling: pure rules over the save.
import {
  ECONOMY,
  LEVELS,
  MAX_ZONE,
  MERGE,
  RARITIES,
  REBIRTH,
  ROSTER,
  STARTER_PULLS,
  UPGRADES,
  ZONES,
  launchHeight,
  rollTier,
  type GachaTier,
  type Track,
} from './config';
import type { Owned, PadSlot, Save } from './store';

export function upgradesBought(save: Save, track: Track): number {
  return track === 'cannon' ? save.cannon - 1 : save[track];
}

export function buyUpgrade(save: Save, track: Track): void {
  if (track === 'cannon') save.cannon += 1;
  else save[track] += 1;
}

/** Multiplier from a percentage track, e.g. 1.3 after 3 magnet upgrades. */
export function trackBoost(save: Save, track: 'finder' | 'magnet' | 'steering' | 'chute'): number {
  return 1 + save[track] * UPGRADES[track].effect;
}

/**
 * The highest zone flights can reach: each rebirth opens the next one (Cloud Kingdom before the first, the
 * Storm Layer after it), so a new area waits on the other side of every rebirth.
 */
export function zoneCap(save: Pick<Save, 'rebirths'>): number {
  return Math.min(MAX_ZONE, 1 + save.rebirths);
}

/** How high a flight can go: just under the next zone until a rebirth opens it. */
export function flightCeiling(save: Pick<Save, 'rebirths'>): number {
  const z = zoneCap(save);
  return z < MAX_ZONE ? ZONES[z + 1].from - 6 : Infinity;
}

/** A launch's apex: the cannon's height with the charge bonus, held under the ceiling. */
export function flightApex(save: Pick<Save, 'rebirths' | 'cannon'>, bonus: number): number {
  return Math.min(launchHeight(save.cannon) * (1 + bonus), flightCeiling(save));
}

/** The top cannon level for now: while a zone is still closed, the next rebirth's level (more would be wasted). */
export function cannonCap(save: Pick<Save, 'rebirths'>): number {
  return zoneCap(save) < MAX_ZONE ? rebirthCannonLevel(save) : UPGRADES.cannon.max + 1;
}

/** Price of the next purchase on a track, or null at max. */
export function upgradeCost(save: Save, track: Track): number | null {
  if (track === 'cannon' && save.cannon >= cannonCap(save)) return null;
  const bought = upgradesBought(save, track);
  const u = UPGRADES[track];
  return bought >= u.max ? null : Math.round(u.base * Math.pow(u.growth, bought));
}

/** The cannon level the next rebirth needs: a little higher each time, up to the top level. */
export function rebirthCannonLevel(save: Pick<Save, 'rebirths'>): number {
  return Math.min(UPGRADES.cannon.max + 1, REBIRTH.cannonLevel + REBIRTH.cannonStep * save.rebirths);
}

/**
 * Levels belong to slots, not brainrots: a slot keeps its level and XP when its brainrot is swapped, stored or
 * sold, and whatever goes on it earns at that level. The level lives on the brainrot's PadSlot while the slot
 * is filled, and in save.padLevels while it's empty.
 */
export function slotLevel(save: Save, i: number): { level: number; xp: number } {
  const pad = save.pads[i];
  if (pad) return { level: pad.level ?? 1, xp: pad.xp ?? 0 };
  return save.padLevels[i] ?? { level: 1, xp: 0 };
}

/** Puts a brainrot on slot i (replacing whatever was there), at the slot's level. */
export function putOnPad(save: Save, i: number, o: Owned): void {
  const { level, xp } = slotLevel(save, i);
  save.pads[i] = { name: o.name, rarity: o.rarity, cash: 0, level, xp };
}

/** Empties slot i, keeping its level for the next brainrot. */
export function emptyPad(save: Save, i: number): void {
  const pad = save.pads[i];
  if (pad) save.padLevels[i] = { level: pad.level ?? 1, xp: pad.xp ?? 0 };
  save.pads[i] = null;
}

/** Floors of the base: one, plus one for each of the first REBIRTH.floors rebirths. */
export function floorsOf(save: Pick<Save, 'rebirths'>): number {
  return 1 + Math.min(save.rebirths, REBIRTH.floors);
}

/** How many slots the base can have, over all its floors. */
export function maxPads(save: Pick<Save, 'rebirths'>): number {
  return ECONOMY.padsPerFloor * floorsOf(save);
}

/** Price of the next pair of slots, or null at max. */
export function expansionCost(save: Save): number | null {
  const pads = save.pads.length;
  if (pads >= maxPads(save)) return null;
  const floor = Math.floor(pads / ECONOMY.padsPerFloor);
  if (floor === 0) return Math.round(ECONOMY.firstExpansion * Math.pow(ECONOMY.expansionGrowth, (pads - ECONOMY.startPads) / ECONOMY.padStep));
  // Floors above: priced per floor, so the top floor's slots don't run away (Floor 2: 470K, 890K, 1.7M;
  // Floor 3: 1.9M, 3.6M, 6.8M; Floor 4: 7.5M, 14M, 27M).
  const step = Math.max(0, (pads % ECONOMY.padsPerFloor) - REBIRTH.newFloorPads) / ECONOMY.padStep;
  const floorStart = ECONOMY.firstExpansion * Math.pow(ECONOMY.expansionGrowth, 3) * Math.pow(ECONOMY.lateExpansionGrowth, 2);
  return Math.round(floorStart * Math.pow(ECONOMY.floorExpansionGrowth, floor - 1) * Math.pow(ECONOMY.lateExpansionGrowth, step));
}

/**
 * Rebirth: back to the start (coins, gems, upgrades, brainrots) for a permanent income bonus, keeping the rarest
 * brainrot and every open slot. The first three also add a floor to the base, with a few of its slots open.
 * Returns what was kept, and whether a floor was added.
 */
export function rebirthSave(save: Save): { kept: Owned | null; newFloor: boolean } {
  let kept: Owned | null = null;
  for (const o of [...save.pads, ...save.inventory]) if (o && (!kept || o.rarity > kept.rarity)) kept = { name: o.name, rarity: o.rarity };
  const floorsBefore = floorsOf(save);
  save.rebirths += 1;
  const newFloor = floorsOf(save) > floorsBefore;
  save.coins = 0;
  save.gems = 0;
  save.cannon = 1;
  // The gacha machines lock again: they unlock as this run's flights reach their heights.
  save.bestSinceRebirth = 0;
  save.finder = save.magnet = save.steering = save.chute = save.shield = 0;
  let open = Math.max(ECONOMY.startPads, save.pads.length);
  // A new floor: everything below it opens, and it comes with a few slots of its own.
  if (newFloor) open = ECONOMY.padsPerFloor * floorsBefore + REBIRTH.newFloorPads;
  // Slot levels start over too.
  save.pads = Array.from({ length: Math.min(open, maxPads(save)) }, () => null);
  save.padLevels = [];
  save.inventory = [];
  if (kept) putOnPad(save, 0, kept);
  return { kept, newFloor };
}

/** Merges these particular backpack brainrots (all one rarity, exactly as many as a merge needs) into one. */
export function mergeChosen(save: Save, chosen: Owned[]): Owned | null {
  if (!chosen.length) return null;
  const rarity = chosen[0].rarity;
  const need = mergeNeed(rarity);
  if (need === null || chosen.length !== need || chosen.some((o) => o.rarity !== rarity || !save.inventory.includes(o))) return null;
  save.inventory = save.inventory.filter((o) => !chosen.includes(o));
  const got = { name: pickName(rarity + 1), rarity: rarity + 1 };
  save.inventory.push(got);
  return got;
}

/**
 * Income multiplier from rebirths: +incomeBonus for each of the first endGameAfter (×1.5, ×2, ×2.5), then
 * compounding ×(1 + endGameBonus) for every end-game rebirth after that.
 */
export function incomeMultiplier(save: Pick<Save, 'rebirths'>): number {
  const early = Math.min(save.rebirths, REBIRTH.endGameAfter);
  const late = Math.max(0, save.rebirths - REBIRTH.endGameAfter);
  return (1 + early * REBIRTH.incomeBonus) * Math.pow(1 + REBIRTH.endGameBonus, late);
}

/** A multiplier for display: "1.5", "2.25", "3.38", "11", "57". */
export function formatMult(m: number): string {
  return m >= 10 ? String(Math.round(m)) : String(+m.toFixed(2));
}

/** Income of one character on a pad, after its level and rebirths. */
export function padIncome(save: Save, slot: Pick<PadSlot, 'rarity' | 'level'>): number {
  const level = slot.level ?? 1;
  return RARITIES[slot.rarity].income * (1 + (level - 1) * LEVELS.incomeBonus) * incomeMultiplier(save);
}

export function incomePerSecond(save: Save): number {
  let total = 0;
  for (const slot of save.pads) if (slot) total += padIncome(save, slot);
  return total;
}

/** Seconds on a pad the next level needs, or null at max. */
export function xpNeeded(slot: Pick<PadSlot, 'level'>): number | null {
  const level = slot.level ?? 1;
  if (level >= LEVELS.max) return null;
  return Math.round(LEVELS.xpFirstSeconds * Math.pow(LEVELS.xpGrowth, level - 1));
}

/** Whether a character has the XP for its next level. */
export function levelReady(slot: PadSlot): boolean {
  const need = xpNeeded(slot);
  return need !== null && (slot.xp ?? 0) >= need;
}

/** Adds XP, stopping at what the next level needs. Returns true if this made the level ready. */
export function gainXp(slot: PadSlot, seconds: number): boolean {
  const need = xpNeeded(slot);
  if (need === null) return false;
  const before = slot.xp ?? 0;
  slot.xp = Math.min(need, before + seconds);
  return before < need && slot.xp >= need;
}

/** Price of a slot's next level, or null at max. It depends on the slot's level only, not what's on it. */
export function levelCost(slot: Pick<PadSlot, 'level'>): number | null {
  const level = slot.level ?? 1;
  if (level >= LEVELS.max) return null;
  return Math.round(LEVELS.slotCost * Math.pow(LEVELS.costGrowth, level - 1));
}

/** Selling pays ECONOMY.sellSeconds of the character's own income (the slot's level stays with the slot). */
export function sellValue(save: Save, slot: Pick<PadSlot, 'rarity'>): number {
  return Math.round(padIncome(save, { rarity: slot.rarity }) * ECONOMY.sellSeconds);
}

export function pickName(rarity: number): string {
  const names = ROSTER[rarity];
  return names[Math.floor(Math.random() * names.length)];
}

/** Whether a gacha tier is unlocked: the Super pull waits until a run has reached Cloud Kingdom. */
export function tierUnlocked(save: Save, tier: GachaTier): boolean {
  return save.bestSinceRebirth >= tier.unlockBest;
}

/**
 * Spends the gems and rolls a brainrot into the backpack, or returns null if the player can't afford it.
 * Hidden pity raises the roll when a tier's counter for a rarity is due, then the counters update.
 */
export function pull(save: Save, tier: GachaTier): Owned | null {
  if (save.gems < tier.cost || !tierUnlocked(save, tier)) return null;
  save.gems -= tier.cost;
  let rarity = rollTier(tier);
  // The scripted start (first 10 pulls), then the normal odds and pity.
  rarity = Math.max(rarity, STARTER_PULLS[save.pulls + 1] ?? 0);
  const counters = (save.pity[tier.id] ??= {});
  for (const [floor, every] of tier.pity) {
    if ((counters[floor] ?? 0) + 1 >= every) rarity = Math.max(rarity, floor);
  }
  // A machine never gives anything above its own band, scripted start or not.
  rarity = Math.min(rarity, tier.odds[tier.odds.length - 1][0]);
  for (const [floor] of tier.pity) counters[floor] = rarity >= floor ? 0 : (counters[floor] ?? 0) + 1;
  save.pulls += 1;
  const got = { name: pickName(rarity), rarity };
  save.inventory.push(got);
  return got;
}

export function countInBackpack(save: Save, rarity: number): number {
  return save.inventory.filter((o) => o.rarity === rarity).length;
}

/** How many of a rarity make one of the next, or null when it can't be merged. */
export function mergeNeed(rarity: number): number | null {
  return MERGE[rarity] ?? null;
}

/** Merges the backpack's characters of a rarity into one of the next rarity up, or returns null. */
export function merge(save: Save, rarity: number): Owned | null {
  const need = mergeNeed(rarity);
  if (need === null || countInBackpack(save, rarity) < need) return null;
  let left = need;
  save.inventory = save.inventory.filter((o) => !(o.rarity === rarity && left-- > 0));
  const got = { name: pickName(rarity + 1), rarity: rarity + 1 };
  save.inventory.push(got);
  return got;
}

/** Removes one backpack character by name and returns it, or null. */
export function takeFromBackpack(save: Save, name: string): Owned | null {
  const i = save.inventory.findIndex((o) => o.name === name);
  return i < 0 ? null : save.inventory.splice(i, 1)[0];
}

export function formatCoins(n: number): string {
  if (n < 10_000) return Math.floor(n).toLocaleString('en-US');
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}
