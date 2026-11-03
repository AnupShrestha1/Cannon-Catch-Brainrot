// First-pass values from the design doc. Everything here is meant to be tuned in playtests.

export interface RarityDef {
  name: string;
  color: number;
  css: string;
  income: number;
}

export const RARITIES: RarityDef[] = [
  { name: 'Common', color: 0x9aa3ad, css: '#9aa3ad', income: 1 },
  { name: 'Uncommon', color: 0x3ccf5a, css: '#3ccf5a', income: 3 },
  { name: 'Rare', color: 0x2f7dff, css: '#2f7dff', income: 8 },
  { name: 'Epic', color: 0xa64dff, css: '#a64dff', income: 25 },
  { name: 'Legendary', color: 0xffc21a, css: '#ffc21a', income: 90 },
  { name: 'Mythic', color: 0xff3b3b, css: '#ff3b3b', income: 350 },
  { name: 'Secret', color: 0xffffff, css: '#ffffff', income: 1500 },
];

/** Grabs at this rarity and above get slow-mo and a bigger reveal. */
export const RARE = 2;

// Basic Launch roster: 10 of the design doc's 21 characters, up to Legendary. It skips the three
// names the doc flags as too close to their originals.
export const ROSTER: string[][] = [
  ['Cannolini Cannonino', 'Tostino Tortorino'],
  ['Lampadino Lumachino', 'Spazzolino Struzzo'],
  ['Ginnasta Gelatina', 'Ventilatore Tartarughino'],
  ['Pizzarotto Pellicano', 'Ninja Macchiatino'],
  ['Elicottero Ippopotamo', 'Frigorifero Fenicottero'],
  [],
  [],
];

export interface Zone {
  name: string;
  from: number;
  sky: number;
  /** [rarity index, chance] pairs that sum to 1. */
  spawns: [number, number][];
  hazard: number;
}

export const ZONES: Zone[] = [
  { name: 'Low Sky', from: 0, sky: 0x8fd3ff, spawns: [[0, 0.7], [1, 0.3]], hazard: 0x3b3b46 },
  { name: 'Cloud Kingdom', from: 150, sky: 0xffc98a, spawns: [[2, 0.6], [3, 0.4]], hazard: 0x8a4b2a },
  { name: 'Storm Layer', from: 400, sky: 0x5b3f8f, spawns: [[3, 0.8], [4, 0.2]], hazard: 0x1e1e2c },
  { name: 'Edge of Space', from: 800, sky: 0x16224d, spawns: [[4, 0.65], [5, 0.35]], hazard: 0xb8c0cc },
  { name: 'Cosmic', from: 1500, sky: 0x2a0d45, spawns: [[5, 0.85], [6, 0.15]], hazard: 0xff7a3d },
];

/** Basic Launch has Low Sky, Cloud Kingdom and Storm Layer. */
export const MAX_ZONE = 2;

export function zoneIndexAt(y: number): number {
  let index = 0;
  for (let i = 0; i < ZONES.length; i++) if (y >= ZONES[i].from) index = i;
  return index;
}

export function rollRarity(y: number): number {
  const spawns = ZONES[Math.min(zoneIndexAt(y), MAX_ZONE)].spawns;
  let roll = Math.random();
  for (const [rarity, chance] of spawns) {
    roll -= chance;
    if (roll < 0) return rarity;
  }
  return spawns[spawns.length - 1][0];
}

export function pickName(rarity: number): string {
  const names = ROSTER[rarity];
  return names[Math.floor(Math.random() * names.length)];
}

// Normal-launch apex per cannon level, log-linear between these anchors, so each zone's level
// in the design doc is the first level whose normal launch reaches it.
const HEIGHT_ANCHORS: [number, number][] = [[1, 90], [12, 155], [28, 410], [45, 820], [60, 1550]];

export function launchHeight(level: number): number {
  const l = Math.min(60, Math.max(1, level));
  for (let i = 1; i < HEIGHT_ANCHORS.length; i++) {
    const [l1, h1] = HEIGHT_ANCHORS[i];
    if (l <= l1) {
      const [l0, h0] = HEIGHT_ANCHORS[i - 1];
      return h0 * Math.pow(h1 / h0, (l - l0) / (l1 - l0));
    }
  }
  return HEIGHT_ANCHORS[HEIGHT_ANCHORS.length - 1][1];
}

/** The first cannon level whose normal launch reaches a height. */
export function levelToReach(height: number): number {
  for (let level = 1; level <= 60; level++) if (launchHeight(level) >= height) return level;
  return 60;
}

export const CHARGE = {
  /** Seconds for the meter to go 0 → 1 → 0. */
  period: 1.3,
  green: [0.7, 0.92] as const,
  perfect: [0.79, 0.85] as const,
  greenBonus: 0.15,
  perfectBonus: 0.3,
};

export const FLIGHT = {
  /** Half-width of the steerable column, in metres. */
  lane: 11,
  spawnHalfWidth: 9.5,
  steerSpeed: 17,
  chuteSteer: 0.55,
  /** Seconds from launch to apex for a given apex height. */
  ascentTime: (h: number) => 4 + 2.5 * Math.sqrt(h / 150),
  minTerminal: 16,
  /** Seconds of free fall to reach terminal speed. */
  terminalReach: 1.6,
  chuteSpeed: 6,
  chuteDecel: 5,
  /** Ascent speed kept after a hazard hit. */
  hitSlow: 0.85,
  tumbleFall: 5,
  playerRadius: 0.8,
  pickupRadius: 1.1,
  hazardRadius: 1.0,
  /** Seconds of ascent between pickup rows, and the smallest height gap between them. */
  pickupStep: 0.5,
  pickupMinGap: 4.5,
};

export const CHUTE = {
  /** Opening with less than this many seconds to impact tangles the chute (crash). */
  late: 0.6,
  tutorialLate: 0.3,
  /** Opening within this many seconds after `late` is a Perfect landing. */
  perfectSpan: 0.7,
  /** Seconds to impact the ground bar shows at its top. */
  barSeconds: 4,
};

export const TUTORIAL = {
  hazardFromFlight: 3,
  noDropFlights: 3,
  wideChuteFlights: 2,
  guaranteedRareFlight: 3,
  /** From this flight, the apex shows the next locked zone and the cannon level it needs. */
  goalFromFlight: 4,
};

export const CRASH_DROP = { tangled: 0.3, noChute: 0.5 };

export type Track = 'cannon' | 'carry' | 'magnet' | 'steering' | 'chute';

export const TRACKS: Track[] = ['cannon', 'carry', 'magnet', 'steering', 'chute'];

/**
 * Cost of the k-th purchase is base × growth^(k−1). `max` counts purchases; `effect` is the gain per
 * purchase for the three percentage tracks.
 */
export const UPGRADES: Record<Track, { name: string; base: number; growth: number; max: number; effect: number }> = {
  // Basic Launch stops at cannon level 37, whose perfect launch stays inside the Storm Layer. The doc goes to 60.
  // Retuned with `npm run sim` from the doc's 50 × 1.18: rebirth now unlocks after about 63 minutes, not 8.
  cannon: { name: 'Cannon power', base: 25, growth: 1.5, max: 36, effect: 0 },
  // At most 8 carried (3 + 5), and only once the player has reached Cloud Kingdom: see CARRY_UNLOCK_HEIGHT.
  carry: { name: 'Carry limit', base: 200, growth: 1.9, max: 5, effect: 0 },
  magnet: { name: 'Grab magnet', base: 120, growth: 1.25, max: 25, effect: 0.1 },
  steering: { name: 'Steering', base: 100, growth: 1.22, max: 25, effect: 0.06 },
  chute: { name: 'Parachute', base: 150, growth: 1.28, max: 20, effect: 0.05 },
};

/** Carry upgrades unlock mid game, once a run has reached this height (Cloud Kingdom). */
export const CARRY_UNLOCK_HEIGHT = 150;

export const REBIRTH = {
  /** Rebirth unlocks at the cannon level whose normal launch reaches the Storm Layer. */
  cannonLevel: 28,
  /** A run this high counts as reaching the Storm Layer. */
  unlockHeight: 400,
  /** Permanent income bonus per rebirth. */
  incomeBonus: 0.5,
};

export const ECONOMY = {
  startCarry: 3,
  startPads: 4,
  padStep: 4,
  maxPads: 40,
  // Retuned with `npm run sim` from the doc's 400 × 3, which let income outrun every cost.
  firstExpansion: 1000,
  expansionGrowth: 5,
  /** A pad's cash pile stops growing at this many seconds of its income. */
  padCapSeconds: 600,
  /** Selling a character pays this many seconds of its income. */
  sellSeconds: 60,
};

/**
 * Character levels: each adds `incomeBonus`; level 2 costs `firstCostSeconds` of base income, then ×`growth`.
 * A level also needs XP, earned by time on a pad: `xpFirstSeconds` for level 2, then ×`xpGrowth`.
 */
export const LEVELS = { max: 10, incomeBonus: 0.25, firstCostSeconds: 30, growth: 1.6, xpFirstSeconds: 60, xpGrowth: 1.5 };

/** Session gifts at these seconds of play; each pays this many seconds of income, at least `min`. */
export const GIFTS = { at: [300, 600, 1200, 2400], incomeSeconds: 120, min: 100 };
