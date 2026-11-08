// Character models: primitive shapes per roster character, each with an idle animation, drawn cel-shaded
// with a dark outline, round cartoon eyes and a smile. Every model faces +z, stands on y = 0 and is about
// 1.2 m tall. Geometries and materials are cached, so building and dropping rigs leaks nothing.
import * as THREE from 'three';
import { RARITIES } from './config';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { makeCloud, softTexture } from './world';

export interface CharacterRig {
  group: THREE.Group;
  figure: THREE.Group;
  cloud: THREE.Group;
  halo: THREE.Sprite;
  animate(t: number): void;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<number, THREE.MeshToonMaterial>();

/** Three flat bands of light: the cartoon look. */
const toonRamp = (() => {
  const tex = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
})();

function toon(color: number, extra: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonRamp, ...extra });
}

/** Shared clock for the Mythic rainbow. */
const rainbowTime = { value: 0 };
const rainbowCache = new Map<THREE.Material, THREE.MeshToonMaterial>();

/**
 * A Mythic's shimmering rainbow: the same cel-shaded material, with bands of rainbow colour that sweep up and
 * around the model over time. The light bands still show through (it tints by brightness), so it keeps its shape.
 */
function rainbowOf(source: THREE.MeshToonMaterial): THREE.MeshToonMaterial {
  let m = rainbowCache.get(source);
  if (m) return m;
  m = source.clone();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRainbowTime = rainbowTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRainbowPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRainbowPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRainbowPos;\nuniform float uRainbowTime;')
      .replace(
        '#include <tonemapping_fragment>',
        `float rbPhase = vRainbowPos.y * 0.9 + (vRainbowPos.x + vRainbowPos.z) * 0.35 - uRainbowTime * 0.45;
        vec3 rb = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + rbPhase));
        float rbLum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, rb * (0.3 + rbLum * 1.15), 0.62);
        #include <tonemapping_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'mythic-rainbow';
  rainbowCache.set(source, m);
  return m;
}

const celestialCache = new Map<THREE.Material, THREE.MeshToonMaterial>();

/**
 * A Celestial's shading: a slow-moving nebula of deep blue, violet and cyan over the whole body, flecked with
 * gold stars that twinkle. Like the Mythic rainbow, it keeps the cel shading's light bands underneath.
 */
function celestialOf(source: THREE.MeshToonMaterial): THREE.MeshToonMaterial {
  let m = celestialCache.get(source);
  if (m) return m;
  m = source.clone();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRainbowTime = rainbowTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCelPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCelPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCelPos;\nuniform float uRainbowTime;')
      .replace(
        '#include <tonemapping_fragment>',
        `float celW = 0.5 + 0.5 * sin(vCelPos.y * 2.4 + vCelPos.x * 1.3 - uRainbowTime * 0.7);
        float celV = 0.5 + 0.5 * sin(vCelPos.z * 3.1 + vCelPos.y * 0.8 + uRainbowTime * 0.5);
        vec3 neb = mix(vec3(0.06, 0.05, 0.32), vec3(0.55, 0.22, 0.95), celW);
        neb = mix(neb, vec3(0.25, 0.85, 1.0), celV * 0.45);
        float celLum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
        vec3 cell = floor(vCelPos * 16.0);
        float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        float star = step(0.9, h) * (0.5 + 0.5 * sin(uRainbowTime * 4.0 + h * 40.0));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, neb * (0.45 + celLum * 1.1), 0.82) + vec3(1.0, 0.86, 0.45) * star * 1.3;
        #include <tonemapping_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'celestial-nebula';
  celestialCache.set(source, m);
  return m;
}

/** Back faces in ink, a little larger than each part: an outline that works for any shape. */
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x1d2340, side: THREE.BackSide });

function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let geo = geoCache.get(key);
  if (!geo) {
    geo = make();
    geoCache.set(key, geo);
  }
  return geo;
}

function mat(color: number): THREE.MeshToonMaterial {
  let m = matCache.get(color);
  if (!m) {
    m = toon(color);
    matCache.set(color, m);
  }
  return m;
}

const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T => {
  o.position.set(x, y, z);
  return o;
};
// Every shape is smooth and rounded: boxes have soft edges, balls and cylinders are finely divided, so the
// cel shading reads as clean bands of light rather than facets.
const box = (w: number, h: number, d: number, m: THREE.Material) =>
  new THREE.Mesh(
    cached(`box${w},${h},${d}`, () => new RoundedBoxGeometry(w, h, d, 3, Math.min(w, h, d) * 0.24)),
    m,
  );
const ball = (r: number, m: THREE.Material, _detail = 1) =>
  new THREE.Mesh(cached(`ball${r}`, () => new THREE.SphereGeometry(r, 28, 18)), m);
const cyl = (top: number, bottom: number, h: number, m: THREE.Material, seg = 10) =>
  new THREE.Mesh(cached(`cyl${top},${bottom},${h},${seg}`, () => new THREE.CylinderGeometry(top, bottom, h, Math.max(20, seg * 2))), m);
const cone = (r: number, h: number, m: THREE.Material, seg = 8) =>
  new THREE.Mesh(cached(`cone${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, Math.max(16, seg * 2))), m);
const ring = (r: number, tube: number, m: THREE.Material) =>
  new THREE.Mesh(cached(`ring${r},${tube}`, () => new THREE.TorusGeometry(r, tube, 12, 32)), m);
/** A capsule lying along x. */
const pill = (r: number, len: number, m: THREE.Material) =>
  new THREE.Mesh(cached(`pill${r},${len}`, () => new THREE.CapsuleGeometry(r, len, 8, 20).rotateZ(Math.PI / 2)), m);

const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const pupilMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
const mouthMat = new THREE.MeshBasicMaterial({ color: 0x3a1020 });
const cheekMat = new THREE.MeshBasicMaterial({ color: 0xff8fae, transparent: true, opacity: 0.7, depthWrite: false });
/** Parts that never get an outline: eyes, mouths, glows and see-through bits. */
const NO_OUTLINE = new Set<THREE.Material>([eyeMat, pupilMat, mouthMat, outlineMat, cheekMat]);

/** Eye groups made while a model is being built, so the character can blink them. */
let eyeCollector: THREE.Object3D[] | null = null;

/**
 * Two big glossy cartoon eyes on a face at depth z, centred on x: a white, a big pupil, two shines, and rosy
 * cheeks under them. Each eye is its own group, so it can blink (squash flat and open again).
 */
function eyes(parent: THREE.Object3D, x: number, y: number, z: number, spread = 0.11): void {
  const r = Math.min(0.135, Math.max(0.075, spread * 0.9));
  for (const side of [-1, 1]) {
    const eye = at(new THREE.Group(), x + side * spread, y, z);
    const white = ball(r, eyeMat);
    white.scale.z = 0.55;
    const pupil = at(ball(r * 0.62, pupilMat), side * r * 0.1, -r * 0.08, r * 0.4);
    pupil.scale.z = 0.5;
    const shine = at(ball(r * 0.24, eyeMat), -r * 0.22, r * 0.28, r * 0.66);
    const glint = at(ball(r * 0.11, eyeMat), r * 0.2, -r * 0.25, r * 0.66);
    eye.add(white, pupil, shine, glint);
    parent.add(eye);
    eyeCollector?.push(eye);
    const cheek = at(ball(r * 0.55, cheekMat), x + side * (spread + r * 0.7), y - r * 1.25, z - r * 0.15);
    cheek.scale.set(1, 0.6, 0.3);
    parent.add(cheek);
  }
}

/** A curved smile at depth z. */
function smile(parent: THREE.Object3D, x: number, y: number, z: number, w = 0.12): void {
  const mouth = new THREE.Mesh(
    cached(`smile${w}`, () => new THREE.TorusGeometry(w, w * 0.28, 8, 20, Math.PI)),
    mouthMat,
  );
  mouth.rotation.z = Math.PI;
  parent.add(at(mouth, x, y, z));
}

const smokeMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 });
const bulbMat = new THREE.MeshLambertMaterial({ color: 0xfff3a6, emissive: 0xffd84a, emissiveIntensity: 1 });
NO_OUTLINE.add(smokeMat).add(bulbMat);

/** Adds an ink outline to every solid part of a model. */
function outline(figure: THREE.Object3D): void {
  const parts: THREE.Mesh[] = [];
  figure.traverse((o) => {
    if (o instanceof THREE.Mesh && !NO_OUTLINE.has(o.material as THREE.Material)) parts.push(o);
  });
  for (const part of parts) {
    const shell = new THREE.Mesh(part.geometry, outlineMat);
    shell.scale.setScalar(1.09);
    part.add(shell);
  }
}
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
    const feather = mat(0xb9b6d3);
    const wings: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const wing = at(ball(0.2, feather), -0.05, 0.62, side * 0.36);
      wing.scale.set(1.5, 0.55, 0.35);
      wings.push(wing);
      f.add(wing);
      const wheel = at(ring(0.13, 0.04, mat(0x6b4226)), 0.15, 0.17, side * 0.3);
      f.add(wheel, at(ball(0.04, accent), 0.15, 0.17, side * 0.3));
    }
    const tail = at(cone(0.14, 0.3, feather), -0.6, 0.62, 0);
    tail.rotation.z = Math.PI / 2 + 0.3;
    tail.scale.z = 0.4;
    const fuse = at(cyl(0.02, 0.02, 0.18, mat(0xf2e2b8), 6), -0.3, 0.86, -0.12);
    const spark = at(ball(0.05, bulbMat), -0.3, 0.97, -0.12);
    f.add(tail, fuse, spark);
    eyes(f, -0.2, 1, 0.34, 0.09);
    return (t) => {
      const p = (t * 0.7) % 1;
      smoke.position.x = 0.62 + p * 0.9;
      smoke.scale.setScalar(0.6 + p * 1.2);
      smoke.visible = p < 0.85;
      // A little kick back as each ring puffs out.
      barrel.position.x = 0.05 - Math.max(0, 0.08 - p) * 0.8;
      wings.forEach((w, i) => (w.rotation.x = (i ? 1 : -1) * Math.sin(t * 6) * 0.25));
      spark.scale.setScalar(0.7 + Math.abs(Math.sin(t * 25)) * 0.6);
    };
  },

  // Toaster with dove wings; pops toast out of its top.
  'Tostino Tortorino': (f, accent) => {
    const body = at(box(0.9, 0.62, 0.56, mat(CHROME)), 0, 0.42, 0);
    const dark = mat(0x2b2b33);
    const toast = at(box(0.36, 0.4, 0.07, mat(WAFFLE)), 0, 0.6, -0.08);
    f.add(body, toast, at(box(0.42, 0.03, 0.1, dark), 0, 0.735, -0.08), at(box(0.42, 0.03, 0.1, dark), 0, 0.735, 0.1));
    f.add(at(box(0.08, 0.16, 0.08, accent), 0.49, 0.45, 0));
    smile(f, 0, 0.36, 0.29, 0.1);
    const wings: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const pivot = at(new THREE.Group(), side * 0.45, 0.58, 0);
      pivot.add(at(box(0.5, 0.06, 0.3, mat(0xffffff)), side * 0.25, 0, 0));
      f.add(pivot);
      wings.push(pivot);
      f.add(at(box(0.12, 0.11, 0.2, dark), side * 0.3, 0.06, 0));
    }
    eyes(f, 0, 0.5, 0.29, 0.13);
    const butter = at(box(0.14, 0.05, 0.1, mat(0xffe680)), 0, 0.2, 0.02);
    toast.add(butter);
    for (const x of [-0.3, 0.3]) {
      const dial = at(cyl(0.06, 0.06, 0.04, mat(0x2b2b33), 12), x, 0.2, 0.29);
      dial.rotation.x = Math.PI / 2;
      f.add(dial);
    }
    return (t) => {
      // Toast pops up fast and settles back slowly, with a squash of the toaster as it fires.
      const pop = Math.max(0, Math.sin(t * 2.2));
      toast.position.y = 0.6 + pop * 0.35;
      toast.rotation.z = Math.sin(t * 2.2) * 0.15 * pop;
      body.scale.set(1 + (1 - pop) * 0.03, 1 - (1 - pop) * 0.04, 1);
      const flap = Math.sin(t * 10) * 0.5;
      wings[0].rotation.z = -flap;
      wings[1].rotation.z = flap;
    };
  },

  // Snail with a lightbulb shell; the bulb flickers (shared material, see animateShared).
  'Lampadino Lumachino': (f, accent) => {
    const slime = mat(0x86c95b);
    const foot = at(pill(0.16, 0.85, slime), 0, 0.16, 0);
    const neck = at(new THREE.Group(), 0.48, 0.2, 0);
    const headPart = at(ball(0.22, slime), 0, 0.24, 0);
    headPart.scale.set(1, 1.25, 1);
    neck.add(headPart);
    const stalks: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const stalk = at(new THREE.Group(), side * 0.08, 0.46, 0.04);
      stalk.add(at(cyl(0.025, 0.03, 0.3, slime, 6), 0, 0.15, 0));
      const eye = at(new THREE.Group(), 0, 0.33, 0.02);
      eye.add(ball(0.08, eyeMat), at(ball(0.045, pupilMat), 0, -0.01, 0.06));
      eyeCollector?.push(eye);
      stalk.add(eye);
      neck.add(stalk);
      stalks.push(stalk);
    }
    smile(neck, 0, 0.16, 0.2, 0.08);
    f.add(foot, neck);
    // The bulb shell: a screw base with threads, glass, and a glowing filament inside.
    const shell = at(new THREE.Group(), -0.12, 0.32, 0);
    shell.add(at(cyl(0.16, 0.2, 0.22, accent), 0, 0, 0));
    for (const y of [-0.06, 0.02, 0.1]) shell.add(at(ring(0.18, 0.025, mat(0xc9ced6)), 0, y, 0)).children.at(-1)!.rotateX(Math.PI / 2);
    shell.add(at(ball(0.36, bulbMat), 0, 0.42, 0));
    f.add(shell);
    return (t) => {
      // An inchworm crawl: the foot stretches and squashes, the stalks wobble on their own.
      const crawl = Math.sin(t * 2.4);
      foot.scale.set(1 + crawl * 0.08, 1 - crawl * 0.06, 1);
      neck.position.x = 0.48 + crawl * 0.05;
      stalks.forEach((s, i) => (s.rotation.z = Math.sin(t * 3 + i * 1.7) * 0.25));
      shell.rotation.z = Math.sin(t * 2.4 + 1) * 0.04;
    };
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
    // Bristles in rows of white and blue, and a swirl of toothpaste on top.
    for (let i = 0; i < 6; i++) {
      neck.add(at(box(0.04, 0.12, 0.04, mat(i % 2 ? 0x5ec4ff : 0xffffff)), -0.04 + (i % 2) * 0.08, 1.0, 0 + Math.floor(i / 2) * 0.09));
    }
    neck.add(at(pill(0.05, 0.12, mat(0xffffff)), 0, 1.1, 0.09), at(pill(0.04, 0.08, mat(0x7fe0c0)), 0, 1.14, 0.09));
    eyes(neck, 0, 0.7, 0.07, 0.06);
    f.add(neck);
    const wings: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const wing = at(ball(0.2, mat(0x3b3b44)), -0.05, 0.92, side * 0.36);
      wing.scale.set(1.3, 0.5, 0.3);
      wings.push(wing);
      f.add(wing);
    }
    return (t) => {
      neck.rotation.z = Math.sin(t * 3) * 0.3;
      wings.forEach((w, i) => (w.rotation.x = (i ? 1 : -1) * (0.2 + Math.sin(t * 5) * 0.3)));
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
    const sprinkleColors = [0xffd23f, 0x5ec4ff, 0x3ccf5a, 0xffffff, 0x8a5cff, 0xff5f7e];
    for (let i = 0; i < 12; i++) {
      const a = i * 2.39;
      const y = 0.8 + (i % 4) * 0.035;
      const sprinkle = at(pill(0.012, 0.05, mat(sprinkleColors[i % sprinkleColors.length])), Math.cos(a) * 0.17, y + 0.05, Math.sin(a) * 0.17 - 0.03);
      sprinkle.rotation.set(a, a * 1.3, 0);
      pivot.add(sprinkle);
    }
    pivot.add(at(ball(0.07, mat(0xe63946)), 0, 0.98, 0), at(cyl(0.008, 0.008, 0.1, mat(0x3a7d2c), 4), 0.02, 1.06, 0));
    const drip = at(ball(0.05, mat(0xff9ec7)), 0.16, 0.56, 0.12);
    drip.scale.y = 1.6;
    pivot.add(drip);
    eyes(pivot, 0, 0.74, 0.22, 0.09);
    smile(pivot, 0, 0.62, 0.22, 0.07);
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
    for (const [x, z] of [[-0.1, 0.4], [0.1, 0.42], [0, 0.56], [-0.12, 0.58], [0.12, 0.56]]) {
      f.add(at(cyl(0.045, 0.045, 0.02, mat(0xc8102e), 12), x, 1.065, z));
    }
    f.add(at(ring(0.025, 0.012, mat(0x1d1d24)), 0.05, 1.07, 0.48).rotateX(Math.PI / 2));
    const wings: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const wing = at(ball(0.24, white), side * 0.45, 0.68, -0.05);
      wing.scale.set(0.35, 0.8, 1.1);
      wings.push(wing);
      f.add(wing);
    }
    return (t) => {
      const open = Math.max(0, Math.sin(t * 1.8));
      lid.rotation.x = -open * 1.1;
      // It flaps proudly as it shows the pizza off.
      wings.forEach((w, i) => (w.rotation.z = (i ? -1 : 1) * open * 0.6));
    };
  },
};

const MODELS_STORM: Record<string, Model> = {
  // Turtle that flies with a desk-fan shell; hovers and spins its blades.
  'Ventilatore Tartarughino': (f, accent) => {
    const skin = mat(0x6fb06a);
    const hover = at(new THREE.Group(), 0, 0.2, 0);
    const shell = at(cyl(0.48, 0.52, 0.3, mat(0xe9edf2), 14), 0, 0.5, 0);
    const cage = at(ring(0.46, 0.04, accent), 0, 0.68, 0);
    cage.rotation.x = Math.PI / 2;
    const blades = at(new THREE.Group(), 0, 0.68, 0);
    for (let i = 0; i < 3; i++) {
      const blade = at(box(0.36, 0.03, 0.14, mat(0x8fc8ff)), 0, 0, 0);
      blade.position.set(Math.cos((i * Math.PI * 2) / 3) * 0.2, 0, Math.sin((i * Math.PI * 2) / 3) * 0.2);
      blade.rotation.y = (-i * Math.PI * 2) / 3;
      blades.add(blade);
    }
    hover.add(shell, cage, blades, at(ball(0.2, skin), 0, 0.42, 0.5));
    const feet: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      for (const z of [0.2, -0.25]) {
        const foot = at(ball(0.11, skin), side * 0.44, 0.32, z);
        foot.scale.set(1.3, 0.6, 1);
        feet.push(foot);
        hover.add(foot);
      }
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const plate = at(ball(0.1, mat(0xcfd6de)), Math.cos(a) * 0.4, 0.5, Math.sin(a) * 0.4);
      plate.scale.set(1, 0.4, 1);
      hover.add(plate);
    }
    const tail = at(cone(0.06, 0.18, skin), 0, 0.38, -0.55);
    tail.rotation.x = -Math.PI / 2;
    hover.add(tail);
    eyes(hover, 0, 0.48, 0.68, 0.07);
    smile(hover, 0, 0.36, 0.66, 0.06);
    f.add(hover);
    return (t) => {
      blades.rotation.y = t * 18;
      hover.position.y = 0.2 + Math.sin(t * 2.5) * 0.08;
      feet.forEach((f2, i) => (f2.rotation.x = Math.sin(t * 6 + i * 1.6) * 0.5));
    };
  },

  // Macchiato cup in a ninja mask; flicks a sugar-cube star.
  'Ninja Macchiatino': (f, accent) => {
    const cup = at(cyl(0.38, 0.3, 0.7, mat(0xf4f4f4), 14), 0, 0.38, 0);
    const foam = at(cyl(0.36, 0.36, 0.06, mat(0xe8c9a1), 14), 0, 0.74, 0);
    const mask = at(cyl(0.385, 0.37, 0.16, mat(0x1f1f28), 14), 0, 0.52, 0);
    const handle = at(ring(0.14, 0.04, mat(0xf4f4f4)), 0.42, 0.42, 0);
    const tail = at(box(0.3, 0.06, 0.08, accent), -0.48, 0.58, -0.05);
    tail.rotation.z = 0.4;
    const star = at(box(0.12, 0.12, 0.12, mat(0xffffff)), 0.4, 0.75, 0.2);
    f.add(cup, foam, mask, handle, tail, star);
    const heart = new THREE.Group();
    const art = mat(0xa0663a);
    heart.add(at(ball(0.07, art), -0.05, 0, 0.02), at(ball(0.07, art), 0.05, 0, 0.02));
    const tip = at(cone(0.09, 0.12, art), 0, 0, -0.07);
    tip.rotation.x = -Math.PI / 2;
    heart.add(tip);
    heart.scale.set(1, 0.25, 1);
    heart.position.set(0, 0.775, 0.02);
    f.add(heart);
    const tails: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const band = at(box(0.06, 0.05, 0.3, mat(0x1f1f28)), side * 0.08, 0.55, -0.48);
      tails.push(band);
      f.add(band);
    }
    const steam = [0, 1, 2].map((i) => {
      const puff = at(ball(0.07, smokeMat), 0, 0.85, 0);
      puff.userData.seed = i / 3;
      f.add(puff);
      return puff;
    });
    eyes(f, 0, 0.53, 0.37, 0.11);
    smile(f, 0, 0.3, 0.36, 0.1);
    return (t) => {
      tails.forEach((b, i) => (b.rotation.y = Math.sin(t * 7 + i) * 0.35));
      steam.forEach((s) => {
        const p = (t * 0.5 + (s.userData.seed as number)) % 1;
        s.position.set(Math.sin(p * 9) * 0.08, 0.82 + p * 0.6, 0);
        s.scale.setScalar(0.5 + p);
        s.visible = p < 0.9;
      });
      const p = (t * 0.8) % 1;
      star.position.set(0.4 + p * 1.2, 0.75 + Math.sin(p * Math.PI) * 0.4, 0.2);
      star.rotation.set(t * 9, t * 7, 0);
      star.visible = p < 0.8;
    };
  },

  // Hippo with helicopter blades for a head; lifts off the pad slightly.
  'Elicottero Ippopotamo': (f, accent) => {
    const purple = mat(0x9a8fb8);
    const lift = new THREE.Group();
    const body = at(ball(0.5, purple), 0, 0.6, 0);
    body.scale.set(1.2, 0.95, 1);
    const snout = at(box(0.5, 0.34, 0.3, purple), 0, 0.62, 0.48);
    lift.add(body, snout, at(cyl(0.05, 0.05, 0.3, mat(0x3d4450), 6), 0, 1.15, 0));
    for (const side of [-1, 1]) {
      lift.add(at(cyl(0.12, 0.12, 0.25, purple, 8), side * 0.3, 0.13, 0.15));
      lift.add(at(box(0.05, 0.08, 0.04, pupilMat), side * 0.1, 0.64, 0.64));
    }
    const rotor = at(new THREE.Group(), 0, 1.3, 0);
    rotor.add(box(1.6, 0.04, 0.12, accent), box(0.12, 0.04, 1.6, accent));
    lift.add(rotor);
    for (const side of [-1, 1]) {
      const ear = at(ball(0.09, purple), side * 0.32, 1.02, 0.1);
      ear.scale.set(1, 0.7, 0.5);
      lift.add(ear, at(ball(0.035, pupilMat), side * 0.12, 0.7, 0.64));
    }
    const tailBoom = at(cyl(0.05, 0.09, 0.55, purple, 8), 0, 0.7, -0.75);
    tailBoom.rotation.x = Math.PI / 2 + 0.3;
    const tailRotor = at(new THREE.Group(), 0.06, 0.62, -1.02);
    tailRotor.add(box(0.03, 0.36, 0.06, accent));
    lift.add(tailBoom, tailRotor);
    eyes(lift, 0, 0.98, 0.42, 0.14);
    smile(lift, 0, 0.56, 0.64, 0.12);
    f.add(lift);
    return (t) => {
      rotor.rotation.y = t * 22;
      tailRotor.rotation.x = t * 30;
      lift.position.y = Math.max(0, Math.sin(t * 1.4)) * 0.25;
      // Tips forward a touch as it lifts, like a real helicopter.
      lift.rotation.x = Math.max(0, Math.sin(t * 1.4)) * 0.08;
    };
  },

  // Flamingo with a fridge body and jet-engine legs; the door swings open and mist spills.
  'Frigorifero Fenicottero': (f, accent) => {
    const pink = mat(0xff8fb8);
    const fridge = at(box(0.6, 0.8, 0.5, mat(0xeef3f7)), 0, 0.85, 0);
    const door = at(new THREE.Group(), 0.3, 0.85, 0.25);
    door.add(at(box(0.6, 0.8, 0.05, mat(0xdfe6ec)), -0.3, 0, 0.02), at(box(0.05, 0.3, 0.05, accent), -0.52, 0, 0.07));
    const mist = at(ball(0.18, smokeMat, 1), 0, 0.75, 0.4);
    f.add(fridge, door, mist);
    // Magnets on the door, a freezer line, and a pink wing.
    for (const [x, y, c] of [[-0.42, 0.25, 0xffd23f], [-0.2, 0.18, 0x5ec4ff], [-0.34, -0.1, 0x3ccf5a]] as const) {
      door.add(at(box(0.09, 0.09, 0.04, mat(c)), x, y, 0.07));
    }
    door.add(at(box(0.56, 0.02, 0.02, mat(0xb9c4cf)), -0.3, 0.12, 0.06));
    const wing = at(ball(0.22, pink), -0.32, 0.95, -0.02);
    wing.scale.set(0.3, 0.8, 1.1);
    f.add(wing);
    for (const side of [-1, 1]) {
      f.add(at(cyl(0.04, 0.04, 0.3, pink, 6), side * 0.16, 0.32, 0));
      f.add(at(cyl(0.09, 0.12, 0.2, mat(0x5a606b), 10), side * 0.16, 0.1, 0));
    }
    const neck = at(cyl(0.05, 0.05, 0.5, pink, 6), 0.15, 1.45, 0);
    neck.rotation.z = -0.3;
    const head = at(ball(0.17, pink), 0.25, 1.72, 0.05);
    const beak = at(cone(0.06, 0.2, mat(0x2b2b33), 6), 0.25, 1.62, 0.22);
    beak.rotation.x = Math.PI * 0.7;
    f.add(neck, head, beak);
    eyes(f, 0.25, 1.76, 0.19, 0.07);
    return (t) => {
      const open = Math.max(0, Math.sin(t * 1.2));
      door.rotation.y = -open * 1.4;
      mist.visible = open > 0.3;
      mist.scale.setScalar(0.6 + open);
      mist.position.y = 0.75 - open * 0.3;
    };
  },
};

const MODELS_MYTHIC: Record<string, Model> = {
  // Rhino strapped to a red rocket; the exhaust flickers and it rumbles.
  'Razzo Rinoceronte': (f, accent) => {
    const hide = mat(0x8f939e);
    const rig = new THREE.Group();
    const body = at(ball(0.5, hide, 2), 0, 0.62, 0);
    body.scale.set(1, 0.85, 1.25);
    const head = at(ball(0.32, hide, 2), 0, 0.72, 0.62);
    head.scale.set(1, 0.9, 1.1);
    const horn = at(cone(0.11, 0.38, mat(0xf4ecd8), 8), 0, 0.98, 0.86);
    horn.rotation.x = 0.5;
    const small = at(cone(0.07, 0.18, mat(0xf4ecd8), 8), 0, 0.98, 0.66);
    rig.add(body, head, horn, small);
    for (const side of [-1, 1]) {
      rig.add(at(cyl(0.11, 0.12, 0.3, hide, 8), side * 0.28, 0.15, 0.35));
      rig.add(at(cyl(0.11, 0.12, 0.3, hide, 8), side * 0.28, 0.15, -0.35));
      const ear = at(cone(0.08, 0.16, hide, 6), side * 0.18, 1.0, 0.5);
      rig.add(ear);
    }
    eyes(rig, 0, 0.84, 0.9, 0.13);
    smile(rig, 0, 0.62, 0.92, 0.08);
    // The rocket on its back, with fins, a nose cone and an exhaust flame.
    const rocket = at(new THREE.Group(), 0, 1.25, -0.15);
    rocket.rotation.x = -Math.PI / 2 + 0.25;
    rocket.add(at(cyl(0.2, 0.2, 0.9, mat(0xe63946), 14), 0, 0, 0));
    rocket.add(at(cone(0.2, 0.32, mat(0xffffff), 14), 0, 0.61, 0));
    rocket.add(at(ring(0.2, 0.04, accent), 0, 0.2, 0));
    for (let i = 0; i < 3; i++) {
      const fin = at(box(0.04, 0.26, 0.2, mat(0xffd23f)), 0, -0.35, 0);
      fin.rotation.y = (i * Math.PI * 2) / 3;
      fin.translateZ(0.2);
      rocket.add(fin);
    }
    const flame = at(cone(0.15, 0.5, bulbMat, 10), 0, -0.7, 0);
    flame.rotation.x = Math.PI;
    rocket.add(flame);
    rig.add(rocket);
    f.add(rig);
    return (t) => {
      flame.scale.set(1, 0.7 + Math.abs(Math.sin(t * 23)) * 0.6, 1);
      rig.position.set(Math.sin(t * 40) * 0.012, Math.abs(Math.sin(t * 2)) * 0.06, 0);
    };
  },

  // Kitten with satellite-dish ears that sweep the sky, and an antenna with a blinking light.
  'Satellito Gattino': (f, accent) => {
    const fur = mat(0xff9f43);
    const cream = mat(0xfff1d6);
    const body = at(ball(0.42, fur, 2), 0, 0.5, 0);
    body.scale.set(1, 0.95, 1.1);
    const belly = at(ball(0.3, cream, 2), 0, 0.46, 0.2);
    const head = at(ball(0.36, fur, 2), 0, 1.08, 0.12);
    const muzzle = at(ball(0.14, cream, 1), 0, 0.98, 0.42);
    const nose = at(ball(0.05, mat(0xff6b9a), 1), 0, 1.03, 0.54);
    f.add(body, belly, head, muzzle, nose);
    eyes(f, 0, 1.14, 0.42, 0.13);
    smile(f, 0, 0.93, 0.5, 0.06);
    const dishes: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const pivot = at(new THREE.Group(), side * 0.27, 1.38, 0.08);
      const dish = new THREE.Mesh(
        cached('dish', () => new THREE.SphereGeometry(0.22, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4)),
        mat(0xe9edf2),
      );
      dish.material.side = THREE.DoubleSide;
      dish.rotation.x = -Math.PI / 2;
      const stem = at(cyl(0.025, 0.025, 0.2, mat(0x8f939e), 6), 0, 0, -0.1);
      stem.rotation.x = Math.PI / 2;
      pivot.add(dish, stem, at(ball(0.035, accent, 0), 0, 0, 0.12));
      f.add(pivot);
      dishes.push(pivot);
    }
    const antenna = at(cyl(0.02, 0.02, 0.36, mat(0x8f939e), 6), 0, 1.58, 0);
    const blink = at(ball(0.07, bulbMat, 1), 0, 1.78, 0);
    const tail = at(cyl(0.05, 0.07, 0.6, fur, 8), 0, 0.55, -0.48);
    tail.rotation.x = -0.9;
    for (const side of [-1, 1]) f.add(at(ball(0.1, cream, 1), side * 0.2, 0.1, 0.22));
    f.add(antenna, blink, tail);
    return (t) => {
      dishes.forEach((d, i) => {
        d.rotation.y = Math.sin(t * 1.5 + i * Math.PI) * 0.6;
        d.rotation.x = Math.sin(t * 2.1) * 0.2;
      });
      tail.rotation.z = Math.sin(t * 3) * 0.4;
      blink.visible = Math.sin(t * 6) > -0.2;
    };
  },
};

const MODELS_CELESTIAL: Record<string, Model> = {
  // An owl made of the night sky, wearing a crown of stars, with a ringed planet orbiting it.
  'Galattico Gufo': (f, accent) => {
    const body = at(ball(0.48, mat(0x2a2a6a)), 0, 0.62, 0);
    body.scale.set(1, 1.1, 0.95);
    const belly = at(ball(0.32, mat(0xb9c4ff)), 0, 0.56, 0.24);
    belly.scale.set(1, 1.15, 0.6);
    f.add(body, belly);
    for (const side of [-1, 1]) {
      const tuft = at(cone(0.1, 0.28, mat(0x2a2a6a)), side * 0.26, 1.18, 0);
      tuft.rotation.z = -side * 0.4;
      const wing = at(ball(0.26, mat(0x3b3b8a)), side * 0.46, 0.6, -0.02);
      wing.scale.set(0.35, 1, 0.8);
      f.add(tuft, wing, at(cone(0.06, 0.14, mat(0xffc84a)), side * 0.12, 0.08, 0.2));
    }
    const beak = at(cone(0.06, 0.16, mat(0xffc84a)), 0, 0.78, 0.46);
    beak.rotation.x = Math.PI / 2 + 0.3;
    f.add(beak);
    eyes(f, 0, 0.92, 0.4, 0.15);
    // A crown of gold stars.
    const crown = at(new THREE.Group(), 0, 1.32, 0);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const star = at(ball(0.07, bulbMat), Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2);
      crown.add(star);
    }
    f.add(crown);
    // A little ringed planet in orbit.
    const orbit = at(new THREE.Group(), 0, 0.7, 0);
    const planet = at(new THREE.Group(), 0.85, 0, 0);
    planet.add(ball(0.13, accent));
    const pring = ring(0.2, 0.025, mat(0xffe08a));
    pring.rotation.x = Math.PI / 2 + 0.4;
    planet.add(pring);
    orbit.add(planet);
    f.add(orbit);
    return (t) => {
      orbit.rotation.y = t * 1.2;
      crown.rotation.y = -t * 0.8;
      body.position.y = 0.62 + Math.sin(t * 2) * 0.03;
    };
  },

  // A penguin who is also a planet: a round body circled by a tilted ring of moons, waddling in orbit.
  'Pianeta Pinguino': (f, accent) => {
    const body = at(ball(0.46, mat(0x1d2a5a)), 0, 0.58, 0);
    body.scale.set(1, 1.15, 1);
    const front = at(ball(0.34, mat(0xe8f0ff)), 0, 0.55, 0.2);
    front.scale.set(1, 1.2, 0.6);
    f.add(body, front);
    for (const side of [-1, 1]) {
      const flipper = at(ball(0.2, mat(0x1d2a5a)), side * 0.46, 0.6, 0);
      flipper.scale.set(0.3, 1, 0.6);
      flipper.rotation.z = side * 0.3;
      f.add(flipper, at(ball(0.11, mat(0xffa63c)), side * 0.15, 0.06, 0.12));
    }
    const beak = at(cone(0.07, 0.18, mat(0xffa63c)), 0, 0.86, 0.44);
    beak.rotation.x = Math.PI / 2;
    f.add(beak);
    eyes(f, 0, 0.98, 0.38, 0.13);
    // The planetary ring with little moons on it.
    const tilt = at(new THREE.Group(), 0, 0.6, 0);
    tilt.rotation.set(0.35, 0, 0.25);
    const band = ring(0.72, 0.04, accent);
    band.rotation.x = Math.PI / 2;
    tilt.add(band);
    const moons = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      moons.add(at(ball(0.07, mat(0xfff1c0)), Math.cos(a) * 0.72, 0, Math.sin(a) * 0.72));
    }
    tilt.add(moons);
    f.add(tilt);
    return (t) => {
      moons.rotation.y = t * 1.5;
      // A proud waddle.
      body.rotation.z = Math.sin(t * 3) * 0.06;
      front.rotation.z = body.rotation.z;
    };
  },
};

/** The third brainrot of each rarity. */
const MODELS_EXTRA: Record<string, Model> = {
  // Common: a dachshund made of a long biscuit, wagging its tail.
  'Biscottino Bassotto': (f, accent) => {
    const dough = mat(WAFFLE);
    const dark = mat(0x8a5a2b);
    const body = at(pill(0.24, 0.7, dough), 0, 0.42, 0);
    body.rotation.y = Math.PI / 2;
    const head = at(ball(0.24, dough), 0, 0.62, 0.52);
    const snout = at(ball(0.12, mat(0xe8bb7a)), 0, 0.56, 0.74);
    const nose = at(ball(0.05, mat(0x2b1a10)), 0, 0.6, 0.85);
    f.add(body, head, snout, nose);
    // Chocolate chips dotted along the back, and a collar.
    for (const [x, z] of [[0.12, 0.2], [-0.1, -0.1], [0.08, -0.35], [-0.14, 0.32]]) f.add(at(ball(0.05, dark), x, 0.64, z));
    const collar = at(ring(0.19, 0.04, accent), 0, 0.5, 0.42);
    collar.rotation.x = Math.PI / 2 - 0.3;
    f.add(collar);
    const ears: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const ear = at(ball(0.11, dark), side * 0.22, 0.58, 0.5);
      ear.scale.set(0.4, 1.3, 0.8);
      ears.push(ear);
      f.add(ear);
      for (const z of [0.32, -0.32]) f.add(at(cyl(0.07, 0.08, 0.24, dough), side * 0.13, 0.12, z));
    }
    const tail = at(new THREE.Group(), 0, 0.5, -0.55);
    const tip = at(cyl(0.04, 0.05, 0.3, dough), 0, 0.12, -0.04);
    tip.rotation.x = -0.5;
    tail.add(tip);
    f.add(tail);
    eyes(f, 0, 0.7, 0.72, 0.1);
    return (t) => {
      tail.rotation.z = Math.sin(t * 14) * 0.6;
      ears.forEach((e, i) => (e.rotation.z = (i ? -1 : 1) * Math.sin(t * 7) * 0.15));
      body.scale.set(1, 1, 1 + Math.sin(t * 3) * 0.03);
    };
  },

  // Uncommon: a teddy bear twirling a polka-dot umbrella.
  'Ombrellino Orsetto': (f, accent) => {
    const fur = mat(0xb07a50);
    const light = mat(0xe8c39a);
    const body = at(ball(0.36, fur), 0, 0.42, 0);
    body.scale.set(1, 1.05, 0.9);
    const belly = at(ball(0.24, light), 0, 0.4, 0.17);
    belly.scale.z = 0.6;
    const head = at(ball(0.3, fur), 0, 0.92, 0.04);
    const muzzle = at(ball(0.12, light), 0, 0.86, 0.3);
    const nose = at(ball(0.045, mat(0x2b1a10)), 0, 0.9, 0.42);
    f.add(body, belly, head, muzzle, nose);
    for (const side of [-1, 1]) {
      f.add(at(ball(0.1, fur), side * 0.22, 1.16, 0));
      f.add(at(ball(0.06, light), side * 0.22, 1.16, 0.06));
      f.add(at(ball(0.11, fur), side * 0.18, 0.1, 0.14));
    }
    const arm = at(ball(0.1, fur), 0.32, 0.62, 0.1);
    const brolly = at(new THREE.Group(), 0.34, 0.66, 0.1);
    const handle = at(cyl(0.025, 0.025, 0.9, mat(0x6b4226)), 0, 0.42, 0);
    const canopy = new THREE.Mesh(
      cached('brolly', () => new THREE.ConeGeometry(0.62, 0.3, 8, 1, true)),
      mat(0xff5fa2),
    );
    canopy.material.side = THREE.DoubleSide;
    canopy.position.y = 0.95;
    const dots = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.4;
      dots.add(at(ball(0.06, accent), Math.cos(a) * 0.36, 0.95, Math.sin(a) * 0.36));
    }
    brolly.add(handle, canopy, dots, at(ball(0.05, mat(0x6b4226)), 0, 1.12, 0));
    f.add(arm, brolly);
    eyes(f, 0, 0.98, 0.28, 0.1);
    smile(f, 0, 0.8, 0.36, 0.05);
    return (t) => {
      brolly.rotation.y = t * 2.5;
      brolly.rotation.z = -0.15 + Math.sin(t * 1.6) * 0.08;
      body.rotation.z = Math.sin(t * 1.6) * 0.05;
    };
  },

  // Rare: a sloth curled round a kettle that whistles out puffs of steam.
  'Bollitore Bradipo': (f, accent) => {
    const kettle = at(ball(0.4, mat(CHROME)), 0, 0.42, 0);
    kettle.scale.set(1, 0.85, 1);
    const lid = at(cyl(0.2, 0.26, 0.1, mat(CHROME)), 0, 0.76, 0);
    const knob = at(ball(0.07, accent), 0, 0.84, 0);
    const spout = at(cyl(0.05, 0.1, 0.42, mat(CHROME)), 0.42, 0.56, 0);
    spout.rotation.z = -0.9;
    const handle = at(ring(0.2, 0.04, mat(0x2b2b33)), -0.4, 0.5, 0);
    f.add(kettle, lid, knob, spout, handle);
    // The sloth hugging it from the front: a furry face and two long arms.
    const fur = mat(0x9a7d5e);
    const face = at(ball(0.22, fur), 0, 0.56, 0.36);
    const mask = at(ball(0.16, mat(0xe9d8bf)), 0, 0.55, 0.45);
    mask.scale.set(1.2, 0.8, 0.5);
    f.add(face, mask);
    for (const side of [-1, 1]) {
      const arm = at(pill(0.06, 0.4, fur), side * 0.2, 0.35, 0.32);
      arm.rotation.z = side * 0.6;
      arm.rotation.y = side * 0.5;
      f.add(arm, at(ball(0.06, mat(0x4a3a2a)), side * 0.42, 0.22, 0.2));
      const patch = at(ball(0.05, mat(0x6b4a30)), side * 0.07, 0.58, 0.54);
      patch.scale.set(1.4, 0.8, 0.5);
      f.add(patch);
    }
    eyes(f, 0, 0.6, 0.55, 0.07);
    smile(f, 0, 0.5, 0.55, 0.04);
    const puffs = [0, 1, 2].map(() => {
      const p = new THREE.Mesh(cached('puff', () => new THREE.SphereGeometry(0.1, 14, 10)), smokeMat);
      f.add(p);
      return p;
    });
    return (t) => {
      puffs.forEach((p, i) => {
        const k = (t * 0.8 + i / 3) % 1;
        p.position.set(0.6 + k * 0.3, 0.75 + k * 0.6, 0);
        p.scale.setScalar(0.6 + k * 1.4);
        p.visible = k < 0.9;
      });
      face.rotation.z = Math.sin(t * 0.8) * 0.1;
      knob.position.y = 0.84 + Math.abs(Math.sin(t * 9)) * 0.03;
    };
  },

  // Epic: a toucan whose beak is a golden trumpet; it bobs and toots.
  'Trombetta Tucano': (f, accent) => {
    const black = mat(0x22222c);
    const body = at(ball(0.36, black), 0, 0.52, 0);
    body.scale.set(0.9, 1.15, 0.9);
    const chest = at(ball(0.24, mat(0xffe36a)), 0, 0.6, 0.18);
    chest.scale.set(1, 1.1, 0.6);
    const head = at(ball(0.24, black), 0, 1.0, 0.05);
    const cheek = at(ball(0.16, mat(0xffffff)), 0, 0.98, 0.14);
    cheek.scale.set(1.2, 1, 0.8);
    f.add(body, chest, head, cheek);
    const horn = at(new THREE.Group(), 0, 0.98, 0.25);
    const brass = mat(0xffc84a);
    const pipe = at(cyl(0.06, 0.08, 0.5, brass), 0, 0, 0.25);
    pipe.rotation.x = Math.PI / 2;
    const bell = new THREE.Mesh(cached('bell', () => new THREE.ConeGeometry(0.2, 0.22, 20, 1, true)), brass);
    bell.material.side = THREE.DoubleSide;
    bell.rotation.x = -Math.PI / 2;
    bell.position.z = 0.56;
    horn.add(pipe, bell, at(ball(0.04, accent), 0, 0.08, 0.15), at(ball(0.04, accent), 0, 0.08, 0.27));
    f.add(horn);
    for (const side of [-1, 1]) {
      const wing = at(ball(0.2, black), side * 0.32, 0.52, -0.02);
      wing.scale.set(0.35, 1, 0.8);
      f.add(wing, at(cyl(0.03, 0.03, 0.2, mat(ORANGE)), side * 0.1, 0.1, 0));
    }
    const tail = at(box(0.2, 0.36, 0.08, black), 0, 0.3, -0.32);
    tail.rotation.x = 0.4;
    f.add(tail);
    eyes(f, 0, 1.06, 0.24, 0.1);
    const note = at(ball(0.07, bulbMat), 0, 1.1, 0.8);
    f.add(note);
    return (t) => {
      const toot = Math.max(0, Math.sin(t * 3));
      horn.rotation.x = -toot * 0.2;
      bell.scale.setScalar(1 + toot * 0.15);
      f.position.y = Math.abs(Math.sin(t * 3)) * 0.05;
      const k = (t * 0.9) % 1;
      note.position.set(Math.sin(k * 8) * 0.1, 1.1 + k * 0.6, 0.8 + k * 0.2);
      note.visible = k < 0.8;
    };
  },

  // Legendary: a lion that is a washing machine; its drum spins with bubbles and its mane shakes.
  'Lavatrice Leone': (f, accent) => {
    const machine = at(box(0.8, 0.84, 0.66, mat(0xf4f4f4)), 0, 0.46, 0);
    const door = at(ring(0.24, 0.05, mat(CHROME)), 0, 0.42, 0.34);
    const glass = at(cyl(0.22, 0.22, 0.04, mat(0x8fd3ff)), 0, 0.42, 0.33);
    glass.rotation.x = Math.PI / 2;
    const drum = at(new THREE.Group(), 0, 0.42, 0.36);
    for (let i = 0; i < 3; i++) {
      const sock = at(ball(0.06, i === 1 ? accent : mat(i ? 0xff5f7e : 0x3fb6ff)), Math.cos(i * 2.1) * 0.12, Math.sin(i * 2.1) * 0.12, 0);
      drum.add(sock);
    }
    const panel = at(box(0.8, 0.14, 0.04, mat(0xdfe6f2)), 0, 0.8, 0.33);
    const dial = at(cyl(0.05, 0.05, 0.05, accent), 0.25, 0.8, 0.36);
    dial.rotation.x = Math.PI / 2;
    f.add(machine, door, glass, drum, panel, dial);
    // The lion's head on top, in a fluffy mane.
    const mane = at(new THREE.Group(), 0, 1.1, 0.04);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      mane.add(at(ball(0.14, mat(0xd9771f)), Math.cos(a) * 0.26, Math.sin(a) * 0.26, -0.04));
    }
    const face = at(ball(0.24, mat(0xffc35a)), 0, 1.1, 0.08);
    const muzzle = at(ball(0.1, mat(0xfff1d6)), 0, 1.04, 0.28);
    const nose = at(ball(0.04, mat(0x5a2b1a)), 0, 1.08, 0.36);
    f.add(mane, face, muzzle, nose);
    for (const side of [-1, 1]) f.add(at(ball(0.07, mat(0xffc35a)), side * 0.2, 1.32, 0.04));
    eyes(f, 0, 1.15, 0.28, 0.09);
    smile(f, 0, 0.98, 0.32, 0.05);
    const tail = at(cyl(0.03, 0.03, 0.5, mat(0xffc35a)), -0.42, 0.6, -0.2);
    tail.rotation.z = 0.8;
    const tuft = at(ball(0.08, mat(0xd9771f)), -0.62, 0.78, -0.2);
    f.add(tail, tuft);
    return (t) => {
      drum.rotation.z = t * 6;
      // A spin cycle: the whole machine rattles now and then.
      const spin = Math.sin(t * 0.9) > 0.3 ? 1 : 0;
      machine.position.x = spin * Math.sin(t * 50) * 0.015;
      mane.rotation.z = Math.sin(t * 2) * 0.1 + spin * Math.sin(t * 40) * 0.05;
    };
  },
};

const MODELS_EXTRA_TOP: Record<string, Model> = {
  // Mythic: an axolotl astronaut in a bubble helmet, riding a little jetpack.
  'Astronauta Assolotto': (f, accent) => {
    const pink = mat(0xffa3c8);
    const rig = new THREE.Group();
    const suit = at(ball(0.34, mat(0xf4f4f4)), 0, 0.5, 0);
    suit.scale.set(1, 1.1, 0.95);
    const badge = at(ball(0.07, accent), 0.12, 0.62, 0.3);
    const head = at(ball(0.26, pink), 0, 0.98, 0.02);
    head.scale.set(1.2, 0.9, 1);
    rig.add(suit, badge, head);
    // Feathery gills either side of the head.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const gill = at(cone(0.05, 0.22, mat(0xff5f9e)), side * (0.3 + i * 0.02), 0.98 + (i - 1) * 0.1, 0);
        gill.rotation.z = -side * (1.1 + (i - 1) * 0.4);
        rig.add(gill);
      }
      rig.add(at(ball(0.1, mat(0xf4f4f4)), side * 0.2, 0.1, 0.06));
      const arm = at(pill(0.08, 0.2, mat(0xf4f4f4)), side * 0.36, 0.56, 0.04);
      arm.rotation.z = side * 0.6;
      rig.add(arm);
    }
    const helmetMat = new THREE.MeshPhongMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.3, shininess: 120, depthWrite: false });
    NO_OUTLINE.add(helmetMat);
    rig.add(at(ball(0.44, helmetMat), 0, 0.96, 0.02));
    const pack = at(box(0.36, 0.42, 0.2, mat(0x8f939e)), 0, 0.55, -0.34);
    const flames = [-1, 1].map((side) => {
      const flame = at(cone(0.07, 0.3, bulbMat), side * 0.1, 0.22, -0.36);
      flame.rotation.x = Math.PI;
      rig.add(flame);
      return flame;
    });
    rig.add(pack);
    eyes(rig, 0, 1.0, 0.24, 0.12);
    smile(rig, 0, 0.88, 0.26, 0.07);
    f.add(rig);
    return (t) => {
      rig.position.y = 0.12 + Math.sin(t * 1.8) * 0.08;
      rig.rotation.z = Math.sin(t * 1.2) * 0.08;
      flames.forEach((fl, i) => fl.scale.set(1, 0.7 + Math.abs(Math.sin(t * 21 + i)) * 0.6, 1));
    };
  },

  // Celestial: a jellyfish made of a nebula, its glowing tentacles drifting, stars twinkling inside its bell.
  'Nebulosa Medusa': (f) => {
    const bell = new THREE.Mesh(
      cached('jellybell', () => new THREE.SphereGeometry(0.46, 28, 16, 0, Math.PI * 2, 0, Math.PI / 1.9)),
      mat(0x6a4bd6),
    );
    bell.position.y = 0.95;
    bell.scale.y = 0.85;
    const rim = at(ring(0.44, 0.06, mat(0xb9a6ff)), 0, 0.92, 0);
    rim.rotation.x = Math.PI / 2;
    const swim = new THREE.Group();
    swim.add(bell, rim);
    const tentacles: THREE.Group[] = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const strand = at(new THREE.Group(), Math.cos(a) * 0.28, 0.9, Math.sin(a) * 0.28);
      for (let j = 0; j < 4; j++) strand.add(at(ball(0.06 - j * 0.008, j % 2 ? mat(0xffc8f0) : mat(0x9fb8ff)), 0, -0.14 - j * 0.15, 0));
      tentacles.push(strand);
      swim.add(strand);
    }
    const stars = new THREE.Group();
    for (let i = 0; i < 5; i++) stars.add(at(ball(0.035, bulbMat), Math.cos(i * 1.3) * 0.22, 1.05 + Math.sin(i * 2.1) * 0.08, Math.sin(i * 1.3) * 0.22));
    swim.add(stars);
    eyes(swim, 0, 1.02, 0.42, 0.13);
    smile(swim, 0, 0.92, 0.44, 0.05);
    f.add(swim);
    return (t) => {
      const pulse = Math.sin(t * 2.4);
      bell.scale.set(1 + pulse * 0.06, 0.85 - pulse * 0.06, 1 + pulse * 0.06);
      swim.position.y = Math.sin(t * 1.2) * 0.1;
      tentacles.forEach((s, i) => {
        s.rotation.x = Math.sin(t * 2 + i) * 0.25;
        s.rotation.z = Math.cos(t * 1.7 + i) * 0.25;
      });
      stars.rotation.y = t * 0.6;
    };
  },
};

Object.assign(MODELS, MODELS_STORM, MODELS_MYTHIC, MODELS_CELESTIAL, MODELS_EXTRA, MODELS_EXTRA_TOP);

/** Fallback for characters without a model yet: a cube in the rarity colour. */
const cubeModel: Model = (f, accent) => {
  f.add(at(box(0.9, 0.9, 0.9, accent), 0, 0.6, 0));
  eyes(f, 0, 0.72, 0.46, 0.17);
  smile(f, 0, 0.45, 0.46, 0.14);
  return () => {};
};

const rarityMats = new Map<number, THREE.MeshToonMaterial>();
const haloMats = new Map<number, THREE.SpriteMaterial>();

/** Shared per rarity; the Secret one is recoloured every frame for its rainbow. */
export function rarityMaterial(rarity: number): THREE.MeshToonMaterial {
  let m = rarityMats.get(rarity);
  if (!m) {
    const color = RARITIES[rarity].color;
    m = toon(color, { emissive: color, emissiveIntensity: 0.3 });
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
  const blinkers: THREE.Object3D[] = [];
  eyeCollector = blinkers;
  const base = (MODELS[name] ?? cubeModel)(figure, rarityMaterial(rarity));
  eyeCollector = null;
  // Every few seconds the eyes squash shut and pop open again (each character on its own rhythm).
  const seed = Math.random();
  const period = 2.6 + seed * 2.2;
  const animate = (t: number) => {
    base(t);
    const p = ((t / period + seed) % 1) * period;
    const shut = p < 0.14 ? Math.sin((p / 0.14) * Math.PI) : 0;
    for (const e of blinkers) e.scale.y = 1 - shut * 0.9;
  };
  // Mythics shimmer with a moving rainbow over their whole body; Celestials with a starry nebula.
  if (rarity >= 5) {
    const shade = rarity === 5 ? rainbowOf : celestialOf;
    figure.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshToonMaterial && !NO_OUTLINE.has(o.material)) {
        o.material = shade(o.material);
      }
    });
  }
  outline(figure);
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
  rainbowTime.value = t;
  bulbMat.emissiveIntensity = Math.sin(t * 7) + Math.sin(t * 17) > 0.4 ? 1 : 0.25;
  const secret = rarityMaterial(RARITIES.length - 1);
  secret.color.setHSL((t * 0.25) % 1, 0.9, 0.6);
  secret.emissive.copy(secret.color);
}
