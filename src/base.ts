// The base beside the cannon: a grid of pads, the characters on them, their cash piles, a rarity glow
// and a level badge with an XP bar. It only draws the save; Game owns the rules.
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
  pad: THREE.Mesh;
  padMat: THREE.MeshLambertMaterial;
  glow: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
  hit: THREE.Mesh;
  rig: CharacterRig | null;
  name: string;
  coins: THREE.Mesh[];
  label: Label;
  badge: Badge;
  shown: number;
  badgeKey: string;
  seed: number;
}

const padGeo = new THREE.BoxGeometry(2.6, 0.25, 2.6);
const glowGeo = new THREE.PlaneGeometry(4.2, 4.2);
const hitGeo = new THREE.BoxGeometry(3.1, 1.6, 3.1);
const hitMat = new THREE.MeshBasicMaterial({ visible: false });
const coinGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.09, 12);
const coinMat = flat(0xffc21a, { emissive: 0x6b4a00 });
const EMPTY_PAD = 0xc9ced6;
const PAD_TOP = 0.25;

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

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  /** Pads fill columns of 4 running away from the cannon along -x. */
  static padPosition(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    const row = Math.floor(i / ECONOMY.padStep);
    const col = i % ECONOMY.padStep;
    return out.set(-7 - row * 3.4, PAD_TOP, 3.6 - col * 3.2);
  }

  static rows(pads: number): number {
    return Math.ceil(pads / ECONOMY.padStep);
  }

  /** Middle of the pad grid, for the home camera. */
  static center(pads: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(-7 - (Base.rows(pads) - 1) * 1.7, 0, 3.6 - 1.5 * 3.2);
  }

  /** Matches pads, characters and rarity colours to the save. */
  sync(save: Save): void {
    while (this.views.length < save.pads.length) this.addPad(this.views.length);
    // Rebirth shrinks the base back to its starting pads.
    while (this.views.length > save.pads.length) {
      const view = this.views.pop()!;
      if (view.rig) this.group.remove(view.rig.group);
      this.group.remove(view.pad, view.glow, view.hit, ...view.coins, view.label.sprite, view.badge.sprite);
    }
    save.pads.forEach((slot, i) => {
      const view = this.views[i];
      const name = slot?.name ?? '';
      if (name === view.name) return;
      if (view.rig) this.group.remove(view.rig.group);
      view.rig = null;
      view.name = name;
      view.badgeKey = '';
      this.paint(view, slot);
      if (!slot) return;
      const rig = makeCharacter(slot.rarity, slot.name);
      rig.cloud.visible = false;
      rig.halo.scale.multiplyScalar(0.7);
      Base.padPosition(i, rig.group.position);
      this.group.add(rig.group);
      view.rig = rig;
    });
  }

  update(save: Save, time: number, realDt: number): void {
    this.labelTimer -= realDt;
    const refreshLabels = this.labelTimer <= 0;
    if (refreshLabels) this.labelTimer = 0.2;
    save.pads.forEach((slot, i) => {
      const view = this.views[i];
      if (!view) return;
      if (view.rig) {
        view.rig.animate(time + view.seed);
        view.rig.figure.position.y = Math.abs(Math.sin(time * 2 + view.seed)) * 0.06;
        view.glowMat.opacity = 0.55 + Math.sin(time * 2.2 + view.seed) * 0.2;
      }
      if (!refreshLabels) return;
      this.drawBadge(view, slot);
      const cash = slot ? Math.floor(slot.cash) : 0;
      if (cash === view.shown) return;
      view.shown = cash;
      view.label.sprite.visible = cash > 0;
      if (cash > 0) view.label.set(`+${formatCoins(cash)}`, '#ffd84a');
      const stack = cash <= 0 ? 0 : Math.min(view.coins.length, 1 + Math.floor(Math.log2(cash + 1) / 1.5));
      view.coins.forEach((coin, k) => (coin.visible = k < stack));
    });
  }

  /** Index of the pad under a ray, or null. */
  pick(raycaster: THREE.Raycaster): number | null {
    const hits = raycaster.intersectObjects(
      this.views.map((v) => v.hit),
      false,
    );
    return hits.length ? (hits[0].object.userData.pad as number) : null;
  }

  /** An occupied pad takes on its character's rarity colour and glows; an empty one is plain gray. */
  private paint(view: PadView, slot: PadSlot | null): void {
    if (!slot) {
      view.padMat.color.setHex(EMPTY_PAD);
      view.padMat.emissive.setHex(0x000000);
      view.glow.visible = false;
      return;
    }
    const color = RARITIES[slot.rarity].color;
    view.padMat.color.setHex(EMPTY_PAD).lerp(new THREE.Color(color), 0.45);
    view.padMat.emissive.setHex(color).multiplyScalar(0.25);
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
    const padMat = flat(EMPTY_PAD);
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.set(pos.x, PAD_TOP / 2, pos.z);
    const glowMat = new THREE.MeshBasicMaterial({
      map: softTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(pos.x, 0.03, pos.z);
    glow.visible = false;
    const hit = new THREE.Mesh(hitGeo, hitMat);
    hit.position.set(pos.x, 0.8, pos.z);
    hit.userData.pad = i;
    const coins = Array.from({ length: 6 }, (_, k) => {
      const coin = new THREE.Mesh(coinGeo, coinMat);
      coin.position.set(pos.x + 0.85, PAD_TOP + 0.05 + k * 0.1, pos.z + 0.85);
      coin.visible = false;
      return coin;
    });
    const label = makeLabel();
    label.sprite.position.set(pos.x, 2.9, pos.z);
    label.sprite.scale.multiplyScalar(0.6);
    label.sprite.visible = false;
    const badge = makeBadge();
    badge.sprite.position.set(pos.x, 2.25, pos.z);
    badge.sprite.visible = false;
    this.group.add(glow, pad, hit, ...coins, label.sprite, badge.sprite);
    this.views.push({
      pad,
      padMat,
      glow,
      glowMat,
      hit,
      rig: null,
      name: '',
      coins,
      label,
      badge,
      shown: -1,
      badgeKey: '',
      seed: Math.random() * 10,
    });
  }
}
