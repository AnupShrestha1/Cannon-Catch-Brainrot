// Gray-box scene pieces: sky, ground, cannon, player, characters and birds.
import * as THREE from 'three';
import { ZONES, zoneIndexAt } from './config';

export const flat = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) =>
  new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

let softTex: THREE.Texture | null = null;

/** A white radial blob used for glows and particles. */
export function softTexture(): THREE.Texture {
  if (softTex) return softTex;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  softTex = new THREE.CanvasTexture(canvas);
  softTex.colorSpace = THREE.SRGBColorSpace;
  return softTex;
}

const nextSky = new THREE.Color();

/** Sky colour at a height, blending into the next zone over its last 40 m. */
export function skyColorAt(y: number, out: THREE.Color): THREE.Color {
  const i = zoneIndexAt(y);
  out.setHex(ZONES[i].sky);
  const next = ZONES[i + 1];
  if (next) {
    const t = (y - (next.from - 40)) / 40;
    if (t > 0) out.lerp(nextSky.setHex(next.sky), Math.min(1, t));
  }
  return out;
}

const puffGeo = new THREE.IcosahedronGeometry(1, 1);
// Emissive lifts the shaded undersides so clouds stay white instead of going gray.
const cloudMat = flat(0xffffff, { emissive: 0x8fa3b8 });

export function makeCloud(scale: number, puffs: number): THREE.Group {
  const group = new THREE.Group();
  for (let i = 0; i < puffs; i++) {
    const puff = new THREE.Mesh(puffGeo, cloudMat);
    puff.scale.setScalar((0.6 + Math.random() * 0.5) * scale);
    puff.position.set(
      (i - (puffs - 1) / 2) * 0.9 * scale,
      (Math.random() - 0.3) * 0.35 * scale,
      (Math.random() - 0.5) * 0.6 * scale,
    );
    group.add(puff);
  }
  group.scale.y = 0.65;
  return group;
}

export interface Env {
  cannon: THREE.Group;
  barrel: THREE.Group;
  setBarrelColor(color: number): void;
  shadow: THREE.Mesh;
  updateDecor(cameraY: number): void;
}

export function buildEnv(scene: THREE.Scene): Env {
  scene.add(new THREE.HemisphereLight(0xe4f4ff, 0x5a8f4a, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(30, 80, 50);
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(420, 48), flat(0x6cc070));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Trees for scale, kept out of the space between the camera and the cannon.
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 1.4, 6);
  const leafGeo = new THREE.ConeGeometry(1.6, 3.6, 6);
  const trunkMat = flat(0x7a4f2c);
  const leafMat = flat(0x2f8f45);
  for (let i = 0; i < 90; i++) {
    const x = (Math.random() - 0.5) * 300;
    const z = -Math.random() * 220 + 30;
    if (Math.abs(x) < 22 && z > -14) continue;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 0.7;
    const leaves = new THREE.Mesh(leafGeo, leafMat);
    leaves.position.y = 3;
    tree.add(trunk, leaves);
    tree.position.set(x, 0, z);
    tree.scale.setScalar(0.8 + Math.random() * 1.2);
    scene.add(tree);
  }

  // Cannon: a wooden carriage with a barrel tilted slightly away so its muzzle sits at x = 0, z = 0.
  const cannon = new THREE.Group();
  const carriage = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 2.4), flat(0x8a5a33));
  carriage.position.y = 0.6;
  const wheelGeo = new THREE.CylinderGeometry(0.75, 0.75, 0.3, 10);
  const wheelMat = flat(0x3d2a1a);
  for (const side of [-1, 1]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * 1.35, 0.75, 0);
    cannon.add(wheel);
  }
  const barrel = new THREE.Group();
  barrel.position.set(0, 1.2, 0.38);
  barrel.rotation.x = -0.12;
  const tubeMat = flat(0x3d4450);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.1, 3.2, 12), tubeMat);
  tube.position.y = 1.6;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.16, 6, 14), flat(0x2a2f38));
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 3.2;
  barrel.add(tube, lip);
  cannon.add(carriage, barrel);
  scene.add(cannon);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  scene.add(shadow);

  // Background clouds recycle through a 240 m window around the camera, so every height has some.
  const decor: THREE.Group[] = [];
  for (let i = 0; i < 46; i++) {
    const near = i < 12;
    const cloud = makeCloud(near ? 1.6 + Math.random() : 2.5 + Math.random() * 4, near ? 3 : 4 + Math.floor(Math.random() * 3));
    if (near) {
      cloud.position.set((Math.random() < 0.5 ? -1 : 1) * (17 + Math.random() * 14), 0, -6 + Math.random() * 10);
    } else {
      cloud.position.set((Math.random() - 0.5) * 200, 0, -30 - Math.random() * 130);
    }
    cloud.position.y = 25 + Math.random() * 240;
    scene.add(cloud);
    decor.push(cloud);
  }

  return {
    cannon,
    barrel,
    setBarrelColor(color: number) {
      tubeMat.color.setHex(color);
    },
    shadow,
    updateDecor(cameraY: number) {
      for (const cloud of decor) {
        while (cloud.position.y < cameraY - 120) cloud.position.y += 240;
        while (cloud.position.y > cameraY + 120) cloud.position.y -= 240;
        cloud.visible = cloud.position.y > 22;
      }
    },
  };
}

export interface PlayerRig {
  group: THREE.Group;
  body: THREE.Group;
  chute: THREE.Group;
  /** Shoulder and hip joints, left then right. Arms hang down at rotation 0 and raise outward with side × z. */
  arms: THREE.Group[];
  legs: THREE.Group[];
}

/** The player faces away from the camera (-z), so the camera sees their back and the stack on it. */
export function makePlayer(): PlayerRig {
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.9;
  group.add(body);

  const suit = flat(0xff7a1a);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.5), suit);
  torso.position.y = 0.05;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), flat(0xffd2a1));
  head.position.y = 0.75;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.37, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), flat(0xe63946));
  helmet.position.y = 0.8;
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.7, 0.28), flat(0x2b6cb0));
  pack.position.set(0, 0.08, 0.38);
  const limbMat = flat(0x3a3f58);
  const legGeo = new THREE.BoxGeometry(0.28, 0.55, 0.3);
  const armGeo = new THREE.BoxGeometry(0.22, 0.7, 0.22);
  const arms: THREE.Group[] = [];
  const legs: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.2, -0.38, 0);
    const leg = new THREE.Mesh(legGeo, limbMat);
    leg.position.y = -0.28;
    hip.add(leg);
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.47, 0.4, 0);
    const arm = new THREE.Mesh(armGeo, suit);
    arm.position.y = -0.32;
    shoulder.add(arm);
    body.add(hip, shoulder);
    legs.push(hip);
    arms.push(shoulder);
  }
  body.add(torso, head, helmet, pack);

  // Parachute, scaled from 0 when it opens.
  const chute = new THREE.Group();
  chute.position.set(0, 1.3, 0.3);
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(2.4, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    flat(0xff4d6d, { side: THREE.DoubleSide }),
  );
  canopy.scale.y = 0.55;
  canopy.position.y = 2.6;
  const linePoints: THREE.Vector3[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    linePoints.push(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a) * 2.3, 2.6, Math.sin(a) * 2.3));
  }
  const lines = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(linePoints),
    new THREE.LineBasicMaterial({ color: 0x1d2340 }),
  );
  chute.add(canopy, lines);
  chute.visible = false;
  group.add(chute);

  return { group, body, chute, arms, legs };
}

export interface BirdRig {
  group: THREE.Group;
  wings: THREE.Group[];
  /** A propeller to spin (planes). */
  spinner?: THREE.Object3D;
  /** A lightning bolt to flash (storm clouds). */
  flash?: THREE.Object3D;
}

const birdBodyGeo = new THREE.IcosahedronGeometry(0.5, 0);
const beakGeo = new THREE.ConeGeometry(0.14, 0.4, 5);
const wingGeo = new THREE.BoxGeometry(0.5, 0.06, 1.1);
const beakMat = flat(0xffa62b);
const birdEyeGeo = new THREE.BoxGeometry(0.1, 0.1, 0.05);
const birdEyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const birdMats = new Map<number, THREE.MeshLambertMaterial>();

/** A bird that flies along +x; flip it with rotation.y = PI. */
export function makeBird(color: number): BirdRig {
  let mat = birdMats.get(color);
  if (!mat) {
    mat = flat(color);
    birdMats.set(color, mat);
  }
  const group = new THREE.Group();
  const body = new THREE.Mesh(birdBodyGeo, mat);
  body.scale.set(1.4, 0.8, 0.8);
  const beak = new THREE.Mesh(beakGeo, beakMat);
  beak.rotation.z = -Math.PI / 2;
  beak.position.x = 0.85;
  const eye = new THREE.Mesh(birdEyeGeo, birdEyeMat);
  eye.position.set(0.5, 0.15, 0.3);
  group.add(body, beak, eye);
  const wings: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.z = side * 0.25;
    const wing = new THREE.Mesh(wingGeo, mat);
    wing.position.z = side * 0.55;
    pivot.add(wing);
    pivot.userData.side = side;
    group.add(pivot);
    wings.push(pivot);
  }
  return { group, wings };
}

const planeBodyMat = flat(0xe8ecf2);
const planeTrimMat = flat(0xd64545);
const planeBodyGeo = new THREE.CylinderGeometry(0.45, 0.3, 3, 10);
const planeWingGeo = new THREE.BoxGeometry(0.7, 0.08, 3.2);
const planeTailGeo = new THREE.BoxGeometry(0.5, 0.7, 0.08);
const propGeo = new THREE.BoxGeometry(0.06, 1.2, 0.12);

/** A small prop plane that flies along +x; flip it with rotation.y = PI. */
export function makePlane(): BirdRig {
  const group = new THREE.Group();
  const body = new THREE.Mesh(planeBodyGeo, planeBodyMat);
  body.rotation.z = -Math.PI / 2;
  const wing = new THREE.Mesh(planeWingGeo, planeTrimMat);
  const tail = new THREE.Mesh(planeTailGeo, planeTrimMat);
  tail.position.set(-1.3, 0.4, 0);
  const spinner = new THREE.Mesh(propGeo, flat(0x2b2b33));
  spinner.position.x = 1.55;
  group.add(body, wing, tail, spinner);
  return { group, wings: [], spinner };
}

const stormMat = flat(0x4a4466, { emissive: 0x141024 });
const boltMat = new THREE.MeshBasicMaterial({ color: 0xfff27a });
const boltGeo = new THREE.BoxGeometry(0.18, 1.6, 0.18);

/** A dark thundercloud with a lightning bolt that flickers beneath it. */
export function makeStormCloud(): BirdRig {
  const group = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const puff = new THREE.Mesh(puffGeo, stormMat);
    puff.scale.setScalar(0.9 + Math.random() * 0.5);
    puff.position.set((i - 2) * 0.8, (Math.random() - 0.3) * 0.4, (Math.random() - 0.5) * 0.6);
    group.add(puff);
  }
  const flash = new THREE.Group();
  const upper = new THREE.Mesh(boltGeo, boltMat);
  upper.position.set(0.2, -1.3, 0);
  upper.rotation.z = 0.4;
  const lower = new THREE.Mesh(boltGeo, boltMat);
  lower.position.set(-0.1, -2.6, 0);
  lower.rotation.z = -0.4;
  flash.add(upper, lower);
  group.add(flash);
  return { group, wings: [], flash };
}

export interface Label {
  sprite: THREE.Sprite;
  set(text: string, color?: string): void;
}

export function makeLabel(): Label {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const g = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(6, 6 * (96 / 512), 1);
  return {
    sprite,
    set(text: string, color = '#ffffff') {
      g.clearRect(0, 0, canvas.width, canvas.height);
      // Shrink long text to fit the canvas instead of clipping it.
      g.font = '900 56px system-ui, sans-serif';
      const fit = Math.min(1, (canvas.width - 24) / g.measureText(text).width);
      g.font = `900 ${Math.floor(56 * fit)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 10;
      g.strokeStyle = '#1d2340';
      g.strokeText(text, 256, 50);
      g.fillStyle = color;
      g.fillText(text, 256, 50);
      texture.needsUpdate = true;
    },
  };
}
