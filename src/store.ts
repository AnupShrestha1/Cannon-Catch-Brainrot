// Local save for the prototype. Browser storage can be missing or blocked, so every access is guarded.

export type HazardMode = 'auto' | 'on' | 'off';

export interface Save {
  flightNo: number;
  best: number;
  level: number;
  carry: number;
  hazards: HazardMode;
  muted: boolean;
}

const KEY = 'ccb-prototype-v1';
const DEFAULTS: Save = { flightNo: 0, best: 0, level: 1, carry: 3, hazards: 'auto', muted: false };

export function loadSave(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Save>) };
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULTS };
}

export function writeSave(save: Save): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // progress just won't persist
  }
}
