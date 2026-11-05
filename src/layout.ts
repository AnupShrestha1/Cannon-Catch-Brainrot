// The town: plots for up to six players in two rows of three, facing each other across a shared street.
//
// Every plot is the same base (fence and gate, plaza, cannon, gacha machine, merge station, showcase), built
// in plot space: cannon at the origin, gate at +z (FENCE.front), showcase down -z. This client always puts its
// own plot at the world origin, so all of its gameplay, cameras and flights stay in plot space. Today the
// other five plots are vacant; when multiplayer arrives, the server assigns each player a slot and every
// client renders the town turned so its own slot sits at the origin (see slotTransform).

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

/** Where the player can walk: their own plot plus the street (the fence only opens at the gate). */
export const WALK = {
  minX: -STREET.halfLength,
  maxX: STREET.halfLength,
  minZ: FENCE.back + 1,
  maxZ: STREET.far - 1,
};

/**
 * Keeps a step inside the walkable area (the near row of plots and the street) and stops it crossing a plot's
 * fence anywhere but its gate. The far row is across the street, past the walkable edge.
 */
export function fenceStep(fromX: number, fromZ: number, x: number, z: number): [number, number] {
  x = Math.min(WALK.maxX, Math.max(WALK.minX, x));
  z = Math.min(WALK.maxZ, Math.max(WALK.minZ, z));
  // Work relative to the near-row plot the step started by.
  const cx = Math.max(-PLOT_SPACING, Math.min(PLOT_SPACING, Math.round(fromX / PLOT_SPACING) * PLOT_SPACING));
  const fx = fromX - cx;
  let lx = x - cx;
  const margin = 0.6;
  const wasInside = Math.abs(fx) < FENCE.x && fromZ < FENCE.front;
  if (wasInside) {
    // Inside a plot: the side and back fences hold, and the front one does except at the gate.
    lx = Math.min(FENCE.x - margin, Math.max(-FENCE.x + margin, lx));
    if (z > FENCE.front - margin && Math.abs(lx) > FENCE.gate - margin) z = FENCE.front - margin;
  } else if (z < FENCE.front + margin && Math.abs(lx) < FENCE.x + margin) {
    // Outside: a plot can only be entered through its gate, from the street.
    const throughGate = Math.abs(lx) < FENCE.gate - margin && Math.abs(fx) < FENCE.gate && fromZ > z - 1;
    if (!throughGate) {
      if (fromZ >= FENCE.front + margin) z = FENCE.front + margin;
      else lx = fx < 0 ? Math.min(lx, -FENCE.x - margin) : Math.max(lx, FENCE.x + margin);
    }
  }
  // The fountain in the middle of the street is solid.
  x = cx + lx;
  const fx2 = x - FOUNTAIN.x;
  const fz2 = z - FOUNTAIN.z;
  const d = Math.hypot(fx2, fz2);
  if (d < FOUNTAIN.r) {
    const k = d > 0.001 ? FOUNTAIN.r / d : 1;
    return [FOUNTAIN.x + (d > 0.001 ? fx2 : FOUNTAIN.r) * k, FOUNTAIN.z + fz2 * k];
  }
  return [x, z];
}
