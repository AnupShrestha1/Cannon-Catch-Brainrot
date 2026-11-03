// Placeholder sound effects synthesised with Web Audio, so the prototype ships no audio files.

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private muted = false;

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
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    if (muted && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  /**
   * Stand-in for the per-character voice line: the browser's own text-to-speech chants the name.
   * Recorded lines replace this when they exist.
   */
  chant(name: string): void {
    if (this.muted || !('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const voice = this.chantVoice();
    const line = new SpeechSynthesisUtterance(`${name}!`);
    if (voice) line.voice = voice;
    line.lang = voice?.lang ?? 'it-IT';
    // The meme's narrator: a deep, deliberate delivery rather than a chipmunk.
    line.rate = 0.92;
    line.pitch = 0.85;
    synth.speak(line);
  }

  private voice: SpeechSynthesisVoice | null | undefined;

  /**
   * The best voice the device has for the chant, picked once and again when the list loads late:
   * Italian first, then the natural/neural/online voices that sound far less robotic, then male ones.
   */
  private chantVoice(): SpeechSynthesisVoice | null {
    if (this.voice !== undefined) return this.voice;
    const synth = window.speechSynthesis;
    const score = (v: SpeechSynthesisVoice) =>
      (v.lang.toLowerCase().startsWith('it') ? 100 : 0) +
      (/natural|neural|online/i.test(v.name) ? 40 : 0) +
      (/google/i.test(v.name) ? 30 : 0) +
      (/premium|enhanced/i.test(v.name) ? 20 : 0) +
      (/diego|giuseppe|cosimo|luca|paolo|male/i.test(v.name) ? 10 : 0) +
      (v.localService ? 0 : 5);
    const voices = synth.getVoices();
    if (!voices.length) {
      // Chrome fills the list asynchronously; choose again once it has.
      synth.addEventListener('voiceschanged', () => (this.voice = undefined), { once: true });
      return null;
    }
    this.voice = [...voices].sort((a, b) => score(b) - score(a))[0] ?? null;
    return this.voice;
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

  boom(power: number): void {
    this.noiseBurst(0.8, 'lowpass', 1200, 0.9 * power, 120);
    this.tone('sine', 120, 35, 0.6, 0.9 * power);
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

  private noiseBurst(dur: number, type: BiquadFilterType, freq: number, gain: number, freqEnd?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
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
