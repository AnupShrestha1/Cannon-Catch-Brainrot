// Particle bursts and high-speed wind streaks.
import * as THREE from 'three';
import { softTexture } from './world';

interface Particle {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  grow: number;
  gravity: number;
  drag: number;
}

export interface BurstOptions {
  count: number;
  color: number;
  speed: number;
  life: number;
  size: number;
  grow?: number;
  gravity?: number;
  drag?: number;
  /** Extra upward speed added to every particle. */
  up?: number;
  /** Squash the spread vertically, e.g. 0.3 for dust that hugs the ground. */
  flatten?: number;
}

export class Particles {
  private pool: Particle[] = [];
  private live: Particle[] = [];

  constructor(scene: THREE.Scene, size = 320) {
    for (let i = 0; i < size; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: softTexture(), transparent: true, depthWrite: false }),
      );
      sprite.visible = false;
      scene.add(sprite);
      this.pool.push({ sprite, vel: new THREE.Vector3(), life: 0, max: 1, size: 1, grow: 0, gravity: 0, drag: 0 });
    }
  }

  burst(at: THREE.Vector3, o: BurstOptions): void {
    for (let i = 0; i < o.count; i++) {
      const p = this.pool.pop();
      if (!p) return;
      (p.sprite.material as THREE.SpriteMaterial).color.setHex(o.color);
      p.sprite.position.copy(at);
      p.sprite.visible = true;
      p.vel.randomDirection().multiplyScalar(o.speed * (0.4 + Math.random() * 0.6));
      p.vel.y = p.vel.y * (o.flatten ?? 1) + (o.up ?? 0);
      p.max = p.life = o.life * (0.7 + Math.random() * 0.6);
      p.size = o.size;
      p.grow = o.grow ?? 1;
      p.gravity = o.gravity ?? 0;
      p.drag = o.drag ?? 1.5;
      this.live.push(p);
    }
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.visible = false;
        this.live.splice(i, 1);
        this.pool.push(p);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.sprite.position.addScaledVector(p.vel, dt);
      const k = p.life / p.max;
      (p.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, k * 1.5);
      p.sprite.scale.setScalar(p.size * (1 + (1 - k) * p.grow));
    }
  }
}

/** Thin vertical lines fixed in the world; they read as wind once the player moves fast past them. */
export class Streaks {
  private lines: THREE.Mesh[] = [];
  private mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });

  constructor(scene: THREE.Scene, count = 70) {
    const geo = new THREE.BoxGeometry(0.05, 1, 0.05);
    for (let i = 0; i < count; i++) {
      const line = new THREE.Mesh(geo, this.mat);
      line.position.set((Math.random() - 0.5) * 40, Math.random() * 50, -12 + Math.random() * 20);
      scene.add(line);
      this.lines.push(line);
    }
  }

  update(centerY: number, vy: number): void {
    const speed = Math.abs(vy);
    this.mat.opacity = Math.min(0.55, Math.max(0, (speed - 22) / 80));
    const visible = this.mat.opacity > 0.01;
    const length = Math.min(9, Math.max(1, speed * 0.06));
    for (const line of this.lines) {
      line.visible = visible;
      while (line.position.y < centerY - 25) line.position.y += 50;
      while (line.position.y > centerY + 25) line.position.y -= 50;
      line.scale.y = length;
    }
  }
}

/**
 * Fireworks sparks: thousands of glowing points in one draw call. Additive, so a spark fades by darkening its
 * colour; a ring buffer recycles the oldest sparks when it's full.
 */
export class Sparks {
  private pos: Float32Array;
  private col: Float32Array;
  private base: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private gravity: Float32Array;
  private drag: Float32Array;
  private next = 0;
  private geo = new THREE.BufferGeometry();
  private alive = 0;
  private c = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    private n = 3000,
  ) {
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.base = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.gravity = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const points = new THREE.Points(
      this.geo,
      new THREE.PointsMaterial({
        size: 0.85,
        map: softTexture(),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    points.frustumCulled = false;
    scene.add(points);
  }

  burst(at: THREE.Vector3, o: { count: number; color: number; speed: number; life: number; gravity?: number; drag?: number; up?: number }): void {
    this.c.setHex(o.color);
    for (let k = 0; k < o.count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      // A random direction on a sphere, at a random share of the speed (denser in the middle).
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = o.speed * (0.35 + 0.65 * Math.cbrt(Math.random()));
      this.pos.set([at.x, at.y, at.z], i * 3);
      this.vel.set([Math.cos(a) * r * s, u * s + (o.up ?? 0), Math.sin(a) * r * s], i * 3);
      // A little under full brightness, so overlapping bursts keep their colour instead of adding up to white.
      this.base.set([this.c.r * 0.55, this.c.g * 0.55, this.c.b * 0.55], i * 3);
      this.life[i] = this.max[i] = o.life * (0.7 + Math.random() * 0.3);
      this.gravity[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 0;
    }
    this.alive = this.n;
  }

  update(dt: number): void {
    if (!this.alive) return;
    let any = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      any++;
      this.life[i] -= dt;
      const j = i * 3;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[j] *= k;
      this.vel[j + 1] = this.vel[j + 1] * k - this.gravity[i] * dt;
      this.vel[j + 2] *= k;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      // Bright, then fading, with a little twinkle at the end.
      const t = Math.max(0, this.life[i] / this.max[i]);
      const f = t < 0.3 ? t / 0.3 * (0.6 + Math.random() * 0.4) : 1;
      this.col[j] = this.base[j] * f;
      this.col[j + 1] = this.base[j + 1] * f;
      this.col[j + 2] = this.base[j + 2] * f;
      if (this.life[i] <= 0) this.col.fill(0, j, j + 3);
    }
    this.alive = any;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
