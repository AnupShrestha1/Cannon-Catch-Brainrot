// The game loop. A run goes charge → launch → ascent → apex → fall → parachute → landing → result, then
// home to the showcase, where gems from the sky buy gacha pulls, brainrots on display earn coins, and coins
// buy upgrades. The flight is scripted rather than simulated, so the apex hits launchHeight() exactly.
import * as THREE from 'three';
import { Sfx } from './audio';
import { Base, CARPET_Z, MACHINE_FRONT } from './base';
import { animateShared } from './characters';
import {
  CHARGE,
  CHUTE,
  CRASH_DROP,
  ECONOMY,
  FLIGHT,
  GACHA,
  GEMS,
  GIFTS,
  HAZARD_SPACING,
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
  zoneIndexAt,
  type GachaTier,
} from './config';
import {
  buyUpgrade,
  expansionCost,
  formatCoins,
  incomeMultiplier,
  gainXp,
  incomePerSecond,
  levelCost,
  levelReady,
  merge,
  mergeNeed,
  xpNeeded,
  padIncome,
  pickName,
  pull,
  sellValue,
  takeFromBackpack,
  tierUnlocked,
  trackBoost,
  upgradeCost,
} from './economy';
import { Particles, Streaks } from './fx';
import { Hud, type ShopItem, type ShopRow } from './hud';
import { Input } from './input';
import { BOOK_ZONES, DAILY, bookEntries, dailyCoins, dailyStatus, dayKey, offlineEarnings, zoneComplete } from './meta';
import { platform } from './platform';
import { clearSave, loadSave, writeSave, type Owned, type Save } from './store';
import {
  buildEnv,
  makeBird,
  GEM_SCALE,
  makeGem,
  makeGuide,
  makeLabel,
  makePlane,
  makeStormCloud,
  makePlayer,
  skyColorAt,
  type BirdRig,
  type Env,
  type GemRig,
  type GuideRig,
  type Label,
  type PlayerRig,
} from './world';

type State = 'aim' | 'charging' | 'ascent' | 'fall' | 'landed' | 'reveal' | 'home' | 'boarding';
type Chute = 'closed' | 'open' | 'tangled';

interface Gem {
  /** Gems it pays, before the gem finder bonus. */
  value: number;
  big: boolean;
  color: number;
  rig: GemRig;
  x: number;
  y: number;
  state: 'floating' | 'taken';
  /** Progress of a collected gem's zip into the player, 0 to 1. */
  t: number;
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
/** Depth the player drifts to while landing, clear of the cannon at z = 0. */
const LANDING_Z = 3.5;
/** Where the player waits in the showcase, just inside the entrance, and where they climb into the cannon. */
const HOME_SPOT = new THREE.Vector3(-13, 0, CARPET_Z);
const CANNON_FOOT = new THREE.Vector3(0, 0, 2.3);
/** The base camera looks down the carpet toward the gacha machine. */
const HOME_YAW = Math.PI / 2;
const WALK_SPEED = 9;
/** Walking within this distance of a slot's centre collects its coins. */
const COLLECT_RADIUS = 1.7;
/** How close to the machine's front the player must stand to use it. */
const MACHINE_REACH = 2.6;
/** Radians the base camera turns per pixel dragged. */
const ORBIT_SPEED = 0.006;
/** Seconds the machine shakes before a pull's result shows. */
const PULL_TIME = 1.1;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Frame-rate independent smoothing factor. */
const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
/** Eases angle a toward b the short way round. */
const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

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
  private goalGem = new THREE.Group();
  private goalLabel: Label;
  private sky = new THREE.Color(0x8fd3ff);
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
  /** Walking under keyboard control this frame. */
  private stepping = false;
  /** Walking forward (W or tap-to-walk), which swings the base camera round behind the player. */
  private followCam = false;
  /** Base camera heading: it looks along (-sin, -cos) of this, from behind the player. */
  private camYaw = 0;
  private walkPhase = 0;
  /** Base walking velocity on the ground (x, z). */
  private walkVel = new THREE.Vector2();
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
  /** Gems picked up this run, and gems knocked loose by hazards or lost in a crash. */
  private runGems = 0;
  private gemsLost = 0;

  private gems: Gem[] = [];
  private birds: Bird[] = [];
  /** The tutorial's green arrows, and the place they point at (null hides them). */
  private guide: GuideRig;
  private guideTarget: THREE.Vector3 | null = null;
  private objTarget = new THREE.Vector3();
  /** Seconds left of the machine's shake before the pending pull's result shows. */
  private pulling = 0;
  private pendingPull: { got: Owned; tier: GachaTier; isNew: boolean } | null = null;
  /** What to do when the current walk arrives. */
  private arrive: (() => void) | null = null;

  private slowmo = 0;
  private shake = 0;
  private stun = 0;
  private invuln = 0;
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
  /** Seconds toward the next once-a-second income tick. */
  private incomeTimer = 0;
  /** Rebirth needs a second tap in the shop. */
  private rebirthArmed = false;

  /** Dev-only: stops the frame loop from advancing the game, so debugStep() is the only clock. */
  debugPaused = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = this.sky;
    this.scene.fog = new THREE.Fog(0x8fd3ff, 90, 420);
    this.env = buildEnv(this.scene);
    this.base = new Base(this.scene);
    this.player = makePlayer();
    this.player.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
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

    // The goal in the sky: the next zone's bigger gems, and the cannon level that reaches them.
    this.goalLabel = makeLabel();
    this.goalLabel.sprite.position.y = 4.4;
    this.goalLabel.sprite.scale.multiplyScalar(1.5);
    this.goal.add(this.goalGem, this.goalLabel.sprite);
    this.goal.visible = false;
    this.scene.add(this.goal);

    this.guide = makeGuide();
    this.scene.add(this.guide.marker, this.guide.ground);

    this.paintCannon();
    platform.onSettingsChange(() => this.applyMute());
    this.bindUi();
    window.addEventListener('resize', () => this.resize());
    this.resize();

    this.base.sync(this.save);
    if (this.save.flightNo > 0) {
      // Returning players start in the showcase, where their brainrots have been earning.
      this.px = HOME_SPOT.x;
      this.py = this.prevY = 0;
      this.pz = HOME_SPOT.z;
      this.camYaw = HOME_YAW;
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
  debugStep(seconds: number): { state: State; y: number; vy: number; gems: number; coins: number } {
    for (let t = 0; t < seconds; t += 1 / 60) this.update(1 / 60);
    this.renderer.render(this.scene, this.camera);
    return {
      state: this.state,
      y: Math.round(this.py * 10) / 10,
      vy: Math.round(this.vy * 10) / 10,
      gems: this.runGems,
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
    onClick(hud.backpackBtn, () => this.openBackpack());
    hud.onBuy = (item) => this.buy(item);
    hud.onAction = () => this.useHere();
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyT') hud.tunePanel.classList.toggle('hidden');
      if (e.code === 'KeyB' && !hud.modalOpen && (this.state === 'home' || this.state === 'aim')) this.openBackpack();
      if (e.code === 'KeyM') this.toggleMute();
      if (e.code === 'Escape') hud.closeShop();
    });
    hud.bindTuning(this.save, {
      changed: () => {
        writeSave(this.save);
        this.refreshShop();
      },
      addCoins: (amount) => {
        this.save.coins += amount;
        writeSave(this.save);
        this.refreshShop();
        this.hud.toast(`+${formatCoins(amount)} coins (test)`, 'good small');
      },
      addGems: (amount) => {
        this.save.gems += amount;
        writeSave(this.save);
        this.hud.toast(`+${formatCoins(amount)} gems (test)`, 'good small');
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
    // A hidden or collapsed frame reports 0 × 0; a 0/0 aspect would poison the camera with NaN.
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
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
    if (this.pulling > 0) {
      this.pulling -= realDt;
      if (this.pulling <= 0) this.showPullResult();
    }
    // The shop, other modals and a pull in progress swallow presses.
    const blocked = this.hud.shopOpen || this.hud.modalOpen || this.pulling > 0;
    const pressed = this.input.consumePressed() && !blocked;
    const space = this.input.consumeSpace() && !blocked;
    // Clicks and taps don't move or select anything any more; drop them.
    this.input.consumeTap();
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
        this.updateHome(dt, space, blocked);
        break;
      case 'boarding':
        this.updateWalk(dt);
        break;
    }

    // Camera drags only mean something at the base; drop any made during a run.
    if (this.state !== 'home') this.input.consumeOrbitDx();
    this.hud.showStick(this.state === 'home' && !blocked ? this.input.stick : null);
    this.updateEconomy(realDt);
    this.updateGems(dt);
    this.updateBirds(dt);
    this.base.update(this.save, this.time, realDt);
    this.fx.update(dt);
    this.updateVisuals(realDt, dt);
    // The reveal screen and the shop are breaks in play.
    platform.setPlaying(this.state !== 'reveal' && !this.hud.shopOpen && !this.hud.modalOpen);
    this.input.endFrame();
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
    this.runGems = 0;
    this.gemsLost = 0;
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

  /** Places gems along the predicted ascent, so every row passes by at a readable pace. */
  private spawnRun(apex: number, v0: number, tUp: number): void {
    const flight = this.save.flightNo;
    const width = FLIGHT.spawnHalfWidth * (this.lane / FLIGHT.lane);
    // A Storm Layer flight blasts through Low Sky too fast to collect anything, so nothing spawns there.
    const apexZone = Math.min(zoneIndexAt(apex), MAX_ZONE);
    const floor = apexZone >= 2 ? ZONES[apexZone - 1].from : 14;
    if (flight === 1) {
      // Tutorial: a straight line of gems up the flight path, enough for the first gacha pull.
      const n = GEMS.tutorialLine;
      for (let i = 0; i < n; i++) this.addGem(0, 12 + ((apex - 20) * i) / (n - 1), false);
    } else {
      let lastY = -Infinity;
      for (let t = 0.6; t < tUp - 0.1; t += FLIGHT.pickupStep * rand(0.8, 1.2)) {
        const y = MUZZLE_Y + v0 * t - 0.5 * this.gUp * t * t;
        if (y < floor || y - lastY < FLIGHT.pickupMinGap) continue;
        lastY = y;
        const x = rand(-width, width);
        this.addGem(x, y, Math.random() < GEMS.bigChance);
        // Now and then a pair, side by side.
        if (Math.random() < 0.3) this.addGem(clamp(x + (x > 0 ? -2.6 : 2.6), -width, width), y + 0.5, false);
      }
    }

    const mode = this.save.hazards;
    if (mode === 'on' || (mode === 'auto' && flight >= TUTORIAL.hazardFromFlight)) {
      // A few hazards, a little denser with height, capped per flight.
      const h = HAZARD_SPACING;
      let count = 0;
      for (let y = Math.max(h.start, floor); y < apex - 3 && count < h.maxPerFlight; count++) {
        this.addBird(y);
        y += lerp(h.gapLow, h.gapHigh, Math.min(1, y / 1500)) * rand(0.8, 1.2);
      }
    }
  }

  /** A gem worth its zone's value; big ones are gold and worth GEMS.bigMultiplier times as much. */
  private addGem(x: number, y: number, big: boolean): void {
    const zone = ZONES[Math.min(zoneIndexAt(y), MAX_ZONE)];
    const color = big ? 0xffd23f : zone.gemColor;
    const rig = makeGem(color, big);
    rig.group.position.set(x, y, 0);
    this.scene.add(rig.group);
    this.gems.push({
      value: zone.gems * (big ? GEMS.bigMultiplier : 1),
      big,
      color,
      rig,
      x,
      y,
      state: 'floating',
      t: 0,
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

    const reach = FLIGHT.playerRadius + FLIGHT.pickupRadius * trackBoost(this.save, 'magnet');
    for (const g of this.gems) {
      if (g.state === 'floating' && segmentDistance(ax, ay, bx, by, g.x, g.y) < reach) this.grabGem(g);
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

  private grabGem(g: Gem): void {
    g.state = 'taken';
    g.t = 0;
    const value = Math.max(1, Math.round(g.value * trackBoost(this.save, 'finder')));
    this.runGems += value;
    const at = this.tmp.set(g.x, g.y, 0);
    this.fx.burst(at, { count: g.big ? 24 : 8, color: g.color, speed: g.big ? 9 : 6, life: 0.5, size: g.big ? 0.7 : 0.45 });
    this.floatAt(at.setY(g.y + 1.2), `+${value}`, 'gem');
    this.sfx.pop(g.big ? 4 : 1);
    if (g.big) {
      this.slowmo = Math.max(this.slowmo, 0.25);
      this.hud.toast(`BIG GEM! +${value}`, 'gold');
      this.sfx.sparkle();
    }
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
    // A hit knocks some of the run's gems loose (none during the tutorial flights).
    const tutorial = this.save.flightNo <= TUTORIAL.noDropFlights;
    const lost = tutorial ? 0 : Math.min(this.runGems, Math.max(1, Math.round(this.runGems * GEMS.hitLoss)));
    const word = HAZARDS[b.kind].toast;
    if (lost > 0) {
      this.runGems -= lost;
      this.gemsLost += lost;
      this.fx.burst(this.tmp.set(this.px, this.py + BODY_MID, 0), {
        count: 12,
        color: 0x3fc8ff,
        speed: 8,
        life: 0.9,
        size: 0.45,
        gravity: 12,
      });
      this.hud.toast(`${word} -${lost} gems`, 'bad small');
    } else {
      this.hud.toast(rising ? word : `${word}`, 'bad small');
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
    this.goalGem.clear();
    const gem = makeGem(zone.gemColor, true);
    gem.group.scale.setScalar(3.2);
    this.goalGem.add(gem.group);
    this.goalLabel.set(`${zone.name}: ${zone.gems}× gems · Cannon Lv ${level}`, '#ffe58a');
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
    const lost = tutorial ? 0 : Math.floor(this.runGems * share);
    if (lost > 0) {
      this.runGems -= lost;
      this.gemsLost += lost;
      this.fx.burst(this.tmp.set(this.px, 1, this.pz), { count: 18, color: 0x3fc8ff, speed: 10, life: 1, size: 0.5, up: 6, gravity: 14 });
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
    if (lost > 0) this.hud.toast(`Lost ${lost} gems`, 'bad small');
    else if (tutorial && this.runGems) this.hud.toast('Tutorial: no gems lost', 'small');
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

  /** The run's result: gems collected, added to the wallet now so nothing is lost if the tab closes. */
  private showReveal(): void {
    this.state = 'reveal';
    this.revealT = 0;
    this.save.gems += this.runGems;
    writeSave(this.save);
    const parts = [`Apex ${Math.round(this.apex)} m`, this.landing];
    if (this.gemsLost) parts.push(`${this.gemsLost} gems lost`);
    this.hud.showRunResult(this.runGems, this.save.gems, parts.join(' · '));
    if (this.runGems > 0) this.sfx.coin();
  }

  private clearRun(): void {
    for (const g of this.gems) this.scene.remove(g.rig.group);
    for (const b of this.birds) this.scene.remove(b.rig.group);
    this.gems = [];
    this.birds = [];
    this.goal.visible = false;
    this.recordLine.visible = false;
  }

  // ---------------------------------------------------------------- base

  /** Back to the showcase after a run. */
  private goHome(): void {
    this.clearRun();
    this.hud.hideReveal();
    writeSave(this.save);
    this.state = 'home';
    this.camYaw = HOME_YAW;
    this.walkTo(HOME_SPOT);
  }

  private nearMachine(): boolean {
    return Math.hypot(MACHINE_FRONT.x - this.px, MACHINE_FRONT.z - this.pz) < MACHINE_REACH;
  }

  /** The gacha panel: each tier with its price and odds. */
  private openGacha(): void {
    const s = this.save;
    const have = document.createElement('p');
    have.className = 'gem-line';
    have.textContent = `You have ${formatCoins(s.gems)} gems`;
    const tiers = GACHA.map((tier) => {
      const el = document.createElement('div');
      el.className = 'gacha-tier';
      if (!tierUnlocked(s, tier)) el.classList.add('locked');
      const head = document.createElement('h3');
      const name = document.createElement('span');
      name.textContent = tier.name;
      const cost = document.createElement('span');
      cost.className = 'cost';
      cost.textContent = `${tier.cost} gems`;
      head.append(name, cost);
      const odds = document.createElement('div');
      odds.className = 'odds';
      for (const [rarity, chance] of tier.odds) {
        const chip = document.createElement('span');
        chip.style.setProperty('--c', RARITIES[rarity].css);
        chip.textContent = `${RARITIES[rarity].name} ${+(chance * 100).toFixed(1)}%`;
        odds.append(chip);
      }
      el.append(head, odds);
      if (!tierUnlocked(s, tier)) {
        const note = document.createElement('p');
        note.textContent = 'Unlocks once a flight reaches Cloud Kingdom.';
        el.append(note);
      }
      return el;
    });
    this.hud.showModal('Gacha machine', [have, ...tiers], [
      ...GACHA.map((tier) => ({
        label: tierUnlocked(s, tier) ? `${tier.name} · ${tier.cost} gems` : `${tier.name} · locked`,
        primary: tierUnlocked(s, tier) && s.gems >= tier.cost,
        action: () => this.startPull(tier),
      })),
      { label: 'Close' },
    ]);
  }

  /** Spends the gems, shakes the machine, and shows the result once the capsule pops out. */
  private startPull(tier: GachaTier): void {
    const s = this.save;
    if (!tierUnlocked(s, tier)) {
      this.hud.toast(`Reach Cloud Kingdom to unlock the ${tier.name}`, 'small');
      return;
    }
    if (s.gems < tier.cost) {
      this.hud.toast(`Need ${tier.cost - s.gems} more gems`, 'bad small');
      return;
    }
    const got = pull(s, tier);
    if (!got) return;
    const isNew = this.addToBook(got.name);
    this.completeHint('pull');
    writeSave(s);
    this.base.shakeMachine();
    this.sfx.swap();
    this.pulling = PULL_TIME;
    this.pendingPull = { got, tier, isNew };
  }

  private showPullResult(): void {
    const pending = this.pendingPull;
    this.pendingPull = null;
    if (!pending) return;
    const { got, tier, isNew } = pending;
    const s = this.save;
    const rarity = RARITIES[got.rarity];
    this.fx.burst(Base.capsuleExit(this.tmp), {
      count: 20 + got.rarity * 12,
      color: rarity.color,
      speed: 8 + got.rarity,
      life: 0.9,
      size: 0.6,
      up: 5,
    });
    this.sfx.pop(got.rarity);
    this.sfx.chant(got.name);
    if (got.rarity >= RARE) this.sfx.sparkle();
    if (got.rarity >= 4) platform.happytime();
    const card = this.hud.characterCard(got.name, got.rarity);
    card.classList.add('pulled');
    const info = document.createElement('p');
    info.textContent = `${formatCoins(padIncome(s, { rarity: got.rarity }))} coins/s on display${isNew ? ' · NEW in your book!' : ''}`;
    const empty = s.pads.findIndex((slot) => slot === null);
    const buttons: { label: string; primary?: boolean; action?: () => void }[] = [];
    if (empty >= 0) buttons.push({ label: 'Put on display', primary: true, action: () => this.placeFromBackpack(got.name, empty) });
    if (s.gems >= tier.cost) {
      buttons.push({ label: `Pull again · ${tier.cost} gems`, primary: empty < 0, action: () => this.startPull(tier) });
    }
    buttons.push({ label: `Sell · ${formatCoins(sellValue(s, got))}`, action: () => this.sellFromBackpack(got.name) });
    buttons.push({ label: 'Keep in backpack' });
    const title = got.rarity >= RARE ? `${rarity.name.toUpperCase()}!` : `${rarity.name}!`;
    this.hud.showModal(title, [card, info], buttons);
  }

  /**
   * The backpack: brainrots not on display, grouped by rarity, with merge, sell and place buttons.
   * Opened from an empty slot, placing puts the brainrot on that slot.
   */
  private openBackpack(slot: number | null = null): void {
    const s = this.save;
    const reopen = () => this.openBackpack(slot);
    if (!s.inventory.length) {
      const text = document.createElement('p');
      text.textContent = 'Your backpack is empty. Pull the gacha machine at the end of the carpet to get brainrots.';
      this.hud.showModal('Backpack', [text], [{ label: 'Close' }]);
      return;
    }
    const target = slot ?? s.pads.findIndex((p) => p === null);
    const rules = document.createElement('p');
    rules.className = 'sub';
    rules.textContent = 'Merge: 10 Common → 1 Uncommon · 8 Uncommon → 1 Rare · 6 Rare → 1 Epic · 4 Epic → 1 Legendary';
    const button = (label: string, onClick: () => void, disabled = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.disabled = disabled;
      b.addEventListener('click', onClick);
      return b;
    };
    const groups: HTMLElement[] = [];
    for (let r = RARITIES.length - 1; r >= 0; r--) {
      const items = s.inventory.filter((o) => o.rarity === r);
      if (!items.length) continue;
      const group = document.createElement('div');
      group.className = 'inv-group';
      group.style.setProperty('--c', RARITIES[r].css);
      const head = document.createElement('div');
      head.className = 'inv-head';
      const title = document.createElement('b');
      title.textContent = `${RARITIES[r].name} ×${items.length}`;
      head.append(title);
      const need = mergeNeed(r);
      if (need !== null) {
        head.append(
          button(`Merge ${need} → ${RARITIES[r + 1].name}`, () => {
            this.mergeRarity(r);
            reopen();
          }, items.length < need),
        );
      }
      const each = sellValue(s, { rarity: r });
      head.append(
        button(`Sell all · ${formatCoins(each * items.length)}`, () => {
          this.sellAllOf(r);
          reopen();
        }),
      );
      const cards = document.createElement('div');
      cards.className = 'inv-cards';
      const names = [...new Set(items.map((o) => o.name))];
      for (const name of names) {
        const count = items.filter((o) => o.name === name).length;
        const card = this.hud.characterCard(name, r);
        card.classList.add('inv-card');
        if (count > 1) {
          const badge = document.createElement('span');
          badge.className = 'count';
          badge.textContent = `×${count}`;
          card.append(badge);
        }
        const actions = document.createElement('div');
        actions.className = 'inv-actions';
        actions.append(
          button('Display', () => this.placeFromBackpack(name, target), target < 0),
          button(`Sell ${formatCoins(each)}`, () => {
            this.sellFromBackpack(name);
            if (s.inventory.length) reopen();
            else this.hud.closeModal();
          }),
        );
        card.append(actions);
        cards.append(card);
      }
      group.append(head, cards);
      groups.push(group);
    }
    const title = slot !== null ? `Choose a brainrot for slot ${slot + 1}` : `Backpack · ${s.inventory.length}`;
    const full = document.createElement('p');
    full.className = 'sub';
    full.textContent = target < 0 ? 'Every slot is taken: store or sell one, or unlock more slots in Upgrades.' : '';
    this.hud.showModal(title, [rules, full, ...groups], [{ label: 'Close' }]);
  }

  /** Puts a backpack brainrot on an empty, open slot. */
  private placeFromBackpack(name: string, pad: number): void {
    const s = this.save;
    if (pad < 0 || pad >= s.pads.length || s.pads[pad]) {
      this.hud.toast('No empty slot: store or sell one, or unlock more', 'bad small');
      return;
    }
    const got = takeFromBackpack(s, name);
    if (!got) return;
    s.pads[pad] = { name: got.name, rarity: got.rarity, cash: 0, level: 1 };
    this.base.sync(s);
    this.hud.closeModal();
    this.fx.burst(Base.padPosition(pad, this.tmp).setY(1.2), {
      count: 20,
      color: RARITIES[got.rarity].color,
      speed: 6,
      life: 0.8,
      size: 0.6,
      up: 4,
    });
    this.sfx.pop(got.rarity);
    this.sfx.chant(got.name);
    this.completeHint('place');
    writeSave(s);
  }

  private sellFromBackpack(name: string): void {
    const got = takeFromBackpack(this.save, name);
    if (!got) return;
    const coins = sellValue(this.save, got);
    this.save.coins += coins;
    this.hud.toast(`Sold ${got.name} +${formatCoins(coins)}`, 'good small');
    this.sfx.coin();
    writeSave(this.save);
  }

  private sellAllOf(rarity: number): void {
    const s = this.save;
    const count = s.inventory.filter((o) => o.rarity === rarity).length;
    if (!count) return;
    const coins = sellValue(s, { rarity }) * count;
    s.inventory = s.inventory.filter((o) => o.rarity !== rarity);
    s.coins += coins;
    this.hud.toast(`Sold ${count} ${RARITIES[rarity].name} +${formatCoins(coins)}`, 'good small');
    this.sfx.coin();
    writeSave(s);
  }

  private mergeRarity(rarity: number): void {
    const got = merge(this.save, rarity);
    if (!got) return;
    const isNew = this.addToBook(got.name);
    this.hud.toast(`Merged into ${got.name}!${isNew ? ' NEW!' : ''}`, '', RARITIES[got.rarity].css);
    this.sfx.sparkle();
    this.sfx.chant(got.name);
    if (got.rarity >= 4) platform.happytime();
    writeSave(this.save);
  }

  /** Moves a slot's brainrot into the backpack, collecting its coins first. It goes back to level 1. */
  private storePad(i: number): void {
    const s = this.save;
    const slot = s.pads[i];
    if (!slot) return;
    this.collect(i);
    s.inventory.push({ name: slot.name, rarity: slot.rarity });
    s.pads[i] = null;
    this.base.sync(s);
    this.hud.toast(`${slot.name} is in your backpack${(slot.level ?? 1) > 1 ? ' (back to Lv 1)' : ''}`, 'small');
    writeSave(s);
  }

  private walkTo(target: THREE.Vector3, then: (() => void) | null = null): void {
    this.followCam = true;
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
    this.facing = lerpAngle(this.facing, Math.atan2(-dx, -dz), damp(14, dt));
  }

  private updateHome(dt: number, space: boolean, blocked: boolean): void {
    this.stepping = false;
    this.moveAtBase(dt, blocked);
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
    this.updateHomePrompt();

    // Now and then a character at the base chants its name.
    this.chantTimer -= dt;
    if (this.chantTimer <= 0) {
      this.chantTimer = rand(18, 30);
      const placed = this.save.pads.filter((slot) => slot !== null);
      if (placed.length) this.sfx.chant(placed[Math.floor(Math.random() * placed.length)].name);
    }
  }

  /**
   * Walking at the base: WASD or the touch stick, relative to the camera, easing in and out so it doesn't
   * snap. Dragging turns the camera; E uses the slot underfoot or the gacha machine.
   */
  private moveAtBase(dt: number, blocked: boolean): void {
    if (blocked) {
      this.walkVel.set(0, 0);
      return;
    }
    this.camYaw -= this.input.consumeOrbitDx() * ORBIT_SPEED;
    const stick = this.input.stick;
    const right = this.input.axis + (stick.active ? stick.x : 0);
    const forward = this.input.axisY + (stick.active ? stick.y : 0);
    const amount = Math.min(1, Math.hypot(right, forward));
    let wantX = 0;
    let wantZ = 0;
    if (amount > 0.1) {
      // Steering by hand cancels a tap-to-walk, and the camera stays where the player put it.
      this.walking = false;
      this.arrive = null;
      this.followCam = false;
      // The camera's forward is (-sin, -cos) of camYaw and its right is (cos, -sin).
      const sin = Math.sin(this.camYaw);
      const cos = Math.cos(this.camYaw);
      const mx = -sin * forward + cos * right;
      const mz = -cos * forward - sin * right;
      const len = Math.hypot(mx, mz);
      wantX = (mx / len) * WALK_SPEED * amount;
      wantZ = (mz / len) * WALK_SPEED * amount;
      this.facing = lerpAngle(this.facing, Math.atan2(-mx, -mz), damp(14, dt));
    }
    if (!this.walking) {
      const k = damp(12, dt);
      this.walkVel.x += (wantX - this.walkVel.x) * k;
      this.walkVel.y += (wantZ - this.walkVel.y) * k;
      this.px = clamp(this.px + this.walkVel.x * dt, -45, 12);
      this.pz = clamp(this.pz + this.walkVel.y * dt, -12, 12);
      this.stepping = this.walkVel.length() > 0.6;
    } else {
      this.walkVel.set(0, 0);
    }
    if (this.input.consumeKey('KeyE') || this.input.consumeKey('Enter')) this.useHere();
  }

  private padUnderfoot(): number | null {
    for (let i = 0; i < this.save.pads.length; i++) {
      const at = Base.padPosition(i, this.tmp);
      if (Math.hypot(at.x - this.px, at.z - this.pz) < COLLECT_RADIUS) return i;
    }
    return null;
  }

  /** A locked slot the player stands on, or null. */
  private lockedUnderfoot(): number | null {
    for (let i = this.save.pads.length; i < ECONOMY.maxPads; i++) {
      const at = Base.padPosition(i, this.tmp);
      if (Math.hypot(at.x - this.px, at.z - this.pz) < COLLECT_RADIUS) return i;
    }
    return null;
  }

  /** What E (or the action button) would do here, or null when there's nothing to do. */
  private actionLabel(): string | null {
    if (this.nearMachine()) return `Gacha · ${formatCoins(this.save.gems)} gems`;
    const pad = this.padUnderfoot();
    if (pad !== null) {
      const slot = this.save.pads[pad];
      if (slot) return `Open ${slot.name}`;
      return this.save.inventory.length ? 'Display a brainrot' : null;
    }
    return this.lockedUnderfoot() !== null ? 'Unlock more slots' : null;
  }

  private useHere(): void {
    if (this.state !== 'home') return;
    if (this.nearMachine()) {
      this.openGacha();
      return;
    }
    const pad = this.padUnderfoot();
    if (pad !== null) {
      if (this.save.pads[pad]) this.openPad(pad);
      else if (this.save.inventory.length) this.openBackpack(pad);
      else this.hud.toast('Empty slot: pull the gacha to get a brainrot', 'small');
      return;
    }
    if (this.lockedUnderfoot() !== null) {
      this.hud.openShop();
      this.refreshShop();
      return;
    }
    this.hud.toast('Walk to a slot or the gacha machine first', 'small');
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

  /** The current objective for new players: a prompt and, when it's a place, where the green arrow points. */
  private objective(): { text: string; target: THREE.Vector3 | null } {
    const s = this.save;
    const press = this.input.isTouch ? 'tap the button' : 'press E';
    const basic = GACHA[0];
    const empty = s.pads.findIndex((slot) => slot === null);
    const cashPad = s.pads.findIndex((slot) => slot !== null && slot.cash >= 1);
    if (!this.hasHint('pull') && s.gems >= basic.cost) {
      return { text: `Walk to the gacha machine and ${press} to pull`, target: MACHINE_FRONT };
    }
    if (!this.hasHint('place') && s.inventory.length && empty >= 0) {
      return {
        text: `Stand on the glowing slot and ${press} to display your brainrot`,
        target: Base.padPosition(empty, this.objTarget),
      };
    }
    if (!this.hasHint('collect') && cashPad >= 0) {
      return { text: 'Walk over the slot to collect its coins', target: Base.padPosition(cashPad, this.objTarget) };
    }
    if (this.wantsUpgradeHint()) return { text: 'Upgrade your cannon!', target: null };
    if (this.wantsExpandHint()) return { text: 'Your showcase is full! Unlock more slots in Upgrades', target: null };
    if (this.wantsLevelHint()) return { text: `Stand on a slot and ${press} to level up its brainrot`, target: null };
    if (s.flightNo < 6 && s.gems < basic.cost && !s.inventory.length && empty >= 0) {
      return { text: `Launch to collect gems in the sky (${s.gems}/${basic.cost} for a pull)`, target: CANNON_FOOT };
    }
    return { text: '', target: null };
  }

  private updateHomePrompt(): void {
    const { text, target } = this.objective();
    this.hud.prompt(text, !!text);
    this.guideTarget = target;
  }

  private startBoarding(): void {
    this.state = 'boarding';
    this.guideTarget = null;
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
    // Coins land once a second, a whole second's income at a time, so each pad's counter ticks up visibly.
    this.incomeTimer += realDt;
    const ticks = Math.floor(this.incomeTimer);
    this.incomeTimer -= ticks;
    for (const slot of this.save.pads) {
      if (!slot) continue;
      if (ticks > 0) {
        const income = padIncome(this.save, slot);
        slot.cash = Math.min(income * ECONOMY.padCapSeconds, slot.cash + income * ticks);
      }
      if (gainXp(slot, realDt)) this.hud.toast(`${slot.name} can level up!`, 'good small');
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
    const pct = (track: 'finder' | 'magnet' | 'steering' | 'chute', extra = 0) =>
      `+${Math.round((s[track] + extra) * UPGRADES[track].effect * 100)}%`;
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
        default: {
          const what = { finder: 'Gems per pickup', magnet: 'Grab radius', steering: 'Turn speed', chute: 'Safe window' }[track];
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
      title: 'Showcase slots',
      level: `${s.pads.length}/${ECONOMY.maxPads}`,
      detail: pads === null ? 'Every slot is open' : `${s.pads.length} → ${s.pads.length + ECONOMY.padStep} slots`,
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
        ? `Start over with ×${next} income. You keep your rarest brainrot.`
        : `Unlocks at Cannon Lv ${REBIRTH.cannonLevel}. Resets coins, gems, upgrades, slots and backpack for ×${next} income.`,
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
      this.hud.toast(`${s.pads.length} slots open!`, 'gold');
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
    let keep: Owned | null = null;
    for (const o of [...s.pads, ...s.inventory]) if (o && (!keep || o.rarity > keep.rarity)) keep = o;
    s.rebirths += 1;
    s.coins = 0;
    s.gems = 0;
    s.cannon = 1;
    s.finder = s.magnet = s.steering = s.chute = 0;
    s.pads = Array.from({ length: ECONOMY.startPads }, () => null);
    s.inventory = [];
    if (keep) s.pads[0] = { name: keep.name, rarity: keep.rarity, cash: 0, level: 1, xp: 0 };
    this.base.sync(s);
    this.paintCannon();
    writeSave(s);
    this.hud.closeShop();
    this.hud.toast(`REBIRTH! ×${incomeMultiplier(s)} income`, 'gold big');
    platform.happytime();
    this.sfx.sparkle();
    this.fx.burst(Base.padPosition(0, this.tmp).setY(2), { count: 60, color: 0xffd84a, speed: 12, life: 1.2, size: 0.7, up: 6 });
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
      this.hud.toast('Empty slot: pull the gacha to fill it', 'small');
      return;
    }
    const level = slot.level ?? 1;
    const cost = levelCost(slot);
    const income = padIncome(s, slot);
    const card = this.hud.characterCard(slot.name, slot.rarity);
    const stats = document.createElement('p');
    stats.textContent = `Level ${level}/${LEVELS.max} · ${formatCoins(income)} coins/s`;
    const next = document.createElement('p');
    const need = xpNeeded(slot);
    const ready = levelReady(slot);
    next.textContent =
      cost === null || need === null
        ? 'Max level'
        : `XP ${Math.floor(slot.xp ?? 0)}/${need} s · next level ${formatCoins(padIncome(s, { ...slot, level: level + 1 }))} coins/s`;
    const levelLabel =
      cost === null
        ? 'Max level'
        : ready
          ? `Level up · ${formatCoins(cost)}`
          : `Needs XP · ${Math.ceil((need ?? 0) - (slot.xp ?? 0))} s`;
    const sell = sellValue(s, slot);
    this.hud.showModal(slot.name, [card, stats, next], [
      {
        label: levelLabel,
        primary: ready && cost !== null && s.coins >= cost,
        action: () => this.levelUp(i),
      },
      { label: 'Store in backpack', action: () => this.storePad(i) },
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
    if (!levelReady(slot)) {
      this.hud.toast(`${slot.name} needs more time on its pad`, 'small');
    } else if (s.coins < cost) {
      this.hud.toast(`Need ${formatCoins(cost - s.coins)} more coins`, 'bad small');
    } else {
      s.coins -= cost;
      slot.level = (slot.level ?? 1) + 1;
      slot.xp = 0;
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
      const cost = slot && levelReady(slot) ? levelCost(slot) : null;
      if (cost !== null && (best === null || cost < best)) best = cost;
    }
    return best;
  }

  // ---------------------------------------------------------------- return visits

  /** On load: offline earnings first, then the daily reward. */
  private welcome(): void {
    const away = offlineEarnings(this.save, Date.now());
    for (const slot of this.save.pads) if (slot) gainXp(slot, away.seconds);
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
      s.inventory.push({ name, rarity: reward.rarity });
      this.addToBook(name);
      this.hud.toast(`${RARITIES[reward.rarity].name}: ${name}! It's in your backpack`, '', RARITIES[reward.rarity].css);
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

  private updateGems(dt: number): void {
    for (const g of this.gems) {
      if (g.state === 'floating') {
        g.rig.gem.rotation.y = this.time * 2.5 + g.seed;
        g.rig.group.position.set(g.x, g.y + Math.sin(this.time * 2 + g.seed) * 0.2, 0);
      } else if (g.rig.group.visible) {
        // Collected: it zips into the player and shrinks away.
        g.t = Math.min(1, g.t + dt * 6);
        g.rig.group.position.lerp(this.tmp.set(this.px, this.py + BODY_MID, this.pz), g.t);
        g.rig.group.scale.setScalar((g.big ? GEM_SCALE.big : GEM_SCALE.small) * (1 - g.t));
        if (g.t >= 1) g.rig.group.visible = false;
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
    if (atBase && (this.walking || this.stepping)) body.position.y = 0.9 + Math.abs(Math.sin(this.time * 14)) * 0.08;
    body.visible = this.invuln <= 0 || Math.floor(this.time * 20) % 2 === 0;
    this.animateLimbs(dt, atBase);

    const chuteTarget = !inFlight ? 0 : this.chute === 'open' ? 1 : this.chute === 'tangled' ? 0.5 : 0;
    this.chuteScale = lerp(this.chuteScale, chuteTarget, damp(this.chuteScale < chuteTarget ? 14 : 6, realDt));
    this.player.chute.visible = this.chuteScale > 0.02;
    this.player.chute.scale.setScalar(this.chuteScale);
    this.player.chute.rotation.z =
      this.chute === 'tangled' ? Math.sin(this.time * 30) * 0.3 : Math.sin(this.time * 1.5) * 0.05;

    const free = this.state === 'home' && !this.walking && this.pulling <= 0 && !this.hud.modalOpen;
    this.hud.showAction(free ? this.actionLabel() : null);
    this.updateGuide();
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

    this.updateCamera(realDt);
    this.env.updateScenery(this.time, this.sky, this.scene.fog as THREE.Fog, this.camera.position);
    this.env.updateDecor(this.camera.position.y);
    this.streaks.update(this.py, inFlight ? this.vy : 0);
    this.sfx.wind(inFlight ? clamp(Math.abs(this.vy) / 50, 0, 1) * (this.chute === 'open' ? 0.3 : 1) : 0);

    const alt = this.state === 'aim' || this.state === 'charging' ? 0 : Math.max(0, this.py);
    this.hud.setAlt(!atBase && this.state !== 'reveal', alt, ZONES[zoneIndexAt(alt)].name, this.save.best);
    this.hud.setRunGems(inFlight || this.state === 'landed' || this.state === 'aim' || this.state === 'charging' ? this.runGems : null);
    this.hud.setWallet(this.save.coins, incomePerSecond(this.save), this.save.gems);
    this.hud.setBackpack(this.save.inventory.length);
    const canShop = this.state === 'home' || this.state === 'aim';
    const upgradeHint = this.wantsUpgradeHint() || this.wantsExpandHint();
    const launchHint =
      this.state === 'home' &&
      this.hasHint('collect') &&
      !upgradeHint &&
      !this.save.pads.some((slot) => slot !== null && slot.cash >= 1);
    this.hud.showBaseButtons(canShop, this.state === 'home', canShop && upgradeHint, launchHint, this.bookRewardWaiting());
  }

  /** The green arrows: one bobbing over the objective, one on the ground by the player pointing the way. */
  private updateGuide(): void {
    const { marker, ground } = this.guide;
    const target = this.state === 'home' && !this.hud.modalOpen && !this.hud.shopOpen ? this.guideTarget : null;
    marker.visible = !!target;
    ground.visible = false;
    if (!target) return;
    marker.position.set(target.x, target.y + 3 + Math.abs(Math.sin(this.time * 3.2)) * 0.6, target.z);
    marker.rotation.y = this.time * 1.6;
    const dx = target.x - this.px;
    const dz = target.z - this.pz;
    const d = Math.hypot(dx, dz);
    if (d < 2.5) return;
    ground.visible = true;
    const reach = 1.6 + Math.sin(this.time * 5) * 0.15;
    ground.position.set(this.px + (dx / d) * reach, 0.22, this.pz + (dz / d) * reach);
    ground.rotation.y = Math.atan2(-dx, -dz);
  }

  /**
   * Arm and leg poses for each state, eased so they blend: a walk cycle, Superman arms on the way up,
   * a flailing spread-eagle skydive with a wobble, and hanging from the straps under the parachute.
   */
  private animateLimbs(dt: number, atBase: boolean): void {
    const { arms, legs, body } = this.player;
    const t = this.time;
    const moving = atBase && (this.walking || this.stepping);
    // Stride speed follows ground speed, so easing in and out looks like stepping, not sliding.
    const pace = this.walking ? 1 : Math.min(1, this.walkVel.length() / WALK_SPEED);
    if (moving) this.walkPhase += dt * 11 * Math.max(0.4, pace);
    const freefall = this.state === 'fall' && this.chute === 'closed';
    let armOut = 0.25 + Math.sin(t * 2) * 0.04;
    let armSwing = 0;
    let legSwing = 0;
    let legSpread = 0;
    let flail = 0;
    let wobble = 0;
    if (moving) {
      armOut = 0.15;
      armSwing = Math.sin(this.walkPhase) * 0.7;
      legSwing = Math.sin(this.walkPhase) * 0.8;
    } else if (this.state === 'ascent') {
      armOut = 2.9;
      legSwing = 0.15;
    } else if (freefall) {
      armOut = 1.7;
      flail = 0.35;
      legSpread = 0.35;
      wobble = Math.sin(t * 3.3) * 0.3;
    } else if (this.state === 'fall') {
      armOut = 2.75;
      legSwing = Math.sin(t * 2) * 0.25;
    } else if (this.state === 'charging') {
      armOut = 0.05;
    } else if (this.state === 'landed' && this.chute !== 'open') {
      armOut = 1.5;
      legSpread = 0.4;
    }
    const k = damp(14, dt);
    arms.forEach((arm, i) => {
      const side = i === 0 ? -1 : 1;
      const flap = flail * Math.sin(t * 14 + i * Math.PI);
      arm.rotation.z = lerp(arm.rotation.z, side * (armOut + flap), k);
      // Arms swing opposite the leg on the same side.
      arm.rotation.x = lerp(arm.rotation.x, -side * armSwing, k);
    });
    legs.forEach((leg, i) => {
      const side = i === 0 ? -1 : 1;
      const kick = flail ? Math.sin(t * 11 + i * Math.PI) * 0.6 : 0;
      leg.rotation.x = lerp(leg.rotation.x, side * legSwing + kick, k);
      leg.rotation.z = lerp(leg.rotation.z, side * legSpread, k);
    });
    body.rotation.y = lerp(body.rotation.y, wobble, damp(6, dt));
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
        // Third person: behind and above the player, swinging round behind them as they walk forward.
        const moving = this.walking || this.stepping;
        // Only a tap-to-walk swings the camera round; with keys or the stick, the player owns it.
        if (moving && this.followCam) this.camYaw = lerpAngle(this.camYaw, this.facing, damp(1.5, realDt));
        const dist = 7.5 * (1 + portrait * 0.4);
        const sin = Math.sin(this.camYaw);
        const cos = Math.cos(this.camYaw);
        pos.set(this.px + sin * dist, 3.6, this.pz + cos * dist);
        look.set(this.px - sin * 3, 1.3, this.pz - cos * 3);
        rate = 6;
        break;
      }
    }

    const player = this.player3.set(this.px, this.py, this.pz);
    // Never let a bad frame leave the camera stuck on NaN.
    if (!Number.isFinite(this.camOff.lengthSq()) || !Number.isFinite(this.camLook.lengthSq())) {
      this.camOff.set(0, 3, 8);
      this.camLook.set(0, 1, 0);
    }
    if (!Number.isFinite(this.camera.fov)) this.camera.fov = 60;
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
    if (this.state === 'home' || this.state === 'boarding') fov = 58;
    fov += portrait * 6;
    this.camera.fov = lerp(this.camera.fov, fov, damp(4, realDt));
    this.camera.updateProjectionMatrix();
  }
}
