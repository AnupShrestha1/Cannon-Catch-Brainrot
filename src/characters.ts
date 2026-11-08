// Character models: primitive shapes per roster character, each with an idle animation, drawn cel-shaded
// with a dark outline, round cartoon eyes and a smile. Every model faces +z, stands on y = 0 and is about
// 1.2 m tall. Geometries and materials are cached, so building and dropping rigs leaks nothing.
import * as THREE from 'three';
import { RARITIES } from './config';
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
const mouthMat = new THREE.MeshBasicMaterial({ color: 0x3a1020 });
/** Parts that never get an outline: eyes, mouths, glows and see-through bits. */
const NO_OUTLINE = new Set<THREE.Material>([eyeMat, pupilMat, mouthMat, outlineMat]);

/** Two big round cartoon eyes with pupils and a shine, on a face at depth z, centred on x. */
function eyes(parent: THREE.Object3D, x: number, y: number, z: number, spread = 0.11): void {
  const r = Math.min(0.12, Math.max(0.065, spread * 0.8));
  for (const side of [-1, 1]) {
    const white = at(ball(r, eyeMat, 2), x + side * spread, y, z);
    white.scale.z = 0.55;
    const pupil = at(ball(r * 0.55, pupilMat, 1), x + side * spread + side * r * 0.12, y - r * 0.1, z + r * 0.42);
    pupil.scale.z = 0.5;
    const shine = at(ball(r * 0.2, eyeMat, 0), x + side * spread - r * 0.2, y + r * 0.25, z + r * 0.62);
    parent.add(white, pupil, shine);
  }
}

/** A curved smile at depth z. */
function smile(parent: THREE.Object3D, x: number, y: number, z: number, w = 0.12): void {
  const mouth = new THREE.Mesh(
    cached(`smile${w}`, () => new THREE.TorusGeometry(w, w * 0.22, 4, 10, Math.PI)),
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
    smile(f, 0.48, 0.36, 0.19, 0.08);
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
    return (t) => {
      lid.rotation.x = -Math.max(0, Math.sin(t * 1.8)) * 1.1;
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
    for (const side of [-1, 1]) hover.add(at(box(0.16, 0.1, 0.22, skin), side * 0.42, 0.3, 0.15));
    eyes(hover, 0, 0.48, 0.68, 0.07);
    smile(hover, 0, 0.36, 0.66, 0.06);
    f.add(hover);
    return (t) => {
      blades.rotation.y = t * 18;
      hover.position.y = 0.2 + Math.sin(t * 2.5) * 0.08;
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
    eyes(f, 0, 0.53, 0.37, 0.11);
    smile(f, 0, 0.3, 0.36, 0.1);
    return (t) => {
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
    eyes(lift, 0, 0.98, 0.42, 0.14);
    smile(lift, 0, 0.56, 0.64, 0.12);
    f.add(lift);
    return (t) => {
      rotor.rotation.y = t * 22;
      lift.position.y = Math.max(0, Math.sin(t * 1.4)) * 0.25;
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

Object.assign(MODELS, MODELS_STORM, MODELS_MYTHIC);

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
  const animate = (MODELS[name] ?? cubeModel)(figure, rarityMaterial(rarity));
  // Mythics shimmer with a moving rainbow over their whole body.
  if (rarity === 5) {
    figure.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshToonMaterial && !NO_OUTLINE.has(o.material)) {
        o.material = rainbowOf(o.material);
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
