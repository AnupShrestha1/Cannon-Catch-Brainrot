// A fake multiplayer server, simulating a real lobby of this kind of game. The other seven plots are played by
// bots that use the real game rules (the same pull, merge, upgrade and level code and the same costs as the
// player) and behave like people:
//
// - They move like players: they run with momentum, curve through corners, turn at a limited rate, jump a lot
//   while running, look around when they stop, step around each other and get themselves unstuck.
// - The lobby lives: you usually join with three to five others; people leave after realistic sessions (often
//   going AFK first), and matchmaking fills a free slot within seconds to a minute. Newcomers spawn by the
//   fountain at the end of the lane and walk to their plot; some are brand new, most return with saved progress.
// - They're busy: they share the hub with you, so you see them queue for the cannon, dive in and get fired into
//   the sky, crank the gacha machines, stir the cauldron and buy upgrades at the stall.
// - They talk: speech bubbles over heads, short question-and-answer threads, hellos and goodbyes, reactions to
//   big pulls, and comments when they visit someone's base (yours included).
//
// The game only talks to this through the shape a real server would have: snapshots of the other players (who,
// which slot, where, doing what, what's on display, their stats), a stream of events (joins, leaves, big pulls,
// new zones, chat, and actions on shared things: firing the cannon, spinning a machine, stirring the cauldron),
// and a few messages from the local player (their stats, the plot they're visiting, likes, big moments, whether
// they're in the cannon). Swapping in a real server means replacing this file, not the game.
import { CHARGE, FLIGHT, GACHA, GEMS, MAX_ZONE, RARITIES, TRACKS, ZONES, ECONOMY, zoneIndexAt } from './config';
import { Base, bumpSolids, floorWorld } from './base';
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
  flightApex,
  formatMult,
  incomeMultiplier,
  pull,
  putOnPad,
  rebirthCannonLevel,
  rebirthSave,
  sellValue,
  tierUnlocked,
  trackBoost,
  upgradeCost,
} from './economy';
import {
  CANNON_FOOT,
  CAULDRON,
  CAULDRON_FRONT,
  REBIRTH_FRONT,
  FOUNTAIN,
  HUB_EDGE,
  LANE_END,
  LANE_X,
  OWN_SLOT,
  SHOP_FRONT,
  SLOTS,
  fromPlot,
  laneFront,
  plotEntrance,
  plotAt,
  pullPad,
  toPlot,
  type PlotSlot,
} from './layout';
import { defaultSave, type Owned, type PadSlot, type Save } from './store';
import type { Outfit } from './world';

export type Pose = 'idle' | 'walk' | 'hidden' | 'dive' | 'up' | 'fall' | 'chute' | 'land';

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
  kind: 'join' | 'leave' | 'pull' | 'merge' | 'zone' | 'rebirth' | 'chat' | 'act';
  /** For 'act': someone used a shared thing (fired the cannon, spun gacha machine `tier`, stirred the cauldron). */
  act?: 'fire' | 'spin' | 'stir' | 'rebirth';
  tier?: number;
  count?: number;
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

/** Players in one server, the local player included: one per plot. */
export const CAPACITY = SLOTS.length;

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
  'who wants to see my base', 'brb', 'im so rich lol', 'just got cloud kingdom', 'wait for the cannon pls',
  'the cosmic machine looks insane', 'shop guy waved at me lol', 'lucky machine is lucky fr',
];
/** Questions, and answers another player gives a few seconds later. */
const THREADS: [string, string[]][] = [
  ['how do u get gems', ['launch higher, cloud kingdom gems are x3', 'fly through them lol']],
  ['is super pull worth it', ['yes always rare or better', 'ya way better than basic']],
  ['anyone wanna trade', ['no trading yet lol', 'trade what']],
  ['whats the best brainrot', ['frigorifero fenicottero 100%', 'the hippo with the helicopter']],
  ['how do u level up brainrots', ['click level up under them', 'wait for the xp bar then click']],
  ['wheres the merge thing', ['purple pot behind the cannon', 'by the cannon, the bubbling pot']],
  ['how do u unlock the other machines', ['fly higher, it says the height on top', 'reach the height on the sign']],
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
  phase: 'dive' | 'charge' | 'up' | 'down' | 'land';
  t: number;
  /** Where the dive started, and where the run will land. */
  fromX: number;
  fromZ: number;
  landX: number;
  landZ: number;
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
  /** When it last went to the shop stall, so it doesn't run there for every coin. */
  shopAt: number;
}

/** A pull lands on display if there's room or it beats a level-1 brainrot there; otherwise it stays in the backpack. */
function display(save: Save, o: Owned): void {
  let pad = save.pads.findIndex((slot) => slot === null);
  if (pad < 0) {
    save.pads.forEach((slot, i) => {
      if (!slot || slot.rarity >= o.rarity) return;
      if (pad < 0 || slot.rarity < save.pads[pad]!.rarity) pad = i;
    });
    if (pad < 0) return;
    const old = save.pads[pad]!;
    save.inventory.push({ name: old.name, rarity: old.rarity });
  }
  save.inventory.splice(save.inventory.indexOf(o), 1);
  putOnPad(save, pad, o);
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

/**
 * The machine to use now and how many pulls (10 when it can afford ten): the best unlocked tier it can afford,
 * though mostly it saves up when a better machine is open but not yet affordable.
 */
function pickTier(save: Save): { index: number; count: number } | null {
  for (let i = GACHA.length - 1; i >= 0; i--) {
    const tier = GACHA[i];
    if (!tierUnlocked(save, tier) || save.gems < tier.cost) continue;
    const next = GACHA[i + 1];
    if (next && tierUnlocked(save, next) && Math.random() < 0.8) return null;
    return { index: i, count: save.gems >= tier.cost * 10 ? 10 : 1 };
  }
  return null;
}

/** Pulls a machine `count` times (as far as the gems go); returns what it got. */
function pullTier(save: Save, index: number, count: number): Owned[] {
  const got: Owned[] = [];
  for (let n = 0; n < count; n++) {
    const one = pull(save, GACHA[index]);
    if (!one) break;
    got.push(one);
    display(save, one);
  }
  return got;
}

/** Spends gems the way a bot would, for a head start. */
function pullAll(save: Save): void {
  for (let n = 0; n < 20; n++) {
    const choice = pickTier(save);
    if (!choice) return;
    pullTier(save, choice.index, 1);
  }
}

/** Merges everything it can, bottom up; returns what it made that's still around. */
function mergeAll(save: Save): Owned[] {
  const made: Owned[] = [];
  for (let r = 0; r < 6; r++) {
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

/** Buys the cheapest things it can afford, up to `max` of them: upgrades, levels and slots. Returns how many. */
function shop(save: Save, max: number): number {
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
    if (!choice) return n;
    save.coins -= choice.cost;
    choice.buy();
  }
  return max;
}

/** Whether a bot could buy anything right now. */
function canShop(save: Save): boolean {
  const copy = JSON.parse(JSON.stringify(save)) as Save;
  return shop(copy, 1) > 0;
}

/** Plays `minutes` of the game offline, the way the economy simulator does, so a bot joins mid-progress. */
function headStart(save: Save, minutes: number): void {
  let t = 0;
  while (t < minutes * 60) {
    const roll = Math.random();
    const bonus = roll < 0.25 ? CHARGE.perfectBonus : roll < 0.65 ? CHARGE.greenBonus : 0;
    const apex = flightApex(save, bonus);
    const runTime = 2.2 * FLIGHT.ascentTime(apex) + 20;
    save.coins += incomePerSecond(save) * runTime;
    for (const slot of save.pads) if (slot) gainXp(slot, runTime);
    t += runTime;
    save.flightNo += 1;
    save.gems += Math.round(gemsFrom(apex, save.flightNo === 1 ? 1 : 0.6) * trackBoost(save, 'finder'));
    save.best = Math.max(save.best, apex);
    save.bestSinceRebirth = Math.max(save.bestSinceRebirth, apex);
    pullAll(save);
    mergeAll(save);
    shop(save, 50);
  }
}


/** What bots might say back to a chat line, and how likely anyone answers at all (else it's ignored). */
function chatReply(t: string): { lines: string[]; chance: number; greeting?: boolean } | null {
  const has = (re: RegExp) => re.test(t);
  if (has(/\b(hi+|hello+|hey+|yo+|sup|hola|howdy|hai|helo|hiya)\b/)) {
    return { lines: ['hi!', 'hey 👋', 'hello!', 'yo', 'hii', 'heyy', 'hi :D', 'sup'], chance: 0.85, greeting: true };
  }
  if (has(/how (are|r) (you|u)|\bhru\b|\bwyd\b|what'?s up|wassup/)) {
    return { lines: ['good hbu', 'chillin', 'grinding gems lol', 'good! just got a rare', 'tired lol', 'pretty good'], chance: 0.75 };
  }
  if (has(/\b(thanks|thank you|thx|ty|tysm)\b/)) return { lines: ['np', 'np!', 'yw', '👍'], chance: 0.6 };
  if (has(/\b(bye|gtg|cya|see ya|goodbye|g2g)\b/)) return { lines: ['bye!', 'cya', 'bye 👋', 'see ya', 'byee'], chance: 0.7 };
  if (has(/mythic/)) return { lines: ['mythics are super rare', 'cosmic machine has the best mythic odds', 'merge 8 legendaries for one', 'never got one 😭'], chance: 0.7 };
  if (has(/\bgems?\b/)) return { lines: ['launch higher, cloud kingdom gems are x3', 'fly through them lol', 'upgrade gem finder'], chance: 0.65 };
  if (has(/merge|cauldron|pot\b/)) return { lines: ['purple pot behind the cannon', 'merge station by the cannon'], chance: 0.65 };
  if (has(/upgrade|shop|cannon/)) return { lines: ['shop stall next to the cannon', 'upgrade cannon first fr', 'cannon power is the best upgrade'], chance: 0.6 };
  if (has(/rebirth/)) return { lines: ['more money forever', 'x1.5 income but u restart'], chance: 0.6 };
  if (has(/trade|trading/)) return { lines: ['no trading yet lol', 'trade what'], chance: 0.6 };
  if (has(/\b(gg|nice|wow|cool|pog|poggers|lets go|let's go)\b/)) return { lines: ['ty', 'gg', '😄', 'ikr', 'gg'], chance: 0.5 };
  if (has(/\b(lol|lmao|haha+|xd|lmfao)\b/)) return { lines: ['lol', '😂', 'lmao', 'haha'], chance: 0.4 };
  if (t.includes('?')) return { lines: ['idk', 'not sure lol', 'good question', 'no idea', 'try it and see'], chance: 0.45 };
  return { lines: ['lol', 'fr', 'true', 'ok', 'nice', 'same', 'real', '?'], chance: 0.22 };
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
  /** The local player is in the cannon (or diving in): bots wait their turn. */
  private cannonBusy = false;
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

  /** The local player climbed into the cannon (or left it): bots queue while it's taken. */
  setCannonBusy(busy: boolean): void {
    this.cannonBusy = busy;
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

  /**
   * The local player said something in the chat. Like real people, bots answer some things and ignore others:
   * nearly always a hello or a question to them by name, often a question about the game, now and then
   * anything else. Answers come a moment later, as long as it takes to type them.
   */
  localChat(text: string): void {
    this.events.push({ kind: 'chat', name: this.local.name, text });
    const t = text.toLowerCase();
    const named = this.bots.find((b) => !b.afk && !b.leaving && t.includes(b.name.toLowerCase()));
    const reply = chatReply(t);
    if (!reply) return;
    const chance = named ? Math.max(0.85, reply.chance) : reply.chance;
    if (Math.random() > chance) return;
    const first = named ?? this.someone();
    if (!first) return;
    const answer = (bot: Bot, delay: number) => {
      const fresh = reply.lines.filter((l) => !this.recent.includes(l));
      const line = pick(fresh.length ? fresh : reply.lines);
      this.after(delay + line.length * 0.07, () => {
        if (!bot.afk) this.say(bot, line);
      });
    };
    answer(first, rand(1, 2.6));
    // A hello often gets two.
    if (reply.greeting && Math.random() < 0.45) {
      const second = this.someone(first);
      if (second) answer(second, rand(2.4, 4.5));
    }
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
    // Newcomers appear by the fountain at the end of the lane and walk to their plot; people already here are
    // around their plot.
    const a = rand(Math.PI * 1.1, Math.PI * 1.9);
    const [x, z] = joining
      ? [FOUNTAIN.x + Math.cos(a) * (FOUNTAIN.r + rand(1.5, 3)), FOUNTAIN.z + Math.sin(a) * (FOUNTAIN.r + rand(1.5, 3))]
      : fromPlot(slot, rand(-0.8, 0.8), rand(-18, -1));
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
      shopAt: -999,
    };
    this.bots.push(bot);
    if (!joining) return;
    this.events.push({ kind: 'join', name, text: 'joined the game', at: [x, 1, z] });
    // Walk home up the lane.
    this.goHome(bot);
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

  /**
   * Waypoints to a world point: out of the plot it's in (down its aisle, out of the entrance, along its path to
   * the lane), through the lane's mouth when crossing between the lane and the hub, and into the target's plot
   * the same way, so nobody walks through pedestals or over kerbs.
   */
  private route(bot: Bot, tx: number, tz: number): [number, number][] {
    const path: [number, number][] = [];
    let cz = bot.z;
    const add = (p: [number, number]) => {
      if (cz < HUB_EDGE !== p[1] < HUB_EDGE) path.push([LANE_X + rand(-1.5, 1.5), HUB_EDGE - 1.5]);
      path.push(p);
      cz = p[1];
    };
    const from = plotAt(bot.x, bot.z);
    const to = plotAt(tx, tz);
    if (from && from !== to) {
      add(fromPlot(from, 0, Math.min(-0.5, toPlot(from, bot.x, bot.z)[1])));
      add(plotEntrance(from));
      add(laneFront(from));
    }
    if (to && from !== to) {
      add(laneFront(to));
      add(plotEntrance(to));
      add(fromPlot(to, 0, Math.min(-0.5, toPlot(to, tx, tz)[1])));
    }
    add([tx, tz]);
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

  /**
   * What to do next. Bots are busy: they pull when they can afford it, merge when they can, shop at the stall
   * when there's something to buy, and otherwise mostly head for the cannon; now and then they admire their
   * showcase, wander, or visit someone.
   */
  private decide(bot: Bot): void {
    const s = bot.save;
    if (s.cannon >= rebirthCannonLevel(s) && Math.random() < 0.25) {
      // Over to the rebirth station for it.
      this.go(bot, this.route(bot, REBIRTH_FRONT.x + rand(-0.4, 0.4), REBIRTH_FRONT.z + rand(-0.3, 0.3)), () => {
        bot.facing = Math.PI;
        bot.wait = rand(2.5, 4);
        if (bot.save.cannon >= rebirthCannonLevel(bot.save)) this.rebirth(bot);
      });
      return;
    }
    const choice = pickTier(s);
    if (choice) {
      this.usePullPad(bot, choice.index, choice.count);
      return;
    }
    const mergeable = [0, 1, 2, 3, 4, 5].some((r) => s.inventory.filter((o) => o.rarity === r).length >= (mergeNeed(r) ?? Infinity));
    if (mergeable) {
      this.go(bot, this.route(bot, CAULDRON_FRONT.x + rand(-0.4, 0.4), CAULDRON_FRONT.z + rand(-0.4, 0.4)), () => {
        bot.wait = rand(1.2, 2);
        bot.facing = Math.atan2(-(CAULDRON.x - bot.x), -(CAULDRON.z - bot.z));
        this.events.push({ kind: 'act', name: bot.name, text: '', act: 'stir' });
        const made = mergeAll(s);
        const best = made.reduce<Owned | null>((a, b) => (!a || b.rarity > a.rarity ? b : a), null);
        if (best && best.rarity >= 3) {
          const r = RARITIES[best.rarity];
          this.events.push({ kind: 'merge', name: bot.name, text: `merged ${withArticle(best.rarity)} ${best.name}!`, color: r.css });
        }
      });
      return;
    }
    if (canShop(s)) {
      // Off to the stall when it hasn't been for a while; otherwise it buys on the way (like the shop button).
      if (this.time - bot.shopAt > 50) {
        bot.shopAt = this.time;
        this.go(bot, this.route(bot, SHOP_FRONT.x + rand(-0.3, 0.3), SHOP_FRONT.z + rand(-0.8, 0.8)), () => {
          bot.wait = rand(1.5, 3);
          bot.facing = -Math.PI / 2;
          shop(s, 4);
          if (Math.random() < 0.25) this.after(rand(0.5, 1.5), () => this.say(bot, pick(['ka-ching', 'cannon go brrr', 'upgrade time', 'ty shop guy'])));
        });
        return;
      }
      shop(s, 2);
    }
    const roll = Math.random();
    if (roll < 0.62) {
      this.goLaunch(bot);
    } else if (roll < 0.74) {
      // Admire something on display, from the side it faces.
      const filled = s.pads.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
      const pad = Base.padPosition(filled.length ? pick(filled) : 0);
      // In the aisle beside it.
      const [x, z] = this.at(bot, rand(-0.4, 0.4), pad.z + rand(-0.8, 0.8));
      this.go(bot, this.route(bot, x, z), () => (bot.wait = rand(2, 5)));
    } else if (roll < 0.84) {
      const [x, z] = this.at(bot, rand(-0.8, 0.8), rand(-20, -1));
      this.go(bot, this.route(bot, x, z), () => (bot.wait = rand(1.5, 4)));
    } else if (roll < 0.92) {
      this.stroll(bot);
    } else {
      this.visitSomeone(bot);
    }
  }

  /** Over to a gacha machine's ×1 or ×10 pad, a spin, and the results. */
  private usePullPad(bot: Bot, index: number, count: number): void {
    const pad = pullPad(index, count === 10);
    this.go(bot, this.route(bot, pad.x + rand(-0.3, 0.3), pad.z + rand(-0.3, 0.3)), () => {
      // Face the machine and spin it; the results come when it stops.
      bot.facing = Math.PI / 2;
      bot.wait = count > 1 ? rand(2.6, 3.4) : rand(2, 2.8);
      this.events.push({ kind: 'act', name: bot.name, text: '', act: 'spin', tier: index, count });
      this.after(count > 1 ? 1.9 : 1.5, () => {
        if (!this.bots.includes(bot)) return;
        const got = pullTier(bot.save, index, count);
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
    });
  }

  /** Down the lane to the cannon; if it's taken, wait nearby and try again. */
  private goLaunch(bot: Bot): void {
    const x = CANNON_FOOT.x + rand(-0.5, 0.5);
    const z = CANNON_FOOT.z + rand(0, 0.6);
    this.go(bot, this.route(bot, x, z), () => this.tryCannon(bot, 0));
  }

  private tryCannon(bot: Bot, tries: number): void {
    const taken = this.cannonBusy || this.bots.some((b) => b !== bot && b.flight && (b.flight.phase === 'dive' || b.flight.phase === 'charge'));
    if (!taken) {
      this.launch(bot);
      return;
    }
    if (tries > 6) {
      this.goHome(bot);
      return;
    }
    // Queue just behind the cannon, shuffling about.
    if (tries === 0) {
      const a = rand(-0.9, 0.9);
      this.go(bot, [[Math.sin(a) * rand(3.5, 5), CANNON_FOOT.z + Math.cos(a) * rand(1.5, 3)]], () => this.tryCannon(bot, 1));
      return;
    }
    bot.wait = rand(0.6, 1.4);
    bot.arrive = () => this.tryCannon(bot, tries + 1);
  }

  /** A wander down the lane, round the fountain or about the hub, and back. */
  private stroll(bot: Bot): void {
    const r = Math.random();
    const a = rand(0, Math.PI * 2);
    const [x, z]: [number, number] =
      r < 0.35
        ? [FOUNTAIN.x + Math.cos(a) * (FOUNTAIN.r + rand(1.5, 4)), FOUNTAIN.z + Math.sin(a) * (FOUNTAIN.r + rand(1.5, 4))]
        : r < 0.7
          ? [LANE_X + rand(-3, 3), rand(HUB_EDGE + 2, LANE_END - 2)]
          : [rand(-20, 6), rand(-14, 6)];
    this.go(bot, this.route(bot, x, z), () => {
      bot.wait = rand(2, 5);
      bot.arrive = () => this.goHome(bot);
    });
  }

  /** Over to someone else's plot (often the local player's), a look round and maybe a comment, then home. */
  private visitSomeone(bot: Bot): void {
    const hosts = [...this.bots.filter((b) => b !== bot).map((b) => b.slotRef), SLOTS[OWN_SLOT], SLOTS[OWN_SLOT]];
    const host = pick(hosts);
    const [x, z] = fromPlot(host, rand(-0.8, 0.8), Math.random() < 0.4 ? rand(1.5, 3) : rand(-18, -2));
    this.go(bot, this.route(bot, x, z), () => {
      bot.wait = rand(3, 7);
      if (Math.random() < 0.6) {
        // Talk about the host's best brainrot, or just the base if there's nothing on show.
        const yours = host.index === OWN_SLOT;
        const hostBot = this.bots.find((b) => b.slotRef === host);
        const fav = yours ? this.local.favorite : favoriteOf(hostBot?.pads ?? [])?.name ?? '';
        const lines = fav ? VISIT_COMMENTS : VISIT_COMMENTS.filter((l) => !l.includes('{fav}'));
        this.after(rand(0.5, 2), () => this.say(bot, pick(lines).replace('{fav}', fav)));
      }
      bot.arrive = () => this.goHome(bot);
    });
  }

  /** Back to the front of its own plot. */
  private goHome(bot: Bot): void {
    const [x, z] = this.at(bot, rand(-0.8, 0.8), rand(-16, -1));
    this.go(bot, this.route(bot, x, z), () => (bot.wait = rand(0.5, 2)));
  }

  // ---------------------------------------------------------------- flights

  /** A dive into the shared cannon, a short wait inside, then the shot. */
  private launch(bot: Bot): void {
    bot.vx = bot.vz = 0;
    bot.jump = bot.jumpV = 0;
    const roll = Math.random();
    const bonus = roll < 0.25 ? CHARGE.perfectBonus : roll < 0.65 ? CHARGE.greenBonus : 0;
    const apex = flightApex(bot.save, bonus);
    const tUp = FLIGHT.ascentTime(apex);
    bot.flight = {
      phase: 'dive',
      t: 0,
      fromX: bot.x,
      fromZ: bot.z,
      landX: rand(-9, 9),
      landZ: rand(3, 6),
      apex,
      tUp,
      vy: 0,
      terminal: Math.max(FLIGHT.minTerminal, apex / (tUp * 0.9)),
      seed: rand(0, 10),
    };
  }

  private fly(bot: Bot, dt: number): void {
    const f = bot.flight!;
    bot.speed = 0;
    if (f.phase === 'dive') {
      // A leap in an arc from the cannon's foot into the muzzle, head first.
      f.t += dt;
      const k = Math.min(1, f.t / 0.7);
      bot.x = f.fromX * (1 - k);
      bot.z = f.fromZ * (1 - k);
      bot.y = (1 - k) * 0.1 + k * 3.6 + Math.sin(k * Math.PI) * 3;
      bot.facing = 0;
      bot.pose = 'dive';
      if (k >= 1) {
        f.phase = 'charge';
        f.t = rand(0.5, 1.3);
        bot.pose = 'hidden';
        bot.y = MUZZLE_Y;
      }
      return;
    }
    if (f.phase === 'charge' || f.phase === 'land') f.t -= dt;
    if (f.phase === 'charge') {
      if (f.t <= 0) {
        f.phase = 'up';
        f.t = 0;
        this.events.push({ kind: 'act', name: bot.name, text: '', act: 'fire' });
      }
      return;
    }
    if (f.phase === 'land') {
      bot.pose = 'land';
      bot.chute = Math.max(0, bot.chute - dt * 2);
      if (f.t <= 0) {
        bot.flight = null;
        bot.wait = rand(0.3, 1);
        this.landed(bot, f.apex);
        // Often straight back to the cannon for another go.
        bot.arrive = Math.random() < 0.45 && !pickTier(bot.save) ? () => this.goLaunch(bot) : () => this.goHome(bot);
      }
      return;
    }
    if (f.phase === 'up') {
      f.t += dt;
      const k = Math.min(1, f.t / f.tUp);
      bot.y = MUZZLE_Y + (f.apex - MUZZLE_Y) * (1 - (1 - k) * (1 - k));
      bot.x = Math.sin(f.t * 0.8 + f.seed) * 6 * Math.min(1, f.t);
      bot.z = -2;
      bot.pose = 'up';
      if (k >= 1) {
        f.phase = 'down';
        f.vy = 0;
      }
    } else {
      const chuteOpen = bot.y < Math.max(28, f.apex * 0.25);
      // Like the player's: a parachute opened high comes down faster.
      const target = chuteOpen ? FLIGHT.chuteSpeed + Math.max(0, bot.y - 14) * 0.8 : f.terminal;
      f.vy += (target - f.vy) * Math.min(1, dt * (chuteOpen ? 3 : 1.2));
      bot.y -= f.vy * dt;
      bot.pose = chuteOpen ? 'chute' : 'fall';
      bot.chute = chuteOpen ? Math.min(1, bot.chute + dt * 3) : 0;
      bot.z += (f.landZ - bot.z) * Math.min(1, dt * 0.8);
      bot.x += (f.landX - bot.x) * Math.min(1, dt * 0.5);
      if (bot.y <= 0.05) {
        bot.y = 0.06;
        f.phase = 'land';
        f.t = 0.6;
      }
    }
    bot.facing = 0;
  }

  /** Gems from the run, a new zone maybe. */
  private landed(bot: Bot, apex: number): void {
    const s = bot.save;
    const beforeZone = Math.min(zoneIndexAt(s.best), MAX_ZONE);
    s.flightNo += 1;
    s.gems += Math.round(gemsFrom(apex, rand(0.45, 0.8)) * trackBoost(s, 'finder'));
    s.best = Math.max(s.best, apex);
    s.bestSinceRebirth = Math.max(s.bestSinceRebirth, apex);
    const zone = Math.min(zoneIndexAt(apex), MAX_ZONE);
    if (zone > beforeZone) {
      const z = ZONES[zone];
      this.events.push({ kind: 'zone', name: bot.name, text: `reached ${z.name}!`, color: `#${z.gemColor.toString(16).padStart(6, '0')}` });
    }
  }

  /** Back to the start for a permanent income bonus, keeping the rarest brainrot, like the player's rebirth. */
  private rebirth(bot: Bot): void {
    const s = bot.save;
    const { newFloor } = rebirthSave(s);
    this.events.push({ kind: 'act', name: bot.name, text: '', act: 'rebirth' });
    this.events.push({
      kind: 'rebirth',
      name: bot.name,
      text: `rebirthed! ×${formatMult(incomeMultiplier(s))} income${newFloor ? ' and a new floor' : ''}`,
      color: '#ffd84a',
    });
    if (Math.random() < 0.6) this.after(1.5, () => this.say(bot, pick(['REBIRTH LETS GO', 'new floor!!', 'finally rebirthed', 'ez'])));
    this.react(bot);
  }
}

/** A brainrot on someone else's showcase, for viewing it. */
export function describePad(pad: PadSlot, owner: RemotePlayer): string {
  const save = defaultSave();
  save.rebirths = owner.rebirths;
  return `${owner.name}'s · Lv ${pad.level ?? 1} · ${Math.round(padIncome(save, pad))} coins/s`;
}
