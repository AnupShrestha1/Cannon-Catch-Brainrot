// The profile editor: your name and your avatar (head, face, hat, shirt print and colours, parachute), with a
// live 3D preview that turns slowly.
import * as THREE from 'three';
import { DEFAULT_OUTFIT, FACES, HATS, HEADS, PATTERNS, makePlayer, type Outfit } from './world';

export interface Profile {
  /** Empty until the player picks one ("You" in the feed, "YOUR BASE" on the board). */
  name: string;
  outfit: Outfit;
}

export const NAME_MAX = 16;

/** Letters, digits, spaces, _ and -, trimmed and cut to length. */
export function cleanName(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

export function defaultProfile(): Profile {
  return { name: '', outfit: { ...DEFAULT_OUTFIT } };
}

const LABELS: Record<string, string> = {
  block: 'Block',
  round: 'Round',
  tall: 'Tall',
  smile: 'Smile',
  grin: 'Grin',
  cool: 'Cool',
  wink: 'Wink',
  wow: 'Wow',
  sleepy: 'Sleepy',
  cat: 'Cat',
  cap: 'Cap',
  none: 'None',
  beanie: 'Beanie',
  tophat: 'Top hat',
  cowboy: 'Cowboy',
  crown: 'Crown',
  propeller: 'Propeller',
  party: 'Party',
  stripe: 'Stripe',
  plain: 'Plain',
  stripes: 'Stripes',
  dots: 'Dots',
  star: 'Star',
  split: 'Split',
  zigzag: 'Zigzag',
};

const SKINS = [0xffe0c2, 0xf7c873, 0xf3c9a0, 0xe0a87a, 0xc68650, 0x8a5a3a, 0x5c3a24, 0x8fe08a, 0x9fb8ff];
const BRIGHTS = [
  0xff4d5e, 0xff7a1a, 0xffd23f, 0x3ccf5a, 0x1fc8b4, 0x2f8cff, 0x2f5fc4, 0x8a5cff, 0xff5fa2, 0xffffff, 0x6b6b7a, 0x1d1640,
];

type Choice = { key: 'head' | 'face' | 'hat' | 'pattern'; title: string; options: readonly string[] };
type Swatches = { key: 'shirt' | 'pants' | 'skin' | 'cap' | 'chute'; title: string; colors: number[] };

const ROWS: (Choice | Swatches)[] = [
  { key: 'head', title: 'Head', options: HEADS },
  { key: 'face', title: 'Face', options: FACES },
  { key: 'skin', title: 'Skin', colors: SKINS },
  { key: 'hat', title: 'Hat', options: HATS },
  { key: 'cap', title: 'Hat colour', colors: BRIGHTS },
  { key: 'pattern', title: 'Shirt pattern', options: PATTERNS },
  { key: 'shirt', title: 'Shirt colour', colors: BRIGHTS },
  { key: 'pants', title: 'Pants colour', colors: BRIGHTS },
  { key: 'chute', title: 'Parachute colour', colors: [0xff4d6d, ...BRIGHTS.filter((c) => c !== 0xff4d5e)] },
];

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/**
 * Builds the editor's content for a modal. `result()` gives the edited profile. The preview's renderer frees
 * itself once the modal closes (its canvas leaves the page).
 */
export function profileEditor(current: Profile): { nodes: Node[]; result: () => Profile } {
  const outfit: Outfit = {
    ...DEFAULT_OUTFIT,
    head: 'block',
    face: 'smile',
    hat: 'cap',
    pattern: 'stripe',
    chute: 0xff4d6d,
    ...current.outfit,
  };
  const wrap = document.createElement('div');
  wrap.className = 'profile';

  // Name.
  const nameRow = document.createElement('label');
  nameRow.className = 'profile-name';
  nameRow.textContent = 'Name';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = NAME_MAX;
  input.placeholder = 'Your name';
  input.value = current.name;
  input.autocomplete = 'off';
  input.spellcheck = false;
  nameRow.append(input);

  // Preview.
  const canvas = document.createElement('canvas');
  canvas.className = 'profile-preview';
  canvas.width = 360;
  canvas.height = 440;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(1);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899bb, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-2, 4, -5);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, canvas.width / canvas.height, 0.1, 50);
  camera.position.set(0, 1.85, -6.3);
  camera.lookAt(0, 1.7, 0);
  const rig = makePlayer(outfit);
  // The parachute floats small over the avatar's head, to show its colour.
  rig.chute.visible = true;
  rig.chute.scale.setScalar(0.32);
  rig.chute.position.set(0, 2.25, 0);
  scene.add(rig.group);
  let spin = 0;
  let dragging = false;
  let lastX = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    spin += (e.clientX - lastX) * 0.012;
    lastX = e.clientX;
  });
  canvas.addEventListener('pointerup', () => (dragging = false));
  let started = false;
  const t0 = performance.now();
  const tick = () => {
    // Once the modal closes, free the renderer.
    if (started && !canvas.isConnected) {
      renderer.dispose();
      renderer.forceContextLoss();
      return;
    }
    started ||= canvas.isConnected;
    const t = (performance.now() - t0) / 1000;
    if (!dragging) spin += 0.006;
    rig.group.rotation.y = spin;
    rig.body.position.y = 0.9 + Math.abs(Math.sin(t * 2.2)) * 0.05;
    if (rig.spinner) rig.spinner.rotation.y = t * 12;
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // Options.
  const options = document.createElement('div');
  options.className = 'profile-options';
  for (const row of ROWS) {
    const el = document.createElement('div');
    el.className = 'profile-row';
    const title = document.createElement('div');
    title.className = 'profile-title';
    title.textContent = row.title;
    const list = document.createElement('div');
    list.className = 'colors' in row ? 'profile-swatches' : 'profile-chips';
    const items = 'colors' in row ? row.colors : row.options;
    const buttons = items.map((value) => {
      const b = document.createElement('button');
      b.type = 'button';
      if (typeof value === 'number') {
        b.className = 'swatch-btn';
        b.style.setProperty('--c', hex(value));
        b.style.setProperty('--hi', hex(value));
        b.style.setProperty('--lo', hex(value));
        b.setAttribute('aria-label', hex(value));
      } else {
        b.className = 'chip-btn';
        b.textContent = LABELS[value] ?? value;
      }
      b.addEventListener('click', () => {
        (outfit as unknown as Record<string, unknown>)[row.key] = value;
        rig.dress(outfit);
        mark();
        b.blur();
      });
      return { b, value };
    });
    const mark = () => {
      for (const { b, value } of buttons) b.classList.toggle('on', (outfit as unknown as Record<string, unknown>)[row.key] === value);
    };
    mark();
    list.append(...buttons.map(({ b }) => b));
    el.append(title, list);
    options.append(el);
  }

  const side = document.createElement('div');
  side.className = 'profile-side';
  const hint = document.createElement('div');
  hint.className = 'profile-hint';
  hint.textContent = 'Drag to turn';
  side.append(canvas, hint);
  const main = document.createElement('div');
  main.className = 'profile-main';
  main.append(nameRow, options);
  wrap.append(side, main);
  return {
    nodes: [wrap],
    result: () => ({ name: cleanName(input.value), outfit: { ...outfit } }),
  };
}
