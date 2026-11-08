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

/** Pulls at this rarity and above get a bigger reveal. */
export const RARE = 2;

// Basic Launch roster: 10 of the design doc's 21 characters, up to Legendary. It skips the three
// names the doc flags as too close to their originals.
export const ROSTER: string[][] = [
  ['Cannolini Cannonino', 'Tostino Tortorino'],
  ['Lampadino Lumachino', 'Spazzolino Struzzo'],
  ['Ginnasta Gelatina', 'Ventilatore Tartarughino'],
  ['Pizzarotto Pellicano', 'Ninja Macchiatino'],
  ['Elicottero Ippopotamo', 'Frigorifero Fenicottero'],
  // Mythic: from the Ultra pull, or by merging three Legendaries.
  ['Razzo Rinoceronte', 'Satellito Gattino'],
  [],
];

export interface Zone {
  name: string;
  from: number;
  sky: number;
  /** Gems each pickup in this zone is worth, and its colour. */
  gems: number;
  gemColor: number;
  hazard: number;
}

export const ZONES: Zone[] = [
  { name: 'Low Sky', from: 0, sky: 0x8fd3ff, gems: 1, gemColor: 0x3fc8ff, hazard: 0x3b3b46 },
  { name: 'Cloud Kingdom', from: 150, sky: 0xffc98a, gems: 3, gemColor: 0xff5fb4, hazard: 0x8a4b2a },
  { name: 'Storm Layer', from: 400, sky: 0x5b3f8f, gems: 8, gemColor: 0xb57bff, hazard: 0x1e1e2c },
  { name: 'Edge of Space', from: 800, sky: 0x16224d, gems: 20, gemColor: 0x7dffd8, hazard: 0xb8c0cc },
  { name: 'Cosmic', from: 1500, sky: 0x2a0d45, gems: 50, gemColor: 0xffffff, hazard: 0xff7a3d },
];

/** Basic Launch has Low Sky, Cloud Kingdom and Storm Layer. */
export const MAX_ZONE = 2;

export function zoneIndexAt(y: number): number {
  let index = 0;
  for (let i = 0; i < ZONES.length; i++) if (y >= ZONES[i].from) index = i;
  return index;
}

/** Gems in the sky: each pickup pays its zone's `gems`, and now and then a big one pays `bigMultiplier` times that. */
export const GEMS = {
  bigChance: 0.1,
  bigMultiplier: 5,
  /** Share of the run's gems a hazard hit knocks loose. */
  hitLoss: 0.15,
  /** Flight 1 is a straight line of this many gems, enough for the first pull. */
  tutorialLine: 12,
};

export interface GachaTier {
  id: 'basic' | 'lucky' | 'super' | 'ultra' | 'cosmic';
  name: string;
  /** The machine's sign, and its theme colour (sign border, pads). */
  short: string;
  color: string;
  cost: number;
  /** [rarity, chance] pairs that sum to 1. */
  odds: [number, number][];
  /** The best height a run must have reached to unlock this tier. */
  unlockBest: number;
  /**
   * Hidden pity: [rarity, every] pairs. Every `every`-th pull without that rarity or better is guaranteed
   * at least that rarity. The player never sees these counters.
   */
  pity: [number, number][];
}

/** The gacha machines in the hub, cheapest first: each tier is its own machine, unlocked by flight height. */
export const GACHA: GachaTier[] = [
  {
    id: 'basic',
    name: 'Basic pull',
    short: 'BASIC',
    color: '#ff5f7e',
    cost: 10,
    odds: [[0, 0.62], [1, 0.28], [2, 0.08], [3, 0.018], [4, 0.002]],
    unlockBest: 0,
    pity: [[1, 15], [2, 30], [3, 60], [4, 90]],
  },
  {
    id: 'lucky',
    name: 'Lucky pull',
    short: 'LUCKY',
    color: '#3ccf8e',
    cost: 30,
    // Uncommon or better: the first step up, a couple of flights after the first pull. Worth a little more per
    // gem than Basic and a little less than Super (`npm run sim`).
    odds: [[1, 0.55], [2, 0.33], [3, 0.1], [4, 0.02]],
    unlockBest: 125,
    pity: [[2, 4], [3, 15], [4, 60]],
  },
  {
    id: 'super',
    name: 'Super pull',
    short: 'SUPER',
    color: '#3f8cff',
    cost: 100,
    // Always Rare or better, and worth more per gem than ten Basic pulls on every count: about 1.4× the
    // Legendaries, 1.5× the Epics and 1.2× the merge value (`npm run sim` prints the comparison). Without
    // that, Basic's generous pity (a Legendary every 90 pulls, 900 gems) would make Super the worse buy.
    odds: [[2, 0.5], [3, 0.38], [4, 0.12]],
    unlockBest: 150,
    // An Epic or better at least every 4 Super pulls, and a Legendary at least every 10.
    pity: [[3, 4], [4, 10]],
  },
  {
    id: 'ultra',
    name: 'Ultra pull',
    short: 'ULTRA',
    color: '#b45cff',
    cost: 400,
    // Epic or better, mostly Legendary, and a slim chance at a Mythic. Worth more per gem than Super pulls
    // (`npm run sim` prints the comparison). Unlocks once a flight reaches the Storm Layer.
    odds: [[3, 0.22], [4, 0.73], [5, 0.05]],
    unlockBest: 400,
    // A Legendary or better at least every 3 Ultra pulls; a Mythic is guaranteed only after 60 without one.
    pity: [[4, 3], [5, 60]],
  },
  {
    id: 'cosmic',
    name: 'Cosmic pull',
    short: 'COSMIC',
    color: '#ffc21a',
    cost: 600,
    // Always Legendary or better, with the best odds of a Mythic: the late-game machine, for flights high in
    // the Storm Layer. Mythics stay very rare even here.
    odds: [[4, 0.88], [5, 0.12]],
    unlockBest: 550,
    // A Mythic at least every 25 Cosmic pulls.
    pity: [[5, 25]],
  },
];

/**
 * The scripted start: within the first 10 pulls a player is guaranteed at least two Uncommons and one Rare,
 * by pull number. The 1st is their first brainrot, the 3rd lands as a glowing Rare at about 100 s, and the
 * 5th comes from the 2-minute gift. The other pulls roll the normal odds (and can come out better); from
 * the 11th pull on it's the normal odds and pity only.
 */
export const STARTER_PULLS: Record<number, number> = { 1: 1, 3: 2, 5: 1 };
export const STARTER_PULL_COUNT = 10;

/** Merging: this many of a rarity make one random character of the next rarity up. A Mythic takes 8 Legendaries. */
export const MERGE: Record<number, number> = { 0: 10, 1: 8, 2: 6, 3: 4, 4: 8 };

export function rollTier(tier: GachaTier): number {
  let roll = Math.random();
  for (const [rarity, chance] of tier.odds) {
    roll -= chance;
    if (roll < 0) return rarity;
  }
  return tier.odds[tier.odds.length - 1][0];
}

// Normal-launch apex per cannon level, log-linear between these anchors, so each zone's level
// in the design doc is the first level whose normal launch reaches it.
// The first few levels climb fast, so a good launch reaches Cloud Kingdom within the first few minutes.
const HEIGHT_ANCHORS: [number, number][] = [[1, 90], [6, 155], [28, 410], [45, 820], [60, 1550]];

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
  /** Seconds of ascent between gem rows, and the smallest height gap between them. */
  pickupStep: 0.45,
  pickupMinGap: 4,
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

/**
 * Hazard density: the first one at `start` metres, then one every `gapLow` metres near the ground, closing to
 * `gapHigh` by 1,500 m (±20% jitter), and never more than `maxPerFlight`. Playtests found the first pass
 * (from 24 m, every 24 → 12 m, no cap) far too crowded.
 */
export const HAZARD_SPACING = { start: 40, gapLow: 55, gapHigh: 35, maxPerFlight: 8 };

export const TUTORIAL = {
  hazardFromFlight: 3,
  noDropFlights: 3,
  wideChuteFlights: 2,
  /** From this flight, the apex shows the next locked zone and the cannon level it needs. */
  goalFromFlight: 2,
};

/** Share of the run's gems lost in a crash. */
export const CRASH_DROP = { tangled: 0.3, noChute: 0.5 };

export type Track = 'cannon' | 'finder' | 'magnet' | 'steering' | 'chute';

export const TRACKS: Track[] = ['cannon', 'finder', 'magnet', 'steering', 'chute'];

/**
 * Cost of the k-th purchase is base × growth^(k−1). `max` counts purchases; `effect` is the gain per
 * purchase for the three percentage tracks.
 */
export const UPGRADES: Record<Track, { name: string; base: number; growth: number; max: number; effect: number }> = {
  // Basic Launch stops at cannon level 37, whose perfect launch stays inside the Storm Layer. The doc goes to 60.
  // Tuned with `npm run sim` (the doc's 50 × 1.18 let rebirth unlock after 8 minutes): about 60 minutes now.
  cannon: { name: 'Cannon power', base: 25, growth: 1.52, max: 36, effect: 0 },
  finder: { name: 'Gem finder', base: 150, growth: 1.45, max: 20, effect: 0.1 },
  magnet: { name: 'Gem magnet', base: 120, growth: 1.25, max: 25, effect: 0.1 },
  steering: { name: 'Steering', base: 100, growth: 1.22, max: 25, effect: 0.06 },
  chute: { name: 'Parachute', base: 150, growth: 1.28, max: 20, effect: 0.05 },
};

export const REBIRTH = {
  /** Rebirth unlocks at the cannon level whose normal launch reaches the Storm Layer. */
  cannonLevel: 28,
  /** A run this high counts as reaching the Storm Layer. */
  unlockHeight: 400,
  /** Permanent income bonus per rebirth. */
  incomeBonus: 0.5,
};

export const ECONOMY = {
  /** The showcase: two rows of 5 slots along the lane, 4 open at the start, 2 more per expansion. */
  startPads: 4,
  padStep: 2,
  maxPads: 10,
  // Retuned with `npm run sim` from the doc's 400 × 3, which let income outrun every cost.
  firstExpansion: 600,
  expansionGrowth: 6,
  /** A pad's cash pile stops growing at this many seconds of its income. */
  padCapSeconds: 600,
  /** Selling a character pays this many seconds of its income. */
  sellSeconds: 60,
};

/**
 * Character levels: each adds `incomeBonus`; level 2 costs `firstCostSeconds` of base income, then ×`growth`.
 * A level also needs XP, earned by time on a pad: `xpFirstSeconds` for level 2, then ×`xpGrowth`.
 */
export const LEVELS = { max: 10, incomeBonus: 0.25, firstCostSeconds: 30, growth: 1.6, xpFirstSeconds: 30, xpGrowth: 1.6 };

export interface Gift {
  /** Seconds of play in this session before it can be claimed. */
  at: number;
  /** Gems it gives. */
  gems: number;
  /** Seconds of current income it pays in coins (0 for none), at least GIFT_COINS.min when it pays coins. */
  incomeSeconds: number;
}

/** Session gifts, in order. */
export const GIFTS: Gift[] = [
  // At 2 minutes: two more pulls, to keep a new player going.
  { at: 120, gems: 20, incomeSeconds: 0 },
  { at: 300, gems: 30, incomeSeconds: 60 },
  { at: 600, gems: 50, incomeSeconds: 120 },
  { at: 1200, gems: 100, incomeSeconds: 120 },
  { at: 2400, gems: 200, incomeSeconds: 240 },
];
export const GIFT_COINS = { min: 100 };
