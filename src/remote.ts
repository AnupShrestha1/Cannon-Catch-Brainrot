// Draws the other players from the server's snapshots: their avatars (outfit, name tag, walk cycle, flight
// poses, parachute) and their plots (rebuilt when an owner joins or leaves, brainrots kept in sync). It only
// reads RemotePlayer data, so it works the same for the fake server's bots and for real players later.
import * as THREE from 'three';
import { Base } from './base';
import { OWN_SLOT, SLOTS, gatePoint, plotAt } from './layout';
import type { FakeServer, RemotePlayer } from './net';
import { makeLabel, makePlayer, type Label, type PlayerRig } from './world';

/** Other players' brainrots are only drawn when the local player is in their plot or this close to its gate. */
const DETAIL_RANGE = 14;

interface Avatar {
  rig: PlayerRig;
  tag: Label;
  /** What the name tag shows now (the name, or the name with AFK). */
  tagText: string;
  bubble: THREE.Sprite;
  drawBubble: (text: string) => void;
  bubbleText: string;
  phase: number;
}

/** A speech bubble: a white rounded box with dark text and a little tail, drawn on a canvas. */
function makeBubble(): { sprite: THREE.Sprite; draw: (text: string) => void } {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(4, 1, 1);
  sprite.position.y = 3.35;
  sprite.visible = false;
  return {
    sprite,
    draw(text) {
      g.clearRect(0, 0, 512, 128);
      g.font = '700 40px Fredoka, system-ui, sans-serif';
      const shown = text.length > 34 ? `${text.slice(0, 33)}…` : text;
      const w = Math.min(500, g.measureText(shown).width + 44);
      const x = (512 - w) / 2;
      g.fillStyle = '#ffffff';
      g.strokeStyle = '#1d1640';
      g.lineWidth = 6;
      g.beginPath();
      g.roundRect(x, 8, w, 84, 26);
      g.moveTo(240, 90);
      g.lineTo(256, 118);
      g.lineTo(272, 90);
      g.fill();
      g.stroke();
      g.fillStyle = '#ffffff';
      g.fillRect(242, 84, 28, 8);
      g.fillStyle = '#1d1640';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(shown, 256, 52);
      texture.needsUpdate = true;
    },
  };
}

interface Plot {
  base: Base;
  owner: number | null;
  padsKey: string;
  center: [number, number];
}

export class RemoteView {
  private avatars = new Map<number, Avatar>();
  private plots = new Map<number, Plot>();

  constructor(
    private scene: THREE.Scene,
    private server: FakeServer,
  ) {
    for (const slot of SLOTS) {
      if (slot.index === OWN_SLOT) continue;
      this.plots.set(slot.index, {
        base: new Base(scene, slot, { vacant: true }),
        owner: null,
        padsKey: '',
        center: gatePoint(slot, false),
      });
    }
  }

  /** Who owns a slot right now, or null. */
  ownerOf(slot: number): RemotePlayer | null {
    return this.server.players().find((p) => p.slot === slot) ?? null;
  }

  update(time: number, dt: number, viewerX: number, viewerZ: number): void {
    const players = this.server.players();
    this.syncPlots(players, time, dt, viewerX, viewerZ);
    const seen = new Set<number>();
    for (const p of players) {
      seen.add(p.id);
      let avatar = this.avatars.get(p.id);
      if (!avatar) {
        const rig = makePlayer(p.outfit);
        const tag = makeLabel();
        tag.set(p.name, '#ffffff');
        tag.sprite.scale.multiplyScalar(0.5);
        tag.sprite.position.y = 2.6;
        const bubble = makeBubble();
        rig.group.add(tag.sprite, bubble.sprite);
        this.scene.add(rig.group);
        avatar = { rig, tag, tagText: p.name, bubble: bubble.sprite, drawBubble: bubble.draw, bubbleText: '', phase: Math.random() * 10 };
        this.avatars.set(p.id, avatar);
      }
      this.pose(avatar, p, time, dt);
    }
    for (const [id, avatar] of this.avatars) {
      if (seen.has(id)) continue;
      this.scene.remove(avatar.rig.group);
      this.avatars.delete(id);
    }
  }

  /** Rebuilds a plot when its owner changes, keeps its showcase in sync, and draws brainrots only up close. */
  private syncPlots(players: RemotePlayer[], time: number, dt: number, vx: number, vz: number): void {
    for (const [index, plot] of this.plots) {
      const owner = players.find((p) => p.slot === index) ?? null;
      const ownerId = owner?.id ?? null;
      if (ownerId !== plot.owner) {
        plot.base.dispose();
        plot.base = new Base(this.scene, SLOTS[index], owner ? { owner: owner.name } : { vacant: true });
        plot.owner = ownerId;
        plot.padsKey = '';
      }
      if (!owner) {
        plot.base.update({ pads: [] }, time, dt);
        continue;
      }
      const key = owner.pads.map((p) => (p ? `${p.name}:${p.level ?? 1}` : '-')).join(',');
      if (key !== plot.padsKey) {
        plot.padsKey = key;
        plot.base.sync({ pads: owner.pads });
      }
      const near = plotAt(vx, vz)?.index === index || Math.hypot(plot.center[0] - vx, plot.center[1] - vz) < DETAIL_RANGE;
      plot.base.setDetail(near);
      plot.base.update({ pads: owner.pads }, time, dt);
    }
  }

  /** Places an avatar and moves its limbs for what the player is doing. */
  private pose(avatar: Avatar, p: RemotePlayer, time: number, dt: number): void {
    const { rig } = avatar;
    rig.group.visible = p.pose !== 'hidden';
    rig.group.position.set(p.x, p.y, p.z);
    rig.group.rotation.y = p.pose === 'walk' || p.pose === 'idle' ? p.facing : 0;
    // Name tag (with AFK when they're away) and speech bubble.
    const tagText = p.afk ? `${p.name} · AFK` : p.name;
    if (tagText !== avatar.tagText) {
      avatar.tagText = tagText;
      avatar.tag.set(tagText, p.afk ? '#c9ced6' : '#ffffff');
    }
    if (p.bubble !== avatar.bubbleText) {
      avatar.bubbleText = p.bubble;
      if (p.bubble) avatar.drawBubble(p.bubble);
    }
    avatar.bubble.visible = !!p.bubble && rig.group.visible;
    rig.chute.visible = p.chute > 0.02;
    rig.chute.scale.setScalar(p.chute);
    const k = 1 - Math.exp(-14 * dt);
    let armOut = 0.25;
    let armSwing = 0;
    let legSwing = 0;
    let spread = 0;
    const airborne = p.jump > 0.05;
    if (airborne) {
      // Mid-jump: knees tucked, arms out.
      armOut = 1.1;
      legSwing = 0.6;
    } else if (p.pose === 'walk') {
      // The stride keeps time with their speed.
      avatar.phase += dt * Math.max(4, p.speed * 1.4);
      const amp = Math.min(1, p.speed / 6);
      armOut = 0.15;
      armSwing = Math.sin(avatar.phase) * 0.7 * amp;
      legSwing = Math.sin(avatar.phase) * 0.8 * amp;
    } else if (p.pose === 'up') {
      armOut = 2.9;
    } else if (p.pose === 'fall') {
      armOut = 1.7 + Math.sin(time * 14) * 0.3;
      spread = 0.35;
    } else if (p.pose === 'chute') {
      armOut = 2.75;
      legSwing = Math.sin(time * 2) * 0.25;
    } else if (p.pose === 'land') {
      armOut = 1.2;
      spread = 0.3;
    }
    rig.body.rotation.x += ((p.pose === 'fall' ? -1.1 : 0) - rig.body.rotation.x) * k;
    rig.body.position.y = 0.9 + (p.pose === 'walk' && !airborne ? Math.abs(Math.sin(avatar.phase)) * 0.08 : 0);
    rig.arms.forEach((arm, i) => {
      const side = i === 0 ? -1 : 1;
      arm.rotation.z += (side * armOut - arm.rotation.z) * k;
      arm.rotation.x += (-side * armSwing - arm.rotation.x) * k;
    });
    rig.legs.forEach((leg, i) => {
      const side = i === 0 ? -1 : 1;
      const want = airborne ? -legSwing : side * legSwing;
      leg.rotation.x += (want - leg.rotation.x) * k;
      leg.rotation.z += (side * spread - leg.rotation.z) * k;
    });
  }
}
