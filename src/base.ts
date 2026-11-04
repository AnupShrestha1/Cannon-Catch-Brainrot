// The showcase beside the cannon: a stone hall with a red carpet down the middle, two rows of 5 pedestals
// either side of it, and the gacha machine at the far end. Pedestals show their brainrot, a rarity glow, a
// cash pile and a level badge; locked ones are roped off until the base is expanded. It only draws the save;
// Game owns the rules.
import * as THREE from 'three';
import { ECONOMY, LEVELS, RARITIES } from './config';
import { makeCharacter, type CharacterRig } from './characters';
import { formatCoins, xpNeeded } from './economy';
import type { PadSlot, Save } from './store';
import { flat, makeLabel, softTexture, type Label } from './world';

interface Badge {
  sprite: THREE.Sprite;
  draw(level: number, progress: number, ready: boolean): void;
}

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
  coins: THREE.Mesh[];
  label: Label;
  badge: Badge;
  shown: number;
  /** 1 right after the pile grows, easing to 0: the label pops on each income tick. */
  pop: number;
  /** 1 right after a character arrives, easing to 0: it lands with a squash. */
  arrive: number;
  badgeKey: string;
  seed: number;
}

/** The carpet runs along -x at this depth, from the entrance near the cannon to the gacha machine. */
export const CARPET_Z = -1;
const ENTRANCE_X = -9;
const FIRST_X = -12.5;
const STEP_X = 4.3;
const ROW_OFFSET = 3.4;
const HALL_END_X = FIRST_X - STEP_X * 4 - 5.5;
/** Where the gacha machine stands, and where the player stands to use it. */
export const MACHINE = new THREE.Vector3(HALL_END_X + 1.6, 0, CARPET_Z);
export const MACHINE_FRONT = new THREE.Vector3(MACHINE.x + 2.6, 0, CARPET_Z);

const PAD_TOP = 0.5;
const pedestalGeo = new THREE.CylinderGeometry(1.45, 1.65, 0.42, 8).translate(0, 0.21, 0);
const topGeo = new THREE.CylinderGeometry(1.22, 1.22, 0.1, 32).translate(0, 0.45, 0);
const rimGeo = new THREE.TorusGeometry(1.26, 0.08, 6, 40).rotateX(Math.PI / 2).translate(0, 0.48, 0);
const glowGeo = new THREE.PlaneGeometry(4.6, 4.6);
const beaconGeo = new THREE.TorusGeometry(0.9, 0.06, 6, 40).rotateX(Math.PI / 2);
const coinGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.09, 12);
const coinMat = flat(0xffc21a, { emissive: 0x6b4a00 });
const stoneMat = flat(0xf1ebe0);
const lockedTop = 0x6f7783;
const emptyTop = 0xdfeaf6;
const GOLD = 0xffc84a;

/** A small sprite with the character's level and an XP bar that turns gold when a level-up is ready. */
function makeBadge(): Badge {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const g = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(2.2, 0.55, 1);
  return {
    sprite,
    draw(level, progress, ready) {
      g.clearRect(0, 0, 256, 64);
      g.font = '900 34px system-ui, sans-serif';
      g.textBaseline = 'middle';
      g.lineWidth = 7;
      g.strokeStyle = '#1d2340';
      g.fillStyle = '#ffffff';
      const text = level >= LEVELS.max ? 'MAX' : `Lv ${level}`;
      g.strokeText(text, 6, 32);
      g.fillText(text, 6, 32);
      if (level >= LEVELS.max) {
        texture.needsUpdate = true;
        return;
      }
      g.fillStyle = '#1d2340';
      g.beginPath();
      g.roundRect(108, 18, 142, 28, 12);
      g.fill();
      g.fillStyle = ready ? '#ffc21a' : '#3ccf5a';
      g.beginPath();
      g.roundRect(112, 22, Math.max(10, 134 * progress), 20, 9);
      g.fill();
      if (ready) {
        g.font = '900 20px system-ui, sans-serif';
        g.fillStyle = '#1d2340';
        g.fillText('UP!', 160, 33);
      }
      texture.needsUpdate = true;
    },
  };
}

export class Base {
  private views: PadView[] = [];
  private group = new THREE.Group();
  private labelTimer = 0;
  private machine: THREE.Group;
  private capsules: THREE.Mesh[] = [];
  private crank: THREE.Group;
  private shakeT = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.buildHall();
    this.machine = new THREE.Group();
    this.crank = new THREE.Group();
    this.buildMachine();
    for (let i = 0; i < ECONOMY.maxPads; i++) this.addPad(i);
  }

  /** Slots pair up across the carpet: even ones on the near side, odd ones opposite, running away from the cannon. */
  static padPosition(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    const col = Math.floor(i / 2);
    const side = i % 2 === 0 ? 1 : -1;
    return out.set(FIRST_X - col * STEP_X, PAD_TOP, CARPET_Z + side * ROW_OFFSET);
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
  sync(save: Save): void {
    this.views.forEach((view, i) => {
      const locked = i >= save.pads.length;
      const slot = locked ? null : save.pads[i];
      const key = locked ? '#locked' : (slot?.name ?? '');
      if (key === view.key) return;
      if (view.rig) this.group.remove(view.rig.group);
      view.rig = null;
      view.key = key;
      view.badgeKey = '';
      view.shown = -1;
      this.paint(view, slot, locked);
      if (!slot) return;
      const rig = makeCharacter(slot.rarity, slot.name);
      rig.figure.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = true;
      });
      rig.cloud.visible = false;
      rig.halo.scale.multiplyScalar(0.8);
      rig.group.scale.setScalar(1.3);
      Base.padPosition(i, rig.group.position);
      // Face the carpet.
      rig.group.rotation.y = i % 2 === 0 ? Math.PI : 0;
      this.group.add(rig.group);
      view.rig = rig;
      view.arrive = 1;
    });
  }

  update(save: Save, time: number, realDt: number): void {
    this.labelTimer -= realDt;
    const refreshLabels = this.labelTimer <= 0;
    if (refreshLabels) this.labelTimer = 0.2;
    this.animateMachine(time, realDt);
    this.views.forEach((view, i) => {
      const slot = i < save.pads.length ? save.pads[i] : null;
      if (view.pop > 0) {
        view.pop = Math.max(0, view.pop - realDt * 4);
        const s = 0.6 * (1 + view.pop * 0.3);
        view.label.sprite.scale.set(6 * s, 6 * (96 / 512) * s, 1);
      }
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
      if (!refreshLabels) return;
      this.drawBadge(view, slot);
      const cash = slot ? Math.floor(slot.cash) : 0;
      if (cash === view.shown) return;
      if (cash > view.shown && view.shown > 0) view.pop = 1;
      view.shown = cash;
      view.label.sprite.visible = cash > 0;
      if (cash > 0) view.label.set(`+${formatCoins(cash)}`, '#ffd84a');
      const stack = cash <= 0 ? 0 : Math.min(view.coins.length, 1 + Math.floor(Math.log2(cash + 1) / 1.5));
      view.coins.forEach((coin, k) => (coin.visible = k < stack));
    });
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

  private drawBadge(view: PadView, slot: PadSlot | null): void {
    view.badge.sprite.visible = !!slot;
    if (!slot) return;
    const level = slot.level ?? 1;
    const need = xpNeeded(slot);
    const progress = need === null ? 1 : Math.min(1, (slot.xp ?? 0) / need);
    const ready = need !== null && progress >= 1;
    const key = `${level}|${Math.round(progress * 40)}|${ready}`;
    if (key === view.badgeKey) return;
    view.badgeKey = key;
    view.badge.draw(level, progress, ready);
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
    const lock = this.makeLock(pos);
    const coins = Array.from({ length: 6 }, (_, k) => {
      const coin = new THREE.Mesh(coinGeo, coinMat);
      const side = i % 2 === 0 ? 1 : -1;
      coin.position.set(pos.x + 0.85, PAD_TOP + 0.05 + k * 0.1, pos.z - side * 0.8);
      coin.visible = false;
      return coin;
    });
    const label = makeLabel();
    label.sprite.position.set(pos.x, 3.4, pos.z);
    label.sprite.scale.multiplyScalar(0.6);
    label.sprite.visible = false;
    const badge = makeBadge();
    badge.sprite.position.set(pos.x, 2.75, pos.z);
    badge.sprite.visible = false;
    this.group.add(glow, pedestal, top, rim, beacon, lock, ...coins, label.sprite, badge.sprite);
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
      coins,
      label,
      badge,
      shown: -1,
      pop: 0,
      arrive: 0,
      badgeKey: '',
      seed: Math.random() * 10,
    });
  }

  /** Two brass posts with a velvet rope between them and a LOCKED sign. */
  private makeLock(pos: THREE.Vector3): THREE.Group {
    const lock = new THREE.Group();
    lock.position.set(pos.x, 0, pos.z);
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
    const sign = makeLabel();
    sign.set('LOCKED', '#c9ced6');
    sign.sprite.position.y = 2.25;
    sign.sprite.scale.multiplyScalar(0.36);
    lock.add(rope, sign.sprite);
    return lock;
  }

  /** Stone floor with a border, the red carpet with gold edging, and an arch over the entrance. */
  private buildHall(): void {
    const g = this.group;
    const near = ENTRANCE_X;
    const far = HALL_END_X;
    const length = near - far;
    const midX = (near + far) / 2;
    const depth = ROW_OFFSET * 2 + 5;
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
    const carpet = new THREE.Mesh(new THREE.BoxGeometry(length + 3, 0.05, 2.8), flat(0xc8102e));
    carpet.position.set(midX + 1.5, 0.145, CARPET_Z);
    carpet.receiveShadow = true;
    g.add(carpet);
    const edgeMat = flat(GOLD, { emissive: 0x4a3200 });
    for (const side of [-1, 1]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(length + 3, 0.06, 0.14), edgeMat);
      edge.position.set(midX + 1.5, 0.15, CARPET_Z + side * 1.4);
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
    const gap = 3.4;
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
    const red = flat(0xe63946);
    const gold = flat(GOLD, { emissive: 0x5a3c00 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2, 2.6), red);
    body.position.y = 1;
    const trim = new THREE.Mesh(new THREE.BoxGeometry(2.75, 0.2, 2.75), gold);
    trim.position.y = 2.05;
    const chute = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.9), flat(0x2b2b33));
    chute.position.set(1.32, 0.6, 0);
    // The crank faces the carpet (+x).
    this.crank.position.set(1.35, 1.45, 0);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 16), gold);
    disc.rotation.z = Math.PI / 2;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.7, 0.14), flat(0xffffff));
    handle.position.set(0.12, 0.25, 0);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), red);
    knob.position.set(0.12, 0.6, 0);
    this.crank.add(disc, handle, knob);
    const globe = new THREE.Mesh(
      new THREE.SphereGeometry(1.45, 24, 16),
      new THREE.MeshLambertMaterial({ color: 0xcdefff, transparent: true, opacity: 0.32, depthWrite: false }),
    );
    globe.position.y = 3.3;
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 0.45, 16), red);
    lid.position.y = 4.75;
    const topper = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), gold);
    topper.position.y = 5.15;
    m.add(body, trim, chute, this.crank, lid, topper);
    const capsuleGeo = new THREE.SphereGeometry(0.33, 12, 8);
    const colors = RARITIES.slice(0, 5).map((r) => r.color);
    for (let i = 0; i < 16; i++) {
      const capsule = new THREE.Mesh(capsuleGeo, flat(colors[i % colors.length], { emissive: colors[i % colors.length] }));
      (capsule.material as THREE.MeshLambertMaterial).emissiveIntensity = 0.25;
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
