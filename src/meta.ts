// Reasons to come back: offline earnings, the daily login streak and the collection book.
// Pure rules over the save; Game shows them.
import { ROSTER } from './config';
import { incomePerSecond } from './economy';
import type { Save } from './store';

/** Characters keep earning while the player is away, at half rate, for up to 2 hours. */
export const OFFLINE = { rate: 0.5, capSeconds: 2 * 60 * 60, minSeconds: 60 };

export function offlineEarnings(save: Save, now: number): { seconds: number; coins: number } {
  if (!save.lastSeen) return { seconds: 0, coins: 0 };
  const seconds = Math.min(OFFLINE.capSeconds, Math.max(0, (now - save.lastSeen) / 1000));
  if (seconds < OFFLINE.minSeconds) return { seconds: 0, coins: 0 };
  return { seconds, coins: Math.floor(incomePerSecond(save) * seconds * OFFLINE.rate) };
}

export type DailyReward = { kind: 'coins'; minutes: number } | { kind: 'character'; rarity: number };

/** The 7-day streak from the design doc: coins, a guaranteed Rare on day 3, a guaranteed Epic on day 7. */
export const DAILY: DailyReward[] = [
  { kind: 'coins', minutes: 1 },
  { kind: 'coins', minutes: 2 },
  { kind: 'character', rarity: 2 },
  { kind: 'coins', minutes: 3 },
  { kind: 'coins', minutes: 4 },
  { kind: 'coins', minutes: 5 },
  { kind: 'character', rarity: 3 },
];

/** Coin rewards pay minutes of current income, with a floor so a new player's first days still feel good. */
export function dailyCoins(save: Save, minutes: number): number {
  return Math.max(100 * minutes, Math.round(incomePerSecond(save) * 60 * minutes));
}

/** Local calendar day, so the streak rolls over at the player's midnight. */
export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Whether today's reward is unclaimed, and which streak day (1–7) it is. Missing a day restarts at 1. */
export function dailyStatus(save: Save, now: Date): { due: boolean; day: number } {
  const today = dayKey(now);
  if (save.lastDaily === today) return { due: false, day: save.dailyStreak };
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const day = save.lastDaily === yesterday ? (save.dailyStreak % DAILY.length) + 1 : 1;
  return { due: true, day };
}

export interface BookZone {
  name: string;
  rarities: number[];
  reward: number;
}

/** Book pages by rarity, each paying out once when every character on it has been pulled. */
export const BOOK_ZONES: BookZone[] = [
  { name: 'Common & Uncommon', rarities: [0, 1], reward: 500 },
  { name: 'Rare & Epic', rarities: [2, 3], reward: 5000 },
  { name: 'Legendary', rarities: [4], reward: 50000 },
  { name: 'Mythic', rarities: [5], reward: 250000 },
];

export function bookEntries(zone: BookZone): { name: string; rarity: number }[] {
  return zone.rarities.flatMap((rarity) => ROSTER[rarity].map((name) => ({ name, rarity })));
}

export function zoneComplete(save: Save, zone: BookZone): boolean {
  return bookEntries(zone).every((entry) => save.collected.includes(entry.name));
}
