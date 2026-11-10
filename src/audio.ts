// Sound effects and voices synthesised with Web Audio, so the game ships no audio files.
import { Music, type Mood } from './music';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private muted = false;
  private music: Music | null = null;
  private musicOn = true;
  private mood: Mood = 'base';

  /** Browsers only allow audio after a user gesture, so this runs on the first press. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);

    const length = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();

    this.music = new Music(ctx, this.master, this.noise);
    this.music.setEnabled(this.musicOn);
    this.music.setMood(this.mood);
  }

  /** Background music on or off (the master mute silences it too). */
  setMusic(on: boolean): void {
    this.musicOn = on;
    this.music?.setEnabled(on);
  }

  /** Which music track fits what's happening. */
  setMood(mood: Mood): void {
    this.mood = mood;
    this.music?.setMood(mood);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  /**
   * A brainrot's voice: a sung babble built from the syllables of its name, like the gibberish voices in
   * cosy games. Each name gets its own pitch, rhythm and vowel colours, and rarer brainrots sing lower and
   * longer with a little echo. Generated here, so there's no robotic text-to-speech and no audio files.
   */
  chant(name: string, rarity = 0): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    // A stable seed from the name, so each character always sounds the same.
    let seed = 0;
    for (const ch of name) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const syllables = name.toLowerCase().match(/[^aeiou\s]*[aeiou]+/g)?.slice(0, 8) ?? ['ba'];
    const base = 190 + rnd() * 140 - rarity * 14;
    const beat = 0.11 + rnd() * 0.04 + rarity * 0.008;
    const out = ctx.createGain();
    out.gain.value = 0.5;
    // Rarer voices get a short echo, for a bit of grandeur.
    if (rarity >= 3) {
      const delay = ctx.createDelay();
      delay.delayTime.value = 0.13;
      const fb = ctx.createGain();
      fb.gain.value = 0.28;
      out.connect(delay).connect(fb).connect(delay);
      fb.connect(this.master);
    }
    out.connect(this.master);
    const t0 = ctx.currentTime + 0.02;
    syllables.forEach((syl, i) => {
      const vowel = syl.match(/[aeiou]/)?.[0] ?? 'a';
      // A sing-song contour: up through the name, a lift on the stressed syllable, down at the end.
      const last = i === syllables.length - 1;
      const step = [0, 3, 5, 3, 7, 5, 3, 0][i % 8] + (i === 1 ? 2 : 0) - (last ? 4 : 0);
      const f = base * Math.pow(2, step / 12) * (0.97 + rnd() * 0.06);
      const t = t0 + i * beat;
      this.syllable(out, vowel, f, t, last ? beat * 2.2 : beat * 0.92);
    });
  }

  /** One sung syllable: a buzzy source through two vowel formants, with a soft attack and a little vibrato. */
  private syllable(out: AudioNode, vowel: string, f: number, t: number, dur: number): void {
    const ctx = this.ctx!;
    const formants: Record<string, [number, number]> = {
      a: [800, 1200],
      e: [500, 1900],
      i: [320, 2400],
      o: [500, 900],
      u: [350, 700],
    };
    const [f1, f2] = formants[vowel] ?? formants.a;
    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(f * 0.94, t);
    src.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    const vib = ctx.createOscillator();
    vib.frequency.value = 6;
    const vibAmt = ctx.createGain();
    vibAmt.gain.value = f * 0.012;
    vib.connect(vibAmt).connect(src.frequency);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.35, t + 0.025);
    env.gain.setValueAtTime(0.35, t + dur * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const [freq, q, g] of [
      [f1, 6, 1],
      [f2, 9, 0.6],
    ] as const) {
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = freq;
      band.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = g;
      src.connect(band).connect(gain).connect(env);
    }
    env.connect(out);
    src.start(t);
    vib.start(t);
    src.stop(t + dur + 0.05);
    vib.stop(t + dur + 0.05);
  }

  /** A soft footstep: a short, low, filtered scuff. Kept very quiet. */
  step(): void {
    this.noiseBurst(0.07, 'lowpass', 700 + Math.random() * 300, 0.07);
    this.tone('sine', 110 + Math.random() * 20, 70, 0.06, 0.04);
  }

  /** A UI click. */
  click(): void {
    this.tone('triangle', 1400, 900, 0.05, 0.08);
  }

  /** A gacha capsule popping open. */
  capsule(): void {
    this.tone('sine', 300, 900, 0.12, 0.25);
    this.noiseBurst(0.12, 'highpass', 2500, 0.2);
    this.tone('triangle', 1200, 1800, 0.15, 0.12, 0.08);
  }

  /** The machine's crank turning while a pull spins up: a soft ratchet. */
  crank(seconds: number): void {
    for (let t = 0; t < seconds; t += 0.11) this.tone('square', 260 + Math.random() * 40, 200, 0.03, 0.025, t);
  }

  /** A card flipping over. */
  flip(): void {
    this.noiseBurst(0.12, 'bandpass', 1800, 0.18, 3500);
  }

  /**
   * A fanfare for a big reveal, grander the rarer: Rare a bright chime, Epic a rising arpeggio, Legendary
   * a full chord with a shimmer, Mythic all of that plus a deep boom and a longer tail.
   */
  fanfare(rarity: number): void {
    if (rarity < 2) return;
    const root = 523;
    const notes = rarity >= 4 ? [0, 4, 7, 12, 16, 19, 24] : rarity === 3 ? [0, 4, 7, 12] : [0, 7, 12];
    notes.forEach((n, i) => {
      const f = root * Math.pow(2, n / 12);
      this.tone('triangle', f, f, 0.5 + (rarity - 2) * 0.25, 0.16, i * 0.07);
      if (rarity >= 4) this.tone('sine', f * 2, f * 2, 0.7, 0.07, i * 0.07 + 0.03);
    });
    if (rarity >= 4) {
      // The held chord.
      for (const n of [0, 4, 7, 12]) this.tone('sawtooth', root * Math.pow(2, n / 12) / 2, root * Math.pow(2, n / 12) / 2, 1.4, 0.05, 0.5);
      this.sparkle();
    }
    if (rarity >= 5) {
      this.tone('sine', 90, 40, 1.2, 0.8);
      this.noiseBurst(1.2, 'lowpass', 900, 0.4, 80);
      for (const n of [0, 7, 12, 19]) this.tone('triangle', root * 2 * Math.pow(2, n / 12), root * 2 * Math.pow(2, n / 12), 1.6, 0.06, 0.9);
    }
  }

  /** The suspense before a Legendary or Mythic card turns: a rising whoosh. */
  suspense(): void {
    this.noiseBurst(0.9, 'bandpass', 400, 0.25, 3000);
    this.tone('sine', 200, 800, 0.9, 0.12);
  }

  /** Buying an upgrade: a cash-register ka-ching. */
  buy(): void {
    this.noiseBurst(0.05, 'highpass', 4000, 0.2);
    this.tone('square', 1568, 1568, 0.08, 0.07, 0.04);
    this.tone('square', 2093, 2093, 0.25, 0.07, 0.11);
  }

  /** A brainrot levelling up: a quick climbing scale. */
  levelUp(): void {
    [0, 4, 7, 12].forEach((n, i) => this.tone('triangle', 660 * Math.pow(2, n / 12), 660 * Math.pow(2, n / 12), 0.14, 0.18, i * 0.06));
  }

  /** The merge cauldron bubbling up. */
  brew(): void {
    for (let i = 0; i < 6; i++) this.tone('sine', 180 + Math.random() * 220, 400 + Math.random() * 300, 0.12, 0.12, i * 0.09);
  }

  /** Entering a new zone: a soaring two-note call. */
  zone(): void {
    this.tone('triangle', 784, 784, 0.3, 0.2);
    this.tone('triangle', 1175, 1175, 0.6, 0.2, 0.18);
  }

  /** A whoosh as a panel opens. */
  open(): void {
    this.noiseBurst(0.15, 'bandpass', 900, 0.1, 2200);
  }

  coin(): void {
    this.tone('square', 990, 990, 0.06, 0.08);
    this.tone('square', 1320, 1320, 0.12, 0.08, 0.06);
  }

  wind(level: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(level * 0.3, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(300 + level * 1400, t, 0.1);
  }

  /**
   * The cannon firing, in layers: a sharp crack, a deep chest-thumping body, a roaring blast that sweeps down,
   * the whoosh of the player leaving, a metallic ring from the barrel, and an echo off the hills.
   */
  boom(power: number): void {
    const p = Math.min(1.6, power);
    this.noiseBurst(0.07, 'highpass', 2800, 0.55 * p);
    this.tone('sine', 170, 36, 0.75, 1.0 * p);
    this.tone('triangle', 95, 30, 0.95, 0.45 * p);
    this.tone('sawtooth', 240, 60, 0.18, 0.18 * p);
    this.noiseBurst(1.3, 'lowpass', 2400, 0.85 * p, 80);
    this.noiseBurst(0.7, 'bandpass', 600, 0.22 * p, 3200, 0.05);
    this.tone('triangle', 640, 590, 1.2, 0.05 * p, 0.03);
    this.tone('sine', 960, 930, 0.9, 0.035 * p, 0.03);
    // The echo.
    this.noiseBurst(0.9, 'lowpass', 700, 0.22 * p, 90, 0.32);
    this.tone('sine', 110, 40, 0.6, 0.18 * p, 0.32);
  }

  pop(rarity: number, delay = 0): void {
    const f = 520 * Math.pow(1.18, rarity);
    this.tone('triangle', f, f * 1.5, 0.12, 0.35, delay);
    if (rarity >= 2) this.tone('sine', f * 2, f * 2.5, 0.3, 0.2, delay + 0.08);
  }

  full(): void {
    this.tone('square', 180, 150, 0.08, 0.06);
  }

  swap(): void {
    this.tone('square', 320, 220, 0.1, 0.08);
  }

  hit(): void {
    this.noiseBurst(0.18, 'bandpass', 1400, 0.5);
    this.tone('sawtooth', 280, 90, 0.22, 0.18);
  }

  chute(): void {
    this.noiseBurst(0.35, 'highpass', 700, 0.4);
    this.tone('sine', 200, 340, 0.15, 0.2);
  }

  thud(power: number): void {
    this.tone('sine', 95, 30, 0.35, 0.9 * power);
    this.noiseBurst(0.3, 'lowpass', 500, 0.6 * power);
  }

  ding(): void {
    this.tone('triangle', 880, 880, 0.15, 0.25);
    this.tone('triangle', 1320, 1320, 0.35, 0.25, 0.1);
  }

  sparkle(): void {
    this.tone('triangle', 1046, 1568, 0.25, 0.2);
    this.tone('triangle', 1568, 2093, 0.3, 0.15, 0.08);
  }

  /** A plastic capsule bouncing on the floor; strength 0 to 1. */
  bounce(strength: number): void {
    this.tone('sine', 520 + strength * 260, 300, 0.07, 0.05 + strength * 0.12);
    this.noiseBurst(0.04, 'highpass', 2200, 0.04 + strength * 0.06);
  }

  /** A shield blocking a hit: a bright glassy ping and a soft whoosh. */
  shieldBlock(): void {
    this.tone('sine', 1500, 2200, 0.25, 0.2);
    this.tone('triangle', 900, 1300, 0.3, 0.12, 0.03);
    this.noiseBurst(0.2, 'highpass', 2500, 0.15);
  }

  /** A hop at the base: a short springy boing. */
  hop(): void {
    this.tone('sine', 300, 620, 0.12, 0.12);
  }

  /** Rebirth: a bright rising chord over a deep boom, with a shimmer. */
  rebirth(): void {
    this.tone('sine', 110, 40, 1.1, 0.7);
    this.noiseBurst(0.9, 'lowpass', 900, 0.35, 120);
    [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => {
      const f = 392 * Math.pow(2, n / 12);
      this.tone('triangle', f, f, 1.1, 0.13, 0.08 + i * 0.07);
      this.tone('sine', f * 2, f * 2, 1.3, 0.05, 0.12 + i * 0.07);
    });
    this.sparkle();
  }

  /** A firework rocket going up: a rising whistle. Level 0 to 1. */
  fireworkLaunch(level: number): void {
    if (level < 0.03) return;
    this.tone('sine', 700, 2100, 0.9, 0.06 * level);
    this.noiseBurst(0.3, 'highpass', 3000, 0.05 * level);
  }

  /** A firework bursting: a bang, then a crackle. Level 0 to 1. */
  fireworkBang(level: number): void {
    if (level < 0.03) return;
    this.noiseBurst(0.5, 'lowpass', 1500, 0.55 * level, 150);
    this.tone('sine', 90, 40, 0.4, 0.4 * level);
    for (let i = 0; i < 6; i++) this.tone('square', 2400 + Math.random() * 1600, 1800, 0.03, 0.04 * level, 0.25 + Math.random() * 0.5);
  }

  /** Teleporting: a quick rising zip and a soft pop. */
  teleport(): void {
    this.tone('sine', 300, 1800, 0.18, 0.18);
    this.noiseBurst(0.18, 'bandpass', 900, 0.15, 4000);
    this.tone('triangle', 900, 1400, 0.1, 0.15, 0.16);
  }

  /** Diving into the cannon: a whoop as the player leaps. */
  whoop(): void {
    this.tone('triangle', 420, 900, 0.22, 0.16);
    this.tone('triangle', 900, 620, 0.18, 0.12, 0.2);
  }

  /** The cannon swallowing the player: a rubbery gulp and a hollow boing. */
  gulp(): void {
    this.tone('sine', 260, 90, 0.18, 0.4);
    this.tone('sine', 140, 420, 0.35, 0.22, 0.16);
    this.tone('sine', 420, 300, 0.3, 0.12, 0.45);
  }

  /** The helmet landing on the player's head. */
  clonk(): void {
    this.tone('square', 900, 700, 0.06, 0.08);
    this.tone('triangle', 1400, 1300, 0.18, 0.12, 0.02);
  }

  /** The parachute alarm: a short, urgent beep. */
  alarm(): void {
    this.tone('square', 1046, 1046, 0.07, 0.09);
    this.tone('square', 1318, 1318, 0.07, 0.09, 0.09);
  }

  /** A machine unlocking: a chain rattle, a click, and a bright chord. */
  unlockChime(): void {
    for (let i = 0; i < 4; i++) this.noiseBurst(0.05, 'highpass', 3000 + i * 400, 0.12);
    this.tone('square', 1800, 1200, 0.05, 0.1, 0.25);
    [0, 4, 7, 12].forEach((n, i) => this.tone('triangle', 784 * Math.pow(2, n / 12), 784 * Math.pow(2, n / 12), 0.5, 0.16, 0.35 + i * 0.05));
  }

  /** Someone else's cannon shot, quieter with distance (0 to 1). */
  distantBoom(level: number): void {
    if (level < 0.03) return;
    this.noiseBurst(0.06, 'highpass', 2000, 0.15 * level);
    this.noiseBurst(0.9, 'lowpass', 800, 0.5 * level, 90);
    this.tone('sine', 120, 35, 0.6, 0.5 * level);
    this.noiseBurst(0.7, 'lowpass', 500, 0.15 * level, 80, 0.3);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private noiseBurst(dur: number, type: BiquadFilterType, freq: number, gain: number, freqEnd?: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (freqEnd) filter.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(Math.max(0.0002, gain), t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(env).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }
}
