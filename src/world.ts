// Gray-box scene pieces: sky, ground, cannon, player, characters and birds.
import * as THREE from 'three';
import { ZONES, zoneIndexAt } from './config';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { addScenery, makeSkyDome, type BoardRow } from './scenery';

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
  /** Moves the sun (and its shadow area) to stay over a point: the town is too long for one shadow map. */
  followSun(x: number, z: number): void;
  shadow: THREE.Mesh;
  updateDecor(cameraY: number): void;
  /** Animates the scenery and recolours the sky dome and fog for the current height. */
  updateScenery(t: number, sky: THREE.Color, fog: THREE.Fog, camera: THREE.Vector3): void;
  /** Redraws one of the hub's leaderboards (0: left, 1: right). */
  drawBoard(index: number, title: string, rows: BoardRow[]): void;
}

/** The cannon's wheel axle height (tyres resting on the plinth), and the barrel's pivot height. */
const WHEEL_Y = 0.14 + 0.79;
export const BARREL_Y = 1.42;

export function buildEnv(scene: THREE.Scene): Env {
  scene.add(new THREE.HemisphereLight(0xdcefff, 0x5f8a45, 1.05));
  // A warm sun casting soft shadows over the base, the cannon and the trees around them.
  const sun = new THREE.DirectionalLight(0xfff0d6, 1.9);
  sun.target.position.set(0, 0, -10);
  sun.position.set(30, 80, -10 + 50);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 40, bottom: -40, near: 10, far: 200 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  const scenery = addScenery(scene);
  const dome = makeSkyDome();
  scene.add(dome.mesh);
  const horizon = new THREE.Color();
  const white = new THREE.Color(0xffffff);

  // Cannon: a classic turned barrel with gold bands on a wooden carriage with spoked wheels, on a round stone
  // base. Smooth, glossy materials; the barrel is tilted slightly away so its muzzle sits at x = 0, z = 0.
  const cannon = new THREE.Group();
  const wood = new THREE.MeshPhongMaterial({ color: 0x9a6236, shininess: 18 });
  const darkWood = new THREE.MeshPhongMaterial({ color: 0x5c3a20, shininess: 12 });
  const iron = new THREE.MeshPhongMaterial({ color: 0x2b2f38, shininess: 70, specular: 0x666a75 });
  const brass = new THREE.MeshPhongMaterial({ color: 0xffc84a, emissive: 0x3a2600, shininess: 90, specular: 0xfff1b0 });
  const stone = new THREE.MeshPhongMaterial({ color: 0xd9cfbf, shininess: 8 });
  // A low stone plinth the wheels stand on (their tyres touch its top, they don't sink into it).
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.25, 0.14, 48), stone);
  base.position.y = 0.07;
  base.receiveShadow = true;
  const baseRim = new THREE.Mesh(new THREE.TorusGeometry(2.07, 0.06, 10, 48).rotateX(Math.PI / 2), brass);
  baseRim.position.y = 0.14;
  // Carriage: two rounded cheeks joined by a block, with an axle through them.
  const cheekGeo = new RoundedBoxGeometry(0.34, 1.05, 2.1, 3, 0.12);
  for (const side of [-1, 1]) {
    const cheek = new THREE.Mesh(cheekGeo, wood);
    cheek.position.set(side * 0.82, 1.07, 0.05);
    cannon.add(cheek);
  }
  const bed = new THREE.Mesh(new RoundedBoxGeometry(1.4, 0.36, 1.8, 3, 0.1), darkWood);
  bed.position.set(0, 0.77, 0.05);
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.3, 16).rotateZ(Math.PI / 2), iron);
  axle.position.set(0, WHEEL_Y, 0);
  cannon.add(bed, axle);
  // Spoked wheels with iron tyres and brass hubs.
  const tyreGeo = new THREE.TorusGeometry(0.7, 0.09, 12, 40);
  const felloeGeo = new THREE.TorusGeometry(0.62, 0.07, 8, 40);
  const spokeGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.24, 8);
  const hubGeo = new THREE.SphereGeometry(0.17, 16, 12);
  for (const side of [-1, 1]) {
    const wheel = new THREE.Group();
    // Out past the barrel's widest point, so it clears them even swung to either side.
    wheel.position.set(side * 1.5, WHEEL_Y, 0);
    wheel.rotation.y = Math.PI / 2;
    wheel.add(new THREE.Mesh(tyreGeo, iron), new THREE.Mesh(felloeGeo, wood), new THREE.Mesh(hubGeo, brass));
    for (let k = 0; k < 6; k++) {
      const spoke = new THREE.Mesh(spokeGeo, wood);
      spoke.rotation.z = (k * Math.PI) / 6;
      wheel.add(spoke);
    }
    cannon.add(wheel);
  }
  const barrel = new THREE.Group();
  barrel.position.set(0, BARREL_Y, 0.38);
  barrel.rotation.x = -0.12;
  const tubeMat = new THREE.MeshPhongMaterial({ color: 0x3d4450, shininess: 80, specular: 0x8890a0 });
  // The barrel turned on a lathe: rounded breech, swelling reinforce, a waist, and a flared muzzle with a bore.
  const profile = [
    [0, -0.55], [0.45, -0.5], [0.78, -0.3], [0.98, 0], [1.08, 0.35], [1.1, 0.8], [1.02, 1.05], [0.98, 1.6],
    [0.9, 2.3], [0.88, 2.65], [0.98, 2.78], [1.06, 2.95], [1.04, 3.12], [0.94, 3.2], [0.7, 3.2], [0.66, 2.9],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const tube = new THREE.Mesh(new THREE.LatheGeometry(profile, 40), tubeMat);
  tube.material.side = THREE.DoubleSide;
  const bore = new THREE.Mesh(new THREE.CircleGeometry(0.66, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0d0f14 }));
  bore.position.y = 2.95;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.09, 12, 40), brass);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 3.16;
  barrel.add(tube, bore, lip);
  for (const [y, r] of [
    [0.25, 1.1],
    [1.05, 1.04],
    [2.72, 0.95],
  ]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07, 10, 40), brass);
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
    barrel.add(band);
  }
  // Trunnions, a cascabel knob at the back and a fuse.
  for (const side of [-1, 1]) {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.4, 16).rotateZ(Math.PI / 2), brass);
    pin.position.set(side * 1.12, 0.55, 0);
    barrel.add(pin);
  }
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), brass);
  knob.position.y = -0.7;
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.35, 8), new THREE.MeshPhongMaterial({ color: 0xf2e2b8 }));
  fuse.position.set(0, -0.15, 0.85);
  fuse.rotation.x = 0.6;
  barrel.add(knob, fuse);
  cannon.add(base, baseRim, barrel);
  cannon.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  scene.add(cannon);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  scene.add(shadow);

  // Stars for the Edge of Space: a shell of points round the camera, fading in above 600 m.
  const starGeo = new THREE.BufferGeometry();
  const starPos: number[] = [];
  for (let i = 0; i < 900; i++) {
    const u = Math.random() * 2 - 1;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    starPos.push(Math.cos(a) * r * 300, u * 300, Math.sin(a) * r * 300);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.visible = false;
  scene.add(stars);

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
    followSun(x: number, z: number) {
      // Snapped to a 4 m grid so the shadows don't shimmer as the area moves.
      const sx = Math.round(x / 4) * 4;
      const sz = Math.round(z / 4) * 4;
      sun.target.position.set(sx, 0, sz - 8);
      sun.position.set(sx + 30, 80, sz + 42);
    },
    shadow,
    updateDecor(cameraY: number) {
      for (const cloud of decor) {
        while (cloud.position.y < cameraY - 120) cloud.position.y += 240;
        while (cloud.position.y > cameraY + 120) cloud.position.y -= 240;
        // None above the Storm Layer: space is clear.
        cloud.visible = cloud.position.y > 22 && cloud.position.y < 640;
      }
    },
    drawBoard(index, title, rows) {
      scenery.drawBoard(index, title, rows);
    },
    updateScenery(t, sky, fog, camera) {
      scenery.update(t);
      // High up, the haze gives way to the dark of space, and the stars come out.
      const space = Math.min(1, Math.max(0, (camera.y - 600) / 120));
      horizon.copy(sky).lerp(white, 0.3 * (1 - space));
      fog.color.copy(horizon);
      dome.update(sky, horizon, camera);
      stars.visible = space > 0;
      starMat.opacity = space;
      stars.position.copy(camera);
    },
  };
}

export interface PlayerRig {
  group: THREE.Group;
  body: THREE.Group;
  chute: THREE.Group;
  /** The everyday hat, and the crash helmet worn in the cannon and in flight (hidden at first). */
  cap: THREE.Group;
  helmet: THREE.Group;
  /** Shoulder and hip joints, left then right. Arms hang down at rotation 0 and raise outward with side × z. */
  arms: THREE.Group[];
  legs: THREE.Group[];
  /** Re-dresses the avatar in place (the profile editor). */
  dress(outfit: Outfit): void;
  /** A part that spins (the propeller hat), if any. */
  spinner: THREE.Object3D | null;
}

export const FACES = ['smile', 'grin', 'cool', 'wink', 'wow', 'sleepy', 'cat'] as const;
export type Face = (typeof FACES)[number];
export const HEADS = ['block', 'round', 'tall'] as const;
export type Head = (typeof HEADS)[number];
export const HATS = ['cap', 'none', 'beanie', 'tophat', 'cowboy', 'crown', 'propeller', 'party'] as const;
export type Hat = (typeof HATS)[number];
export const PATTERNS = ['stripe', 'plain', 'stripes', 'dots', 'star', 'split', 'zigzag'] as const;
export type Pattern = (typeof PATTERNS)[number];

const faceCache = new Map<string, THREE.Texture>();

/** A cartoon face drawn on a canvas, in one of a few expressions. */
export function faceTexture(face: Face = 'smile'): THREE.Texture {
  const hit = faceCache.get(face);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d')!;
  const ink = '#1d1d24';
  g.strokeStyle = ink;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const eye = (x: number) => {
    g.fillStyle = ink;
    g.beginPath();
    g.ellipse(x, 52, 8, 13, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(x - 3, 46, 3.5, 0, Math.PI * 2);
    g.fill();
  };
  const arc = (x: number, y: number, r: number, a0: number, a1: number, w = 7) => {
    g.lineWidth = w;
    g.beginPath();
    g.arc(x, y, r, a0, a1);
    g.stroke();
  };
  if (face === 'smile') {
    eye(44);
    eye(84);
    arc(64, 74, 22, 0.15 * Math.PI, 0.85 * Math.PI);
  } else if (face === 'grin') {
    eye(44);
    eye(84);
    // A big open D-shaped grin with a row of teeth.
    g.fillStyle = '#5a1020';
    g.beginPath();
    g.moveTo(38, 76);
    g.arc(64, 76, 26, 0, Math.PI);
    g.closePath();
    g.fill();
    g.fillStyle = '#ffffff';
    g.fillRect(44, 76, 40, 8);
  } else if (face === 'cool') {
    // Sunglasses and a smirk.
    g.fillStyle = ink;
    g.beginPath();
    g.roundRect(26, 40, 34, 22, 8);
    g.roundRect(68, 40, 34, 22, 8);
    g.fill();
    g.fillRect(56, 44, 16, 5);
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillRect(32, 44, 10, 4);
    g.fillRect(74, 44, 10, 4);
    arc(70, 70, 18, 0.2 * Math.PI, 0.7 * Math.PI);
  } else if (face === 'wink') {
    eye(44);
    arc(84, 58, 10, 1.1 * Math.PI, 1.9 * Math.PI);
    arc(64, 74, 22, 0.15 * Math.PI, 0.85 * Math.PI);
    g.fillStyle = '#ff6b8a';
    g.beginPath();
    g.ellipse(70, 97, 8, 6, 0, 0, Math.PI * 2);
    g.fill();
  } else if (face === 'wow') {
    eye(44);
    eye(84);
    g.fillStyle = '#5a1020';
    g.beginPath();
    g.ellipse(64, 88, 10, 13, 0, 0, Math.PI * 2);
    g.fill();
  } else if (face === 'sleepy') {
    arc(44, 50, 10, 0.1 * Math.PI, 0.9 * Math.PI);
    arc(84, 50, 10, 0.1 * Math.PI, 0.9 * Math.PI);
    arc(64, 92, 8, 1.1 * Math.PI, 1.9 * Math.PI, 6);
    g.font = '900 22px system-ui, sans-serif';
    g.fillStyle = '#3a6cff';
    g.fillText('z', 100, 30);
  } else {
    // Cat: happy closed eyes, a w mouth and whiskers.
    arc(44, 58, 10, 1.1 * Math.PI, 1.9 * Math.PI);
    arc(84, 58, 10, 1.1 * Math.PI, 1.9 * Math.PI);
    arc(56, 76, 8, 0, Math.PI, 6);
    arc(72, 76, 8, 0, Math.PI, 6);
    g.lineWidth = 3;
    for (const [x0, x1, y] of [
      [24, 6, 74],
      [24, 6, 86],
      [104, 122, 74],
      [104, 122, 86],
    ]) {
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x1, y + (y - 80) * 0.6);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  faceCache.set(face, tex);
  return tex;
}

const shirtCache = new Map<string, THREE.Texture>();

/** The T-shirt's print: a pattern over the shirt colour, in a lighter (or, on pale shirts, darker) shade. */
function shirtTexture(pattern: Pattern, color: number): THREE.Texture {
  const key = `${pattern}${color}`;
  const hit = shirtCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d')!;
  const base = new THREE.Color(color);
  g.fillStyle = `#${base.getHexString()}`;
  g.fillRect(0, 0, 128, 128);
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  const accent = new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l > 0.6 ? hsl.l - 0.3 : Math.min(0.95, hsl.l + 0.35));
  const ink = pattern === 'stripe' ? '#ffffff' : `#${accent.getHexString()}`;
  g.fillStyle = ink;
  g.strokeStyle = ink;
  if (pattern === 'stripe') g.fillRect(0, 44, 128, 22);
  else if (pattern === 'stripes') for (let y = 6; y < 128; y += 32) g.fillRect(0, y, 128, 14);
  else if (pattern === 'dots') {
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        g.beginPath();
        g.arc(16 + x * 32 + (y % 2) * 16, 16 + y * 32, 8, 0, Math.PI * 2);
        g.fill();
      }
  } else if (pattern === 'star') {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 18 : 44;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      g.lineTo(64 + Math.cos(a) * r, 68 + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  } else if (pattern === 'split') g.fillRect(64, 0, 64, 128);
  else if (pattern === 'zigzag') {
    g.lineWidth = 12;
    for (const y of [40, 88]) {
      g.beginPath();
      for (let x = 0; x <= 128; x += 16) g.lineTo(x, y + (x % 32 ? 10 : -10));
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  shirtCache.set(key, tex);
  return tex;
}

/** A player's look: colours, plus (optional, for the profile editor) head, face, hat, shirt print and parachute. */
export interface Outfit {
  skin: number;
  shirt: number;
  pants: number;
  /** The hat's (and the crash helmet's) colour. */
  cap: number;
  head?: Head;
  face?: Face;
  hat?: Hat;
  pattern?: Pattern;
  chute?: number;
}

export const DEFAULT_OUTFIT: Outfit = { skin: 0xf7c873, shirt: 0xff7a1a, pants: 0x2f5fc4, cap: 0xe63946 };

/** Builds a hat at the origin (the top of the head), facing -z. Returns it and any part that spins. */
function makeHat(hat: Hat, color: number): { group: THREE.Group; spinner: THREE.Object3D | null } {
  const group = new THREE.Group();
  let spinner: THREE.Object3D | null = null;
  const m = new THREE.MeshLambertMaterial({ color });
  const dark = new THREE.MeshLambertMaterial({ color: 0x24263a });
  const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const gold = new THREE.MeshPhongMaterial({ color: 0xffc84a, emissive: 0x4a3000, shininess: 100, side: THREE.DoubleSide });
  const rounded = (w: number, h: number, d: number, r = 0.07) => new RoundedBoxGeometry(w, h, d, 2, r);
  const put = (mesh: THREE.Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  if (hat === 'cap') {
    put(new THREE.Mesh(rounded(0.64, 0.22, 0.64, 0.08), m), 0, -0.03, 0);
    put(new THREE.Mesh(rounded(0.52, 0.05, 0.32, 0.02), m), 0, -0.12, -0.42);
  } else if (hat === 'beanie' || hat === 'propeller') {
    const dome = put(new THREE.Mesh(new THREE.SphereGeometry(0.36, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), m), 0, -0.1, 0);
    dome.scale.y = 0.85;
    put(new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.06, 8, 28).rotateX(Math.PI / 2), hat === 'beanie' ? white : dark), 0, -0.08, 0);
    if (hat === 'beanie') put(new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), white), 0, 0.24, 0);
    else {
      put(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.18, 8), dark), 0, 0.26, 0);
      const prop = new THREE.Group();
      prop.position.y = 0.35;
      const blades: [number, number][] = [
        [0xff4d5e, 0],
        [0x3fb6ff, Math.PI / 2],
        [0xffd23f, Math.PI],
        [0x3ccf5a, Math.PI * 1.5],
      ];
      for (const [c, a] of blades) {
        const blade = new THREE.Mesh(rounded(0.3, 0.03, 0.1, 0.012), new THREE.MeshLambertMaterial({ color: c }));
        blade.position.set(Math.cos(a) * 0.16, 0, Math.sin(a) * 0.16);
        blade.rotation.y = -a;
        prop.add(blade);
      }
      group.add(prop);
      spinner = prop;
    }
  } else if (hat === 'tophat') {
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.05, 32), dark), 0, -0.02, 0);
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.55, 28), dark), 0, 0.27, 0);
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.305, 0.305, 0.1, 28), m), 0, 0.06, 0);
  } else if (hat === 'cowboy') {
    const brim = put(new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 32), m), 0, -0.02, 0);
    brim.scale.z = 0.85;
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.32, 24), m), 0, 0.15, 0);
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.325, 0.325, 0.07, 24), dark), 0, 0.04, 0);
  } else if (hat === 'crown') {
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.16, 24, 1, true), gold), 0, 0.04, 0);
    const jewel = new THREE.MeshPhongMaterial({ color, shininess: 120 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      put(new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 8), gold), Math.cos(a) * 0.28, 0.2, Math.sin(a) * 0.28);
      put(new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), jewel), Math.cos(a) * 0.3, 0.05, Math.sin(a) * 0.3);
    }
  } else if (hat === 'party') {
    put(new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.6, 24), m), 0, 0.26, 0);
    put(new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.04, 8, 20).rotateX(Math.PI / 2), white), 0, 0.08, 0);
    put(new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), white), 0, 0.58, 0);
  }
  return { group, spinner };
}

/**
 * A blocky avatar with rounded edges: a head with a drawn face, a hat, a printed T-shirt, jeans and sneakers.
 * The player faces away from the camera (-z), so the camera sees their back and the parachute pack.
 */
export function makePlayer(outfit: Outfit = DEFAULT_OUTFIT): PlayerRig {
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.9;
  group.add(body);

  const rounded = (w: number, h: number, d: number, r = 0.07) => new RoundedBoxGeometry(w, h, d, 2, r);
  const skin = new THREE.MeshLambertMaterial({ color: outfit.skin });
  const shirt = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const sleeveMat = new THREE.MeshLambertMaterial({ color: outfit.shirt });
  const pants = new THREE.MeshLambertMaterial({ color: outfit.pants });
  const shoe = new THREE.MeshLambertMaterial({ color: 0x24263a });

  const torso = new THREE.Mesh(rounded(0.82, 0.72, 0.42), shirt);
  const headGeos: Record<Head, THREE.BufferGeometry> = {
    block: rounded(0.6, 0.6, 0.6, 0.15),
    round: new THREE.SphereGeometry(0.37, 28, 18),
    tall: rounded(0.54, 0.74, 0.56, 0.14),
  };
  const head = new THREE.Mesh(headGeos.block, skin);
  head.position.y = 0.68;
  const faceMat = new THREE.MeshBasicMaterial({ map: faceTexture(), transparent: true });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), faceMat);
  face.rotation.y = Math.PI;
  face.position.set(0, 0.66, -0.306);
  const pack = new THREE.Mesh(rounded(0.6, 0.62, 0.24), new THREE.MeshLambertMaterial({ color: 0x2b6cb0 }));
  pack.position.set(0, 0.04, 0.32);

  const arms: THREE.Group[] = [];
  const legs: THREE.Group[] = [];
  const armGeo = rounded(0.34, 0.72, 0.38);
  const sleeveGeo = rounded(0.37, 0.26, 0.41);
  const legGeo = rounded(0.38, 0.5, 0.4);
  const shoeGeo = rounded(0.4, 0.14, 0.48, 0.05);
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.6, 0.3, 0);
    const arm = new THREE.Mesh(armGeo, skin);
    arm.position.y = -0.3;
    const sleeve = new THREE.Mesh(sleeveGeo, sleeveMat);
    sleeve.position.y = -0.08;
    shoulder.add(arm, sleeve);
    const hip = new THREE.Group();
    hip.position.set(side * 0.2, -0.36, 0);
    const leg = new THREE.Mesh(legGeo, pants);
    leg.position.y = -0.25;
    const foot = new THREE.Mesh(shoeGeo, shoe);
    foot.position.set(0, -0.48, -0.04);
    hip.add(leg, foot);
    body.add(shoulder, hip);
    arms.push(shoulder);
    legs.push(hip);
  }
  const capGroup = new THREE.Group();
  body.add(torso, head, face, capGroup, pack);
  // A glossy crash helmet: a rounded shell in the cap's colour with a white racing stripe, goggles pushed up on
  // the front, and a chin strap. Smooth, so it catches the light.
  const helmet = new THREE.Group();
  const shellMat = new THREE.MeshPhongMaterial({ color: outfit.cap, shininess: 110, specular: 0xffffff });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.47, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), shellMat);
  shell.scale.set(1, 0.95, 1.05);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.43, 0.05, 10, 40).rotateX(Math.PI / 2),
    new THREE.MeshPhongMaterial({ color: 0x24263a, shininess: 40 }),
  );
  rim.position.y = 0.06;
  const racing = new THREE.Mesh(
    new THREE.SphereGeometry(0.48, 32, 16, -0.12, 0.24, 0, Math.PI * 0.55),
    new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 110 }),
  );
  racing.rotation.y = Math.PI / 2;
  racing.scale.set(1, 0.95, 1.05);
  const goggleMat = new THREE.MeshPhongMaterial({ color: 0x9de4ff, emissive: 0x1d5f88, shininess: 150, specular: 0xffffff });
  const frameMat = new THREE.MeshPhongMaterial({ color: 0xffc84a, shininess: 90 });
  for (const side of [-1, 1]) {
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 12), goggleMat);
    lens.scale.z = 0.5;
    lens.position.set(side * 0.14, 0.2, -0.43);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 8, 24), frameMat);
    ring.position.set(side * 0.14, 0.2, -0.45);
    helmet.add(lens, ring);
  }
  const strap = new THREE.Mesh(
    new THREE.TorusGeometry(0.33, 0.03, 8, 24, Math.PI).rotateY(Math.PI / 2),
    new THREE.MeshPhongMaterial({ color: 0x24263a }),
  );
  strap.rotation.z = Math.PI;
  strap.position.y = 0.0;
  helmet.add(shell, rim, racing, strap);
  helmet.position.y = 0.8;
  helmet.visible = false;
  body.add(helmet);

  // Parachute, scaled from 0 when it opens.
  const chute = new THREE.Group();
  chute.position.set(0, 1.3, 0.3);
  const canopyMat = flat(0xff4d6d, { side: THREE.DoubleSide });
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), canopyMat);
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

  const rig: PlayerRig = {
    group,
    body,
    chute,
    arms,
    legs,
    cap: capGroup,
    helmet,
    spinner: null,
    dress(o: Outfit) {
      skin.color.setHex(o.skin);
      pants.color.setHex(o.pants);
      sleeveMat.color.setHex(o.shirt);
      shirt.map = shirtTexture(o.pattern ?? 'stripe', o.shirt);
      shirt.needsUpdate = true;
      shellMat.color.setHex(o.cap);
      canopyMat.color.setHex(o.chute ?? 0xff4d6d);
      faceMat.map = faceTexture(o.face ?? 'smile');
      faceMat.needsUpdate = true;
      // Head shape: the face and the hat sit on its front and top.
      const shape = o.head ?? 'block';
      head.geometry = headGeos[shape];
      const top = shape === 'block' ? 0.98 : shape === 'round' ? 1.03 : 1.05;
      face.position.set(0, shape === 'tall' ? 0.7 : 0.66, shape === 'round' ? -0.375 : shape === 'tall' ? -0.29 : -0.306);
      face.scale.setScalar(shape === 'round' ? 0.82 : 1);
      capGroup.clear();
      const hat = makeHat(o.hat ?? 'cap', o.cap);
      hat.group.position.y = top;
      hat.group.traverse((m) => {
        if (m instanceof THREE.Mesh) m.castShadow = true;
      });
      capGroup.add(hat.group);
      rig.spinner = hat.spinner;
    },
  };
  rig.dress(outfit);
  return rig;
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
const meteorRockMat = flat(0x5a4436);
const meteorCraterMat = flat(0x3a2a22);
const satBodyMat = flat(0xd9a531, { emissive: 0x3a2600 });
const satPanelMat = flat(0x2a4fa8, { emissive: 0x0a1640 });
const satFrameMat = flat(0xc9ced8);

/** A satellite for the Edge of Space: a gold-foil body, two blue solar wings and a dish, turning slowly. */
export function makeSatellite(): BirdRig {
  const group = new THREE.Group();
  const sat = new THREE.Group();
  sat.add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), satBodyMat));
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8).rotateZ(Math.PI / 2), satFrameMat);
    arm.position.x = side * 0.7;
    // The panels face the camera (the flight is seen from the side).
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.8, 0.06), satPanelMat);
    panel.position.x = side * 1.7;
    // Thin frame lines across the panel, like solar cells.
    for (let i = -1; i <= 1; i++) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.82, 0.08), satFrameMat);
      line.position.set(side * 1.7 + i * 0.4, 0, 0);
      sat.add(line);
    }
    sat.add(arm, panel);
  }
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 10, 0, Math.PI * 2, 0, Math.PI / 3), satFrameMat);
  dish.position.y = 0.95;
  dish.rotation.x = Math.PI;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6), satFrameMat);
  mast.position.y = 0.6;
  const blink = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3b3b }));
  blink.position.set(0, -0.5, 0);
  sat.add(dish, mast, blink);
  group.add(sat);
  return { group, wings: [], spinner: sat, flash: blink };
}

/** A meteor for Outer Space: a tumbling cratered rock. */
export function makeMeteor(): BirdRig {
  const group = new THREE.Group();
  const rock = new THREE.Group();
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), meteorRockMat);
  body.scale.set(1, 0.85, 0.95);
  rock.add(body);
  for (let i = 0; i < 4; i++) {
    const crater = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), meteorCraterMat);
    const a = i * 1.7;
    crater.position.set(Math.cos(a) * 0.72, Math.sin(a * 1.3) * 0.5, Math.sin(a) * 0.6);
    crater.scale.setScalar(0.6 + (i % 2) * 0.4);
    rock.add(crater);
  }
  group.add(rock);
  return { group, wings: [], spinner: rock };
}

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

export interface GemRig {
  group: THREE.Group;
  gem: THREE.Mesh;
}

/** How large gems float in the sky, so they read from the chase camera. */
export const GEM_SCALE = { small: 1.5, big: 2.4 };
const gemGeo = new THREE.OctahedronGeometry(0.42, 0);
const gemMats = new Map<number, THREE.MeshLambertMaterial>();
const gemHaloMats = new Map<number, THREE.SpriteMaterial>();
const gemOutline = new THREE.MeshBasicMaterial({ color: 0x1d2340, side: THREE.BackSide });

/** A faceted gem with a soft glow, in its zone's colour; big ones are larger and gold-rimmed. */
/** Celestial gems (Outer Space) shimmer through every colour: their shared material and halo cycle hue. */
export function animateGems(t: number): void {
  const color = ZONES[ZONES.length - 1].gemColor;
  const mat = gemMats.get(color);
  const halo = gemHaloMats.get(color);
  const hue = (t * 0.25) % 1;
  mat?.color.setHSL(hue, 0.85, 0.72);
  mat?.emissive.setHSL(hue, 0.9, 0.4);
  halo?.color.setHSL((hue + 0.1) % 1, 1, 0.75);
}

export function makeGem(color: number, big: boolean): GemRig {
  let mat = gemMats.get(color);
  if (!mat) {
    mat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.45, flatShading: true });
    gemMats.set(color, mat);
  }
  let halo = gemHaloMats.get(color);
  if (!halo) {
    halo = new THREE.SpriteMaterial({ map: softTexture(), color, transparent: true, depthWrite: false, opacity: 0.7 });
    gemHaloMats.set(color, halo);
  }
  const group = new THREE.Group();
  const gem = new THREE.Mesh(gemGeo, mat);
  gem.scale.set(1, 1.35, 1);
  const shell = new THREE.Mesh(gemGeo, gemOutline);
  shell.scale.setScalar(1.1);
  gem.add(shell);
  const glow = new THREE.Sprite(halo);
  glow.scale.setScalar(big ? 3.2 : 2);
  group.add(glow, gem);
  group.scale.setScalar(big ? GEM_SCALE.big : GEM_SCALE.small);
  return { group, gem };
}

export interface GuideRig {
  /** Hovers over the objective, pointing down at it. */
  marker: THREE.Group;
  /** Lies on the ground by the player, pointing toward the objective. */
  ground: THREE.Object3D;
}

/** The tutorial's green arrows. */
/** How many chevrons the ground trail can show at once. */
export const GUIDE_CHEVRONS = 16;

export function makeGuide(): GuideRig {
  const green = new THREE.MeshLambertMaterial({ color: 0x3ccf5a, emissive: 0x1f8a35, emissiveIntensity: 0.8 });
  const ink = new THREE.MeshBasicMaterial({ color: 0x1d2340, side: THREE.BackSide });
  const marker = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.9, 0.42), green);
  shaft.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.95, 4), green);
  head.rotation.x = Math.PI;
  head.rotation.y = Math.PI / 4;
  head.position.y = 0.05;
  for (const part of [shaft, head]) {
    const shell = new THREE.Mesh(part.geometry, ink);
    shell.scale.setScalar(1.12);
    part.add(shell);
  }
  marker.add(shaft, head);
  marker.visible = false;

  // A trail of chevrons on the ground, from the player to the objective (see Game.updateGuide).
  const shape = new THREE.Shape();
  shape.moveTo(-0.62, -0.28);
  shape.lineTo(0, 0.2);
  shape.lineTo(0.62, -0.28);
  shape.lineTo(0.62, 0.02);
  shape.lineTo(0, 0.5);
  shape.lineTo(-0.62, 0.02);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  const fillMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, depthWrite: false });
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0x1d1640, transparent: true, depthWrite: false });
  const ground = new THREE.Group();
  for (let i = 0; i < GUIDE_CHEVRONS; i++) {
    const chevron = new THREE.Group();
    const fill = new THREE.Mesh(geo, fillMat.clone());
    fill.position.y = 0.01;
    fill.renderOrder = 2;
    const edge = new THREE.Mesh(geo, edgeMat.clone());
    edge.scale.setScalar(1.22);
    edge.position.z = 0.04;
    edge.renderOrder = 1;
    chevron.add(edge, fill);
    ground.add(chevron);
  }
  ground.visible = false;
  return { marker, ground };
}
