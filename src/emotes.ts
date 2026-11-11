// Emotes: six short animations anyone can play at the base (picked from the emote wheel), each with an emoji
// that pops up over their head. The poses are written as targets for the rig's joints, so the same emote
// plays on the local player and on everyone else.
import * as THREE from 'three';
import type { PlayerRig } from './world';

export type EmoteId = 'wave' | 'dance' | 'laugh' | 'clap' | 'flex' | 'cry';

export interface Emote {
  id: EmoteId;
  name: string;
  emoji: string;
  /** Seconds it plays. */
  length: number;
}

/** In wheel order, clockwise from the top. */
export const EMOTES: Emote[] = [
  { id: 'wave', name: 'Wave', emoji: '👋', length: 2.2 },
  { id: 'dance', name: 'Dance', emoji: '🕺', length: 4.4 },
  { id: 'clap', name: 'Clap', emoji: '👏', length: 2.4 },
  { id: 'flex', name: 'Flex', emoji: '💪', length: 2.4 },
  { id: 'cry', name: 'Cry', emoji: '😭', length: 2.8 },
  { id: 'laugh', name: 'Laugh', emoji: '😂', length: 2.6 },
];

export const emoteById = (id: string): Emote | undefined => EMOTES.find((e) => e.id === id);

/** Joint targets for a moment of an emote: shoulders and hips (left, right), plus the body's lean and hop. */
export interface EmotePose {
  /** Arm raise outward (rotation.z magnitude, the side's sign is applied for you). */
  armOut: [number, number];
  /** Arm swing forward (+) or back (-). */
  armFwd: [number, number];
  legFwd: [number, number];
  legOut: [number, number];
  /** Body lean forward (+), tilt to the side, turn, and hop height. */
  lean: number;
  tilt: number;
  turn: number;
  hop: number;
}

/** Where the joints should be `t` seconds into emote `id`. Eased in and out at the ends by the caller. */
export function emotePose(id: EmoteId, t: number): EmotePose {
  const p: EmotePose = { armOut: [0.25, 0.25], armFwd: [0, 0], legFwd: [0, 0], legOut: [0, 0], lean: 0, tilt: 0, turn: 0, hop: 0 };
  const s = Math.sin;
  switch (id) {
    case 'wave':
      // Right arm up high, hand waving side to side.
      p.armOut = [0.2, 2.6 + s(t * 14) * 0.35];
      p.tilt = -0.08;
      p.hop = Math.abs(s(t * 7)) * 0.03;
      break;
    case 'dance': {
      // A goofy bounce: arms pumping up and down in turn, hips swaying, knees kicking out.
      const b = t * 9;
      p.armOut = [1.4 + s(b) * 1.1, 1.4 - s(b) * 1.1];
      p.armFwd = [s(b * 0.5) * 0.5, -s(b * 0.5) * 0.5];
      p.legFwd = [Math.max(0, s(b)) * 0.7, Math.max(0, -s(b)) * 0.7];
      p.legOut = [0.15, 0.15];
      p.tilt = s(b) * 0.18;
      p.turn = s(t * 2.2) * 0.6;
      p.hop = Math.abs(s(b)) * 0.18;
      break;
    }
    case 'clap': {
      // Arms out front, hands meeting and parting.
      const c = Math.abs(s(t * 11));
      p.armFwd = [1.35, 1.35];
      p.armOut = [0.15 + c * 0.55, 0.15 + c * 0.55];
      p.hop = c * 0.03;
      break;
    }
    case 'flex': {
      // Both arms up and bent at the shoulders, pumping, chest out.
      const f = Math.abs(s(t * 6));
      p.armOut = [1.55 + f * 0.25, 1.55 + f * 0.25];
      p.armFwd = [-0.3, -0.3];
      p.lean = -0.12;
      p.legOut = [0.25, 0.25];
      p.hop = f * 0.05;
      break;
    }
    case 'cry':
      // Hunched over, hands up at the face, shoulders shaking with sobs.
      p.armFwd = [2.3, 2.3];
      p.armOut = [0.45, 0.45];
      p.lean = 0.35;
      p.tilt = s(t * 22) * 0.04;
      p.hop = Math.abs(s(t * 11)) * 0.03;
      break;
    case 'laugh':
      // Leaning back, hands on the belly, bouncing with each laugh.
      p.armFwd = [0.75, 0.75];
      p.armOut = [0.1, 0.1];
      p.lean = -0.22 + Math.abs(s(t * 12)) * 0.12;
      p.hop = Math.abs(s(t * 12)) * 0.06;
      break;
  }
  return p;
}

/**
 * Plays an emote on a rig: eases the joints toward the pose (k is the blend for this frame). `t` is seconds
 * into it; returns false once it's over.
 */
export function applyEmote(rig: PlayerRig, emote: Emote, t: number, k: number): boolean {
  if (t >= emote.length) return false;
  const p = emotePose(emote.id, t);
  // The body eases into the pose and back out at the end (set outright: other code pulls it upright).
  const w = Math.min(1, t / 0.2, (emote.length - t) / 0.25);
  rig.arms.forEach((arm, i) => {
    const side = i === 0 ? -1 : 1;
    arm.rotation.z += (side * p.armOut[i] - arm.rotation.z) * k;
    arm.rotation.x += (-p.armFwd[i] - arm.rotation.x) * k;
  });
  rig.legs.forEach((leg, i) => {
    const side = i === 0 ? -1 : 1;
    leg.rotation.x += (-p.legFwd[i] - leg.rotation.x) * k;
    leg.rotation.z += (side * p.legOut[i] - leg.rotation.z) * k;
  });
  rig.body.rotation.x = p.lean * w;
  rig.body.rotation.z = p.tilt * w;
  rig.body.rotation.y = p.turn * w;
  rig.body.position.y = 0.9 + p.hop * w;
  return true;
}

// ---------------------------------------------------------------- emoji pops

const emojiCache = new Map<string, THREE.Texture>();

function emojiTexture(emoji: string): THREE.Texture {
  const hit = emojiCache.get(emoji);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '96px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  // A soft white disc behind, so it reads against any background.
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath();
  g.arc(64, 64, 60, 0, Math.PI * 2);
  g.fill();
  g.fillText(emoji, 64, 70);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  emojiCache.set(emoji, tex);
  return tex;
}

interface Pop {
  sprite: THREE.Sprite;
  t: number;
  life: number;
  size: number;
  rise: number;
  baseY: number;
}

/**
 * Emoji that pop up somewhere (over a head, over a liked brainrot): they spring in bigger than life, settle,
 * float up a little and fade.
 */
export class EmojiPops {
  private pops: Pop[] = [];

  /** Pops `emoji` at `at` inside `parent` (the scene, or a rig's group so it follows them). */
  spawn(parent: THREE.Object3D, emoji: string, at: THREE.Vector3, o: { size?: number; life?: number; rise?: number } = {}): void {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(emoji), transparent: true, depthWrite: false }));
    sprite.position.copy(at);
    sprite.renderOrder = 10;
    sprite.scale.setScalar(0.01);
    parent.add(sprite);
    this.pops.push({ sprite, t: 0, life: o.life ?? 1.6, size: o.size ?? 0.9, rise: o.rise ?? 0.6, baseY: at.y });
  }

  update(dt: number): void {
    this.pops = this.pops.filter((p) => {
      p.t += dt;
      const u = p.t / p.life;
      if (u >= 1) {
        p.sprite.removeFromParent();
        p.sprite.material.dispose();
        return false;
      }
      // Spring in (overshoot), hold, then shrink a touch as it fades.
      const inT = Math.min(1, p.t / 0.35);
      const spring = 1 + Math.sin(inT * Math.PI) * 0.45 * (1 - inT);
      const scale = (inT < 1 ? 1 - Math.pow(1 - inT, 3) : 1) * spring * (u > 0.75 ? 1 - (u - 0.75) * 0.8 : 1);
      p.sprite.scale.setScalar(p.size * scale);
      p.sprite.position.y = p.baseY + p.rise * (1 - Math.pow(1 - u, 2));
      p.sprite.material.opacity = u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1;
      return true;
    });
  }
}
