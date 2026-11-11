// Timed events: every several minutes of play, a short boost (two minutes or so) that everyone on the server
// gets at once. A countdown announces each one ahead of time, so there's something to wait for and a reason
// to stay; then it starts with a banner and a pill counting down until it ends.

export type EventId = 'gemRush' | 'coinFrenzy' | 'luckySpins' | 'bullseyeBonanza';

export interface TimedEvent {
  id: EventId;
  name: string;
  /** Short, for the pill: what you get. */
  short: string;
  /** One line for the banner and the pill's tap. */
  description: string;
  icon: string;
  /** Pill colour. */
  color: string;
  /** Seconds it lasts. */
  length: number;
}

export const TIMED_EVENTS: TimedEvent[] = [
  {
    id: 'gemRush',
    name: 'Gem Rush',
    short: '×2 gems',
    description: 'Every gem you grab in the sky counts double',
    icon: '💎',
    color: '#3fb6ff',
    length: 120,
  },
  {
    id: 'coinFrenzy',
    name: 'Coin Frenzy',
    short: '×2 coins',
    description: 'Your brainrots earn double coins',
    icon: '🪙',
    color: '#ffc21a',
    length: 120,
  },
  {
    id: 'luckySpins',
    name: 'Lucky Spins',
    short: 'luckier pulls',
    description: 'Every gacha pull rolls twice and keeps the better one',
    icon: '🍀',
    color: '#3ccf5a',
    length: 120,
  },
  {
    id: 'bullseyeBonanza',
    name: 'Bullseye Bonanza',
    short: 'bullseye ×3',
    description: 'A bullseye landing pays ×3 gems instead of ×1.5',
    icon: '🎯',
    color: '#ff5fa2',
    length: 150,
  },
];

/** When events come: the first a few minutes in, then one every 6-10 minutes, each announced 45 s ahead. */
export const EVENT_TIMING = {
  firstAfter: 180,
  gapMin: 360,
  gapMax: 600,
  warning: 45,
  /** No events until the tutorial flights are done. */
  fromFlight: 3,
};

export type EventPhase = { kind: 'idle' } | { kind: 'soon'; event: TimedEvent; left: number } | { kind: 'live'; event: TimedEvent; left: number };

/** Runs the event clock. tick() reports when one is announced, starts and ends. */
export class EventClock {
  private wait = EVENT_TIMING.firstAfter;
  private current: TimedEvent | null = null;
  private left = 0;
  private live = false;
  private last: EventId | null = null;

  get phase(): EventPhase {
    if (!this.current) return { kind: 'idle' };
    return { kind: this.live ? 'live' : 'soon', event: this.current, left: this.left };
  }

  /** Whether an event is on right now. */
  active(id: EventId): boolean {
    return this.live && this.current?.id === id;
  }

  /** Dev: announce the next event now (it starts in a few seconds). */
  triggerSoon(id?: EventId): void {
    this.current = TIMED_EVENTS.find((e) => e.id === id) ?? this.next();
    this.live = false;
    this.left = 5;
  }

  tick(dt: number, allowed: boolean): 'soon' | 'start' | 'end' | null {
    if (this.current) {
      this.left -= dt;
      if (this.left > 0) return null;
      if (!this.live) {
        this.live = true;
        this.left = this.current.length;
        return 'start';
      }
      this.last = this.current.id;
      this.current = null;
      this.live = false;
      this.wait = EVENT_TIMING.gapMin + Math.random() * (EVENT_TIMING.gapMax - EVENT_TIMING.gapMin);
      return 'end';
    }
    if (!allowed) return null;
    this.wait -= dt;
    if (this.wait > EVENT_TIMING.warning) return null;
    this.current = this.next();
    this.left = Math.max(1, this.wait);
    return 'soon';
  }

  /** A different event from the last one. */
  private next(): TimedEvent {
    const pool = TIMED_EVENTS.filter((e) => e.id !== this.last);
    return pool[Math.floor(Math.random() * pool.length)];
  }
}

/** m:ss */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
