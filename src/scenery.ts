// Scenery around the town: a gradient sky with a sun, patchy grass with rolling hills and snowy mountains
// further out, trees that sway in the wind, a little ground cover, a pond with lily pads and a dock, a windmill,
// a few butterflies, and the two leaderboards in the hub. The town itself (paving, plots, hub) is drawn by
// hub.ts and base.ts. Kept deliberately sparse so the town reads clearly. Seeded, so the world looks the same
// every load; repeated props are instanced to stay cheap.
import * as THREE from 'three';
import { BOARDS, TOWN } from './layout';

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

/** Flat over the whole town and a margin around it, rolling hills beyond. */
function groundHeight(x: number, z: number): number {
  // Distance outside the town's rectangle.
  const dx = Math.max(TOWN.minX - x, 0, x - TOWN.maxX);
  const dz = Math.max(TOWN.minZ - z, 0, z - TOWN.maxZ);
  const d = Math.hypot(dx, dz);
  if (d < 25) return 0;
  const ramp = Math.min(1, (d - 25) / 60);
  return ramp * (5 + Math.sin(x * 0.03) * Math.cos(z * 0.025) * 4 + Math.sin(x * 0.011 + z * 0.017) * 6);
}

// Two landmarks frame the town from outside: the windmill behind the hub, seen past the cannon from the launch
// camera, and the pond off the cannon side of the lane.
const POND = { x: TOWN.maxX + 18, z: 46, r: 9 };
const WINDMILL = { x: -30, z: TOWN.minZ - 22 };
/** The town's centre, which scattered props are placed around. */
const CENTER = { x: (TOWN.minX + TOWN.maxX) / 2, z: (TOWN.minZ + TOWN.maxZ) / 2 };
/** Distance from a point to the town's rectangle (0 inside it). */
function fromTown(x: number, z: number): number {
  return Math.hypot(Math.max(TOWN.minX - x, 0, x - TOWN.maxX), Math.max(TOWN.minZ - z, 0, z - TOWN.maxZ));
}

/** Where props may not go: the town (with a margin), the pond and the buildings. */
function keepClear(x: number, z: number): boolean {
  if (x > TOWN.minX - 4 && x < TOWN.maxX + 4 && z > TOWN.minZ - 4 && z < TOWN.maxZ + 4) return true;
  if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 2) return true;
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

/** One row on a leaderboard. */
export interface BoardRow {
  name: string;
  value: string;
  /** The local player's row, highlighted. */
  you: boolean;
}

export interface Scenery {
  /** Moves the windmill, butterflies, wind and water. `t` is seconds since start. */
  update(t: number): void;
  /** Redraws one of the hub's leaderboards (0: left, 1: right). */
  drawBoard(index: number, title: string, rows: BoardRow[]): void;
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

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const wood = lambert(0x9a6a3c);
  const darkWood = lambert(0x6e4526);
  const flowerColors = [0xff5d73, 0xffd23f, 0xffffff, 0xb57bff, 0xff9f43, 0x4dabff];

  // The two leaderboards at the back of the hub, facing the cannon (placeholders until multiplayer fills them).
  const boardMat = lambert(0x3d2a6b);
  const boards: ((title: string, rows: BoardRow[]) => void)[] = [];
  for (const [bx, bz] of BOARDS) {
    const board = new THREE.Group();
    board.position.set(bx, 0, bz);
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.2, 0.3), wood);
      leg.position.set(side * 1.9, 1.6, 0);
      board.add(leg);
    }
    const panel = new THREE.Mesh(new THREE.BoxGeometry(4.4, 3, 0.25), boardMat);
    panel.position.y = 3.6;
    const trim = new THREE.Mesh(new THREE.BoxGeometry(4.7, 0.25, 0.32), lambert(0xffc84a));
    trim.position.y = 5.2;
    board.add(panel, trim);
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 348;
    const g2 = canvas.getContext('2d')!;
    const tex = new THREE.CanvasTexture(canvas);
    boards.push((title, rows) => {
      g2.fillStyle = '#3d2a6b';
      g2.fillRect(0, 0, 512, 348);
      g2.textAlign = 'center';
      g2.fillStyle = '#ffd84a';
      g2.font = '900 46px system-ui, sans-serif';
      g2.fillText(title, 256, 56);
      g2.font = '700 34px system-ui, sans-serif';
      rows.slice(0, 5).forEach((row, i) => {
        const y = 112 + i * 50;
        if (row.you) {
          g2.fillStyle = 'rgba(255, 216, 74, 0.25)';
          g2.fillRect(14, y - 36, 484, 46);
        }
        g2.fillStyle = row.you ? '#ffd84a' : '#ffffff';
        g2.textAlign = 'left';
        g2.fillText(`${i + 1}. ${row.name}`, 28, y);
        g2.textAlign = 'right';
        g2.fillText(row.value, 484, y);
      });
      tex.needsUpdate = true;
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.85), new THREE.MeshBasicMaterial({ map: tex }));
    face.position.set(0, 3.6, 0.14);
    board.add(face);
    scene.add(casts(board));
  }

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
  windmill.rotation.y = 0.3;
  scene.add(casts(windmill));

  // Scattered props, instanced. `spot` finds a clear place, or null after a few tries.
  // `minR` and `maxR` are distances out from the town's edge.
  const spot = (minR: number, maxR: number): [number, number] | null => {
    const hx = (TOWN.maxX - TOWN.minX) / 2 + maxR;
    const hz = (TOWN.maxZ - TOWN.minZ) / 2 + maxR;
    for (let tries = 0; tries < 20; tries++) {
      const x = CENTER.x + range(-hx, hx);
      const z = CENTER.z + range(-hz, hz);
      const d = fromTown(x, z);
      if (d >= minR && d <= maxR && !keepClear(x, z)) return [x, z];
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
  for (let i = 0; i < 170; i++) {
    const at = spot(10, 170);
    if (!at) continue;
    (rand() < 0.5 ? pines : rounds).push([at[0], at[1], range(0.8, 1.9)]);
  }
  // Clusters around the town's edges, framing it.
  for (const [cx, cz] of [
    [TOWN.minX - 7, TOWN.minZ + 4],
    [TOWN.maxX + 7, TOWN.minZ + 4],
    [TOWN.minX - 7, 40],
    [TOWN.minX - 7, TOWN.maxZ - 4],
    [TOWN.maxX + 7, TOWN.maxZ - 4],
    [8, TOWN.minZ - 9],
  ] as const) {
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
  scatter(new THREE.IcosahedronGeometry(0.17, 0), lambert(0xffffff), 450, 4, 80, () => ({
    y: 0.24,
    scale: new THREE.Vector3(1, 1, 1),
    color: pick(flowerColors),
  }));
  scatter(new THREE.ConeGeometry(0.14, 0.6, 4).translate(0, 0.3, 0), sway(lambert(0xffffff), 0.12), 800, 4, 100, () => {
    const s = range(0.7, 1.5);
    return { y: 0, scale: new THREE.Vector3(s, s, s), color: pick([0x3f8f45, 0x4f9e3c, 0x5aa83e, 0x37804a]) };
  });
  const capGeo2 = new THREE.SphereGeometry(0.32, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.32, 0);
  const stemGeo = new THREE.CylinderGeometry(0.09, 0.12, 0.34, 6).translate(0, 0.17, 0);
  const mushrooms: [number, number, number][] = [];
  for (let i = 0; i < 18; i++) {
    const at = spot(6, 60);
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
  scatter(new THREE.IcosahedronGeometry(1, 0), lambert(0xffffff), 45, 8, 130, () => {
    const s = range(0.3, 1.6);
    return { y: 0.15 * s, scale: new THREE.Vector3(s, s * 0.6, s * range(0.8, 1.2)), color: pick([0x9aa0a8, 0xa9a39a, 0x8c949e]) };
  }, true);
  scatter(new THREE.IcosahedronGeometry(1, 1), sway(lambert(0xffffff), 0.03), 45, 6, 110, () => {
    const s = range(0.8, 1.6);
    return { y: 0.5 * s, scale: new THREE.Vector3(s * 1.2, s, s), color: pick([0x3e9a4e, 0x47a84f, 0x358a49]) };
  }, true);

  // Distant rolling hills ringing the town (no far mountains: from high up they floated past the ground's
  // edge and looked half there).
  const hillMat = lambert(0x5fae62);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + range(-0.2, 0.2);
    const hill = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), hillMat);
    const r = range(55, 95);
    hill.scale.set(r, range(18, 34), r * range(0.7, 1.1));
    hill.position.set(Math.cos(a) * 300, -4, Math.sin(a) * 300);
    scene.add(hill);
  }
  // Butterflies wander around the base.
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.32, 0, 0.18, 0.28, 0, -0.2], 3));
  wingGeo.computeVertexNormals();
  const butterflies = Array.from({ length: 8 }, (_, i) => {
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
      // Over the lane and the hub.
      cx: range(-20, 8),
      cz: range(-15, 95),
      r: range(1.5, 4),
      speed: range(0.3, 0.6) * (i % 2 ? 1 : -1),
      phase: rand() * Math.PI * 2,
    };
  });

  return {
    drawBoard(index, title, rows) {
      boards[index]?.(title, rows);
    },
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
