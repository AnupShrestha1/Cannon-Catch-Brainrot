// A fake multiplayer server, simulating a real lobby of this kind of game. The other five plots are played by
// bots that use the real game rules (the same pull, merge, upgrade and level code and the same costs as the
// player) and behave like people:
//
// - They move like players: they run with momentum, curve through corners, turn at a limited rate, jump a lot
//   while running, look around when they stop, step around each other and get themselves unstuck.
// - The lobby lives: you usually join with three to five others; people leave after realistic sessions (often
//   going AFK first), and matchmaking fills a free slot within seconds to a minute. Newcomers spawn in the
//   street and walk to their plot; some are brand new, most are returning with saved progress.
// - They talk: speech bubbles over heads, short question-and-answer threads, hellos and goodbyes, reactions to
//   big pulls, and comments when they visit someone's base (yours included).
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
import { FOUNTAIN, OWN_SLOT, SLOTS, STREET, fromPlot, gatePoint, plotAt, toPlot, type PlotSlot } from './layout';
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
  /** Ground speed, for the stride. */
  speed: number;
  /** Height of a jump above the floor (0 when not jumping). */
  jump: number;
  /** How open their parachute is, 0 to 1. */
  chute: number;
  /** Away from keyboard: standing still, tagged AFK. */
  afk: boolean;
  /** What they said last, while it's still showing over their head ('' for nothing). */
  bubble: string;
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
  /** Where it happened, for effects (a leaving player's puff). */
  at?: [number, number, number];
}

/** The local player, as the server sees them. */
export interface LocalPlayer {
  name: string;
  income: number;
  best: number;
  /** Their best brainrot on display, for visitors to talk about. */
  favorite: string;
}

/** Players in one server, the local player included. */
export const CAPACITY = 6;

const NAMES = [
  'Mia', 'Leo_77', 'PastaKing', 'Zoe', 'BrainrotBob', 'Luca', 'NinaNoodle', 'Kai', 'SkyDiver99', 'Ari',
  'Gigi', 'Tito_Toast', 'MoonMax', 'Pip', 'CannonCarla', 'Remy', 'Juno', 'Ollie_Op', 'Sunny', 'Vito',
  'xXSkyLordXx', 'bean', 'Noodle_Ninja', 'tungtung', 'Lily.exe', 'GelatoGuy', 'FrostyFox', 'zappy', 'Benji',
  'cocoa_puff', 'MaxPower', 'IvyLeaf', 'DinoDan', 'pixel_pam',
];
const OUTFITS: Outfit[] = [
  { skin: 0xf7c873, shirt: 0x3ccf5a, pants: 0x2b2b3a, cap: 0xffd23f },
  { skin: 0xe0a87a, shirt: 0x8a5cff, pants: 0x2f5fc4, cap: 0xff5fa2 },
  { skin: 0xf7c873, shirt: 0x2f8cff, pants: 0x1fc8b4, cap: 0xffffff },
  { skin: 0xb07a50, shirt: 0xff5f7e, pants: 0x3d2a6b, cap: 0x2f8cff },
  { skin: 0xf2d0a8, shirt: 0xffd23f, pants: 0x8a5cff, cap: 0x3ccf5a },
  { skin: 0x8a5a3a, shirt: 0xffffff, pants: 0xe63946, cap: 0x1d1640 },
  { skin: 0xf7c873, shirt: 0x1fc8b4, pants: 0xff7a1a, cap: 0x8a5cff },
  { skin: 0xd9a066, shirt: 0x1d1640, pants: 0x6b6b7a, cap: 0xff7a1a },
];

/** Lines people say out of nowhere. */
const IDLE_CHAT = [
  'gg', 'this cannon is so op', 'storm layer is scary', 'super pulls are worth it fr', 'merging 10 commons rn',
  'perfect launch!!', 'lol', 'my hippo is lvl 5', 'the fountain is pretty', 'bruh i crashed', 'so close to legendary',
  'who wants to see my base', 'brb', 'im so rich lol', 'just got cloud kingdom',
];
/** Questions, and answers another player gives a few seconds later. */
const THREADS: [string, string[]][] = [
  ['how do u get gems', ['launch higher, cloud kingdom gems are x3', 'fly through them lol']],
  ['is super pull worth it', ['yes always rare or better', 'ya way better than basic']],
  ['anyone wanna trade', ['no trading yet lol', 'trade what']],
  ['whats the best brainrot', ['frigorifero fenicottero 100%', 'the hippo with the helicopter']],
  ['how do u level up brainrots', ['click level up under them', 'wait for the xp bar then click']],
  ['wheres the merge thing', ['purple pot next to ur cannon', 'right of the cannon']],
  ['how high can u go', ['storm layer at like 400m', 'idk 400 something']],
  ['what does rebirth do', ['more money forever', 'x1.5 income but u restart']],
];
const WELCOME = ['hi', 'hii', 'welcome!', 'yo', 'hey {name}', 'hi {name} 👋'];
const BYE = ['gtg bye', 'bye guys', 'cya', 'gotta go eat', 'bye!'];
const GREETINGS = ['hi!! 👋', 'welcome to my base!', 'hey there 😄', 'check out my brainrots!', "don't steal anything lol"];
const WOW = ['WOW 😱', 'so lucky!!', 'gg', 'omg a legendary', 'no way!', 'lucky'];
const THANKS = ['thanks!! 😄', 'ty! took forever', 'hehe thanks', '❤️'];
const VISIT_COMMENTS = ['nice base', 'how did u get {fav}', 'cool {fav}!', 'ur base is cool', 'wow {fav}'];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];
const RADIUS = 0.45;
const MUZZLE_Y = 3.2;
/** How long a speech bubble stays up. */
const BUBBLE_SECONDS = 5;
const JUMP_SPEED = 9;
const GRAVITY = 30;

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
  /** Where it's heading, as world points; the steering cuts corners between them. */
  path: [number, number][];
  arrive: (() => void) | null;
  wait: number;
  flight: Flight | null;
  vx: number;
  vz: number;
  /** This player's running speed; some are faster than others. */
  runSpeed: number;
  jumpV: number;
  /** Seconds of making no headway, for getting unstuck. */
  stuck: number;
  /** Where it's looking while it stands still, and when it looks somewhere else. */
  lookAt: number;
  lookIn: number;
  spin: number;
  bubbleTtl: number;
  /** Seconds left in this session; going AFK first, then gone. */
  session: number;
  afkFor: number;
  nextAfkIn: number;
  leaving: boolean;
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


/** How long a player stays this session: a quick look, a normal session, or in for the long haul. */
function sessionLength(): number {
  const r = Math.random();
  if (r < 0.3) return rand(180, 480);
  if (r < 0.75) return rand(480, 1200);
  return rand(1200, 3600);
}

/** "a RARE", "an EPIC". */
function withArticle(rarity: number): string {
  const name = RARITIES[rarity].name;
  return `${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name.toUpperCase()}`;
}

/** The best brainrot on a showcase, or null. */
function favoriteOf(pads: (PadSlot | null)[]): PadSlot | null {
  return pads.reduce<PadSlot | null>((a, b) => (b && (!a || b.rarity > a.rarity) ? b : a), null);
}

/** Turns an angle toward a target by at most `step`, the short way round. */
function turnToward(from: number, to: number, step: number): number {
  const diff = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + Math.max(-step, Math.min(step, diff));
}

export class FakeServer {
  readonly name = `Sky-${Math.floor(rand(1000, 9999))}`;
  private bots: Bot[] = [];
  private events: ServerEvent[] = [];
  private nextId = 1;
  private chatIn = rand(12, 30);
  private joins: { slot: PlotSlot; at: number }[] = [];
  private later: { at: number; run: () => void }[] = [];
  private time = 0;
  private local: LocalPlayer = { name: 'You', income: 0, best: 0, favorite: '' };
  /** Lines said lately, so nobody repeats them for a while. */
  private recent: string[] = [];

  constructor() {
    // You usually join a server that already has three to five people in it; the rest fill up soon.
    const free = SLOTS.filter((s) => s.index !== OWN_SLOT).sort(() => Math.random() - 0.5);
    const others = pick([3, 4, 4, 5, 5]);
    free.forEach((slot, i) => {
      if (i < others) this.addBot(slot, false);
      else this.joins.push({ slot, at: rand(10, 45) });
    });
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

  /** The local player's stats, for the leaderboards and for visitors to talk about. */
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
    if (!bot || bot.greetCooldown > 0 || bot.afk) return;
    bot.greetCooldown = 90;
    this.after(rand(0.6, 1.8), () => this.say(bot, pick(GREETINGS)));
  }

  /** The local player liked one of a bot's brainrots. */
  like(id: number): void {
    const bot = this.bots.find((b) => b.id === id);
    if (bot && !bot.afk) this.after(rand(0.5, 1.5), () => this.say(bot, pick(THANKS)));
  }

  /** Something big happened to the local player; the server tells everyone, and someone may react. */
  reportLocal(event: { kind: 'pull' | 'zone'; text: string; rarity?: number }): void {
    const color = event.rarity !== undefined ? RARITIES[event.rarity].css : undefined;
    this.events.push({ kind: event.kind, name: this.local.name, text: event.text, color });
    if (event.kind === 'pull' && (event.rarity ?? 0) >= 4) this.react();
  }

  update(dt: number): void {
    this.time += dt;
    for (const job of [...this.later]) {
      if (this.time < job.at) continue;
      this.later.splice(this.later.indexOf(job), 1);
      job.run();
    }
    for (const bot of [...this.bots]) this.step(bot, dt);
    this.chatter(dt);
    for (const j of [...this.joins]) {
      if (this.time < j.at) continue;
      this.joins.splice(this.joins.indexOf(j), 1);
      this.addBot(j.slot, true);
    }
  }

  // ---------------------------------------------------------------- the lobby

  private after(seconds: number, run: () => void): void {
    this.later.push({ at: this.time + seconds, run });
  }

  private addBot(slot: PlotSlot, joining: boolean): void {
    const used = new Set(this.bots.map((b) => b.name));
    const name = pick(NAMES.filter((n) => !used.has(n)));
    // Everyone in the lobby looks different.
    const worn = new Set(this.bots.map((b) => b.outfit));
    const outfit = pick(OUTFITS.filter((o) => !worn.has(o)));
    const save = defaultSave();
    // Most players come back to saved progress; some are brand new. People already here have been playing.
    const returning = !joining || Math.random() < 0.65;
    if (returning) headStart(save, pick([3, 8, 15, 25, 40, 60, 90]));
    // Newcomers appear in the street by the fountain and walk to their plot; people already here are home.
    const a = rand(0, Math.PI * 2);
    const [x, z] = joining
      ? [FOUNTAIN.x + Math.cos(a) * (FOUNTAIN.r + rand(1, 2.5)), FOUNTAIN.z + Math.sin(a) * (FOUNTAIN.r + rand(1, 2.5))]
      : fromPlot(slot, rand(-6, 6), rand(3, 8));
    const bot: Bot = {
      id: this.nextId++,
      name,
      slot: slot.index,
      slotRef: slot,
      outfit,
      x,
      y: floorWorld(x, z),
      z,
      facing: rand(-Math.PI, Math.PI),
      pose: 'idle',
      speed: 0,
      jump: 0,
      chute: 0,
      afk: false,
      bubble: '',
      pads: save.pads,
      income: incomePerSecond(save),
      best: save.best,
      rebirths: save.rebirths,
      cannon: save.cannon,
      save,
      path: [],
      arrive: null,
      wait: rand(0.3, 2),
      flight: null,
      vx: 0,
      vz: 0,
      runSpeed: rand(7, 9.5),
      jumpV: 0,
      stuck: 0,
      lookAt: 0,
      lookIn: 0,
      spin: 0,
      bubbleTtl: 0,
      // Someone already here is partway through their session.
      session: sessionLength() * (joining ? 1 : rand(0.15, 1)),
      afkFor: 0,
      nextAfkIn: rand(240, 900),
      leaving: false,
      greetCooldown: 0,
    };
    this.bots.push(bot);
    if (!joining) return;
    this.events.push({ kind: 'join', name, text: 'joined the game', at: [x, 1, z] });
    // Walk home through the gate.
    const [ox, oz] = gatePoint(slot, false);
    const [ix, iz] = gatePoint(slot, true);
    this.go(bot, [[ox, oz], [ix, iz], this.at(bot, rand(-5, 5), rand(4, 9))], () => (bot.wait = rand(0.5, 2)));
    // A couple of people say hi.
    const others = this.bots.filter((b) => b !== bot && !b.afk).sort(() => Math.random() - 0.5);
    others.slice(0, Math.random() < 0.5 ? 1 : 2).forEach((other, i) => {
      this.after(rand(2, 4) + i * rand(1, 3), () => this.say(other, pick(WELCOME).replace('{name}', name)));
    });
  }

  private removeBot(bot: Bot): void {
    if (!this.bots.includes(bot)) return;
    this.bots.splice(this.bots.indexOf(bot), 1);
    this.events.push({ kind: 'leave', name: bot.name, text: 'left the game', at: [bot.x, bot.y + 1, bot.z] });
    // Matchmaking fills the slot: usually within a minute, now and then it stays open a while.
    const wait = Math.random() < 0.8 ? rand(10, 45) : rand(60, 140);
    this.joins.push({ slot: bot.slotRef, at: this.time + wait });
  }

  /** At the end of their session: half go AFK for a bit first, some say bye, then they're gone. */
  private startLeaving(bot: Bot): void {
    bot.leaving = true;
    if (Math.random() < 0.5) {
      bot.afk = true;
      bot.afkFor = rand(30, 90);
      bot.path = [];
      bot.arrive = null;
      return;
    }
    if (Math.random() < 0.6) this.say(bot, pick(BYE));
    this.after(rand(1.5, 4), () => this.removeBot(bot));
  }

  // ---------------------------------------------------------------- talking

  private say(bot: Bot, text: string): void {
    if (!this.bots.includes(bot)) return;
    bot.bubble = text;
    bot.bubbleTtl = BUBBLE_SECONDS;
    this.events.push({ kind: 'chat', name: bot.name, text });
    this.recent.push(text);
    if (this.recent.length > 12) this.recent.shift();
  }

  /** Someone who isn't AFK, other than `not`. */
  private someone(not?: Bot): Bot | null {
    const pool = this.bots.filter((b) => b !== not && !b.afk && !b.leaving);
    return pool.length ? pick(pool) : null;
  }

  /** A big pull somewhere: half the time, someone says something. */
  private react(not?: Bot): void {
    const bot = this.someone(not);
    if (bot && Math.random() < 0.6) this.after(rand(1, 3), () => this.say(bot, pick(WOW)));
  }

  /** Every so often: a question someone else answers, or a passing remark. */
  private chatter(dt: number): void {
    this.chatIn -= dt;
    if (this.chatIn > 0) return;
    this.chatIn = rand(20, 55);
    const asker = this.someone();
    if (!asker) return;
    if (Math.random() < 0.45) {
      const threads = THREADS.filter(([q]) => !this.recent.includes(q));
      if (!threads.length) return;
      const [q, answers] = pick(threads);
      this.say(asker, q);
      const answerer = this.someone(asker);
      if (answerer) this.after(rand(2.5, 5.5), () => this.say(answerer, pick(answers)));
    } else {
      const lines = IDLE_CHAT.filter((l) => !this.recent.includes(l));
      if (lines.length) this.say(asker, pick(lines));
    }
  }

  // ---------------------------------------------------------------- each player, each frame

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
    bot.bubbleTtl -= dt;
    if (bot.bubbleTtl <= 0) bot.bubble = '';
    if (bot.flight) {
      this.fly(bot, dt);
      return;
    }
    // Jumps, wherever they are.
    if (bot.jumpV !== 0 || bot.jump > 0) {
      bot.jump += bot.jumpV * dt;
      bot.jumpV -= GRAVITY * dt;
      if (bot.jump <= 0) {
        bot.jump = 0;
        bot.jumpV = 0;
      }
    }
    bot.y = floorWorld(bot.x, bot.z) + bot.jump;
    bot.session -= dt;
    if (bot.session <= 0 && !bot.leaving) this.startLeaving(bot);
    if (bot.afk) {
      this.idle(bot, dt, true);
      bot.afkFor -= dt;
      if (bot.afkFor <= 0) {
        bot.afk = false;
        if (bot.leaving) this.removeBot(bot);
      }
      return;
    }
    if (bot.leaving) {
      this.idle(bot, dt, false);
      return;
    }
    bot.nextAfkIn -= dt;
    if (bot.nextAfkIn <= 0 && !bot.path.length) {
      // Stepped away from the keyboard for a minute or two.
      bot.nextAfkIn = rand(300, 900);
      bot.afk = true;
      bot.afkFor = rand(40, 120);
      return;
    }
    if (bot.wait > 0) {
      bot.wait -= dt;
      this.idle(bot, dt, false);
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

  /** Standing still: slowing to a stop, looking around, the odd jump or spin. */
  private idle(bot: Bot, dt: number, afk: boolean): void {
    const k = Math.exp(-10 * dt);
    bot.vx *= k;
    bot.vz *= k;
    bot.speed = Math.hypot(bot.vx, bot.vz);
    bot.pose = 'idle';
    if (afk) return;
    bot.lookIn -= dt;
    if (bot.lookIn <= 0) {
      bot.lookIn = rand(0.8, 2.8);
      bot.lookAt = bot.facing + rand(-1.4, 1.4);
    }
    if (bot.spin > 0) {
      bot.spin -= dt;
      bot.facing += 9 * dt;
    } else {
      bot.facing = turnToward(bot.facing, bot.lookAt, 3 * dt);
      if (Math.random() < dt * 0.02) bot.spin = rand(0.5, 1.2);
    }
    if (bot.jump === 0 && Math.random() < dt * 0.08) bot.jumpV = JUMP_SPEED;
  }

  /**
   * Running along the path with momentum: aiming a little ahead so corners are cut into curves, easing in
   * and out, turning at a limited rate, stepping around other players and around anything it gets stuck on.
   */
  private walk(bot: Bot, dt: number): void {
    while (bot.path.length > 1 && Math.hypot(bot.path[0][0] - bot.x, bot.path[0][1] - bot.z) < 2.2) bot.path.shift();
    const [tx, tz] = bot.path[0];
    const dx = tx - bot.x;
    const dz = tz - bot.z;
    const d = Math.hypot(dx, dz);
    const last = bot.path.length === 1;
    if (last && d < 0.4) {
      bot.path.shift();
      return;
    }
    const want = bot.runSpeed * (last ? Math.min(1, d / 2.5) : 1);
    // A gentle weave on long stretches, the way people drift when they run, fading out near the target.
    const weave = Math.sin(this.time * 1.3 + bot.id * 2.3) * 0.28 * Math.min(1, Math.max(0, (d - 3) / 4));
    const wx = dx / d - (dz / d) * weave;
    const wz = dz / d + (dx / d) * weave;
    const wl = Math.hypot(wx, wz);
    const k = 1 - Math.exp(-5 * dt);
    bot.vx += ((wx / wl) * want - bot.vx) * k;
    bot.vz += ((wz / wl) * want - bot.vz) * k;
    // Give other players a little room.
    for (const other of this.bots) {
      if (other === bot || other.flight) continue;
      const ox = bot.x - other.x;
      const oz = bot.z - other.z;
      const od = Math.hypot(ox, oz);
      if (od > 0.01 && od < 1.4) {
        bot.vx += (ox / od) * (1.4 - od) * 6 * dt;
        bot.vz += (oz / od) * (1.4 - od) * 6 * dt;
      }
    }
    const fromX = bot.x;
    const fromZ = bot.z;
    [bot.x, bot.z] = bumpSolids(bot.x + bot.vx * dt, bot.z + bot.vz * dt, RADIUS);
    const moved = Math.hypot(bot.x - fromX, bot.z - fromZ);
    bot.speed = moved / Math.max(dt, 1e-4);
    // Stuck on something: try a sidestep, then give up on that waypoint.
    if (moved < want * dt * 0.25) {
      bot.stuck += dt;
      if (bot.stuck > 0.5) {
        bot.stuck = 0;
        if (bot.path.length > 1 || Math.random() < 0.5) {
          const side = Math.random() < 0.5 ? 1 : -1;
          bot.path.unshift([bot.x - (dz / d) * 2 * side, bot.z + (dx / d) * 2 * side]);
        } else {
          bot.path.shift();
        }
      }
    } else {
      bot.stuck = 0;
    }
    if (bot.speed > 0.4) bot.facing = turnToward(bot.facing, Math.atan2(-bot.vx, -bot.vz), 10 * dt);
    // Players jump a lot while they run.
    if (bot.jump === 0 && Math.random() < dt * 0.3) bot.jumpV = JUMP_SPEED;
    bot.pose = bot.speed > 0.5 ? 'walk' : 'idle';
  }

  /** A point in the bot's own plot, in world space. */
  private at(bot: Bot, lx: number, lz: number): [number, number] {
    return fromPlot(bot.slotRef, lx, lz);
  }

  /** Waypoints to a point in a plot, through the showcase entrance when that's needed. */
  private route(bot: Bot, lx: number, lz: number, slot: PlotSlot = bot.slotRef): [number, number][] {
    const here = plotAt(bot.x, bot.z);
    const inHall = here === slot && toPlot(slot, bot.x, bot.z)[1] < -9;
    const toHall = lz < -9;
    const path: [number, number][] = [];
    if (inHall !== toHall) path.push(fromPlot(slot, 0, -8), fromPlot(slot, 0, -10.5));
    path.push(fromPlot(slot, lx, lz));
    return path;
  }

  /** Sets off along waypoints, with a little sideways wander added to long stretches so no two trips match. */
  private go(bot: Bot, points: [number, number][], then: () => void): void {
    const path: [number, number][] = [];
    let [px, pz] = [bot.x, bot.z];
    for (const [x, z] of points) {
      const len = Math.hypot(x - px, z - pz);
      if (len > 7) {
        const off = rand(-1.6, 1.6);
        path.push([(px + x) / 2 - ((z - pz) / len) * off, (pz + z) / 2 + ((x - px) / len) * off]);
      }
      path.push([x, z]);
      [px, pz] = [x, z];
    }
    bot.path = path;
    bot.arrive = then;
  }

  /** What to do next: pull if it can afford one, merge if it can, otherwise launch, potter about, or visit. */
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
        bot.wait = rand(1.4, 2.4);
        const got = pullAll(s);
        const best = got.reduce<Owned | null>((a, b) => (!a || b.rarity > a.rarity ? b : a), null);
        if (best && best.rarity >= 3) {
          const r = RARITIES[best.rarity];
          this.events.push({ kind: 'pull', name: bot.name, text: `pulled ${withArticle(best.rarity)} ${best.name}!`, color: r.css });
          if (best.rarity >= 4) {
            this.after(1, () => this.say(bot, pick(['LETS GOOO', 'YESSS', 'finally!!', 'omg omg'])));
            this.react(bot);
          }
        }
      });
      return;
    }
    const mergeable = [0, 1, 2, 3].some((r) => s.inventory.filter((o) => o.rarity === r).length >= (mergeNeed(r) ?? Infinity));
    if (mergeable) {
      this.go(bot, this.route(bot, MERGER_FRONT.x, MERGER_FRONT.z), () => {
        bot.wait = rand(1.2, 2);
        const made = mergeAll(s);
        const best = made.reduce<Owned | null>((a, b) => (!a || b.rarity > a.rarity ? b : a), null);
        if (best && best.rarity >= 3) {
          const r = RARITIES[best.rarity];
          this.events.push({ kind: 'merge', name: bot.name, text: `merged ${withArticle(best.rarity)} ${best.name}!`, color: r.css });
        }
      });
      return;
    }
    const roll = Math.random();
    if (roll < 0.45) {
      // To the cannon and up.
      this.go(bot, this.route(bot, 0, 2.6), () => this.launch(bot));
    } else if (roll < 0.6) {
      // Admire something on display.
      const filled = s.pads.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
      const pad = Base.padPosition(filled.length ? pick(filled) : 0);
      this.go(bot, this.route(bot, pad.x > 0 ? pad.x - 2.4 : pad.x + 2.4, pad.z), () => (bot.wait = rand(2, 5)));
    } else if (roll < 0.74) {
      // Potter about the plaza.
      const a = rand(0, Math.PI * 2);
      const r = rand(3.5, 8.5);
      this.go(bot, this.route(bot, Math.cos(a) * r, Math.abs(Math.sin(a)) * r + 1), () => (bot.wait = rand(1.5, 4)));
    } else if (roll < 0.84) {
      this.stroll(bot);
    } else {
      this.visitSomeone(bot);
    }
  }

  /** Out into the street for a look around, and back. */
  private stroll(bot: Bot): void {
    const [ix, iz] = gatePoint(bot.slotRef, true);
    const [ox, oz] = gatePoint(bot.slotRef, false);
    let sx = rand(-STREET.halfLength + 6, STREET.halfLength - 6);
    const sz = rand(STREET.near + 3, STREET.far - 3);
    if (Math.hypot(sx - FOUNTAIN.x, sz - FOUNTAIN.z) < FOUNTAIN.r + 1) sx += FOUNTAIN.r * 2;
    this.go(bot, [...this.route(bot, 0, 10), [ix, iz], [ox, oz], [sx, sz]], () => {
      bot.wait = rand(2, 5);
      bot.arrive = () => this.goHome(bot);
    });
  }

  /** Over to someone else's base (often the local player's), a look around and maybe a comment, then home. */
  private visitSomeone(bot: Bot): void {
    const hosts = [...this.bots.filter((b) => b !== bot).map((b) => b.slotRef), SLOTS[OWN_SLOT], SLOTS[OWN_SLOT]];
    const host = pick(hosts);
    const [ix, iz] = gatePoint(bot.slotRef, true);
    const [ox, oz] = gatePoint(bot.slotRef, false);
    const [hox, hoz] = gatePoint(host, false);
    const [hix, hiz] = gatePoint(host, true);
    const inside = Math.random() < 0.6 ? fromPlot(host, rand(-6, 6), rand(4, 9)) : fromPlot(host, rand(-1, 1), rand(-12, -20));
    const viaHall = toPlot(host, inside[0], inside[1])[1] < -9 ? [fromPlot(host, 0, -8)] : [];
    this.go(bot, [...this.route(bot, 0, 10), [ix, iz], [ox, oz], [hox, hoz], [hix, hiz], ...viaHall, inside], () => {
      bot.wait = rand(3, 7);
      if (Math.random() < 0.6) {
        // Talk about the host's best brainrot, or just the base if there's nothing on show.
        const yours = host.index === OWN_SLOT;
        const hostBot = this.bots.find((b) => b.slotRef === host);
        const fav = yours ? this.local.favorite : favoriteOf(hostBot?.pads ?? [])?.name ?? '';
        const lines = fav ? VISIT_COMMENTS : VISIT_COMMENTS.filter((l) => !l.includes('{fav}'));
        this.after(rand(0.5, 2), () => this.say(bot, pick(lines).replace('{fav}', fav)));
      }
      bot.arrive = () => {
        const out: [number, number][] = [...viaHall.reverse(), [hix, hiz], [hox, hoz]];
        this.go(bot, out, () => this.goHome(bot));
      };
    });
  }

  /** From the street back in through the gate to the plaza. */
  private goHome(bot: Bot): void {
    const [ox, oz] = gatePoint(bot.slotRef, false);
    const [ix, iz] = gatePoint(bot.slotRef, true);
    this.go(bot, [[ox, oz], [ix, iz], this.at(bot, rand(-5, 5), rand(4, 9))], () => (bot.wait = rand(1, 3)));
  }

  // ---------------------------------------------------------------- flights

  /** Into the cannon, a short charge, then the flight. */
  private launch(bot: Bot): void {
    const [x, z] = this.at(bot, 0, 0);
    bot.x = x;
    bot.z = z;
    bot.y = MUZZLE_Y;
    bot.vx = bot.vz = 0;
    bot.jump = bot.jumpV = 0;
    bot.pose = 'hidden';
    const roll = Math.random();
    const bonus = roll < 0.25 ? CHARGE.perfectBonus : roll < 0.65 ? CHARGE.greenBonus : 0;
    const apex = launchHeight(bot.save.cannon) * (1 + bonus);
    const tUp = FLIGHT.ascentTime(apex);
    bot.flight = { phase: 'charge', t: rand(0.8, 1.8), apex, tUp, vy: 0, terminal: Math.max(FLIGHT.minTerminal, apex / (tUp * 0.9)), seed: rand(0, 10) };
  }

  private fly(bot: Bot, dt: number): void {
    const f = bot.flight!;
    bot.speed = 0;
    if (f.phase === 'charge' || f.phase === 'land') f.t -= dt;
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
        bot.wait = 0.4;
        this.landed(bot, f.apex);
      }
      return;
    }
    let [lx, lz] = toPlot(bot.slotRef, bot.x, bot.z);
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

  /** Gems from the run, a new zone maybe. */
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
