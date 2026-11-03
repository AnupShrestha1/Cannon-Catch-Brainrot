// The game loop. A run goes charge → launch → ascent → apex → fall → parachute → landing → reveal,
// then home to the base, where catches earn coins on pads and the shop sells upgrades.
// The flight is scripted rather than simulated, so the apex hits launchHeight() exactly.
import * as THREE from 'three';
import { Sfx } from './audio';
import { Base } from './base';
import { animateShared, makeCharacter, makeSilhouette, type CharacterRig } from './characters';
import {
  CHARGE,
  CHUTE,
  CRASH_DROP,
  ECONOMY,
  FLIGHT,
  GIFTS,
  LEVELS,
  MAX_ZONE,
  RARE,
  RARITIES,
  REBIRTH,
  TRACKS,
  TUTORIAL,
  UPGRADES,
  ZONES,
  launchHeight,
  levelToReach,
  pickName,
  rollRarity,
  zoneIndexAt,
} from './config';
import {
  buyUpgrade,
  carryLimit,
  expansionCost,
  formatCoins,
  incomeMultiplier,
  incomePerSecond,
  levelCost,
  padIncome,
  placeCatches,
  sellValue,
  trackBoost,
  upgradeCost,
} from './economy';
import { Particles, Streaks } from './fx';
import { Hud, type ShopItem, type ShopRow } from './hud';
import { Input } from './input';
import { BOOK_ZONES, DAILY, bookEntries, dailyCoins, dailyStatus, dayKey, offlineEarnings, zoneComplete } from './meta';
import { platform } from './platform';
import { clearSave, loadSave, writeSave, type PadSlot, type Save } from './store';
import {
  buildEnv,
  makeBird,
  makeLabel,
  makePlane,
  makeStormCloud,
  makePlayer,
  skyColorAt,
  type BirdRig,
  type Env,
  type Label,
  type PlayerRig,
} from './world';

type State = 'aim' | 'charging' | 'ascent' | 'fall' | 'landed' | 'reveal' | 'home' | 'boarding';
type Chute = 'closed' | 'open' | 'tangled';

interface Pickup {
  rarity: number;
  name: string;
  rig: CharacterRig;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  state: 'floating' | 'held' | 'tumbling' | 'lost' | 'gone';
  /** Seconds until a tumbling character can be grabbed again. */
  cooldown: number;
  /** Already passed by while the stack was full, so the FULL toast doesn't repeat. */
  passed: boolean;
  seed: number;
}

type HazardKind = 'bird' | 'plane' | 'storm';

const HAZARDS: Record<HazardKind, { radius: number; speed: [number, number]; toast: string }> = {
  bird: { radius: FLIGHT.hazardRadius, speed: [4, 7], toast: 'BONK!' },
  plane: { radius: 1.4, speed: [9, 13], toast: 'WHAM!' },
  storm: { radius: 1.9, speed: [0.6, 1.2], toast: 'ZAP!' },
};

interface Bird {
  kind: HazardKind;
  rig: BirdRig;
  x: number;
  y: number;
  baseY: number;
  dir: number;
  speed: number;
  seed: number;
  hit: boolean;
  vy: number;
}

const MUZZLE_Y = 3.2;
/** Height of the player's collision centre above their feet. */
const BODY_MID = 0.95;
const STACK_BASE = 2.15;
const STACK_STEP = 0.6;
/** Depth the player drifts to while landing, clear of the cannon at z = 0. */
const LANDING_Z = 3.5;
/** Where the player waits at the base, and where they climb into the cannon. */
const HOME_SPOT = new THREE.Vector3(-3.6, 0, 6.4);
const CANNON_FOOT = new THREE.Vector3(0, 0, 2.3);
const WALK_SPEED = 9;
/** Walking within this distance of a pad's centre collects its coins. */
const COLLECT_RADIUS = 1.7;
/** Characters float larger than life in the sky so they read from the chase camera; held ones shrink. */
const SKY_SCALE = 1.35;
const HELD_SCALE = 0.55;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Frame-rate independent smoothing factor. */
const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** Distance from (cx, cy) to the segment a→b, so fast frames can't skip past a pickup. */
function segmentDistance(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp(((cx - ax) * dx + (cy - ay) * dy) / len2, 0, 1) : 0;
  return Math.hypot(ax + dx * t - cx, ay + dy * t - cy);
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.1, 900);
  private env: Env;
  private base: Base;
  private player: PlayerRig;
  private fx: Particles;
  private streaks: Streaks;
  private input: Input;
  private hud = new Hud();
  private sfx = new Sfx();
  private save: Save = loadSave();
  private recordLine = new THREE.Group();
  private recordLabel: Label;
  private goal = new THREE.Group();
  private goalLabel: Label;
  private sky = new THREE.Color(0x8fd3ff);
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private player3 = new THREE.Vector3();
  private wantPos = new THREE.Vector3();
  private wantLook = new THREE.Vector3();
  private camOff = new THREE.Vector3(0, -0.8, 8.5);
  private camLook = new THREE.Vector3(0, 3.8, -1.5);

  private state: State = 'aim';
  private time = 0;
  private lastFrame = 0;

  private px = 0;
  private py = MUZZLE_Y;
  /** Depth only changes while landing and at the base; the run itself is in z = 0. */
  private pz = 0;
  private vx = 0;
  private vy = 0;
  private prevX = 0;
  private prevY = MUZZLE_Y;
  private targetX = 0;
  /** Steerable half-width for this run; narrower on portrait screens so the camera can stay close. */
  private lane: number = FLIGHT.lane;
  private facing = 0;
  private walking = false;
  private walkTarget = new THREE.Vector3();

  private chargeT = 0;
  private charge = 0;
  private gUp = 0;
  private gFall = 0;
  private vTerminal = 0;
  private apex = 0;
  private chute: Chute = 'closed';
  private chuteScale = 0;
  private landing = '';
  private recordPassed = false;
  private knocked = 0;
  private dropped = 0;

  private stack: Pickup[] = [];
  private pickups: Pickup[] = [];
  private birds: Bird[] = [];
  /** Rigs of the characters carried at the base, matching save.carrying. */
  private carried: CharacterRig[] = [];
  private carrySel = 0;
  /** What to do when the current walk arrives. */
  private arrive: (() => void) | null = null;

  private slowmo = 0;
  private shake = 0;
  private stun = 0;
  private invuln = 0;
  private fullCooldown = 0;
  private landedT = 0;
  private revealT = 0;
  private bounceVy = 0;
  private bounces = 0;
  private spin = 0;
  private sessionT = 0;
  private giftIndex = 0;
  private saveTimer = 3;
  private shopTimer = 0;
  private chantTimer = 20;
  /** Rebirth needs a second tap in the shop. */
  private rebirthArmed = false;

  /** Dev-only: stops the frame loop from advancing the game, so debugStep() is the only clock. */
  debugPaused = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = this.sky;
    this.scene.fog = new THREE.Fog(0x8fd3ff, 70, 320);
    this.env = buildEnv(this.scene);
    this.base = new Base(this.scene);
    this.player = makePlayer();
    this.scene.add(this.player.group);
    this.fx = new Particles(this.scene);
    this.streaks = new Streaks(this.scene);
    this.input = new Input(canvas);
    this.input.onGesture = () => this.sfx.unlock();
    this.applyMute();

    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(FLIGHT.lane * 2 + 4, 0.08, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }),
    );
    this.recordLabel = makeLabel();
    this.recordLabel.sprite.position.set(FLIGHT.lane - 1, 0.7, 0);
    this.recordLine.add(bar, this.recordLabel.sprite);
    this.recordLine.visible = false;
    this.scene.add(this.recordLine);

    // The goal in the sky: what the next locked zone holds, and the cannon level that reaches it.
    const silhouette = makeSilhouette(3, 'Pizzarotto Pellicano');
    silhouette.scale.setScalar(1.8);
    this.goalLabel = makeLabel();
    this.goalLabel.sprite.position.y = 4.4;
    this.goalLabel.sprite.scale.multiplyScalar(1.5);
    this.goal.add(silhouette, this.goalLabel.sprite);
    this.goal.visible = false;
    this.scene.add(this.goal);

    this.paintCannon();
    platform.onSettingsChange(() => this.applyMute());
    this.bindUi();
    window.addEventListener('resize', () => this.resize());
    this.resize();

    this.base.sync(this.save);
    this.buildCarried();
    if (this.save.pads.some(Boolean) || this.save.carrying.length) {
      // Returning players start at the base, where their pads have been waiting.
      this.px = HOME_SPOT.x;
      this.py = this.prevY = 0;
      this.pz = HOME_SPOT.z;
      this.state = 'home';
    } else {
      this.boardCannon();
    }
    this.welcome();
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  /** Dev-only: advance the game by fixed 60 fps steps and render once, for testing in throttled tabs. */
  debugStep(seconds: number): { state: State; y: number; vy: number; stack: number; coins: number } {
    for (let t = 0; t < seconds; t += 1 / 60) this.update(1 / 60);
    this.renderer.render(this.scene, this.camera);
    return {
      state: this.state,
      y: Math.round(this.py * 10) / 10,
      vy: Math.round(this.vy * 10) / 10,
      stack: this.stack.length,
      coins: Math.floor(this.save.coins),
    };
  }

  private frame = (now: number) => {
    const dt = this.lastFrame ? Math.min(0.05, (now - this.lastFrame) / 1000) : 1 / 60;
    this.lastFrame = now;
    if (!this.debugPaused) this.update(dt);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.frame);
  };

  private bindUi(): void {
    const hud = this.hud;
    const onClick = (el: HTMLElement, fn: () => void) =>
      el.addEventListener('click', () => {
        fn();
        el.blur();
      });
    hud.chuteBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.sfx.unlock();
      this.input.requestChute();
    });
    onClick(hud.againBtn, () => {
      if (this.state === 'reveal') this.goHome();
    });
    onClick(hud.soundBtn, () => this.toggleMute());
    onClick(hud.tuneBtn, () => hud.tunePanel.classList.toggle('hidden'));
    onClick(hud.upgradesBtn, () => {
      this.rebirthArmed = false;
      hud.openShop();
      this.refreshShop();
    });
    onClick(hud.launchBtn, () => {
      if (this.state === 'home') this.startBoarding();
    });
    onClick(hud.giftBtn, () => this.claimGift());
    onClick(hud.bookBtn, () => this.openBook());
    hud.onBuy = (item) => this.buy(item);
    hud.onCarrySelect = (i) => this.selectCarried(i);
    hud.onCarrySell = (i) => this.sellCarried(i);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyT') hud.tunePanel.classList.toggle('hidden');
      if (e.code === 'KeyM') this.toggleMute();
      if (e.code === 'Escape') hud.closeShop();
    });
    hud.bindTuning(this.save, {
      changed: () => {
        writeSave(this.save);
        this.refreshShop();
      },
      addCoins: () => {
        this.save.coins += 1000;
        writeSave(this.save);
      },
      resetAll: () => {
        clearSave();
        location.reload();
      },
    });
    hud.setSound(!this.save.muted);
  }

  /** The game's own mute, overridden by CrazyGames' mute setting. */
  private applyMute(): void {
    this.sfx.setMuted(this.save.muted || platform.muted);
  }

  private toggleMute(): void {
    this.save.muted = !this.save.muted;
    this.applyMute();
    this.hud.setSound(!this.save.muted);
    writeSave(this.save);
  }

  private resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  private hasHint(id: string): boolean {
    return this.save.hints.includes(id);
  }

  private completeHint(id: string): void {
    if (!this.hasHint(id)) this.save.hints.push(id);
  }

  // ---------------------------------------------------------------- update

  private update(realDt: number): void {
    this.slowmo = Math.max(0, this.slowmo - realDt);
    const dt = realDt * (this.slowmo > 0 ? 0.3 : 1);
    this.time += dt;
    this.shake *= Math.exp(-realDt * 6);
    this.stun = Math.max(0, this.stun - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.fullCooldown = Math.max(0, this.fullCooldown - realDt);
    // The shop and other modals swallow presses while they're open.
    const blocked = this.hud.shopOpen || this.hud.modalOpen;
    const pressed = this.input.consumePressed() && !blocked;
    const space = this.input.consumeSpace() && !blocked;
    const tap = this.input.consumeTap();
    const chuteRequested = this.input.consumeChute();

    switch (this.state) {
      case 'aim':
        if (pressed) this.startCharge();
        break;
      case 'charging':
        this.updateCharge(dt);
        if (!this.input.actionDown) this.launch();
        break;
      case 'ascent':
      case 'fall':
        this.updateFlight(dt, chuteRequested);
        break;
      case 'landed':
        this.updateLanded(dt);
        break;
      case 'reveal':
        this.revealT += realDt;
        if (space && this.revealT > 0.6) this.goHome();
        break;
      case 'home':
        this.updateHome(dt, blocked ? null : tap, space);
        break;
      case 'boarding':
        this.updateWalk(dt);
        break;
    }

    this.updateEconomy(realDt);
    this.updatePickups(dt);
    this.updateBirds(dt);
    this.base.update(this.save, this.time, realDt);
    this.fx.update(dt);
    this.updateVisuals(realDt, dt);
    // The reveal screen and the shop are breaks in play.
    platform.setPlaying(this.state !== 'reveal' && !this.hud.shopOpen && !this.hud.modalOpen);
  }

  // ---------------------------------------------------------------- charge and launch

  private startCharge(): void {
    this.state = 'charging';
    this.chargeT = 0;
    this.charge = 0;
    this.hud.prompt('');
  }

  private updateCharge(dt: number): void {
    this.chargeT += dt;
    const phase = (this.chargeT / CHARGE.period) % 1;
    this.charge = phase < 0.5 ? phase * 2 : 2 - phase * 2;
    this.hud.showCharge(this.charge);
  }

  private launch(): void {
    const m = this.charge;
    const perfect = m >= CHARGE.perfect[0] && m <= CHARGE.perfect[1];
    const green = m >= CHARGE.green[0] && m <= CHARGE.green[1];
    const bonus = perfect ? CHARGE.perfectBonus : green ? CHARGE.greenBonus : 0;

    this.save.flightNo += 1;
    writeSave(this.save);

    const apex = launchHeight(this.save.cannon) * (1 + bonus);
    const tUp = FLIGHT.ascentTime(apex);
    const v0 = (2 * (apex - MUZZLE_Y)) / tUp;
    this.gUp = v0 / tUp;
    this.vy = v0;
    this.vTerminal = Math.max(FLIGHT.minTerminal, apex / (tUp * 0.9));
    this.gFall = this.vTerminal / FLIGHT.terminalReach;
    this.apex = 0;
    this.chute = 'closed';
    this.landing = '';
    this.recordPassed = false;
    this.knocked = 0;
    this.dropped = 0;
    this.vx = 0;
    this.targetX = this.px;
    this.input.consumeTouchDx();
    this.lane = FLIGHT.lane * clamp(this.camera.aspect, 0.55, 1);
    this.recordLabel.sprite.position.x = this.lane - 1;
    this.spawnRun(apex, v0, tUp);
    this.state = 'ascent';

    this.hud.showCharge(null);
    this.hud.setFlight(this.save.flightNo);
    this.recordLine.visible = this.save.best > 1;
    this.recordLine.position.y = this.save.best;
    this.recordLabel.set(`BEST ${Math.round(this.save.best)} m`);

    const muzzle = this.tmp.set(0, MUZZLE_Y + 1.2, 0);
    this.fx.burst(muzzle, { count: 26, color: 0xd9dde3, speed: 7, life: 1.1, size: 1.6, grow: 2.5, up: 2, drag: 2.5 });
    this.fx.burst(muzzle, { count: 10, color: 0xffb347, speed: 9, life: 0.35, size: 1.1 });
    if (bonus > 0) {
      this.fx.burst(muzzle, {
        count: perfect ? 40 : 18,
        color: perfect ? 0xffe066 : 0x9dffb0,
        speed: 14,
        life: 0.8,
        size: 0.5,
        up: 6,
      });
    }
    this.shake = 0.35 + bonus * 1.6;
    this.sfx.boom(0.6 + bonus);
    if (perfect) {
      this.hud.toast('PERFECT LAUNCH!', 'gold');
      this.sfx.sparkle();
    } else if (green) {
      this.hud.toast('GREAT LAUNCH!', 'good');
    }
  }

  /** Places characters along the predicted ascent, so every row passes by at a readable pace. */
  private spawnRun(apex: number, v0: number, tUp: number): void {
    const flight = this.save.flightNo;
    const width = FLIGHT.spawnHalfWidth * (this.lane / FLIGHT.lane);
    // A Storm Layer flight blasts through Low Sky too fast to catch anything, so nothing spawns there.
    const apexZone = Math.min(zoneIndexAt(apex), MAX_ZONE);
    const floor = apexZone >= 2 ? ZONES[apexZone - 1].from : 14;
    if (flight === 1) {
      // Tutorial: a single Common straight up the flight path.
      this.addPickup(0, 0, MUZZLE_Y + (apex - MUZZLE_Y) * 0.55);
    } else {
      let lastY = -Infinity;
      for (let t = 0.6; t < tUp - 0.1; t += FLIGHT.pickupStep * rand(0.8, 1.2)) {
        const y = MUZZLE_Y + v0 * t - 0.5 * this.gUp * t * t;
        if (y < floor || y - lastY < FLIGHT.pickupMinGap) continue;
        lastY = y;
        this.addPickup(rollRarity(y), rand(-width, width), y);
      }
      if (flight === TUTORIAL.guaranteedRareFlight) this.addPickup(RARE, rand(-width, width) / 2, apex * 0.8 + 2);
    }

    const mode = this.save.hazards;
    if (mode === 'on' || (mode === 'auto' && flight >= TUTORIAL.hazardFromFlight)) {
      // Hazards get denser with height.
      const lowest = Math.max(24, floor);
      for (let y = lowest; y < apex - 3; y += lerp(24, 12, Math.min(1, y / 1500)) * rand(0.8, 1.25)) this.addBird(y);
    }
  }

  private addPickup(rarity: number, x: number, y: number): void {
    const name = pickName(rarity);
    const rig = makeCharacter(rarity, name);
    rig.group.position.set(x, y, 0);
    rig.group.scale.setScalar(SKY_SCALE);
    this.scene.add(rig.group);
    this.pickups.push({
      rarity,
      name,
      rig,
      x,
      y,
      z: 0,
      vx: 0,
      vy: 0,
      state: 'floating',
      cooldown: 0,
      passed: false,
      seed: Math.random() * 10,
    });
  }

  /** Birds below the Storm Layer; planes and thunderclouds inside it. */
  private addBird(y: number): void {
    const zone = zoneIndexAt(y);
    const kind: HazardKind = zone < 2 ? 'bird' : Math.random() < 0.5 ? 'plane' : 'storm';
    const rig = kind === 'bird' ? makeBird(ZONES[zone].hazard) : kind === 'plane' ? makePlane() : makeStormCloud();
    this.scene.add(rig.group);
    this.birds.push({
      kind,
      rig,
      x: rand(-this.lane, this.lane),
      y,
      baseY: y,
      dir: Math.random() < 0.5 ? -1 : 1,
      speed: rand(...HAZARDS[kind].speed),
      seed: Math.random() * 10,
      hit: false,
      vy: 0,
    });
  }

  // ---------------------------------------------------------------- flight

  private updateFlight(dt: number, chuteRequested: boolean): void {
    this.prevX = this.px;
    this.prevY = this.py;

    if (this.state === 'ascent') {
      this.vy -= this.gUp * dt;
      if (this.vy <= 0) {
        this.vy = 0;
        this.reachApex();
      }
    } else if (this.chute === 'closed') {
      this.vy = Math.max(this.vy - this.gFall * dt, -this.vTerminal);
    } else {
      const target = this.chute === 'open' ? -FLIGHT.chuteSpeed : -this.vTerminal * 0.55;
      this.vy += (target - this.vy) * damp(FLIGHT.chuteDecel, dt);
    }
    this.py += this.vy * dt;
    this.steer(dt);

    if (this.state === 'fall' && chuteRequested && this.chute === 'closed') this.openChute();
    this.collide();

    if (this.state === 'ascent' && !this.recordPassed && this.save.best > 5 && this.py > this.save.best) {
      this.recordPassed = true;
      this.hud.toast('NEW RECORD!', 'gold');
      this.sfx.ding();
    }
    if (this.state === 'fall') this.updateGroundBar();
    if (this.py <= 0) {
      this.py = 0;
      this.land();
    }
  }

  private steer(dt: number): void {
    const lane = this.lane;
    const maxSpeed =
      FLIGHT.steerSpeed * trackBoost(this.save, 'steering') * (this.chute === 'closed' ? 1 : FLIGHT.chuteSteer);
    if (this.stun > 0) {
      this.vx *= Math.max(0, 1 - 6 * dt);
    } else {
      switch (this.input.mode) {
        case 'mouse':
          this.targetX = (this.input.mouseX * 2 - 1) * lane * 1.15;
          break;
        case 'touch':
          this.targetX += this.input.consumeTouchDx() * ((lane * 2.4) / window.innerWidth);
          break;
        case 'keys':
          this.targetX = this.px + this.input.axis * lane;
          break;
      }
      this.targetX = clamp(this.targetX, -lane, lane);
      const want = clamp((this.targetX - this.px) * 6, -maxSpeed, maxSpeed);
      this.vx += (want - this.vx) * damp(14, dt);
    }
    this.px = clamp(this.px + this.vx * dt, -lane, lane);
  }

  private collide(): void {
    const ax = this.prevX;
    const ay = this.prevY + BODY_MID;
    const bx = this.px;
    const by = this.py + BODY_MID;

    // Hands are on the straps once the chute is open.
    if (this.chute === 'closed') {
      const reach = FLIGHT.playerRadius + FLIGHT.pickupRadius * trackBoost(this.save, 'magnet');
      for (const p of this.pickups) {
        if ((p.state !== 'floating' && p.state !== 'tumbling') || p.cooldown > 0) continue;
        if (segmentDistance(ax, ay, bx, by, p.x, p.y + 0.6) < reach) {
          this.tryGrab(p);
        }
      }
    }

    if (this.invuln > 0) return;
    for (const b of this.birds) {
      if (b.hit) continue;
      if (segmentDistance(ax, ay, bx, by, b.x, b.y) < FLIGHT.playerRadius + HAZARDS[b.kind].radius) {
        this.hitBird(b);
        return;
      }
    }
  }

  private lowestIndex(): number {
    let low = 0;
    for (let i = 1; i < this.stack.length; i++) if (this.stack[i].rarity < this.stack[low].rarity) low = i;
    return low;
  }

  /** A full stack swaps its lowest-rarity character for a rarer one, and passes equal or lower ones by. */
  private tryGrab(p: Pickup): void {
    if (this.stack.length >= carryLimit(this.save)) {
      const low = this.lowestIndex();
      if (p.rarity <= this.stack[low].rarity) {
        if (!p.passed) {
          p.passed = true;
          if (this.fullCooldown <= 0) {
            this.fullCooldown = 0.8;
            this.hud.toast('FULL', 'small');
            this.sfx.full();
          }
        }
        return;
      }
      const [out] = this.stack.splice(low, 1);
      this.release(out, 1, rand(-1, 1) * 4, 4);
      this.hud.toast(`SWAP → ${RARITIES[p.rarity].name}`, 'small');
      this.sfx.swap();
    }

    p.state = 'held';
    p.passed = false;
    p.rig.cloud.visible = false;
    p.rig.group.scale.setScalar(HELD_SCALE);
    p.rig.figure.rotation.set(0, 0, 0);
    this.stack.push(p);
    this.fx.burst(this.tmp.set(p.x, p.y + 0.6, 0), {
      count: 12 + p.rarity * 5,
      color: RARITIES[p.rarity].color,
      speed: 7,
      life: 0.6,
      size: 0.6,
    });
    this.sfx.pop(p.rarity);
    this.sfx.chant(p.name);
    if (this.addToBook(p.name)) this.hud.toast('NEW! Added to your book', 'small');
    if (p.rarity >= 4) platform.happytime();
    if (p.rarity >= RARE) {
      this.slowmo = Math.max(this.slowmo, 0.45);
      this.hud.toast(`${RARITIES[p.rarity].name.toUpperCase()}!`, '', RARITIES[p.rarity].css);
    }
  }

  /** Throws a character off the stack; it tumbles down and can be grabbed again after `cooldown`. */
  private release(p: Pickup, cooldown: number, vx: number, vy: number): void {
    p.state = 'tumbling';
    p.cooldown = cooldown;
    p.x = this.px;
    p.y = this.py + STACK_BASE;
    p.z = this.pz;
    p.vx = vx;
    p.vy = vy;
    p.rig.group.scale.setScalar(SKY_SCALE);
  }

  private hitBird(b: Bird): void {
    b.hit = true;
    b.vy = 14;
    this.invuln = 0.9;
    this.stun = 0.3;
    this.shake = Math.max(this.shake, 0.4);
    const rising = this.state === 'ascent';
    this.vy *= rising ? FLIGHT.hitSlow : 0.7;
    this.fx.burst(this.tmp.set(b.x, b.y, 0), { count: 14, color: 0xffffff, speed: 6, life: 0.7, size: 0.45, gravity: 4 });
    this.sfx.hit();
    if (this.stack.length) {
      const [out] = this.stack.splice(this.lowestIndex(), 1);
      this.release(out, 0.8, (this.px >= b.x ? 1 : -1) * 5, 5);
      this.knocked++;
      const word = HAZARDS[b.kind].toast;
      this.hud.toast(rising ? `${word} Catch it on the way down` : word, 'bad small');
    } else {
      this.hud.toast(HAZARDS[b.kind].toast, 'bad small');
    }
  }

  private reachApex(): void {
    this.apex = this.py;
    this.state = 'fall';
    const goal = this.showGoal();
    this.slowmo = Math.max(this.slowmo, goal ? 1.1 : 0.55);
    this.hud.toast(`${Math.round(this.apex)} m`, 'big');
    if (this.apex > this.save.best) {
      this.save.best = this.apex;
      writeSave(this.save);
    }
  }

  /** From flight 4, the apex shows a silhouette from the next locked zone and the cannon level it needs. */
  private showGoal(): boolean {
    if (this.save.flightNo < TUTORIAL.goalFromFlight) return false;
    const next = zoneIndexAt(this.apex) + 1;
    if (next > MAX_ZONE) return false;
    const zone = ZONES[next];
    const level = levelToReach(zone.from);
    if (this.save.cannon >= level) return false;
    this.goal.position.set(0, this.apex + 13, -2);
    this.goal.visible = true;
    this.goalLabel.set(`${zone.name} · Cannon Lv ${level}`, '#ffe58a');
    return true;
  }

  /** The parachute upgrade lengthens the safe window by letting it run closer to the ground. */
  private chuteLate(): number {
    const late = this.save.flightNo <= TUTORIAL.wideChuteFlights ? CHUTE.tutorialLate : CHUTE.late;
    return late / trackBoost(this.save, 'chute');
  }

  private secondsToImpact(): number {
    return this.py / Math.max(1, -this.vy);
  }

  private updateGroundBar(): void {
    if (this.chute !== 'closed') return;
    const tau = this.secondsToImpact();
    const late = this.chuteLate();
    this.hud.showGround(
      clamp(tau / CHUTE.barSeconds, 0, 1),
      late / CHUTE.barSeconds,
      (late + CHUTE.perfectSpan) / CHUTE.barSeconds,
    );
    const urgent = tau < 3.2;
    this.hud.showChute(true, urgent);
    if (urgent && this.save.flightNo <= TUTORIAL.wideChuteFlights) {
      this.hud.prompt(this.input.isTouch ? 'Tap PARACHUTE!' : 'Press Space or click to open your parachute!', true);
    }
  }

  private openChute(): void {
    const tau = this.secondsToImpact();
    const late = this.chuteLate();
    this.sfx.chute();
    this.hud.showChute(false);
    this.hud.showGround(null);
    this.hud.prompt('');
    if (tau < late) {
      this.chute = 'tangled';
      this.hud.toast('TOO LATE!', 'bad');
      return;
    }
    this.chute = 'open';
    const perfect = tau < late + CHUTE.perfectSpan;
    this.landing = perfect ? 'Perfect landing' : 'Safe landing';
    if (perfect) this.hud.toast('PERFECT TIMING!', 'gold');
  }

  // ---------------------------------------------------------------- landing

  private land(): void {
    this.vx = 0;
    this.vy = 0;
    this.hud.showChute(false);
    this.hud.showGround(null);
    this.hud.prompt('');
    const at = this.tmp.set(this.px, 0.3, this.pz);

    if (this.chute === 'open') {
      this.state = 'landed';
      this.landedT = 1;
      this.fx.burst(at, { count: 12, color: 0xd8c3a0, speed: 4, life: 0.7, size: 1, grow: 1.5, flatten: 0.3, up: 0.5 });
      this.sfx.thud(0.35);
      this.hud.toast(this.landing.toUpperCase(), this.landing.startsWith('Perfect') ? 'gold' : 'good');
      return;
    }

    const tangled = this.chute === 'tangled';
    this.landing = tangled ? 'Crash landing' : 'No parachute';
    const tutorial = this.save.flightNo <= TUTORIAL.noDropFlights;
    const share = tangled ? CRASH_DROP.tangled : CRASH_DROP.noChute;
    const count = tutorial ? 0 : Math.floor(this.stack.length * share);
    if (count > 0) {
      // Never drop the rarest one.
      let top = 0;
      this.stack.forEach((p, i) => {
        if (p.rarity > this.stack[top].rarity) top = i;
      });
      const keep = this.stack[top];
      const candidates = this.stack.filter((p) => p !== keep).sort(() => Math.random() - 0.5);
      for (const p of candidates.slice(0, count)) {
        this.stack.splice(this.stack.indexOf(p), 1);
        this.release(p, 99, rand(-8, 8), rand(8, 12));
        p.state = 'lost';
      }
      this.dropped = count;
    }

    this.state = 'landed';
    this.landedT = 1.9;
    this.bounceVy = 9;
    this.bounces = 2;
    this.spin = rand(9, 13) * (Math.random() < 0.5 ? -1 : 1);
    this.fx.burst(at, { count: 30, color: 0xd8c3a0, speed: 9, life: 1.1, size: 1.4, grow: 2, flatten: 0.35, up: 1.5 });
    this.shake = 1;
    this.sfx.thud(1);
    this.hud.toast(tangled ? 'CRASH!' : 'SPLAT!', 'bad big');
    if (count > 0) this.hud.toast(`Dropped ${count}`, 'bad small');
    else if (tutorial && this.stack.length) this.hud.toast('Tutorial: nothing dropped', 'small');
  }

  /** Comic ragdoll: two shrinking bounces, then the body lies flat until the reveal. */
  private updateLanded(dt: number): void {
    if (this.bounces > 0) {
      this.bounceVy -= 28 * dt;
      this.py += this.bounceVy * dt;
      if (this.py <= 0) {
        this.py = 0;
        this.bounces--;
        this.bounceVy = this.bounces > 0 ? Math.abs(this.bounceVy) * 0.45 : 0;
        this.fx.burst(this.tmp.set(this.px, 0.3, this.pz), {
          count: 8,
          color: 0xd8c3a0,
          speed: 4,
          life: 0.6,
          size: 0.9,
          grow: 1.5,
          flatten: 0.3,
        });
        this.sfx.thud(0.4);
      }
    }
    this.landedT -= dt;
    if (this.landedT <= 0) this.showReveal();
  }

  private showReveal(): void {
    this.state = 'reveal';
    this.revealT = 0;
    const cards = this.stack.map((p) => ({ name: p.name, rarity: p.rarity }));
    const parts = [`Apex ${Math.round(this.apex)} m`, this.landing];
    if (this.knocked) parts.push(`${this.knocked} knocked off`);
    if (this.dropped) parts.push(`${this.dropped} dropped`);
    const button = cards.length === 0 ? 'Back to base' : cards.length === 1 ? 'Take it home' : 'Take them home';
    this.hud.showReveal(cards, parts.join(' · '), button);
    cards.forEach((c, i) => this.sfx.pop(c.rarity, 0.25 + i * 0.32));
  }

  private clearRun(): void {
    for (const p of this.pickups) this.scene.remove(p.rig.group);
    for (const b of this.birds) this.scene.remove(b.rig.group);
    this.pickups = [];
    this.birds = [];
    this.stack = [];
    this.goal.visible = false;
    this.recordLine.visible = false;
  }

  // ---------------------------------------------------------------- base

  /** Walk home carrying the catch. At the base, each one is placed on a pad or sold, the player's choice. */
  private goHome(): void {
    const catches = this.stack.map((p) => ({ name: p.name, rarity: p.rarity }));
    this.clearRun();
    this.hud.hideReveal();
    this.save.carrying.push(...catches);
    this.buildCarried();
    writeSave(this.save);
    this.state = 'home';
    this.walkTo(HOME_SPOT);
  }

  /** Rebuilds the characters on the player's head from the save, selecting the rarest. */
  private buildCarried(): void {
    for (const rig of this.carried) this.scene.remove(rig.group);
    this.carried = this.save.carrying.map((c) => {
      const rig = makeCharacter(c.rarity, c.name);
      rig.cloud.visible = false;
      rig.group.scale.setScalar(HELD_SCALE);
      this.scene.add(rig.group);
      return rig;
    });
    this.carrySel = this.rarestCarried();
    this.refreshCarry();
  }

  private rarestCarried(): number {
    let best = 0;
    this.save.carrying.forEach((c, i) => {
      if (c.rarity > this.save.carrying[best].rarity) best = i;
    });
    return best;
  }

  private refreshCarry(): void {
    this.hud.renderCarry(
      this.save.carrying.map((c) => ({ ...c, sell: sellValue(this.save, c) })),
      this.carrySel,
    );
  }

  private selectCarried(i: number): void {
    if (i < 0 || i >= this.save.carrying.length) return;
    this.carrySel = i;
    this.refreshCarry();
    this.sfx.pop(this.save.carrying[i].rarity);
  }

  private removeCarried(i: number): void {
    this.save.carrying.splice(i, 1);
    this.scene.remove(this.carried[i].group);
    this.carried.splice(i, 1);
    this.carrySel = this.save.carrying.length ? this.rarestCarried() : 0;
    this.refreshCarry();
  }

  /** Puts the selected carried character on an empty pad. */
  private placeCarried(pad: number): void {
    const s = this.save;
    const c = s.carrying[this.carrySel];
    if (!c || s.pads[pad]) return;
    s.pads[pad] = { name: c.name, rarity: c.rarity, cash: 0, level: 1 };
    this.removeCarried(this.carrySel);
    this.base.sync(s);
    this.fx.burst(Base.padPosition(pad, this.tmp).setY(1), {
      count: 16,
      color: RARITIES[c.rarity].color,
      speed: 6,
      life: 0.7,
      size: 0.6,
      up: 3,
    });
    this.sfx.pop(c.rarity);
    this.sfx.chant(c.name);
    this.completeHint('place');
    writeSave(s);
  }

  private sellCarried(i: number): void {
    const c = this.save.carrying[i];
    if (!c) return;
    const coins = sellValue(this.save, c);
    this.save.coins += coins;
    this.removeCarried(i);
    this.floatAt(this.tmp.set(this.px, this.py + 2.6, this.pz), `Sold ${c.name} +${formatCoins(coins)}`, 'small');
    this.sfx.coin();
    writeSave(this.save);
  }

  /** Sells the character on a pad and puts the selected carried one in its place. */
  private swapCarried(pad: number): void {
    const s = this.save;
    const old = s.pads[pad];
    if (!old || !s.carrying.length) return;
    const coins = sellValue(s, old) + Math.floor(old.cash);
    s.coins += coins;
    s.pads[pad] = null;
    this.floatAt(Base.padPosition(pad, this.tmp).setY(2.4), `Sold ${old.name} +${formatCoins(coins)}`, 'small');
    this.placeCarried(pad);
  }

  private walkTo(target: THREE.Vector3, then: (() => void) | null = null): void {
    this.walkTarget.copy(target);
    this.walking = true;
    this.arrive = then;
  }

  private updateWalk(dt: number): void {
    if (!this.walking) return;
    const dx = this.walkTarget.x - this.px;
    const dz = this.walkTarget.z - this.pz;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) {
      this.walking = false;
      if (this.state === 'boarding') this.boardCannon();
      const then = this.arrive;
      this.arrive = null;
      then?.();
      return;
    }
    const step = Math.min(dist, WALK_SPEED * dt);
    this.px += (dx / dist) * step;
    this.pz += (dz / dist) * step;
    this.facing = Math.atan2(-dx, -dz);
  }

  private updateHome(dt: number, tap: { x: number; y: number } | null, space: boolean): void {
    this.updateWalk(dt);
    this.save.pads.forEach((slot, i) => {
      if (!slot || slot.cash < 1) return;
      const pad = Base.padPosition(i, this.tmp);
      if (Math.hypot(pad.x - this.px, pad.z - this.pz) < COLLECT_RADIUS) this.collect(i);
    });
    if (space) {
      this.startBoarding();
      return;
    }
    if (tap) this.tapAt(tap.x, tap.y);
    this.updateHomePrompt();

    // Now and then a character at the base chants its name.
    this.chantTimer -= dt;
    if (this.chantTimer <= 0) {
      this.chantTimer = rand(18, 30);
      const placed = this.save.pads.filter((slot) => slot !== null);
      if (placed.length) this.sfx.chant(placed[Math.floor(Math.random() * placed.length)].name);
    }
  }

  /** A tap at the base walks to a pad, boards the cannon, or walks to that spot on the ground. */
  private tapAt(x: number, y: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const pad = this.base.pick(this.raycaster);
    if (pad !== null) {
      const at = Base.padPosition(pad, this.tmp);
      const here = !this.walking && Math.hypot(at.x - this.px, at.z - this.pz) < COLLECT_RADIUS;
      if (this.save.carrying.length && !this.save.pads[pad]) {
        // Carrying something: an empty pad gets it, once the player gets there.
        if (here) this.placeCarried(pad);
        else this.walkTo(at.setY(0), () => this.placeCarried(pad));
      } else if (here) {
        this.openPad(pad);
      } else {
        this.walkTo(at.setY(0));
      }
      return;
    }
    if (this.raycaster.intersectObject(this.env.cannon, true).length) {
      this.startBoarding();
      return;
    }
    const point = this.raycaster.ray.intersectPlane(this.groundPlane, this.tmp);
    if (point) this.walkTo(point.set(clamp(point.x, -45, 12), 0, clamp(point.z, -12, 12)));
  }

  private collect(i: number): void {
    const slot = this.save.pads[i];
    if (!slot) return;
    const amount = Math.floor(slot.cash);
    if (amount < 1) return;
    slot.cash -= amount;
    this.save.coins += amount;
    const at = Base.padPosition(i, this.tmp2).setY(1.4);
    this.fx.burst(at, { count: 10, color: 0xffc21a, speed: 5, life: 0.6, size: 0.5, up: 5, gravity: 10 });
    this.floatAt(at, `+${formatCoins(amount)}`);
    this.sfx.coin();
    this.completeHint('collect');
    writeSave(this.save);
  }

  /** Coin pop-up text at a point in the world. */
  private floatAt(pos: THREE.Vector3, text: string, kind = ''): void {
    const v = this.tmp2.copy(pos).project(this.camera);
    if (v.z > 1) return;
    this.hud.floatText(((v.x + 1) / 2) * window.innerWidth, ((1 - v.y) / 2) * window.innerHeight, text, kind);
  }

  private wantsUpgradeHint(): boolean {
    const cost = upgradeCost(this.save, 'cannon');
    return !this.hasHint('upgrade') && this.save.cannon === 1 && cost !== null && this.save.coins >= cost;
  }

  /** "All 4 starting pads fill, which prompts the first base expansion." */
  private wantsExpandHint(): boolean {
    return !this.hasHint('expand') && this.save.pads.every(Boolean) && expansionCost(this.save) !== null;
  }

  /** After the first upgrade: once a level-up is affordable, show how to buy one. */
  private wantsLevelHint(): boolean {
    const cost = this.cheapestLevel();
    return !this.hasHint('level') && this.hasHint('upgrade') && cost !== null && this.save.coins >= cost;
  }

  private updateHomePrompt(): void {
    const anyCash = this.save.pads.some((slot) => slot !== null && slot.cash >= 1);
    let text = '';
    const carried = this.save.carrying[this.carrySel];
    if (carried) {
      const verb = this.input.isTouch ? 'Tap' : 'Click';
      text = this.save.pads.some((slot) => slot === null)
        ? `${verb} an empty pad to place ${carried.name}, or sell it`
        : `Base full: sell a catch, or swap it onto a pad you stand on`;
    } else if (!this.hasHint('collect') && anyCash) {
      text = this.input.isTouch ? 'Tap a pad to collect its coins' : 'Click a pad to collect its coins';
    } else if (this.wantsUpgradeHint()) {
      text = 'Upgrade your cannon!';
    } else if (this.wantsExpandHint()) {
      text = 'Your pads are full! Expand the base in Upgrades';
    } else if (this.wantsLevelHint()) {
      text = this.input.isTouch
        ? 'Tap the pad you stand on to level up its character'
        : 'Click the pad you stand on to level up its character';
    }
    this.hud.prompt(text, !!text);
  }

  private startBoarding(): void {
    if (this.save.carrying.length) {
      this.hud.toast("Place or sell what you're carrying first", 'bad small');
      return;
    }
    this.state = 'boarding';
    this.hud.prompt('');
    this.walkTo(CANNON_FOOT);
  }

  /** Into the cannon, ready to charge. */
  private boardCannon(): void {
    this.px = this.prevX = 0;
    this.py = this.prevY = MUZZLE_Y;
    this.pz = 0;
    this.vx = this.vy = 0;
    this.targetX = 0;
    this.facing = 0;
    this.walking = false;
    this.chute = 'closed';
    this.chuteScale = 0;
    this.bounces = 0;
    this.player.body.rotation.set(0, 0, 0);
    this.player.body.position.y = 0.9;
    this.state = 'aim';
    this.hud.showCharge(null);
    this.hud.showGround(null);
    this.hud.showChute(false);
    this.hud.setFlight(this.save.flightNo);
    this.fx.burst(this.tmp.set(0, MUZZLE_Y + 1, 0), { count: 10, color: 0xd9dde3, speed: 4, life: 0.6, size: 1, grow: 1.5 });
    const howTo = this.input.isTouch
      ? 'Hold to charge, release to fire'
      : 'Hold Space or the mouse to charge, release to fire';
    this.hud.prompt(this.save.flightNo < 2 ? howTo : 'Fire again!', true);
  }

  // ---------------------------------------------------------------- economy and shop

  private updateEconomy(realDt: number): void {
    for (const slot of this.save.pads) {
      if (!slot) continue;
      const income = padIncome(this.save, slot);
      slot.cash = Math.min(income * ECONOMY.padCapSeconds, slot.cash + income * realDt);
    }
    this.sessionT += realDt;
    const next = GIFTS.at[this.giftIndex];
    this.hud.setGift(next === undefined ? null : next - this.sessionT);
    this.saveTimer -= realDt;
    if (this.saveTimer <= 0) {
      this.saveTimer = 3;
      writeSave(this.save);
    }
    this.shopTimer -= realDt;
    if (this.shopTimer <= 0 && this.hud.shopOpen) {
      this.shopTimer = 0.25;
      this.refreshShop();
    }
  }

  private claimGift(): void {
    const next = GIFTS.at[this.giftIndex];
    if (next === undefined || this.sessionT < next) return;
    this.giftIndex++;
    const reward = Math.max(GIFTS.min, Math.round(incomePerSecond(this.save) * GIFTS.incomeSeconds));
    this.save.coins += reward;
    this.hud.toast(`Gift! +${formatCoins(reward)} coins`, 'gold');
    this.sfx.ding();
    writeSave(this.save);
  }

  private refreshShop(): void {
    this.hud.renderShop(this.shopRows());
  }

  private shopRows(): ShopRow[] {
    const s = this.save;
    const apex = (level: number) => Math.round(launchHeight(level));
    const pct = (track: 'magnet' | 'steering' | 'chute', extra = 0) =>
      `+${Math.round((s[track] + extra) * UPGRADES[track].effect * 100)}%`;
    const limit = carryLimit(s);
    const rows: ShopRow[] = TRACKS.map((track) => {
      const cost = upgradeCost(s, track);
      let level: string;
      let detail: string;
      switch (track) {
        case 'cannon':
          level = `Lv ${s.cannon}`;
          detail =
            cost === null
              ? `Apex ${apex(s.cannon)} m, the top of this build`
              : `Apex ${apex(s.cannon)} m → ${apex(s.cannon + 1)} m`;
          break;
        case 'carry':
          level = `${limit} per run`;
          detail = cost === null ? 'Maxed out' : `Carry ${limit} → ${limit + 1} characters`;
          break;
        default: {
          const what = { magnet: 'Grab radius', steering: 'Turn speed', chute: 'Safe window' }[track];
          level = pct(track);
          detail = cost === null ? 'Maxed out' : `${what} ${pct(track)} → ${pct(track, 1)}`;
        }
      }
      return {
        id: track,
        title: UPGRADES[track].name,
        level,
        detail,
        cost,
        affordable: cost !== null && s.coins >= cost,
      };
    });

    const pads = expansionCost(s);
    rows.push({
      id: 'pads',
      title: 'Base pads',
      level: `${s.pads.length} pads`,
      detail: pads === null ? 'Maxed out' : `${s.pads.length} → ${s.pads.length + ECONOMY.padStep} pads`,
      cost: pads,
      affordable: pads !== null && s.coins >= pads,
    });

    const unlocked = s.cannon >= REBIRTH.cannonLevel;
    const next = incomeMultiplier(s) + REBIRTH.incomeBonus;
    rows.push({
      id: 'rebirth',
      title: 'Rebirth',
      level: s.rebirths ? `×${incomeMultiplier(s)} income` : '',
      detail: unlocked
        ? `Start over with ×${next} income. You keep your rarest character.`
        : `Unlocks at Cannon Lv ${REBIRTH.cannonLevel}. Resets coins, upgrades and pads for ×${next} income.`,
      cost: null,
      affordable: unlocked,
      button: this.rebirthArmed ? 'Sure?' : 'Rebirth',
    });
    return rows;
  }

  private buy(item: ShopItem): void {
    const s = this.save;
    if (item === 'rebirth') {
      // Two taps, so a stray one can't wipe progress.
      if (this.rebirthArmed) this.rebirth();
      else this.rebirthArmed = true;
      this.refreshShop();
      return;
    }
    this.rebirthArmed = false;
    const cost = item === 'pads' ? expansionCost(s) : upgradeCost(s, item);
    if (cost === null || s.coins < cost) return;
    s.coins -= cost;
    if (item === 'pads') {
      for (let i = 0; i < ECONOMY.padStep; i++) s.pads.push(null);
      this.base.sync(s);
      this.completeHint('expand');
      this.hud.toast(`${s.pads.length} pads!`, 'gold');
    } else {
      buyUpgrade(s, item);
      if (item === 'cannon') this.completeHint('upgrade');
      this.hud.toast(item === 'cannon' ? `Cannon Lv ${s.cannon}!` : `${UPGRADES[item].name} up!`, 'gold');
    }
    this.sfx.ding();
    writeSave(s);
    this.refreshShop();
  }

  /** Back to the start with a permanent income bonus, keeping the rarest character and a new cannon colour. */
  private rebirth(): void {
    const s = this.save;
    this.rebirthArmed = false;
    let keep: PadSlot | null = null;
    for (const slot of s.pads) if (slot && (!keep || slot.rarity > keep.rarity)) keep = slot;
    s.rebirths += 1;
    s.coins = 0;
    s.cannon = 1;
    s.carryLevel = s.magnet = s.steering = s.chute = 0;
    s.pads = Array.from({ length: ECONOMY.startPads }, () => null);
    if (keep) s.pads[0] = { ...keep, cash: 0, level: 1 };
    this.base.sync(s);
    this.paintCannon();
    writeSave(s);
    this.hud.closeShop();
    this.hud.toast(`REBIRTH! ×${incomeMultiplier(s)} income`, 'gold big');
    platform.happytime();
    this.sfx.sparkle();
    this.fx.burst(this.tmp.set(-7, 2, 0), { count: 60, color: 0xffd84a, speed: 12, life: 1.2, size: 0.7, up: 6 });
  }

  /** Each rebirth unlocks a cannon colour: the design doc's cosmetic skin, in gray-box form. */
  private paintCannon(): void {
    const colors = [0x3d4450, 0xc0392b, 0x2e86de, 0xe1b12c, 0x8e44ad, 0x27ae60];
    this.env.setBarrelColor(colors[this.save.rebirths % colors.length]);
  }

  // ---------------------------------------------------------------- pad panel

  /** Level up or sell the character on a pad. */
  private openPad(i: number, sellArmed = false): void {
    const s = this.save;
    const slot = s.pads[i];
    if (!slot) {
      this.hud.toast('Empty pad: catch something to fill it', 'small');
      return;
    }
    const level = slot.level ?? 1;
    const cost = levelCost(slot);
    const income = padIncome(s, slot);
    const card = this.hud.characterCard(slot.name, slot.rarity);
    const stats = document.createElement('p');
    stats.textContent = `Level ${level}/${LEVELS.max} · ${formatCoins(income)} coins/s`;
    const next = document.createElement('p');
    next.textContent =
      cost === null
        ? 'Max level'
        : `Next level: ${formatCoins(padIncome(s, { ...slot, level: level + 1 }))} coins/s`;
    const sell = sellValue(s, slot);
    const carried = s.carrying[this.carrySel];
    const swap = carried
      ? [{ label: `Swap in ${carried.name}`, primary: true, action: () => this.swapCarried(i) }]
      : [];
    this.hud.showModal(slot.name, [card, stats, next], [
      ...swap,
      {
        label: cost === null ? 'Max level' : `Level up · ${formatCoins(cost)}`,
        primary: !carried && cost !== null && s.coins >= cost,
        action: () => this.levelUp(i),
      },
      {
        label: sellArmed ? `Sure? +${formatCoins(sell)}` : `Sell · ${formatCoins(sell)}`,
        action: () => (sellArmed ? this.sellPad(i) : this.openPad(i, true)),
      },
      { label: 'Close' },
    ]);
  }

  private levelUp(i: number): void {
    const s = this.save;
    const slot = s.pads[i];
    if (!slot) return;
    const cost = levelCost(slot);
    if (cost === null) return;
    if (s.coins < cost) {
      this.hud.toast(`Need ${formatCoins(cost - s.coins)} more coins`, 'bad small');
    } else {
      s.coins -= cost;
      slot.level = (slot.level ?? 1) + 1;
      this.completeHint('level');
      writeSave(s);
      this.sfx.ding();
      this.hud.toast(`${slot.name} Lv ${slot.level}!`, 'gold');
      this.fx.burst(Base.padPosition(i, this.tmp).setY(1), {
        count: 18,
        color: RARITIES[slot.rarity].color,
        speed: 6,
        life: 0.7,
        size: 0.6,
        up: 4,
      });
    }
    this.openPad(i);
  }

  private sellPad(i: number): void {
    const s = this.save;
    const slot = s.pads[i];
    if (!slot) return;
    const coins = sellValue(s, slot) + Math.floor(slot.cash);
    s.coins += coins;
    s.pads[i] = null;
    this.base.sync(s);
    writeSave(s);
    this.sfx.coin();
    this.floatAt(Base.padPosition(i, this.tmp).setY(1.6), `Sold +${formatCoins(coins)}`);
  }

  /** The cheapest level-up on the base, for the level hint. */
  private cheapestLevel(): number | null {
    let best: number | null = null;
    for (const slot of this.save.pads) {
      const cost = slot ? levelCost(slot) : null;
      if (cost !== null && (best === null || cost < best)) best = cost;
    }
    return best;
  }

  // ---------------------------------------------------------------- return visits

  /** On load: offline earnings first, then the daily reward. */
  private welcome(): void {
    const away = offlineEarnings(this.save, Date.now());
    if (away.coins <= 0) {
      this.offerDaily();
      return;
    }
    this.save.coins += away.coins;
    writeSave(this.save);
    const minutes = Math.round(away.seconds / 60);
    const text = document.createElement('p');
    text.textContent = `Your characters kept earning for ${minutes} min while you were away, at half rate.`;
    const amount = document.createElement('div');
    amount.className = 'big';
    amount.textContent = `+${formatCoins(away.coins)} coins`;
    this.hud.showModal('Welcome back!', [text, amount], [
      { label: 'Collect', primary: true, action: () => this.offerDaily() },
    ]);
  }

  private offerDaily(): void {
    // A brand-new player goes straight to the cannon; their streak starts next visit.
    if (this.save.flightNo === 0) return;
    const { due, day } = dailyStatus(this.save, new Date());
    if (!due) return;
    const grid = document.createElement('div');
    grid.className = 'daily-grid';
    DAILY.forEach((reward, i) => {
      const tile = document.createElement('div');
      tile.className = `daily-day${i + 1 < day ? ' done' : ''}${i + 1 === day ? ' today' : ''}`;
      const label = document.createElement('b');
      label.textContent = `Day ${i + 1}`;
      tile.append(
        label,
        reward.kind === 'coins'
          ? `${formatCoins(dailyCoins(this.save, reward.minutes))} coins`
          : `A ${RARITIES[reward.rarity].name}!`,
      );
      grid.append(tile);
    });
    const note = document.createElement('p');
    note.textContent = 'Come back tomorrow to keep your streak. Missing a day starts it over.';
    this.hud.showModal(`Daily reward · Day ${day}`, [grid, note], [
      { label: 'Claim', primary: true, action: () => this.claimDaily(day) },
    ]);
  }

  private claimDaily(day: number): void {
    const s = this.save;
    const reward = DAILY[day - 1];
    s.dailyStreak = day;
    s.lastDaily = dayKey(new Date());
    if (reward.kind === 'coins') {
      const coins = dailyCoins(s, reward.minutes);
      s.coins += coins;
      this.hud.toast(`+${formatCoins(coins)} coins!`, 'gold');
      this.sfx.coin();
    } else {
      const name = pickName(reward.rarity);
      placeCatches(s, [{ name, rarity: reward.rarity }]);
      this.addToBook(name);
      this.base.sync(s);
      this.hud.toast(`${RARITIES[reward.rarity].name}: ${name}!`, '', RARITIES[reward.rarity].css);
      this.sfx.chant(name);
    }
    writeSave(s);
  }

  private addToBook(name: string): boolean {
    if (this.save.collected.includes(name)) return false;
    this.save.collected.push(name);
    return true;
  }

  private bookRewardWaiting(): boolean {
    return BOOK_ZONES.some((zone, i) => !this.save.bookClaimed.includes(i) && zoneComplete(this.save, zone));
  }

  private openBook(): void {
    const s = this.save;
    const pages = BOOK_ZONES.map((zone, i) => {
      const entries = bookEntries(zone);
      const caught = entries.filter((e) => s.collected.includes(e.name)).length;
      const page = document.createElement('div');
      page.className = 'book-page';
      const head = document.createElement('h3');
      const title = document.createElement('span');
      title.textContent = `${zone.name} · ${caught}/${entries.length}`;
      head.append(title);
      if (zoneComplete(s, zone) && !s.bookClaimed.includes(i)) {
        const claim = document.createElement('button');
        claim.type = 'button';
        claim.textContent = `Claim ${formatCoins(zone.reward)}`;
        claim.addEventListener('click', () => {
          s.bookClaimed.push(i);
          s.coins += zone.reward;
          writeSave(s);
          this.hud.toast(`${zone.name} complete! +${formatCoins(zone.reward)}`, 'gold');
          this.sfx.ding();
          this.openBook();
        });
        head.append(claim);
      } else {
        const status = document.createElement('span');
        status.textContent = s.bookClaimed.includes(i) ? 'Complete' : `Reward ${formatCoins(zone.reward)}`;
        head.append(status);
      }
      const grid = document.createElement('div');
      grid.className = 'book-grid';
      grid.append(...entries.map((e) => this.hud.characterCard(e.name, e.rarity, !s.collected.includes(e.name))));
      page.append(head, grid);
      return page;
    });
    const total = BOOK_ZONES.reduce((n, zone) => n + bookEntries(zone).length, 0);
    this.hud.showModal(`Collection book · ${s.collected.length}/${total}`, pages, [{ label: 'Close' }]);
  }

  // ---------------------------------------------------------------- entities

  private updatePickups(dt: number): void {
    for (const p of this.pickups) {
      if (p.state === 'floating') {
        p.rig.figure.position.y = Math.sin(this.time * 2 + p.seed) * 0.15;
        p.rig.figure.rotation.y = Math.sin(this.time * 0.8 + p.seed) * 0.35;
        p.rig.group.position.set(p.x, p.y, 0);
        p.rig.animate(this.time + p.seed);
      } else if (p.state === 'tumbling' || p.state === 'lost') {
        p.cooldown -= dt;
        p.vy = Math.max(p.vy - 14 * dt, p.state === 'lost' ? -30 : -FLIGHT.tumbleFall);
        p.vx *= Math.max(0, 1 - 1.2 * dt);
        p.x = clamp(p.x + p.vx * dt, -this.lane - 2, this.lane + 2);
        p.y += p.vy * dt;
        p.rig.figure.rotation.z += 5 * dt;
        p.rig.figure.rotation.x += 3 * dt;
        p.rig.group.position.set(p.x, p.y, p.z);
        if (p.y <= 0.2) {
          p.state = 'gone';
          p.rig.group.visible = false;
          this.fx.burst(this.tmp.set(p.x, 0.5, p.z), {
            count: 12,
            color: RARITIES[p.rarity].color,
            speed: 5,
            life: 0.6,
            size: 0.7,
            up: 2,
          });
        }
      }
    }
  }

  private updateBirds(dt: number): void {
    const edge = this.lane + 3;
    for (const b of this.birds) {
      if (b.hit) {
        b.vy -= 6 * dt;
        b.y += b.vy * dt;
        b.x += b.dir * b.speed * 2 * dt;
        b.rig.group.rotation.z += 8 * dt;
      } else {
        b.x += b.dir * b.speed * dt;
        if (Math.abs(b.x) > edge) {
          b.dir = -b.dir;
          b.x = clamp(b.x, -edge, edge);
        }
        b.y = b.baseY + Math.sin(this.time * 2 + b.seed) * (b.kind === 'bird' ? 0.6 : 0.3);
        if (b.kind !== 'storm') b.rig.group.rotation.y = b.dir > 0 ? 0 : Math.PI;
      }
      if (b.rig.spinner) b.rig.spinner.rotation.x = this.time * 40;
      if (b.rig.flash) b.rig.flash.visible = Math.sin(this.time * 9 + b.seed * 3) > 0.6;
      const flap = Math.sin(this.time * 14 + b.seed) * 0.8;
      for (const wing of b.rig.wings) wing.rotation.x = flap * (wing.userData.side as number);
      b.rig.group.position.set(b.x, b.y, 0);
    }
  }

  // ---------------------------------------------------------------- presentation

  private updateVisuals(realDt: number, dt: number): void {
    const body = this.player.body;
    const inFlight = this.state === 'ascent' || this.state === 'fall';
    const atBase = this.state === 'home' || this.state === 'boarding';
    const crashed = (this.state === 'landed' || this.state === 'reveal') && this.chute !== 'open';
    const lying = crashed && this.bounces === 0;
    const squash = this.state === 'charging' ? this.charge : 0;

    const landingDrift = (this.state === 'fall' && this.chute !== 'closed') || this.state === 'landed';
    if (landingDrift) this.pz = lerp(this.pz, LANDING_Z, damp(1.5, dt));
    this.player.group.position.set(this.px, this.py - squash * 0.5, this.pz);
    this.player.group.rotation.y = atBase ? this.facing : 0;
    if (crashed) {
      if (this.bounces > 0) {
        body.rotation.z += this.spin * dt;
      } else {
        const z = Math.atan2(Math.sin(body.rotation.z), Math.cos(body.rotation.z));
        body.rotation.z = lerp(z, (Math.sign(this.spin) * Math.PI) / 2, damp(10, dt));
      }
      body.rotation.x = lerp(body.rotation.x, 0, damp(10, dt));
    } else if (this.state !== 'reveal') {
      const freefall = this.state === 'fall' && this.chute === 'closed';
      body.rotation.x = lerp(body.rotation.x, freefall ? -1.1 : 0, damp(5, dt));
      body.rotation.z = lerp(body.rotation.z, clamp(-this.vx * 0.035, -0.5, 0.5), damp(10, dt));
    }
    body.position.y = lerp(body.position.y, lying ? 0.35 : 0.9, damp(10, dt));
    if (atBase && this.walking) body.position.y = 0.9 + Math.abs(Math.sin(this.time * 14)) * 0.08;
    body.visible = this.invuln <= 0 || Math.floor(this.time * 20) % 2 === 0;

    const chuteTarget = !inFlight ? 0 : this.chute === 'open' ? 1 : this.chute === 'tangled' ? 0.5 : 0;
    this.chuteScale = lerp(this.chuteScale, chuteTarget, damp(this.chuteScale < chuteTarget ? 14 : 6, realDt));
    this.player.chute.visible = this.chuteScale > 0.02;
    this.player.chute.scale.setScalar(this.chuteScale);
    this.player.chute.rotation.z =
      this.chute === 'tangled' ? Math.sin(this.time * 30) * 0.3 : Math.sin(this.time * 1.5) * 0.05;

    const stackBase = lying ? 1.1 : STACK_BASE;
    this.stack.forEach((p, i) => {
      const sway = Math.sin(this.time * 5 + i) * 0.05 * i;
      p.rig.group.position.set(this.px + sway, this.py + stackBase + i * STACK_STEP, this.pz + 0.15);
      p.rig.figure.position.y = 0;
      p.rig.figure.rotation.y = Math.sin(this.time * 2 + i) * 0.3;
    });
    this.carried.forEach((rig, i) => {
      const selected = i === this.carrySel;
      rig.group.position.set(this.px, this.py + STACK_BASE + i * STACK_STEP, this.pz + 0.15);
      rig.group.scale.setScalar(HELD_SCALE * (selected ? 1.25 : 1));
      rig.figure.position.y = selected ? Math.abs(Math.sin(this.time * 6)) * 0.15 : 0;
      rig.figure.rotation.y = this.player.group.rotation.y + Math.PI;
    });
    this.hud.setCarryVisible(this.state === 'home' && this.save.carrying.length > 0);
    animateShared(this.time);

    const shadow = this.env.shadow;
    const s = 0.9 + this.py * 0.04;
    shadow.position.x = this.px;
    shadow.position.z = this.pz;
    shadow.scale.set(s, s, 1);
    (shadow.material as THREE.MeshBasicMaterial).opacity =
      this.state === 'aim' || this.state === 'charging' ? 0 : clamp(0.4 - this.py / 150, 0, 0.4);
    this.env.barrel.scale.set(1 + squash * 0.08, 1 - squash * 0.12, 1 + squash * 0.08);

    skyColorAt(Math.max(0, this.py), this.sky);
    (this.scene.fog as THREE.Fog).color.copy(this.sky);

    this.updateCamera(realDt);
    this.env.updateDecor(this.camera.position.y);
    this.streaks.update(this.py, inFlight ? this.vy : 0);
    this.sfx.wind(inFlight ? clamp(Math.abs(this.vy) / 50, 0, 1) * (this.chute === 'open' ? 0.3 : 1) : 0);

    const alt = this.state === 'aim' || this.state === 'charging' ? 0 : Math.max(0, this.py);
    this.hud.setAlt(!atBase && this.state !== 'reveal', alt, ZONES[zoneIndexAt(alt)].name, this.save.best);
    this.hud.setStack(
      this.stack.map((p) => p.rarity),
      carryLimit(this.save),
      !atBase,
    );
    this.hud.setWallet(this.save.coins, incomePerSecond(this.save));
    const canShop = this.state === 'home' || this.state === 'aim';
    const upgradeHint = this.wantsUpgradeHint() || this.wantsExpandHint();
    const launchHint =
      this.state === 'home' &&
      this.hasHint('collect') &&
      !upgradeHint &&
      !this.save.pads.some((slot) => slot !== null && slot.cash >= 1);
    this.hud.showBaseButtons(canShop, this.state === 'home', canShop && upgradeHint, launchHint, this.bookRewardWaiting());
  }

  /**
   * Each state wants the camera at some position and looking at some point. The camera eases toward
   * them as offsets from the player rather than as absolute positions, so a fast flight doesn't lag.
   */
  private updateCamera(realDt: number): void {
    // 0 in landscape, up to 1 on a tall phone screen.
    const portrait = clamp((1 - this.camera.aspect) * 2, 0, 1);
    const speed = Math.abs(this.vy);
    const pos = this.wantPos;
    const look = this.wantLook;
    let rate = 4;

    switch (this.state) {
      case 'aim':
      case 'charging':
        // Behind the cannon, looking up the barrel.
        pos.set(0, MUZZLE_Y - 0.8, 8.5 + portrait * 4);
        look.set(0, MUZZLE_Y + 3.8, -1.5);
        break;
      case 'ascent':
      case 'fall': {
        const follow = lerp(0.6, 0.92, portrait);
        if (this.state === 'fall' && this.chute !== 'closed') {
          // Level with the player so the canopy stays in view.
          pos.set(this.px * follow, this.py + 1.5, this.pz + 15 * (1 + portrait * 0.25));
          look.set(this.px * follow * 1.2, this.py + 2.2, this.pz);
        } else {
          // Below the player looking up while rising, above looking down while falling.
          const f = clamp(0.5 - this.vy / 20, 0, 1);
          const dist = (12 + Math.min(18, speed * 0.1)) * (1 + portrait * 0.25);
          const height = lerp(-5 - Math.min(6, speed * 0.05), 6 + Math.min(6, speed * 0.04), f);
          pos.set(this.px * follow, this.py + height, this.pz + dist);
          // A look upward at the apex, toward what's above.
          const apexPan = this.state === 'fall' && this.slowmo > 0 && this.vy > -6 ? (this.goal.visible ? 14 : 8) : 0;
          look.set(this.px * follow * 1.2, this.py + lerp(7, -7, f) + apexPan, this.pz);
        }
        rate = this.state === 'ascent' ? 3 : 4;
        break;
      }
      case 'landed':
      case 'reveal':
        pos.set(this.px * 0.6, 4.5, this.pz + 13 * (1 + portrait * 0.5));
        look.set(this.px, 1, this.pz);
        break;
      case 'home':
      case 'boarding': {
        // Above and in front of the pad grid, pulling back as the base grows.
        const center = Base.center(this.save.pads.length, look);
        const scale = (1 + (Base.rows(this.save.pads.length) - 1) * 0.12) * (1 + portrait * 0.7);
        pos.set(center.x + 3 * scale, 14 * scale, center.z + 15 * scale);
        rate = 2.5;
        break;
      }
    }

    const player = this.player3.set(this.px, this.py, this.pz);
    const k = damp(rate, realDt);
    this.camOff.lerp(pos.sub(player), k);
    this.camLook.lerp(look.sub(player), k);
    const jitter = () => (Math.random() - 0.5) * this.shake;
    this.camera.position.set(
      player.x + this.camOff.x + jitter(),
      player.y + this.camOff.y + jitter(),
      player.z + this.camOff.z,
    );
    this.camera.lookAt(player.x + this.camLook.x, player.y + this.camLook.y, player.z + this.camLook.z);

    let fov = 60 + Math.min(18, speed * 0.12);
    if (this.state === 'charging') fov = 56 - this.charge * 4;
    if (this.state === 'home' || this.state === 'boarding') fov = 50;
    fov += portrait * 6;
    this.camera.fov = lerp(this.camera.fov, fov, damp(4, realDt));
    this.camera.updateProjectionMatrix();
  }
}
