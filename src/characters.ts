// Gray-box character models: primitive shapes per roster character, each with an idle animation.
// Every model faces +z (the camera), stands on y = 0 and is about 1.2 m tall.
// Geometries and materials are cached, so building and dropping rigs every run leaks nothing.
import * as THREE from 'three';
import { RARITIES } from './config';
import { flat, makeCloud, softTexture } from './world';

export interface CharacterRig {
  group: THREE.Group;
  figure: THREE.Group;
  cloud: THREE.Group;
  halo: THREE.Sprite;
  animate(t: number): void;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<number, THREE.MeshLambertMaterial>();

function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let geo = geoCache.get(key);
  if (!geo) {
    geo = make();
    geoCache.set(key, geo);
  }
  return geo;
}

function mat(color: number): THREE.MeshLambertMaterial {
  let m = matCache.get(color);
  if (!m) {
    m = flat(color);
    matCache.set(color, m);
  }
  return m;
}

const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T => {
  o.position.set(x, y, z);
  return o;
};
const box = (w: number, h: number, d: number, m: THREE.Material) =>
  new THREE.Mesh(cached(`box${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)), m);
const ball = (r: number, m: THREE.Material, detail = 1) =>
  new THREE.Mesh(cached(`ball${r},${detail}`, () => new THREE.IcosahedronGeometry(r, detail)), m);
const cyl = (top: number, bottom: number, h: number, m: THREE.Material, seg = 10) =>
  new THREE.Mesh(cached(`cyl${top},${bottom},${h},${seg}`, () => new THREE.CylinderGeometry(top, bottom, h, seg)), m);
const cone = (r: number, h: number, m: THREE.Material, seg = 8) =>
  new THREE.Mesh(cached(`cone${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg)), m);
const ring = (r: number, tube: number, m: THREE.Material) =>
  new THREE.Mesh(cached(`ring${r},${tube}`, () => new THREE.TorusGeometry(r, tube, 6, 14)), m);

const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const pupilMat = new THREE.MeshBasicMaterial({ color: 0x111111 });

/** Two square cartoon eyes on a face at depth z, centred on x. */
function eyes(parent: THREE.Object3D, x: number, y: number, z: number, spread = 0.11): void {
  for (const side of [-1, 1]) {
    parent.add(at(box(0.15, 0.15, 0.04, eyeMat), x + side * spread, y, z));
    parent.add(at(box(0.07, 0.07, 0.04, pupilMat), x + side * spread, y - 0.02, z + 0.03));
  }
}

const smokeMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 });
const bulbMat = new THREE.MeshLambertMaterial({ color: 0xfff3a6, emissive: 0xffd84a, emissiveIntensity: 1 });
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x150f2c });

const CHROME = 0xc9ced6;
const ORANGE = 0xff9a3c;
const WHITE = 0xf4f4f4;
const SKIN = 0xf3c9a0;
const WAFFLE = 0xd9a25f;
const CARDBOARD = 0xc9a26b;

type Model = (figure: THREE.Group, accent: THREE.Material) => (t: number) => void;

const MODELS: Record<string, Model> = {
  // Pigeon with a cannon for a body; puffs smoke rings.
  'Cannolini Cannonino': (f, accent) => {
    const metal = mat(0x4a505a);
    const barrel = at(cyl(0.3, 0.36, 1, metal, 12), 0.05, 0.5, 0);
    barrel.rotation.z = Math.PI / 2;
    const lip = at(ring(0.3, 0.07, metal), 0.56, 0.5, 0);
    lip.rotation.y = Math.PI / 2;
    const head = at(ball(0.24, mat(0xb9b6d3)), -0.2, 0.95, 0.12);
    const beak = at(cone(0.07, 0.2, mat(ORANGE), 6), -0.2, 0.92, 0.44);
    beak.rotation.x = Math.PI / 2;
    const collar = at(ring(0.2, 0.05, accent), -0.2, 0.76, 0.1);
    collar.rotation.x = Math.PI / 2;
    const smoke = at(ring(0.22, 0.06, smokeMat), 0.7, 0.5, 0);
    smoke.rotation.y = Math.PI / 2;
    f.add(barrel, lip, head, beak, collar, smoke);
    for (const side of [-1, 1]) f.add(at(box(0.07, 0.24, 0.07, mat(ORANGE)), -0.05 + side * 0.15, 0.12, 0));
    eyes(f, -0.2, 1, 0.34, 0.09);
    return (t) => {
      const p = (t * 0.7) % 1;
      smoke.position.x = 0.62 + p * 0.9;
      smoke.scale.setScalar(0.6 + p * 1.2);
      smoke.visible = p < 0.85;
    };
  },

  // Toaster with dove wings; pops toast out of its top.
  'Tostino Tortorino': (f, accent) => {
    const body = at(box(0.9, 0.62, 0.56, mat(CHROME)), 0, 0.42, 0);
    const dark = mat(0x2b2b33);
    const toast = at(box(0.36, 0.4, 0.07, mat(WAFFLE)), 0, 0.6, -0.08);
    f.add(body, toast, at(box(0.42, 0.03, 0.1, dark), 0, 0.735, -0.08), at(box(0.42, 0.03, 0.1, dark), 0, 0.735, 0.1));
    f.add(at(box(0.08, 0.16, 0.08, accent), 0.49, 0.45, 0));
    const wings: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const pivot = at(new THREE.Group(), side * 0.45, 0.58, 0);
      pivot.add(at(box(0.5, 0.06, 0.3, mat(0xffffff)), side * 0.25, 0, 0));
      f.add(pivot);
      wings.push(pivot);
      f.add(at(box(0.12, 0.11, 0.2, dark), side * 0.3, 0.06, 0));
    }
    eyes(f, 0, 0.5, 0.29, 0.13);
    return (t) => {
      toast.position.y = 0.6 + Math.max(0, Math.sin(t * 2.2)) * 0.35;
      const flap = Math.sin(t * 10) * 0.5;
      wings[0].rotation.z = -flap;
      wings[1].rotation.z = flap;
    };
  },

  // Snail with a lightbulb shell; the bulb flickers (shared material, see animateShared).
  'Lampadino Lumachino': (f, accent) => {
    const slime = mat(0x86c95b);
    f.add(at(box(1.1, 0.24, 0.42, slime), 0, 0.12, 0), at(box(0.3, 0.42, 0.36, slime), 0.48, 0.36, 0));
    for (const x of [0.4, 0.56]) {
      f.add(at(cyl(0.03, 0.03, 0.3, slime, 6), x, 0.72, 0.08));
      f.add(at(ball(0.08, eyeMat, 0), x, 0.9, 0.1), at(ball(0.04, pupilMat, 0), x, 0.89, 0.17));
    }
    f.add(at(cyl(0.16, 0.2, 0.2, accent), -0.12, 0.34, 0), at(ball(0.36, bulbMat, 2), -0.12, 0.74, 0));
    return () => {};
  },

  // Ostrich whose neck is a toothbrush; brushes the air.
  'Spazzolino Struzzo': (f, accent) => {
    const body = at(ball(0.42, mat(0x3b3b44)), 0, 0.85, 0);
    body.scale.set(1.25, 0.9, 0.95);
    const tail = at(box(0.2, 0.25, 0.3, mat(0xffffff)), -0.5, 0.98, 0);
    tail.rotation.z = 0.5;
    f.add(body, tail);
    for (const side of [-1, 1]) f.add(at(cyl(0.04, 0.04, 0.62, mat(0xf2a6a0), 6), side * 0.13, 0.31, 0));
    const neck = at(new THREE.Group(), 0.35, 1.05, 0);
    neck.add(at(box(0.12, 0.85, 0.12, accent), 0, 0.42, 0), at(box(0.16, 0.14, 0.3, mat(0xffffff)), 0.02, 0.88, 0.1));
    eyes(neck, 0, 0.7, 0.07, 0.06);
    f.add(neck);
    return (t) => {
      neck.rotation.z = Math.sin(t * 3) * 0.3;
    };
  },

  // Gymnast with a gelato-cone head; cartwheels now and then.
  'Ginnasta Gelatina': (f, accent) => {
    const pivot = at(new THREE.Group(), 0, 0.85, 0);
    const skin = mat(SKIN);
    pivot.add(at(box(0.34, 0.46, 0.22, accent), 0, 0, 0));
    for (const side of [-1, 1]) {
      pivot.add(at(box(0.1, 0.45, 0.1, skin), side * 0.09, -0.45, 0));
      const arm = at(box(0.08, 0.42, 0.08, skin), side * 0.25, 0.3, 0);
      arm.rotation.z = -side * 0.4;
      pivot.add(arm);
    }
    const cone_ = at(cone(0.2, 0.42, mat(WAFFLE)), 0, 0.44, 0);
    cone_.rotation.x = Math.PI;
    pivot.add(cone_, at(ball(0.24, mat(0xff9ec7)), 0, 0.72, 0));
    eyes(pivot, 0, 0.74, 0.22, 0.09);
    f.add(pivot);
    return (t) => {
      const p = (t % 3.2) / 3.2;
      pivot.rotation.z = p < 0.3 ? (p / 0.3) * Math.PI * 2 : 0;
    };
  },

  // Pelican whose beak is a pizza box; flips the lid open.
  'Pizzarotto Pellicano': (f, accent) => {
    const white = mat(WHITE);
    const body = at(ball(0.45, white), 0, 0.6, 0);
    body.scale.set(1.1, 1, 0.9);
    f.add(body, at(ball(0.24, white), 0, 1.15, 0.05));
    for (const side of [-1, 1]) f.add(at(box(0.07, 0.24, 0.07, mat(ORANGE)), side * 0.15, 0.12, 0));
    eyes(f, 0, 1.22, 0.27, 0.09);
    const cardboard = mat(CARDBOARD);
    f.add(at(box(0.56, 0.06, 0.5, cardboard), 0, 1, 0.48), at(cyl(0.22, 0.22, 0.03, mat(0xffc04d), 12), 0, 1.045, 0.48));
    const lid = at(new THREE.Group(), 0, 1.04, 0.23);
    lid.add(at(box(0.56, 0.05, 0.5, cardboard), 0, 0, 0.25));
    f.add(lid, at(box(0.3, 0.12, 0.08, accent), 0, 0.88, 0.38));
    return (t) => {
      lid.rotation.x = -Math.max(0, Math.sin(t * 1.8)) * 1.1;
    };
  },
};

/** Fallback for characters without a model yet: a cube in the rarity colour. */
const cubeModel: Model = (f, accent) => {
  f.add(at(box(0.9, 0.9, 0.9, accent), 0, 0.6, 0));
  eyes(f, 0, 0.72, 0.46, 0.17);
  return () => {};
};

const rarityMats = new Map<number, THREE.MeshLambertMaterial>();
const haloMats = new Map<number, THREE.SpriteMaterial>();

/** Shared per rarity; the Secret one is recoloured every frame for its rainbow. */
export function rarityMaterial(rarity: number): THREE.MeshLambertMaterial {
  let m = rarityMats.get(rarity);
  if (!m) {
    const color = RARITIES[rarity].color;
    m = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.3, flatShading: true });
    rarityMats.set(rarity, m);
  }
  return m;
}

function haloMaterial(rarity: number): THREE.SpriteMaterial {
  let m = haloMats.get(rarity);
  if (!m) {
    m = new THREE.SpriteMaterial({
      map: softTexture(),
      color: RARITIES[rarity].color,
      transparent: true,
      depthWrite: false,
      opacity: rarity === 0 ? 0 : rarity === 1 ? 0.45 : 0.75,
    });
    haloMats.set(rarity, m);
  }
  return m;
}

export function makeCharacter(rarity: number, name: string): CharacterRig {
  const group = new THREE.Group();
  const figure = new THREE.Group();
  group.add(figure);
  const animate = (MODELS[name] ?? cubeModel)(figure, rarityMaterial(rarity));
  const cloud = makeCloud(0.75, 3);
  group.add(cloud);
  const halo = new THREE.Sprite(haloMaterial(rarity));
  halo.scale.setScalar(2.4 + rarity * 0.5);
  halo.position.y = 0.7;
  group.add(halo);
  return { group, figure, cloud, halo, animate };
}

/** A dark outline of a character with its rarity glow, for showing what a locked zone holds. */
export function makeSilhouette(rarity: number, name: string): THREE.Group {
  const rig = makeCharacter(rarity, name);
  rig.cloud.visible = false;
  rig.figure.traverse((o) => {
    if (o instanceof THREE.Mesh) o.material = shadowMat;
  });
  return rig.group;
}

/** Animations that live on shared materials: the bulb flicker and the Secret rainbow. */
export function animateShared(t: number): void {
  bulbMat.emissiveIntensity = Math.sin(t * 7) + Math.sin(t * 17) > 0.4 ? 1 : 0.25;
  const secret = rarityMaterial(RARITIES.length - 1);
  secret.color.setHSL((t * 0.25) % 1, 0.9, 0.6);
  secret.emissive.copy(secret.color);
}
