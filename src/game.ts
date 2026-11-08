// The game loop. A run goes dive into the shared cannon → aim → charge → launch → ascent → apex → fall →
// parachute → landing, then the player is free in town: gems from the sky buy pulls at the hub's gacha
// machines, brainrots on display in their plot earn coins, and coins buy upgrades at the shop stall. The
// flight is scripted rather than simulated, so the apex hits launchHeight() exactly.
import * as THREE from 'three';
import { Sfx } from './audio';
import { Base, FLOOR_H, PLATFORM_RADIUS, STAIR, bumpSolids, floorWorld, stairHeight, stairSide } from './base';
import { animateShared } from './characters';
import { Hub } from './hub';
import { brainrotIcon } from './icons';
import {
  CANNON_FOOT as FOOT,
  CAULDRON_FRONT,
  OWN_SLOT,
  PAD_RADIUS,
  PLOT_DEPTH,
  PLOT_HALF,
  REBIRTH_FRONT,
  SHOP_FRONT,
  SLOTS,
  fromPlot,
  laneFront,
  machineAt,
  plotAt,
  pullPad,
  toPlot,
  walkStep,
} from './layout';
import { CAPACITY, FakeServer, describePad } from './net';
import { RemoteView, makeBubble } from './remote';
import {
  CHARGE,
  CHUTE,
  CRASH_DROP,
  ECONOMY,
  FLIGHT,
  GACHA,
  GEMS,
  GIFTS,
  GIFT_COINS,
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
  countInBackpack,
  emptyPad,
  floorsOf,
  maxPads,
  putOnPad,
  rebirthCannonLevel,
  merge,
  mergeChosen,
  rebirthSave,
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
import { Particles, Sparks, Streaks } from './fx';
import { Hud, type PadButton, type RevealItem, type ShopItem, type ShopRow } from './hud';
import { Input } from './input';
import { BOOK_ZONES, DAILY, bookEntries, dailyCoins, dailyStatus, dayKey, offlineEarnings, zoneComplete } from './meta';
import { platform } from './platform';
import { clearSave, loadSave, writeSave, type Owned, type PadSlot, type Save } from './store';
import {
  BARREL_Y,
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
/** This client's plot. */
const OWN = SLOTS[OWN_SLOT];
/** Where returning players start: in the lane in front of their plot, looking at it. */
const HOME_SPOT = (() => {
  const [x, z] = laneFront(OWN);
  return new THREE.Vector3(x, 0, z);
})();
const HOME_YAW = (() => {
  const [x0, z0] = fromPlot(OWN, 0, 0);
  const [x1, z1] = fromPlot(OWN, 0, -1);
  return Math.atan2(-(x1 - x0), -(z1 - z0));
})();
/** Where players step up to the shared cannon, stand at the shop's counter, and use the cauldron. */
const CANNON_FOOT = new THREE.Vector3(FOOT.x, 0, FOOT.z);
const SHOP_SPOT = new THREE.Vector3(SHOP_FRONT.x, 0, SHOP_FRONT.z);
const CAULDRON_SPOT = new THREE.Vector3(CAULDRON_FRONT.x, 0, CAULDRON_FRONT.z);
/** Launching from further from the cannon than this teleports the player there. */
const TELEPORT_RANGE = 14;
/** Hazards only appear where the ascent is slower than this (m/s), so they can be dodged. */
const HAZARD_MAX_SPEED = 60;
/** Seconds of the comic dive into the cannon. */
const DIVE_TIME = 0.95;
/** How far the cannon swings either way while aiming (radians), and how long a swung shot keeps that line. */
const AIM_TILT = 0.3;
const AIM_HOLD = 0.9;
/** Distance from the barrel's pivot to where the player sits in it. */
const BARREL_REACH = 3;
const WALK_SPEED = 9;
/** Walking up within this distance of a slot's centre collects its coins (the pedestal itself is solid): walking
 * down a plot's aisle collects both lines. */
const COLLECT_RADIUS = 3.2;
/** How wide the player is, for bumping into things at the base. */
const PLAYER_RADIUS = 0.45;
/** Level-up buttons show for slots this close to the player. */
const BUTTON_RANGE = 11;
/** Radians the base camera turns per pixel dragged. */
const ORBIT_SPEED = 0.006;
/** How far the base camera can tilt down and up from its usual view (radians). Up is enough to watch flights. */
const PITCH_MIN = -0.35;
const PITCH_MAX = 1.16;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Frame-rate independent smoothing factor. */
const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
/** Eases angle a toward b the short way round. */
const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
/** The shield bubble: a faint cyan shell with up to five thin rings that orbit it, one per shield. */
function makeShieldBubble(): THREE.Group {
  const g = new THREE.Group();
  g.position.y = BODY_MID;
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(1.35, 32, 20),
    new THREE.MeshBasicMaterial({ color: 0x7fe8ff, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  g.add(shell);
  for (let i = 0; i < 5; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.42, 0.03, 6, 48),
      new THREE.MeshBasicMaterial({ color: 0xbff6ff, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    g.add(ring);
  }
  g.visible = false;
  return g;
}

/** A ball dropped on the floor: falls, then two smaller bounces. */
const bounceOut = (t: number) => {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};

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
  /** The shared hub: cauldron, shop, gacha machines, fountain. */
  private hub: Hub;
  /** The best height the hub shows (machine locks): only catches up at the base, so unlocks play out there. */
  private shownBest = 0;
  /** The (fake) multiplayer server, and the other players and plots drawn from it. */
  private server = new FakeServer();
  private remote: RemoteView;
  /** The other player's plot the local player is standing in, or null. */
  private visiting: number | null = null;
  private boardTimer = 0;
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
  /** When the game last advanced (frame or background tick), in performance.now() time. */
  private lastUpdate = 0;

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
  /** How far the base camera is tilted up from its usual view (radians; negative looks further down). */
  private camPitch = 0;
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
  /** The parachute opened in the bullseye window this flight: the run's gems get a bonus. */
  private bullseye = false;
  /** The last-moment parachute warning has flashed this fall. */
  private chuteWarned = false;
  private landing = '';
  private recordPassed = false;
  /** When this flight launched, for the tutorial's steering tip. */
  private launchT = 0;
  /** The highest zone this run has announced, so each one is celebrated once on the way up. */
  private zoneShown = 0;
  /** Gems picked up this run, and gems knocked loose by hazards or lost in a crash. */
  private runGems = 0;
  private gemsLost = 0;

  private gems: Gem[] = [];
  private birds: Bird[] = [];
  /** The tutorial's green arrows, and the place they point at (null hides them). */
  private guide: GuideRig;
  private guideTarget: THREE.Vector3 | null = null;
  private objTarget = new THREE.Vector3();
  /** Seconds left of the machine's spin before the pending pull's result shows. */
  private pulling = 0;
  private pendingPull: { got: Owned[]; index: number; isNew: boolean[] } | null = null;
  /** Cannon aim while in it (-1 left to 1 right), the barrel's swing chasing it on a spring, and its speed. */
  private aim = 0;
  private aimShown = 0;
  private aimVel = 0;
  /** After a swung shot: seconds the flight keeps leaning the swung way, and where it leans to. */
  private aimHold = 0;
  private aimTarget = 0;
  /** 1 as the cannon fires, easing to 0: the barrel kicks down and springs back. */
  private recoil = 0;
  /** Seconds into the dive into the cannon, or -1. */
  private dive = -1;
  /** Where the dive started (it can start from any side of the cannon). */
  private diveFrom = new THREE.Vector3(0, 0, 2.6);
  /** 1 as the cannon swallows the player, easing to 0: the barrel bulges. */
  private gulp = 0;
  /** Pop-in after a teleport, and the pop out of the muzzle, easing from their start to 0. */
  private appear = 0;
  private popOut = 0;
  /** The helmet dropping onto the player's head (seconds left), and whether it has clonked yet. */
  private helmetDrop = 0;
  private clonked = false;
  /** The camera jumps straight to its place for one frame (after a teleport). */
  private camSnap = false;
  /** When the parachute alarm last beeped. */
  private beepAt = 0;
  /** The player's speech bubble, and how long it stays up. */
  private bubble = makeBubble();
  private bubbleT = 0;
  private screen = new THREE.Vector3();
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
  /** Seconds toward the next once-a-second income tick. */
  private incomeTimer = 0;
  /** Rebirth needs a second tap in the shop. */
  /** Which floor of the base the player is on (0 is the ground), and the flight of stairs they're on (or -1). */
  private level = 0;
  private stair = -1;
  /** Jumping at the base: height, upward speed, and the squash on landing (1 easing to 0). */
  private jumpY = 0;
  private jumpV = 0;
  private landSquash = 0;
  /** Fireworks: their own big particle pool, and the rockets in the air. */
  private sparks!: Sparks;
  private rockets: { pos: THREE.Vector3; vel: THREE.Vector3; fuse: number; color: number; loud: number }[] = [];
  /** Shields left this flight, and the bubble's flare after a block (1 easing to 0). */
  private shields = 0;
  private shieldFlash = 0;
  private shieldBubble!: THREE.Group;
  /** Brainrots picked in the merge station. */
  private mergePick: Owned[] = [];

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
    this.base = new Base(this.scene, OWN);
    this.hub = new Hub(this.scene);
    this.hub.onUnlock = (i) => this.onMachineUnlock(i);
    // Capsules bouncing nearby click on the floor (anyone's).
    this.hub.onBounce = (at, strength) => {
      const near = 1 - Math.hypot(at.x - this.px, at.z - this.pz) / 18;
      if (near > 0 && (this.state === 'home' || this.state === 'boarding')) this.sfx.bounce(strength * near);
    };
    this.shownBest = this.save.bestSinceRebirth;
    this.remote = new RemoteView(this.scene, this.server);
    this.player = makePlayer();
    this.player.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    this.scene.add(this.player.group);
    this.player.group.add(this.bubble.sprite);
    this.shieldBubble = makeShieldBubble();
    this.player.group.add(this.shieldBubble);
    this.fx = new Particles(this.scene);
    this.sparks = new Sparks(this.scene);
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
    // Browsers stop animation frames for a window that's hidden or behind another one, so a plain timer keeps
    // the game running then (bots, income, flights); browsers slow timers too, so each tick catches up the
    // time since the last update.
    setInterval(() => {
      const now = performance.now();
      if (now - this.lastUpdate > 250) this.catchUp(now);
    }, 250);
  }

  /**
   * Runs the game forward to `now`: up to 20 seconds in normal small steps (so flights, bots and the economy
   * play out as usual), and any longer gap as income only.
   */
  private catchUp(now: number): void {
    const gap = this.lastUpdate ? (now - this.lastUpdate) / 1000 : 0;
    this.lastUpdate = now;
    if (this.debugPaused || gap <= 0) return;
    let steps = Math.min(gap, 20);
    while (steps > 0) {
      const dt = Math.min(0.05, steps);
      this.update(dt);
      steps -= dt;
    }
    if (gap > 20) this.updateEconomy(gap - 20);
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
    // Back from a pause (another window, a background tab): catch up first; otherwise one normal step.
    if (this.lastUpdate && now - this.lastUpdate > 250) this.catchUp(now);
    else {
      this.lastUpdate = now;
      if (!this.debugPaused) this.update(dt);
    }
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
    onClick(hud.upgradesBtn, () => this.goShop());
    onClick(hud.exitBtn, () => this.exitCannon());
    onClick(hud.launchBtn, () => {
      if (this.state === 'home') this.startBoarding();
    });
    onClick(hud.giftBtn, () => this.claimGift());
    onClick(hud.bookBtn, () => this.openBook());
    onClick(hud.backpackBtn, () => this.openBackpack());
    hud.iconFor = brainrotIcon;
    hud.onBuy = (item) => this.buy(item);
    hud.onAction = () => this.useHere();
    hud.onPadButton = (i) => (i >= this.save.pads.length ? this.expandBase() : this.levelUp(i));
    hud.onChat = (text) => this.sayLocal(text);
    window.addEventListener('keydown', (e) => {
      // Typing in the chat or the tuning panel isn't a shortcut.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Enter' && !hud.modalOpen && !hud.shopOpen) {
        e.preventDefault();
        hud.openChat();
        return;
      }
      if (e.code === 'KeyT') hud.tunePanel.classList.toggle('hidden');
      const atBase = !hud.modalOpen && (this.state === 'home' || this.state === 'aim');
      if (e.code === 'KeyB' && atBase) this.openBackpack();
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

  /** The player says something: into the feed, in a bubble over their head, and to everyone on the server. */
  private sayLocal(text: string): void {
    this.server.localChat(text);
    this.bubble.draw(text);
    this.bubbleT = 5;
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
        this.updateAim(dt);
        // Q (or the Exit button) climbs back out.
        if (!blocked && this.input.consumeKey('KeyQ')) {
          this.exitCannon();
          break;
        }
        if (pressed) this.startCharge();
        break;
      case 'charging':
        this.updateAim(dt);
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
        if (this.dive >= 0) {
          this.updateDive(dt);
        } else {
          this.updateWalk(dt);
          if (this.state === 'boarding') this.py = lerp(this.py, this.floorHere(), damp(20, dt));
        }
        break;
    }
    // Machine locks catch up with the player's best only at the base, so an unlock plays out in front of them.
    if (this.state === 'home' || this.state === 'aim' || this.state === 'boarding') this.shownBest = this.save.bestSinceRebirth;
    this.server.setCannonBusy(this.state === 'aim' || this.state === 'charging' || this.dive >= 0);

    // Camera drags only mean something at the base; drop any made during a run.
    if (this.state !== 'home') {
      this.input.consumeOrbitDx();
      this.input.consumeOrbitDy();
    }
    this.hud.showStick(this.state === 'home' && !blocked ? this.input.stick : null);
    this.updateEconomy(realDt);
    this.updateGems(dt);
    this.updateBirds(dt);
    this.base.update(this.save, this.time, realDt);
    this.hub.update(this.time, realDt, this.shownBest, this.save.gems, this.px, this.pz);
    {
      const s = this.save;
      const need = rebirthCannonLevel(s);
      const ready = s.cannon >= need;
      const { mult, floor } = this.rebirthPrize();
      this.hub.setRebirth(
        ready,
        ready ? `×${mult} income${floor ? ` + Floor ${floor}` : ''}` : `Cannon Lv ${s.cannon}/${need}`,
        s.cannon / need,
      );
    }
    this.updateServer(realDt);
    this.fx.update(dt);
    this.updateFireworks(realDt);
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
    this.chuteWarned = false;
    this.bullseye = false;
    this.landing = '';
    this.recordPassed = false;
    this.zoneShown = 0;
    this.runGems = 0;
    this.gemsLost = 0;
    this.input.consumeTouchDx();
    this.lane = FLIGHT.lane * clamp(this.camera.aspect, 0.55, 1);
    // The flight sets off the way the cannon was swung, as if steered there, then the player's own steering
    // takes over: a cannon aimed left feels like the mouse started on the left.
    const swing = this.aimShown;
    this.vx = swing * FLIGHT.steerSpeed * 0.8;
    this.shields = this.save.shield;
    this.aimTarget = swing * this.lane * 0.75;
    this.aimHold = Math.abs(swing) > 0.05 ? AIM_HOLD : 0;
    this.targetX = this.aimHold > 0 ? this.aimTarget : this.px;
    this.aim = 0;
    this.recoil = 1;
    this.recordLabel.sprite.position.x = this.lane - 1;
    this.spawnRun(apex, v0, tUp);
    this.state = 'ascent';
    this.launchT = this.time;

    this.hud.showCharge(null);
    this.hud.setFlight(this.save.flightNo);
    this.recordLine.visible = this.save.best > 1;
    this.recordLine.position.y = this.save.best;
    this.recordLabel.set(`BEST ${Math.round(this.save.best)} m`);

    const muzzle = this.tmp.set(this.px, MUZZLE_Y + 1.2, 0);
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
      // At high cannon levels the first stretch flashes by too fast to dodge anything, so hazards only start
      // where the ascent has slowed to a dodgeable speed.
      const dodgeable = MUZZLE_Y + Math.max(0, (v0 * v0 - HAZARD_MAX_SPEED * HAZARD_MAX_SPEED) / (2 * this.gUp));
      let count = 0;
      for (let y = Math.max(h.start, floor, dodgeable); y < apex - 3 && count < h.maxPerFlight; count++) {
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
      // A parachute opened high comes down fast (it would take ages otherwise), slowing to a gentle drift
      // for the last stretch.
      const drift = FLIGHT.chuteSpeed + Math.max(0, this.py - 14) * 0.8;
      const target = this.chute === 'open' ? -Math.min(drift, Math.max(FLIGHT.chuteSpeed, this.vTerminal * 0.85)) : -this.vTerminal * 0.55;
      this.vy += (target - this.vy) * damp(FLIGHT.chuteDecel, dt);
    }
    this.py += this.vy * dt;
    this.steer(dt);

    if (this.state === 'fall' && chuteRequested && this.chute === 'closed') this.openChute();
    this.collide();

    if (this.state === 'ascent') this.announceZone();
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

  /**
   * Entering a new zone on the way up: its name and gem value, bigger (with a sparkle and a moment of slow
   * motion) the first time the player has ever reached it.
   */
  private announceZone(): void {
    const zone = Math.min(zoneIndexAt(this.py), MAX_ZONE);
    if (zone <= this.zoneShown) return;
    this.zoneShown = zone;
    const first = this.save.best < ZONES[zone].from;
    const z = ZONES[zone];
    const css = `#${z.gemColor.toString(16).padStart(6, '0')}`;
    this.hud.toast(first ? `NEW ZONE: ${z.name.toUpperCase()}!` : z.name.toUpperCase(), first ? 'big' : '', css);
    this.hud.toast(`Gems worth ×${z.gems}`, 'small', css);
    if (first) {
      this.slowmo = Math.max(this.slowmo, 0.5);
      this.sfx.zone();
      this.sfx.sparkle();
      this.server.reportLocal({ kind: 'zone', text: `reached ${z.name}!` });
    } else {
      this.sfx.ding();
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
      if (this.aimHold > 0) {
        // Leaning the way the cannon was swung, fading into the player's own steering.
        const k = this.aimHold / AIM_HOLD;
        this.targetX = lerp(this.targetX, this.aimTarget, k * k);
        this.aimHold = Math.max(0, this.aimHold - dt);
      }
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
    if (this.shields > 0) {
      // A shield takes the hit: the bubble flares and pops, the hazard bounces off, nothing is lost.
      this.shields -= 1;
      this.shieldFlash = 1;
      this.invuln = 0.6;
      this.shake = Math.max(this.shake, 0.25);
      this.fx.burst(this.tmp.set(this.px, this.py + BODY_MID, 0), { count: 26, color: 0x7fe8ff, speed: 9, life: 0.6, size: 0.5 });
      this.sfx.shieldBlock();
      this.hud.toast(this.shields ? `BLOCKED! ${this.shields} shield${this.shields > 1 ? 's' : ''} left` : 'BLOCKED! Last shield gone', 'good small');
      return;
    }
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
    this.save.bestSinceRebirth = Math.max(this.save.bestSinceRebirth, this.apex);
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
    const bullLo = late + CHUTE.bullseyeAt - CHUTE.bullseyeWidth / 2;
    this.hud.showGround(
      clamp(tau / CHUTE.barSeconds, 0, 1),
      late / CHUTE.barSeconds,
      (late + CHUTE.perfectSpan) / CHUTE.barSeconds,
      [bullLo / CHUTE.barSeconds, (bullLo + CHUTE.bullseyeWidth) / CHUTE.barSeconds],
      this.py,
      CHUTE.bullseyeBonus,
    );
    const urgent = tau < 3.2;
    this.hud.showChute(true, urgent);
    // From a little before the gold zone: the alarm. The screen's edges pulse red, the button bounces, a hand
    // taps it, and it beeps until the parachute opens.
    if (tau < this.chuteWarnAt()) {
      if (!this.chuteWarned) {
        this.chuteWarned = true;
        this.hud.toast('OPEN PARACHUTE!', 'bad big flash', undefined, 1500);
        this.hud.chuteAlarm(true);
      }
      if (this.time - this.beepAt > 0.32) {
        this.beepAt = this.time;
        this.sfx.alarm();
      }
    }
    if (urgent && this.save.flightNo <= TUTORIAL.wideChuteFlights) {
      this.hud.prompt(this.input.isTouch ? 'Tap PARACHUTE!' : 'Press Space or click to open your parachute!', true);
    }
  }

  /** Seconds to impact when the parachute alarm starts: comfortably before the gold zone. */
  private chuteWarnAt(): number {
    return this.chuteLate() + CHUTE.perfectSpan + 0.9;
  }

  private openChute(): void {
    const tau = this.secondsToImpact();
    const late = this.chuteLate();
    this.sfx.chute();
    this.hud.chuteAlarm(false);
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
    const lo = late + CHUTE.bullseyeAt - CHUTE.bullseyeWidth / 2;
    const bullseye = tau >= lo && tau <= lo + CHUTE.bullseyeWidth;
    this.bullseye = bullseye;
    this.landing = bullseye ? 'Bullseye landing' : perfect ? 'Perfect landing' : 'Safe landing';
    if (bullseye) {
      this.hud.toast(`BULLSEYE! ×${CHUTE.bullseyeBonus} GEMS`, 'gold big');
      this.sfx.sparkle();
      this.slowmo = Math.max(this.slowmo, 0.4);
      this.fx.burst(this.tmp.set(this.px, this.py + 2, this.pz), { count: 40, color: 0xffd84a, speed: 10, life: 0.9, size: 0.6 });
    } else if (perfect) {
      this.hud.toast('PERFECT TIMING!', 'gold');
    }
  }

  // ---------------------------------------------------------------- landing

  private land(): void {
    this.vx = 0;
    this.vy = 0;
    this.hud.chuteAlarm(false);
    this.hud.showChute(false);
    this.hud.showGround(null);
    this.hud.prompt('');
    const at = this.tmp.set(this.px, 0.3, this.pz);

    if (this.chute === 'open') {
      this.state = 'landed';
      this.landedT = 0.5;
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
    this.landedT = 1.5;
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

  /** The run's gems go into the wallet with a toast, and the player heads straight home: no result window. */
  private showReveal(): void {
    if (this.bullseye) {
      this.runGems = Math.round(this.runGems * CHUTE.bullseyeBonus);
      this.bullseye = false;
    }
    this.save.gems += this.runGems;
    writeSave(this.save);
    if (this.runGems > 0) {
      this.hud.toast(`+${formatCoins(this.runGems)} gems`, 'gold big');
      this.sfx.coin();
    } else {
      this.hud.toast('No gems this run', 'small');
    }
    this.goHome();
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

  /** After a run the player stays where they landed, in control, with the camera behind them. */
  private goHome(): void {
    this.clearRun();
    this.hud.hideReveal();
    this.hud.chuteAlarm(false);
    writeSave(this.save);
    this.state = 'home';
    this.walking = false;
    this.walkVel.set(0, 0);
    this.camYaw = 0;
    this.facing = 0;
  }

  /** A machine the player is standing on a pull pad of, and which pad (×1 or ×10), or null. */
  private pullPadUnder(): { index: number; ten: boolean } | null {
    for (let i = 0; i < GACHA.length; i++) {
      for (const ten of [false, true]) {
        const p = pullPad(i, ten);
        if (Math.hypot(p.x - this.px, p.z - this.pz) < PAD_RADIUS + 0.15) return { index: i, ten };
      }
    }
    return null;
  }

  /** A machine unlocking in front of the player: the padlock bursts off, with a chime and confetti. */
  private onMachineUnlock(i: number): void {
    const tier = GACHA[i];
    const at = machineAt(i);
    this.sfx.unlockChime();
    this.hud.toast(`${tier.short} MACHINE UNLOCKED!`, 'gold big');
    this.after(0.45, () =>
      this.fx.burst(new THREE.Vector3(at.x + 1.6, 3.2, at.z), { count: 60, color: 0xffd84a, speed: 12, life: 1.2, size: 0.6, up: 6 }),
    );
  }

  /**
   * Pulls machine `index` `count` times, from its ×1 or ×10 pad: spends the gems, spins the machine, and shows
   * the cards once it stops. No panel: the machine itself is the interface.
   */
  private pullMachine(index: number, count: number): void {
    const s = this.save;
    const tier = GACHA[index];
    if (!tierUnlocked(s, tier)) {
      this.hud.toast(`Fly to ${tier.unlockBest} m to unlock ${tier.short}`, 'small');
      this.hub.refuse(index);
      this.sfx.full();
      return;
    }
    const cost = tier.cost * count;
    if (s.gems < cost) {
      this.hud.toast(`Need ${formatCoins(cost - s.gems)} more gems`, 'bad small');
      this.hub.refuse(index);
      this.sfx.full();
      return;
    }
    const got: Owned[] = [];
    for (let i = 0; i < count; i++) {
      const one = pull(s, tier);
      if (!one) break;
      got.push(one);
    }
    const isNew = got.map((o) => this.addToBook(o.name));
    this.completeHint('pull');
    this.completeHint(`tier-${tier.id}`);
    this.autoDisplay();
    writeSave(s);
    // The machine spins with a soft ratchet, spits out a capsule in the best result's colour (glowing for an
    // Epic or better), and the big sound comes when the capsule pops open.
    const best = got.reduce((a, b) => (b.rarity > a.rarity ? b : a));
    this.pulling = this.hub.spin(index, count, RARITIES[best.rarity].color, best.rarity >= 3);
    this.sfx.crank(this.pulling * 0.5);
    this.pendingPull = { got, index, isNew };
  }

  private showPullResult(): void {
    const pending = this.pendingPull;
    this.pendingPull = null;
    if (!pending) return;
    const best = pending.got.reduce((a, b) => (b.rarity > a.rarity ? b : a));
    this.fx.burst(this.hub.machineExit(pending.index, this.tmp), {
      count: 20 + best.rarity * 12,
      color: RARITIES[best.rarity].color,
      speed: 8 + best.rarity,
      life: 0.9,
      size: 0.6,
      up: 5,
    });
    this.sfx.capsule();
    if (best.rarity >= 4) platform.happytime();
    if (best.rarity >= 3) {
      const r = RARITIES[best.rarity];
      this.server.reportLocal({ kind: 'pull', text: `pulled ${r.name === 'Epic' ? 'an' : 'a'} ${r.name.toUpperCase()} ${best.name}!`, rarity: best.rarity });
    }
    // Flip the cards, then straight back to the machine: still on the pad, pulling again is one more press.
    const title = pending.got.length > 1 ? `Tap the cards to flip them!` : 'Tap the card to flip it!';
    this.hud.revealCards(
      this.revealItems(pending.got, pending.isNew),
      title,
      (item) => this.onCardFlip(item),
      () => {},
      () => this.sfx.suspense(),
    );
  }

  /** Cards for the flip reveal, noting where each brainrot went. */
  private revealItems(got: Owned[], isNew: boolean[]): RevealItem[] {
    return got.map((o, i) => ({
      name: o.name,
      rarity: o.rarity,
      isNew: isNew[i],
      note: this.save.pads.some((slot) => slot?.name === o.name) ? 'On display' : 'In backpack',
      income: `+${formatCoins(padIncome(this.save, { rarity: o.rarity }))}/s`,
    }));
  }

  /**
   * Each flip pops; Rare and better get a fanfare (grander the rarer), call out their rarity and sing their
   * name; Epic and better shake the screen too.
   */
  private onCardFlip(item: RevealItem): void {
    this.sfx.flip();
    this.sfx.pop(item.rarity);
    if (item.rarity >= RARE) {
      this.sfx.fanfare(item.rarity);
      this.after(item.rarity >= 4 ? 0.7 : 0.35, () => this.sfx.chant(item.name, item.rarity));
      this.hud.toast(`${RARITIES[item.rarity].name.toUpperCase()}!`, item.rarity >= 4 ? 'big grand' : 'big', RARITIES[item.rarity].css);
    }
    if (item.rarity >= 3) this.shake = Math.max(this.shake, item.rarity >= 5 ? 1.2 : item.rarity >= 4 ? 0.8 : 0.4);
  }

  /** Runs something a little later (real time). */
  private after(seconds: number, run: () => void): void {
    setTimeout(run, seconds * 1000);
  }

  /**
   * Fills empty slots from the backpack, best first, and swaps a rarer backpack brainrot in for a level-1
   * one on display (which goes to the backpack, its coins collected). Nothing levelled is ever moved.
   */
  private autoDisplay(): void {
    const s = this.save;
    let placed = 0;
    for (;;) {
      let k = -1;
      s.inventory.forEach((o, i) => {
        if (k < 0 || o.rarity > s.inventory[k].rarity) k = i;
      });
      if (k < 0) break;
      const cand = s.inventory[k];
      let pad = s.pads.findIndex((slot) => slot === null);
      if (pad < 0) {
        s.pads.forEach((slot, i) => {
          if (!slot || slot.rarity >= cand.rarity) return;
          if (pad < 0 || slot.rarity < s.pads[pad]!.rarity) pad = i;
        });
        if (pad < 0) break;
        const old = s.pads[pad]!;
        s.coins += Math.floor(old.cash);
        s.inventory.push({ name: old.name, rarity: old.rarity });
      }
      s.inventory.splice(k, 1);
      // The slot keeps its level: the new brainrot earns at it straight away.
      putOnPad(s, pad, cand);
      this.fx.burst(this.padAt(pad, this.tmp).setY(1.2), {
        count: 16,
        color: RARITIES[cand.rarity].color,
        speed: 6,
        life: 0.8,
        size: 0.6,
        up: 4,
      });
      placed++;
    }
    if (placed) {
      this.base.sync(s);
      this.completeHint('place');
    }
  }

  /**
   * The merge station. Pick which brainrots to merge (tap a card to add one of it, again to add another; once all
   * of it are picked, a tap clears it), or let Auto merge do everything it can from the bottom up. Each rarity
   * shows its recipe and a quick Pick button.
   */
  private openMerger(): void {
    const s = this.save;
    this.sfx.open();
    // Drop picks that are no longer in the backpack.
    this.mergePick = this.mergePick.filter((o) => s.inventory.includes(o));
    const body: HTMLElement[] = [];
    const rules = document.createElement('p');
    rules.className = 'sub';
    rules.textContent = 'Tap brainrots to pick them, then Merge picked, or Auto merge everything. Merged ones go on display if they beat what is there.';
    body.push(rules);
    const picked = this.mergePick;
    const pickRarity = picked.length ? picked[0].rarity : null;
    const pickNeed = pickRarity === null ? null : mergeNeed(pickRarity);
    const status = document.createElement('div');
    status.className = 'merge-status';
    if (pickRarity === null || pickNeed === null) status.textContent = 'Nothing picked yet';
    else {
      status.style.setProperty('--c', RARITIES[pickRarity].css);
      status.textContent = `Picked ${picked.length}/${pickNeed} ${RARITIES[pickRarity].name} → 1 ${RARITIES[pickRarity + 1].name}`;
    }
    body.push(status);
    let any = false;
    for (let r = 0; r < RARITIES.length; r++) {
      const need = mergeNeed(r);
      const items = s.inventory.filter((o) => o.rarity === r);
      if (need === null || !items.length) continue;
      any ||= items.length >= need;
      const section = document.createElement('div');
      section.className = 'merge-section';
      section.style.setProperty('--c', RARITIES[r].css);
      const head = document.createElement('div');
      head.className = 'merge-head';
      const title = document.createElement('span');
      title.textContent = `${RARITIES[r].name} · ${items.length} (${need} → 1 ${RARITIES[r + 1].name})`;
      const quick = document.createElement('button');
      quick.type = 'button';
      quick.textContent = `Pick ${need}`;
      quick.disabled = items.length < need;
      quick.addEventListener('click', () => {
        this.mergePick = items.slice(0, need);
        this.sfx.click();
        this.openMerger();
      });
      head.append(title, quick);
      const row = document.createElement('div');
      row.className = 'merge-cards';
      // One card per character, with how many you have and how many are picked.
      const byName = new Map<string, Owned[]>();
      for (const o of items) byName.set(o.name, [...(byName.get(o.name) ?? []), o]);
      for (const [name, group] of byName) {
        const card = this.hud.characterCard(name, r);
        card.classList.add('merge-card');
        const chosen = group.filter((o) => picked.includes(o)).length;
        if (chosen) card.classList.add('picked');
        const have = document.createElement('span');
        have.className = 'count';
        have.textContent = chosen ? `${chosen}/${group.length}` : `×${group.length}`;
        card.append(have);
        card.addEventListener('click', () => {
          // Picks are one rarity at a time.
          if (pickRarity !== null && pickRarity !== r) this.mergePick = [];
          const free = group.filter((o) => !this.mergePick.includes(o));
          if (free.length) this.mergePick.push(free[0]);
          else this.mergePick = this.mergePick.filter((o) => !group.includes(o));
          this.sfx.click();
          this.openMerger();
        });
        row.append(card);
      }
      section.append(head, row);
      body.push(section);
    }
    if (body.length === 2) {
      const empty = document.createElement('p');
      empty.textContent = 'Your backpack has nothing to merge. Pulls that are not on display land there.';
      body.push(empty);
    }
    const ready = pickNeed !== null && picked.length >= pickNeed;
    const times = ready ? Math.floor(picked.length / pickNeed!) : 0;
    this.hud.showModal('Merge station', body, [
      { label: times > 1 ? `Merge picked ×${times}` : 'Merge picked', primary: ready, action: () => (ready ? this.mergePicked() : this.openMerger()) },
      { label: 'Auto merge', primary: !ready && any, action: () => this.mergeAll(null) },
      { label: 'Close' },
    ]);
  }

  /** Merges the picked brainrots, in as many full groups as were picked. */
  private mergePicked(): void {
    const s = this.save;
    const picked = this.mergePick.filter((o) => s.inventory.includes(o));
    this.mergePick = [];
    const need = picked.length ? mergeNeed(picked[0].rarity) : null;
    const got: Owned[] = [];
    if (need !== null) {
      for (let i = 0; i + need <= picked.length; i += need) {
        const one = mergeChosen(s, picked.slice(i, i + need));
        if (one) got.push(one);
      }
    }
    this.finishMerge(got);
  }

  /** Auto merge: one rarity, or everything possible from the bottom up when `only` is null. */
  private mergeAll(only: number | null): void {
    const s = this.save;
    this.mergePick = [];
    const got: Owned[] = [];
    for (let r = 0; r < RARITIES.length; r++) {
      if (only !== null && r !== only) continue;
      let one = merge(s, r);
      while (one) {
        got.push(one);
        one = only === null ? merge(s, r) : null;
      }
    }
    this.finishMerge(got);
  }

  /** After a merge: the cauldron bubbles over, the results burst out and are revealed, then back to the station. */
  private finishMerge(got: Owned[]): void {
    const s = this.save;
    if (!got.length) {
      this.hud.toast('Not enough to merge yet', 'small');
      this.openMerger();
      return;
    }
    // Merging up the chain can use up earlier results; only show what is still owned.
    const owned = got.filter((o) => s.inventory.includes(o));
    const isNew = owned.map((o) => this.addToBook(o.name));
    this.completeHint('merge');
    this.autoDisplay();
    writeSave(s);
    this.hub.stir();
    const best = owned.reduce((a, b) => (b.rarity > a.rarity ? b : a), owned[0]);
    if (best) {
      this.fx.burst(this.hub.mergerExit(this.tmp), {
        count: 24 + best.rarity * 10,
        color: RARITIES[best.rarity].color,
        speed: 8,
        life: 0.9,
        size: 0.6,
        up: 5,
      });
      if (best.rarity >= 4) platform.happytime();
    }
    this.sfx.brew();
    this.hud.revealCards(
      this.revealItems(owned, isNew),
      'Merged! Tap to flip',
      (item) => this.onCardFlip(item),
      () => this.openMerger(),
      () => this.sfx.suspense(),
    );
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
      text.textContent = 'Your backpack is empty. Pull a gacha machine in the hub to get brainrots.';
      this.hud.showModal('Backpack', [text], [{ label: 'Close' }]);
      return;
    }
    const target = slot ?? s.pads.findIndex((p) => p === null);
    const rules = document.createElement('p');
    rules.className = 'sub';
    rules.textContent = 'Merge: 10 Common → 1 Uncommon · 8 Uncommon → 1 Rare · 6 Rare → 1 Epic · 4 Epic → 1 Legendary · 3 Legendary → 1 Mythic';
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
          button(`Merge ${need} → ${RARITIES[r + 1].name}`, () => this.mergeAll(r), items.length < need),
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
    putOnPad(s, pad, got);
    this.base.sync(s);
    this.hud.closeModal();
    this.fx.burst(this.padAt(pad, this.tmp).setY(1.2), {
      count: 20,
      color: RARITIES[got.rarity].color,
      speed: 6,
      life: 0.8,
      size: 0.6,
      up: 4,
    });
    this.sfx.pop(got.rarity);
    this.sfx.chant(got.name, got.rarity);
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

  /** Moves a slot's brainrot into the backpack, collecting its coins first. The slot keeps its level. */
  private storePad(i: number): void {
    const s = this.save;
    const slot = s.pads[i];
    if (!slot) return;
    this.collect(i);
    s.inventory.push({ name: slot.name, rarity: slot.rarity });
    emptyPad(s, i);
    this.base.sync(s);
    this.hud.toast(`${slot.name} is in your backpack${(slot.level ?? 1) > 1 ? ` (the slot stays Lv ${slot.level})` : ''}`, 'small');
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
      const then = this.arrive;
      this.arrive = null;
      // A walk with more waypoints goes on; the last stop of a boarding walk is the cannon.
      if (then) then();
      else if (this.state === 'boarding') this.boardCannon();
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
    // Step up onto platforms and the showcase floor.
    this.py = lerp(this.py, this.floorHere(), damp(20, dt));
    // Space jumps.
    this.updateJump(dt, space);
    this.save.pads.forEach((slot, i) => {
      if (!slot || slot.cash < 1 || Base.padFloor(i) !== this.level) return;
      const pad = this.padAt(i, this.tmp);
      if (Math.hypot(pad.x - this.px, pad.z - this.pz) < COLLECT_RADIUS) this.collect(i);
    });
    // F (or the Launch button) heads for the cannon.
    if (!blocked && this.input.consumeKey('KeyF')) {
      this.startBoarding();
      return;
    }
    this.updateVisit();
    this.updateHomePrompt();
  }

  /** A hop: a quick squash-free take-off, stretched in the air, squashed on landing. */
  private updateJump(dt: number, jump: boolean): void {
    if (jump && this.jumpY === 0 && this.jumpV === 0) {
      this.jumpV = 9.5;
      this.sfx.hop();
    }
    if (this.jumpV === 0 && this.jumpY === 0) return;
    this.jumpY += this.jumpV * dt;
    this.jumpV -= 30 * dt;
    if (this.jumpY <= 0) {
      this.jumpY = 0;
      this.jumpV = 0;
      this.landSquash = 1;
      this.sfx.step();
    }
  }

  /**
   * Walking the base's stairs. On a flight the player stays on its treads and climbs or descends with depth;
   * stepping off the top landing (or a higher flight's bottom landing) onto a deck puts them on that floor, and
   * off the ground flight's bottom onto the ground. On a deck, the railing holds except at its gaps, where a
   * landing waits. On the ground, the climbing part of the first flight is solid.
   */
  private walkStairs(): void {
    const floors = this.base.floors;
    let [lx, lz] = toPlot(OWN, this.px, this.pz);
    const S = STAIR;
    const onFlight = (k: number) => {
      const a = stairSide(k) * lx;
      return a > S.inner - 0.05 && a < S.outer + 0.3 && lz < S.z0 + S.landing && lz > S.z1 - S.landing;
    };
    if (this.stair >= 0) {
      const k = this.stair;
      const side = stairSide(k);
      const a = side * lx;
      const atTop = lz < S.z1;
      const atBottom = lz > S.z0;
      if (a < S.inner + 0.25 && atTop) {
        this.level = k + 1;
        this.stair = -1;
      } else if (a < S.inner + 0.25 && atBottom) {
        this.level = k;
        this.stair = -1;
      } else if (k === 0 && lz > S.z0 + S.landing - 0.3) {
        this.level = 0;
        this.stair = -1;
      } else {
        // Held on the treads between the handrail and the plot's edge.
        lx = side * clamp(a, S.inner + 0.2, S.outer - 0.35);
        lz = clamp(lz, S.z1 - S.landing + 0.35, k === 0 ? S.z0 + S.landing : S.z0 + S.landing - 0.35);
        [this.px, this.pz] = fromPlot(OWN, lx, lz);
      }
      return;
    }
    // Stepping onto a flight: at its bottom from the floor it leaves, or at its top from the deck it reaches.
    for (let k = 0; k < floors - 1; k++) {
      if (!onFlight(k)) continue;
      if ((this.level === k && lz > S.z0) || (this.level === k + 1 && lz < S.z1)) {
        this.stair = k;
        return;
      }
    }
    if (this.level > 0) {
      // On a deck: the railing holds, except at the gaps where a flight's landing meets it.
      const gapAt = (k: number, top: boolean) =>
        k >= 0 && k < floors - 1 && Math.sign(lx) === stairSide(k) && (top ? lz < S.z1 && lz > S.z1 - S.landing : lz > S.z0 && lz < S.z0 + S.landing);
      const open = gapAt(this.level - 1, true) || gapAt(this.level, false);
      const edge = open ? S.outer : PLOT_HALF - 0.6;
      [this.px, this.pz] = fromPlot(OWN, clamp(lx, -edge, edge), clamp(lz, -PLOT_DEPTH + 0.6, -0.6));
    } else if (floors > 1 && stairSide(0) * lx > S.inner - 0.45 && stairSide(0) * lx < S.outer + 0.45 && lz < S.z0 && lz > S.z1 - S.landing) {
      // On the ground, the first flight's climbing part is solid: step back out to the nearer side.
      const a = stairSide(0) * lx;
      const out = a - (S.inner - 0.45) < S.outer + 0.45 - a ? S.inner - 0.45 : S.outer + 0.45;
      [this.px, this.pz] = fromPlot(OWN, stairSide(0) * out, lz);
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
    // Dragging up looks up (into the sky, to watch people fly), down looks down a little.
    this.camPitch = clamp(this.camPitch - this.input.consumeOrbitDy() * ORBIT_SPEED, PITCH_MIN, PITCH_MAX);
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
      // No fences: neighbours' plots, the lane and the hub are all open; only things on the ground are solid.
      [this.px, this.pz] = walkStep(this.px + this.walkVel.x * dt, this.pz + this.walkVel.y * dt);
      [this.px, this.pz] = bumpSolids(this.px, this.pz, PLAYER_RADIUS);
      this.walkStairs();
      this.stepping = this.walkVel.length() > 0.6;
    } else {
      this.walkVel.set(0, 0);
    }
    if (this.input.consumeKey('KeyE')) this.useHere();
  }

  // ---------------------------------------------------------------- multiplayer (fake server)

  /** Runs the server, draws the other players, and passes on its events, standings and player count. */
  private updateServer(realDt: number): void {
    const fav = this.save.pads.reduce<PadSlot | null>((a, b) => (b && (!a || b.rarity > a.rarity) ? b : a), null);
    this.server.setLocal({ name: 'You', income: incomePerSecond(this.save), best: this.save.best, favorite: fav?.name ?? '' });
    this.server.update(realDt);
    this.remote.update(this.time, realDt, this.px, this.pz);
    for (const e of this.server.drain()) {
      if (e.kind === 'act') {
        this.onRemoteAct(e.act, e.tier ?? 0, e.count ?? 1);
        continue;
      }
      this.hud.feed(e.name, e.text, e.kind, e.color);
      // Players appear and vanish in a puff.
      if (e.at && (e.kind === 'join' || e.kind === 'leave')) {
        this.fx.burst(this.tmp.set(...e.at), { count: 22, color: 0xffffff, speed: 4, life: 0.9, size: 1.1, grow: 1.6, up: 2 });
      }
    }
    this.hud.setOnline(this.server.online, this.server.name, CAPACITY);
    this.boardTimer -= realDt;
    if (this.boardTimer <= 0) {
      this.boardTimer = 2;
      const all = this.server.standings();
      const rows = (sorted: typeof all, value: (p: (typeof all)[number]) => string) =>
        sorted.map((p) => ({ name: p.name, value: value(p), you: p.you }));
      this.env.drawBoard(0, 'TOP EARNERS', rows([...all].sort((a, b) => b.income - a.income), (p) => `${formatCoins(p.income)}/s`));
      this.env.drawBoard(1, 'TOP FLYERS', rows([...all].sort((a, b) => b.best - a.best), (p) => `${Math.round(p.best)} m`));
    }
  }

  /** Another player used something shared: the cannon fires them off, a machine spins, the cauldron bubbles. */
  private onRemoteAct(act: 'fire' | 'spin' | 'stir' | 'rebirth' | undefined, tier: number, count: number): void {
    if (act === 'rebirth') {
      this.hub.rebirthBurst();
      this.launchFireworks(this.hub.rebirthCrystal(new THREE.Vector3()), 5, 0.6);
      return;
    }
    if (act === 'fire') {
      const muzzle = this.tmp.set(0, MUZZLE_Y + 1.2, 0);
      this.fx.burst(muzzle, { count: 18, color: 0xd9dde3, speed: 6, life: 1, size: 1.4, grow: 2.2, up: 2, drag: 2.5 });
      this.fx.burst(muzzle, { count: 8, color: 0xffb347, speed: 8, life: 0.3, size: 1 });
      // Heard across town, quieter with distance; not while the player is up in the sky.
      const d = Math.hypot(this.px, this.pz);
      if (this.state === 'home' || this.state === 'boarding') this.sfx.distantBoom(clamp(1 - d / 90, 0, 1) * 0.7);
      if (this.state !== 'aim' && this.state !== 'charging') this.recoil = Math.max(this.recoil, 0.8);
    } else if (act === 'spin') {
      this.hub.spin(tier, count);
    } else if (act === 'stir') {
      this.hub.stir();
    }
  }

  /** Notices the player walking into someone else's plot: a toast, and the owner may say hi. */
  private updateVisit(): void {
    const here = plotAt(this.px, this.pz);
    const index = here && here.index !== OWN_SLOT ? here.index : null;
    if (index === this.visiting) return;
    this.visiting = index;
    if (index === null) return;
    const owner = this.remote.ownerOf(index);
    if (owner) {
      this.hud.toast(`Visiting ${owner.name}'s base`, 'small');
      this.server.visit(owner.id);
    } else {
      this.hud.toast('An open plot, waiting for a player', 'small');
    }
  }

  /** The brainrot on another player's showcase the player is standing next to, or null. */
  private visitPad(): { index: number; pad: PadSlot } | null {
    if (this.visiting === null) return null;
    const owner = this.remote.ownerOf(this.visiting);
    if (!owner) return null;
    const slot = SLOTS[this.visiting];
    let best: { index: number; pad: PadSlot } | null = null;
    let bestD = COLLECT_RADIUS;
    owner.pads.forEach((pad, i) => {
      if (!pad) return;
      const local = Base.padPosition(i, this.tmp);
      const [x, z] = fromPlot(slot, local.x, local.z);
      const d = Math.hypot(x - this.px, z - this.pz);
      if (d < bestD) {
        bestD = d;
        best = { index: i, pad };
      }
    });
    return best;
  }

  private visitLabel(): string | null {
    const owner = this.visiting !== null ? this.remote.ownerOf(this.visiting) : null;
    if (!owner) return null;
    const near = this.visitPad();
    return near ? `View ${near.pad.name}` : null;
  }

  /** E while visiting: look at a brainrot on their showcase (and like it), or learn their machines are theirs. */
  private useVisit(): void {
    const owner = this.visiting !== null ? this.remote.ownerOf(this.visiting) : null;
    if (!owner) {
      this.hud.toast('Nobody owns this plot yet', 'small');
      return;
    }
    const near = this.visitPad();
    if (!near) {
      this.hud.toast(`Walk up to one of ${owner.name}'s brainrots to look at it`, 'small');
      return;
    }
    const card = this.hud.characterCard(near.pad.name, near.pad.rarity);
    const info = document.createElement('p');
    info.textContent = describePad(near.pad, owner);
    this.hud.showModal(near.pad.name, [card, info], [
      {
        label: '👍 Nice!',
        primary: true,
        action: () => {
          this.server.like(owner.id);
          this.hud.feed('You', `liked ${owner.name}'s ${near.pad.name}`, 'news');
        },
      },
      { label: 'Close' },
    ]);
  }

  /** Height of the floor under the player: raised on the pads, the cauldron platform and showcase floors. */
  private floorHere(): number {
    if (this.stair >= 0) return stairHeight(this.stair, toPlot(OWN, this.px, this.pz)[1]) + 0.02;
    if (this.level > 0) return this.level * FLOOR_H + 0.02;
    return floorWorld(this.px, this.pz);
  }

  /** The nearest open slot the player is standing at, or null. */
  private padUnderfoot(): number | null {
    let best: number | null = null;
    let bestD = COLLECT_RADIUS;
    for (let i = 0; i < this.save.pads.length; i++) {
      if (Base.padFloor(i) !== this.level) continue;
      const at = this.padAt(i, this.tmp);
      const d = Math.hypot(at.x - this.px, at.z - this.pz);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** A locked slot the player stands on, or null. */
  private lockedUnderfoot(): number | null {
    for (let i = this.save.pads.length; i < maxPads(this.save); i++) {
      if (Base.padFloor(i) !== this.level) continue;
      const at = this.padAt(i, this.tmp);
      if (Math.hypot(at.x - this.px, at.z - this.pz) < COLLECT_RADIUS) return i;
    }
    return null;
  }

  /** What E (or the action button) would do here, or null when there's nothing to do. */
  private actionLabel(): string | null {
    if (this.visiting !== null) return this.visitLabel();
    const pull = this.pullPadUnder();
    if (pull) {
      const tier = GACHA[pull.index];
      if (!tierUnlocked(this.save, tier)) return `${tier.short} · reach ${tier.unlockBest} m`;
      const n = pull.ten ? 10 : 1;
      return `Pull ${tier.short} ×${n} · ${formatCoins(tier.cost * n)} gems`;
    }
    if (this.atCannon()) return 'Get in the cannon';
    if (this.onRebirthPad()) {
      const s = this.save;
      const need = rebirthCannonLevel(s);
      return s.cannon >= need ? 'REBIRTH!' : `Rebirth · Cannon Lv ${s.cannon}/${need}`;
    }
    if (this.onPlatform(CAULDRON_SPOT)) return 'Merge station';
    if (this.atShop()) return 'Upgrades';
    const pad = this.padUnderfoot();
    if (pad !== null) {
      const slot = this.save.pads[pad];
      if (slot) return `Open ${slot.name}`;
      return this.save.inventory.length ? 'Display a brainrot' : null;
    }
    if (this.lockedUnderfoot() !== null) {
      const cost = expansionCost(this.save);
      return cost === null ? null : `Unlock ${ECONOMY.padStep} slots · ${formatCoins(cost)}`;
    }
    return null;
  }

  /** Whether the player stands on the platform at a station's front. */
  private onPlatform(at: THREE.Vector3): boolean {
    return Math.hypot(at.x - this.px, at.z - this.pz) < PLATFORM_RADIUS;
  }

  /** Whether the player stands at the shop's counter. */
  private atShop(): boolean {
    return Math.hypot(SHOP_SPOT.x - this.px, SHOP_SPOT.z - this.pz) < 1.8;
  }

  /** Slot i of this client's showcase, in world space. */
  private padAt(i: number, out: THREE.Vector3): THREE.Vector3 {
    return Base.padWorld(OWN, i, out);
  }

  private useHere(): void {
    if (this.state !== 'home') return;
    if (this.visiting !== null) {
      this.useVisit();
      return;
    }
    const pull = this.pullPadUnder();
    if (pull) {
      this.pullMachine(pull.index, pull.ten ? 10 : 1);
      return;
    }
    if (this.atCannon()) {
      this.startBoarding();
      return;
    }
    if (this.onRebirthPad()) {
      this.openRebirth();
      return;
    }
    if (this.onPlatform(CAULDRON_SPOT)) {
      this.mergePick = [];
      this.openMerger();
      return;
    }
    if (this.atShop()) {
      this.hub.greet();
      this.openShopPanel();
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
      this.expandBase();
      return;
    }
    this.hud.toast('Walk up to a slot, a machine pad, the cauldron or the shop first', 'small');
  }

  private collect(i: number): void {
    const slot = this.save.pads[i];
    if (!slot) return;
    const amount = Math.floor(slot.cash);
    if (amount < 1) return;
    slot.cash -= amount;
    this.save.coins += amount;
    const at = this.padAt(i, this.tmp2).setY(1.4);
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

  private wantsPullHint(): boolean {
    return !this.hasHint('pull') && this.save.gems >= GACHA[0].cost;
  }

  /** The lowest rarity the backpack has enough of to merge, or null. */
  private mergeableRarity(): number | null {
    for (let r = 0; r < RARITIES.length; r++) {
      const need = mergeNeed(r);
      if (need !== null && countInBackpack(this.save, r) >= need) return r;
    }
    return null;
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
    if (this.wantsPullHint()) {
      const p = pullPad(0, false);
      return { text: `Stand on the ×1 pad at the BASIC machine and ${press}`, target: this.objTarget.set(p.x, 0, p.z) };
    }
    // A machine just unlocked and affordable: point it out once.
    const fresh = GACHA.findIndex((t, i) => i > 0 && tierUnlocked(s, t) && s.gems >= t.cost && !this.hasHint(`tier-${t.id}`));
    if (fresh > 0 && this.hasHint('pull')) {
      const p = pullPad(fresh, false);
      return {
        text: `The ${GACHA[fresh].short} machine is open: better odds! Stand on its ×1 pad and ${press}`,
        target: this.objTarget.set(p.x, 0, p.z),
      };
    }
    if (!this.hasHint('place') && s.inventory.length && empty >= 0) {
      return {
        text: `Walk up to the glowing slot and ${press} to display your brainrot`,
        target: this.padAt(empty, this.objTarget),
      };
    }
    if (!this.hasHint('collect') && cashPad >= 0) {
      return { text: 'Walk up to the slot to collect its coins', target: this.padAt(cashPad, this.objTarget) };
    }
    const mergeable = this.mergeableRarity();
    if (!this.hasHint('merge') && mergeable !== null) {
      return {
        text: `Step on the purple platform by the cauldron and ${press}: you have enough ${RARITIES[mergeable].name}s`,
        target: CAULDRON_SPOT,
      };
    }
    if (this.wantsUpgradeHint()) return { text: 'Upgrade your cannon!', target: null };
    if (this.wantsExpandHint()) {
      return { text: `Your showcase is full! Unlock ${ECONOMY.padStep} more slots at your base`, target: this.padAt(s.pads.length, this.objTarget) };
    }
    if (this.wantsLevelHint()) {
      const ready = s.pads.findIndex((slot) => slot !== null && levelReady(slot));
      return {
        text: 'Click Level up under your brainrot',
        target: ready >= 0 ? this.padAt(ready, this.objTarget) : null,
      };
    }
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

  /**
   * Launch: from across the town the player teleports straight to the cannon; close by, they hop over. Either
   * way they then dive in.
   */
  private startBoarding(): void {
    this.state = 'boarding';
    this.guideTarget = null;
    this.hud.prompt('');
    this.jumpY = this.jumpV = 0;
    const d = Math.hypot(this.px - CANNON_FOOT.x, this.pz - CANNON_FOOT.z);
    // Close by (in the hub, on the ground floor), walk over; from further, teleport. Either way, dive in.
    if (this.level === 0 && Math.hypot(this.px, this.pz) < 3.6) {
      // Right beside the cannon, on any side: dive in from where you stand.
      this.startDive();
    } else if (d > TELEPORT_RANGE || this.level > 0) {
      this.teleport(CANNON_FOOT, 0, () => this.startDive());
    } else if (this.pz < CANNON_FOOT.z - 1) {
      // Behind the cannon: round its side first.
      const side = new THREE.Vector3(this.px < 0 ? -3.6 : 3.6, 0, 1.2);
      this.walkTo(side, () => this.walkTo(CANNON_FOOT, () => this.startDive()));
    } else if (d > 0.3) {
      this.walkTo(CANNON_FOOT, () => this.startDive());
    } else {
      this.startDive();
    }
  }

  /** Out of the cannon: the player springs out of the muzzle and lands at its foot, helmet off. */
  private exitCannon(): void {
    if (this.state !== 'aim') return;
    this.state = 'home';
    this.hud.showCharge(null);
    this.hud.prompt('');
    this.aim = 0;
    this.player.body.rotation.set(0, 0, 0);
    this.px = CANNON_FOOT.x;
    this.pz = CANNON_FOOT.z + 0.6;
    this.py = this.floorHere();
    // A hop out from muzzle height, down to the ground.
    this.jumpY = MUZZLE_Y + 0.6 - this.py;
    this.jumpV = 4;
    this.facing = 0;
    this.camYaw = 0;
    this.sfx.hop();
    this.fx.burst(this.tmp.set(0, MUZZLE_Y + 1.4, 0), { count: 10, color: 0xd9dde3, speed: 3, life: 0.5, size: 0.8, grow: 1.5 });
  }

  /** Whether the player stands next to the cannon (any side), where E climbs in. */
  private atCannon(): boolean {
    return this.level === 0 && Math.hypot(this.px, this.pz) < 3.6;
  }

  /**
   * A puff of smoke where the player was, a sparkle where they arrive, and a squash-and-stretch pop-in. The
   * camera cuts rather than flying across town.
   */
  private teleport(to: THREE.Vector3, yaw: number, then: () => void): void {
    const from = this.tmp.set(this.px, this.py + 1, this.pz);
    this.fx.burst(from, { count: 22, color: 0xffffff, speed: 5, life: 0.6, size: 1, grow: 1.5, up: 2 });
    this.fx.burst(from, { count: 12, color: 0x9dfcff, speed: 9, life: 0.5, size: 0.4, up: 4 });
    this.sfx.teleport();
    this.px = to.x;
    this.pz = to.z;
    this.py = floorWorld(to.x, to.z);
    this.walkVel.set(0, 0);
    this.walking = false;
    this.arrive = null;
    this.level = 0;
    this.stair = -1;
    this.jumpY = this.jumpV = 0;
    this.facing = yaw;
    this.camYaw = yaw;
    this.camSnap = true;
    this.appear = 0.4;
    this.fx.burst(this.tmp.set(this.px, this.py + 1, this.pz), { count: 18, color: 0xfff3a8, speed: 6, life: 0.6, size: 0.45, up: 3 });
    this.after(0.3, then);
  }

  /** Upgrades: off to the shop's counter (teleporting there from afar), a wave from the keeper, and the shop opens. */
  private goShop(): void {
    if (this.state === 'aim' || this.state === 'charging') {
      // Out of the cannon first.
      this.state = 'home';
      this.hud.showCharge(null);
      this.hud.prompt('');
      this.player.body.rotation.set(0, 0, 0);
      this.aim = 0;
    } else if (this.state !== 'home') {
      return;
    }
    if (Math.hypot(this.px - SHOP_SPOT.x, this.pz - SHOP_SPOT.z) > 2.5) {
      this.teleport(SHOP_SPOT, -Math.PI / 2, () => {
        this.hub.greet();
        this.openShopPanel();
      });
    } else {
      this.hub.greet();
      this.openShopPanel();
    }
  }

  private openShopPanel(): void {
    this.hud.openShop();
    this.refreshShop();
  }

  private startDive(): void {
    this.state = 'boarding';
    this.walking = false;
    this.diveFrom.set(this.px, this.floorHere(), this.pz);
    // Facing the cannon, from whichever side.
    this.facing = Math.atan2(this.px, this.pz);
    this.dive = 0;
  }

  /** The dive's sound cues; the pose itself is drawn in updateVisuals. */
  private updateDive(dt: number): void {
    const before = this.dive;
    this.dive += dt;
    const crossed = (at: number) => before < at && this.dive >= at;
    if (crossed(0.2)) this.sfx.whoop();
    if (crossed(0.62)) {
      this.sfx.gulp();
      this.gulp = 1;
    }
    if (crossed(0.84)) this.fx.burst(this.tmp.set(0, MUZZLE_Y + 1.4, 0), { count: 10, color: 0xd9dde3, speed: 3, life: 0.5, size: 0.8, grow: 1.5 });
    if (this.dive >= DIVE_TIME) {
      this.dive = -1;
      this.boardCannon();
    }
  }

  /** Aiming in the cannon: the mouse, A/D or arrows, or a drag swings it a little left or right. */
  private updateAim(dt: number): void {
    switch (this.input.mode) {
      case 'mouse':
        this.aim = clamp((this.input.mouseX * 2 - 1) * 1.3, -1, 1);
        break;
      case 'touch':
        this.aim = clamp(this.aim + this.input.consumeTouchDx() * (2.4 / window.innerWidth), -1, 1);
        break;
      case 'keys':
        this.aim = clamp(this.aim + this.input.axis * dt * 2.2, -1, 1);
        break;
    }
  }

  /** Into the cannon, ready to charge: the player pops back up out of the muzzle and a helmet drops on. */
  private boardCannon(): void {
    this.px = this.prevX = 0;
    this.py = this.prevY = MUZZLE_Y;
    this.pz = 0;
    this.dive = -1;
    this.aim = 0;
    this.popOut = 0.35;
    this.helmetDrop = 0.7;
    this.clonked = false;
    this.hud.chuteAlarm(false);
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
    const aimTip = this.input.isTouch ? 'Drag to aim, hold to charge' : 'Aim with the mouse, hold to charge';
    this.hud.prompt(this.save.flightNo < 2 ? howTo : aimTip, true);
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
    const next = GIFTS[this.giftIndex]?.at;
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

  /** A session gift: gems, coins or both. */
  private claimGift(): void {
    const gift = GIFTS[this.giftIndex];
    if (!gift || this.sessionT < gift.at) return;
    this.giftIndex++;
    const coins = gift.incomeSeconds > 0 ? Math.max(GIFT_COINS.min, Math.round(incomePerSecond(this.save) * gift.incomeSeconds)) : 0;
    this.save.coins += coins;
    this.save.gems += gift.gems;
    const parts = [gift.gems ? `+${gift.gems} gems` : '', coins ? `+${formatCoins(coins)} coins` : ''].filter(Boolean);
    this.hud.toast(`Gift! ${parts.join(' ')}`, 'gold');
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
        case 'shield':
          level = s.shield ? `${s.shield} shield${s.shield > 1 ? 's' : ''}` : 'None';
          detail = cost === null ? 'Maxed out: 5 hits blocked every flight' : `Blocks ${s.shield + 1} hit${s.shield ? 's' : ''} per flight`;
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

    return rows;
  }

  private buy(item: ShopItem): void {
    const s = this.save;
    // The shop sells flight upgrades only: slots are bought at the base, rebirth is its own station.
    if (item === 'pads' || item === 'rebirth') return;
    const cost = upgradeCost(s, item);
    if (cost === null || s.coins < cost) return;
    s.coins -= cost;
    buyUpgrade(s, item);
    if (item === 'cannon') this.completeHint('upgrade');
    this.hud.toast(
      item === 'cannon' ? `Cannon Lv ${s.cannon}!` : item === 'shield' ? `${s.shield} shield${s.shield > 1 ? 's' : ''}!` : `${UPGRADES[item].name} up!`,
      'gold',
    );
    this.sfx.buy();
    writeSave(s);
    this.refreshShop();
  }

  /** Two more slots at the base: bought there (the button over the next locked pair, or E beside it). */
  private expandBase(): void {
    const s = this.save;
    const cost = expansionCost(s);
    if (cost === null) {
      this.hud.toast('Every slot is open', 'small');
      return;
    }
    if (s.coins < cost) {
      this.hud.toast(`Need ${formatCoins(cost - s.coins)} more coins`, 'bad small');
      this.sfx.full();
      return;
    }
    s.coins -= cost;
    const first = s.pads.length;
    for (let i = 0; i < ECONOMY.padStep; i++) s.pads.push(null);
    this.base.sync(s);
    this.completeHint('expand');
    this.hud.toast(`${s.pads.length} slots open!`, 'gold');
    this.sfx.buy();
    for (let i = first; i < s.pads.length; i++) {
      this.fx.burst(this.padAt(i, this.tmp).setY(this.padAt(i, this.tmp2).y + 0.8), { count: 26, color: 0x9dfcff, speed: 7, life: 0.9, size: 0.5, up: 5 });
    }
    writeSave(s);
  }

  /** Whether the player stands on the rebirth station's pad. */
  private onRebirthPad(): boolean {
    return Math.hypot(REBIRTH_FRONT.x - this.px, REBIRTH_FRONT.z - this.pz) < PLATFORM_RADIUS;
  }

  /** What the next rebirth gives: the new multiplier, and the floor it adds (if it does). */
  private rebirthPrize(): { mult: number; floor: number | null } {
    const s = this.save;
    const after = { rebirths: s.rebirths + 1 };
    return { mult: incomeMultiplier(s) + REBIRTH.incomeBonus, floor: floorsOf(after) > floorsOf(s) ? floorsOf(after) : null };
  }

  /** The rebirth station: what it costs and gives, then a confirm. */
  private openRebirth(): void {
    const s = this.save;
    if (s.cannon < rebirthCannonLevel(s)) {
      this.hud.toast(`Rebirth needs Cannon Lv ${rebirthCannonLevel(s)} (you're Lv ${s.cannon})`, 'small');
      this.sfx.full();
      return;
    }
    const { mult, floor } = this.rebirthPrize();
    this.sfx.open();
    const lines = [
      `×${mult} income forever (now ×${incomeMultiplier(s)}).`,
      floor ? `Your base grows a new floor: Floor ${floor}, with ${REBIRTH.newFloorPads} open slots.` : 'Your base keeps all its floors.',
      'You keep your rarest brainrot and every open slot.',
      'Coins, gems, upgrades, slot levels and the backpack start over.',
      `The next rebirth will need Cannon Lv ${rebirthCannonLevel({ rebirths: s.rebirths + 1 })}.`,
    ].map((t) => Object.assign(document.createElement('p'), { textContent: t }));
    this.hud.showModal('Rebirth?', lines, [
      { label: 'REBIRTH!', primary: true, action: () => this.doRebirth() },
      { label: 'Not yet' },
    ]);
  }

  private doRebirth(): void {
    const s = this.save;
    const { newFloor } = rebirthSave(s);
    this.base.sync(s);
    this.paintCannon();
    writeSave(s);
    this.level = 0;
    const floors = floorsOf(s);
    this.hud.feed('You', `rebirthed! ×${incomeMultiplier(s)} income${newFloor ? ` and Floor ${floors}` : ''}`, 'rebirth', '#ffd84a');
    this.grandRebirth(`×${incomeMultiplier(s)} income${newFloor ? ` · Floor ${floors} unlocked!` : ''}`);
  }

  /**
   * The rebirth show, about three seconds: the station's crystal dips and blasts up in a pillar of light with a
   * shockwave, the screen flashes gold, a big banner and confetti, the camera tilts up, and a volley of fireworks
   * bursts overhead.
   */
  private grandRebirth(sub: string): void {
    this.hub.rebirthBurst();
    this.hud.flash('#fff1b0');
    this.hud.grandBanner('REBIRTH!', sub);
    this.sfx.rebirth();
    platform.happytime();
    this.shake = Math.max(this.shake, 1.2);
    const center = this.hub.rebirthCrystal(new THREE.Vector3());
    this.fx.burst(center, { count: 70, color: 0xffd84a, speed: 14, life: 1.3, size: 0.8, up: 6 });
    // Look up at the show, then back.
    const pitch = this.camPitch;
    this.camYaw = Math.atan2(-(center.x - this.px), -(center.z - this.pz));
    this.camPitch = Math.max(pitch, 0.7);
    this.after(3.4, () => (this.camPitch = pitch));
    this.launchFireworks(center, 11, 1);
  }

  /** A volley of rockets around a point, each bursting high in colour with a white crackle. */
  private launchFireworks(center: THREE.Vector3, count: number, loud: number): void {
    const colors = [0xff3b6b, 0xffd23f, 0x3fc8ff, 0x8a5cff, 0x3ccf5a, 0xff7a1a, 0xffffff];
    for (let i = 0; i < count; i++) {
      this.after(0.15 + i * 0.16, () => {
        // From behind the point, as seen by the player, so the bursts fill the sky in front of them.
        const dx = center.x - this.px;
        const dz = center.z - this.pz;
        const d = Math.hypot(dx, dz) || 1;
        const back = rand(4, 9);
        const across = rand(-7, 7);
        const pos = new THREE.Vector3(center.x + (dx / d) * back - (dz / d) * across, 1, center.z + (dz / d) * back + (dx / d) * across);
        this.rockets.push({
          pos,
          vel: new THREE.Vector3(rand(-2, 2), rand(17, 21), rand(-2, 2)),
          fuse: rand(0.75, 1.0),
          color: colors[i % colors.length],
          loud,
        });
        this.sfx.fireworkLaunch(loud * this.nearness(pos));
      });
    }
  }

  /** 1 next to the player, fading to 0 at 90 m. */
  private nearness(at: THREE.Vector3): number {
    return clamp(1 - Math.hypot(at.x - this.px, at.z - this.pz) / 90, 0, 1);
  }

  private updateFireworks(dt: number): void {
    this.sparks.update(dt);
    for (const r of [...this.rockets]) {
      r.vel.y -= 9 * dt;
      r.pos.addScaledVector(r.vel, dt);
      this.sparks.burst(r.pos, { count: 2, color: 0xffd9a0, speed: 0.6, life: 0.4, gravity: 2 });
      r.fuse -= dt;
      if (r.fuse > 0) continue;
      this.rockets.splice(this.rockets.indexOf(r), 1);
      this.sparks.burst(r.pos, { count: 160, color: r.color, speed: 15, life: 1.6, gravity: 5, drag: 1.3 });
      this.sparks.burst(r.pos, { count: 22, color: 0xffffff, speed: 6, life: 0.7, gravity: 4, drag: 1.1 });
      this.sfx.fireworkBang(r.loud * this.nearness(r.pos));
    }
  }

  /** Each rebirth unlocks a cannon colour  /** Each rebirth unlocks a cannon colour: the design doc's cosmetic skin, in gray-box form. */
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
        action: () => this.levelUp(i, true),
      },
      { label: 'Store in backpack', action: () => this.storePad(i) },
      {
        label: sellArmed ? `Sure? +${formatCoins(sell)}` : `Sell · ${formatCoins(sell)}`,
        action: () => (sellArmed ? this.sellPad(i) : this.openPad(i, true)),
      },
      { label: 'Close' },
    ]);
  }

  /** Levels up a slot's brainrot; from its panel, the panel reopens. */
  private levelUp(i: number, reopen = false): void {
    const s = this.save;
    const slot = s.pads[i];
    if (!slot) return;
    const cost = levelCost(slot);
    if (cost === null) return;
    if (!levelReady(slot)) {
      this.hud.toast(`${slot.name} needs more XP: it earns XP while on display`, 'small');
    } else if (s.coins < cost) {
      this.hud.toast(`Need ${formatCoins(cost - s.coins)} more coins`, 'bad small');
    } else {
      s.coins -= cost;
      slot.level = (slot.level ?? 1) + 1;
      slot.xp = 0;
      this.completeHint('level');
      writeSave(s);
      this.sfx.levelUp();
      this.hud.toast(`Slot Lv ${slot.level}!`, 'gold');
      this.fx.burst(this.padAt(i, this.tmp).setY(1), {
        count: 18,
        color: RARITIES[slot.rarity].color,
        speed: 6,
        life: 0.7,
        size: 0.6,
        up: 4,
      });
    }
    if (reopen) this.openPad(i);
  }

  private sellPad(i: number): void {
    const s = this.save;
    const slot = s.pads[i];
    if (!slot) return;
    const coins = sellValue(s, slot) + Math.floor(slot.cash);
    s.coins += coins;
    emptyPad(s, i);
    this.base.sync(s);
    writeSave(s);
    this.sfx.coin();
    this.floatAt(this.padAt(i, this.tmp).setY(1.6), `Sold +${formatCoins(coins)}`);
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
      this.autoDisplay();
      this.hud.toast(`${RARITIES[reward.rarity].name}: ${name}! It's in your backpack`, '', RARITIES[reward.rarity].css);
      this.sfx.chant(name, reward.rarity);
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
    // The cannon's swing chases the aim on a spring, so it eases in and overshoots a touch as it settles.
    const inCannon = this.state === 'aim' || this.state === 'charging';
    const wantAim = inCannon ? this.aim : 0;
    this.aimVel += ((wantAim - this.aimShown) * 120 - this.aimVel * 14) * realDt;
    this.aimShown += this.aimVel * realDt;
    // Positive aim swings the muzzle right (+x), which is a negative turn about z.
    const tilt = -this.aimShown * AIM_TILT;
    if (inCannon) {
      // Sitting in the barrel, swung with it.
      this.px = -Math.sin(tilt) * BARREL_REACH;
      this.py = MUZZLE_Y - (1 - Math.cos(tilt)) * BARREL_REACH;
    }
    this.player.group.position.set(this.px, this.py - squash * 0.5 + this.jumpY, this.pz);
    this.player.group.rotation.y = atBase ? this.facing : 0;
    // Squash and stretch for pop-ins: after a teleport, and popping up out of the muzzle.
    this.appear = Math.max(0, this.appear - realDt);
    this.popOut = Math.max(0, this.popOut - realDt);
    let stretch = 0;
    if (this.appear > 0) stretch = Math.sin((1 - this.appear / 0.4) * Math.PI) * 0.35;
    // A jump stretches on the way up and squashes on landing.
    if (this.jumpY > 0) stretch += clamp(this.jumpV / 45, -0.06, 0.18);
    this.landSquash = Math.max(0, this.landSquash - realDt * 5);
    stretch -= Math.sin(this.landSquash * Math.PI) * 0.2;
    if (this.popOut > 0) {
      const p = 1 - this.popOut / 0.35;
      stretch = Math.sin(p * Math.PI) * 0.3;
      this.player.group.position.y += Math.sin(p * Math.PI) * 0.6;
    }
    body.scale.set(1 - stretch * 0.45, 1 + stretch, 1 - stretch * 0.45);
    if (this.dive >= 0) {
      this.poseDive(body);
    } else if (crashed) {
      if (this.bounces > 0) {
        body.rotation.z += this.spin * dt;
      } else {
        const z = Math.atan2(Math.sin(body.rotation.z), Math.cos(body.rotation.z));
        body.rotation.z = lerp(z, (Math.sign(this.spin) * Math.PI) / 2, damp(10, dt));
      }
      body.rotation.x = lerp(body.rotation.x, 0, damp(10, dt));
    } else if (this.state !== 'reveal') {
      const freefall = this.state === 'fall' && this.chute === 'closed';
      body.rotation.x = lerp(body.rotation.x, freefall ? -1.1 : 0, damp(inCannon || atBase ? 14 : 5, dt));
      const roll = inCannon ? tilt : clamp(-this.vx * 0.035, -0.5, 0.5);
      body.rotation.z = lerp(body.rotation.z, roll, damp(inCannon ? 30 : 10, dt));
    }
    if (this.dive < 0) body.position.y = lerp(body.position.y, lying ? 0.35 : 0.9, damp(10, dt));
    if (atBase && (this.walking || this.stepping)) body.position.y = 0.9 + Math.abs(Math.sin(this.time * 14)) * 0.08;
    body.visible = this.invuln <= 0 || Math.floor(this.time * 20) % 2 === 0;
    this.animateLimbs(dt, atBase);

    const chuteTarget = !inFlight ? 0 : this.chute === 'open' ? 1 : this.chute === 'tangled' ? 0.5 : 0;
    this.chuteScale = lerp(this.chuteScale, chuteTarget, damp(this.chuteScale < chuteTarget ? 14 : 6, realDt));
    this.player.chute.visible = this.chuteScale > 0.02;
    this.player.chute.scale.setScalar(this.chuteScale);
    // The canopy flutters harder the faster it's coming down (a parachute opened high drops fast).
    const flutter = clamp((-this.vy - FLIGHT.chuteSpeed) / 30, 0, 1);
    this.player.chute.rotation.z =
      this.chute === 'tangled'
        ? Math.sin(this.time * 30) * 0.3
        : Math.sin(this.time * (1.5 + flutter * 12)) * (0.05 + flutter * 0.08);
    this.player.chute.scale.y = this.chuteScale * (1 - flutter * 0.15 + Math.sin(this.time * 20) * flutter * 0.05);
    this.updateHelmet(realDt);
    this.updateShield(realDt, inFlight);
    this.bubbleT = Math.max(0, this.bubbleT - realDt);
    this.bubble.sprite.visible = this.bubbleT > 0;

    const free = this.state === 'home' && !this.walking && this.pulling <= 0 && !this.hud.modalOpen;
    this.hud.showAction(free ? this.actionLabel() : null);
    this.updateGuide();
    this.updateCoach();
    this.updatePadButtons(atBase);
    animateShared(this.time);

    const shadow = this.env.shadow;
    const s = 0.9 + this.py * 0.04;
    shadow.position.x = this.px;
    shadow.position.z = this.pz;
    shadow.position.y = (atBase ? this.floorHere() : 0) + 0.03;
    shadow.scale.set(s, s, 1);
    (shadow.material as THREE.MeshBasicMaterial).opacity =
      this.state === 'aim' || this.state === 'charging' ? 0 : clamp(0.4 - this.py / 150, 0, 0.4);
    this.animateCannon(realDt, squash, tilt);
    this.env.followSun(this.px, this.pz);

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
    const upgradeHint = this.wantsUpgradeHint();
    const launchHint =
      this.state === 'home' &&
      this.hasHint('collect') &&
      !upgradeHint &&
      !this.save.pads.some((slot) => slot !== null && slot.cash >= 1);
    this.hud.showExit(this.state === 'aim');
    this.hud.showBaseButtons(canShop, this.state === 'home', {
      upgrades: canShop && upgradeHint,
      launch: launchHint,
      book: this.bookRewardWaiting(),
    });
  }

  /** A Level up button under each nearby brainrot, placed on screen under its pedestal's front edge. */
  private updatePadButtons(atBase: boolean): void {
    const s = this.save;
    const show = atBase && !this.hud.modalOpen && !this.hud.shopOpen;
    const items: PadButton[] = [];
    if (show) {
      const expand = expansionCost(s);
      const next = s.pads.length;
      if (expand !== null && Base.padFloor(next) === this.level) {
        const at = Base.buttonWorld(OWN, next, this.screen);
        if (Math.hypot(at.x - this.px, at.z - this.pz) < BUTTON_RANGE + 4) {
          at.project(this.camera);
          if (at.z < 1 && Math.abs(at.x) < 1.1 && Math.abs(at.y) < 1.1) {
            items.push({
              index: next,
              x: ((at.x + 1) / 2) * window.innerWidth,
              y: ((1 - at.y) / 2) * window.innerHeight,
              title: `Unlock ${ECONOMY.padStep} slots`,
              sub: formatCoins(expand),
              kind: s.coins >= expand ? 'go' : 'poor',
              progress: 1,
            });
          }
        }
      }
      s.pads.forEach((slot, i) => {
        if (!slot || Base.padFloor(i) !== this.level) return;
        const cost = levelCost(slot);
        const need = xpNeeded(slot);
        if (cost === null || need === null) return;
        const at = Base.buttonWorld(OWN, i, this.screen);
        if (Math.hypot(at.x - this.px, at.z - this.pz) > BUTTON_RANGE) return;
        at.project(this.camera);
        if (at.z > 1 || Math.abs(at.x) > 1.1 || Math.abs(at.y) > 1.1) return;
        const progress = Math.min(1, (slot.xp ?? 0) / need);
        const ready = progress >= 1;
        items.push({
          index: i,
          x: ((at.x + 1) / 2) * window.innerWidth,
          y: ((1 - at.y) / 2) * window.innerHeight,
          title: ready ? `Level up → ${(slot.level ?? 1) + 1}` : `Lv ${slot.level ?? 1}`,
          sub: ready ? formatCoins(cost) : `XP ${Math.floor(progress * 100)}%`,
          kind: !ready ? 'xp' : s.coins >= cost ? 'go' : 'poor',
          progress,
        });
      });
    }
    this.hud.padButtons(items);
  }

  /** The green arrows: one bobbing over the objective, one on the ground by the player pointing the way. */
  /**
   * The tutorial coach for new players: a big banner saying what to do now, and a cartoon hand showing how
   * (holding to charge, swiping to steer, tapping the parachute, pointing at the next button, or the walk keys).
   */
  private updateCoach(): void {
    const s = this.save;
    const hud = this.hud;
    const touch = this.input.isTouch;
    const newbie = s.flightNo < 3;
    if (hud.modalOpen || hud.shopOpen) {
      hud.coach(null);
      return;
    }
    if (this.state === 'aim' && s.flightNo < 2) {
      hud.coach(s.flightNo === 0 ? 'Hold to charge, let go to FIRE!' : 'Again! Hold, then let go', { mode: 'hold', x: 0.5, y: 0.66 });
      return;
    }
    if (this.state === 'charging' && s.flightNo < 2) {
      hud.coach('Let go when the needle is in the GREEN!', { mode: 'hold', x: 0.5, y: 0.66 });
      return;
    }
    if (this.state === 'ascent' && newbie && this.time - this.launchT < 4) {
      if (s.flightNo <= 1) hud.coach('Fly through the gems!');
      else hud.coach(touch ? 'Drag left and right to steer!' : 'Move the mouse to steer into gems!', { mode: 'swipe', x: 0.5, y: 0.62 });
      return;
    }
    if (this.state === 'fall' && this.chute === 'closed' && this.secondsToImpact() < (newbie ? 3.4 : this.chuteWarnAt())) {
      hud.coach(touch ? 'TAP PARACHUTE NOW!' : 'PRESS SPACE: PARACHUTE!', { mode: 'tap', el: hud.chuteBtn });
      return;
    }
    if (this.state === 'home' && !this.walking) {
      const { text, target } = this.objective();
      // Coach the first steps of each kind; after that, the plain prompt is enough.
      if (text && (s.flightNo < 6 || target)) {
        let hand: Parameters<Hud['coach']>[1] = null;
        if (hud.actionBtn.classList.contains('on')) hand = { mode: 'point', el: hud.actionBtn };
        else if (/^Upgrade/.test(text)) hand = { mode: 'point', el: hud.upgradesBtn };
        else if (text.startsWith('Launch')) hand = { mode: 'point', el: hud.launchBtn };
        else if (target) hand = { mode: 'walk', x: 0.3, y: 0.8 };
        hud.coach(text, hand);
        return;
      }
    }
    hud.coach(null);
  }

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
    // A trail of chevrons from just ahead of the player to just short of the goal, flowing toward it.
    ground.visible = true;
    const spacing = 1.25;
    const start = 1.2;
    const end = d - 1.4;
    const flow = (this.time * 2.2) % spacing;
    const turn = Math.atan2(-dx, -dz);
    ground.children.forEach((chevron, i) => {
      const along = start + flow + i * spacing;
      chevron.visible = along < end;
      if (!chevron.visible) return;
      const x = this.px + (dx / d) * along;
      const z = this.pz + (dz / d) * along;
      chevron.position.set(x, floorWorld(x, z) + 0.06, z);
      chevron.rotation.y = turn;
      // Fade in at the player's feet and out at the goal; a wave of brightness rolls along the trail.
      const fade = Math.max(0, Math.min(1, (along - start) / 1.5, (end - along) / 1.5));
      chevron.scale.setScalar(0.85 + 0.15 * Math.max(0, Math.sin(this.time * 6 - i * 0.7)));
      for (const part of chevron.children as THREE.Mesh[]) (part.material as THREE.MeshBasicMaterial).opacity = fade;
    });
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
    if (moving) {
      // A soft footstep each time a foot comes down (twice per stride).
      const before = Math.floor(this.walkPhase / Math.PI);
      this.walkPhase += dt * 11 * Math.max(0.4, pace);
      if (Math.floor(this.walkPhase / Math.PI) !== before && this.py < 1) this.sfx.step();
    }
    const freefall = this.state === 'fall' && this.chute === 'closed';
    let armOut = 0.25 + Math.sin(t * 2) * 0.04;
    let armSwing = 0;
    let legSwing = 0;
    let legSpread = 0;
    let flail = 0;
    let wobble = 0;
    let tuck = 0;
    if (atBase && this.jumpY > 0.05) {
      // Mid-jump: arms flung up and out, knees tucked.
      armOut = 1.5;
      tuck = 0.7;
    } else if (moving) {
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
    } else if (this.dive >= 0) {
      if (this.dive < 0.2) {
        // Winding up: arms swung back.
        armOut = 0.5;
        armSwing = -1.1;
      } else {
        // Arms out front like a diver; legs kick once stuck in the muzzle.
        armOut = 2.9;
        if (this.dive > 0.62) {
          flail = 0.0001;
          legSpread = 0.25;
        }
      }
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
      const kick = this.dive > 0.62 ? Math.sin(t * 38 + i * Math.PI) * 0.9 : flail ? Math.sin(t * 11 + i * Math.PI) * 0.6 : 0;
      leg.rotation.x = lerp(leg.rotation.x, side * legSwing + kick - tuck, k);
      leg.rotation.z = lerp(leg.rotation.z, side * legSpread, k);
    });
    body.rotation.y = lerp(body.rotation.y, wobble, damp(6, dt));
  }

  /**
   * The dive into the cannon, in four beats: a crouch (anticipation), a leap in an arc turning head first
   * (stretched along the motion), stuck in the muzzle with legs kicking, and a slurp as the cannon swallows them.
   */
  private poseDive(body: THREE.Group): void {
    const t = this.dive;
    const g = this.player.group;
    const from = this.diveFrom;
    let x = from.x;
    let y = from.y + 0.9;
    let z = from.z;
    let pitch = 0;
    let sx = 1;
    let sy = 1;
    if (t < 0.2) {
      const a = easeInOut(t / 0.2);
      sy = 1 - 0.3 * a;
      sx = 1 + 0.18 * a;
      y -= 0.25 * a;
      pitch = -0.3 * a;
    } else if (t < 0.62) {
      // A quadratic arc from the foot, up over the muzzle, and down into it.
      const u = (t - 0.2) / 0.42;
      const p0 = [from.x, y, from.z];
      const p1 = [from.x * 0.6, 8.4, from.z * 0.6];
      const p2 = [0, 4.8, 0];
      const b0 = (1 - u) * (1 - u);
      const b1 = 2 * u * (1 - u);
      const b2 = u * u;
      x = b0 * p0[0] + b1 * p1[0] + b2 * p2[0];
      y = b0 * p0[1] + b1 * p1[1] + b2 * p2[1];
      z = b0 * p0[2] + b1 * p1[2] + b2 * p2[2];
      pitch = -Math.PI * easeInOut(u);
      const s = Math.sin(u * Math.PI);
      sy = 1 + 0.28 * s;
      sx = 1 - 0.14 * s;
    } else if (t < 0.82) {
      // Stuck: legs in the air, wiggling, sinking slowly.
      const u = (t - 0.62) / 0.2;
      x = Math.sin(this.time * 30) * 0.06;
      y = 4.8 - u * 0.35;
      z = 0;
      pitch = -Math.PI + Math.sin(this.time * 26) * 0.12;
      sy = 1 - Math.sin(u * Math.PI) * 0.08;
    } else {
      // Slurped in: a stretch as they're pulled down out of sight.
      const u = Math.min(1, (t - 0.82) / 0.13);
      x = 0;
      y = 4.45 - u * u * 3.1;
      z = 0;
      pitch = -Math.PI;
      sy = 1 + 0.35 * u;
      sx = 1 - 0.25 * u;
    }
    this.px = x;
    this.pz = z;
    this.py = y - 0.9;
    g.position.set(x, y - 0.9, z);
    g.rotation.y = this.facing;
    body.position.y = 0.9;
    body.rotation.set(pitch, 0, 0);
    body.scale.set(sx, sy, sx);
  }

  /**
   * The shield bubble round the player in flight while shields are left: faint and shimmering, a ring per
   * shield orbiting it. A block makes it flare up and wobble (and the last one pops it).
   */
  private updateShield(dt: number, inFlight: boolean): void {
    const bubble = this.shieldBubble;
    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 2.5);
    const on = inFlight && (this.shields > 0 || this.shieldFlash > 0);
    bubble.visible = on;
    this.hud.setShields(inFlight || this.state === 'aim' || this.state === 'charging' ? (this.state === 'aim' || this.state === 'charging' ? this.save.shield : this.shields) : null);
    if (!on) return;
    const f = this.shieldFlash;
    const shell = bubble.children[0] as THREE.Mesh;
    const mat = shell.material as THREE.MeshBasicMaterial;
    mat.opacity = this.shields > 0 ? 0.16 + Math.sin(this.time * 4) * 0.04 + f * 0.5 : f * 0.6;
    const wobble = 1 + Math.sin(f * Math.PI * 4) * 0.12 * f + (this.shields > 0 ? 0 : (1 - f) * 0.5);
    bubble.scale.set(wobble, 1 / Math.sqrt(wobble), wobble);
    // One orbiting ring per shield left.
    bubble.children.slice(1).forEach((ring, i) => {
      ring.visible = i < this.shields;
      ring.rotation.set(this.time * (1.2 + i * 0.3), i * 1.1, this.time * 0.7 + i);
    });
  }

  /** The helmet is on in the cannon and in flight; boarding drops it onto the player's head with a bounce. */
  private updateHelmet(realDt: number): void {
    const { helmet, cap } = this.player;
    const on = this.state === 'aim' || this.state === 'charging' || this.state === 'ascent' || this.state === 'fall' || this.state === 'landed' || this.state === 'reveal';
    helmet.visible = on;
    cap.visible = !on;
    if (!on) return;
    this.helmetDrop = Math.max(0, this.helmetDrop - realDt);
    const p = 1 - this.helmetDrop / 0.7;
    helmet.position.y = 0.8 + (1 - bounceOut(clamp(p, 0, 1))) * 1.8;
    if (!this.clonked && p > 0.37) {
      this.clonked = true;
      this.sfx.clonk();
    }
  }

  /**
   * The cannon: swung by the aim, squashed while charging, kicking down and springing back when it fires (or
   * fires someone else), and bulging as it swallows a diver.
   */
  private animateCannon(realDt: number, squash: number, tilt: number): void {
    const barrel = this.env.barrel;
    this.recoil = Math.max(0, this.recoil - realDt * 1.8);
    this.gulp = Math.max(0, this.gulp - realDt * 2.2);
    const r = this.recoil;
    // Fired: a sharp stretch up, then a wobble back to rest.
    const kick = r > 0 ? Math.sin((1 - r) * Math.PI * 3) * r * 0.22 : 0;
    const bulge = this.gulp > 0 ? Math.sin((1 - this.gulp) * Math.PI * 2.5) * this.gulp * 0.16 : 0;
    barrel.scale.set(1 + squash * 0.08 - kick * 0.4 + bulge, 1 - squash * 0.12 + kick - bulge * 0.6, 1 + squash * 0.08 - kick * 0.4 + bulge);
    barrel.position.y = BARREL_Y - r * r * 0.35;
    barrel.rotation.z = tilt;
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
      case 'charging': {
        // Behind the cannon, looking up the barrel, leaning a little the way it's swung.
        const lean = this.aimShown * AIM_TILT;
        pos.set(lean * 3, MUZZLE_Y - 0.8, 8.5 + portrait * 4);
        look.set(Math.sin(lean) * 8, MUZZLE_Y + 3.8, -1.5);
        break;
      }
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
        if (this.dive >= 0) {
          // A three-quarter view of the cannon, to watch the dive.
          pos.set(4.5, 3.4, 9.5 + portrait * 4);
          look.set(0, 3.2, 0);
          rate = 5;
          break;
        }
        // Third person: behind and above the player, swinging round behind them as they walk forward.
        const moving = this.walking || this.stepping;
        // Only a tap-to-walk swings the camera round; with keys or the stick, the player owns it.
        if (moving && this.followCam) this.camYaw = lerpAngle(this.camYaw, this.facing, damp(1.5, realDt));
        // The camera orbits a point at head height. Tilting up drops it low and pulls it in close behind the
        // player, turning the view skyward with their head still at the bottom of the screen; tilting down
        // raises it.
        const close = clamp((this.camPitch - 0.35) / (PITCH_MAX - 0.35), 0, 1);
        const dist = lerp(7.8, 2.6, close * close * (3 - 2 * close)) * (1 + portrait * 0.4);
        const sin = Math.sin(this.camYaw);
        const cos = Math.cos(this.camYaw);
        const elevation = 0.27 - this.camPitch * 0.62;
        const view = -0.21 + this.camPitch;
        const pivotY = this.py + 1.5;
        const across = Math.cos(elevation) * dist;
        pos.set(this.px + sin * across, Math.max(this.floorHere() + 0.45, pivotY + Math.sin(elevation) * dist), this.pz + cos * across);
        look.set(pos.x - sin * Math.cos(view) * 10, pos.y + Math.sin(view) * 10, pos.z - cos * Math.cos(view) * 10);
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
    const k = this.camSnap ? 1 : damp(rate, realDt);
    this.camSnap = false;
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
