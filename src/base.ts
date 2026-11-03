// The base beside the cannon: a grid of pads, the characters on them and their cash piles.
// It only draws the save; Game owns the rules.
import * as THREE from 'three';
import { ECONOMY } from './config';
import { makeCharacter, type CharacterRig } from './characters';
import { formatCoins } from './economy';
import type { Save } from './store';
import { flat, makeLabel, type Label } from './world';

interface PadView {
  hit: THREE.Mesh;
  rig: CharacterRig | null;
  name: string;
  coins: THREE.Mesh[];
  label: Label;
  shown: number;
  seed: number;
}

const padGeo = new THREE.BoxGeometry(2.6, 0.25, 2.6);
const padMat = flat(0xc9ced6);
const hitGeo = new THREE.BoxGeometry(3.1, 1.6, 3.1);
const hitMat = new THREE.MeshBasicMaterial({ visible: false });
const coinGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.09, 12);
const coinMat = flat(0xffc21a, { emissive: 0x6b4a00 });
const PAD_TOP = 0.25;

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

  /**
   * Matches pads and characters to the save. Pads in `pending` keep what they show until a
   * character flying in lands there.
   */
  sync(save: Save, pending: ReadonlySet<number> = new Set()): void {
    while (this.views.length < save.pads.length) this.addPad(this.views.length);
    save.pads.forEach((slot, i) => {
      if (pending.has(i)) return;
      const view = this.views[i];
      const name = slot?.name ?? '';
      if (name === view.name) return;
      if (view.rig) this.group.remove(view.rig.group);
      view.rig = null;
      view.name = name;
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
      }
      if (!refreshLabels) return;
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

  private addPad(i: number): void {
    const pos = Base.padPosition(i);
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.set(pos.x, PAD_TOP / 2, pos.z);
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
    label.sprite.position.set(pos.x, 2.5, pos.z);
    label.sprite.scale.multiplyScalar(0.6);
    label.sprite.visible = false;
    this.group.add(pad, hit, ...coins, label.sprite);
    this.views.push({ hit, rig: null, name: '', coins, label, shown: -1, seed: Math.random() * 10 });
  }
}
