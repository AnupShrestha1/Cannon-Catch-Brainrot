// The showcase beside the cannon: a stone hall with a red carpet down the middle and two rows of 5 pedestals
// either side of it. The gacha machine and merge station stand either side of the cannon. Pedestals show their brainrot,
// a rarity glow, and a big coin spinning over its head with the coins waiting there; locked ones are roped
// off until the base is expanded. It only draws the save; Game owns the rules (and the level-up buttons,
// which are HTML).
import * as THREE from 'three';
import { ECONOMY, RARITIES } from './config';
import { makeCharacter, type CharacterRig } from './characters';
import { formatCoins } from './economy';
import { FENCE, fromPlot, plotAt, toPlot, type PlotSlot } from './layout';
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

/**
 * The base, as in the sketch, laid out along the launch camera's view (-z): the cannon on a round plaza, the
 * showcase hall straight behind it with its red carpet running up to the cannon, and the gacha machine and
 * merge station on either side of the plaza facing the cannon.
 *
 * The hall is built in its own frame, with the carpet along local -x at local z = CARPET_Z, then turned so
 * local -x points down world -z: a local (x, z) lands at world (-z, x).
 */
export const CARPET_Z = 0;
const HALL_TURN = -Math.PI / 2;
/** Radius of the paved plaza around the cannon. */
export const PLAZA_RADIUS = 11;
const ENTRANCE_X = -9;
const FIRST_X = -12.5;
const STEP_X = 4.3;
const ROW_OFFSET = 3.4;
const HALL_END_X = FIRST_X - STEP_X * 4 - 3;
/** Half the hall's width across the carpet, and the gap left in its front wall for the entrance. */
const HALL_HALF_WIDTH = (ROW_OFFSET * 2 + 5) / 2;
const HALL_GAP = 6.2;
/**
 * The gacha machine (left of the cannon from the launch camera) and the merge station (right), on the plaza's
 * edge level with the cannon, both facing it. The fronts, where their platforms are, are where the
 * player stands to use them.
 */
export const MACHINE = new THREE.Vector3(-7.5, 0, -0.5);
export const MACHINE_FRONT = new THREE.Vector3(MACHINE.x + 2.5, 0, MACHINE.z);
export const MERGER = new THREE.Vector3(7.5, 0, -0.5);
export const MERGER_FRONT = new THREE.Vector3(MERGER.x - 2.5, 0, MERGER.z);
/** Radius of the step-on platform in front of each station. */
export const PLATFORM_RADIUS = 1.25;
/** Height of the coin over a brainrot's head. */
const COIN_Y = 3.3;

const PAD_TOP = 0.5;
const pedestalGeo = new THREE.CylinderGeometry(1.45, 1.65, 0.42, 8).translate(0, 0.21, 0);
const topGeo = new THREE.CylinderGeometry(1.22, 1.22, 0.1, 32).translate(0, 0.45, 0);
const rimGeo = new THREE.TorusGeometry(1.26, 0.08, 6, 40).rotateX(Math.PI / 2).translate(0, 0.48, 0);
const glowGeo = new THREE.PlaneGeometry(4.6, 4.6);
const beaconGeo = new THREE.TorusGeometry(0.9, 0.06, 6, 40).rotateX(Math.PI / 2);
const coinGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.16, 28).rotateX(Math.PI / 2);
const coinFaceGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.2, 28).rotateX(Math.PI / 2);
const coinRimGeo = new THREE.TorusGeometry(0.62, 0.06, 6, 28);
const coinMat = flat(0xffc21a, { emissive: 0x8a5f00 });
const coinFaceMat = flat(0xffe066, { emissive: 0x8a6a00 });
const coinRimMat = flat(0xe0a000, { emissive: 0x5a3c00 });
const stoneMat = flat(0xf1ebe0);
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
  /** Another player's plot: their brainrots on display, their name over the gate, no coin counters. */
  owner?: string;
}

/** Solid things in plot space, for walking: circles [x, z, r] and wall segments [x0, z0, x1, z1]. */
export interface Solids {
  circles: [number, number, number][];
  walls: [number, number, number, number][];
}

let solids: Solids | null = null;

/** The cannon, both stations, every pedestal and the showcase's low walls (open at the entrance). */
export function plotSolids(): Solids {
  if (solids) return solids;
  const circles: [number, number, number][] = [
    [0, 0, 1.9],
    [MACHINE.x, MACHINE.z, 1.9],
    [MERGER.x, MERGER.z, 1.8],
  ];
  const at = new THREE.Vector3();
  for (let i = 0; i < ECONOMY.maxPads; i++) {
    Base.padPosition(i, at);
    circles.push([at.x, at.z, 1.7]);
  }
  // The hall in world terms: local (x, z) lands at (-z, x).
  const half = HALL_HALF_WIDTH;
  const gap = HALL_GAP / 2;
  const walls: [number, number, number, number][] = [
    [-half, HALL_END_X, -half, ENTRANCE_X],
    [half, HALL_END_X, half, ENTRANCE_X],
    [-half, HALL_END_X, half, HALL_END_X],
    [-half, ENTRANCE_X, -gap, ENTRANCE_X],
    [gap, ENTRANCE_X, half, ENTRANCE_X],
  ];
  solids = { circles, walls };
  return solids;
}

/** Floor height under a point in plot space: platforms and the showcase floor and carpet are raised. */
export function floorAt(x: number, z: number): number {
  for (const f of [MACHINE_FRONT, MERGER_FRONT]) {
    if (Math.hypot(x - f.x, z - f.z) < PLATFORM_RADIUS + 0.1) return 0.27;
  }
  const onCarpet = Math.abs(x) < 1.4 && z < -2.5 && z > HALL_END_X;
  if (onCarpet) return 0.17;
  if (Math.abs(x) < HALL_HALF_WIDTH && z < ENTRANCE_X && z > HALL_END_X) return 0.12;
  return 0.04;
}

/**
 * Pushes a world point (a walker of radius r) out of the solid things in whichever plot it's in: the cannon,
 * the stations, the pedestals and the showcase walls.
 */
export function bumpSolids(x: number, z: number, r: number): [number, number] {
  const slot = plotAt(x, z);
  if (!slot) return [x, z];
  let [lx, lz] = toPlot(slot, x, z);
  const { circles, walls } = plotSolids();
  for (const [sx, sz, sr] of circles) {
    const dx = lx - sx;
    const dz = lz - sz;
    const d = Math.hypot(dx, dz);
    const min = sr + r;
    if (d >= min) continue;
    if (d < 1e-4) {
      lz = sz + min;
      continue;
    }
    lx = sx + (dx / d) * min;
    lz = sz + (dz / d) * min;
  }
  for (const [x0, z0, x1, z1] of walls) {
    const wx = x1 - x0;
    const wz = z1 - z0;
    const t = Math.min(1, Math.max(0, ((lx - x0) * wx + (lz - z0) * wz) / (wx * wx + wz * wz)));
    const nx = lx - (x0 + wx * t);
    const nz = lz - (z0 + wz * t);
    const d = Math.hypot(nx, nz);
    const min = 0.2 + r;
    if (d >= min || d < 1e-4) continue;
    lx += (nx / d) * (min - d);
    lz += (nz / d) * (min - d);
  }
  return fromPlot(slot, lx, lz);
}

/** Floor height under a world point: raised on platforms and in the showcases, street paving elsewhere. */
export function floorWorld(x: number, z: number): number {
  const slot = plotAt(x, z);
  if (!slot) return 0.06;
  const [lx, lz] = toPlot(slot, x, z);
  return floorAt(lx, lz);
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
  private machine: THREE.Group;
  private capsules: THREE.Mesh[] = [];
  private crank: THREE.Group;
  private shakeT = 0;
  private merger = new THREE.Group();
  private swirl = new THREE.Group();
  private brew!: THREE.MeshLambertMaterial;
  private mergeT = 0;
  private flames: THREE.Mesh[] = [];
  /** The glowing platforms in front of the gacha machine and the merge station, and their rising rings. */
  private platforms: { ring: THREE.Mesh; top: THREE.MeshLambertMaterial; seed: number }[] = [];

  /**
   * Builds a plot's base. Without a slot it's this client's own plot, at the world origin; with one, it's
   * placed at that slot, and `vacant` leaves it unclaimed.
   */
  constructor(scene: THREE.Scene, slot: PlotSlot | null = null, options: BaseOptions = {}) {
    this.scene = scene;
    this.vacant = !!options.vacant;
    this.remote = !this.vacant && !!options.owner;
    if (slot) {
      this.group.position.set(slot.x, 0, slot.z);
      this.group.rotation.y = slot.rot;
    }
    scene.add(this.group);
    this.buildPlaza();
    if (this.vacant) this.buildGateSign('OPEN PLOT', '#c9ced6');
    else if (options.owner) this.buildGateSign(`${options.owner.toUpperCase()}'S BASE`, '#9dfcff');
    else this.buildGateSign('YOUR BASE', '#ffd84a');
    this.buildHall();
    this.machine = new THREE.Group();
    this.crank = new THREE.Group();
    this.buildMachine();
    this.buildMerger();
    this.addPlatform(MACHINE_FRONT, 0xff5fa2, 'GACHA');
    this.addPlatform(MERGER_FRONT, 0x8a5cff, 'MERGE');
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

  /** Where a slot's level-up button sits: right under its brainrot, at the foot of the pedestal. */
  static buttonAnchor(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    Base.padPosition(i, out);
    return out.setY(-0.15);
  }

  /** Bubbles the merge station over, for a merge. */
  stirMerger(): void {
    this.mergeT = 1;
  }

  /** Where merged brainrots burst out of the station. */
  static mergerExit(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(MERGER.x, 3.2, MERGER.z);
  }

  /** Slots pair up across the carpet (even on the left, odd on the right), running away from the cannon. */
  static padPosition(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    const col = Math.floor(i / 2);
    const side = i % 2 === 0 ? 1 : -1;
    const lx = FIRST_X - col * STEP_X;
    const lz = CARPET_Z + side * ROW_OFFSET;
    return out.set(-lz, PAD_TOP, lx);
  }

  /** Shakes the machine and turns its crank, for a pull. */
  shakeMachine(): void {
    this.shakeT = 1;
  }

  /** Where a pulled capsule pops out. */
  static capsuleExit(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(MACHINE.x + 1.5, 1.1, MACHINE.z);
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
      // Face the carpet.
      rig.group.rotation.y = i % 2 === 0 ? Math.PI / 2 : -Math.PI / 2;
      this.group.add(rig.group);
      view.rig = rig;
      view.arrive = 1;
    });
  }

  update(save: Pick<Save, 'pads'>, time: number, realDt: number): void {
    this.labelTimer -= realDt;
    const refreshLabels = this.labelTimer <= 0;
    if (refreshLabels) this.labelTimer = 0.2;
    this.animateMachine(time, realDt);
    this.animateMerger(time, realDt);
    if (this.vacant) {
      this.animatePlatforms(time);
      return;
    }
    this.animatePlatforms(time);
    this.views.forEach((view, i) => {
      this.updatePad(view, i < save.pads.length ? save.pads[i] : null, time, realDt, refreshLabels);
    });
  }

  private animatePlatforms(time: number): void {
    for (const p of this.platforms) {
      const t = (time * 0.9 + p.seed) % 1;
      p.ring.position.y = 0.2 + t * 1.3;
      p.ring.scale.setScalar(1 - t * 0.3);
      (p.ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t);
      p.top.emissiveIntensity = 0.55 + Math.sin(time * 3 + p.seed * 6) * 0.2;
    }
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
    glow.position.set(pos.x, 0.12, pos.z);
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
    if (this.remote) {
      // Another player's slot: the pedestal, its glow and lock, but no coin pile or counter.
      vacantLabel ??= makeLabel();
      this.group.add(glow, pedestal, top, rim, beacon, lock);
      this.views.push({
        top,
        topMat,
        rimMat,
        glow,
        glowMat,
        beacon,
        lock,
        rig: null,
        key: '?',
        coin,
        label: vacantLabel,
        shown: 0,
        pop: 0,
        arrive: 0,
        seed: Math.random() * 10,
      });
      return;
    }
    if (this.vacant) {
      beacon.visible = false;
      this.group.add(pedestal, top, rim);
      vacantLabel ??= makeLabel();
      this.views.push({
        top,
        topMat,
        rimMat,
        glow,
        glowMat,
        beacon,
        lock,
        rig: null,
        key: '',
        coin,
        label: vacantLabel,
        shown: 0,
        pop: 0,
        arrive: 0,
        seed: 0,
      });
      return;
    }
    const label = makeLabel();
    label.sprite.position.set(pos.x, COIN_Y + 1.05, pos.z);
    label.sprite.scale.multiplyScalar(0.7);
    label.sprite.visible = false;
    this.group.add(glow, pedestal, top, rim, beacon, lock, coin, label.sprite);
    this.views.push({
      top,
      topMat,
      rimMat,
      glow,
      glowMat,
      beacon,
      lock,
      rig: null,
      key: '?',
      coin,
      label,
      shown: -1,
      pop: 0,
      arrive: 0,
      seed: Math.random() * 10,
    });
  }

  /** Two brass posts with a velvet rope between them and a LOCKED sign. */
  private makeLock(pos: THREE.Vector3): THREE.Group {
    const lock = new THREE.Group();
    lock.position.set(pos.x, 0, pos.z);
    // The rope runs along the row, facing the carpet.
    lock.rotation.y = Math.PI / 2;
    const postMat = flat(GOLD, { emissive: 0x3a2800 });
    for (const dx of [-1.1, 1.1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.3, 8), postMat);
      post.position.set(dx, 1.1, 0);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), postMat);
      knob.position.set(dx, 1.8, 0);
      lock.add(post, knob);
    }
    const rope = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.06, 6, 20, Math.PI), flat(0xb3122e));
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

  /** Stone floor with a border, the red carpet with gold edging, and an arch over the entrance. */
  /** Two posts and a beam over the plot's gate, with the owner's sign. */
  private buildGateSign(text: string, color: string): void {
    const postMat = flat(0x9a6a3c);
    for (const side of [-1, 1]) {
      // Tall, so the beam stays above the camera when the player stands just inside the gate.
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.45, 6.6, 0.45), postMat);
      post.position.set(side * (FENCE.gate + 0.3), 3.3, FENCE.front);
      post.castShadow = true;
      this.group.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(FENCE.gate * 2 + 1.4, 0.7, 0.4), flat(this.vacant ? 0x8a8f99 : 0xc8102e));
    beam.position.set(0, 6.6, FENCE.front);
    beam.castShadow = true;
    const sign = makeLabel();
    sign.set(text, color);
    sign.sprite.position.set(0, 7.5, FENCE.front);
    sign.sprite.scale.multiplyScalar(0.75);
    this.group.add(beam, sign.sprite);
  }

  /** A paved round plaza around the cannon, with a ring pattern and a low curb. */
  private buildPlaza(): void {
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(PLAZA_RADIUS, 48), flat(0xe9dcc3));
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.y = 0.035;
    plaza.receiveShadow = true;
    const inner = new THREE.Mesh(new THREE.RingGeometry(4.2, 4.6, 48), flat(0xd2bf9a));
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.04;
    const curb = new THREE.Mesh(
      new THREE.TorusGeometry(PLAZA_RADIUS, 0.22, 6, 64).rotateX(Math.PI / 2),
      flat(0xcdbb98),
    );
    curb.position.y = 0.06;
    curb.receiveShadow = true;
    this.group.add(plaza, inner, curb);
  }

  private buildHall(): void {
    const g = new THREE.Group();
    g.rotation.y = HALL_TURN;
    this.group.add(g);
    const near = ENTRANCE_X;
    const far = HALL_END_X;
    const length = near - far;
    const midX = (near + far) / 2;
    const depth = HALL_HALF_WIDTH * 2;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(length, 0.12, depth), flat(0xe9dcc3));
    floor.position.set(midX, 0.06, CARPET_Z);
    floor.receiveShadow = true;
    g.add(floor);
    // Tile lines across the floor.
    const lineMat = flat(0xd6c6a8);
    for (let x = far + 2; x < near; x += 2) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.01, depth), lineMat);
      line.position.set(x, 0.125, CARPET_Z);
      g.add(line);
    }
    // The carpet runs on out of the hall, across the plaza, up to the cannon.
    const run = 6.5;
    const carpet = new THREE.Mesh(new THREE.BoxGeometry(length + run, 0.05, 2.8), flat(0xc8102e));
    carpet.position.set(midX + run / 2, 0.145, CARPET_Z);
    carpet.receiveShadow = true;
    g.add(carpet);
    const edgeMat = flat(GOLD, { emissive: 0x4a3200 });
    for (const side of [-1, 1]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(length + run, 0.06, 0.14), edgeMat);
      edge.position.set(midX + run / 2, 0.15, CARPET_Z + side * 1.4);
      g.add(edge);
    }
    // A low wall around the hall, open where the carpet comes in.
    const wallMat = flat(0xcdbb98);
    const wall = (x: number, z: number, w: number, d: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), wallMat);
      m.position.set(x, 0.25, z);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    };
    wall(midX, CARPET_Z + depth / 2, length, 0.35);
    wall(midX, CARPET_Z - depth / 2, length, 0.35);
    wall(far, CARPET_Z, 0.35, depth);
    const gap = HALL_GAP;
    const side = (depth - gap) / 2;
    wall(near, CARPET_Z + gap / 2 + side / 2, 0.35, side);
    wall(near, CARPET_Z - gap / 2 - side / 2, 0.35, side);
    // Entrance arch with a sign.
    const pillarMat = flat(0xf6efe2);
    for (const s of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 4.2, 0.6), pillarMat);
      pillar.position.set(near, 2.1, CARPET_Z + s * (gap / 2 + 0.3));
      pillar.castShadow = true;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.25, 0.8), edgeMat);
      cap.position.set(near, 4.3, CARPET_Z + s * (gap / 2 + 0.3));
      g.add(pillar, cap);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, gap + 1.6), flat(0xc8102e));
    beam.position.set(near, 4.85, CARPET_Z);
    beam.castShadow = true;
    g.add(beam);
    const sign = makeLabel();
    sign.set('BRAINROT SHOWCASE', '#ffd84a');
    sign.sprite.position.set(near + 0.3, 5.9, CARPET_Z);
    sign.sprite.scale.multiplyScalar(0.75);
    g.add(sign.sprite);
  }

  /** A capsule machine: a red base with a crank, a glass globe of capsules, and a sign. */
  private buildMachine(): void {
    const m = this.machine;
    m.position.copy(MACHINE);
    // Smooth and glossy, like a shiny toy.
    const red = new THREE.MeshPhongMaterial({ color: 0xe63946, shininess: 80, specular: 0xffb0b8 });
    const gold = new THREE.MeshPhongMaterial({ color: GOLD, emissive: 0x3a2600, shininess: 90, specular: 0xfff1b0 });
    const body = new THREE.Mesh(new RoundedBoxGeometry(2.6, 2, 2.6, 4, 0.22), red);
    body.position.y = 1;
    const trim = new THREE.Mesh(new RoundedBoxGeometry(2.75, 0.22, 2.75, 3, 0.08), gold);
    trim.position.y = 2.05;
    const chute = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.9), flat(0x2b2b33));
    chute.position.set(1.32, 0.6, 0);
    // The crank faces the carpet (+x).
    this.crank.position.set(1.35, 1.45, 0);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 32), gold);
    disc.rotation.z = Math.PI / 2;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.7, 0.14), flat(0xffffff));
    handle.position.set(0.12, 0.25, 0);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), red);
    knob.position.set(0.12, 0.6, 0);
    this.crank.add(disc, handle, knob);
    const globe = new THREE.Mesh(
      new THREE.SphereGeometry(1.45, 40, 28),
      new THREE.MeshPhongMaterial({ color: 0xcdefff, transparent: true, opacity: 0.3, depthWrite: false, shininess: 120, specular: 0xffffff }),
    );
    globe.position.y = 3.3;
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 0.45, 40), red);
    lid.position.y = 4.75;
    const topper = new THREE.Mesh(new THREE.SphereGeometry(0.35, 24, 16), gold);
    topper.position.y = 5.15;
    m.add(body, trim, chute, this.crank, lid, topper);
    const capsuleGeo = new THREE.SphereGeometry(0.33, 20, 14);
    const colors = RARITIES.slice(0, 6).map((r) => r.color);
    for (let i = 0; i < 16; i++) {
      const capsule = new THREE.Mesh(
        capsuleGeo,
        new THREE.MeshPhongMaterial({ color: colors[i % colors.length], emissive: colors[i % colors.length], shininess: 100, specular: 0xffffff }),
      );
      (capsule.material as THREE.MeshPhongMaterial).emissiveIntensity = 0.25;
      const a = i * 2.4;
      const r = 0.35 + (i % 3) * 0.3;
      capsule.position.set(Math.cos(a) * r, 2.3 + Math.floor(i / 5) * 0.45 + (i % 2) * 0.15, Math.sin(a) * r);
      capsule.userData.home = capsule.position.clone();
      this.capsules.push(capsule);
      m.add(capsule);
    }
    // Transparent last, so the capsules show through the glass.
    m.add(globe);
    m.traverse((o) => {
      if (o instanceof THREE.Mesh && o !== globe) o.castShadow = true;
    });
    const sign = makeLabel();
    sign.set('GACHA', '#ffffff');
    sign.sprite.position.y = 6.1;
    sign.sprite.scale.multiplyScalar(0.8);
    m.add(sign.sprite);
    this.group.add(m);
  }

  /** A round step-on platform: stone base, glowing coloured top, gold rim, a rising ring and "Press E". */
  private addPlatform(at: THREE.Vector3, color: number, name: string): void {
    const g = new THREE.Group();
    g.position.set(at.x, 0, at.z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(PLATFORM_RADIUS + 0.15, PLATFORM_RADIUS + 0.3, 0.2, 24), stoneMat);
    base.position.y = 0.1;
    base.receiveShadow = true;
    const top = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.55 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(PLATFORM_RADIUS, PLATFORM_RADIUS, 0.08, 32), top);
    disc.position.y = 0.22;
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(PLATFORM_RADIUS + 0.02, 0.07, 6, 40).rotateX(Math.PI / 2),
      flat(GOLD, { emissive: 0x5a3c00 }),
    );
    rim.position.y = 0.26;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(PLATFORM_RADIUS * 0.85, 0.06, 6, 40).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    g.name = name;
    g.add(base, disc, rim, ring);
    this.group.add(g);
    this.platforms.push({ ring, top, seed: Math.random() });
  }

  /** A purple cauldron on a stand, bubbling with glowing brew, under a MERGE sign. */
  private buildMerger(): void {
    const m = this.merger;
    m.position.copy(MERGER);
    m.rotation.y = Math.PI;
    // A witch's cauldron, smooth and glossy: a round iron-purple belly on three legs over a fire, a gold rim
    // and ring handles, and a glowing, bubbling brew.
    const potMat = new THREE.MeshPhongMaterial({ color: 0x6a35e0, shininess: 70, specular: 0xb9a0ff, side: THREE.DoubleSide });
    const gold = new THREE.MeshPhongMaterial({ color: GOLD, emissive: 0x3a2600, shininess: 90, specular: 0xfff1b0 });
    const iron = new THREE.MeshPhongMaterial({ color: 0x2b2440, shininess: 40 });
    const profile = [
      [0.01, 0.9], [0.7, 0.95], [1.15, 1.25], [1.42, 1.75], [1.48, 2.3], [1.38, 2.85], [1.22, 3.15], [1.26, 3.25],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const pot = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), potMat);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(1.26, 0.13, 14, 48).rotateX(Math.PI / 2), gold);
    lip.position.y = 3.27;
    const belt = new THREE.Mesh(new THREE.TorusGeometry(1.47, 0.06, 10, 48).rotateX(Math.PI / 2), gold);
    belt.position.y = 2.3;
    for (const side of [-1, 1]) {
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.07, 10, 28), gold);
      handle.position.set(0, 2.75, side * 1.5);
      handle.rotation.y = Math.PI / 2;
      m.add(handle);
    }
    // Three curved legs.
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.5;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 1.3, 12), iron);
      leg.position.set(Math.cos(a) * 1.0, 0.55, Math.sin(a) * 1.0);
      leg.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), iron);
      foot.position.set(Math.cos(a) * 1.22, 0.06, Math.sin(a) * 1.22);
      m.add(leg, foot);
    }
    // The fire underneath: crossed logs and flickering flames.
    const logMat = new THREE.MeshPhongMaterial({ color: 0x6b4226, shininess: 8 });
    for (const turn of [0.3, -0.5, 1.4]) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.3, 10).rotateZ(Math.PI / 2), logMat);
      log.position.y = 0.16;
      log.rotation.y = turn;
      m.add(log);
    }
    this.flames = [];
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa62b, transparent: true, opacity: 0.9 });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8 });
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.55, 12), k % 2 ? coreMat : flameMat);
      flame.position.set(Math.cos(a) * 0.3, 0.45, Math.sin(a) * 0.3);
      flame.userData.seed = k * 1.3;
      this.flames.push(flame);
      m.add(flame);
    }
    this.brew = new THREE.MeshLambertMaterial({ color: 0x7dffb0, emissive: 0x2bd47a, emissiveIntensity: 0.8 });
    const brew = new THREE.Mesh(new THREE.CircleGeometry(1.22, 48).rotateX(-Math.PI / 2), this.brew);
    brew.position.y = 3.1;
    // Bubbles that rise out of the brew.
    for (let i = 0; i < 8; i++) {
      const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.14 + (i % 3) * 0.06, 16, 12), this.brew);
      bubble.userData.seed = i * 1.3;
      this.swirl.add(bubble);
    }
    this.swirl.position.y = 3.1;
    m.add(pot, lip, belt, brew, this.swirl);
    m.traverse((o) => {
      if (o instanceof THREE.Mesh && !(o.material instanceof THREE.MeshBasicMaterial)) o.castShadow = true;
    });
    const sign = makeLabel();
    sign.set('MERGE', '#b9ffd6');
    sign.sprite.position.y = 5.2;
    sign.sprite.scale.multiplyScalar(0.8);
    m.add(sign.sprite);
    this.group.add(m);
  }

  private animateMerger(time: number, realDt: number): void {
    for (const f of this.flames) {
      const seed = f.userData.seed as number;
      f.scale.set(1, 0.7 + Math.abs(Math.sin(time * 9 + seed)) * 0.6 + this.mergeT * 0.8, 1);
      f.rotation.y = time * 2 + seed;
    }
    this.mergeT = Math.max(0, this.mergeT - realDt * 1.2);
    const boil = 1 + this.mergeT * 3;
    this.brew.emissiveIntensity = 0.7 + Math.sin(time * 3) * 0.15 + this.mergeT;
    this.merger.position.x = MERGER.x + (this.mergeT > 0 ? Math.sin(time * 50) * 0.05 * this.mergeT : 0);
    this.swirl.children.forEach((b, i) => {
      const p = (time * 0.6 * boil + (b.userData.seed as number)) % 1;
      const a = i * 1.05 + time * 0.8;
      b.position.set(Math.cos(a) * 0.7, p * 1.4 * boil, Math.sin(a) * 0.7);
      b.scale.setScalar(1 - p);
    });
  }

  private animateMachine(time: number, realDt: number): void {
    this.shakeT = Math.max(0, this.shakeT - realDt * 1.2);
    const shaking = this.shakeT > 0;
    const s = shaking ? Math.sin(time * 60) * 0.06 * this.shakeT : 0;
    this.machine.rotation.z = s;
    this.machine.position.x = MACHINE.x + s;
    this.crank.rotation.x = shaking ? -(1 - this.shakeT) * Math.PI * 4 : 0;
    this.capsules.forEach((c, i) => {
      const home = c.userData.home as THREE.Vector3;
      const jump = shaking ? Math.abs(Math.sin(time * 18 + i)) * 0.5 * this.shakeT : Math.sin(time * 1.5 + i) * 0.03;
      c.position.set(home.x, home.y + jump, home.z);
    });
  }
}
