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
  shadow: THREE.Mesh;
  updateDecor(cameraY: number): void;
  /** Animates the scenery and recolours the sky dome and fog for the current height. */
  updateScenery(t: number, sky: THREE.Color, fog: THREE.Fog, camera: THREE.Vector3): void;
  /** Redraws a leaderboard in the street (0: left, 1: right). */
  drawBoard(index: number, title: string, rows: BoardRow[]): void;
}

export function buildEnv(scene: THREE.Scene): Env {
  scene.add(new THREE.HemisphereLight(0xdcefff, 0x5f8a45, 1.05));
  // A warm sun casting soft shadows over the base, the cannon and the trees around them.
  const sun = new THREE.DirectionalLight(0xfff0d6, 1.9);
  sun.target.position.set(0, 0, -10);
  sun.position.set(30, 80, -10 + 50);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 45, bottom: -45, near: 10, far: 200 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  const scenery = addScenery(scene);
  const dome = makeSkyDome();
  scene.add(dome.mesh);
  const horizon = new THREE.Color();
  const white = new THREE.Color(0xffffff);

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
    drawBoard(index, title, rows) {
      scenery.drawBoard(index, title, rows);
    },
    updateScenery(t, sky, fog, camera) {
      scenery.update(t);
      horizon.copy(sky).lerp(white, 0.3);
      fog.color.copy(horizon);
      dome.update(sky, horizon, camera);
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

/** A simple cartoon face drawn on a canvas: two tall eyes and a smile. */
function faceTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#1d1d24';
  for (const x of [44, 84]) {
    g.beginPath();
    g.ellipse(x, 52, 8, 13, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#ffffff';
  for (const x of [41, 81]) {
    g.beginPath();
    g.arc(x, 46, 3.5, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = '#1d1d24';
  g.lineWidth = 7;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(64, 74, 22, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A blocky avatar with rounded edges: square head with a drawn face, a cap, a T-shirt, jeans and sneakers.
 * The player faces away from the camera (-z), so the camera sees their back and the parachute pack.
 */
/** A player's colours. */
export interface Outfit {
  skin: number;
  shirt: number;
  pants: number;
  cap: number;
}

export const DEFAULT_OUTFIT: Outfit = { skin: 0xf7c873, shirt: 0xff7a1a, pants: 0x2f5fc4, cap: 0xe63946 };

export function makePlayer(outfit: Outfit = DEFAULT_OUTFIT): PlayerRig {
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.9;
  group.add(body);

  const rounded = (w: number, h: number, d: number, r = 0.07) => new RoundedBoxGeometry(w, h, d, 2, r);
  const skin = new THREE.MeshLambertMaterial({ color: outfit.skin });
  const shirt = new THREE.MeshLambertMaterial({ color: outfit.shirt });
  const pants = new THREE.MeshLambertMaterial({ color: outfit.pants });
  const shoe = new THREE.MeshLambertMaterial({ color: 0x24263a });
  const cap = new THREE.MeshLambertMaterial({ color: outfit.cap });

  const torso = new THREE.Mesh(rounded(0.82, 0.72, 0.42), shirt);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.83, 0.12, 0.43), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  stripe.position.y = 0.1;
  const head = new THREE.Mesh(rounded(0.6, 0.6, 0.6, 0.15), skin);
  head.position.y = 0.68;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.5),
    new THREE.MeshBasicMaterial({ map: faceTexture(), transparent: true }),
  );
  face.rotation.y = Math.PI;
  face.position.set(0, 0.66, -0.306);
  const crown = new THREE.Mesh(rounded(0.64, 0.22, 0.64, 0.08), cap);
  crown.position.y = 0.95;
  const brim = new THREE.Mesh(rounded(0.52, 0.05, 0.32, 0.02), cap);
  brim.position.set(0, 0.86, -0.42);
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
    const sleeve = new THREE.Mesh(sleeveGeo, shirt);
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
  body.add(torso, stripe, head, face, crown, brim, pack);

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

  const shape = new THREE.Shape();
  shape.moveTo(-0.28, -0.7);
  shape.lineTo(0.28, -0.7);
  shape.lineTo(0.28, 0.1);
  shape.lineTo(0.65, 0.1);
  shape.lineTo(0, 0.85);
  shape.lineTo(-0.65, 0.1);
  shape.lineTo(-0.28, 0.1);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  // Bright gold on a thick ink outline, so it never blends into the grass.
  const ground = new THREE.Group();
  const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffd23f, depthWrite: false }));
  fill.position.y = 0.02;
  fill.renderOrder = 2;
  const edge = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x1d1640, depthWrite: false }));
  edge.scale.setScalar(1.28);
  edge.position.z = 0.05;
  edge.renderOrder = 1;
  ground.add(edge, fill);
  ground.scale.setScalar(1.3);
  ground.visible = false;
  return { marker, ground };
}
