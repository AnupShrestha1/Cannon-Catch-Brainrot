// A player's plot: a showcase set back from the lane, running away from it: two lines of 5 pedestals with an aisle
// between them, on a tiled floor edged by a low kerb in the owner's colour, a short path in from the lane, and
// the owner's name board at the back. Pedestals show their brainrot, a rarity glow, and a big coin spinning over its head with the
// coins waiting there; locked ones are roped off until the base is expanded. It only draws the save; Game owns
// the rules (and the level-up buttons, which are HTML). The cannon, cauldron, shop and gacha machines are
// shared, in the hub (hub.ts); this file also says what is solid and how high the floor is, town-wide.
import * as THREE from 'three';
import { ECONOMY, GACHA, RARITIES } from './config';
import { makeCharacter, type CharacterRig } from './characters';
import { floorsOf, formatCoins } from './economy';
import {
  BOARDS,
  CAULDRON,
  CAULDRON_FRONT,
  FOUNTAIN,
  PAD_RADIUS,
  PLOT_DEPTH,
  PLOT_HALF,
  REBIRTH_AT,
  REBIRTH_FRONT,
  SETBACK,
  SHOP,
  SHOP_FRONT,
  SLOTS,
  fromPlot,
  machineAt,
  plotAt,
  pullPad,
  toPlot,
  type PlotSlot,
} from './layout';
import type { PadSlot, Save } from './store';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { tileTexture } from './tiles';
import { flat, makeLabel, softTexture, type Label } from './world';

interface PadView {
  top: THREE.Mesh;
  topMat: THREE.MeshLambertMaterial;
  rimMat: THREE.MeshLambertMaterial;
  glow: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
  /** A ring of light that pulses over an open, empty slot. */
  beacon: THREE.Mesh;
  /** Rope and sign over a locked slot. */
  lock: THREE.Group;
  rig: CharacterRig | null;
  /** What the view currently shows: a name, '' for empty, or '#locked'. */
  key: string;
  /** The big coin over the brainrot's head, shown while coins are waiting. */
  coin: THREE.Group;
  label: Label;
  shown: number;
  /** 1 right after the pile grows, easing to 0: the label pops on each income tick. */
  pop: number;
  /** 1 right after a character arrives, easing to 0: it lands with a squash. */
  arrive: number;
  seed: number;
}

/** The two lines of pedestals either side of the aisle, the first pedestal's depth, and the spacing down a line. */
const LINE_X = 2.7;
const FIRST_DEPTH = 3.6;
const PAD_STEP = 4.2;
/** Height between floors. */
export const FLOOR_H = 5.6;
/**
 * Stairs up the outside of the plot, one flight per floor above the ground, alternating sides (+x first).
 * Each flight runs back from the lane: a bottom landing (z0 to z0 + landing), the steps (z0 to z1), and a top
 * landing (z1 - landing to z1); `inner` to `outer` is its width, just outside the plot's edge. The landings
 * meet gaps in the deck railings.
 */
export const STAIR = { inner: PLOT_HALF + 0.25, outer: PLOT_HALF + 2.45, z0: -2.4, z1: -13.6, landing: 2.2 };

/** Which side flight k runs up: +1 (the +x side) or -1. */
export function stairSide(k: number): number {
  return k % 2 === 0 ? 1 : -1;
}

/** Floor height on flight k at depth lz (flat on the landings). */
export function stairHeight(k: number, lz: number): number {
  const t = Math.min(1, Math.max(0, (STAIR.z0 - lz) / (STAIR.z0 - STAIR.z1)));
  return (k + t) * FLOOR_H;
}
/** Where the name board's posts stand, in plot space. */
const BOARD_Z = -PLOT_DEPTH + 0.9;
const BOARD_POST_X = 3.9;
/** The gap in the front kerb, where the path comes in. */
const ENTRANCE = 3.4;
/** Radius of the cauldron's step-on platform. */
export const PLATFORM_RADIUS = 1.25;
/** Height of the coin over a brainrot's head. */
const COIN_Y = 3.3;

const PAD_TOP = 0.5;
const pedestalGeo = new THREE.CylinderGeometry(1.45, 1.65, 0.42, 32).translate(0, 0.21, 0);
const topGeo = new THREE.CylinderGeometry(1.22, 1.22, 0.1, 32).translate(0, 0.45, 0);
const rimGeo = new THREE.TorusGeometry(1.26, 0.08, 8, 40).rotateX(Math.PI / 2).translate(0, 0.48, 0);
const glowGeo = new THREE.PlaneGeometry(4.6, 4.6);
const beaconGeo = new THREE.TorusGeometry(0.9, 0.06, 6, 40).rotateX(Math.PI / 2);
const coinGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.16, 28).rotateX(Math.PI / 2);
const coinFaceGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.2, 28).rotateX(Math.PI / 2);
const coinRimGeo = new THREE.TorusGeometry(0.62, 0.06, 6, 28);
const coinMat = flat(0xffc21a, { emissive: 0x8a5f00 });
const coinFaceMat = flat(0xffe066, { emissive: 0x8a6a00 });
const coinRimMat = flat(0xe0a000, { emissive: 0x5a3c00 });
const stoneMat = new THREE.MeshPhongMaterial({ color: 0xf1ebe0, shininess: 25 });
const lockedTop = 0x6f7783;
const emptyTop = 0xdfeaf6;
const GOLD = 0xffc84a;

/** Other players' plots share one label for their (never shown) coin counters, so they don't each draw canvases. */
let vacantLabel: Label | null = null;
/** Every LOCKED sign shares one texture. */
let lockedSign: THREE.SpriteMaterial | null = null;

export interface BaseOptions {
  /** An unclaimed plot: empty pedestals, no coins, no LOCKED signs. */
  vacant?: boolean;
  /** Another player's plot: their brainrots on display, their name on the board, no coin counters. */
  owner?: string;
}

/** Solid things, for walking: circles [x, z, r] and wall segments [x0, z0, x1, z1]. */
export interface Solids {
  circles: [number, number, number][];
  walls: [number, number, number, number][];
}

let plotSolidsCache: Solids | null = null;
let hubSolidsCache: Solids | null = null;

/** Every pedestal and the name board's posts, in plot space. */
export function plotSolids(): Solids {
  if (plotSolidsCache) return plotSolidsCache;
  const circles: [number, number, number][] = [];
  const at = new THREE.Vector3();
  for (let i = 0; i < ECONOMY.padsPerFloor; i++) {
    Base.padPosition(i, at);
    circles.push([at.x, at.z, 1.7]);
  }
  for (const side of [-1, 1]) circles.push([side * BOARD_POST_X, BOARD_Z, 0.3]);
  plotSolidsCache = { circles, walls: [] };
  return plotSolidsCache;
}

/** The shared things in the hub, in world space: cannon, cauldron, machines, the shop stall, boards, fountain. */
export function hubSolids(): Solids {
  if (hubSolidsCache) return hubSolidsCache;
  const circles: [number, number, number][] = [
    [0, 0, 1.9],
    [CAULDRON.x, CAULDRON.z, CAULDRON.r],
    [FOUNTAIN.x, FOUNTAIN.z, FOUNTAIN.r],
    [REBIRTH_AT.x, REBIRTH_AT.z, REBIRTH_AT.r],
  ];
  for (let i = 0; i < GACHA.length; i++) {
    const m = machineAt(i);
    circles.push([m.x, m.z, 2.1]);
  }
  for (const [x, z] of BOARDS) circles.push([x - 1.9, z, 0.3], [x + 1.9, z, 0.3]);
  // The stall is a closed box: its keeper stands inside.
  const x0 = SHOP.x - SHOP.halfD;
  const x1 = SHOP.x + SHOP.halfD;
  const z0 = SHOP.z - SHOP.halfW;
  const z1 = SHOP.z + SHOP.halfW;
  const walls: [number, number, number, number][] = [
    [x0, z0, x0, z1],
    [x1, z0, x1, z1],
    [x0, z0, x1, z0],
    [x0, z1, x1, z1],
  ];
  hubSolidsCache = { circles, walls };
  return hubSolidsCache;
}

/** Pushes (x, z), a walker of radius r, out of a set of solids. */
function pushOut(x: number, z: number, r: number, { circles, walls }: Solids): [number, number] {
  for (const [sx, sz, sr] of circles) {
    const dx = x - sx;
    const dz = z - sz;
    const d = Math.hypot(dx, dz);
    const min = sr + r;
    if (d >= min) continue;
    if (d < 1e-4) {
      z = sz + min;
      continue;
    }
    x = sx + (dx / d) * min;
    z = sz + (dz / d) * min;
  }
  for (const [x0, z0, x1, z1] of walls) {
    const wx = x1 - x0;
    const wz = z1 - z0;
    const t = Math.min(1, Math.max(0, ((x - x0) * wx + (z - z0) * wz) / (wx * wx + wz * wz)));
    const nx = x - (x0 + wx * t);
    const nz = z - (z0 + wz * t);
    const d = Math.hypot(nx, nz);
    const min = 0.2 + r;
    if (d >= min || d < 1e-4) continue;
    x += (nx / d) * (min - d);
    z += (nz / d) * (min - d);
  }
  return [x, z];
}

/** A plot whose pedestals a point is on or just beside, so walkers bump them from the lane too. */
function plotNear(x: number, z: number): PlotSlot | null {
  for (const slot of SLOTS) {
    const [lx, lz] = toPlot(slot, x, z);
    if (Math.abs(lx) < PLOT_HALF + 1 && lz < SETBACK && lz > -PLOT_DEPTH - 1) return slot;
  }
  return null;
}

/** Pushes a world point (a walker of radius r) out of whatever is solid around it: the hub's things and pedestals. */
export function bumpSolids(x: number, z: number, r: number): [number, number] {
  [x, z] = pushOut(x, z, r, hubSolids());
  const slot = plotNear(x, z);
  if (!slot) return [x, z];
  const [lx, lz] = toPlot(slot, x, z);
  const [px, pz] = pushOut(lx, lz, r, plotSolids());
  return fromPlot(slot, px, pz);
}

/** Floor height under a world point: raised on the pull pads, the cauldron's platform, the shop mat and showcases. */
export function floorWorld(x: number, z: number): number {
  for (let i = 0; i < GACHA.length; i++) {
    for (const ten of [false, true]) {
      const p = pullPad(i, ten);
      if (Math.hypot(x - p.x, z - p.z) < PAD_RADIUS + 0.1) return 0.24;
    }
  }
  if (Math.hypot(x - CAULDRON_FRONT.x, z - CAULDRON_FRONT.z) < PLATFORM_RADIUS + 0.1) return 0.27;
  if (Math.hypot(x - REBIRTH_FRONT.x, z - REBIRTH_FRONT.z) < PLATFORM_RADIUS + 0.1) return 0.27;
  if (Math.abs(x - SHOP_FRONT.x) < 1.3 && Math.abs(z - SHOP_FRONT.z) < 1.7) return 0.1;
  if (plotAt(x, z)) return 0.11;
  return 0.06;
}

export class Base {
  private views: PadView[] = [];
  private group = new THREE.Group();
  /** An unclaimed plot: empty pedestals, no coins, no LOCKED signs. Nothing on it changes. */
  private vacant: boolean;
  /** Another player's plot: shows their brainrots but none of the owner-only UI (coin piles and counters). */
  private remote: boolean;
  private scene: THREE.Scene;
  private labelTimer = 0;
  /** One group per floor, raised FLOOR_H each, holding that floor's pedestals (and deck, above the ground). */
  private floorGroups: THREE.Group[] = [];
  /** Each deck's railing (rebuilt as floors are added, to open gaps where stairs arrive), and the flights built. */
  private rails: THREE.Group[] = [];
  private flights = 0;
  private own: boolean;
  private marker: { group: THREE.Group; star: THREE.Mesh } | null = null;

  /** Builds a plot's showcase at its slot; `vacant` leaves it unclaimed, `owner` makes it another player's. */
  constructor(scene: THREE.Scene, slot: PlotSlot, options: BaseOptions = {}) {
    this.scene = scene;
    this.vacant = !!options.vacant;
    this.remote = !this.vacant && !!options.owner;
    this.group.position.set(slot.x, 0, slot.z);
    this.group.rotation.y = slot.rot;
    scene.add(this.group);
    const own = !this.vacant && !options.owner;
    this.own = own;
    this.buildFloor(this.vacant ? 0xb9c0cc : own ? GOLD : 0x7fd8ff);
    if (this.vacant) this.buildSign('OPEN PLOT', '#c9ced6', 0x8a8f99);
    else if (options.owner) this.buildSign(`${options.owner.toUpperCase()}'S BASE`, '#9dfcff', 0x2f5fc4);
    else this.buildSign('YOUR BASE', '#ffd84a', 0xc8102e);
    this.ensureFloors(1);
    if (own) this.buildMarker();
  }

  /** Your base's marker: a gold star turning gently high over the name board, with a soft glow. */
  private buildMarker(): void {
    const g = new THREE.Group();
    g.position.set(0, 8.2, BOARD_Z);
    const shape = new THREE.Shape();
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + Math.PI / 2;
      const r = k % 2 ? 0.32 : 0.75;
      if (k) shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      else shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const star = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 3 }).center(),
      new THREE.MeshPhongMaterial({ color: GOLD, emissive: 0x7a5200, shininess: 110, specular: 0xffffff }),
    );
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: softTexture(), color: 0xffd36b, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    glow.scale.setScalar(3.2);
    g.add(glow, star);
    this.group.add(g);
    this.marker = { group: g, star };
  }

  /** How many floors the base shows. */
  get floors(): number {
    return this.floorGroups.length;
  }

  /**
   * Builds floors up to `n`: each one above the ground is a deck on pillars with a railing, and once there's
   * more than one floor every floor gets a lift pad at the back of the aisle.
   */
  private ensureFloors(n: number): void {
    while (this.floorGroups.length < n) {
      const k = this.floorGroups.length;
      const g = new THREE.Group();
      g.position.y = k * FLOOR_H;
      this.group.add(g);
      this.floorGroups.push(g);
      if (k > 0) this.buildDeck(g);
      for (let i = 0; i < ECONOMY.padsPerFloor; i++) this.addPad(k * ECONOMY.padsPerFloor + i);
    }
    // A flight of stairs up to each floor above the ground, and railings with gaps where they arrive.
    while (this.flights < this.floorGroups.length - 1) this.buildStairs(this.flights++);
    for (const r of this.rails) r.removeFromParent();
    this.rails = this.floorGroups.slice(1).map((g, i) => this.buildRail(g, i + 1));
  }

  /**
   * Flight k, from floor k up to floor k + 1, outside the plot's edge: chunky steps on two stringers, a handrail
   * on the outer side, landings at both ends, and posts under it.
   */
  private buildStairs(k: number): void {
    const g = new THREE.Group();
    const side = stairSide(k);
    const width = STAIR.outer - STAIR.inner;
    const cx = side * (STAIR.inner + width / 2);
    const stepMat = new THREE.MeshPhongMaterial({ color: this.own ? 0xffe2a0 : 0xf3ead8, shininess: 30 });
    const woodMat = new THREE.MeshPhongMaterial({ color: 0xb07a45, shininess: 25 });
    const railMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 80 });
    const run = STAIR.z0 - STAIR.z1;
    const steps = 20;
    const stepGeo = new RoundedBoxGeometry(width, 0.22, run / steps + 0.06, 2, 0.06);
    for (let i = 0; i < steps; i++) {
      const z = STAIR.z0 - ((i + 0.5) * run) / steps;
      const step = new THREE.Mesh(stepGeo, stepMat);
      step.position.set(cx, stairHeight(k, z) + (FLOOR_H / steps) * 0.5 - 0.11, z);
      step.castShadow = step.receiveShadow = true;
      g.add(step);
    }
    // Landings at both ends.
    for (const [z, y] of [
      [STAIR.z0 + STAIR.landing / 2, k * FLOOR_H],
      [STAIR.z1 - STAIR.landing / 2, (k + 1) * FLOOR_H],
    ]) {
      const landing = new THREE.Mesh(new RoundedBoxGeometry(width + 0.1, 0.3, STAIR.landing, 2, 0.08), stepMat);
      landing.position.set(cx, y - 0.15, z);
      landing.castShadow = landing.receiveShadow = true;
      g.add(landing);
    }
    // Stringers along both sides, sloping with the steps.
    const len = Math.hypot(run, FLOOR_H);
    const tilt = Math.atan2(FLOOR_H, run);
    for (const x of [side * STAIR.inner, side * STAIR.outer]) {
      const stringer = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.4, len, 2, 0.06), woodMat);
      stringer.position.set(x, (k + 0.5) * FLOOR_H - 0.2, (STAIR.z0 + STAIR.z1) / 2);
      stringer.rotation.x = tilt;
      g.add(stringer);
    }
    // A handrail on the outer side, on posts.
    const handrail = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.12, len, 2, 0.05), railMat);
    handrail.position.set(side * STAIR.outer, (k + 0.5) * FLOOR_H + 1.0, (STAIR.z0 + STAIR.z1) / 2);
    handrail.rotation.x = tilt;
    g.add(handrail);
    for (let i = 0; i <= 4; i++) {
      const z = STAIR.z0 - (i * run) / 4;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 8), railMat);
      post.position.set(side * STAIR.outer, stairHeight(k, z) + 0.5, z);
      g.add(post);
    }
    // Posts holding it up, down to the floor below.
    const postMat = new THREE.MeshPhongMaterial({ color: 0xf6efe2, shininess: 30 });
    for (const z of [STAIR.z0 - run * 0.5, STAIR.z1 - STAIR.landing / 2]) {
      const h = stairHeight(k, z) - k * FLOOR_H;
      if (h < 0.5) continue;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, h, 14), postMat);
      post.position.set(cx, k * FLOOR_H + h / 2 - 0.3, z);
      post.castShadow = true;
      g.add(post);
    }
    this.group.add(g);
  }

  /**
   * Deck k's railing: posts and a rounded top rail all round, with gaps where a flight of stairs arrives (the
   * top of flight k - 1) and where the next one leaves (the bottom of flight k, once there is one).
   */
  private buildRail(g: THREE.Group, k: number): THREE.Group {
    const rails = new THREE.Group();
    const w = PLOT_HALF * 2;
    const d = PLOT_DEPTH;
    const gaps: { side: number; z0: number; z1: number }[] = [{ side: stairSide(k - 1), z0: STAIR.z1 - STAIR.landing, z1: STAIR.z1 }];
    if (k < this.floorGroups.length - 1) gaps.push({ side: stairSide(k), z0: STAIR.z0, z1: STAIR.z0 + STAIR.landing });
    const railMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 80 });
    const rail = (x: number, z: number, sx: number, sz: number) => {
      if (sx <= 0.05 || sz <= 0.05) return;
      const mesh = new THREE.Mesh(new RoundedBoxGeometry(sx, 0.14, sz, 2, 0.06), railMat);
      mesh.position.set(x, 1.0, z);
      rails.add(mesh);
    };
    // Each long side, broken where a gap is (z runs 0 at the front to -d at the back).
    for (const side of [-1, 1]) {
      const cuts = gaps.filter((gap) => gap.side === side).sort((a, b) => b.z1 - a.z1);
      let from = 0;
      for (const gap of cuts) {
        rail((side * w) / 2, (from + gap.z1) / 2, 0.14, from - gap.z1);
        from = gap.z0;
      }
      rail((side * w) / 2, (from - d) / 2, 0.14, from + d);
    }
    rail(0, -d, w, 0.14);
    rail(0, 0, w, 0.14);
    const inGap = (x: number, z: number) => gaps.some((gap) => Math.sign(x) === gap.side && Math.abs(x) > w / 2 - 0.1 && z > gap.z0 - 0.1 && z < gap.z1 + 0.1);
    const spots: [number, number][] = [];
    for (let z = 0; z >= -d; z -= 1.6) for (const x of [-w / 2, w / 2]) if (!inGap(x, z)) spots.push([x, z]);
    for (let x = -w / 2 + 1.6; x < w / 2; x += 1.6) spots.push([x, 0], [x, -d]);
    const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 8), railMat, spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(([x, z], i) => posts.setMatrixAt(i, m.makeTranslation(x, 0.5, z)));
    rails.add(posts);
    g.add(rails);
    return rails;
  }

  /** A deck over the floor below: a tiled slab on pillars, edged by a railing. */
  private buildDeck(g: THREE.Group): void {
    const w = PLOT_HALF * 2;
    const d = PLOT_DEPTH;
    const slab = new THREE.Mesh(
      new RoundedBoxGeometry(w + 0.4, 0.34, d + 0.4, 2, 0.1),
      new THREE.MeshLambertMaterial({ map: tileTexture('#f4ecdc', w, d) }),
    );
    slab.position.set(0, -0.17, -d / 2);
    slab.castShadow = slab.receiveShadow = true;
    g.add(slab);
    const trim = new THREE.Mesh(
      new RoundedBoxGeometry(w + 0.6, 0.16, d + 0.6, 2, 0.06),
      new THREE.MeshPhongMaterial({ color: this.own ? GOLD : 0x7fd8ff, shininess: 60 }),
    );
    trim.position.set(0, -0.34, -d / 2);
    g.add(trim);
    const pillarMat = new THREE.MeshPhongMaterial({ color: 0xf6efe2, shininess: 30 });
    const pillarGeo = new THREE.CylinderGeometry(0.28, 0.34, FLOOR_H, 20);
    for (const x of [-w / 2 + 0.2, w / 2 - 0.2]) {
      for (const z of [-0.2, -d / 2, -d + 0.2]) {
        const pillar = new THREE.Mesh(pillarGeo, pillarMat);
        pillar.position.set(x, -FLOOR_H / 2, z);
        pillar.castShadow = true;
        g.add(pillar);
      }
    }
  }

  /** Shows or hides the brainrots on display: other players' plots hide theirs when the player is far away. */
  setDetail(on: boolean): void {
    for (const view of this.views) if (view.rig) view.rig.group.visible = on;
  }

  /** Takes the whole plot out of the scene (its owner left, or a new one arrived). */
  dispose(): void {
    this.scene.remove(this.group);
  }

  /**
   * Where slot i stands in plot space: on each floor, two lines of 5 running back from the lane either side of
   * the aisle, filled in pairs from the front (0 and 1 nearest the lane); slots 10-19 are the floor above, and
   * 20-29 the one above that.
   */
  static padPosition(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    const floor = Math.floor(i / ECONOMY.padsPerFloor);
    const j = i % ECONOMY.padsPerFloor;
    const side = j % 2 === 0 ? -1 : 1;
    return out.set(side * LINE_X, PAD_TOP + floor * FLOOR_H, -FIRST_DEPTH - Math.floor(j / 2) * PAD_STEP);
  }

  /** Which floor slot i is on. */
  static padFloor(i: number): number {
    return Math.floor(i / ECONOMY.padsPerFloor);
  }

  /** Slot i of a plot, in world space. */
  static padWorld(slot: PlotSlot, i: number, out = new THREE.Vector3()): THREE.Vector3 {
    Base.padPosition(i, out);
    const [x, z] = fromPlot(slot, out.x, out.z);
    return out.set(x, out.y, z);
  }

  /** Where slot i's level-up button sits in world space: under its brainrot, at the foot of the pedestal. */
  static buttonWorld(slot: PlotSlot, i: number, out = new THREE.Vector3()): THREE.Vector3 {
    return Base.padWorld(slot, i, out).setY(-0.15);
  }

  /** Matches floors, pedestals, characters and rarity colours to the save. Slots past save.pads are locked. */
  sync(save: Pick<Save, 'pads'> & { rebirths?: number }): void {
    if (this.vacant) return;
    this.ensureFloors(floorsOf({ rebirths: save.rebirths ?? 0 }));
    this.views.forEach((view, i) => {
      const locked = i >= save.pads.length;
      const slot = locked ? null : save.pads[i];
      const key = locked ? '#locked' : (slot?.name ?? '');
      if (key === view.key) return;
      if (view.rig) this.group.remove(view.rig.group);
      view.rig = null;
      view.key = key;
      view.shown = -1;
      this.paint(view, slot, locked);
      if (!slot) return;
      const rig = makeCharacter(slot.rarity, slot.name);
      // Only the player's own brainrots cast shadows; other players' are drawn as cheaply as possible.
      if (!this.remote) {
        rig.figure.traverse((o) => {
          if (o instanceof THREE.Mesh) o.castShadow = true;
        });
      }
      rig.cloud.visible = false;
      rig.halo.scale.multiplyScalar(0.8);
      rig.group.scale.setScalar(1.3);
      Base.padPosition(i, rig.group.position);
      // Facing the lane, turned a little toward the aisle, so they show to passers-by and to visitors.
      rig.group.rotation.y = (i % ECONOMY.padsPerFloor) % 2 === 0 ? 0.6 : -0.6;
      this.group.add(rig.group);
      view.rig = rig;
      view.arrive = 1;
    });
  }

  update(save: Pick<Save, 'pads'>, time: number, realDt: number): void {
    this.labelTimer -= realDt;
    const refreshLabels = this.labelTimer <= 0;
    if (refreshLabels) this.labelTimer = 0.2;
    if (this.marker) {
      // Up over the top floor, bobbing and turning slowly.
      this.marker.group.position.y = 8.2 + (this.floors - 1) * FLOOR_H + Math.sin(time * 1.4) * 0.25;
      this.marker.star.rotation.y = time * 0.9;
    }
    if (this.vacant) return;
    this.views.forEach((view, i) => {
      this.updatePad(view, i < save.pads.length ? save.pads[i] : null, time, realDt, refreshLabels);
    });
  }

  private updatePad(view: PadView, slot: PadSlot | null, time: number, realDt: number, refreshLabels: boolean): void {
    view.pop = Math.max(0, view.pop - realDt * 4);
    const pop = 1 + view.pop * 0.3;
    view.label.sprite.scale.set(6 * 0.7 * pop, 6 * (96 / 512) * 0.7 * pop, 1);
    // The coin turns slowly, bobs, and swells for a moment on each income tick.
    view.coin.rotation.y = time * 1.2 + view.seed;
    view.coin.position.y = COIN_Y + Math.sin(time * 1.8 + view.seed) * 0.12;
    view.coin.scale.setScalar(pop);
    view.beacon.visible = view.key === '';
    if (view.beacon.visible) {
      const p = (time * 0.8 + view.seed) % 1;
      view.beacon.position.y = PAD_TOP + 0.05 + p * 1.2;
      view.beacon.scale.setScalar(1 - p * 0.35);
      (view.beacon.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - p);
    }
    if (view.rig) {
      view.rig.animate(time + view.seed);
      // A gentle idle bounce with squash, and a bigger squash as it lands on the pedestal.
      const bounce = Math.abs(Math.sin(time * 2.2 + view.seed));
      view.arrive = Math.max(0, view.arrive - realDt * 2.5);
      const squash = 1 - (1 - bounce) * 0.05 - Math.sin(view.arrive * Math.PI) * 0.25;
      view.rig.figure.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
      view.rig.figure.position.y = bounce * 0.08 + view.arrive * 1.5;
      view.glowMat.opacity = 0.55 + Math.sin(time * 2.2 + view.seed) * 0.2;
    }
    if (!refreshLabels || this.remote) return;
    const cash = slot ? Math.floor(slot.cash) : 0;
    if (cash === view.shown) return;
    if (cash > view.shown && view.shown > 0) view.pop = 1;
    view.shown = cash;
    view.label.sprite.visible = cash > 0;
    view.coin.visible = cash > 0;
    if (cash > 0) view.label.set(`+${formatCoins(cash)}`, '#ffd84a');
  }

  /** An occupied pedestal takes its brainrot's rarity colour and glows; an open empty one pulses a ring of light. */
  private paint(view: PadView, slot: PadSlot | null, locked: boolean): void {
    view.lock.visible = locked;
    view.glow.visible = false;
    view.rimMat.color.setHex(locked ? 0x8a8f99 : GOLD);
    view.rimMat.emissive.setHex(locked ? 0x000000 : 0x5a3c00);
    if (!slot) {
      view.topMat.color.setHex(locked ? lockedTop : emptyTop);
      view.topMat.emissive.setHex(locked ? 0x000000 : 0x1a2a40);
      return;
    }
    const color = RARITIES[slot.rarity].color;
    view.topMat.color.setHex(color);
    view.topMat.emissive.setHex(color).multiplyScalar(0.35);
    view.glowMat.color.setHex(color);
    // Commons are gray, so their glow would just look like a shadow.
    view.glow.visible = slot.rarity > 0;
  }

  private addPad(i: number): void {
    const pos = Base.padPosition(i);
    const parent = this.floorGroups[Base.padFloor(i)];
    const pedestal = new THREE.Mesh(pedestalGeo, stoneMat);
    pedestal.position.set(pos.x, 0, pos.z);
    pedestal.castShadow = pedestal.receiveShadow = true;
    const topMat = flat(emptyTop);
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.set(pos.x, 0, pos.z);
    top.receiveShadow = true;
    const rimMat = flat(GOLD, { emissive: 0x5a3c00 });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.set(pos.x, 0, pos.z);
    const glowMat = new THREE.MeshBasicMaterial({
      map: softTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(pos.x, 0.14, pos.z);
    glow.visible = false;
    const beacon = new THREE.Mesh(
      beaconGeo,
      new THREE.MeshBasicMaterial({ color: 0x9dfcff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    beacon.position.set(pos.x, PAD_TOP, pos.z);
    const lock = this.vacant ? new THREE.Group() : this.makeLock(pos);
    const coin = new THREE.Group();
    const face = new THREE.Mesh(coinGeo, coinMat);
    face.castShadow = true;
    coin.add(face, new THREE.Mesh(coinFaceGeo, coinFaceMat), new THREE.Mesh(coinRimGeo, coinRimMat));
    coin.position.set(pos.x, COIN_Y, pos.z);
    coin.visible = false;
    const view = (label: Label, key: string, shown: number, seed: number): PadView => ({
      top,
      topMat,
      rimMat,
      glow,
      glowMat,
      beacon,
      lock,
      rig: null,
      key,
      coin,
      label,
      shown,
      pop: 0,
      arrive: 0,
      seed,
    });
    if (this.remote) {
      // Another player's slot: the pedestal, its glow and lock, but no coin pile or counter.
      vacantLabel ??= makeLabel();
      parent.add(glow, pedestal, top, rim, beacon, lock);
      this.views.push(view(vacantLabel, '?', 0, Math.random() * 10));
      return;
    }
    if (this.vacant) {
      beacon.visible = false;
      parent.add(pedestal, top, rim);
      vacantLabel ??= makeLabel();
      this.views.push(view(vacantLabel, '', 0, 0));
      return;
    }
    const label = makeLabel();
    label.sprite.position.set(pos.x, COIN_Y + 1.05, pos.z);
    label.sprite.scale.multiplyScalar(0.7);
    label.sprite.visible = false;
    parent.add(glow, pedestal, top, rim, beacon, lock, coin, label.sprite);
    this.views.push(view(label, '?', -1, Math.random() * 10));
  }

  /** Two brass posts with a velvet rope between them and a LOCKED sign, facing the lane. */
  private makeLock(pos: THREE.Vector3): THREE.Group {
    const lock = new THREE.Group();
    lock.position.set(pos.x, 0, pos.z);
    const postMat = flat(GOLD, { emissive: 0x3a2800 });
    for (const dx of [-1.1, 1.1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.3, 12), postMat);
      post.position.set(dx, 1.1, 0);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), postMat);
      knob.position.set(dx, 1.8, 0);
      lock.add(post, knob);
    }
    const rope = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.06, 8, 24, Math.PI), flat(0xb3122e));
    rope.rotation.z = Math.PI;
    rope.position.y = 1.72;
    rope.scale.y = 0.35;
    if (!lockedSign) {
      const label = makeLabel();
      label.set('LOCKED', '#c9ced6');
      lockedSign = label.sprite.material;
    }
    const sign = new THREE.Sprite(lockedSign);
    sign.scale.set(6 * 0.36, 6 * (96 / 512) * 0.36, 1);
    sign.position.y = 2.25;
    lock.add(rope, sign);
    return lock;
  }

  /**
   * The showcase floor: pale tiles, edged by a low, rounded kerb in the owner's colour (a subtle edge, not a
   * fence: it's open at the front, and nothing stops anyone stepping over it), and a short tiled path from the
   * lane to the gap in the kerb.
   */
  private buildFloor(edge: number): void {
    const w = PLOT_HALF * 2;
    const d = PLOT_DEPTH;
    const floor = new THREE.Mesh(
      new RoundedBoxGeometry(w, 0.18, d, 2, 0.07),
      new THREE.MeshLambertMaterial({ map: tileTexture('#f4ecdc', w, d) }),
    );
    floor.position.set(0, 0.04, -d / 2);
    floor.receiveShadow = true;
    this.group.add(floor);
    const kerbMat = new THREE.MeshPhongMaterial({ color: edge, emissive: edge, emissiveIntensity: 0.18, shininess: 40 });
    const kerb = (x: number, z: number, sx: number, sz: number) => {
      const mesh = new THREE.Mesh(new RoundedBoxGeometry(sx, 0.3, sz, 2, 0.12), kerbMat);
      mesh.position.set(x, 0.15, z);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    const t = 0.36;
    kerb(-w / 2, -d / 2, t, d + t);
    kerb(w / 2, -d / 2, t, d + t);
    kerb(0, -d, w + t, t);
    const front = (w - ENTRANCE) / 2;
    kerb(-(ENTRANCE + front) / 2, 0, front, t);
    kerb((ENTRANCE + front) / 2, 0, front, t);
    const path = new THREE.Mesh(
      new RoundedBoxGeometry(ENTRANCE - 0.4, 0.08, SETBACK + 0.6, 2, 0.03),
      // Your own path is a warm gold, so your way in stands out from the lane.
      new THREE.MeshLambertMaterial({ map: tileTexture(this.own ? '#f2d488' : '#e2d2b2', ENTRANCE - 0.4, SETBACK + 0.6) }),
    );
    path.position.set(0, 0.035, SETBACK / 2);
    path.receiveShadow = true;
    this.group.add(path);
  }

  /** The owner's name board at the back of the plot, facing the lane, on two posts. */
  private buildSign(text: string, color: string, board: number): void {
    const g = new THREE.Group();
    g.position.set(0, 0, BOARD_Z);
    const postMat = new THREE.MeshPhongMaterial({ color: 0x9a6a3c, shininess: 20 });
    const knobMat = new THREE.MeshPhongMaterial({ color: GOLD, emissive: 0x3a2600, shininess: 80 });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.21, 4.6, 12), postMat);
      post.position.set(side * BOARD_POST_X, 2.3, 0);
      post.castShadow = true;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), knobMat);
      knob.position.set(side * BOARD_POST_X, 4.7, 0);
      g.add(post, knob);
    }
    const panel = new THREE.Mesh(
      new RoundedBoxGeometry(8.6, 1.6, 0.3, 3, 0.12),
      new THREE.MeshPhongMaterial({ color: board, shininess: 40 }),
    );
    panel.position.y = 3.85;
    panel.castShadow = true;
    const label = makeLabel();
    label.set(text, color);
    label.sprite.position.set(0, 3.85, 0.4);
    label.sprite.scale.multiplyScalar(0.72);
    g.add(panel, label.sprite);
    this.group.add(g);
  }
}
