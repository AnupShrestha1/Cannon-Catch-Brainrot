// Background music, generated live with Web Audio like the sound effects (no audio files). A small step
// sequencer plays one of four looping tracks: a bouncy one at the base, an airy one in the low sky, a darker
// driving one in the Storm Layer and a slow, spacey one at the Edge of Space and beyond. Changing track fades
// the old one out and the new one in on its first beat.

export type Mood = 'base' | 'sky' | 'storm' | 'space';

interface Track {
  bpm: number;
  /** MIDI note of the key's root. */
  root: number;
  /** Semitones of the scale's degrees. */
  scale: number[];
  /** Each bar's chord, as a scale degree (8 bars). */
  chords: number[];
  /**
   * Lead tunes, one per half of the 8 bars: 8 eighth notes per bar as scale degrees above the chord's root,
   * null for a rest, '-' to hold the note before.
   */
  lead: [Motif, Motif];
  leadWave: OscillatorType;
  /** 16 steps: k kick, s snare, h hat, o open hat, t tom; '.' rest. */
  drums: string;
  /** 16 steps: r root, o octave up, f fifth, '.' rest. */
  bass: string;
  bassWave: OscillatorType;
  /** Sixteenth-note chord arpeggio. */
  arp: boolean;
  /** Held chord pad. */
  pad: boolean;
  /** Overall level of this track. */
  level: number;
}

type Motif = (number | null | '-')[];

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];

const TRACKS: Record<Mood, Track> = {
  // Toy-box bounce: I-vi-IV-V, a marimba-ish lead, a skippy beat.
  base: {
    bpm: 112,
    root: 60,
    scale: MAJOR,
    chords: [0, 5, 3, 4, 0, 5, 3, 4],
    lead: [
      [4, null, 2, 4, 5, '-', 4, null],
      [7, '-', 4, 2, 0, null, 2, null],
    ],
    leadWave: 'triangle',
    drums: 'k.h.s.h.k.khs.ho',
    bass: 'r..or..fr..or.f.',
    bassWave: 'triangle',
    arp: false,
    pad: true,
    level: 1,
  },
  // Up in the air: brighter, faster, sparkling arpeggios.
  sky: {
    bpm: 132,
    root: 62,
    scale: MAJOR,
    chords: [0, 4, 5, 3, 0, 4, 3, 4],
    lead: [
      [4, '-', '-', 6, 7, '-', 4, '-'],
      [9, '-', 7, '-', 4, '-', 2, '-'],
    ],
    leadWave: 'sine',
    drums: 'k.h.s.hhk.h.s.ho',
    bass: 'r.r.o.r.r.r.o.f.',
    bassWave: 'triangle',
    arp: true,
    pad: false,
    level: 0.9,
  },
  // The Storm Layer: minor key, driving eighths and toms.
  storm: {
    bpm: 128,
    root: 57,
    scale: MINOR,
    chords: [0, 5, 2, 6, 0, 5, 3, 4],
    lead: [
      [0, '-', 2, 4, '-', 2, 4, 6],
      [7, '-', 6, 4, '-', 2, 1, '-'],
    ],
    leadWave: 'square',
    drums: 'k.hks.h.k.hks.tt',
    bass: 'rrorrrorrrorrfof',
    bassWave: 'sawtooth',
    arp: true,
    pad: true,
    level: 0.85,
  },
  // Space: slow, floating, no drums, bell tones.
  space: {
    bpm: 84,
    root: 64,
    scale: LYDIAN,
    chords: [0, 1, 0, 4, 5, 1, 3, 4],
    lead: [
      [4, '-', '-', null, 3, '-', 1, '-'],
      [7, '-', '-', '-', 6, '-', 4, '-'],
    ],
    leadWave: 'sine',
    drums: '................',
    bass: 'r.......f.......',
    bassWave: 'sine',
    arp: true,
    pad: true,
    level: 0.95,
  },
};

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  private out: GainNode;
  /** The current track's own fader, so the old one can fade while the new one starts. */
  private fader: GainNode | null = null;
  private mood: Mood | null = null;
  private wanted: Mood = 'base';
  private step = 0;
  private nextTime = 0;
  private timer = 0;
  private on = true;

  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
    private noise: AudioBuffer,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0.32;
    this.out.connect(dest);
    // Schedule a little ahead on a timer; pause while the tab is hidden (timers are throttled there).
    this.timer = window.setInterval(() => this.pump(), 25);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.nextTime = 0;
    });
  }

  setEnabled(on: boolean): void {
    this.on = on;
    this.out.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.15);
  }

  /** Which track should play; it changes on the next beat, crossfading. */
  setMood(mood: Mood): void {
    this.wanted = mood;
  }

  dispose(): void {
    clearInterval(this.timer);
  }

  private pump(): void {
    const ctx = this.ctx;
    if (!this.on || ctx.state !== 'running' || document.visibilityState !== 'visible') return;
    const now = ctx.currentTime;
    if (this.nextTime < now) this.nextTime = now + 0.05;
    while (this.nextTime < now + 0.15) {
      // Switch tracks on a beat.
      if (this.wanted !== this.mood && this.step % 4 === 0) this.switchTo(this.wanted, this.nextTime);
      this.playStep(this.nextTime);
      const track = TRACKS[this.mood!];
      this.nextTime += 60 / track.bpm / 4;
      this.step = (this.step + 1) % (16 * 8 * 2);
    }
  }

  private switchTo(mood: Mood, t: number): void {
    if (this.fader) {
      const old = this.fader;
      old.gain.setTargetAtTime(0, t, 0.4);
      setTimeout(() => old.disconnect(), 3000);
    }
    const f = this.ctx.createGain();
    f.gain.setValueAtTime(0.0001, t);
    f.gain.setTargetAtTime(TRACKS[mood].level, t, 0.5);
    f.connect(this.out);
    this.fader = f;
    this.mood = mood;
    this.step = 0;
  }

  private note(track: Track, degree: number, octave = 0): number {
    const n = track.scale.length;
    const o = Math.floor(degree / n);
    return track.root + 12 * (o + octave) + track.scale[((degree % n) + n) % n];
  }

  private playStep(t: number): void {
    const track = TRACKS[this.mood!];
    const s16 = 60 / track.bpm / 4;
    const inBar = this.step % 16;
    const bar = Math.floor(this.step / 16) % 8;
    // Every other pass through the 8 bars the lead rests, so the tune doesn't wear thin.
    const leadOn = Math.floor(this.step / 128) % 2 === 0;
    const chord = track.chords[bar];
    const tones = [chord, chord + 2, chord + 4];

    // Drums.
    const d = track.drums[inBar];
    if (d === 'k') this.kick(t);
    else if (d === 's') this.snare(t);
    else if (d === 'h') this.hat(t, 0.05);
    else if (d === 'o') this.hat(t, 0.18);
    else if (d === 't') this.tom(t, inBar);

    // Bass.
    const b = track.bass[inBar];
    if (b !== '.') {
      const m = this.note(track, b === 'f' ? chord + 4 : chord, b === 'o' ? -1 : -2);
      this.voice(track.bassWave, midiHz(m), t, s16 * 1.6, track.bassWave === 'sawtooth' ? 0.09 : 0.22, 0.005, 400);
    }

    // Pad: the chord, held across the bar.
    if (track.pad && inBar === 0) {
      for (const deg of tones) {
        const f = midiHz(this.note(track, deg, -1));
        this.voice('sawtooth', f, t, s16 * 16, 0.025, 0.3, 900, 1.003);
      }
    }

    // Arpeggio: up the chord in sixteenths.
    if (track.arp) {
      const order = [0, 1, 2, 3, 2, 1];
      const k = order[inBar % order.length];
      const m = this.note(track, tones[k % 3], k === 3 ? 1 : 0);
      // Without drums (space), the arpeggio slows to eighths.
      if (track.drums !== '.'.repeat(16) || inBar % 2 === 0)
        this.voice('triangle', midiHz(m + 12), t, s16 * 0.9, this.mood === 'space' ? 0.05 : 0.035, 0.003, 3000);
    }

    // Lead, on eighth notes.
    if (leadOn && inBar % 2 === 0) {
      const motif = track.lead[bar < 4 ? 0 : 1];
      const i = inBar / 2;
      const deg = motif[i];
      if (typeof deg === 'number') {
        let len = 1;
        while (motif[i + len] === '-') len++;
        // The last bar of each half resolves to the chord's root instead.
        const d2 = bar % 4 === 3 && i >= 6 ? 0 : deg;
        const m = this.note(track, chord + d2, 1);
        const dur = s16 * 2 * len;
        const vol = track.leadWave === 'square' ? 0.035 : 0.09;
        this.voice(track.leadWave, midiHz(m), t, dur, vol, 0.01, track.leadWave === 'square' ? 2200 : 5000);
        if (this.mood === 'space') this.voice('sine', midiHz(m + 12), t, dur * 1.5, 0.03, 0.005, 6000);
      }
    }
  }

  /** One note: an oscillator (or two, detuned) through a low-pass filter with a soft envelope. */
  private voice(type: OscillatorType, freq: number, t: number, dur: number, vol: number, attack: number, cutoff: number, detune = 0): void {
    const ctx = this.ctx;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + attack);
    env.gain.setTargetAtTime(0.0001, t + Math.max(attack, dur * 0.6), dur * 0.25);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    filter.connect(env).connect(this.fader!);
    for (const mul of detune ? [1, detune] : [1]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq * mul;
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + dur + 0.3);
    }
  }

  private kick(t: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.5, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(env).connect(this.fader!);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  private noiseHit(t: number, type: BiquadFilterType, freq: number, vol: number, dur: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(vol, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(env).connect(this.fader!);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private snare(t: number): void {
    this.noiseHit(t, 'bandpass', 1800, 0.28, 0.14);
    this.voice('triangle', 190, t, 0.08, 0.12, 0.002, 2000);
  }

  private hat(t: number, dur: number): void {
    this.noiseHit(t, 'highpass', 7000, 0.09, dur);
  }

  private tom(t: number, inBar: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const f = inBar === 14 ? 160 : 120;
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.18);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.3, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(env).connect(this.fader!);
    osc.start(t);
    osc.stop(t + 0.25);
  }
}
