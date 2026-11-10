// Local save. Browser storage can be missing or blocked, so every access is guarded.
import { ECONOMY, UPGRADES } from './config';
import { maxPads } from './economy';
import { defaultProfile, type Profile } from './profile';

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

/** An empty slot's level and XP, kept for the next brainrot put on it. */
export interface SlotLevel {
  level: number;
  xp: number;
}

/** A brainrot in the backpack: pulled or stored, not on a showcase slot. */
export interface Owned {
  name: string;
  rarity: number;
}

export interface Save {
  flightNo: number;
  best: number;
  /** The best height since the last rebirth: gacha machines unlock from this, so they lock again on rebirth. */
  bestSinceRebirth: number;
  /** Cannon level, from 1. */
  cannon: number;
  /** Gem finder, gem magnet, steering and parachute upgrades bought. */
  finder: number;
  magnet: number;
  steering: number;
  chute: number;
  /** Shields bought: each blocks one hit per flight. */
  shield: number;
  rebirths: number;
  coins: number;
  /** The gacha currency, collected in the sky. */
  gems: number;
  /** Gacha pulls made, for the guaranteed first pull. */
  pulls: number;
  /** Hidden pity: per gacha tier, pulls since the last of each pity rarity or better. */
  pity: Record<string, Record<number, number>>;
  /** Showcase slots that are open; locked ones aren't in the array. */
  pads: (PadSlot | null)[];
  /** Levels of empty slots, by index (a filled slot keeps its level on its brainrot). */
  padLevels: (SlotLevel | null)[];
  /** Brainrots owned but not on a slot. */
  inventory: Owned[];
  hazards: HazardMode;
  muted: boolean;
  /** Background music switched off (sound effects stay on). */
  musicOff: boolean;
  /** Tutorial hints already completed. */
  hints: string[];
  /** When the game last saved, for offline earnings (ms since 1970). */
  lastSeen: number;
  /** Day of the login streak last claimed (1–7), and the local date it was claimed. */
  dailyStreak: number;
  lastDaily: string;
  /** Names of every character ever caught, for the collection book. */
  collected: string[];
  /** Book pages whose completion reward was claimed. */
  bookClaimed: number[];
  /** Active play time in game seconds (sped-up time counts as game time), and in real seconds. */
  playTime: number;
  playReal: number;
  /** Your name and avatar. */
  profile: Profile;
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
    bestSinceRebirth: 0,
    cannon: 1,
    finder: 0,
    shield: 0,
    magnet: 0,
    steering: 0,
    chute: 0,
    rebirths: 0,
    coins: 0,
    gems: 0,
    pulls: 0,
    pity: {},
    pads: Array.from({ length: ECONOMY.startPads }, () => null),
    padLevels: [],
    inventory: [],
    hazards: 'auto',
    muted: false,
    musicOff: false,
    hints: [],
    lastSeen: 0,
    dailyStreak: 0,
    lastDaily: '',
    collected: [],
    bookClaimed: [],
    playTime: 0,
    playReal: 0,
    profile: defaultProfile(),
  };
}

export function loadSave(): Save {
  const save = defaultSave();
  if (ephemeral) return save;
  try {
    const raw = (backend ?? localStorage).getItem(KEY);
    if (raw) {
      const old = JSON.parse(raw) as Partial<Save> & { carrying?: Owned[]; carryLevel?: number };
      // Saves from before the gacha: catches still carried go to the backpack.
      if (Array.isArray(old.carrying)) save.inventory.push(...old.carrying);
      delete old.carrying;
      delete old.carryLevel;
      Object.assign(save, old);
      // Saves from before machines re-locked on rebirth: their machines stay as they were.
      if (old.bestSinceRebirth === undefined) save.bestSinceRebirth = save.best;
    }
  } catch {
    // fall through to defaults
  }
  // The showcase holds 10 slots per floor, in pairs; older bases could have 40 pads, whose extras go to the backpack.
  for (const slot of save.pads.splice(maxPads(save))) if (slot) save.inventory.push({ name: slot.name, rarity: slot.rarity });
  while (save.pads.length < ECONOMY.startPads || save.pads.length % ECONOMY.padStep) save.pads.push(null);
  save.finder = Math.min(save.finder, UPGRADES.finder.max);
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
