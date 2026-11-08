// The town, as in the sketch: two columns of four plots facing each other across a central lane, with no
// fences between neighbours, and a shared hub at the lane's end. Looking down the lane toward the hub, the
// cannon, the merge cauldron and the upgrade shop are on the right, and the row of gacha machines is on the
// left. Everyone uses the same cannon, cauldron, shop and machines; a plot is only its owner's showcase.
// Plots stand a few metres back from the lane (a short path leads in) and well apart, and run away from it:
// two lines of pedestals perpendicular to the lane with an aisle between them, edged by a low kerb.
//
// World frame: the shared cannon sits at the origin and fires straight up (flights run in the plane z = 0,
// seen from +z), so flights and their cameras never move. The lane runs along +z from the hub. A plot is
// built in its own space: origin at the middle of its front edge, +z toward the lane, the showcase down -z.
// toPlot and fromPlot convert between a plot's space and the world.

/** The lane's centre line (x) and half its width. */
export const LANE_X = -14;
export const LANE_HALF = 4;
/** Where the hub ends and the lane and plots begin (z), and the hub's back edge. */
export const HUB_EDGE = 10;
export const HUB_BACK = -24;
/** Plot centres are this far apart along the lane; a plot is this deep, and half this wide along the lane. */
export const PLOT_PITCH = 24;
export const PLOT_DEPTH = 25;
export const PLOT_HALF = 6.5;
/** The gap between the lane's edge and a plot's front, crossed by a short path. */
export const SETBACK = 4;
export const PLOTS_PER_SIDE = 4;
/** Along the lane, the first plot's centre. */
const FIRST_PLOT_Z = HUB_EDGE + 8;
/** Where the lane ends, and the fountain that closes it. */
export const LANE_END = FIRST_PLOT_Z + PLOT_PITCH * (PLOTS_PER_SIDE - 1) + PLOT_HALF + 6;
export const FOUNTAIN = { x: LANE_X, z: LANE_END + 6, r: 4.4 };

export interface PlotSlot {
  index: number;
  /** World position of the middle of the plot's front edge, and the plot's turn about y (+z faces the lane). */
  x: number;
  z: number;
  rot: number;
}

/**
 * Eight slots: 0-3 up the left of the lane (looking toward the hub, the gacha side), 4-7 up the right (the
 * cannon side), nearest the hub first.
 */
export const SLOTS: PlotSlot[] = [];
for (let k = 0; k < PLOTS_PER_SIDE; k++) {
  SLOTS.push({ index: k, x: LANE_X - LANE_HALF - SETBACK, z: FIRST_PLOT_Z + PLOT_PITCH * k, rot: Math.PI / 2 });
}
for (let k = 0; k < PLOTS_PER_SIDE; k++) {
  SLOTS.push({ index: PLOTS_PER_SIDE + k, x: LANE_X + LANE_HALF + SETBACK, z: FIRST_PLOT_Z + PLOT_PITCH * k, rot: -Math.PI / 2 });
}

/** The slot this client owns. A server will assign this; until then it's the first plot on the cannon side. */
export const OWN_SLOT = PLOTS_PER_SIDE;

// ---------------------------------------------------------------- the hub

/** The cannon stands at the origin; this is where players step up to it. */
export const CANNON_FOOT = { x: 0, z: 2.6 };
/** The merge cauldron, and the platform in front of it where players stand to use it. */
export const CAULDRON = { x: 11, z: -8, r: 1.8 };
export const CAULDRON_FRONT = { x: 8.2, z: -5.6 };
/** The upgrade shop's stall (centre, half width and half depth; it faces -x) and the mat in front of its counter. */
export const SHOP = { x: 14, z: 6, halfW: 3.2, halfD: 2.2 };
export const SHOP_FRONT = { x: 9.6, z: 6 };
/** The rebirth station, behind the cannon on the gacha side, and the pad in front of it (toward +z). */
export const REBIRTH_AT = { x: -9, z: -13, r: 2.6 };
export const REBIRTH_FRONT = { x: -9, z: -8.9 };
/** The gacha machines stand in a row along the left of the hub, facing the lane's mouth (+x). */
export const MACHINE_X = LANE_X - 13;
export const MACHINE_STEP = 6.5;
/** Radius of each pull pad in front of a machine. */
export const PAD_RADIUS = 1.05;
/** The two leaderboards, at the back of the hub behind the cannon. */
export const BOARDS: [number, number][] = [
  [-6, HUB_BACK + 4],
  [6, HUB_BACK + 4],
];

/** Machine i (0 = Basic, nearest the lane): where it stands. */
export function machineAt(i: number): { x: number; z: number } {
  return { x: MACHINE_X, z: HUB_EDGE - 5 - i * MACHINE_STEP };
}

/** The two pull pads in front of machine i: ×1 nearer the lane, ×10 further along. */
export function pullPad(i: number, ten: boolean): { x: number; z: number } {
  const m = machineAt(i);
  return { x: m.x + 3.6, z: m.z + (ten ? -1.35 : 1.35) };
}

// ---------------------------------------------------------------- the town's extent

/** The world area the town covers (hub, plots, lane and fountain), for keeping scenery out. */
export const TOWN = {
  minX: Math.min(MACHINE_X - 6, LANE_X - LANE_HALF - SETBACK - PLOT_DEPTH - 3),
  maxX: Math.max(SHOP.x + SHOP.halfD + 6, LANE_X + LANE_HALF + SETBACK + PLOT_DEPTH + 3),
  minZ: HUB_BACK - 2,
  maxZ: FOUNTAIN.z + 12,
};

/** Where anyone can walk. There are no fences: only things that stand on the ground are solid. */
export const WALK = {
  minX: TOWN.minX + 1,
  maxX: TOWN.maxX - 1,
  minZ: TOWN.minZ + 1,
  maxZ: TOWN.maxZ - 1,
};

/** World → plot space for a slot. */
export function toPlot(slot: PlotSlot, x: number, z: number): [number, number] {
  const dx = x - slot.x;
  const dz = z - slot.z;
  const c = Math.cos(slot.rot);
  const s = Math.sin(slot.rot);
  return [dx * c - dz * s, dx * s + dz * c];
}

/** Plot space → world for a slot. */
export function fromPlot(slot: PlotSlot, lx: number, lz: number): [number, number] {
  const c = Math.cos(slot.rot);
  const s = Math.sin(slot.rot);
  return [slot.x + lx * c + lz * s, slot.z - lx * s + lz * c];
}

/** The slot whose showcase contains a world point, or null in the lane and the hub. */
export function plotAt(x: number, z: number): PlotSlot | null {
  for (const slot of SLOTS) {
    const [lx, lz] = toPlot(slot, x, z);
    if (Math.abs(lx) < PLOT_HALF && lz < 0.3 && lz > -PLOT_DEPTH) return slot;
  }
  return null;
}

/** A point in the lane just in front of a plot's path. */
export function laneFront(slot: PlotSlot): [number, number] {
  return fromPlot(slot, 0, SETBACK + 1.5);
}

/** The plot's entrance, where its path from the lane meets its kerb. */
export function plotEntrance(slot: PlotSlot): [number, number] {
  return fromPlot(slot, 0, 0.6);
}

/** Keeps a step inside the town; everything solid is handled by bumpSolids. */
export function walkStep(x: number, z: number): [number, number] {
  return [Math.min(WALK.maxX, Math.max(WALK.minX, x)), Math.min(WALK.maxZ, Math.max(WALK.minZ, z))];
}
