// Local save. Browser storage can be missing or blocked, so every access is guarded.
import { ECONOMY } from './config';

export type HazardMode = 'auto' | 'on' | 'off';

export interface PadSlot {
  name: string;
  rarity: number;
  /** Uncollected coins piled on the pad. */
  cash: number;
}

export interface Save {
  flightNo: number;
  best: number;
  /** Cannon level, from 1. */
  cannon: number;
  /** Carry upgrades bought; the limit is ECONOMY.startCarry plus this. */
  carryLevel: number;
  coins: number;
  pads: (PadSlot | null)[];
  hazards: HazardMode;
  muted: boolean;
  /** Tutorial hints already completed. */
  hints: string[];
}

const KEY = 'ccb-slice-v1';
// Dev-only: ?nosave starts fresh and never touches the real save, for scripted tests.
const ephemeral = import.meta.env.DEV && new URLSearchParams(location.search).has('nosave');

export function defaultSave(): Save {
  return {
    flightNo: 0,
    best: 0,
    cannon: 1,
    carryLevel: 0,
    coins: 0,
    pads: Array.from({ length: ECONOMY.startPads }, () => null),
    hazards: 'auto',
    muted: false,
    hints: [],
  };
}

export function loadSave(): Save {
  const save = defaultSave();
  if (ephemeral) return save;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(save, JSON.parse(raw) as Partial<Save>);
  } catch {
    // fall through to defaults
  }
  while (save.pads.length < ECONOMY.startPads) save.pads.push(null);
  return save;
}

export function writeSave(save: Save): void {
  if (ephemeral) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // progress just won't persist
  }
}

export function clearSave(): void {
  if (ephemeral) return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
