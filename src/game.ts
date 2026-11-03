// One run: charge → launch → ascent → apex → fall → parachute → landing → reveal.
// The flight is scripted rather than simulated, so the apex hits launchHeight() exactly.
import * as THREE from 'three';
import {
  CHARGE,
  CHUTE,
  CRASH_DROP,
  FLIGHT,
  RARE,
  RARITIES,
  TUTORIAL,
  ZONES,
  launchHeight,
  pickName,
  rollRarity,
  zoneIndexAt,
} from './config';
import { Sfx } from './audio';
import { Particles, Streaks } from './fx';
import { Hud } from './hud';
import { Input } from './input';
import { loadSave, writeSave, type Save } from './store';
import {
  buildEnv,
  makeBird,
  makeCharacter,
  makeLabel,
  makePlayer,
  rarityMaterial,
  skyColorAt,
  type BirdRig,
  type CharacterRig,
  type Env,
  type Label,
  type PlayerRig,
} from './world';

type State = 'aim' | 'charging' | 'ascent' | 'fall' | 'landed' | 'reveal';
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

interface Bird {
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
const SECRET = RARITIES.length - 1;

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
  private player: PlayerRig;
  private fx: Particles;
  private streaks: Streaks;
  private input: Input;
  private hud = new Hud();
  private sfx = new Sfx();
  private save: Save = loadSave();
  private recordLine = new THREE.Group();
  private recordLabel: Label;
  private sky = new THREE.Color(0x8fd3ff);
  private tmp = new THREE.Vector3();
  private offTarget = new THREE.Vector3();
  private lookTarget = new THREE.Vector3();
  private camOff = new THREE.Vector3(0, -0.8, 8.5);
  private camLook = new THREE.Vector3(0, 3.8, -1.5);

  private state: State = 'aim';
  private time = 0;
  private lastFrame = 0;

  private px = 0;
  private py = MUZZLE_Y;
  /** Depth only drifts on the way down, to land in front of the cannon; the run itself is in z = 0. */
  private pz = 0;
  private vx = 0;
  private vy = 0;
  private prevX = 0;
  private prevY = MUZZLE_Y;
  private targetX = 0;
  /** Steerable half-width for this run; narrower on portrait screens so the camera can stay close. */
  private lane: number = FLIGHT.lane;

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

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = this.sky;
    this.scene.fog = new THREE.Fog(0x8fd3ff, 70, 320);
    this.env = buildEnv(this.scene);
    this.player = makePlayer();
    this.scene.add(this.player.group);
    this.fx = new Particles(this.scene);
    this.streaks = new Streaks(this.scene);
    this.input = new Input(canvas);
    this.input.onGesture = () => this.sfx.unlock();
    this.sfx.setMuted(this.save.muted);

    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(FLIGHT.lane * 2 + 4, 0.08, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }),
    );
    this.recordLabel = makeLabel();
    this.recordLabel.sprite.position.set(FLIGHT.lane - 1, 0.7, 0);
    this.recordLine.add(bar, this.recordLabel.sprite);
    this.recordLine.visible = false;
    this.scene.add(this.recordLine);

    this.bindUi();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.resetToCannon();
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  /** Dev-only: advance the game by fixed 60 fps steps and render once, for testing in throttled tabs. */
  debugStep(seconds: number): { state: State; y: number; vy: number; stack: number; pickups: number; birds: number } {
    for (let t = 0; t < seconds; t += 1 / 60) this.update(1 / 60);
    this.renderer.render(this.scene, this.camera);
    return {
      state: this.state,
      y: Math.round(this.py * 10) / 10,
      vy: Math.round(this.vy * 10) / 10,
      stack: this.stack.length,
      pickups: this.pickups.length,
      birds: this.birds.length,
    };
  }

  /** Dev-only: stops the frame loop from advancing the game, so debugStep() is the only clock. */
  debugPaused = false;

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
    onClick(hud.againBtn, () => this.again());
    onClick(hud.soundBtn, () => this.toggleMute());
    onClick(hud.tuneBtn, () => hud.tunePanel.classList.toggle('hidden'));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyT') hud.tunePanel.classList.toggle('hidden');
      if (e.code === 'KeyM') this.toggleMute();
    });
    hud.bindTuning(
      this.save,
      () => writeSave(this.save),
      () => this.resetProgress(),
    );
    hud.setSound(!this.save.muted);
  }

  private toggleMute(): void {
    this.save.muted = !this.save.muted;
    this.sfx.setMuted(this.save.muted);
    this.hud.setSound(!this.save.muted);
    writeSave(this.save);
  }

  private resetProgress(): void {
    this.save.flightNo = 0;
    this.save.best = 0;
    writeSave(this.save);
    if (this.state === 'aim') this.resetToCannon();
  }

  private resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
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
    const pressed = this.input.consumePressed();
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
        if (pressed && this.revealT > 0.6) this.again();
        break;
    }

    this.updatePickups(dt);
    this.updateBirds(dt);
    this.fx.update(dt);
    this.updateVisuals(realDt, dt);
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

    const apex = launchHeight(this.save.level) * (1 + bonus);
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
    if (flight === 1) {
      // Tutorial: a single Common straight up the flight path.
      this.addPickup(0, 0, MUZZLE_Y + (apex - MUZZLE_Y) * 0.55);
    } else {
      let lastY = -Infinity;
      for (let t = 0.6; t < tUp - 0.1; t += FLIGHT.pickupStep * rand(0.8, 1.2)) {
        const y = MUZZLE_Y + v0 * t - 0.5 * this.gUp * t * t;
        if (y < 14 || y - lastY < FLIGHT.pickupMinGap) continue;
        lastY = y;
        this.addPickup(rollRarity(y), rand(-width, width), y);
      }
      if (flight === TUTORIAL.guaranteedRareFlight) this.addPickup(RARE, rand(-width, width) / 2, apex * 0.8 + 2);
    }

    const mode = this.save.hazards;
    if (mode === 'on' || (mode === 'auto' && flight >= TUTORIAL.hazardFromFlight)) {
      // Hazards get denser with height.
      for (let y = 24; y < apex - 3; y += lerp(24, 12, Math.min(1, y / 1500)) * rand(0.8, 1.25)) this.addBird(y);
    }
  }

  private addPickup(rarity: number, x: number, y: number): void {
    const rig = makeCharacter(rarity);
    rig.group.position.set(x, y, 0);
    this.scene.add(rig.group);
    this.pickups.push({
      rarity,
      name: pickName(rarity),
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

  private addBird(y: number): void {
    const rig = makeBird(ZONES[zoneIndexAt(y)].hazard);
    this.scene.add(rig.group);
    this.birds.push({
      rig,
      x: rand(-this.lane, this.lane),
      y,
      baseY: y,
      dir: Math.random() < 0.5 ? -1 : 1,
      speed: rand(4, 7),
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
    const maxSpeed = FLIGHT.steerSpeed * (this.chute === 'closed' ? 1 : FLIGHT.chuteSteer);
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
      for (const p of this.pickups) {
        if ((p.state !== 'floating' && p.state !== 'tumbling') || p.cooldown > 0) continue;
        if (segmentDistance(ax, ay, bx, by, p.x, p.y + 0.6) < FLIGHT.playerRadius + FLIGHT.pickupRadius) {
          this.tryGrab(p);
        }
      }
    }

    if (this.invuln > 0) return;
    for (const b of this.birds) {
      if (b.hit) continue;
      if (segmentDistance(ax, ay, bx, by, b.x, b.y) < FLIGHT.playerRadius + FLIGHT.hazardRadius) {
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
    if (this.stack.length >= this.save.carry) {
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
    p.rig.group.scale.setScalar(0.55);
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
    p.rig.group.scale.setScalar(1);
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
      this.hud.toast(rising ? 'BONK! Catch it on the way down' : 'BONK!', 'bad small');
    } else {
      this.hud.toast('BONK!', 'bad small');
    }
  }

  private reachApex(): void {
    this.apex = this.py;
    this.state = 'fall';
    this.slowmo = Math.max(this.slowmo, 0.55);
    this.hud.toast(`${Math.round(this.apex)} m`, 'big');
    if (this.apex > this.save.best) {
      this.save.best = this.apex;
      writeSave(this.save);
    }
  }

  private chuteLate(): number {
    return this.save.flightNo <= TUTORIAL.wideChuteFlights ? CHUTE.tutorialLate : CHUTE.late;
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
    this.hud.showReveal(cards, parts.join(' · '));
    cards.forEach((c, i) => this.sfx.pop(c.rarity, 0.25 + i * 0.32));
  }

  private again(): void {
    if (this.state !== 'reveal') return;
    this.hud.hideReveal();
    this.resetToCannon();
  }

  private resetToCannon(): void {
    for (const p of this.pickups) this.scene.remove(p.rig.group);
    for (const b of this.birds) this.scene.remove(b.rig.group);
    this.pickups = [];
    this.birds = [];
    this.stack = [];
    this.px = this.prevX = 0;
    this.py = this.prevY = MUZZLE_Y;
    this.pz = 0;
    this.vx = this.vy = 0;
    this.targetX = 0;
    this.chute = 'closed';
    this.chuteScale = 0;
    this.bounces = 0;
    this.player.body.rotation.set(0, 0, 0);
    this.player.body.position.y = 0.9;
    this.recordLine.visible = false;
    this.state = 'aim';
    this.hud.showCharge(null);
    this.hud.showGround(null);
    this.hud.showChute(false);
    this.hud.setFlight(this.save.flightNo);
    const howTo = this.input.isTouch
      ? 'Hold to charge, release to fire'
      : 'Hold Space or the mouse to charge, release to fire';
    this.hud.prompt(this.save.flightNo < 2 ? howTo : 'Fire again!', true);
  }

  // ---------------------------------------------------------------- entities

  private updatePickups(dt: number): void {
    for (const p of this.pickups) {
      if (p.state === 'floating') {
        p.rig.figure.position.y = Math.sin(this.time * 2 + p.seed) * 0.15;
        p.rig.figure.rotation.y = Math.sin(this.time * 0.8 + p.seed) * 0.35;
        p.rig.group.position.set(p.x, p.y, 0);
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
        b.y = b.baseY + Math.sin(this.time * 2 + b.seed) * 0.6;
        b.rig.group.rotation.y = b.dir > 0 ? 0 : Math.PI;
      }
      const flap = Math.sin(this.time * 14 + b.seed) * 0.8;
      for (const wing of b.rig.wings) wing.rotation.x = flap * (wing.userData.side as number);
      b.rig.group.position.set(b.x, b.y, 0);
    }
  }

  // ---------------------------------------------------------------- presentation

  private updateVisuals(realDt: number, dt: number): void {
    const body = this.player.body;
    const inFlight = this.state === 'ascent' || this.state === 'fall';
    const crashed = (this.state === 'landed' || this.state === 'reveal') && this.chute !== 'open';
    const lying = crashed && this.bounces === 0;
    const squash = this.state === 'charging' ? this.charge : 0;

    const landingDrift = (this.state === 'fall' && this.chute !== 'closed') || this.state === 'landed';
    if (landingDrift) this.pz = lerp(this.pz, LANDING_Z, damp(1.5, dt));
    this.player.group.position.set(this.px, this.py - squash * 0.5, this.pz);
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
    const secret = rarityMaterial(SECRET);
    secret.color.setHSL((this.time * 0.25) % 1, 0.9, 0.6);
    secret.emissive.copy(secret.color);

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
    this.hud.setAlt(alt, ZONES[zoneIndexAt(alt)].name, this.save.best);
    this.hud.setStack(
      this.stack.map((p) => p.rarity),
      this.save.carry,
    );
  }

  private updateCamera(realDt: number): void {
    // 0 in landscape, up to 1 on a tall phone screen: pull back and follow the player more closely.
    const portrait = clamp((1 - this.camera.aspect) * 2, 0, 1);
    const speed = Math.abs(this.vy);
    let follow = lerp(0.6, 0.92, portrait);

    if (this.state === 'aim' || this.state === 'charging') {
      // Behind the cannon, looking up the barrel.
      this.offTarget.set(0, -0.8, 8.5 + portrait * 4);
      this.lookTarget.set(0, 3.8, -1.5);
      follow = 0;
    } else if (this.state === 'fall' && this.chute !== 'closed') {
      // Level with the player so the canopy stays in view.
      this.offTarget.set(0, 1.5, 15 * (1 + portrait * 0.25));
      this.lookTarget.set(0, 2.2, 0);
    } else if (this.state === 'ascent' || this.state === 'fall') {
      // Below the player looking up while rising, above looking down while falling.
      const f = clamp(0.5 - this.vy / 20, 0, 1);
      const dist = (12 + Math.min(18, speed * 0.1)) * (1 + portrait * 0.25);
      this.offTarget.set(0, lerp(-5 - Math.min(6, speed * 0.05), 6 + Math.min(6, speed * 0.04), f), dist);
      // A short look upward at the apex, toward what's above.
      const apexPan = this.state === 'fall' && this.slowmo > 0 && this.vy > -6 ? 8 : 0;
      this.lookTarget.set(0, lerp(7, -7, f) + apexPan, 0);
    } else {
      this.offTarget.set(0, 4.5, 13 * (1 + portrait * 0.5));
      this.lookTarget.set(0, 1, 0);
    }

    const k = damp(this.state === 'ascent' ? 3 : 4, realDt);
    this.camOff.lerp(this.offTarget, k);
    this.camLook.lerp(this.lookTarget, k);
    const jitter = () => (Math.random() - 0.5) * this.shake;
    this.camera.position.set(
      this.px * follow + this.camOff.x + jitter(),
      this.py + this.camOff.y + jitter(),
      this.pz + this.camOff.z,
    );
    this.camera.lookAt(this.px * follow * 1.2, this.py + this.camLook.y, this.pz + this.camLook.z);

    let fov = 60 + Math.min(18, speed * 0.12);
    if (this.state === 'charging') fov = 56 - this.charge * 4;
    fov += portrait * 6;
    this.camera.fov = lerp(this.camera.fov, fov, damp(4, realDt));
    this.camera.updateProjectionMatrix();
  }
}
