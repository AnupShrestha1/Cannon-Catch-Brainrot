// Local save. Browser storage can be missing or blocked, so every access is guarded.
import { ECONOMY, UPGRADES } from './config';

export type HazardMode = 'auto' | 'on' | 'off';

export interface PadSlot {
  name: string;
  rarity: number;
  /** Uncollected coins piled on the pad. */
  cash: number;
  /** 1 to LEVELS.max; missing in saves from before levels. */
  level?: number;
  /** Seconds of XP toward the next level. */
  xp?: number;
}

export interface Save {
  flightNo: number;
  best: number;
  /** Cannon level, from 1. */
  cannon: number;
  /** Carry upgrades bought; the limit is ECONOMY.startCarry plus this. */
  carryLevel: number;
  /** Grab magnet, steering and parachute upgrades bought. */
  magnet: number;
  steering: number;
  chute: number;
  rebirths: number;
  coins: number;
  pads: (PadSlot | null)[];
  hazards: HazardMode;
  muted: boolean;
  /** Tutorial hints already completed. */
  hints: string[];
  /** When the game last saved, for offline earnings (ms since 1970). */
  lastSeen: number;
  /** Day of the login streak last claimed (1–7), and the local date it was claimed. */
  dailyStreak: number;
  lastDaily: string;
  /** Names of every character ever caught, for the collection book. */
  collected: string[];
  /** Book pages (zone indexes) whose completion reward was claimed. */
  bookClaimed: number[];
  /** Caught characters the player is carrying at the base, not yet placed or sold. */
  carrying: { name: string; rarity: number }[];
}

const KEY = 'ccb-slice-v1';
// Dev-only: ?nosave starts fresh and never touches the real save, for scripted tests.
const ephemeral = import.meta.env.DEV && new URLSearchParams(location.search).has('nosave');

type Backend = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
let backend: Backend | null = null;

/** Saves go to this instead of localStorage, e.g. the CrazyGames SDK's cross-device save. */
export function useStorage(storage: Backend): void {
  backend = storage;
}

export function defaultSave(): Save {
  return {
    flightNo: 0,
    best: 0,
    cannon: 1,
    carryLevel: 0,
    magnet: 0,
    steering: 0,
    chute: 0,
    rebirths: 0,
    coins: 0,
    pads: Array.from({ length: ECONOMY.startPads }, () => null),
    hazards: 'auto',
    muted: false,
    hints: [],
    lastSeen: 0,
    dailyStreak: 0,
    lastDaily: '',
    collected: [],
    bookClaimed: [],
    carrying: [],
  };
}

export function loadSave(): Save {
  const save = defaultSave();
  if (ephemeral) return save;
  try {
    const raw = (backend ?? localStorage).getItem(KEY);
    if (raw) Object.assign(save, JSON.parse(raw) as Partial<Save>);
  } catch {
    // fall through to defaults
  }
  while (save.pads.length < ECONOMY.startPads) save.pads.push(null);
  // Older saves could carry up to 15; the cap is now 8.
  save.carryLevel = Math.min(save.carryLevel, UPGRADES.carry.max);
  return save;
}

export function writeSave(save: Save): void {
  save.lastSeen = Date.now();
  if (ephemeral) return;
  try {
    (backend ?? localStorage).setItem(KEY, JSON.stringify(save));
  } catch {
    // progress just won't persist
  }
}

export function clearSave(): void {
  if (ephemeral) return;
  try {
    (backend ?? localStorage).removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
