// The shared hub at the end of the lane, and the town's paving: the cannon's dais, the merge cauldron, the upgrade
// shop's stall and its keeper, a row of gacha machines (one per pull tier, each a different machine, grander as
// the price goes up), and the fountain that closes the far end of the lane.
//
// Machines are used by standing on one of the two pads in front of them (×1 or ×10) and pressing E: no panels.
// A locked machine is dimmed and chained with a padlock, and its sign says the height that unlocks it; when a
// flight first reaches that height the padlock shakes, bursts off and the machine lights up.
//
// Motion follows the classic principles where it can: anticipation (a machine squats before it spins, the lever
// is pulled), squash and stretch, slow in and out on every spin, follow-through and overshoot as things settle,
// and secondary action (the keeper waves, bulbs chase, capsules rattle, water arcs).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GACHA, RARITIES, type GachaTier } from './config';
import { formatCoins } from './economy';
import {
  CAULDRON,
  CAULDRON_FRONT,
  REBIRTH_AT,
  REBIRTH_FRONT,
  WALK,
  FOUNTAIN,
  HUB_BACK,
  HUB_EDGE,
  LANE_HALF,
  LANE_X,
  MACHINE_X,
  PAD_RADIUS,
  SHOP,
  SHOP_FRONT,
  TOWN,
  machineAt,
  pullPad,
} from './layout';
import { PLATFORM_RADIUS, floorWorld } from './base';
import { tileTexture } from './tiles';
import { flat, makePlayer, softTexture, type PlayerRig } from './world';

const GOLD = 0xffc84a;
const phong = (color: number, extra: THREE.MeshPhongMaterialParameters = {}) =>
  new THREE.MeshPhongMaterial({ color, shininess: 70, specular: 0x555555, ...extra });
const goldMat = () => phong(GOLD, { emissive: 0x3a2600, shininess: 100, specular: 0xfff1b0 });
const chrome = () => phong(0xdfe6f0, { shininess: 140, specular: 0xffffff });

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
/** Overshoots a little past 1 and settles back: follow-through. */
const easeOutBack = (t: number) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;

/** A sign board drawn on a canvas: a title in the tier's colour and a line under it, with an optional progress bar. */
interface Sign {
  sprite: THREE.Sprite;
  draw(title: string, sub: string, color: string, locked: boolean, progress?: number): void;
}

function makeSign(): Sign {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 208;
  const g = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(5, 5 * (208 / 512), 1);
  return {
    sprite,
    draw(title, sub, color, locked, progress) {
      g.clearRect(0, 0, 512, 208);
      g.fillStyle = locked ? 'rgba(40, 44, 58, 0.92)' : 'rgba(29, 22, 64, 0.92)';
      g.strokeStyle = locked ? '#8a8f99' : color;
      g.lineWidth = 10;
      g.beginPath();
      g.roundRect(8, 8, 496, 192, 34);
      g.fill();
      g.stroke();
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '900 66px system-ui, sans-serif';
      g.font = `900 ${Math.floor(66 * Math.min(1, 460 / g.measureText(title).width))}px system-ui, sans-serif`;
      g.lineWidth = 9;
      g.strokeStyle = '#1d2340';
      g.strokeText(title, 256, 66);
      g.fillStyle = locked ? '#c9ced6' : color;
      g.fillText(title, 256, 66);
      g.font = '800 42px system-ui, sans-serif';
      const fit = Math.min(1, 460 / g.measureText(sub).width);
      g.font = `800 ${Math.floor(42 * fit)}px system-ui, sans-serif`;
      g.fillStyle = '#ffffff';
      g.fillText(sub, 256, progress === undefined ? 146 : 132);
      if (progress !== undefined) {
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.beginPath();
        g.roundRect(56, 164, 400, 20, 10);
        g.fill();
        g.fillStyle = color;
        g.beginPath();
        g.roundRect(56, 164, Math.max(20, 400 * progress), 20, 10);
        g.fill();
      }
      texture.needsUpdate = true;
    },
  };
}

/** A machine's odds: each rarity it can give and its chance, in that rarity's colour, on a dark board. */
function makeOddsBoard(tier: GachaTier): THREE.Sprite {
  const lines = tier.odds;
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 56 + lines.length * 42;
  const g = canvas.getContext('2d')!;
  g.fillStyle = 'rgba(29, 22, 64, 0.9)';
  g.strokeStyle = tier.color;
  g.lineWidth = 6;
  g.beginPath();
  g.roundRect(4, 4, 312, canvas.height - 8, 22);
  g.fill();
  g.stroke();
  g.textBaseline = 'middle';
  g.font = '900 30px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillStyle = '#ffffff';
  g.fillText('ODDS', 160, 32);
  lines.forEach(([rarity, chance], i) => {
    const y = 74 + i * 42;
    const r = RARITIES[rarity];
    g.fillStyle = r.css;
    g.beginPath();
    g.arc(30, y, 9, 0, Math.PI * 2);
    g.fill();
    g.font = '800 25px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText(r.name, 48, y);
    g.textAlign = 'right';
    g.fillStyle = '#ffffff';
    g.fillText(`${+(chance * 100).toFixed(1)}%`, 300, y);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const w = 2.5;
  sprite.scale.set(w, (w * canvas.height) / 320, 1);
  return sprite;
}

/** "×1" and "×10" painted on the pull pads, white with a dark outline, readable from the lane side. */
const padText = new Map<string, THREE.Texture>();
function padTextTexture(text: string): THREE.Texture {
  let tex = padText.get(text);
  if (tex) return tex;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const g = canvas.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '900 120px system-ui, sans-serif';
  g.lineWidth = 18;
  g.strokeStyle = '#1d1640';
  g.strokeText(text, 128, 136);
  g.fillStyle = '#ffffff';
  g.fillText(text, 128, 136);
  tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  padText.set(text, tex);
  return tex;
}

/** Reel strips for the slot machines: rarity gems, sevens and stars around the drum. */
let reelTex: THREE.Texture | null = null;
function reelTexture(): THREE.Texture {
  if (reelTex) return reelTex;
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 128;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fffaf0';
  g.fillRect(0, 0, 768, 128);
  const symbols = ['7', RARITIES[4].css, '★', RARITIES[3].css, '7', RARITIES[2].css, '★', RARITIES[5].css];
  symbols.forEach((sym, i) => {
    const x = 48 + i * 96;
    g.strokeStyle = '#e6dcc8';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x + 48, 0);
    g.lineTo(x + 48, 128);
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (sym === '7' || sym === '★') {
      g.font = '900 84px system-ui, sans-serif';
      g.fillStyle = sym === '7' ? '#e63946' : '#ffb000';
      g.lineWidth = 6;
      g.strokeStyle = '#1d1640';
      g.strokeText(sym, x, 68);
      g.fillText(sym, x, 68);
    } else {
      // A cut gem.
      g.fillStyle = sym;
      g.strokeStyle = '#1d1640';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(x, 22);
      g.lineTo(x + 30, 50);
      g.lineTo(x, 108);
      g.lineTo(x - 30, 50);
      g.closePath();
      g.fill();
      g.stroke();
    }
  });
  reelTex = new THREE.CanvasTexture(canvas);
  reelTex.colorSpace = THREE.SRGBColorSpace;
  reelTex.wrapS = THREE.RepeatWrapping;
  return reelTex;
}

/** Stripes for the shop's awning. */
function stripeTexture(a: string, b: string): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 8;
  const g = canvas.getContext('2d')!;
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? b : a;
    g.fillRect(i * 32, 0, 32, 8);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface PullPadView {
  group: THREE.Group;
  top: THREE.MeshLambertMaterial;
  /** The pad's own colour (it goes grey while its machine is locked). */
  color: number;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  seed: number;
  /** 0 to 1: how lit the pad is (the player stands on it). */
  lit: number;
}

/** Each machine model animates itself: idly, and during a pull with p going 0 → 1 and k its intensity. */
interface Model {
  idle(time: number): void;
  spin(time: number, p: number, k: number): void;
}

/** The capsule a machine spits out on a pull: it arcs out, bounces, rolls to a stop, wobbles and pops open. */
interface Prize {
  group: THREE.Group;
  top: THREE.MeshPhongMaterial;
  radius: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** Seconds since it came out, and how long until it pops. */
  t: number;
  life: number;
  /** 1 on each bounce, easing to 0: it squashes on impact. */
  squash: number;
}

interface Machine {
  tier: GachaTier;
  index: number;
  group: THREE.Group;
  /** The part that squashes, stretches and shakes. */
  body: THREE.Group;
  model: Model;
  /** Every coloured material, with its own colour, so a locked machine can be dimmed and restored. */
  tints: { mat: THREE.MeshPhongMaterial | THREE.MeshLambertMaterial; color: THREE.Color; emissive: THREE.Color }[];
  lock: THREE.Group;
  sign: Sign;
  signKey: string;
  pads: [PullPadView, PullPadView];
  locked: boolean | null;
  /** Seconds into the current pull, and how long it lasts; spinT < 0 when idle. */
  spinT: number;
  spinDur: number;
  /** Seconds into the unlock burst (the padlock flies off), or < 0. */
  unlockT: number;
  /** Where capsules or prizes come out, in world space. */
  exit: THREE.Vector3;
  /** The capsule this pull spits out (when the machine pops at the end of its spin), and its colour. */
  prize: Prize;
  prizeColor: number;
  prizeGlow: boolean;
  /** Where the last capsule was when it popped, for the burst. */
  prizeAt: THREE.Vector3;
}

export class Hub {
  private group = new THREE.Group();
  private machines: Machine[] = [];
  private flames: THREE.Mesh[] = [];
  private swirl = new THREE.Group();
  private brew!: THREE.MeshLambertMaterial;
  private cauldron = new THREE.Group();
  private mergeT = 0;
  private platformRing!: THREE.Mesh;
  private platformTop!: THREE.MeshLambertMaterial;
  private keeper!: PlayerRig;
  private keeperWave = 0;
  private drops!: THREE.InstancedMesh;
  private dropSeeds: number[] = [];
  private fountainWater: THREE.Mesh[] = [];
  private dummy = new THREE.Object3D();
  private rebirthSign!: Sign;
  private rebirthKey = '';
  private rebirthReady = false;
  /** Seconds into the rebirth burst, or < 0. */
  private rebirthT = -1;
  private rebirthParts!: {
    crystal: THREE.Mesh;
    crystalMat: THREE.MeshPhongMaterial;
    rings: THREE.Mesh[];
    pillar: THREE.Mesh;
    pillarMat: THREE.MeshBasicMaterial;
    halo: THREE.Sprite;
    shock: THREE.Mesh;
    shockMat: THREE.MeshBasicMaterial;
    sparks: THREE.Mesh[];
    padRing: THREE.Mesh;
  };
  /** Called when a machine unlocks during play (not when the hub is first built). */
  onUnlock: (index: number) => void = () => {};
  /** Called when a spat-out capsule hits the floor, with where and how hard (0 to 1). */
  onBounce: (at: THREE.Vector3, strength: number) => void = () => {};

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.buildPaving();
    this.buildCauldron();
    this.buildShop();
    GACHA.forEach((tier, i) => this.buildMachine(tier, i));
    this.buildFountain();
    this.buildRebirth();
    this.buildFence();
  }

  /** The rebirth station's sign: what it gives, or what it still needs (with a bar), and whether it's ready. */
  setRebirth(ready: boolean, sub: string, progress: number, level = 0): void {
    const key = `${ready}|${sub}|${Math.round(progress * 40)}|${level}`;
    if (key === this.rebirthKey) return;
    this.rebirthKey = key;
    this.rebirthReady = ready;
    this.rebirthSign.draw(`${ready ? '' : '🔒 '}REBIRTH Lv ${level}`, sub, '#ffd84a', !ready, ready ? undefined : progress);
  }

  /** The station's big moment: the crystal rises and blazes, the rings whirl, a shockwave rolls out. */
  rebirthBurst(): void {
    this.rebirthT = 0;
  }

  /** Where the rebirth station's crystal floats, in world space. */
  rebirthCrystal(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(REBIRTH_AT.x, 4.2, REBIRTH_AT.z);
  }

  // ---------------------------------------------------------------- what the game asks of it

  /**
   * Starts machine i's pull: it spins, then spits out a capsule (in `color`, glowing for a big one, larger for
   * ×10) that bounces and rolls to a stop in front of it, wobbles, and pops. Returns the seconds until the pop.
   */
  spin(i: number, count: number, color?: number, glow = false): number {
    const m = this.machines[i];
    m.spinT = 0;
    m.spinDur = count > 1 ? 1.9 : 1.5;
    m.prizeColor = color ?? new THREE.Color(m.tier.color).getHex();
    m.prizeGlow = glow;
    m.prize.radius = count > 1 ? 0.44 : 0.34;
    return m.spinDur * SPIT_AT + PRIZE_LIFE;
  }

  /** Where machine i's last capsule popped open (or its chute, before any), in world space. */
  machineExit(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.machines[i].prizeAt);
  }

  /** A short "nope" wobble for a machine the player can't use yet. */
  refuse(i: number): void {
    const m = this.machines[i];
    m.spinT = 0;
    m.spinDur = -0.45;
  }

  /** Bubbles the cauldron over, for a merge. */
  stir(): void {
    this.mergeT = 1;
  }

  /** Where merged brainrots burst out of the cauldron. */
  mergerExit(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(CAULDRON.x, 3.2, CAULDRON.z);
  }

  /** The keeper waves at whoever arrives. */
  greet(): void {
    this.keeperWave = 1.6;
  }

  update(time: number, dt: number, best: number, gems: number, px: number, pz: number): void {
    for (const m of this.machines) this.updateMachine(m, time, dt, best, gems, px, pz);
    this.animateCauldron(time, dt);
    this.animateKeeper(time, dt, px, pz);
    this.animateFountain(time);
    this.animateRebirth(time, dt);
  }

  // ---------------------------------------------------------------- the rebirth station

  /**
   * A marble dais in three steps, gold-banded, under a floating golden crystal held in two turning rings, with
   * sparks in orbit and a pillar of light when rebirth is ready. A gold pad in front is where you stand.
   */
  private buildRebirth(): void {
    const g = new THREE.Group();
    g.position.set(REBIRTH_AT.x, 0, REBIRTH_AT.z);
    const marble = phong(0xfbf7f0, { shininess: 90, specular: 0xffffff });
    const gold = goldMat();
    const dais = new THREE.Mesh(
      new THREE.LatheGeometry(
        [[0.01, 0], [2.5, 0], [2.5, 0.3], [1.95, 0.3], [1.95, 0.62], [1.4, 0.62], [1.4, 0.95], [0.7, 0.95], [0.55, 1.6], [0.75, 1.9], [0.01, 1.9]].map(
          ([r, y]) => new THREE.Vector2(r, y),
        ),
        56,
      ),
      marble,
    );
    dais.castShadow = dais.receiveShadow = true;
    for (const [r, y] of [
      [2.5, 0.3],
      [1.95, 0.62],
      [1.4, 0.95],
    ]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 8, 56).rotateX(Math.PI / 2), gold);
      band.position.y = y;
      g.add(band);
    }
    const crystalMat = new THREE.MeshPhongMaterial({ color: 0xffe27a, emissive: 0xffa31a, emissiveIntensity: 0.6, shininess: 150, specular: 0xffffff });
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), crystalMat);
    crystal.scale.set(1, 1.7, 1);
    crystal.position.y = 4.2;
    const rings = [1.5, 1.25].map((r, i) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07, 12, 64), i ? marble : gold);
      ring.position.y = 4.2;
      g.add(ring);
      return ring;
    });
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: softTexture(), color: 0xffd36b, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    halo.scale.setScalar(4.5);
    halo.position.y = 4.2;
    const pillarMat = new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 14, 32, 1, true), pillarMat);
    pillar.position.y = 8;
    const shockMat = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const shock = new THREE.Mesh(new THREE.TorusGeometry(1, 0.12, 8, 64).rotateX(Math.PI / 2), shockMat);
    shock.position.y = 0.4;
    const sparks: THREE.Mesh[] = [];
    for (let k = 0; k < 8; k++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.11, 0), new THREE.MeshBasicMaterial({ color: k % 2 ? 0xffffff : 0xffd84a }));
      s.userData.seed = k;
      sparks.push(s);
      g.add(s);
    }
    g.add(dais, crystal, halo, pillar, shock);
    this.rebirthSign = makeSign();
    this.rebirthSign.sprite.position.y = 7.1;
    g.add(this.rebirthSign.sprite);
    this.group.add(g);
    // The gold pad in front.
    const pad = new THREE.Group();
    pad.position.set(REBIRTH_FRONT.x, 0, REBIRTH_FRONT.z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(PLATFORM_RADIUS + 0.15, PLATFORM_RADIUS + 0.3, 0.2, 40), phong(0xf1ebe0, { shininess: 20 }));
    base.position.y = 0.1;
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(PLATFORM_RADIUS, PLATFORM_RADIUS, 0.08, 40),
      new THREE.MeshLambertMaterial({ color: 0xffc21a, emissive: 0xffa000, emissiveIntensity: 0.5 }),
    );
    disc.position.y = 0.22;
    const padRing = new THREE.Mesh(
      new THREE.TorusGeometry(PLATFORM_RADIUS * 0.85, 0.06, 6, 40).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    pad.add(base, disc, padRing);
    this.group.add(pad);
    this.rebirthParts = { crystal, crystalMat, rings, pillar, pillarMat, halo, shock, shockMat, sparks, padRing };
    this.setRebirth(false, '', 0);
  }

  private animateRebirth(time: number, dt: number): void {
    const p = this.rebirthParts;
    const ready = this.rebirthReady;
    let burst = 0;
    if (this.rebirthT >= 0) {
      this.rebirthT += dt;
      burst = Math.max(0, 1 - this.rebirthT / 2.6);
      if (this.rebirthT > 2.6) this.rebirthT = -1;
    }
    const k = this.rebirthT >= 0 ? this.rebirthT : 0;
    // Anticipation: the crystal dips first, then shoots up and swells.
    const dip = this.rebirthT >= 0 && k < 0.25 ? -Math.sin((k / 0.25) * Math.PI) * 0.5 : 0;
    p.crystal.position.y = 4.2 + Math.sin(time * 1.6) * 0.15 + dip + burst * 1.4;
    p.crystal.rotation.y = time * (ready ? 1.2 : 0.4) + burst * k * 20;
    p.crystal.scale.set(1 + burst * 0.5, 1.7 * (1 + burst * 0.6), 1 + burst * 0.5);
    p.crystalMat.emissiveIntensity = (ready ? 0.9 + Math.sin(time * 3) * 0.2 : 0.25) + burst * 3;
    p.rings[0].rotation.set(time * 0.7 + burst * k * 12, time * 0.5, 0);
    p.rings[1].rotation.set(0, time * 0.9 + burst * k * 15, Math.PI / 2 + time * 0.3);
    for (const r of p.rings) r.position.y = p.crystal.position.y;
    p.halo.position.y = p.crystal.position.y;
    p.halo.scale.setScalar((ready ? 4.6 : 2.8) + Math.sin(time * 3) * 0.3 + burst * 3);
    p.pillar.visible = ready || burst > 0;
    p.pillarMat.opacity = 0.18 + Math.sin(time * 2.2) * 0.06 + burst * 0.3;
    p.pillar.scale.set(1 + burst * 1.5, 1, 1 + burst * 1.5);
    p.sparks.forEach((s) => {
      const a = time * (1.2 + burst * 6) + (s.userData.seed as number) * 0.785;
      const r = 2 + burst * 2;
      s.position.set(Math.cos(a) * r, 3.2 + Math.sin(a * 2) * 0.8 + burst * 2, Math.sin(a) * r);
      s.rotation.y = time * 4;
      s.visible = ready || burst > 0;
    });
    // A shockwave rolling out across the ground.
    if (this.rebirthT >= 0 && k < 1.2) {
      const t = k / 1.2;
      p.shock.scale.setScalar(1 + t * 16);
      p.shockMat.opacity = 0.9 * (1 - t);
    } else {
      p.shockMat.opacity = 0;
    }
    const t = (time * 0.9) % 1;
    p.padRing.position.y = 0.2 + t * 1.3;
    p.padRing.scale.setScalar(1 - t * 0.3);
    (p.padRing.material as THREE.MeshBasicMaterial).opacity = (ready ? 0.9 : 0.35) * (1 - t);
  }

  // ---------------------------------------------------------------- the town's fence

  /** A smooth wooden fence round the town's edge, where walking stops: rounded posts and two rails, batched. */
  private buildFence(): void {
    const x0 = WALK.minX - 0.5;
    const x1 = WALK.maxX + 0.5;
    const z0 = WALK.minZ - 0.5;
    const z1 = WALK.maxZ + 0.5;
    const wood = phong(0xb07a45, { shininess: 25 });
    const cap = phong(0xffc84a, { shininess: 80 });
    const spots: [number, number][] = [];
    const side = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / 2.5));
      for (let i = 0; i < n; i++) spots.push([ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n]);
      for (const y of [0.45, 0.95]) {
        const rail = new THREE.Mesh(new RoundedBoxGeometry(Math.abs(bx - ax) + 0.12, 0.13, Math.abs(bz - az) + 0.12, 2, 0.05), wood);
        rail.position.set((ax + bx) / 2, y, (az + bz) / 2);
        rail.castShadow = true;
        this.group.add(rail);
      }
    };
    side(x0, z0, x1, z0);
    side(x1, z0, x1, z1);
    side(x1, z1, x0, z1);
    side(x0, z1, x0, z0);
    const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.16, 1.25, 12), wood, spots.length);
    const caps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 12, 8), cap, spots.length);
    spots.forEach(([x, z], i) => {
      this.dummy.position.set(x, 0.62, z);
      this.dummy.updateMatrix();
      posts.setMatrixAt(i, this.dummy.matrix);
      this.dummy.position.set(x, 1.3, z);
      this.dummy.updateMatrix();
      caps.setMatrixAt(i, this.dummy.matrix);
    });
    posts.castShadow = true;
    posts.frustumCulled = caps.frustumCulled = false;
    this.group.add(posts, caps);
  }

  // ---------------------------------------------------------------- paving

  /** Warm stone paving: the hub's plaza, the lane up between the plots, the fountain's circle and the cannon's dais. */
  private buildPaving(): void {
    const edge = new THREE.MeshLambertMaterial({ color: 0xcdb892 });
    // Each surface sits at its own height so overlapping edges never flicker: hub, then lane, then the
    // fountain's circle on top where the lane meets it.
    const flatBox = (w: number, d: number, mat: THREE.Material, x: number, z: number, y: number) => {
      const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, 0.06, d, 2, 0.03), mat);
      mesh.position.set(x, y, z);
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    const tiled = (color: string, w: number, d: number) => new THREE.MeshLambertMaterial({ map: tileTexture(color, w, d) });
    const minX = TOWN.minX + 3;
    const maxX = TOWN.maxX - 3;
    const hubW = maxX - minX;
    const hubD = HUB_EDGE - HUB_BACK;
    flatBox(hubW + 0.8, hubD + 0.8, edge, (minX + maxX) / 2, (HUB_EDGE + HUB_BACK) / 2, 0.015);
    flatBox(hubW, hubD, tiled('#eadcc0', hubW, hubD), (minX + maxX) / 2, (HUB_EDGE + HUB_BACK) / 2, 0.025);
    // The lane, with a kerb either side and a row of inlaid gold studs down the middle; it stops where the
    // fountain's circle begins.
    const laneEnd = FOUNTAIN.z - 9.4;
    const laneLen = laneEnd - HUB_EDGE;
    flatBox(LANE_HALF * 2 + 0.6, laneLen, edge, LANE_X, HUB_EDGE + laneLen / 2, 0.02);
    flatBox(LANE_HALF * 2, laneLen, tiled('#e2d2b2', LANE_HALF * 2, laneLen), LANE_X, HUB_EDGE + laneLen / 2, 0.033);
    const studs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 16), flat(GOLD, { emissive: 0x5a3c00 }), 60);
    let n = 0;
    for (let z = HUB_EDGE + 2; z < laneEnd - 1 && n < 60; z += 3) {
      this.dummy.position.set(LANE_X, 0.075, z);
      this.dummy.updateMatrix();
      studs.setMatrixAt(n++, this.dummy.matrix);
    }
    studs.count = n;
    studs.frustumCulled = false;
    this.group.add(studs);
    // The fountain's round plaza at the lane's end.
    const ring = new THREE.Mesh(new THREE.CircleGeometry(10, 64), edge);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(FOUNTAIN.x, 0.07, FOUNTAIN.z);
    const discTex = tileTexture('#eadcc0', 19, 19);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(9.5, 64), new THREE.MeshLambertMaterial({ map: discTex }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(FOUNTAIN.x, 0.075, FOUNTAIN.z);
    ring.receiveShadow = disc.receiveShadow = true;
    this.group.add(ring, disc);
    // The cannon's dais: a round step with a gold inlay.
    const dais = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.8, 0.1, 64), phong(0xd9cfbf, { shininess: 20 }));
    dais.position.y = 0.05;
    dais.receiveShadow = true;
    const inlay = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.06, 8, 64).rotateX(Math.PI / 2), flat(GOLD, { emissive: 0x5a3c00 }));
    inlay.position.y = 0.1;
    this.group.add(dais, inlay);
    // The gacha corner: a soft pink carpet under the row of machines, edged in gold.
    const first = machineAt(0);
    const last = machineAt(GACHA.length - 1);
    const len = first.z - last.z + 7;
    const midZ = (first.z + last.z) / 2;
    flatBox(10.6, len + 0.5, flat(GOLD, { emissive: 0x4a3200 }), MACHINE_X + 2.2, midZ, 0.04);
    flatBox(10, len, new THREE.MeshLambertMaterial({ color: 0xffb3d9 }), MACHINE_X + 2.2, midZ, 0.05);
  }

  // ---------------------------------------------------------------- the cauldron

  /** A witch's cauldron over a fire, bubbling with glowing brew, behind a purple step-on platform. */
  private buildCauldron(): void {
    const m = this.cauldron;
    m.position.set(CAULDRON.x, 0, CAULDRON.z);
    // Faces its platform.
    m.rotation.y = Math.atan2(CAULDRON_FRONT.x - CAULDRON.x, CAULDRON_FRONT.z - CAULDRON.z);
    const potMat = phong(0x6a35e0, { specular: 0xb9a0ff, side: THREE.DoubleSide });
    const gold = goldMat();
    const iron = phong(0x2b2440, { shininess: 40 });
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
      handle.position.set(side * 1.5, 2.75, 0);
      m.add(handle);
    }
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.5;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 1.3, 12), iron);
      leg.position.set(Math.cos(a) * 1.0, 0.55, Math.sin(a) * 1.0);
      leg.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), iron);
      foot.position.set(Math.cos(a) * 1.22, 0.06, Math.sin(a) * 1.22);
      m.add(leg, foot);
    }
    const logMat = phong(0x6b4226, { shininess: 8 });
    for (const turn of [0.3, -0.5, 1.4]) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.3, 10).rotateZ(Math.PI / 2), logMat);
      log.position.y = 0.16;
      log.rotation.y = turn;
      m.add(log);
    }
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
    const sign = makeSign();
    sign.draw('MERGE', 'Combine duplicates', '#b9ffd6', false);
    sign.sprite.position.y = 5.3;
    sign.sprite.scale.multiplyScalar(0.8);
    m.add(sign.sprite);
    this.group.add(m);
    // The step-on platform.
    const g = new THREE.Group();
    g.position.set(CAULDRON_FRONT.x, 0, CAULDRON_FRONT.z);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(PLATFORM_RADIUS + 0.15, PLATFORM_RADIUS + 0.3, 0.2, 40),
      phong(0xf1ebe0, { shininess: 20 }),
    );
    base.position.y = 0.1;
    base.receiveShadow = true;
    this.platformTop = new THREE.MeshLambertMaterial({ color: 0x8a5cff, emissive: 0x8a5cff, emissiveIntensity: 0.55 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(PLATFORM_RADIUS, PLATFORM_RADIUS, 0.08, 40), this.platformTop);
    disc.position.y = 0.22;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(PLATFORM_RADIUS + 0.02, 0.07, 8, 48).rotateX(Math.PI / 2), goldMat());
    rim.position.y = 0.26;
    this.platformRing = new THREE.Mesh(
      new THREE.TorusGeometry(PLATFORM_RADIUS * 0.85, 0.06, 6, 40).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    g.add(base, disc, rim, this.platformRing);
    this.group.add(g);
  }

  private animateCauldron(time: number, dt: number): void {
    for (const f of this.flames) {
      const seed = f.userData.seed as number;
      f.scale.set(1, 0.7 + Math.abs(Math.sin(time * 9 + seed)) * 0.6 + this.mergeT * 0.8, 1);
      f.rotation.y = time * 2 + seed;
    }
    this.mergeT = Math.max(0, this.mergeT - dt * 1.2);
    const boil = 1 + this.mergeT * 3;
    this.brew.emissiveIntensity = 0.7 + Math.sin(time * 3) * 0.15 + this.mergeT;
    // A merge makes the pot jump and squash, then wobble back (follow-through).
    const k = this.mergeT;
    const sq = 1 - Math.sin(k * Math.PI * 3) * 0.12 * k;
    this.cauldron.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    this.swirl.children.forEach((b, i) => {
      const p = (time * 0.6 * boil + (b.userData.seed as number)) % 1;
      const a = i * 1.05 + time * 0.8;
      b.position.set(Math.cos(a) * 0.7, p * 1.4 * boil, Math.sin(a) * 0.7);
      b.scale.setScalar(1 - p);
    });
    const t = (time * 0.9) % 1;
    this.platformRing.position.y = 0.2 + t * 1.3;
    this.platformRing.scale.setScalar(1 - t * 0.3);
    (this.platformRing.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t);
    this.platformTop.emissiveIntensity = 0.55 + Math.sin(time * 3) * 0.2;
  }

  // ---------------------------------------------------------------- the shop

  /** A market stall with a striped awning, a counter of goods, an UPGRADES sign and a keeper behind it. */
  private buildShop(): void {
    const g = new THREE.Group();
    g.position.set(SHOP.x, 0, SHOP.z);
    // Built facing +z, turned to face -x (toward the cannon and the lane).
    g.rotation.y = -Math.PI / 2;
    const w = SHOP.halfW * 2;
    const d = SHOP.halfD * 2;
    const wood = phong(0xb07a45, { shininess: 25 });
    const darkWood = phong(0x7a4e2a, { shininess: 15 });
    // Floor, back wall and side posts.
    const floor = new THREE.Mesh(new RoundedBoxGeometry(w, 0.2, d, 2, 0.08), darkWood);
    floor.position.y = 0.1;
    floor.receiveShadow = true;
    const back = new THREE.Mesh(new RoundedBoxGeometry(w, 3.2, 0.3, 2, 0.1), wood);
    back.position.set(0, 1.7, -d / 2 + 0.15);
    for (const side of [-1, 1]) {
      for (const z of [-d / 2 + 0.2, d / 2 - 0.35]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 3.6, 16), wood);
        post.position.set(side * (w / 2 - 0.2), 1.8, z);
        post.castShadow = true;
        g.add(post);
      }
    }
    // The counter across the front, painted in stripes, with a polished top.
    const counter = new THREE.Mesh(
      new RoundedBoxGeometry(w - 0.4, 1.15, 0.9, 3, 0.12),
      new THREE.MeshPhongMaterial({ map: stripeTexture('#e63946', '#fff6e8'), shininess: 30 }),
    );
    counter.position.set(0, 0.68, d / 2 - 0.6);
    const top = new THREE.Mesh(new RoundedBoxGeometry(w - 0.1, 0.14, 1.15, 2, 0.06), phong(0xf6e3c0, { shininess: 60 }));
    top.position.set(0, 1.3, d / 2 - 0.6);
    // A rounded, striped awning over everything.
    const awning = new THREE.Mesh(
      new THREE.CylinderGeometry(d / 2 + 0.5, d / 2 + 0.5, w + 0.6, 40, 1, true, 0, Math.PI).rotateZ(Math.PI / 2),
      new THREE.MeshPhongMaterial({ map: stripeTexture('#ff5fa2', '#ffffff'), side: THREE.DoubleSide, shininess: 30 }),
    );
    awning.scale.set(1, 0.42, 1);
    awning.position.set(0, 3.55, 0);
    // A scalloped trim along the front edge.
    for (let i = 0; i < 9; i++) {
      const bob = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 10), phong(i % 2 ? 0xffffff : 0xff5fa2));
      bob.scale.y = 0.6;
      bob.position.set(-w / 2 + 0.1 + (i * (w - 0.2)) / 8, 3.5, d / 2 + 0.45);
      g.add(bob);
    }
    g.add(floor, back, counter, top, awning);
    // Goods on the counter: a jar of gems, a little parachute, a magnet and a gold trophy.
    const jar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.32, 0.6, 24),
      new THREE.MeshPhongMaterial({ color: 0xcdefff, transparent: true, opacity: 0.35, shininess: 120, depthWrite: false }),
    );
    jar.position.set(-2, 1.67, d / 2 - 0.6);
    for (let i = 0; i < 6; i++) {
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.13), phong([0x3fc8ff, 0xff5fb4, 0xb57bff][i % 3], { emissive: 0x222222 }));
      gem.position.set(-2 + Math.cos(i * 2.1) * 0.15, 1.45 + i * 0.07, d / 2 - 0.6 + Math.sin(i * 2.1) * 0.15);
      g.add(gem);
    }
    const chute = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), phong(0xff4d6d));
    chute.scale.y = 0.6;
    chute.position.set(-0.8, 1.75, d / 2 - 0.55);
    const magnet = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.1, 12, 24, Math.PI), phong(0xe63946));
    magnet.rotation.z = Math.PI;
    magnet.position.set(0.5, 1.68, d / 2 - 0.55);
    const trophy = new THREE.Group();
    const cup = new THREE.Mesh(new THREE.LatheGeometry([[0.02, 0], [0.18, 0.02], [0.06, 0.12], [0.06, 0.3], [0.3, 0.45], [0.32, 0.75]].map(([r, y]) => new THREE.Vector2(r, y)), 24), goldMat());
    trophy.add(cup);
    trophy.position.set(1.9, 1.37, d / 2 - 0.6);
    g.add(jar, chute, magnet, trophy);
    // Shelves on the back wall with a row of tiny cannons' barrels.
    const shelf = new THREE.Mesh(new RoundedBoxGeometry(w - 1, 0.12, 0.5, 2, 0.04), darkWood);
    shelf.position.set(0, 2.4, -d / 2 + 0.5);
    g.add(shelf);
    for (let i = 0; i < 5; i++) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.55, 16), phong(0x3d4450, { shininess: 90 }));
      barrel.position.set(-2 + i, 2.75, -d / 2 + 0.5);
      barrel.rotation.z = 0.5;
      g.add(barrel);
    }
    // The keeper: a cheerful shopkeeper with an apron and a moustache, behind the counter.
    this.keeper = makePlayer({ skin: 0xf2d0a8, shirt: 0xffffff, pants: 0x3d2a6b, cap: 0x2f8cff });
    const apron = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.75, 0.06, 2, 0.03), phong(0xe63946));
    apron.position.set(0, -0.05, -0.23);
    const tache = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.08, 0.06, 2, 0.03), phong(0x5c3a20));
    tache.position.set(0, 0.58, -0.32);
    this.keeper.body.add(apron, tache);
    this.keeper.group.position.set(0, 0.2, -0.4);
    // Faces the counter (the rig faces -z; the stall's front is +z).
    this.keeper.group.rotation.y = Math.PI;
    this.keeper.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    g.add(this.keeper.group);
    const sign = makeSign();
    sign.draw('UPGRADES', 'Cannon · Gems · Slots', '#ffd84a', false);
    sign.sprite.position.set(0, 5.1, 0.5);
    sign.sprite.scale.multiplyScalar(0.95);
    g.add(sign.sprite);
    g.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.castShadow) o.castShadow = true;
    });
    this.group.add(g);
    // A round rug in front of the counter where customers stand.
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1.4, 40).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xffd23f }));
    rug.position.set(SHOP_FRONT.x, 0.08, SHOP_FRONT.z);
    const rugRim = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.6, 40).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xe63946 }));
    rugRim.position.set(SHOP_FRONT.x, 0.08, SHOP_FRONT.z);
    rug.receiveShadow = true;
    this.group.add(rug, rugRim);
  }

  /** The keeper bobs and looks about; when a customer comes close they turn to them, and they wave on arrival. */
  private animateKeeper(time: number, dt: number, px: number, pz: number): void {
    const { body, arms, group } = this.keeper;
    const near = Math.hypot(px - SHOP_FRONT.x, pz - SHOP_FRONT.z) < 7;
    body.position.y = 0.9 + Math.abs(Math.sin(time * 2.1)) * 0.04;
    // Head and shoulders turn toward the customer (in the stall's frame the counter is at +z).
    // The keeper faces -x; turning by θ swings their front toward (-cos θ, sin θ).
    const want = near ? Math.atan2(pz - SHOP.z, -(px - SHOP.x)) * 0.8 : Math.sin(time * 0.4) * 0.5;
    body.rotation.y += (Math.max(-0.7, Math.min(0.7, want)) - body.rotation.y) * Math.min(1, dt * 4);
    this.keeperWave = Math.max(0, this.keeperWave - dt);
    const waving = this.keeperWave > 0;
    // The right arm waves (up, then side to side); the left rests on the counter.
    const right = arms[1];
    const left = arms[0];
    const up = waving ? 2.6 + Math.sin(time * 14) * 0.35 : 0.3 + Math.sin(time * 1.3) * 0.05;
    right.rotation.z += (up - right.rotation.z) * Math.min(1, dt * 10);
    left.rotation.z += (-0.25 - left.rotation.z) * Math.min(1, dt * 6);
    left.rotation.x += (-0.9 - left.rotation.x) * Math.min(1, dt * 6);
    group.position.y = 0.2;
  }

  // ---------------------------------------------------------------- gacha machines

  private buildMachine(tier: GachaTier, i: number): void {
    const at = machineAt(i);
    const group = new THREE.Group();
    group.position.set(at.x, 0, at.z);
    // Built facing +z; turned to face +x, toward the lane's mouth.
    group.rotation.y = Math.PI / 2;
    const body = new THREE.Group();
    group.add(body);
    const builders = [
      basicMachine,
      luckyMachine,
      superMachine,
      ultraMachine,
      (b: THREE.Group) => cosmicMachine(b, COSMIC),
      (b: THREE.Group) => cosmicMachine(b, GALAXY),
    ];
    const { model, height, exitY } = builders[Math.min(i, builders.length - 1)](body);
    body.traverse((o) => {
      if (o instanceof THREE.Mesh && !(o.material instanceof THREE.MeshBasicMaterial) && !(o.material as THREE.Material).transparent) {
        o.castShadow = true;
      }
    });
    const tints: Machine['tints'] = [];
    const seen = new Set<THREE.Material>();
    body.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const mat = o.material as THREE.Material;
      if (seen.has(mat)) return;
      seen.add(mat);
      if (mat instanceof THREE.MeshPhongMaterial || mat instanceof THREE.MeshLambertMaterial) {
        tints.push({ mat, color: mat.color.clone(), emissive: mat.emissive.clone() });
      }
    });
    // A plinth so every machine stands on something.
    const plinth = new THREE.Mesh(new RoundedBoxGeometry(3.4, 0.24, 3.4, 2, 0.1), phong(0xf1ebe0, { shininess: 20 }));
    plinth.position.y = 0.12;
    plinth.receiveShadow = true;
    group.add(plinth);
    const lock = makePadlock();
    lock.position.set(0, height * 0.45, 1.75);
    group.add(lock);
    const sign = makeSign();
    sign.sprite.position.y = height + 1.2;
    sign.sprite.scale.multiplyScalar(0.82);
    group.add(sign.sprite);
    // The odds, on a little board beside the machine.
    const odds = makeOddsBoard(tier);
    odds.position.set(-2.45, 2.3, 0.6);
    group.add(odds);
    this.group.add(group);
    const color = new THREE.Color(tier.color).getHex();
    const pads: [PullPadView, PullPadView] = [this.buildPullPad(pullPad(i, false), false, color), this.buildPullPad(pullPad(i, true), true, color)];
    const exit = new THREE.Vector3(at.x + 1.5, exitY, at.z);
    const prize = makePrize();
    this.group.add(prize.group);
    this.machines.push({
      tier,
      index: i,
      group,
      body,
      model,
      tints,
      lock,
      sign,
      signKey: '',
      pads,
      locked: null,
      spinT: -1,
      spinDur: 0,
      unlockT: -1,
      exit,
      prize,
      prizeColor: 0xffffff,
      prizeGlow: false,
      prizeAt: exit.clone(),
    });
  }

  /** A round pad in front of a machine with ×1 or ×10 painted on it, a gold rim and a rising ring of light. */
  private buildPullPad(at: { x: number; z: number }, ten: boolean, color: number): PullPadView {
    const g = new THREE.Group();
    g.position.set(at.x, 0, at.z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(PAD_RADIUS + 0.12, PAD_RADIUS + 0.25, 0.2, 40), phong(0xf1ebe0, { shininess: 20 }));
    base.position.y = 0.1;
    base.receiveShadow = true;
    const top = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.4 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(PAD_RADIUS, PAD_RADIUS, 0.06, 40), top);
    disc.position.y = 0.21;
    const text = new THREE.Mesh(
      new THREE.CircleGeometry(PAD_RADIUS * 0.95, 32).rotateX(-Math.PI / 2).rotateY(Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: padTextTexture(ten ? '×10' : '×1'), transparent: true, depthWrite: false }),
    );
    text.position.y = 0.25;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(PAD_RADIUS + 0.02, 0.06, 8, 48).rotateX(Math.PI / 2), goldMat());
    rim.position.y = 0.25;
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(PAD_RADIUS * 0.85, 0.05, 6, 40).rotateX(Math.PI / 2), ringMat);
    g.add(base, disc, text, rim, ring);
    this.group.add(g);
    return { group: g, top, color, ring, ringMat, seed: Math.random(), lit: 0 };
  }

  private updateMachine(m: Machine, time: number, dt: number, best: number, gems: number, px: number, pz: number): void {
    const tier = m.tier;
    const locked = best < tier.unlockBest;
    if (m.locked !== locked) {
      // Unlocking in play: the padlock shakes, then bursts off. On first build, just set the state.
      if (m.locked === true && !locked) {
        m.unlockT = 0;
        this.onUnlock(m.index);
      } else {
        m.lock.visible = locked;
      }
      m.locked = locked;
      for (const pad of m.pads) pad.top.color.setHex(locked ? 0x8a8f99 : pad.color);
      for (const pad of m.pads) pad.top.emissive.setHex(locked ? 0x000000 : pad.color);
      for (const t of m.tints) {
        if (locked) {
          const grey = (t.color.r + t.color.g + t.color.b) / 3;
          t.mat.color.setRGB(grey * 0.55 + 0.12, grey * 0.55 + 0.12, grey * 0.6 + 0.14);
          t.mat.emissive.setRGB(0, 0, 0);
        } else {
          t.mat.color.copy(t.color);
          t.mat.emissive.copy(t.emissive);
        }
      }
    }
    // The sign: name and price, or what unlocks it and how close the player's best flight is.
    const key = locked ? `L${Math.floor(best)}` : `U${gems >= tier.cost ? 1 : 0}${gems >= tier.cost * 10 ? 1 : 0}`;
    if (key !== m.signKey) {
      m.signKey = key;
      const color = tier.color;
      if (locked) {
        m.sign.draw(`🔒 ${tier.short}`, `Unlocks at ${tier.unlockBest} m · best ${Math.floor(best)} m`, color, true, Math.min(1, best / tier.unlockBest));
      } else {
        m.sign.draw(tier.short, `${formatCoins(tier.cost)} gems a pull`, color, false);
      }
    }
    // The padlock bobs on its chain, and on unlock shakes (anticipation), then flies up spinning and shrinks.
    if (m.unlockT >= 0) {
      m.unlockT += dt;
      const t = m.unlockT;
      if (t < 0.45) {
        m.lock.rotation.z = Math.sin(t * 60) * 0.25 * (t / 0.45);
      } else {
        const k = clamp01((t - 0.45) / 0.55);
        m.lock.position.y += dt * 9 * (1 - k);
        m.lock.rotation.y += dt * 20;
        m.lock.scale.setScalar(1 + k * 0.6 - k * k * 1.6);
        if (k >= 1) {
          m.lock.visible = false;
          m.unlockT = -1;
          m.lock.scale.setScalar(1);
        }
      }
    } else if (locked) {
      m.lock.rotation.z = Math.sin(time * 1.6 + m.index) * 0.08;
    }
    // Pull animation: squat (anticipation), spin with a stretch, then settle with an overshoot.
    let sx = 1;
    let sy = 1;
    let shake = 0;
    if (m.spinT >= 0) {
      m.spinT += dt;
      if (m.spinDur < 0) {
        // Refused: a quick side-to-side "no".
        const p = m.spinT / -m.spinDur;
        shake = Math.sin(p * Math.PI * 4) * 0.08 * (1 - p);
        if (p >= 1) m.spinT = -1;
      } else {
        const p = clamp01(m.spinT / m.spinDur);
        if (p < 0.12) {
          const a = easeInOut(p / 0.12);
          sy = 1 - 0.12 * a;
          sx = 1 + 0.06 * a;
        } else if (p < 0.82) {
          const a = (p - 0.12) / 0.7;
          sy = 1 + 0.05 * Math.sin(a * Math.PI);
          sx = 1 - 0.025 * Math.sin(a * Math.PI);
          shake = Math.sin(time * 55) * 0.025 * Math.sin(a * Math.PI);
        } else {
          const a = (p - 0.82) / 0.18;
          // Pop up past rest and settle back.
          sy = 1 + 0.12 * Math.sin(a * Math.PI) * (1 - a * 0.5);
          sx = 1 - 0.05 * Math.sin(a * Math.PI);
        }
        m.model.spin(time, p, Math.sin(p * Math.PI));
        // The capsule shoots out as the machine pops up at the end of its spin.
        const before = (m.spinT - dt) / m.spinDur;
        if (before < SPIT_AT && p >= SPIT_AT) this.spit(m);
        if (p >= 1) m.spinT = -1;
      }
    }
    if (m.spinT < 0) m.model.idle(time);
    if (m.prize.group.visible) this.updatePrize(m, time, dt);
    m.body.scale.set(sx, sy, sx);
    m.body.rotation.z = shake;
    // Pads: brighter when the player stands on one, and when it can be afforded.
    m.pads.forEach((pad, k) => {
      const at = pad.group.position;
      const on = Math.hypot(px - at.x, pz - at.z) < PAD_RADIUS;
      pad.lit += ((on ? 1 : 0) - pad.lit) * Math.min(1, dt * 8);
      const affordable = !locked && gems >= tier.cost * (k === 1 ? 10 : 1);
      const t = (time * 0.9 + pad.seed) % 1;
      pad.ring.visible = !locked;
      pad.ring.position.y = 0.2 + t * (1.1 + pad.lit);
      pad.ring.scale.setScalar(1 - t * 0.3 + pad.lit * 0.2);
      pad.ringMat.opacity = (affordable ? 0.85 : 0.3) * (1 - t);
      pad.top.emissiveIntensity = locked ? 0 : (affordable ? 0.45 : 0.15) + pad.lit * 0.6 + Math.sin(time * 3 + pad.seed * 6) * 0.1;
      pad.group.scale.setScalar(1 + pad.lit * 0.06);
    });
  }

  /** Out of the chute: a hop toward the pads, between them, with a little spin. */
  private spit(m: Machine): void {
    const pz = m.prize;
    pz.top.color.setHex(m.prizeColor);
    pz.top.emissive.setHex(m.prizeColor);
    pz.top.emissiveIntensity = m.prizeGlow ? 0.7 : 0.15;
    pz.group.scale.setScalar(pz.radius / 0.34);
    pz.pos.copy(m.exit);
    pz.vel.set(1.6 + Math.random() * 0.3, 3.8, (Math.random() - 0.5) * 0.4);
    pz.t = 0;
    pz.life = PRIZE_LIFE;
    pz.squash = 0;
    pz.group.visible = true;
    pz.group.position.copy(pz.pos);
  }

  /**
   * The capsule's short life: falling with gravity, bouncing with a squash (each lower than the last), rolling
   * to a stop, then a wobble that swells (anticipation) just before it pops.
   */
  private updatePrize(m: Machine, time: number, dt: number): void {
    const pz = m.prize;
    pz.t += dt;
    const r = pz.radius;
    const wobbleFrom = pz.life - 0.32;
    if (pz.t < wobbleFrom) {
      pz.vel.y -= 22 * dt;
      pz.pos.addScaledVector(pz.vel, dt);
      const floor = floorWorld(pz.pos.x, pz.pos.z);
      if (pz.pos.y - r < floor) {
        pz.pos.y = floor + r;
        if (pz.vel.y < -1.6) {
          const strength = Math.min(1, -pz.vel.y / 8);
          pz.vel.y = -pz.vel.y * 0.42;
          pz.squash = strength;
          this.onBounce(pz.pos, strength);
        } else {
          pz.vel.y = 0;
        }
        // Rolling friction.
        const k = Math.exp(-2.6 * dt);
        pz.vel.x *= k;
        pz.vel.z *= k;
      }
      // Rolls as it goes.
      pz.group.rotation.z -= (pz.vel.x * dt) / r;
      pz.group.rotation.x += (pz.vel.z * dt) / r;
    } else {
      const w = (pz.t - wobbleFrom) / 0.32;
      pz.group.rotation.z = Math.sin(time * 48) * 0.3 * w;
      pz.group.rotation.x *= 0.8;
      pz.squash = Math.max(pz.squash, w * 0.25);
    }
    pz.squash = Math.max(0, pz.squash - dt * 5);
    const swell = pz.t > wobbleFrom ? 1 + ((pz.t - wobbleFrom) / 0.32) * 0.25 : 1;
    const s = pz.radius / 0.34;
    pz.group.scale.set(s * swell * (1 + pz.squash * 0.25), s * swell * (1 - pz.squash * 0.35), s * swell * (1 + pz.squash * 0.25));
    pz.group.position.set(pz.pos.x, pz.pos.y - pz.squash * r * 0.35, pz.pos.z);
    m.prizeAt.copy(pz.pos);
    if (pz.t >= pz.life) pz.group.visible = false;
  }

  // ---------------------------------------------------------------- the fountain

  /** A smooth, three-tier fountain with arcs of water falling from each bowl into the one below. */
  private buildFountain(): void {
    const g = new THREE.Group();
    g.position.set(FOUNTAIN.x, 0, FOUNTAIN.z);
    const stone = phong(0xf3ecdf, { shininess: 35 });
    const trim = goldMat();
    const water = new THREE.MeshPhongMaterial({ color: 0x5ec4ff, emissive: 0x0e4a7a, shininess: 140, specular: 0xffffff, transparent: true, opacity: 0.85 });
    // Basin, turned on a lathe: a rolled lip, a sloped wall and a floor.
    const basin = new THREE.Mesh(
      new THREE.LatheGeometry(
        [[0, 0.1], [3.9, 0.1], [4.2, 0.2], [4.4, 0.6], [4.45, 0.85], [4.3, 0.95], [4.05, 0.85], [3.9, 0.3]].map(([r, y]) => new THREE.Vector2(r, y)),
        64,
      ),
      stone,
    );
    const pool = new THREE.Mesh(new THREE.CircleGeometry(3.95, 64).rotateX(-Math.PI / 2), water);
    pool.position.y = 0.6;
    // Column with two bowls.
    const column = new THREE.Mesh(
      new THREE.LatheGeometry(
        [[0.7, 0], [0.55, 0.3], [0.38, 0.8], [0.34, 1.8], [0.42, 2.2], [0.3, 2.6], [0.26, 3.6], [0.32, 3.9]].map(([r, y]) => new THREE.Vector2(r, y)),
        40,
      ),
      stone,
    );
    const bowl = (r: number, y: number) => {
      const mesh = new THREE.Mesh(
        new THREE.LatheGeometry(
          [[0.2, -0.45], [r * 0.5, -0.4], [r * 0.9, -0.15], [r, 0.05], [r * 0.96, 0.12], [r * 0.85, 0.02]].map(([a, b]) => new THREE.Vector2(a, b)),
          48,
        ),
        stone,
      );
      mesh.position.y = y;
      const surface = new THREE.Mesh(new THREE.CircleGeometry(r * 0.86, 48).rotateX(-Math.PI / 2), water);
      surface.position.y = y + 0.02;
      const band = new THREE.Mesh(new THREE.TorusGeometry(r * 0.98, 0.05, 8, 48).rotateX(Math.PI / 2), trim);
      band.position.y = y + 0.08;
      g.add(mesh, surface, band);
      this.fountainWater.push(surface);
    };
    bowl(2.2, 2.2);
    bowl(1.15, 3.85);
    // A golden gem on top, turning.
    const crown = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), phong(GOLD, { emissive: 0x5a3c00, shininess: 120, specular: 0xffffff }));
    crown.position.y = 4.75;
    crown.name = 'crown';
    g.add(basin, pool, column, crown);
    this.fountainWater.push(pool);
    g.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material === stone) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    // Water drops, instanced: arcs over each bowl's rim and a plume from the top.
    const count = 150;
    this.drops = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xcff0ff, transparent: true, opacity: 0.9 }),
      count,
    );
    for (let i = 0; i < count; i++) this.dropSeeds.push(Math.random());
    this.drops.position.copy(g.position);
    this.drops.frustumCulled = false;
    this.group.add(g, this.drops);
  }

  private animateFountain(time: number): void {
    const n = this.dropSeeds.length;
    for (let i = 0; i < n; i++) {
      const seed = this.dropSeeds[i];
      const a = seed * Math.PI * 2 + i * 0.37;
      const jet = i % 3;
      // Three streams: from the top bowl's rim, from the middle bowl's rim, and a plume from the crown.
      const [r0, y0, out, up, life] =
        jet === 0 ? [1.1, 3.9, 0.8, 0.6, 0.6] : jet === 1 ? [2.15, 2.25, 1.6, 0.4, 0.75] : [0.1, 5.1, 0.9, 2.6, 1.1];
      const t = ((time / life + seed) % 1) * life;
      const r = r0 + out * t;
      const y = y0 + up * t - 4.9 * t * t;
      this.dummy.position.set(Math.cos(a) * r, Math.max(0.6, y), Math.sin(a) * r);
      this.dummy.scale.setScalar(y < 0.62 ? 0.01 : 1 - (t / life) * 0.4);
      this.dummy.updateMatrix();
      this.drops.setMatrixAt(i, this.dummy.matrix);
    }
    this.drops.instanceMatrix.needsUpdate = true;
    this.fountainWater.forEach((w, i) => w.scale.setScalar(1 + Math.sin(time * 2.4 + i) * 0.012));
    const crown = this.group.getObjectByName('crown');
    if (crown) {
      crown.rotation.y = time * 0.9;
      crown.position.y = 4.75 + Math.sin(time * 1.7) * 0.08;
    }
  }
}

/** A pull's capsule shoots out at this share of the machine's spin (as it pops up), and pops this long after. */
const SPIT_AT = 0.82;
const PRIZE_LIFE = 1.05;

/** A gacha capsule: a coloured top, a white bottom and a dark seam, shiny. */
function makePrize(): Prize {
  const group = new THREE.Group();
  const radius = 0.34;
  const top = new THREE.MeshPhongMaterial({ color: 0xff5f7e, emissive: 0xff5f7e, emissiveIntensity: 0.15, shininess: 120, specular: 0xffffff });
  const upper = new THREE.Mesh(new THREE.SphereGeometry(radius, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), top);
  const lower = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 28, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 120, specular: 0xffffff }),
  );
  const seam = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.035, 8, 32).rotateX(Math.PI / 2), new THREE.MeshPhongMaterial({ color: 0x1d1640 }));
  upper.castShadow = lower.castShadow = true;
  group.add(upper, lower, seam);
  group.visible = false;
  return { group, top, radius, pos: new THREE.Vector3(), vel: new THREE.Vector3(), t: 0, life: PRIZE_LIFE, squash: 0 };
}

// ---------------------------------------------------------------- machine models (built facing +z)

/** A gold padlock with a shackle, hung in front of a locked machine. */
function makePadlock(): THREE.Group {
  const g = new THREE.Group();
  const gold = phong(0xffc21a, { emissive: 0x5a3c00, shininess: 110, specular: 0xffffff });
  const body = new THREE.Mesh(new RoundedBoxGeometry(1.1, 0.9, 0.4, 3, 0.15), gold);
  const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.09, 12, 32, Math.PI), chrome());
  shackle.position.y = 0.45;
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), new THREE.MeshBasicMaterial({ color: 0x1d1640 }));
  hole.position.set(0, -0.05, 0.21);
  const slot = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.22), new THREE.MeshBasicMaterial({ color: 0x1d1640 }));
  slot.position.set(0, -0.2, 0.21);
  g.add(body, shackle, hole, slot);
  // Two chains crossing the machine's front.
  const link = new THREE.TorusGeometry(0.13, 0.04, 6, 12);
  const linkMat = chrome();
  for (const dir of [-1, 1]) {
    for (let k = 1; k < 9; k++) {
      const l = new THREE.Mesh(link, linkMat);
      l.position.set(dir * k * 0.24, k * 0.2, -0.15 - k * 0.03);
      l.rotation.set(0, k % 2 ? Math.PI / 2 : 0, dir * 0.7);
      g.add(l);
    }
  }
  return g;
}

interface Built {
  model: Model;
  height: number;
  exitY: number;
}

/** BASIC: the classic red capsule machine with a glass globe and a crank. */
function basicMachine(body: THREE.Group): Built {
  const red = phong(0xe63946, { specular: 0xffb0b8, shininess: 80 });
  const gold = goldMat();
  const base = new THREE.Mesh(new RoundedBoxGeometry(2.4, 1.9, 2.4, 4, 0.22), red);
  base.position.y = 1.2;
  const trim = new THREE.Mesh(new RoundedBoxGeometry(2.55, 0.2, 2.55, 3, 0.08), gold);
  trim.position.y = 2.2;
  const chute = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.7, 0.3, 2, 0.08), phong(0x2b2b33));
  chute.position.set(0, 0.75, 1.15);
  const crank = new THREE.Group();
  crank.position.set(0, 1.6, 1.22);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 32).rotateX(Math.PI / 2), gold);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.7, 0.14), flat(0xffffff));
  handle.position.set(0.25, 0, 0.12);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), red);
  knob.position.set(0.25, 0.35, 0.12);
  crank.add(disc, handle, knob);
  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(1.35, 40, 28),
    new THREE.MeshPhongMaterial({ color: 0xcdefff, transparent: true, opacity: 0.28, depthWrite: false, shininess: 120, specular: 0xffffff }),
  );
  globe.position.y = 3.45;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 0.4, 40), red);
  lid.position.y = 4.85;
  const topper = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 16), gold);
  topper.position.y = 5.2;
  body.add(base, trim, chute, crank, lid, topper);
  const capsules = addCapsules(body, 14, 3.0, 0.95, 0.3);
  body.add(globe);
  return {
    height: 5.4,
    exitY: 0.9,
    model: {
      idle(time) {
        crank.rotation.z = 0;
        capsules.forEach((c, i) => c.position.copy(c.userData.home).setY(c.userData.home.y + Math.sin(time * 1.5 + i) * 0.03));
      },
      spin(time, p, k) {
        crank.rotation.z = -easeInOut(Math.min(1, p / 0.85)) * Math.PI * 4;
        capsules.forEach((c, i) => c.position.copy(c.userData.home).setY(c.userData.home.y + Math.abs(Math.sin(time * 18 + i)) * 0.5 * k));
      },
    },
  };
}

/** LUCKY: a mint machine with a tall glass dome of swirling capsules, a gold horseshoe and a four-leaf clover. */
function luckyMachine(body: THREE.Group): Built {
  const mint = phong(0x3ccf8e, { specular: 0xc8ffe4, shininess: 90 });
  const cream = phong(0xfff6e0, { shininess: 50 });
  const gold = goldMat();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 1.9, 48), mint);
  base.position.y = 1.2;
  const band = new THREE.Mesh(new THREE.TorusGeometry(1.32, 0.1, 12, 48).rotateX(Math.PI / 2), gold);
  band.position.y = 2.15;
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.42, 0.3, 48), cream);
  stripe.position.y = 1.1;
  const chute = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.6, 0.3, 2, 0.08), phong(0x1d4a36));
  chute.position.set(0, 0.8, 1.38);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.25, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.62),
    new THREE.MeshPhongMaterial({ color: 0xd8fff0, transparent: true, opacity: 0.25, depthWrite: false, shininess: 140, specular: 0xffffff }),
  );
  dome.scale.y = 1.6;
  dome.position.y = 2.2;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.75, 0.3, 40), mint);
  cap.position.y = 4.15;
  // The horseshoe, open side up.
  const shoe = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.11, 12, 32, Math.PI * 1.4), gold);
  shoe.rotation.z = -Math.PI * 0.2 - Math.PI;
  shoe.position.y = 4.85;
  // The clover on the front.
  const clover = new THREE.Group();
  const leaf = phong(0x1fa85a, { shininess: 60 });
  for (let k = 0; k < 4; k++) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), leaf);
    l.scale.z = 0.4;
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    l.position.set(Math.cos(a) * 0.18, Math.sin(a) * 0.18, 0);
    clover.add(l);
  }
  clover.position.set(0, 1.65, 1.5);
  body.add(base, band, stripe, chute, cap, shoe, clover);
  const capsules = addCapsules(body, 12, 2.55, 0.8, 0.26);
  body.add(dome);
  return {
    height: 5.2,
    exitY: 0.9,
    model: {
      idle(time) {
        clover.rotation.z = Math.sin(time * 1.2) * 0.15;
        capsules.forEach((c, i) => c.position.copy(c.userData.home).setY(c.userData.home.y + Math.sin(time * 1.5 + i) * 0.03));
      },
      spin(time, p, k) {
        clover.rotation.z = easeInOut(p) * Math.PI * 4;
        // The capsules whirl round the dome like a tornado.
        capsules.forEach((c, i) => {
          const home = c.userData.home as THREE.Vector3;
          const a = Math.atan2(home.z, home.x) + time * 12 * k;
          const r = Math.hypot(home.x, home.z) * (1 + 0.3 * k);
          c.position.set(Math.cos(a) * r, home.y + Math.abs(Math.sin(time * 10 + i)) * 0.6 * k, Math.sin(a) * r);
        });
      },
    },
  };
}

/** SUPER: a blue-and-gold slot machine with three reels, a marquee of bulbs and a lever. */
function superMachine(body: THREE.Group): Built {
  const blue = phong(0x2f6bff, { specular: 0xb8ceff, shininess: 90 });
  const { reels, lever, bulbs, height } = slotCabinet(body, {
    body: blue,
    accent: goldMat(),
    width: 2.5,
    height: 3.2,
    topper: (y) => {
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), goldMat());
      star.position.y = y + 0.6;
      star.scale.set(1, 1.2, 0.5);
      return star;
    },
  });
  return {
    height: height + 1,
    exitY: 0.8,
    model: slotModel(reels, lever, bulbs),
  };
}

/** ULTRA: a tall purple-and-chrome slot machine with an arched crown, chasing bulbs and bigger reels. */
function ultraMachine(body: THREE.Group): Built {
  const purple = phong(0x8a2be2, { specular: 0xe0c0ff, shininess: 100 });
  const { reels, lever, bulbs, height } = slotCabinet(body, {
    body: purple,
    accent: chrome(),
    width: 2.8,
    height: 3.8,
    topper: (y) => {
      const g = new THREE.Group();
      // A solid arched marquee in the cabinet's purple, edged in chrome.
      const arch = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 1.6, 48, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2), purple);
      arch.position.y = y - 0.05;
      const edge = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.09, 12, 48, Math.PI), chrome());
      edge.position.set(0, y - 0.05, 0.82);
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), phong(0xff3b3b, { emissive: 0x880000, shininess: 120 }));
      star.position.set(0, y + 0.55, 0.85);
      g.add(edge, star);
      const crown = new THREE.Group();
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.35, 32), goldMat());
      crown.add(band);
      for (let k = 0; k < 5; k++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.35, 12), goldMat());
        const a = (k / 5) * Math.PI * 2;
        spike.position.set(Math.cos(a) * 0.42, 0.33, Math.sin(a) * 0.42);
        const jewel = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), phong(0xff3b3b, { emissive: 0x880000 }));
        jewel.position.set(Math.cos(a) * 0.48, 0, Math.sin(a) * 0.48);
        crown.add(spike, jewel);
      }
      crown.position.y = y + 1.45;
      g.add(arch, crown);
      return g;
    },
  });
  return {
    height: height + 1.9,
    exitY: 0.8,
    model: slotModel(reels, lever, bulbs),
  };
}

/** COSMIC: a black-and-gold pedestal under a glowing orb held in two turning gimbal rings, with stars in orbit. */
/** Colours for the orb machines: Cosmic in black and gold, Galaxy in white and rose gold with a rainbow orb. */
interface OrbPalette {
  body: number;
  trim: number;
  orb: number;
  glow: number;
  halo: number;
  /** The orb cycles through the rainbow. */
  rainbow: boolean;
}
const COSMIC: OrbPalette = { body: 0x1d1640, trim: GOLD, orb: 0xff7af0, glow: 0x9a2bff, halo: 0xd17aff, rainbow: false };
const GALAXY: OrbPalette = { body: 0xf6f2ff, trim: 0xffa3c8, orb: 0x9ff3ff, glow: 0x3a7bff, halo: 0x9fd8ff, rainbow: true };

function cosmicMachine(body: THREE.Group, palette: OrbPalette): Built {
  const black = phong(palette.body, { specular: 0x8a7cff, shininess: 120 });
  const gold = phong(palette.trim, { emissive: 0x2a1a00, shininess: 110, specular: 0xffffff });
  const pedestal = new THREE.Mesh(
    new THREE.LatheGeometry(
      [[0.01, 0.2], [1.4, 0.2], [1.45, 0.45], [1.0, 0.7], [0.75, 1.4], [0.8, 2.0], [1.15, 2.3], [1.2, 2.45], [0.01, 2.45]].map(([r, y]) => new THREE.Vector2(r, y)),
      48,
    ),
    black,
  );
  const bands = [0.45, 2.3].map((y) => {
    const b = new THREE.Mesh(new THREE.TorusGeometry(y < 1 ? 1.45 : 1.2, 0.07, 10, 48).rotateX(Math.PI / 2), gold);
    b.position.y = y;
    return b;
  });
  const chute = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.5, 0.3, 2, 0.08), gold);
  chute.position.set(0, 1.0, 0.85);
  const orbMat = new THREE.MeshPhongMaterial({ color: palette.orb, emissive: palette.glow, emissiveIntensity: 0.9, shininess: 140, specular: 0xffffff });
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.75, 40, 28), orbMat);
  orb.position.y = 3.6;
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: softTexture(), color: palette.halo, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  halo.scale.setScalar(3.6);
  halo.position.y = 3.6;
  const ringA = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.07, 12, 64), gold);
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.06, 12, 64), gold);
  const gimbal = new THREE.Group();
  gimbal.position.y = 3.6;
  gimbal.add(ringA);
  ringA.add(ringB);
  // Little stars in orbit.
  const stars: THREE.Mesh[] = [];
  for (let k = 0; k < 6; k++) {
    const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), new THREE.MeshBasicMaterial({ color: k % 2 ? 0xffffff : 0xffe066 }));
    s.userData.seed = k;
    stars.push(s);
    body.add(s);
  }
  // Three gold arms holding the rings.
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.2, 10), gold);
    arm.position.set(Math.cos(a) * 1.0, 2.85, Math.sin(a) * 1.0);
    arm.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
    body.add(arm);
  }
  body.add(pedestal, ...bands, chute, orb, halo, gimbal);
  let spinA = 0;
  let spinB = 0;
  return {
    height: 5.2,
    exitY: 1.0,
    model: {
      idle(time) {
        spinA += 0.01;
        spinB += 0.016;
        ringA.rotation.set(spinA, time * 0.4, 0);
        ringB.rotation.set(0, spinB, Math.PI / 2);
        orb.position.y = 3.6 + Math.sin(time * 1.6) * 0.1;
        orbMat.emissiveIntensity = 0.8 + Math.sin(time * 2.2) * 0.15;
        if (palette.rainbow) orbMat.emissive.setHSL((time * 0.15) % 1, 0.9, 0.45);
        halo.scale.setScalar(3.4 + Math.sin(time * 2.2) * 0.2);
        stars.forEach((s) => {
          const a = time * 0.8 + (s.userData.seed as number) * 1.05;
          s.position.set(Math.cos(a) * 1.7, 3.6 + Math.sin(a * 2) * 0.5, Math.sin(a) * 1.7);
          s.rotation.y = time * 3;
        });
      },
      spin(time, p, k) {
        // The orb dips (anticipation), then rises and blazes while the rings whirl; stars race round.
        spinA += 0.02 + k * 0.5;
        spinB += 0.03 + k * 0.7;
        ringA.rotation.set(spinA, time * 0.4, 0);
        ringB.rotation.set(0, spinB, Math.PI / 2);
        const dip = p < 0.12 ? -Math.sin((p / 0.12) * Math.PI) * 0.35 : 0;
        orb.position.y = 3.6 + dip + k * 0.5;
        orbMat.emissiveIntensity = 0.9 + k * 2;
        if (palette.rainbow) orbMat.emissive.setHSL((time * 0.6) % 1, 0.9, 0.45);
        halo.scale.setScalar(3.6 + k * 3);
        stars.forEach((s) => {
          const a = time * (0.8 + k * 8) + (s.userData.seed as number) * 1.05;
          s.position.set(Math.cos(a) * (1.7 + k), 3.6 + Math.sin(a * 2) * 0.5 * k, Math.sin(a) * (1.7 + k));
        });
      },
    },
  };
}

/** Capsules sitting in a globe: rarity colours, each remembering its home position. */
function addCapsules(body: THREE.Group, count: number, y0: number, spread: number, size: number): THREE.Mesh[] {
  const geo = new THREE.SphereGeometry(size, 20, 14);
  const colors = RARITIES.slice(0, 6).map((r) => r.color);
  const out: THREE.Mesh[] = [];
  for (let i = 0; i < count; i++) {
    const color = colors[i % colors.length];
    const mat = new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.25, shininess: 100, specular: 0xffffff });
    const capsule = new THREE.Mesh(geo, mat);
    const a = i * 2.4;
    const r = 0.2 + (i % 3) * spread * 0.33;
    capsule.position.set(Math.cos(a) * r, y0 + Math.floor(i / 5) * size * 1.4 + (i % 2) * 0.12, Math.sin(a) * r);
    capsule.userData.home = capsule.position.clone();
    out.push(capsule);
    body.add(capsule);
  }
  return out;
}

interface Cabinet {
  reels: THREE.Mesh[];
  lever: THREE.Group;
  bulbs: { mesh: THREE.Mesh; on: THREE.Material; off: THREE.Material }[];
  height: number;
}

/** A slot machine cabinet: rounded body, a window of three reels, a coin tray, a side lever and a ring of bulbs. */
function slotCabinet(
  body: THREE.Group,
  o: { body: THREE.Material; accent: THREE.Material; width: number; height: number; topper: (y: number) => THREE.Object3D },
): Cabinet {
  const w = o.width;
  const h = o.height;
  const cab = new THREE.Mesh(new RoundedBoxGeometry(w, h, 2.0, 5, 0.3), o.body);
  cab.position.y = 0.25 + h / 2;
  // The cabinet's slanted lower front and a coin tray.
  const tray = new THREE.Mesh(new RoundedBoxGeometry(w * 0.7, 0.3, 0.5, 2, 0.1), o.accent);
  tray.position.set(0, 0.9, 1.1);
  const frame = new THREE.Mesh(new RoundedBoxGeometry(w * 0.86, 1.2, 0.2, 3, 0.1), o.accent);
  frame.position.set(0, 0.25 + h * 0.62, 0.98);
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.76, 0.98), new THREE.MeshBasicMaterial({ color: 0x1d1640 }));
  pane.position.set(0, 0.25 + h * 0.62, 1.085);
  body.add(cab, tray, frame, pane);
  // Three reels, poking through the window.
  const reels: THREE.Mesh[] = [];
  const reelW = (w * 0.72) / 3;
  const reelGeo = new THREE.CylinderGeometry(0.62, 0.62, reelW * 0.92, 40).rotateZ(Math.PI / 2);
  for (let k = 0; k < 3; k++) {
    const tex = reelTexture().clone();
    tex.offset.x = k * 0.37;
    tex.needsUpdate = true;
    const reel = new THREE.Mesh(reelGeo, new THREE.MeshPhongMaterial({ map: tex, shininess: 40 }));
    reel.position.set((k - 1) * reelW, 0.25 + h * 0.62, 0.62);
    reel.rotation.x = k * 1.3;
    reels.push(reel);
    body.add(reel);
  }
  // Glass over the window.
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.76, 0.98),
    new THREE.MeshPhongMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, shininess: 150, specular: 0xffffff, depthWrite: false }),
  );
  glass.position.set(0, 0.25 + h * 0.62, 1.3);
  // The lever on the right side, with a red ball.
  const lever = new THREE.Group();
  lever.position.set(w / 2 + 0.15, 0.25 + h * 0.5, 0.2);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.25, 24).rotateZ(Math.PI / 2), o.accent);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 12), chrome());
  rod.position.set(0.12, 0.65, 0);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), phong(0xe63946, { shininess: 120, specular: 0xffffff }));
  ball.position.set(0.12, 1.3, 0);
  lever.add(hub, rod, ball);
  body.add(glass, lever);
  // Bulbs around the window frame.
  const bulbs: Cabinet['bulbs'] = [];
  const on = new THREE.MeshBasicMaterial({ color: 0xfff3a8 });
  const off = phong(0x8a7a40, { shininess: 80 });
  const bulbGeo = new THREE.SphereGeometry(0.08, 12, 8);
  const fy = 0.25 + h * 0.62;
  const fw = w * 0.86;
  const pts: [number, number][] = [];
  for (let k = 0; k <= 8; k++) pts.push([-fw / 2 + (k * fw) / 8, fy + 0.62]);
  for (let k = 1; k <= 3; k++) pts.push([fw / 2 + 0.02, fy + 0.62 - k * 0.31]);
  for (let k = 8; k >= 0; k--) pts.push([-fw / 2 + (k * fw) / 8, fy - 0.62]);
  for (let k = 3; k >= 1; k--) pts.push([-fw / 2 - 0.02, fy - 0.62 + k * 0.31]);
  for (const [x, y] of pts) {
    const mesh = new THREE.Mesh(bulbGeo, on);
    mesh.position.set(x, y, 1.1);
    bulbs.push({ mesh, on, off });
    body.add(mesh);
  }
  const top = o.topper(0.25 + h);
  body.add(top);
  return { reels, lever, bulbs, height: 0.25 + h };
}

/** Slot machine motion: the lever is yanked down first (anticipation), the reels whirl, then stop one by one. */
function slotModel(reels: THREE.Mesh[], lever: THREE.Group, bulbs: Cabinet['bulbs']): Model {
  const speed = reels.map(() => 0);
  return {
    idle(time) {
      lever.rotation.x = 0;
      bulbs.forEach((b, i) => (b.mesh.material = Math.floor(time * 3 + i / 3) % 3 === 0 ? b.on : b.off));
      reels.forEach((r, k) => {
        speed[k] *= 0.9;
        r.rotation.x += speed[k] * 0.016;
      });
    },
    spin(time, p) {
      // Lever: down fast with a little overshoot, back up slowly.
      lever.rotation.x = p < 0.15 ? easeOutBack(p / 0.15) * 1.1 : 1.1 * (1 - easeInOut(clamp01((p - 0.15) / 0.35)));
      reels.forEach((r, k) => {
        // Each reel spins up, then the left one stops first and the right one last (slow out).
        const stop = 0.55 + k * 0.13;
        const want = p < 0.1 ? 0 : p < stop ? 28 : 0;
        speed[k] += (want - speed[k]) * (p < stop ? 0.25 : 0.12);
        r.rotation.x += speed[k] * 0.016;
      });
      // The bulbs chase round fast.
      const head = Math.floor(time * 30);
      bulbs.forEach((b, i) => (b.mesh.material = (head - i) % 4 === 0 || p > 0.9 ? b.on : b.off));
    },
  };
}
