// A player's plot: a showcase of two rows of 5 pedestals along the lane, on a tiled floor with the owner's name
// board at the back. Pedestals show their brainrot, a rarity glow, and a big coin spinning over its head with the
// coins waiting there; locked ones are roped off until the base is expanded. It only draws the save; Game owns
// the rules (and the level-up buttons, which are HTML). The cannon, cauldron, shop and gacha machines are
// shared, in the hub (hub.ts); this file also says what is solid and how high the floor is, town-wide.
import * as THREE from 'three';
import { ECONOMY, GACHA, RARITIES } from './config';
import { makeCharacter, type CharacterRig } from './characters';
import { formatCoins } from './economy';
import {
  BOARDS,
  CAULDRON,
  CAULDRON_FRONT,
  FOUNTAIN,
  PAD_RADIUS,
  PLOT_DEPTH,
  PLOT_HALF,
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

/** Pedestal spacing along a row, and the two rows' depths in plot space (the lane is at +z). */
const PAD_STEP = 4.2;
const FRONT_ROW = -2.9;
const BACK_ROW = -8.1;
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
const floorMat = new THREE.MeshLambertMaterial({ color: 0xf3ead8 });
const groutMat = new THREE.MeshBasicMaterial({ color: 0xd9c9aa });
const lockedTop = 0x6f7783;
const emptyTop = 0xdfeaf6;
const GOLD = 0xffc84a;

/** Thin grout lines across a showcase floor, as one flat geometry facing up. */
function groutGeo(w: number, d: number): THREE.BufferGeometry {
  const pos: number[] = [];
  // Two triangles per strip, wound counter-clockwise seen from above.
  const strip = (x0: number, z0: number, x1: number, z1: number) =>
    pos.push(x0, 0, z0, x0, 0, z1, x1, 0, z1, x0, 0, z0, x1, 0, z1, x1, 0, z0);
  for (let x = -w / 2 + 2.1; x < w / 2 - 0.5; x += 2.1) strip(x - 0.03, -d / 2, x + 0.03, d / 2);
  for (let z = -d / 2 + 2.2; z < d / 2 - 0.5; z += 2.2) strip(-w / 2, z - 0.03, w / 2, z + 0.03);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return geo;
}

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
  for (let i = 0; i < ECONOMY.maxPads; i++) {
    Base.padPosition(i, at);
    circles.push([at.x, at.z, 1.7]);
  }
  for (const side of [-1, 1]) circles.push([side * 3.4, -PLOT_DEPTH + 0.4, 0.3]);
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
    if (Math.abs(lx) < PLOT_HALF + 1 && lz < 1.5 && lz > -PLOT_DEPTH - 1) return slot;
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

  /** Builds a plot's showcase at its slot; `vacant` leaves it unclaimed, `owner` makes it another player's. */
  constructor(scene: THREE.Scene, slot: PlotSlot, options: BaseOptions = {}) {
    this.scene = scene;
    this.vacant = !!options.vacant;
    this.remote = !this.vacant && !!options.owner;
    this.group.position.set(slot.x, 0, slot.z);
    this.group.rotation.y = slot.rot;
    scene.add(this.group);
    const own = !this.vacant && !options.owner;
    this.buildFloor(this.vacant ? 0xb9c0cc : own ? GOLD : 0x7fd8ff);
    if (this.vacant) this.buildSign('OPEN PLOT', '#c9ced6', 0x8a8f99);
    else if (options.owner) this.buildSign(`${options.owner.toUpperCase()}'S BASE`, '#9dfcff', 0x2f5fc4);
    else this.buildSign('YOUR BASE', '#ffd84a', 0xc8102e);
    for (let i = 0; i < ECONOMY.maxPads; i++) this.addPad(i);
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
   * Where slot i stands in plot space: two rows of 5 along the lane, the front row (0-4) first, each row
   * starting from the end nearest the hub.
   */
  static padPosition(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    const row = i < 5 ? 0 : 1;
    const col = i % 5;
    return out.set((col - 2) * PAD_STEP, PAD_TOP, row === 0 ? FRONT_ROW : BACK_ROW);
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

  /** Matches pedestals, characters and rarity colours to the save. Slots past save.pads are locked. */
  sync(save: Pick<Save, 'pads'>): void {
    if (this.vacant) return;
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
      // Facing the lane.
      rig.group.rotation.y = 0;
      this.group.add(rig.group);
      view.rig = rig;
      view.arrive = 1;
    });
  }

  update(save: Pick<Save, 'pads'>, time: number, realDt: number): void {
    this.labelTimer -= realDt;
    const refreshLabels = this.labelTimer <= 0;
    if (refreshLabels) this.labelTimer = 0.2;
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
      this.group.add(glow, pedestal, top, rim, beacon, lock);
      this.views.push(view(vacantLabel, '?', 0, Math.random() * 10));
      return;
    }
    if (this.vacant) {
      beacon.visible = false;
      this.group.add(pedestal, top, rim);
      vacantLabel ??= makeLabel();
      this.views.push(view(vacantLabel, '', 0, 0));
      return;
    }
    const label = makeLabel();
    label.sprite.position.set(pos.x, COIN_Y + 1.05, pos.z);
    label.sprite.scale.multiplyScalar(0.7);
    label.sprite.visible = false;
    this.group.add(glow, pedestal, top, rim, beacon, lock, coin, label.sprite);
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

  /** The showcase floor: pale stone tiles edged in the owner's colour, nearly flush with the lane. */
  private buildFloor(edge: number): void {
    const w = PLOT_HALF * 2;
    const d = PLOT_DEPTH;
    const border = new THREE.Mesh(
      new RoundedBoxGeometry(w + 0.6, 0.14, d + 0.6, 2, 0.06),
      new THREE.MeshLambertMaterial({ color: edge, emissive: edge, emissiveIntensity: 0.2 }),
    );
    border.position.set(0, 0.03, -d / 2);
    border.receiveShadow = true;
    const floor = new THREE.Mesh(new RoundedBoxGeometry(w, 0.18, d, 2, 0.07), floorMat);
    floor.position.set(0, 0.04, -d / 2);
    floor.receiveShadow = true;
    const grout = new THREE.Mesh(groutGeo(w, d), groutMat);
    grout.position.set(0, 0.135, -d / 2);
    this.group.add(border, floor, grout);
  }

  /** The owner's name board at the back of the plot, facing the lane, on two posts. */
  private buildSign(text: string, color: string, board: number): void {
    const g = new THREE.Group();
    g.position.set(0, 0, -PLOT_DEPTH + 0.4);
    const postMat = new THREE.MeshPhongMaterial({ color: 0x9a6a3c, shininess: 20 });
    const knobMat = new THREE.MeshPhongMaterial({ color: GOLD, emissive: 0x3a2600, shininess: 80 });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 3.6, 12), postMat);
      post.position.set(side * 3.4, 1.8, 0);
      post.castShadow = true;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), knobMat);
      knob.position.set(side * 3.4, 3.7, 0);
      g.add(post, knob);
    }
    const panel = new THREE.Mesh(
      new RoundedBoxGeometry(7.6, 1.4, 0.3, 3, 0.12),
      new THREE.MeshPhongMaterial({ color: board, shininess: 40 }),
    );
    panel.position.y = 2.95;
    panel.castShadow = true;
    const label = makeLabel();
    label.set(text, color);
    label.sprite.position.set(0, 2.95, 0.4);
    label.sprite.scale.multiplyScalar(0.62);
    g.add(panel, label.sprite);
    this.group.add(g);
  }
}
