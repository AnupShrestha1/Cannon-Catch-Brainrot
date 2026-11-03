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

export const ROSTER: string[][] = [
  ['Cannolini Cannonino', 'Bonk Bonk Bonk Spatulur', 'Tostino Tortorino', 'Bananito Paracadutino'],
  ['Splashalero Splashala', 'Grr Grr Patapum', 'Lampadino Lumachino', 'Spazzolino Struzzo'],
  ['Ginnasta Gelatina', 'Ventilatore Tartarughino', 'Ombrellone Orsetto'],
  ['Pizzarotto Pellicano', 'Ninja Macchiatino', 'Sveglia Elefantino'],
  ['Elicottero Ippopotamo', 'Frigorifero Fenicottero', 'Bombolone Balenottero'],
  ['Razzo Rinoceronte', 'Satellito Gattino'],
  ['Galassia Giraffona', 'Nonna Nebulosa'],
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

export function zoneIndexAt(y: number): number {
  let index = 0;
  for (let i = 0; i < ZONES.length; i++) if (y >= ZONES[i].from) index = i;
  return index;
}

export function rollRarity(y: number): number {
  const spawns = ZONES[zoneIndexAt(y)].spawns;
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
};

export const CRASH_DROP = { tangled: 0.3, noChute: 0.5 };
