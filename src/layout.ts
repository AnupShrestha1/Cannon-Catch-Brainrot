// The town: plots for up to six players in two rows of three, facing each other across a shared street.
//
// Every plot is the same base (fence and gate, plaza, cannon, gacha machine, merge station, showcase), built
// in plot space: cannon at the origin, gate at +z (FENCE.front), showcase down -z. This client always puts its
// own plot at the world origin, so all of its gameplay, cameras and flights stay in plot space. The other
// five plots belong to other players: today bots from the fake server (net.ts); with real multiplayer, the
// server assigns each player a slot and every client renders the town turned so its own slot sits at the
// origin (toPlot and fromPlot convert between a plot's space and the world).

/** The fence around one plot, in plot space; the gate is a gap in the front fence. */
export const FENCE = { x: 17, front: 17, back: -38, gate: 4 };

/** Plots sit this far apart along a row (fence width 34 plus a 6 m gap for the leaderboard boards). */
export const PLOT_SPACING = 40;

/** The street between the two rows, as world z from the near row's gate to the far row's gate. */
export const STREET = { near: FENCE.front, far: FENCE.front + 20, halfLength: PLOT_SPACING * 1.5 + 2 };
export const STREET_MID = (STREET.near + STREET.far) / 2;
/** The fountain at the street's centre, and how close the player can get to it. */
export const FOUNTAIN = { x: 0, z: STREET_MID, r: 4.3 };

export interface PlotSlot {
  index: number;
  /** World position of the plot's cannon, and the plot's turn about y (0 faces the street at +z). */
  x: number;
  z: number;
  rot: number;
}

/**
 * Six slots: the near row (0-2) faces +z, the far row (3-5) faces back across the street. In this client's
 * frame its own slot is OWN_SLOT, at the origin.
 */
export const SLOTS: PlotSlot[] = [
  { index: 0, x: -PLOT_SPACING, z: 0, rot: 0 },
  { index: 1, x: 0, z: 0, rot: 0 },
  { index: 2, x: PLOT_SPACING, z: 0, rot: 0 },
  { index: 3, x: -PLOT_SPACING, z: STREET.far + FENCE.front, rot: Math.PI },
  { index: 4, x: 0, z: STREET.far + FENCE.front, rot: Math.PI },
  { index: 5, x: PLOT_SPACING, z: STREET.far + FENCE.front, rot: Math.PI },
];

/** The slot this client owns. A server will assign this; until then it's the middle of the near row. */
export const OWN_SLOT = 1;

/** The world area the town covers (all six plots and the street), for keeping scenery out. */
export const TOWN = {
  minX: -PLOT_SPACING - FENCE.x,
  maxX: PLOT_SPACING + FENCE.x,
  minZ: FENCE.back,
  maxZ: STREET.far + FENCE.front - FENCE.back,
};

/** Where anyone can walk: the whole town. Fences only open at the gates. */
export const WALK = {
  minX: -STREET.halfLength,
  maxX: STREET.halfLength,
  minZ: TOWN.minZ + 1,
  maxZ: TOWN.maxZ - 1,
};

/** World → plot space for a slot (cannon at the origin, gate at +z). */
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

/** The slot whose fenced plot contains a world point, or null in the street and the gaps between plots. */
export function plotAt(x: number, z: number): PlotSlot | null {
  for (const slot of SLOTS) {
    const [lx, lz] = toPlot(slot, x, z);
    if (Math.abs(lx) < FENCE.x && lz < FENCE.front && lz > FENCE.back) return slot;
  }
  return null;
}

/** A plot's gate, just inside (in = true) or just outside it, in world space. */
export function gatePoint(slot: PlotSlot, inside: boolean): [number, number] {
  return fromPlot(slot, 0, FENCE.front + (inside ? -1.2 : 2));
}

/**
 * Keeps a step inside the town and stops it crossing any plot's fence except through its gate, from the
 * street. Each plot's fence is checked in that plot's own space, so the far row (turned to face back across
 * the street) works the same as the near one.
 */
export function fenceStep(fromX: number, fromZ: number, x: number, z: number): [number, number] {
  x = Math.min(WALK.maxX, Math.max(WALK.minX, x));
  z = Math.min(WALK.maxZ, Math.max(WALK.minZ, z));
  const margin = 0.6;
  for (const slot of SLOTS) {
    const [fx, fz] = toPlot(slot, fromX, fromZ);
    let [lx, lz] = toPlot(slot, x, z);
    const wasInside = Math.abs(fx) < FENCE.x && fz < FENCE.front && fz > FENCE.back;
    const near = Math.abs(lx) < FENCE.x + margin && lz < FENCE.front + margin && lz > FENCE.back - margin;
    if (!wasInside && !near) continue;
    if (wasInside) {
      // Inside a plot: the side and back fences hold, and the front one does except at the gate.
      lx = Math.min(FENCE.x - margin, Math.max(-FENCE.x + margin, lx));
      lz = Math.max(FENCE.back + margin, lz);
      if (lz > FENCE.front - margin && Math.abs(lx) > FENCE.gate - margin) lz = FENCE.front - margin;
    } else {
      // Outside: a plot can only be entered through its gate, from the street.
      const throughGate = Math.abs(lx) < FENCE.gate - margin && Math.abs(fx) < FENCE.gate && fz > lz - 1;
      if (!throughGate) {
        if (fz >= FENCE.front + margin) lz = FENCE.front + margin;
        else if (fz <= FENCE.back - margin) lz = FENCE.back - margin;
        else lx = fx < 0 ? Math.min(lx, -FENCE.x - margin) : Math.max(lx, FENCE.x + margin);
      }
    }
    [x, z] = fromPlot(slot, lx, lz);
  }
  // The fountain in the middle of the street is solid.
  const dx = x - FOUNTAIN.x;
  const dz = z - FOUNTAIN.z;
  const d = Math.hypot(dx, dz);
  if (d < FOUNTAIN.r) {
    const k = d > 0.001 ? FOUNTAIN.r / d : 1;
    return [FOUNTAIN.x + (d > 0.001 ? dx : FOUNTAIN.r) * k, FOUNTAIN.z + dz * k];
  }
  return [x, z];
}
