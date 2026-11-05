// Portrait icons for brainrot cards: each character's 3D model rendered once, three-quarter on, into a small
// transparent image, then cached by name. A second, tiny WebGL renderer does the drawing so the game's own
// renderer and camera are never touched.
import * as THREE from 'three';
import { makeCharacter } from './characters';

const SIZE = 192;
const cache = new Map<string, string>();
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
const box = new THREE.Box3();
const size = new THREE.Vector3();
const center = new THREE.Vector3();

function setup(): boolean {
  if (renderer) return true;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(SIZE, SIZE, false);
    renderer.setClearColor(0x000000, 0);
  } catch {
    return false;
  }
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9a8fb8, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(2, 4, 5);
  scene.add(key);
  return true;
}

/** A data URL of the character's portrait, or '' if WebGL isn't available for it. */
export function brainrotIcon(name: string, rarity: number): string {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  if (!setup() || !renderer || !scene) {
    cache.set(name, '');
    return '';
  }
  const rig = makeCharacter(rarity, name);
  rig.cloud.visible = false;
  rig.halo.visible = false;
  // A calm moment of every idle animation (the gymnast is upright, lids and doors are shut).
  rig.animate(2);
  rig.group.rotation.y = -0.45;
  scene.add(rig.group);
  rig.group.updateMatrixWorld(true);
  box.setFromObject(rig.figure);
  box.getSize(size);
  box.getCenter(center);
  // Back the camera off until the model's largest side fits the frame, with a little room around it.
  const span = Math.max(size.x, size.y, size.z) * 1.18;
  const dist = span / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(center.x, center.y + span * 0.12, center.z + dist);
  camera.lookAt(center);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(rig.group);
  cache.set(name, url);
  return url;
}
