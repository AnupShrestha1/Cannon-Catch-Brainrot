// Coins, upgrades, pads and selling: pure rules over the save.
import { ECONOMY, LEVELS, RARITIES, REBIRTH, UPGRADES, type Track } from './config';
import type { PadSlot, Save } from './store';

export function upgradesBought(save: Save, track: Track): number {
  switch (track) {
    case 'cannon':
      return save.cannon - 1;
    case 'carry':
      return save.carryLevel;
    default:
      return save[track];
  }
}

export function buyUpgrade(save: Save, track: Track): void {
  if (track === 'cannon') save.cannon += 1;
  else if (track === 'carry') save.carryLevel += 1;
  else save[track] += 1;
}

/** Multiplier from the magnet, steering or parachute track, e.g. 1.3 after 3 magnet upgrades. */
export function trackBoost(save: Save, track: 'magnet' | 'steering' | 'chute'): number {
  return 1 + save[track] * UPGRADES[track].effect;
}

/** Price of the next purchase on a track, or null at max. */
export function upgradeCost(save: Save, track: Track): number | null {
  const bought = upgradesBought(save, track);
  const u = UPGRADES[track];
  return bought >= u.max ? null : Math.round(u.base * Math.pow(u.growth, bought));
}

export function carryLimit(save: Save): number {
  return ECONOMY.startCarry + save.carryLevel;
}

/** Price of the next 4 pads, or null at max. */
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

export interface Catch {
  name: string;
  rarity: number;
}

export interface Outcome {
  /** Pad the catch went to, or null if it was sold. */
  pad: number | null;
  /** Coins from selling the catch, or from selling the character it replaced. */
  coins: number;
  /** Name of the character the catch replaced, if any. */
  replaced: string | null;
}

/**
 * Auto-placement, best catches first: a free pad if there is one, else the weakest placed character
 * is sold to make room when the catch earns more, else the catch itself is sold.
 * Returns one outcome per catch, in the catches' order.
 */
export function placeCatches(save: Save, catches: Catch[]): Outcome[] {
  const outcomes: Outcome[] = catches.map(() => ({ pad: null, coins: 0, replaced: null }));
  const order = catches.map((_, i) => i).sort((a, b) => catches[b].rarity - catches[a].rarity);
  for (const i of order) {
    const c = catches[i];
    let pad = save.pads.findIndex((slot) => slot === null);
    if (pad < 0) {
      // Weakest by income, so a levelled-up character isn't sold for a barely rarer newcomer.
      let weakest = 0;
      save.pads.forEach((slot, k) => {
        if (slot && padIncome(save, slot) < padIncome(save, save.pads[weakest]!)) weakest = k;
      });
      const old = save.pads[weakest]!;
      if (padIncome(save, c) <= padIncome(save, old)) {
        outcomes[i].coins = sellValue(save, c);
        save.coins += outcomes[i].coins;
        continue;
      }
      pad = weakest;
      outcomes[i].coins = sellValue(save, old) + Math.floor(old.cash);
      outcomes[i].replaced = old.name;
      save.coins += outcomes[i].coins;
    }
    save.pads[pad] = { name: c.name, rarity: c.rarity, cash: 0, level: 1 };
    outcomes[i].pad = pad;
  }
  return outcomes;
}

export function formatCoins(n: number): string {
  if (n < 10_000) return Math.floor(n).toLocaleString('en-US');
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
