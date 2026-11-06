// A fake multiplayer server. The other five plots are played by bots that use the real game rules (the same
// pull, merge, upgrade and level code and the same costs as the player), walk their own plots, launch from their
// own cannons and chat a little. Bots come and go, and each joins with some progress already made.
//
// The game only talks to this through the shape a real server would have: snapshots of the other players (who,
// which slot, where, doing what, what's on display, their stats), a stream of events (joins, leaves, big pulls,
// new zones, chat), and a few messages from the local player (their stats, the plot they're visiting, likes, big
// moments). Swapping in a real server means replacing this file, not the game.
import { CHARGE, FLIGHT, GACHA, GEMS, MAX_ZONE, RARITIES, REBIRTH, TRACKS, ZONES, ECONOMY, launchHeight, zoneIndexAt } from './config';
import { Base, MACHINE_FRONT, MERGER_FRONT, bumpSolids, floorWorld } from './base';
import {
  buyUpgrade,
  expansionCost,
  gainXp,
  incomePerSecond,
  levelCost,
  levelReady,
  merge,
  mergeNeed,
  padIncome,
  pull,
  sellValue,
  tierUnlocked,
  trackBoost,
  upgradeCost,
} from './economy';
import { FOUNTAIN, OWN_SLOT, SLOTS, STREET, fromPlot, gatePoint, toPlot, type PlotSlot } from './layout';
import { defaultSave, type Owned, type PadSlot, type Save } from './store';
import type { Outfit } from './world';

export type Pose = 'idle' | 'walk' | 'hidden' | 'up' | 'fall' | 'chute' | 'land';

/** What a real server would send about another player, many times a second. */
export interface RemotePlayer {
  id: number;
  name: string;
  slot: number;
  outfit: Outfit;
  x: number;
  y: number;
  z: number;
  facing: number;
  pose: Pose;
  /** How open their parachute is, 0 to 1. */
  chute: number;
  /** Their showcase. */
  pads: (PadSlot | null)[];
  income: number;
  best: number;
  rebirths: number;
  cannon: number;
}

export interface ServerEvent {
  kind: 'join' | 'leave' | 'pull' | 'merge' | 'zone' | 'rebirth' | 'chat';
  name: string;
  text: string;
  /** CSS colour for the highlight, e.g. a rarity colour. */
  color?: string;
}

/** The local player, as the server sees them. */
export interface LocalPlayer {
  name: string;
  income: number;
  best: number;
}

const NAMES = [
  'Mia', 'Leo_77', 'PastaKing', 'Zoe', 'BrainrotBob', 'Luca', 'NinaNoodle', 'Kai', 'SkyDiver99', 'Ari',
  'Gigi', 'Tito_Toast', 'MoonMax', 'Pip', 'CannonCarla', 'Remy', 'Juno', 'Ollie_Op', 'Sunny', 'Vito',
];
const OUTFITS: Outfit[] = [
  { skin: 0xf7c873, shirt: 0x3ccf5a, pants: 0x2b2b3a, cap: 0xffd23f },
  { skin: 0xe0a87a, shirt: 0x8a5cff, pants: 0x2f5fc4, cap: 0xff5fa2 },
  { skin: 0xf7c873, shirt: 0x2f8cff, pants: 0x1fc8b4, cap: 0xffffff },
  { skin: 0xb07a50, shirt: 0xff5f7e, pants: 0x3d2a6b, cap: 0x2f8cff },
  { skin: 0xf2d0a8, shirt: 0xffd23f, pants: 0x8a5cff, cap: 0x3ccf5a },
  { skin: 0x8a5a3a, shirt: 0xffffff, pants: 0xe63946, cap: 0x1d1640 },
  { skin: 0xf7c873, shirt: 0x1fc8b4, pants: 0xff7a1a, cap: 0x8a5cff },
];
const IDLE_CHAT = [
  'anyone got a Legendary yet?',
  'gg',
  'this cannon is so op',
  'how do u get a secret??',
  'brb',
  'my hippo is lvl 5 lol',
  'storm layer is scary',
  'super pulls are worth it fr',
  'merging 10 commons rn',
  'who has the most coins',
  'perfect launch!!',
  'the fountain is pretty',
];
const GREETINGS = ['hi!! 👋', 'welcome to my base!', 'hey there 😄', 'check out my brainrots!', "don't steal anything lol"];
const WOW = ['WOW 😱', 'so lucky!!', 'gg nice pull', 'omg a legendary', 'no way!'];
const THANKS = ['thanks!! 😄', 'ty! took forever', 'hehe thanks', '❤️'];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];
const WALK_SPEED = 6.5;
const RADIUS = 0.45;
const MUZZLE_Y = 3.2;

interface Flight {
  phase: 'charge' | 'up' | 'down' | 'land';
  t: number;
  apex: number;
  tUp: number;
  vy: number;
  terminal: number;
  seed: number;
}

interface Bot extends RemotePlayer {
  save: Save;
  slotRef: PlotSlot;
  path: [number, number][];
  arrive: (() => void) | null;
  wait: number;
  flight: Flight | null;
  /** Seconds online until this bot leaves (Infinity: it stays). */
  leaveIn: number;
  greetCooldown: number;
}

/** A pull lands on display if there's room or it beats a level-1 brainrot there; otherwise it stays in the backpack. */
function display(save: Save, o: Owned): void {
  let pad = save.pads.findIndex((slot) => slot === null);
  if (pad < 0) {
    save.pads.forEach((slot, i) => {
      if (!slot || (slot.level ?? 1) > 1 || slot.rarity >= o.rarity) return;
      if (pad < 0 || slot.rarity < save.pads[pad]!.rarity) pad = i;
    });
    if (pad < 0) return;
    const old = save.pads[pad]!;
    save.inventory.push({ name: old.name, rarity: old.rarity });
  }
  save.inventory.splice(save.inventory.indexOf(o), 1);
  save.pads[pad] = { name: o.name, rarity: o.rarity, cash: 0, level: 1 };
}

/** Gems a run collects: the rows it passes, as Game.spawnRun places them, times how many the bot grabs. */
function gemsFrom(apex: number, grab: number): number {
  const tUp = FLIGHT.ascentTime(apex);
  const v0 = (2 * (apex - MUZZLE_Y)) / tUp;
  const g = v0 / tUp;
  const apexZone = Math.min(zoneIndexAt(apex), MAX_ZONE);
  const floor = apexZone >= 2 ? ZONES[apexZone - 1].from : 14;
  let total = 0;
  let lastY = -Infinity;
  for (let t = 0.6; t < tUp - 0.1; t += FLIGHT.pickupStep) {
    const y = MUZZLE_Y + v0 * t - 0.5 * g * t * t;
    if (y < floor || y - lastY < FLIGHT.pickupMinGap) continue;
    lastY = y;
    const value = ZONES[Math.min(zoneIndexAt(y), MAX_ZONE)].gems;
    if (Math.random() < grab) total += value * (Math.random() < GEMS.bigChance ? GEMS.bigMultiplier : 1);
  }
  return total;
}

/** Spends gems on the best tier it can, up to ten pulls; returns what it got. */
function pullAll(save: Save): Owned[] {
  const got: Owned[] = [];
  for (let n = 0; n < 10; n++) {
    const tier = [...GACHA].reverse().find((t) => tierUnlocked(save, t) && save.gems >= t.cost);
    if (!tier) break;
    // Once the Super pull is open, save up for it rather than spending on Basic.
    if (tier.id === 'basic' && tierUnlocked(save, GACHA[1]) && Math.random() < 0.8) break;
    const one = pull(save, tier);
    if (!one) break;
    got.push(one);
    display(save, one);
  }
  return got;
}

/** Merges everything it can, bottom up; returns what it made that's still around. */
function mergeAll(save: Save): Owned[] {
  const made: Owned[] = [];
  for (let r = 0; r < 4; r++) {
    const need = mergeNeed(r);
    while (need !== null && save.inventory.filter((o) => o.rarity === r).length >= need) {
      const one = merge(save, r);
      if (!one) break;
      made.push(one);
      display(save, one);
    }
  }
  // Leftover Commons and Uncommons nobody will merge soon get sold.
  for (const o of [...save.inventory]) {
    if (o.rarity <= 1 && save.inventory.filter((x) => x.rarity === o.rarity).length > 12) {
      save.inventory.splice(save.inventory.indexOf(o), 1);
      save.coins += sellValue(save, o);
    }
  }
  return made.filter((o) => save.pads.some((p) => p?.name === o.name) || save.inventory.includes(o));
}

/** Buys the cheapest things it can afford, up to `max` of them: upgrades, levels and slots. */
function shop(save: Save, max: number): void {
  for (let n = 0; n < max; n++) {
    const options: { cost: number; buy: () => void }[] = [];
    for (const track of TRACKS) {
      const cost = upgradeCost(save, track);
      if (cost !== null) options.push({ cost, buy: () => buyUpgrade(save, track) });
    }
    for (const slot of save.pads) {
      const cost = slot && levelReady(slot) ? levelCost(slot) : null;
      if (slot && cost !== null) {
        options.push({
          cost,
          buy: () => {
            slot.level = (slot.level ?? 1) + 1;
            slot.xp = 0;
          },
        });
      }
    }
    const pads = expansionCost(save);
    if (pads !== null && save.pads.every(Boolean)) {
      options.push({ cost: pads, buy: () => save.pads.push(...Array.from({ length: ECONOMY.padStep }, () => null)) });
    }
    const choice = options.filter((o) => o.cost <= save.coins).sort((a, b) => a.cost - b.cost)[0];
    if (!choice) return;
    save.coins -= choice.cost;
    choice.buy();
  }
}

/** Plays `minutes` of the game offline, the way the economy simulator does, so a bot joins mid-progress. */
function headStart(save: Save, minutes: number): void {
  let t = 0;
  while (t < minutes * 60) {
    const roll = Math.random();
    const bonus = roll < 0.25 ? CHARGE.perfectBonus : roll < 0.65 ? CHARGE.greenBonus : 0;
    const apex = launchHeight(save.cannon) * (1 + bonus);
    const runTime = 2.2 * FLIGHT.ascentTime(apex) + 20;
    save.coins += incomePerSecond(save) * runTime;
    for (const slot of save.pads) if (slot) gainXp(slot, runTime);
    t += runTime;
    save.flightNo += 1;
    save.gems += Math.round(gemsFrom(apex, save.flightNo === 1 ? 1 : 0.6) * trackBoost(save, 'finder'));
    save.best = Math.max(save.best, apex);
    pullAll(save);
    mergeAll(save);
    shop(save, 50);
  }
}

export class FakeServer {
  readonly name = `Sky-${Math.floor(rand(1000, 9999))}`;
  private bots: Bot[] = [];
  private events: ServerEvent[] = [];
  private nextId = 1;
  private chatIn = rand(25, 50);
  private joinIn: { slot: PlotSlot; at: number }[] = [];
  private time = 0;
  private local: LocalPlayer = { name: 'You', income: 0, best: 0 };

  constructor() {
    // Four of the five other plots start taken; one opens up later.
    const free = SLOTS.filter((s) => s.index !== OWN_SLOT);
    const empty = pick(free);
    for (const slot of free) if (slot !== empty) this.addBot(slot, false);
    this.joinIn.push({ slot: empty, at: rand(40, 90) });
  }

  /** Everyone else on the server. */
  players(): RemotePlayer[] {
    return this.bots;
  }

  /** Events since the last call. */
  drain(): ServerEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  get online(): number {
    return this.bots.length + 1;
  }

  /** The local player's stats, for the leaderboards. */
  setLocal(local: LocalPlayer): void {
    this.local = local;
  }

  /** Everyone, local player included, for the leaderboards. */
  standings(): { name: string; income: number; best: number; you: boolean }[] {
    return [
      { name: this.local.name, income: this.local.income, best: this.local.best, you: true },
      ...this.bots.map((b) => ({ name: b.name, income: b.income, best: b.best, you: false })),
    ];
  }

  /** The local player walked into someone's plot. */
  visit(id: number): void {
    const bot = this.bots.find((b) => b.id === id);
    if (!bot || bot.greetCooldown > 0) return;
    bot.greetCooldown = 90;
    setTimeout(() => this.say(bot, pick(GREETINGS)), rand(600, 1800));
  }

  /** The local player liked one of a bot's brainrots. */
  like(id: number): void {
    const bot = this.bots.find((b) => b.id === id);
    if (bot) setTimeout(() => this.say(bot, pick(THANKS)), rand(500, 1500));
  }

  /** Something big happened to the local player; the server tells everyone. */
  reportLocal(event: { kind: 'pull' | 'zone'; text: string; rarity?: number }): void {
    const color = event.rarity !== undefined ? RARITIES[event.rarity].css : undefined;
    this.events.push({ kind: event.kind, name: this.local.name, text: event.text, color });
    if (event.kind === 'pull' && (event.rarity ?? 0) >= 4 && this.bots.length) {
      const bot = pick(this.bots);
      setTimeout(() => this.say(bot, pick(WOW)), rand(900, 2500));
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const bot of [...this.bots]) this.step(bot, dt);
    // Someone says something now and then.
    this.chatIn -= dt;
    if (this.chatIn <= 0 && this.bots.length) {
      this.chatIn = rand(35, 90);
      this.say(pick(this.bots), pick(IDLE_CHAT));
    }
    for (const j of [...this.joinIn]) {
      if (this.time < j.at) continue;
      this.joinIn.splice(this.joinIn.indexOf(j), 1);
      this.addBot(j.slot, true);
    }
  }

  private say(bot: Bot, text: string): void {
    if (!this.bots.includes(bot)) return;
    this.events.push({ kind: 'chat', name: bot.name, text });
  }

  private addBot(slot: PlotSlot, announce: boolean): void {
    const used = new Set(this.bots.map((b) => b.name));
    const name = pick(NAMES.filter((n) => !used.has(n)));
    const save = defaultSave();
    // A mix of newcomers and veterans.
    const minutes = pick([0, 3, 8, 15, 25, 40, 60]);
    headStart(save, minutes);
    const [x, z] = fromPlot(slot, rand(-6, 6), rand(3, 8));
    const bot: Bot = {
      id: this.nextId++,
      name,
      slot: slot.index,
      slotRef: slot,
      outfit: pick(OUTFITS),
      x,
      y: 0,
      z,
      facing: 0,
      pose: 'idle',
      chute: 0,
      pads: save.pads,
      income: 0,
      best: save.best,
      rebirths: save.rebirths,
      cannon: save.cannon,
      save,
      path: [],
      arrive: null,
      wait: rand(0.5, 3),
      flight: null,
      // Some bots stay all session; others leave after a while.
      leaveIn: Math.random() < 0.4 ? rand(240, 720) : Infinity,
      greetCooldown: 0,
    };
    this.bots.push(bot);
    if (announce) this.events.push({ kind: 'join', name, text: 'joined the game' });
  }

  private removeBot(bot: Bot): void {
    this.bots.splice(this.bots.indexOf(bot), 1);
    this.events.push({ kind: 'leave', name: bot.name, text: 'left the game' });
    // Someone new takes the plot after a while.
    this.joinIn.push({ slot: bot.slotRef, at: this.time + rand(30, 75) });
  }

  private step(bot: Bot, dt: number): void {
    const s = bot.save;
    s.coins += incomePerSecond(s) * dt;
    for (const slot of s.pads) if (slot) gainXp(slot, dt);
    bot.income = incomePerSecond(s);
    bot.best = s.best;
    bot.cannon = s.cannon;
    bot.rebirths = s.rebirths;
    bot.pads = s.pads;
    bot.greetCooldown = Math.max(0, bot.greetCooldown - dt);
    bot.leaveIn -= dt;
    if (bot.leaveIn <= 0 && !bot.flight && !bot.path.length) {
      this.removeBot(bot);
      return;
    }
    if (bot.flight) {
      this.fly(bot, dt);
      return;
    }
    if (bot.wait > 0) {
      bot.wait -= dt;
      bot.pose = 'idle';
      bot.chute = Math.max(0, bot.chute - dt * 2);
      bot.y = floorWorld(bot.x, bot.z);
      return;
    }
    if (bot.path.length) {
      this.walk(bot, dt);
      return;
    }
    const then = bot.arrive;
    bot.arrive = null;
    if (then) then();
    else this.decide(bot);
  }

  private walk(bot: Bot, dt: number): void {
    const [tx, tz] = bot.path[0];
    const dx = tx - bot.x;
    const dz = tz - bot.z;
    const d = Math.hypot(dx, dz);
    bot.pose = 'walk';
    if (d < 0.3) {
      bot.path.shift();
      return;
    }
    const stepLen = Math.min(d, WALK_SPEED * dt);
    let nx = bot.x + (dx / d) * stepLen;
    let nz = bot.z + (dz / d) * stepLen;
    [nx, nz] = bumpSolids(nx, nz, RADIUS);
    // Stuck against something: skip to the next waypoint rather than grind on it.
    if (Math.hypot(nx - bot.x, nz - bot.z) < stepLen * 0.2) bot.path.shift();
    bot.x = nx;
    bot.z = nz;
    bot.y = floorWorld(bot.x, bot.z);
    bot.facing = Math.atan2(-dx, -dz);
  }

  /** A point in the bot's own plot, in world space. */
  private at(bot: Bot, lx: number, lz: number): [number, number] {
    return fromPlot(bot.slotRef, lx, lz);
  }

  /** Waypoints from where the bot is to a plot-space point, through the showcase entrance when that's needed. */
  private route(bot: Bot, lx: number, lz: number): [number, number][] {
    const [, hz] = toPlot(bot.slotRef, bot.x, bot.z);
    const inHall = hz < -9;
    const toHall = lz < -9;
    const path: [number, number][] = [];
    if (inHall !== toHall) path.push(this.at(bot, 0, -8), this.at(bot, 0, -10));
    path.push(this.at(bot, lx, lz));
    return path;
  }

  private go(bot: Bot, path: [number, number][], then: () => void): void {
    bot.path = path;
    bot.arrive = then;
  }

  /** What to do next: pull if it can afford one, merge if it can, otherwise launch, wander, admire or stroll. */
  private decide(bot: Bot): void {
    const s = bot.save;
    shop(s, 3);
    if (s.cannon >= REBIRTH.cannonLevel && Math.random() < 0.25) {
      this.rebirth(bot);
      return;
    }
    const tier = [...GACHA].reverse().find((t) => tierUnlocked(s, t) && s.gems >= t.cost);
    if (tier) {
      this.go(bot, this.route(bot, MACHINE_FRONT.x, MACHINE_FRONT.z), () => {
        bot.wait = 1.6;
        const got = pullAll(s);
        const best = got.reduce<Owned | null>((a, b) => (!a || b.rarity > a.rarity ? b : a), null);
        if (best && best.rarity >= 3) {
          const r = RARITIES[best.rarity];
          this.events.push({ kind: 'pull', name: bot.name, text: `pulled ${r.name === 'Epic' ? 'an' : 'a'} ${r.name.toUpperCase()} ${best.name}!`, color: r.css });
        }
      });
      return;
    }
    const mergeable = [0, 1, 2, 3].some((r) => s.inventory.filter((o) => o.rarity === r).length >= (mergeNeed(r) ?? Infinity));
    if (mergeable) {
      this.go(bot, this.route(bot, MERGER_FRONT.x, MERGER_FRONT.z), () => {
        bot.wait = 1.4;
        const made = mergeAll(s);
        const best = made.reduce<Owned | null>((a, b) => (!a || b.rarity > a.rarity ? b : a), null);
        if (best && best.rarity >= 3) {
          const r = RARITIES[best.rarity];
          this.events.push({ kind: 'merge', name: bot.name, text: `merged a ${r.name.toUpperCase()} ${best.name}!`, color: r.css });
        }
      });
      return;
    }
    const roll = Math.random();
    if (roll < 0.55) {
      // To the cannon and up.
      this.go(bot, this.route(bot, 0, 2.6), () => this.launch(bot));
    } else if (roll < 0.72) {
      // Admire something on display.
      const filled = s.pads.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
      const i = filled.length ? pick(filled) : 0;
      const pad = Base.padPosition(i);
      this.go(bot, this.route(bot, pad.x > 0 ? pad.x - 2.3 : pad.x + 2.3, pad.z), () => (bot.wait = rand(2, 5)));
    } else if (roll < 0.88) {
      // Wander the plaza.
      const a = rand(0, Math.PI * 2);
      const r = rand(3.5, 8.5);
      this.go(bot, this.route(bot, Math.cos(a) * r, Math.abs(Math.sin(a)) * r + 1), () => (bot.wait = rand(1.5, 4)));
    } else {
      // A stroll out into the street and back.
      const [ix, iz] = gatePoint(bot.slotRef, true);
      const [ox, oz] = gatePoint(bot.slotRef, false);
      let sx = rand(-STREET.halfLength + 6, STREET.halfLength - 6);
      const sz = rand(STREET.near + 3, STREET.far - 3);
      if (Math.hypot(sx - FOUNTAIN.x, sz - FOUNTAIN.z) < FOUNTAIN.r + 1) sx += FOUNTAIN.r * 2;
      const back = this.at(bot, rand(-4, 4), rand(4, 9));
      this.go(bot, [...this.route(bot, 0, 10), [ix, iz], [ox, oz], [sx, sz]], () => {
        bot.wait = rand(2, 5);
        bot.arrive = () => this.go(bot, [[ox, oz], [ix, iz], back], () => (bot.wait = rand(1, 3)));
      });
    }
  }

  /** Into the cannon, a short charge, then the flight. */
  private launch(bot: Bot): void {
    const [x, z] = this.at(bot, 0, 0);
    bot.x = x;
    bot.z = z;
    bot.y = MUZZLE_Y;
    bot.pose = 'hidden';
    const roll = Math.random();
    const bonus = roll < 0.25 ? CHARGE.perfectBonus : roll < 0.65 ? CHARGE.greenBonus : 0;
    const apex = launchHeight(bot.save.cannon) * (1 + bonus);
    const tUp = FLIGHT.ascentTime(apex);
    bot.flight = { phase: 'charge', t: rand(0.8, 1.8), apex, tUp, vy: 0, terminal: Math.max(FLIGHT.minTerminal, apex / (tUp * 0.9)), seed: rand(0, 10) };
  }

  private fly(bot: Bot, dt: number): void {
    const f = bot.flight!;
    f.t -= f.phase === 'charge' || f.phase === 'land' ? dt : 0;
    if (f.phase === 'charge') {
      if (f.t <= 0) {
        f.phase = 'up';
        f.t = 0;
      }
      return;
    }
    if (f.phase === 'land') {
      bot.pose = 'land';
      bot.chute = Math.max(0, bot.chute - dt * 2);
      if (f.t <= 0) {
        bot.flight = null;
        bot.wait = 0.5;
        this.landed(bot, f.apex);
      }
      return;
    }
    const [lx0] = toPlot(bot.slotRef, bot.x, bot.z);
    let lx = lx0;
    let [, lz] = toPlot(bot.slotRef, bot.x, bot.z);
    if (f.phase === 'up') {
      f.t += dt;
      const k = Math.min(1, f.t / f.tUp);
      bot.y = MUZZLE_Y + (f.apex - MUZZLE_Y) * (1 - (1 - k) * (1 - k));
      lx = Math.sin(f.t * 0.8 + f.seed) * 6;
      bot.pose = 'up';
      if (k >= 1) {
        f.phase = 'down';
        f.vy = 0;
      }
    } else {
      const chuteOpen = bot.y < Math.max(28, f.apex * 0.25);
      const target = chuteOpen ? FLIGHT.chuteSpeed : f.terminal;
      f.vy += (target - f.vy) * Math.min(1, dt * (chuteOpen ? 3 : 1.2));
      bot.y -= f.vy * dt;
      bot.pose = chuteOpen ? 'chute' : 'fall';
      bot.chute = chuteOpen ? Math.min(1, bot.chute + dt * 3) : 0;
      lz += (3.5 - lz) * Math.min(1, dt * 0.8);
      lx += (lx * 0.6 - lx) * Math.min(1, dt * 0.5);
      if (bot.y <= 0.05) {
        bot.y = 0.04;
        f.phase = 'land';
        f.t = 0.6;
      }
    }
    [bot.x, bot.z] = fromPlot(bot.slotRef, lx, lz);
    bot.facing = 0;
  }

  /** Gems from the run, a new zone maybe, and a walk off the landing spot. */
  private landed(bot: Bot, apex: number): void {
    const s = bot.save;
    const beforeZone = Math.min(zoneIndexAt(s.best), MAX_ZONE);
    s.flightNo += 1;
    s.gems += Math.round(gemsFrom(apex, rand(0.45, 0.8)) * trackBoost(s, 'finder'));
    s.best = Math.max(s.best, apex);
    const zone = Math.min(zoneIndexAt(apex), MAX_ZONE);
    if (zone > beforeZone) {
      const z = ZONES[zone];
      this.events.push({ kind: 'zone', name: bot.name, text: `reached ${z.name}!`, color: `#${z.gemColor.toString(16).padStart(6, '0')}` });
    }
  }

  /** Back to the start for a permanent income bonus, keeping the rarest brainrot, like the player's rebirth. */
  private rebirth(bot: Bot): void {
    const s = bot.save;
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
    this.events.push({ kind: 'rebirth', name: bot.name, text: `rebirthed! ×${1 + s.rebirths * REBIRTH.incomeBonus} income`, color: '#ffd84a' });
  }
}

/** A brainrot on someone else's showcase, for viewing it. */
export function describePad(pad: PadSlot, owner: RemotePlayer): string {
  const save = defaultSave();
  save.rebirths = owner.rebirths;
  return `${owner.name}'s · Lv ${pad.level ?? 1} · ${Math.round(padIncome(save, pad))} coins/s`;
}
