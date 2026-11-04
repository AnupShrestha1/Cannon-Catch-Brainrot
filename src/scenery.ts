// Low-poly scenery around the cannon and base: patchy grass with rolling hills further out, a sandy path,
// a fence behind the base, trees, flowers, grass tufts, rocks, bushes and a pond. Seeded, so the world
// looks the same every load; repeated props are instanced to stay cheap.
import * as THREE from 'three';

const lambert = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) =>
  new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

/** Small seeded random generator (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Flat where the game is played, rolling hills beyond about 70 m. */
function groundHeight(x: number, z: number): number {
  const d = Math.hypot(x, z);
  if (d < 70) return 0;
  const ramp = Math.min(1, (d - 70) / 60);
  return ramp * (5 + Math.sin(x * 0.03) * Math.cos(z * 0.025) * 4 + Math.sin(x * 0.011 + z * 0.017) * 6);
}

const POND = { x: 24, z: -22, r: 9 };

/** Where props may not go: the base and its walkway, the cannon, the path and the pond. */
function keepClear(x: number, z: number): boolean {
  if (x > -48 && x < 7 && z > -12 && z < 11) return true;
  if (Math.hypot(x, z) < 6) return true;
  if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 2) return true;
  return false;
}

export function addScenery(scene: THREE.Scene): void {
  const rand = seeded(20261104);
  const range = (a: number, b: number) => a + rand() * (b - a);

  // Ground: patches of three greens, flat near the play area.
  const ground = new THREE.PlaneGeometry(840, 840, 120, 120);
  ground.rotateX(-Math.PI / 2);
  const pos = ground.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const light = new THREE.Color(0x86cf6f);
  const mid = new THREE.Color(0x6cc070);
  const dark = new THREE.Color(0x58a85c);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, groundHeight(x, z));
    const n = (Math.sin(x * 0.08) + Math.sin(z * 0.06 + 1.3) + Math.sin((x + z) * 0.045)) / 3;
    if (n > 0.2) c.copy(mid).lerp(light, Math.min(1, (n - 0.2) * 2.5));
    else c.copy(mid).lerp(dark, Math.min(1, (0.2 - n) * 1.5));
    c.toArray(colors, i * 3);
  }
  ground.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  ground.computeVertexNormals();
  scene.add(new THREE.Mesh(ground, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));

  // Sandy path: cannon to the base, then along the front of the pads.
  const sand = lambert(0xe2c98f);
  const path = (x: number, z: number, w: number, d: number, turn = 0) => {
    const tile = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), sand);
    tile.position.set(x, 0.025, z);
    tile.rotation.y = turn;
    scene.add(tile);
  };
  path(-2.2, 4.6, 2.4, 5.5, -0.75);
  path(-23, 6.6, 42, 2.4);

  // Wooden fence behind the base and along its far end.
  const wood = lambert(0x9a6a3c);
  const postGeo = new THREE.BoxGeometry(0.25, 1.2, 0.25);
  const fence = (x0: number, z0: number, x1: number, z1: number) => {
    const length = Math.hypot(x1 - x0, z1 - z0);
    const posts = Math.max(2, Math.round(length / 2.5) + 1);
    for (let i = 0; i < posts; i++) {
      const t = i / (posts - 1);
      const post = new THREE.Mesh(postGeo, wood);
      post.position.set(x0 + (x1 - x0) * t, 0.6, z0 + (z1 - z0) * t);
      scene.add(post);
    }
    for (const y of [0.45, 0.95]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.12, 0.1), wood);
      rail.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
      rail.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
      scene.add(rail);
    }
  };
  fence(-3, -9.2, -45, -9.2);
  fence(-45, -9.2, -45, 8.5);

  // Pond with a ring of rocks.
  const pond = new THREE.Mesh(
    new THREE.CircleGeometry(POND.r, 24),
    new THREE.MeshLambertMaterial({ color: 0x5ab3e8, transparent: true, opacity: 0.85 }),
  );
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(POND.x, 0.04, POND.z);
  scene.add(pond);

  // Scattered props, instanced. `spot` finds a clear place, or null after a few tries.
  const spot = (minR: number, maxR: number): [number, number] | null => {
    for (let tries = 0; tries < 12; tries++) {
      const a = rand() * Math.PI * 2;
      const r = minR + Math.sqrt(rand()) * (maxR - minR);
      const x = Math.cos(a) * r - 15;
      const z = Math.sin(a) * r;
      if (!keepClear(x, z)) return [x, z];
    }
    return null;
  };
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const scatter = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    count: number,
    minR: number,
    maxR: number,
    place: (x: number, z: number) => { y: number; scale: THREE.Vector3; color?: number },
  ) => {
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    let n = 0;
    for (let i = 0; i < count; i++) {
      const at = spot(minR, maxR);
      if (!at) continue;
      const { y, scale, color } = place(at[0], at[1]);
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      m.compose(new THREE.Vector3(at[0], groundHeight(at[0], at[1]) + y, at[1]), q, scale);
      mesh.setMatrixAt(n, m);
      if (color !== undefined) mesh.setColorAt(n, c.setHex(color));
      n++;
    }
    mesh.count = n;
    scene.add(mesh);
  };

  // Trees, kept out of the base and the view from the cannon.
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 1.4, 6).translate(0, 0.7, 0);
  const leafGeo = new THREE.ConeGeometry(1.6, 3.6, 6).translate(0, 3, 0);
  const treeSpots: [number, number, number][] = [];
  for (let i = 0; i < 140; i++) {
    const at = spot(22, 190);
    if (at) treeSpots.push([at[0], at[1], range(0.8, 2)]);
  }
  for (const [geo, color] of [
    [trunkGeo, 0x7a4f2c],
    [leafGeo, 0x2f8f45],
  ] as const) {
    const mesh = new THREE.InstancedMesh(geo, lambert(color), treeSpots.length);
    treeSpots.forEach(([x, z, s], i) => {
      m.compose(new THREE.Vector3(x, groundHeight(x, z), z), q.identity(), new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(i, m);
    });
    scene.add(mesh);
  }

  const flowerColors = [0xff5d73, 0xffd23f, 0xffffff, 0xb57bff, 0xff9f43];
  scatter(new THREE.IcosahedronGeometry(0.16, 0), lambert(0xffffff), 700, 6, 90, () => ({
    y: 0.22,
    scale: new THREE.Vector3(1, 1, 1),
    color: flowerColors[Math.floor(rand() * flowerColors.length)],
  }));
  scatter(new THREE.ConeGeometry(0.14, 0.55, 4), lambert(0x3f8f45), 1100, 6, 110, () => {
    const s = range(0.7, 1.4);
    return { y: 0.25 * s, scale: new THREE.Vector3(s, s, s) };
  });
  scatter(new THREE.IcosahedronGeometry(1, 0), lambert(0x9aa0a8), 70, 8, 140, () => {
    const s = range(0.3, 1.5);
    return { y: 0.15 * s, scale: new THREE.Vector3(s, s * 0.6, s * range(0.8, 1.2)) };
  });
  scatter(new THREE.IcosahedronGeometry(1, 1), lambert(0x3e9a4e), 60, 10, 120, () => {
    const s = range(0.8, 1.6);
    return { y: 0.5 * s, scale: new THREE.Vector3(s * 1.2, s, s) };
  });

  // Distant hills soften the horizon.
  const hillMat = lambert(0x5fae62);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + range(-0.2, 0.2);
    const hill = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), hillMat);
    const r = range(55, 90);
    hill.scale.set(r, range(18, 32), r * range(0.7, 1.1));
    hill.position.set(Math.cos(a) * 300, -4, Math.sin(a) * 300);
    scene.add(hill);
  }
}
