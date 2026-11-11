// How the server's other players talk. Each one has a way of typing (a persona: an all-lowercase Gen Z kid
// fluent in brainrot, a hyped little kid in caps, a chill one who barely types, a Gen X parent playing
// along, a sweaty tryhard), so the same thought comes out differently from different people, with the odd
// typo or stretched word. Real chat is uneven: lines come in bursts and lulls, a lot of it is noise
// ("wooooo"), and plenty of questions get no answer at all.

export type Persona = 'genz' | 'kid' | 'chill' | 'genx' | 'tryhard';

export const PERSONAS: Persona[] = ['genz', 'genz', 'kid', 'chill', 'chill', 'genx', 'tryhard'];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

/** Lines anyone might say out of nowhere, about the game. */
const GAME_LINES = [
  'this cannon is so op', 'storm layer is scary', 'super pulls are worth it', 'merging commons rn', 'perfect launch',
  'my hippo is lvl 5', 'the fountain is pretty', 'i crashed into a bird', 'so close to legendary', 'who wants to see my base',
  'brb', 'im so rich', 'just reached cloud kingdom', 'wait for the cannon pls', 'the cosmic machine looks insane',
  'shop guy waved at me', 'lucky machine is lucky', 'that plane came out of nowhere', 'parachute at the last second',
  'how is everyone so high up', 'my base is getting full', 'need more gems', 'one more launch then i sleep',
  'pulled 3 commons in a row', 'i keep missing the green', 'satellites hurt', 'space is so pretty', 'meteor hit me',
];

/** Each persona's own lines, mixed in with the game ones. */
const OWN_LINES: Record<Persona, string[]> = {
  genz: [
    'no cap this game is peak', 'tung tung tung sahur', 'tralalero tralala', 'bombardiro crocodilo fr', 'this is lowkey addicting',
    'my base is giving rich', 'not me crashing again', 'its giving skill issue', 'ate and left no crumbs', 'im cooked',
    'that launch was bussin', 'chat is this real', 'aura +1000', 'brainrot maxxing', 'we are so back', 'its so over',
    'certified lucky moment', 'bro thinks hes the cannon', 'mewing while i wait', 'this game is so unserious', 'slay',
  ],
  kid: [
    'WOOOO', 'I GOT A RARE', 'this is so fun', 'MOM LOOK', 'i want a mythic so bad', 'BOOM', 'weeeee', 'can someone help me',
    'i love the hippo', 'yayyy', 'AAAAA', 'this is my fav game', 'im flying', 'look at my base!!', 'the cannon is so loud lol',
  ],
  chill: ['lol', 'nice', 'ok', 'hm', 'gg', 'vibing', 'just chilling', 'lol same', 'xd', 'zzz', 'eh', 'pretty cool', ':)', 'ya'],
  genx: [
    'my kid showed me this game', 'totally rad launch', 'back in my day cannons were for pirates', 'whatever, still fun',
    'this is gnarly', 'how do i turn off the music', 'my son says im good at this', 'as if i will ever get a mythic',
    'radical', 'phat loot', 'talk to the hand', 'cool beans', 'all that and a bag of chips',
  ],
  tryhard: [
    'cannon first, always', 'merge your commons asap', 'rebirth at the first chance', 'gem finder is underrated',
    'efficient route: launch, collect, launch', 'anyone min-maxing this', 'that apex was mid', 'my income is 2x yours probably',
    'level your top slots first', 'storm layer gems are free money',
  ],
};

/** Noise: excitement and filler, short and said rarely. */
const NOISE = ['wooooo', 'yippee', 'weeeee', 'lol', 'lmao', 'XD', 'hehe', 'brrrr', 'yoooo', 'ayo', 'oop', 'bruh', 'hmmm', '!!!', 'w', 'L', 'oof'];

/** Questions, with answers someone might give (each may get no answer). */
export const THREADS: [string, string[]][] = [
  ['how do u get gems', ['launch higher, cloud kingdom gems are x3', 'fly through them lol', 'upgrade gem finder']],
  ['is super pull worth it', ['yes always rare or better', 'ya way better than basic', 'kinda']],
  ['anyone wanna trade', ['no trading yet lol', 'trade what', 'no']],
  ['whats the best brainrot', ['frigorifero fenicottero 100%', 'the hippo with the helicopter', 'mythics obv', 'tung tung tung']],
  ['how do u level up brainrots', ['click level up under them', 'wait for the xp bar then click']],
  ['wheres the merge thing', ['purple pot behind the cannon', 'by the cannon, the bubbling pot']],
  ['how do u unlock the other machines', ['fly higher, it says the height on top', 'reach the height on the sign']],
  ['how high can u go', ['space lol', 'outer space if u rebirth', 'idk i only got to storm']],
  ['what does rebirth do', ['more money forever', 'more income but u restart', 'new floor too']],
  ['is this game free', ['ya', 'yes lol', 'yep']],
  ['does anyone have a celestial', ['no 😭', 'not yet', 'is that even real']],
  ['how do u open the parachute', ['space', 'press space or the big button', 'tap the button']],
  ['whos the richest here', [] as string[]],
  ['anyone else lagging', ['nope', 'a bit', 'no']],
  ['what time is it for u', ['3am lol', 'lunch', 'too late']],
  ['why is the cannon so loud', [] as string[]],
];

/** Short reactions to someone else's line, to keep a burst of chat going. */
export const BACKCHANNEL = ['lol', 'fr', 'true', 'real', 'same', 'ikr', 'lmao', 'nah', 'W', 'facts', '😂', 'ya', 'bruh'];

/** A line for a persona to say out of nowhere: its own, the game's, or noise. */
export function idleLine(p: Persona): string {
  const r = Math.random();
  if (r < 0.12) return pick(NOISE);
  if (r < 0.55) return pick(OWN_LINES[p]);
  return pick(GAME_LINES);
}

/** Types a line the way the persona would: case, stretched letters, typos, emoji. */
export function style(text: string, p: Persona): string {
  // Emoji-only and noise lines stay as they are.
  if (!/[a-z]{2}/i.test(text) || NOISE.includes(text)) return text;
  let t = text;
  switch (p) {
    case 'genz':
      t = t.toLowerCase().replace(/[.!]+$/, '');
      if (Math.random() < 0.2) t += pick([' 💀', ' 😭', ' fr', ' ngl', ' 🔥']);
      break;
    case 'kid':
      if (Math.random() < 0.4) t = t.toUpperCase();
      if (Math.random() < 0.4) t += pick(['!!', '!!!', ' :D', ' 😃']);
      t = stretch(t, 0.35);
      break;
    case 'chill':
      t = t.toLowerCase().replace(/[.!?]+$/, '');
      break;
    case 'genx':
      if (Math.random() < 0.3) t = t[0].toUpperCase() + t.slice(1);
      if (Math.random() < 0.3) t += pick(['.', '...', ' :)', ' lol']);
      break;
    case 'tryhard':
      t = t.toLowerCase();
      break;
  }
  if (Math.random() < 0.08) t = typo(t);
  return t;
}

/** Stretches one vowel run now and then: "so" to "sooo". */
function stretch(t: string, chance: number): string {
  if (Math.random() > chance) return t;
  return t.replace(/([aeiouy])(?=[^aeiouy]*$)/i, (m) => m.repeat(Math.floor(rand(3, 6))));
}

/** One fat-finger: two letters swapped, or one dropped. */
function typo(t: string): string {
  const words = t.split(' ');
  const i = words.findIndex((w) => w.length > 4);
  if (i < 0) return t;
  const w = words[i];
  const j = 1 + Math.floor(Math.random() * (w.length - 2));
  words[i] = Math.random() < 0.5 ? w.slice(0, j) + w[j + 1] + w[j] + w.slice(j + 2) : w.slice(0, j) + w.slice(j + 1);
  return words.join(' ');
}
