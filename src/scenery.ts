// Low-poly scenery around the cannon and base: a gradient sky with a sun, patchy grass with rolling hills
// and snowy mountains further out, a sandy path with lanterns, a fence hung with bunting, mixed trees that
// sway in the wind, flowers, mushrooms, rocks, a pond with lily pads and a dock, a cottage, a windmill and
// butterflies. Seeded, so the world looks the same every load; repeated props are instanced to stay cheap.
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
const COTTAGE = { x: -60, z: 22 };
const WINDMILL = { x: -26, z: -40 };

/** Where props may not go: the base and its walkway, the cannon, the pond and the buildings. */
function keepClear(x: number, z: number): boolean {
  if (x > -48 && x < 7 && z > -12 && z < 11) return true;
  if (Math.hypot(x, z) < 6) return true;
  // The gacha machine and merge station either side of the cannon.
  if (x > -8 && x < 8 && z > -8 && z < 0) return true;
  if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 2) return true;
  if (Math.hypot(x - COTTAGE.x, z - COTTAGE.z) < 9) return true;
  if (Math.hypot(x - WINDMILL.x, z - WINDMILL.z) < 8) return true;
  return false;
}

/** Shared clock for the wind shader. */
const wind = { value: 0 };

/** Bends a material's vertices with the wind, more the higher they sit above the mesh's origin. */
function sway<T extends THREE.Material>(mat: T, strength: number): T {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = wind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 swayAt = instanceMatrix[3].xyz;
        #else
          vec3 swayAt = vec3(0.0);
        #endif
        float swayH = max(position.y, 0.0);
        transformed.x += sin(uWind * 1.6 + swayAt.x * 0.35 + swayAt.z * 0.21) * swayH * ${strength.toFixed(3)};
        transformed.z += cos(uWind * 1.2 + swayAt.z * 0.31) * swayH * ${(strength * 0.6).toFixed(3)};`,
      );
  };
  mat.customProgramCacheKey = () => `sway${strength}`;
  return mat;
}

/** A small canvas of speckled grass, tiled over the ground and tinted by its vertex colours. */
function grassTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#e9f2e2';
  g.fillRect(0, 0, size, size);
  const rand = seeded(7);
  for (let i = 0; i < 900; i++) {
    const shade = 200 + Math.floor(rand() * 55);
    g.fillStyle = `rgb(${shade - 25},${shade},${shade - 40})`;
    const x = rand() * size;
    const y = rand() * size;
    g.fillRect(x, y, 1 + rand() * 2, 2 + rand() * 4);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(160, 160);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export interface Scenery {
  /** Moves the windmill, butterflies, wind and water. `t` is seconds since start. */
  update(t: number): void;
}

export function addScenery(scene: THREE.Scene): Scenery {
  const rand = seeded(20261104);
  const range = (a: number, b: number) => a + rand() * (b - a);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
  const c = new THREE.Color();
  const casts = (o: THREE.Object3D) => {
    o.traverse((m) => {
      if (m instanceof THREE.Mesh) m.castShadow = true;
    });
    return o;
  };

  // Ground: soft patches of greens and a warmer yellow-green, flat near the play area.
  const ground = new THREE.PlaneGeometry(1000, 1000, 140, 140);
  ground.rotateX(-Math.PI / 2);
  const pos = ground.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const light = new THREE.Color(0x9bdb6a);
  const mid = new THREE.Color(0x6cc070);
  const dark = new THREE.Color(0x4f9e58);
  const warm = new THREE.Color(0xc3d96a);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, groundHeight(x, z));
    const n = (Math.sin(x * 0.08) + Math.sin(z * 0.06 + 1.3) + Math.sin((x + z) * 0.045)) / 3;
    if (n > 0.2) c.copy(mid).lerp(light, Math.min(1, (n - 0.2) * 2.5));
    else c.copy(mid).lerp(dark, Math.min(1, (0.2 - n) * 1.5));
    const w = Math.sin(x * 0.021 + 2) * Math.sin(z * 0.027 - 1);
    if (w > 0.55) c.lerp(warm, Math.min(1, (w - 0.55) * 2.2));
    c.toArray(colors, i * 3);
  }
  ground.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  ground.computeVertexNormals();
  const groundMesh = new THREE.Mesh(
    ground,
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, map: grassTexture() }),
  );
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // Sandy path from the cannon to the showcase entrance.
  const sand = lambert(0xe2c98f);
  const path = (x: number, z: number, w: number, d: number, turn = 0) => {
    const tile = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), sand);
    tile.position.set(x, 0.025, z);
    tile.rotation.y = turn;
    tile.receiveShadow = true;
    scene.add(tile);
  };
  path(-4.5, 0.65, 9.8, 2.6, -0.35);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  // Lanterns along both long sides of the showcase, with a warm glow.
  const wood = lambert(0x9a6a3c);
  const darkWood = lambert(0x6e4526);
  const lampMat = new THREE.MeshLambertMaterial({ color: 0xffe9a8, emissive: 0xffc94d, emissiveIntensity: 0.9 });
  const postGeo = new THREE.CylinderGeometry(0.09, 0.12, 2.2, 6).translate(0, 1.1, 0);
  const lampGeo = new THREE.BoxGeometry(0.42, 0.5, 0.42).translate(0, 2.35, 0);
  const capGeo = new THREE.ConeGeometry(0.4, 0.3, 4).rotateY(Math.PI / 4).translate(0, 2.75, 0);
  for (let x = -12; x >= -34; x -= 7) {
    for (const z of [7.6, -8.1]) {
      const lamp = new THREE.Group();
      lamp.add(new THREE.Mesh(postGeo, darkWood), new THREE.Mesh(lampGeo, lampMat), new THREE.Mesh(capGeo, darkWood));
      lamp.position.set(x, 0, z);
      scene.add(casts(lamp));
    }
  }

  // Wooden fence behind the base and along its far end, hung with bunting.
  const fencePost = new THREE.BoxGeometry(0.25, 1.2, 0.25);
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.3, 0, 0, 0.3, 0, 0, 0, -0.55, 0], 3));
  flagGeo.computeVertexNormals();
  const flagColors = [0xff5d73, 0xffd23f, 0x4dabff, 0x3ccf5a, 0xb57bff, 0xff9f43];
  const flags: { x: number; y: number; z: number; turn: number }[] = [];
  const fence = (x0: number, z0: number, x1: number, z1: number) => {
    const length = Math.hypot(x1 - x0, z1 - z0);
    const posts = Math.max(2, Math.round(length / 2.5) + 1);
    const turn = -Math.atan2(z1 - z0, x1 - x0);
    for (let i = 0; i < posts; i++) {
      const t = i / (posts - 1);
      const post = new THREE.Mesh(fencePost, wood);
      post.position.set(x0 + (x1 - x0) * t, 0.6, z0 + (z1 - z0) * t);
      post.castShadow = true;
      scene.add(post);
    }
    for (const y of [0.45, 0.95]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.12, 0.1), wood);
      rail.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
      rail.rotation.y = turn;
      rail.castShadow = true;
      scene.add(rail);
    }
    // Bunting sags between tall poles every 7 m.
    const spans = Math.max(1, Math.round(length / 7));
    for (let s = 0; s < spans; s++) {
      for (let k = 0; k < 7; k++) {
        const t = (s + (k + 0.5) / 7) / spans;
        const sag = Math.sin(((k + 0.5) / 7) * Math.PI) * 0.45;
        flags.push({ x: x0 + (x1 - x0) * t, y: 2.3 - sag, z: z0 + (z1 - z0) * t, turn });
      }
    }
    for (let s = 0; s <= spans; s++) {
      const t = s / spans;
      const pole = new THREE.Mesh(postGeo, wood);
      pole.scale.y = 1.15;
      pole.position.set(x0 + (x1 - x0) * t, 0, z0 + (z1 - z0) * t);
      pole.castShadow = true;
      scene.add(pole);
    }
  };
  fence(-3, -9.2, -45, -9.2);
  fence(-45, -9.2, -45, 8.5);
  const bunting = new THREE.InstancedMesh(flagGeo, lambert(0xffffff, { side: THREE.DoubleSide }), flags.length);
  flags.forEach((f, i) => {
    q.setFromAxisAngle(up, f.turn);
    m.compose(new THREE.Vector3(f.x, f.y, f.z), q, new THREE.Vector3(1, 1, 1));
    bunting.setMatrixAt(i, m);
    bunting.setColorAt(i, c.setHex(flagColors[i % flagColors.length]));
  });
  scene.add(bunting);

  // Pond with lily pads, reeds and a little dock.
  const water = new THREE.MeshLambertMaterial({ color: 0x4fb0ea, transparent: true, opacity: 0.88, emissive: 0x0b3a66 });
  const pond = new THREE.Mesh(new THREE.CircleGeometry(POND.r, 28), water);
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(POND.x, 0.04, POND.z);
  pond.receiveShadow = true;
  scene.add(pond);
  const shore = new THREE.Mesh(new THREE.RingGeometry(POND.r, POND.r + 1.1, 28), lambert(0xd9c48c));
  shore.rotation.x = -Math.PI / 2;
  shore.position.set(POND.x, 0.03, POND.z);
  scene.add(shore);
  const lily = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.6, 8, 0.4, Math.PI * 1.8).rotateX(-Math.PI / 2),
    lambert(0x3f9a4a, { side: THREE.DoubleSide }),
    14,
  );
  for (let i = 0; i < 14; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * (POND.r - 1.5);
    const s = range(0.6, 1.3);
    q.setFromAxisAngle(up, rand() * 6);
    m.compose(new THREE.Vector3(POND.x + Math.cos(a) * r, 0.07, POND.z + Math.sin(a) * r), q, new THREE.Vector3(s, 1, s));
    lily.setMatrixAt(i, m);
  }
  scene.add(lily);
  const reedMat = sway(lambert(0x5e8f3a), 0.08);
  const reeds = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.06, 1.6, 4).translate(0, 0.8, 0), reedMat, 40);
  for (let i = 0; i < 40; i++) {
    const a = rand() * Math.PI * 2;
    const r = POND.r + range(-0.4, 0.8);
    m.compose(new THREE.Vector3(POND.x + Math.cos(a) * r, 0, POND.z + Math.sin(a) * r), q.identity(), new THREE.Vector3(1, range(0.6, 1.3), 1));
    reeds.setMatrixAt(i, m);
  }
  scene.add(reeds);
  const dock = new THREE.Group();
  const plank = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.15, 5), wood);
  plank.position.y = 0.35;
  dock.add(plank);
  for (const [dx, dz] of [[-0.8, -2.2], [0.8, -2.2], [-0.8, 2.2], [0.8, 2.2]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.8, 0.2), darkWood);
    leg.position.set(dx, 0.1, dz);
    dock.add(leg);
  }
  dock.position.set(POND.x - 1, 0, POND.z + POND.r - 1.2);
  scene.add(casts(dock));

  // Cottage: walls, a red roof, a door, windows and a chimney.
  const cottage = new THREE.Group();
  const walls = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 5.5), lambert(0xf3e6c8));
  walls.position.y = 2;
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 4.4, 3, 4, 1).rotateY(Math.PI / 4), lambert(0xd9534f));
  roof.scale.set(1.25, 1, 1);
  roof.position.y = 5.5;
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.1, 0.1), darkWood);
  door.position.set(0, 1.05, 2.78);
  const windowMat = new THREE.MeshLambertMaterial({ color: 0xbfe6ff, emissive: 0x335577 });
  for (const wx of [-2.2, 2.2]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 0.1), windowMat);
    win.position.set(wx, 2.4, 2.78);
    cottage.add(win);
  }
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2, 0.8), lambert(0x9a8f88));
  chimney.position.set(1.8, 6, -0.8);
  cottage.add(walls, roof, door, chimney);
  cottage.position.set(COTTAGE.x, 0, COTTAGE.z);
  cottage.rotation.y = 0.6;
  scene.add(casts(cottage));
  walls.receiveShadow = true;

  // Windmill with turning sails.
  const windmill = new THREE.Group();
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.8, 11, 8).translate(0, 5.5, 0), lambert(0xeee3d0));
  const millCap = new THREE.Mesh(new THREE.ConeGeometry(2.4, 3, 8).translate(0, 12.5, 0), lambert(0x8d5a3b));
  const hub = new THREE.Group();
  hub.position.set(0, 10.5, 2.3);
  const sailMat = lambert(0xfdf7ec, { side: THREE.DoubleSide });
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i * Math.PI) / 2;
    const spar = new THREE.Mesh(new THREE.BoxGeometry(0.25, 6.5, 0.2).translate(0, 3.25, 0), darkWood);
    const sail = new THREE.Mesh(new THREE.BoxGeometry(1.4, 5, 0.06).translate(0.8, 3.6, 0), sailMat);
    arm.add(spar, sail);
    hub.add(arm);
  }
  hub.add(new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), darkWood));
  windmill.add(tower, millCap, hub);
  windmill.position.set(WINDMILL.x, 0, WINDMILL.z);
  windmill.rotation.y = 0.4;
  scene.add(casts(windmill));

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
  const scatter = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    count: number,
    minR: number,
    maxR: number,
    place: (x: number, z: number) => { y: number; scale: THREE.Vector3; color?: number },
    shadow = false,
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
    mesh.castShadow = shadow;
    scene.add(mesh);
  };

  // Trees: pines and round leafy trees, some in blossom or autumn colours, all swaying a little.
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.38, 1.6, 6).translate(0, 0.8, 0);
  const pineGeo = (() => {
    const a = new THREE.ConeGeometry(1.7, 2.6, 7).translate(0, 2.3, 0);
    const b = new THREE.ConeGeometry(1.3, 2.2, 7).translate(0, 3.6, 0);
    const top = new THREE.ConeGeometry(0.85, 1.8, 7).translate(0, 4.8, 0);
    return mergeGeometries([a, b, top]);
  })();
  const roundGeo = (() => {
    const a = new THREE.IcosahedronGeometry(1.6, 0).translate(0, 3, 0);
    const b = new THREE.IcosahedronGeometry(1.1, 0).translate(0.9, 2.5, 0.4);
    const d = new THREE.IcosahedronGeometry(1.1, 0).translate(-0.8, 2.6, -0.3);
    return mergeGeometries([a, b, d]);
  })();
  const pines: [number, number, number][] = [];
  const rounds: [number, number, number][] = [];
  for (let i = 0; i < 190; i++) {
    const at = spot(20, 200);
    if (!at) continue;
    (rand() < 0.5 ? pines : rounds).push([at[0], at[1], range(0.8, 1.9)]);
  }
  // A few clusters close to the base so the play area has some shade.
  for (const [cx, cz] of [[-52, -16], [-8, -18], [12, 16], [-30, 18], [-56, 4]] as const) {
    for (let k = 0; k < 4; k++) {
      const x = cx + range(-4, 4);
      const z = cz + range(-4, 4);
      if (!keepClear(x, z)) (k % 2 ? pines : rounds).push([x, z, range(0.9, 1.5)]);
    }
  }
  const trunks = new THREE.InstancedMesh(trunkGeo, lambert(0x7a4f2c), pines.length + rounds.length);
  [...pines, ...rounds].forEach(([x, z, s], i) => {
    m.compose(new THREE.Vector3(x, groundHeight(x, z), z), q.identity(), new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(i, m);
  });
  trunks.castShadow = true;
  scene.add(trunks);
  const leaves = (geo: THREE.BufferGeometry, spots: [number, number, number][], palette: number[]) => {
    const mesh = new THREE.InstancedMesh(geo, sway(lambert(0xffffff), 0.025), spots.length);
    spots.forEach(([x, z, s], i) => {
      q.setFromAxisAngle(up, rand() * 6);
      m.compose(new THREE.Vector3(x, groundHeight(x, z), z), q, new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.setHex(pick(palette)));
    });
    mesh.castShadow = true;
    scene.add(mesh);
  };
  leaves(pineGeo, pines, [0x2f8f45, 0x2a7d48, 0x3a9a4c, 0x26734a]);
  leaves(roundGeo, rounds, [0x4caf50, 0x5cbf4a, 0x43a047, 0x7cc943, 0xffa3c4, 0xf6a04d, 0x4caf50, 0x5cbf4a]);

  // Ground cover: flowers, grass tufts, mushrooms, rocks and bushes.
  const flowerColors = [0xff5d73, 0xffd23f, 0xffffff, 0xb57bff, 0xff9f43, 0x4dabff];
  scatter(new THREE.IcosahedronGeometry(0.17, 0), lambert(0xffffff), 1100, 6, 100, () => ({
    y: 0.24,
    scale: new THREE.Vector3(1, 1, 1),
    color: pick(flowerColors),
  }));
  scatter(new THREE.ConeGeometry(0.14, 0.6, 4).translate(0, 0.3, 0), sway(lambert(0xffffff), 0.12), 1600, 6, 120, () => {
    const s = range(0.7, 1.5);
    return { y: 0, scale: new THREE.Vector3(s, s, s), color: pick([0x3f8f45, 0x4f9e3c, 0x5aa83e, 0x37804a]) };
  });
  const capGeo2 = new THREE.SphereGeometry(0.32, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.32, 0);
  const stemGeo = new THREE.CylinderGeometry(0.09, 0.12, 0.34, 6).translate(0, 0.17, 0);
  const mushrooms: [number, number, number][] = [];
  for (let i = 0; i < 50; i++) {
    const at = spot(8, 70);
    if (at) mushrooms.push([at[0], at[1], range(0.7, 1.6)]);
  }
  for (const [geo, color] of [
    [stemGeo, 0xf5ecd8],
    [capGeo2, 0xe63946],
  ] as const) {
    const mesh = new THREE.InstancedMesh(geo, lambert(color), mushrooms.length);
    mushrooms.forEach(([x, z, s], i) => {
      m.compose(new THREE.Vector3(x, 0, z), q.identity(), new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(i, m);
    });
    scene.add(mesh);
  }
  scatter(new THREE.IcosahedronGeometry(1, 0), lambert(0xffffff), 80, 8, 150, () => {
    const s = range(0.3, 1.6);
    return { y: 0.15 * s, scale: new THREE.Vector3(s, s * 0.6, s * range(0.8, 1.2)), color: pick([0x9aa0a8, 0xa9a39a, 0x8c949e]) };
  }, true);
  scatter(new THREE.IcosahedronGeometry(1, 1), sway(lambert(0xffffff), 0.03), 80, 10, 130, () => {
    const s = range(0.8, 1.6);
    return { y: 0.5 * s, scale: new THREE.Vector3(s * 1.2, s, s), color: pick([0x3e9a4e, 0x47a84f, 0x358a49]) };
  }, true);

  // A flower bed along the front of the showcase.
  const bed = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.2, 0), lambert(0xffffff), 140);
  for (let i = 0; i < 140; i++) {
    const x = -35 + rand() * 25;
    const z = range(5.7, 6.7);
    m.compose(new THREE.Vector3(x, 0.3, z), q.identity(), new THREE.Vector3(1, 1, 1));
    bed.setMatrixAt(i, m);
    bed.setColorAt(i, c.setHex(pick(flowerColors)));
  }
  scene.add(bed);
  const soil = new THREE.Mesh(new THREE.BoxGeometry(25.5, 0.35, 1.4), lambert(0x6b4a2e));
  soil.position.set(-22.5, 0.12, 6.2);
  scene.add(soil);

  // Distant hills, then snowy mountains ringing the horizon. The mountains skip fog and carry their own
  // hazy blue, so they stay visible past the fog line.
  const hillMat = lambert(0x5fae62);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + range(-0.2, 0.2);
    const hill = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), hillMat);
    const r = range(55, 95);
    hill.scale.set(r, range(18, 34), r * range(0.7, 1.1));
    hill.position.set(Math.cos(a) * 300, -4, Math.sin(a) * 300);
    scene.add(hill);
  }
  const rockMat = new THREE.MeshLambertMaterial({ color: 0xa7bcdb, flatShading: true, fog: false });
  const snowMat = new THREE.MeshLambertMaterial({ color: 0xf4f8ff, flatShading: true, fog: false });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + range(-0.12, 0.12);
    const h = range(60, 115);
    const w = range(60, 100);
    const peak = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(w, h, 6), rockMat);
    body.position.y = h / 2;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(w * 0.32, h * 0.32, 6), snowMat);
    cap.position.y = h - h * 0.16 + 0.5;
    peak.add(body, cap);
    peak.rotation.y = rand() * 6;
    peak.position.set(Math.cos(a) * 620, -15, Math.sin(a) * 620);
    scene.add(peak);
  }

  // Butterflies wander around the base.
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.32, 0, 0.18, 0.28, 0, -0.2], 3));
  wingGeo.computeVertexNormals();
  const butterflies = Array.from({ length: 14 }, (_, i) => {
    const mat = new THREE.MeshBasicMaterial({ color: pick([0xffd23f, 0xff7ab8, 0xffffff, 0x7fc8ff, 0xff9f43]), side: THREE.DoubleSide });
    const group = new THREE.Group();
    const left = new THREE.Mesh(wingGeo, mat);
    const right = new THREE.Mesh(wingGeo, mat);
    right.scale.x = -1;
    group.add(left, right);
    scene.add(group);
    return {
      group,
      left,
      right,
      cx: range(-46, 10),
      cz: range(-14, 16),
      r: range(1.5, 4),
      speed: range(0.3, 0.6) * (i % 2 ? 1 : -1),
      phase: rand() * Math.PI * 2,
    };
  });

  return {
    update(t: number) {
      wind.value = t;
      hub.rotation.z = -t * 0.6;
      water.emissive.setRGB(0.04, 0.23 + Math.sin(t * 0.8) * 0.03, 0.4 + Math.sin(t * 0.8) * 0.04);
      for (const b of butterflies) {
        const a = b.phase + t * b.speed;
        const x = b.cx + Math.cos(a) * b.r + Math.sin(t * 0.37 + b.phase) * 1.5;
        const z = b.cz + Math.sin(a * 1.3) * b.r;
        b.group.position.set(x, 0.9 + Math.sin(t * 2.1 + b.phase) * 0.35, z);
        b.group.rotation.y = a + (b.speed > 0 ? Math.PI : 0);
        const flap = Math.sin(t * 18 + b.phase) * 0.9;
        b.left.rotation.z = flap;
        b.right.rotation.z = -flap;
      }
    },
  };
}

/** Joins geometries with the same attributes (position, normal, uv) into one. */
function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const arrays = flat.map((p) => p.getAttribute(name).array as Float32Array);
    const size = flat[0].getAttribute(name).itemSize;
    const total = arrays.reduce((n, a) => n + a.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const a of arrays) {
      merged.set(a, offset);
      offset += a.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(merged, size));
  }
  return out;
}

/** A sky dome: deep blue overhead fading to a pale horizon, with a soft sun. It follows the camera. */
export function makeSkyDome(): {
  mesh: THREE.Mesh;
  update(sky: THREE.Color, horizon: THREE.Color, at: THREE.Vector3): void;
} {
  const uniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSun: { value: new THREE.Vector3(30, 80, 50).normalize() },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uSun;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float t = pow(clamp(d.y, 0.0, 1.0), 0.55);
        vec3 col = mix(uHorizon, uTop, t);
        float s = max(dot(d, normalize(uSun)), 0.0);
        col += vec3(1.0, 0.92, 0.7) * (pow(s, 900.0) * 1.2 + pow(s, 30.0) * 0.18);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), mat);
  const deepen = new THREE.Color(0.55, 0.72, 0.98);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return {
    mesh,
    update(sky, horizon, at) {
      uniforms.uTop.value.copy(sky).multiply(deepen);
      uniforms.uHorizon.value.copy(horizon);
      mesh.position.copy(at);
    },
  };
}
