// Coins, gems, upgrades, pads, the gacha, merging and selling: pure rules over the save.
import { ECONOMY, LEVELS, MERGE, RARITIES, REBIRTH, ROSTER, STARTER_PULLS, UPGRADES, rollTier, type GachaTier, type Track } from './config';
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

/** Price of the next purchase on a track, or null at max. */
export function upgradeCost(save: Save, track: Track): number | null {
  const bought = upgradesBought(save, track);
  const u = UPGRADES[track];
  return bought >= u.max ? null : Math.round(u.base * Math.pow(u.growth, bought));
}

/** Price of the next pair of slots, or null at max. */
export function expansionCost(save: Save): number | null {
  const pads = save.pads.length;
  if (pads >= ECONOMY.maxPads) return null;
  const step = (pads - ECONOMY.startPads) / ECONOMY.padStep;
  return Math.round(ECONOMY.firstExpansion * Math.pow(ECONOMY.expansionGrowth, step));
}

export function incomeMultiplier(save: Save): number {
  return 1 + save.rebirths * REBIRTH.incomeBonus;
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

/** Price of the next level for a character, or null at max. */
export function levelCost(slot: PadSlot): number | null {
  const level = slot.level ?? 1;
  if (level >= LEVELS.max) return null;
  return Math.round(RARITIES[slot.rarity].income * LEVELS.firstCostSeconds * Math.pow(LEVELS.growth, level - 1));
}

/** Selling pays ECONOMY.sellSeconds of the character's current income. */
export function sellValue(save: Save, slot: Pick<PadSlot, 'rarity' | 'level'>): number {
  return Math.round(padIncome(save, slot) * ECONOMY.sellSeconds);
}

export function pickName(rarity: number): string {
  const names = ROSTER[rarity];
  return names[Math.floor(Math.random() * names.length)];
}

/** Whether a gacha tier is unlocked: the Super pull waits until a run has reached Cloud Kingdom. */
export function tierUnlocked(save: Save, tier: GachaTier): boolean {
  return save.best >= tier.unlockBest;
}

/**
 * Spends the gems and rolls a brainrot into the backpack, or returns null if the player can't afford it.
 * Hidden pity raises the roll when a tier's counter for a rarity is due, then the counters update.
 */
export function pull(save: Save, tier: GachaTier): Owned | null {
  if (save.gems < tier.cost || !tierUnlocked(save, tier)) return null;
  save.gems -= tier.cost;
  let rarity = rollTier(tier);
  rarity = Math.max(rarity, STARTER_PULLS[save.pulls + 1] ?? 0);
  const counters = (save.pity[tier.id] ??= {});
  for (const [floor, every] of tier.pity) {
    if ((counters[floor] ?? 0) + 1 >= every) rarity = Math.max(rarity, floor);
  }
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
