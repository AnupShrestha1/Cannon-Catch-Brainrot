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
