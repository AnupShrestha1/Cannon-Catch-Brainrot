// Draws the other players from the server's snapshots: their avatars (outfit, name tag, walk cycle, flight
// poses, parachute) and their plots (rebuilt when an owner joins or leaves, brainrots kept in sync). It only
// reads RemotePlayer data, so it works the same for the fake server's bots and for real players later.
import * as THREE from 'three';
import { Base } from './base';
import { EmojiPops, applyEmote, emoteById } from './emotes';
import { OWN_SLOT, SLOTS, fromPlot, plotAt } from './layout';
import type { FakeServer, RemotePlayer } from './net';
import { makeLabel, makePlayer, type Label, type PlayerRig } from './world';

/** Other bases show their brainrots within this many metres of their centre: the bases either side of yours and
 * the ones across the lane (24 and 40 m centre to centre), not the far end of the street. */
const DETAIL_RANGE = 52;

interface Avatar {
  rig: PlayerRig;
  tag: Label;
  /** What the name tag shows now. */
  tagText: string;
  phase: number;
  /** The emote last seen playing, and how far in, to notice a new one starting. */
  emote: string;
  emoteT: number;
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
  /** Emoji over people's heads when they emote. */
  private pops = new EmojiPops();

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
        center: fromPlot(slot, 0, -12),
      });
    }
  }

  /** How many floors a plot's base has (its stairs and decks are walkable). */
  floorsOf(slot: number): number {
    return this.plots.get(slot)?.base.floors ?? 1;
  }

  /** Who owns a slot right now, or null. */
  ownerOf(slot: number): RemotePlayer | null {
    return this.server.players().find((p) => p.slot === slot) ?? null;
  }

  /** Where the camera is: anyone standing right in front of the lens is left out of the shot. */
  private eye = new THREE.Vector3(0, -99, 0);
  /** The player is aiming from the cannon: nobody stands in the strip between the camera and the barrel. */
  private aiming = false;

  update(time: number, dt: number, viewerX: number, viewerZ: number, eye?: THREE.Vector3, aiming = false): void {
    if (eye) this.eye.copy(eye);
    this.aiming = aiming;
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
        rig.group.add(tag.sprite);
        this.scene.add(rig.group);
        avatar = { rig, tag, tagText: p.name, phase: Math.random() * 10, emote: '', emoteT: 0 };
        this.avatars.set(p.id, avatar);
      }
      this.pose(avatar, p, time, dt);
    }
    this.pops.update(dt);
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
      const key = `${owner.rebirths}|${owner.pads.map((p) => (p ? `${p.name}:${p.level ?? 1}` : '-')).join(',')}`;
      if (key !== plot.padsKey) {
        plot.padsKey = key;
        plot.base.sync({ pads: owner.pads, rebirths: owner.rebirths });
      }
      const near = plotAt(vx, vz)?.index === index || Math.hypot(plot.center[0] - vx, plot.center[1] - vz) < DETAIL_RANGE;
      plot.base.setDetail(near);
      plot.base.update({ pads: owner.pads }, time, dt);
    }
  }

  /** Places an avatar and moves its limbs for what the player is doing. */
  private pose(avatar: Avatar, p: RemotePlayer, time: number, dt: number): void {
    const { rig } = avatar;
    rig.group.position.set(p.x, p.y, p.z);
    // Someone walking up to the camera would fill the screen with their back: they step out of the shot.
    const lens = Math.hypot(p.x - this.eye.x, p.y + 1 - this.eye.y, p.z - this.eye.z) < 1.8;
    // While aiming, the camera sits in front of the cannon looking back at it: anyone in between is left out.
    const inShot = this.aiming && Math.abs(p.x - this.eye.x) < 2.6 && p.z > 1 && p.z < this.eye.z + 1;
    rig.group.visible = p.pose !== 'hidden' && !lens && !inShot;
    rig.group.rotation.y = p.pose === 'walk' || p.pose === 'idle' || p.pose === 'dive' ? p.facing : 0;
    // The helmet goes on for the cannon and the flight.
    const flying = p.pose !== 'walk' && p.pose !== 'idle';
    rig.helmet.visible = flying;
    rig.cap.visible = !flying;
    // Name tag (🤖 and the name). Bots standing idle aren't tagged AFK: that's for people.
    if (p.name !== avatar.tagText) {
      avatar.tagText = p.name;
      avatar.tag.set(p.name, '#ffffff');
    }
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
    } else if (p.pose === 'up' || p.pose === 'dive') {
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
    // Diving into the cannon head first; spread-eagle in free fall.
    const pitch = p.pose === 'dive' ? -Math.PI * 0.85 : p.pose === 'fall' ? -1.1 : 0;
    rig.body.rotation.x += (pitch - rig.body.rotation.x) * (p.pose === 'dive' ? 1 - Math.exp(-6 * dt) : k);
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
    // An emote on top, with its emoji popping up over their head when it starts.
    const emote = p.emote && p.pose === 'idle' ? emoteById(p.emote) : undefined;
    if (emote) {
      if (p.emote !== avatar.emote || p.emoteT < avatar.emoteT) {
        this.pops.spawn(rig.group, emote.emoji, new THREE.Vector3(0, 3.3, 0), { size: 0.85, life: Math.min(2.2, emote.length) });
      }
      applyEmote(rig, emote, p.emoteT, k);
    } else {
      rig.body.rotation.y += (0 - rig.body.rotation.y) * k;
      rig.body.rotation.z += (0 - rig.body.rotation.z) * k;
    }
    avatar.emote = emote ? p.emote : '';
    avatar.emoteT = p.emoteT;
  }
}
