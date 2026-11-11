// HTML overlay on top of the 3D canvas.
import { CHARGE, RARITIES, UPGRADES, ZONES, launchHeight, type Track } from './config';
import { formatCoins } from './economy';
import type { HazardMode, Save } from './store';

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export type ShopItem = Track | 'pads' | 'rebirth';

export interface ShopRow {
  id: ShopItem;
  title: string;
  level: string;
  detail: string;
  /** Null when maxed out. */
  cost: number | null;
  affordable: boolean;
  /** Button text instead of the cost, e.g. for rebirth. */
  button?: string;
}

/** A level-up button under a brainrot on display, at a screen position. */
export interface PadButton {
  index: number;
  x: number;
  y: number;
  title: string;
  sub: string;
  /** 'go': ready and affordable; 'poor': ready but short of coins; 'xp': still earning XP. */
  kind: 'go' | 'poor' | 'xp';
  progress: number;
}

/** One card in the flip reveal after a pull or a merge. */
export interface RevealItem {
  name: string;
  rarity: number;
  isNew: boolean;
  /** "On display" or "In backpack". */
  note: string;
  /** e.g. "+8/s". */
  income: string;
}

/** What the tutorial hand does: press and hold, tap, swipe to steer, point at a button, or show walking. */
export type HandMode = 'hold' | 'tap' | 'swipe' | 'point' | 'walk';

export interface TuningHooks {
  changed(): void;
  addCoins(amount: number): void;
  addGems(amount: number): void;
  setSpeed(scale: number): void;
  resetAll(): void;
}

/** Each zone's colour on the height meter (brighter than the skies themselves, to read on any of them). */
const ZONE_CSS = ['#3fb6ff', '#ff9a3d', '#a66bff', '#4a6bff', '#ff5fc8'];
/** Each zone's name colour on the white card (darker, to read on white). */
const ZONE_INK = ['#1f7fd0', '#c4620f', '#7a4cc9', '#3046c9', '#c2309a'];

export class Hud {
  readonly chuteBtn = byId<HTMLButtonElement>('chuteBtn');
  readonly againBtn = byId<HTMLButtonElement>('againBtn');
  readonly soundBtn = byId<HTMLButtonElement>('soundBtn');
  readonly musicBtn = byId<HTMLButtonElement>('musicBtn');
  readonly tuneBtn = byId<HTMLButtonElement>('tuneBtn');
  readonly profileBtn = byId<HTMLButtonElement>('profileBtn');
  readonly upgradesBtn = byId<HTMLButtonElement>('upgradesBtn');
  readonly bookBtn = byId<HTMLButtonElement>('bookBtn');
  readonly emoteBtn = byId<HTMLButtonElement>('emoteBtn');
  readonly backpackBtn = byId<HTMLButtonElement>('backpackBtn');
  /** A portrait image for a brainrot, or '' to fall back to the plain rarity swatch. */
  iconFor: (name: string, rarity: number) => string = () => '';
  readonly launchBtn = byId<HTMLButtonElement>('launchBtn');
  readonly exitBtn = byId<HTMLButtonElement>('exitBtn');
  readonly giftBtn = byId<HTMLButtonElement>('giftBtn');
  readonly tunePanel = byId('tune');
  onBuy: (item: ShopItem) => void = () => {};
  onAction: () => void = () => {};
  onPadButton: (index: number) => void = () => {};

  private coins = byId('coins');
  private income = byId('income');
  private gemCount = byId('gemCount');
  private backpackCount = byId('backpackCount');
  private alt = byId('alt');
  private altNum = byId('altNum');
  private zone = byId('zone');
  private altNext = byId('altNext');
  private altFill = this.alt.querySelector<HTMLElement>('.alt-fill')!;
  /** The height readout's last update (real ms), to throttle it. */
  private altAt = 0;
  private stack = byId('stack');
  /** Shields left this flight, under the run's gems. */
  private shieldsEl = (() => {
    const el = document.createElement('div');
    el.id = 'shields';
    el.className = 'pill';
    byId('stack').after(el);
    return el;
  })();
  private shieldsKey = '';
  private promptEl = byId('prompt');
  private toasts = byId('toasts');
  private floats = byId('floats');
  private charge = byId('charge');
  private needle = this.charge.querySelector<HTMLElement>('.needle')!;
  private ground = byId('groundBar');
  private marker = this.ground.querySelector<HTMLElement>('.marker')!;
  private crashZone = this.ground.querySelector<HTMLElement>('.crash')!;
  private perfectZone = this.ground.querySelector<HTMLElement>('.perfect')!;
  private bullZone = this.ground.querySelector<HTMLElement>('.bullseye')!;
  private chip = this.ground.querySelector<HTMLElement>('.chip')!;
  private reveal = byId('reveal');
  private revealTitle = byId('revealTitle');
  private cards = byId('cards');
  private summary = byId('summary');
  private shop = byId('shop');
  private shopRows = byId('shopRows');
  private flight = byId('flightNo');
  private stick = byId('stick');
  readonly actionBtn = byId<HTMLButtonElement>('actionBtn');
  private actionKey = '';
  private padLayer = byId('padBtns');
  private coachEl = byId('coach');
  private coachText = this.coachEl.querySelector<HTMLElement>('.coach-text')!;
  private handEl = byId('hand');
  private coachKey = '';
  private feedEl = byId('feed');
  private chatForm = byId<HTMLFormElement>('chat');
  private chatInput = byId<HTMLInputElement>('chatInput');
  readonly chatBtn = byId<HTMLButtonElement>('chatBtn');
  /** Called with what the player typed in the chat. */
  onChat: (text: string) => void = () => {};
  private onlineEl = byId('online');
  private onlineKey = '';
  private revealEl = byId('cardReveal');
  private revealHead = byId('revealHead');
  private revealRow = this.revealEl.querySelector<HTMLElement>('.tcards')!;
  private flipAllBtn = byId<HTMLButtonElement>('flipAllBtn');
  private revealDone = byId<HTMLButtonElement>('revealDone');
  /** Space or Enter during a reveal: flip the next card, or continue once all are face up. */
  private revealNext: (() => void) | null = null;
  private padPool = new Map<number, { el: HTMLButtonElement; key: string }>();
  private stickKnob = this.stick.querySelector<HTMLElement>('.knob')!;
  private modal = byId('modal');
  private modalTitle = byId('modalTitle');
  private modalBody = byId('modalBody');
  private modalButtons = byId('modalButtons');
  private last = { alt: -1, zone: '', best: -1, stack: '', prompt: '', coins: '', income: -1, gems: '', pack: -1, gift: '', shop: '' };

  constructor() {
    this.bindChat();
    for (const id of ['modalBody', 'shopRows', 'cards']) this.dragScroll(byId(id));
    // Modals answer the keyboard and the backdrop too, so there's always a way out. Capture phase and
    // stopImmediatePropagation keep the key from also reaching the game (Space would launch).
    window.addEventListener(
      'keydown',
      (e) => {
        if (this.revealing) {
          if (e.code !== 'Enter' && e.code !== 'Space' && e.code !== 'NumpadEnter') return;
          e.preventDefault();
          e.stopImmediatePropagation();
          if (!e.repeat) this.revealNext?.();
          return;
        }
        if (this.modal.classList.contains('hidden')) return;
        const buttons = this.modalButtons.querySelectorAll('button');
        let pick: HTMLButtonElement | undefined;
        if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') pick = buttons[0];
        else if (e.code === 'Escape') pick = buttons[buttons.length - 1];
        else return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat) pick?.click();
      },
      true,
    );
    this.actionBtn.addEventListener('click', () => {
      this.onAction();
      this.actionBtn.blur();
    });
    this.modal.addEventListener('click', (e) => {
      if (e.target !== this.modal) return;
      const buttons = this.modalButtons.querySelectorAll('button');
      buttons[buttons.length - 1]?.click();
    });
    const place = (el: HTMLElement, [from, to]: readonly [number, number]) => {
      el.style.bottom = `${from * 100}%`;
      el.style.height = `${(to - from) * 100}%`;
    };
    place(this.charge.querySelector<HTMLElement>('.green')!, CHARGE.green);
    place(this.charge.querySelector<HTMLElement>('.perfect')!, CHARGE.perfect);
    byId('shopClose').addEventListener('click', () => this.closeShop());
    this.shop.addEventListener('click', (e) => {
      if (e.target === this.shop) this.closeShop();
    });
    this.shopRows.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-item]');
      if (button && !button.disabled) this.onBuy(button.dataset.item as ShopItem);
    });
  }

  setWallet(coins: number, income: number, gems: number): void {
    const gemText = formatCoins(gems);
    if (gemText !== this.last.gems) {
      this.last.gems = gemText;
      this.gemCount.textContent = gemText;
    }
    const text = formatCoins(coins);
    if (text !== this.last.coins) {
      this.last.coins = text;
      this.coins.textContent = text;
    }
    if (income !== this.last.income) {
      this.last.income = income;
      this.income.textContent = income > 0 ? `+${formatCoins(income)}/s` : '';
    }
  }

  /**
   * The height card: the height and the zone on one line, a thin bar filling toward the next zone in the
   * zone's colour, and how far that zone is. Fixed-width digits, updated at most 20 times a second, so it
   * doesn't shimmer at speed. (best is kept in the signature for callers; the card doesn't show it.)
   */
  setAlt(visible: boolean, y: number, zone: string, _best: number): void {
    this.alt.classList.toggle('hidden-soft', !visible);
    if (!visible) return;
    const now = performance.now();
    if (now - this.altAt < 50) return;
    this.altAt = now;
    const alt = Math.max(0, Math.round(y));
    if (alt === this.last.alt && zone === this.last.zone) return;
    this.last.alt = alt;
    const zi = Math.max(0, ZONES.findIndex((z) => z.name === zone));
    const here = ZONES[zi];
    const next = ZONES[zi + 1];
    this.altNum.textContent = String(alt);
    this.altFill.style.width = next ? `${Math.min(100, ((alt - here.from) / (next.from - here.from)) * 100)}%` : '100%';
    this.altNext.textContent = next ? `${next.name} in ${Math.max(0, next.from - alt)} m` : 'The top of the sky!';
    if (zone !== this.last.zone) {
      this.last.zone = zone;
      this.zone.textContent = zone.toUpperCase();
      this.alt.style.setProperty('--zone', ZONE_CSS[zi] ?? '#7fd6ff');
      this.alt.style.setProperty('--zone-ink', ZONE_INK[zi] ?? '#1d1640');
    }
  }


  /** The gems collected this run, shown at the top during a flight; null hides it. */
  /** Shields left (null hides the counter); a lost one makes it shake. */
  setShields(n: number | null): void {
    const key = n === null || n === 0 ? '' : String(n);
    if (key === this.shieldsKey) return;
    const lost = key !== '' && this.shieldsKey !== '' && Number(key) < Number(this.shieldsKey);
    const gone = key === '' && this.shieldsKey !== '';
    this.shieldsKey = key;
    this.shieldsEl.classList.toggle('on', key !== '');
    if (key) this.shieldsEl.textContent = `🛡 ${key}`;
    if (lost || gone) {
      this.shieldsEl.classList.remove('hit');
      void this.shieldsEl.offsetWidth;
      this.shieldsEl.classList.add('hit');
    }
  }

  setRunGems(gems: number | null): void {
    const key = gems === null ? '' : String(gems);
    if (key === this.last.stack) return;
    const grew = gems !== null && Number(this.last.stack) < gems;
    this.last.stack = key;
    this.stack.classList.toggle('on', gems !== null);
    if (gems === null) return;
    this.stack.innerHTML = '<span class="gem-icon"></span>';
    this.stack.append(String(gems));
    if (grew) {
      this.stack.classList.remove('bump');
      void this.stack.offsetWidth;
      this.stack.classList.add('bump');
    }
  }

  /** How many brainrots wait in the backpack, as a badge on its button. */
  setBackpack(count: number): void {
    if (count === this.last.pack) return;
    this.last.pack = count;
    this.backpackCount.textContent = count > 0 ? String(count) : '';
  }

  prompt(text: string, pulse = false): void {
    const key = `${text}|${pulse}`;
    if (key === this.last.prompt) return;
    this.last.prompt = key;
    if (text) this.promptEl.textContent = text;
    this.promptEl.classList.toggle('on', !!text);
    this.promptEl.classList.toggle('pulse', pulse && !!text);
  }

  /** A message that pops up and fades; `ms` shortens it for a quick flash. */
  toast(text: string, kind = '', color?: string, ms = 1400): void {
    const el = document.createElement('div');
    el.className = `toast outline ${kind}`;
    el.textContent = text;
    if (color) el.style.color = color;
    if (ms !== 1400) el.style.animationDuration = `${ms}ms`;
    this.toasts.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  /** Text that rises from a screen position, for coins earned at a spot in the world. */
  floatText(x: number, y: number, text: string, kind = ''): void {
    const el = document.createElement('div');
    el.className = `float outline ${kind}`;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    this.floats.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  showCharge(m: number | null): void {
    this.charge.classList.toggle('on', m !== null);
    if (m === null) return;
    this.needle.style.bottom = `calc(${m * 100}% - 4px)`;
    const perfect = m >= CHARGE.perfect[0] && m <= CHARGE.perfect[1];
    const green = m >= CHARGE.green[0] && m <= CHARGE.green[1];
    this.needle.className = `needle${perfect ? ' perfect' : green ? ' green' : ''}`;
  }

  /**
   * The parachute bar. frac = time to impact as a share of the bar; crash and perfect are the tops of those
   * zones; bull is the bullseye window [bottom, top]; meters is the height, shown beside the marker. Each zone
   * is labelled at its side.
   */
  showGround(frac: number | null, crash = 0, perfect = 0, bull: [number, number] = [0, 0], meters = 0, bonus = 1.5): void {
    this.ground.classList.toggle('on', frac !== null);
    if (frac === null) return;
    const pct = (v: number) => `${v * 100}%`;
    const f = Math.min(1, Math.max(0, frac));
    this.crashZone.style.height = pct(crash);
    this.perfectZone.style.bottom = pct(crash);
    this.perfectZone.style.height = pct(perfect - crash);
    // The bullseye is a single notch at the middle of its window.
    this.bullZone.style.bottom = pct((bull[0] + bull[1]) / 2);
    this.marker.style.bottom = pct(f);
    const inBull = frac >= bull[0] && frac <= bull[1];
    const good = frac >= crash && frac <= perfect;
    const danger = frac < crash;
    this.ground.classList.toggle('danger', danger);
    this.ground.classList.toggle('good', good && !inBull);
    this.ground.classList.toggle('inbull', inBull);
    const text = inBull ? `NOW ×${bonus}` : good ? 'OPEN!' : danger ? 'CRASH!' : `${Math.max(0, Math.round(meters))} m`;
    if (this.chip.textContent !== text) this.chip.textContent = text;
  }


  /**
   * Keeps the parachute bar beside the player on screen (x, y in pixels: where the player is), so the eye can
   * watch both the player and the bar at once. It sits a little to their right, kept inside the screen.
   */
  placeGround(x: number, y: number): void {
    const h = this.ground.offsetHeight || 200;
    const left = Math.min(window.innerWidth - 130, Math.max(80, x + 95));
    const top = Math.min(window.innerHeight - h / 2 - 40, Math.max(h / 2 + 40, y));
    this.ground.style.left = `${Math.round(left)}px`;
    this.ground.style.top = `${Math.round(top)}px`;
  }

  showChute(on: boolean, pulse = false): void {
    this.chuteBtn.classList.toggle('on', on);
    this.chuteBtn.classList.toggle('pulse', on && pulse);
  }

  /** The small Exit button, shown while sitting in the cannon. */
  showExit(on: boolean): void {
    this.exitBtn.classList.toggle('on', on);
  }

  /** The parachute alarm: the screen's edges pulse red and the parachute button bounces and glows. */
  chuteAlarm(on: boolean): void {
    document.body.classList.toggle('chute-alarm', on);
    this.chuteBtn.classList.toggle('alarm', on);
  }

  /** The dock (Upgrades, Bag, Book) and the Launch button, each pulsing when it's the next step. */
  showBaseButtons(
    dock: boolean,
    launch: boolean,
    pulse: { upgrades: boolean; launch: boolean; book: boolean },
  ): void {
    const tiles: [HTMLButtonElement, boolean][] = [
      [this.upgradesBtn, pulse.upgrades],
      [this.backpackBtn, false],
      [this.bookBtn, pulse.book],
      [this.emoteBtn, false],
    ];
    for (const [tile, on] of tiles) {
      tile.classList.toggle('on', dock);
      tile.classList.toggle('pulse', dock && on);
    }
    this.launchBtn.classList.toggle('on', launch);
    this.launchBtn.classList.toggle('pulse', launch && pulse.launch);
  }

  /** secondsLeft: null hides the gift, 0 or less makes it claimable. */
  setGift(secondsLeft: number | null): void {
    let text = '';
    if (secondsLeft !== null) {
      const s = Math.max(0, Math.ceil(secondsLeft));
      text = s === 0 ? 'Claim gift!' : `Gift in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
    if (text === this.last.gift) return;
    this.last.gift = text;
    this.giftBtn.textContent = text;
    const ready = text === 'Claim gift!';
    this.giftBtn.disabled = !ready;
    this.giftBtn.classList.toggle('ready', ready);
  }

  setFlight(n: number): void {
    this.flight.textContent = n > 0 ? `Flight ${n}` : '';
  }

  setSound(on: boolean): void {
    this.soundBtn.textContent = on ? 'Sound on' : 'Sound off';
  }

  setMusic(on: boolean): void {
    this.musicBtn.textContent = on ? 'Music on' : 'Music off';
  }

  /** After landing: the gems this run brought home, and the new total. */
  showRunResult(gems: number, total: number, summary: string): void {
    this.revealTitle.textContent = gems > 0 ? `+${formatCoins(gems)} gems!` : 'No gems this time';
    const big = document.createElement('div');
    big.className = 'run-gems';
    big.innerHTML = '<span class="gem-icon big"></span>';
    const line = document.createElement('div');
    line.className = 'run-total';
    line.textContent = `You have ${formatCoins(total)} gems`;
    this.cards.replaceChildren(big, line);
    this.summary.textContent = summary;
    this.againBtn.textContent = 'Back to base';
    this.reveal.classList.remove('hidden');
  }

  hideReveal(): void {
    this.reveal.classList.add('hidden');
  }

  /** Whether the device has no hover, i.e. a phone or tablet: key hints are left off there. */
  private get isTouchLike(): boolean {
    return window.matchMedia('(hover: none)').matches;
  }

  /** The context button for the pad underfoot, e.g. "Place Cannolini"; null hides it. */
  showAction(label: string | null): void {
    const text = label ? (this.isTouchLike ? label : `${label} (E)`) : '';
    if (text === this.actionKey) return;
    this.actionKey = text;
    this.actionBtn.textContent = text;
    this.actionBtn.classList.toggle('on', !!label);
  }

  /**
   * The server feed: chat and big moments from everyone, newest at the bottom, each fading after a while.
   * `kind` 'chat' shows "name: text"; anything else shows "name text" as an announcement.
   */
  feed(name: string, text: string, kind: string, color?: string): void {
    const line = document.createElement('div');
    line.className = `feed-line ${kind === 'chat' ? 'chat' : 'news'}`;
    const who = document.createElement('b');
    who.textContent = kind === 'chat' ? `${name}:` : name;
    const what = document.createElement('span');
    what.textContent = ` ${text}`;
    if (color) what.style.color = color;
    line.append(who, what);
    this.feedEl.append(line);
    while (this.feedEl.children.length > 6) this.feedEl.firstElementChild?.remove();
    setTimeout(() => line.classList.add('old'), 9000);
    setTimeout(() => line.remove(), 10000);
  }

  /** A full-screen flash of colour that fades out. */
  flash(color: string): void {
    const el = document.createElement('div');
    el.className = 'screen-flash';
    el.style.setProperty('--c', color);
    document.body.append(el);
    setTimeout(() => el.remove(), 1000);
  }

  /**
   * A huge banner for a big moment (rebirth): the title slams in, wobbles and settles, a line under it, gold
   * rays turning behind, confetti bursting from the middle; it's all gone in under three seconds.
   */
  grandBanner(title: string, sub: string): void {
    const wrap = document.createElement('div');
    wrap.className = 'grand-banner';
    const rays = document.createElement('div');
    rays.className = 'grand-rays';
    const h = document.createElement('h1');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = sub;
    wrap.append(rays, h, p);
    const colors = ['#ffd23f', '#ff5fa2', '#3fc8ff', '#8a5cff', '#3ccf5a', '#ffffff', '#ff7a1a'];
    for (let i = 0; i < 90; i++) {
      const bit = document.createElement('i');
      bit.className = 'confetti';
      const angle = Math.random() * Math.PI * 2;
      const dist = 160 + Math.random() * 420;
      bit.style.left = '50%';
      bit.style.top = '42%';
      bit.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      bit.style.setProperty('--dy', `${Math.sin(angle) * dist - 160}px`);
      bit.style.setProperty('--spin', `${Math.random() * 900 - 450}deg`);
      bit.style.background = colors[i % colors.length];
      bit.style.animationDelay = `${Math.random() * 0.25}s`;
      wrap.append(bit);
    }
    document.body.append(wrap);
    setTimeout(() => wrap.remove(), 2900);
  }

  /** Opens the chat box and puts the cursor in it. */
  openChat(): void {
    this.chatForm.classList.add('open');
    this.chatInput.focus();
  }

  closeChat(): void {
    this.chatForm.classList.remove('open');
    this.chatInput.value = '';
    this.chatInput.blur();
  }

  /** Whether the player is typing in the chat. */
  get chatting(): boolean {
    return document.activeElement === this.chatInput;
  }

  /** Sends what's typed (Enter), closes on Escape or when it loses focus empty. */
  private bindChat(): void {
    this.chatBtn.addEventListener('click', () => (this.chatForm.classList.contains('open') ? this.closeChat() : this.openChat()));
    this.chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.chatInput.value.replace(/\s+/g, ' ').trim().slice(0, 80);
      this.closeChat();
      if (text) this.onChat(text);
    });
    this.chatInput.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') this.closeChat();
    });
    this.chatInput.addEventListener('blur', () => {
      if (!this.chatInput.value.trim()) this.chatForm.classList.remove('open');
    });
  }

  /**
   * Mouse drag-to-scroll for a scrolling panel (touch already scrolls by dragging): grab anywhere and pull, with
   * a little momentum on release. A real drag swallows the click it ends with, so buttons still work on a tap.
   */
  private dragScroll(el: HTMLElement): void {
    let startY = 0;
    let startTop = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let dragging = false;
    let moved = false;
    let glide = 0;
    el.classList.add('drag-scroll');
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      cancelAnimationFrame(glide);
      dragging = true;
      moved = false;
      startY = lastY = e.clientY;
      startTop = el.scrollTop;
      lastT = performance.now();
      velocity = 0;
    });
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      if (!moved && Math.abs(e.clientY - startY) > 6) {
        moved = true;
        el.classList.add('dragging');
      }
      if (!moved) return;
      el.scrollTop = startTop - (e.clientY - startY);
      const now = performance.now();
      velocity = (lastY - e.clientY) / Math.max(1, now - lastT);
      lastY = e.clientY;
      lastT = now;
    });
    window.addEventListener('pointerup', () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      if (!moved) return;
      // Glide on, slowing down.
      let v = velocity * 16;
      const step = () => {
        v *= 0.92;
        el.scrollTop += v;
        if (Math.abs(v) > 0.4) glide = requestAnimationFrame(step);
      };
      glide = requestAnimationFrame(step);
    });
    el.addEventListener(
      'click',
      (e) => {
        if (!moved) return;
        e.stopPropagation();
        e.preventDefault();
        moved = false;
      },
      true,
    );
  }

  /**
   * The tutorial coach: a big bouncing banner with a step, and a cartoon hand showing how to do it. `x` and `y`
   * are fractions of the screen for hold, tap, swipe and walk; `el` is the button a 'point' hand points down at.
   * Null text hides both.
   */
  coach(text: string | null, hand: { mode: HandMode; el?: HTMLElement; x?: number; y?: number } | null = null): void {
    const key = text ? [text, hand?.mode ?? '', hand?.el?.id ?? '', hand?.x ?? '', hand?.y ?? ''].join('|') : '';
    if (key !== this.coachKey) {
      this.coachKey = key;
      this.coachEl.classList.toggle('on', !!text);
      if (text) {
        this.coachText.textContent = text;
        // Restart the bounce-in for each new step.
        this.coachEl.classList.remove('pop');
        void this.coachEl.offsetWidth;
        this.coachEl.classList.add('pop');
      }
      this.promptEl.classList.toggle('coached', !!text);
      this.handEl.className = text && hand ? [hand.mode, 'on', this.isTouchLike ? 'touch' : ''].join(' ') : '';
    }
    if (!text || !hand) return;
    // Place the fingertip: over the button (pointing down at it), or at a spot on the screen.
    let x = (hand.x ?? 0.5) * window.innerWidth;
    let y = (hand.y ?? 0.6) * window.innerHeight;
    if (hand.el) {
      const r = hand.el.getBoundingClientRect();
      if (!r.width) {
        this.handEl.className = '';
        this.coachKey = '';
        return;
      }
      // A pointing hand sits above the button; a tapping one taps its middle.
      x = r.left + r.width / 2;
      y = hand.mode === 'point' ? r.top - 6 : r.top + r.height / 2;
    }
    this.handEl.style.left = Math.round(x) + 'px';
    this.handEl.style.top = Math.round(y) + 'px';
  }

  /**
   * The big moment for an Epic or better: a flash of its colour over the screen, light rays turning behind
   * the card, confetti bursting from it and a banner with the rarity; Mythic shakes the whole screen too.
   */
  private celebrate(card: HTMLElement, item: RevealItem): void {
    const color = RARITIES[item.rarity].css;
    const flash = document.createElement('div');
    flash.className = 'reveal-flash';
    flash.style.setProperty('--c', color);
    this.revealEl.append(flash);
    setTimeout(() => flash.remove(), 900);
    const rays = document.createElement('div');
    rays.className = 'rays';
    card.prepend(rays);
    card.classList.add('grand');
    const r = card.getBoundingClientRect();
    const host = this.revealEl.getBoundingClientRect();
    const count = item.rarity >= 5 ? 70 : item.rarity >= 4 ? 45 : 22;
    const colors = [color, '#ffd23f', '#ffffff', '#ff5fa2', '#3fc8ff', '#8a5cff'];
    for (let i = 0; i < count; i++) {
      const bit = document.createElement('i');
      bit.className = 'confetti';
      const angle = Math.random() * Math.PI * 2;
      const dist = 120 + Math.random() * (item.rarity >= 4 ? 320 : 200);
      bit.style.left = `${r.left - host.left + r.width / 2}px`;
      bit.style.top = `${r.top - host.top + r.height / 2}px`;
      bit.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      bit.style.setProperty('--dy', `${Math.sin(angle) * dist - 120}px`);
      bit.style.setProperty('--spin', `${Math.random() * 900 - 450}deg`);
      bit.style.background = colors[i % colors.length];
      bit.style.animationDelay = `${Math.random() * 0.12}s`;
      this.revealEl.append(bit);
      setTimeout(() => bit.remove(), 1800);
    }
    const banner = document.createElement('div');
    banner.className = `reveal-banner r${item.rarity}`;
    banner.style.setProperty('--c', color);
    banner.textContent = `${RARITIES[item.rarity].name.toUpperCase()}!`;
    this.revealEl.append(banner);
    setTimeout(() => banner.remove(), item.rarity >= 4 ? 2200 : 1500);
    if (item.rarity >= 5) {
      this.revealEl.classList.remove('quake');
      void this.revealEl.offsetWidth;
      this.revealEl.classList.add('quake');
    }
  }

  /** How many players are on the server, and its name. */
  setOnline(count: number, server: string, capacity: number): void {
    const key = `${count}|${server}`;
    if (key === this.onlineKey) return;
    this.onlineKey = key;
    this.onlineEl.textContent = `${server} · ${count}/${capacity} online`;
  }

  /** Places one level-up button per item, reusing them frame to frame, and hides the rest. */
  padButtons(items: PadButton[]): void {
    const seen = new Set<number>();
    for (const item of items) {
      seen.add(item.index);
      let entry = this.padPool.get(item.index);
      if (!entry) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'pad-btn';
        const index = item.index;
        el.addEventListener('click', () => {
          this.onPadButton(index);
          el.blur();
        });
        this.padLayer.append(el);
        entry = { el, key: '' };
        this.padPool.set(item.index, entry);
      }
      const key = `${item.title}|${item.sub}|${item.kind}|${Math.round(item.progress * 50)}`;
      if (key !== entry.key) {
        entry.key = key;
        entry.el.className = `pad-btn ${item.kind}`;
        entry.el.style.setProperty('--p', String(item.progress));
        entry.el.innerHTML = '';
        const title = document.createElement('b');
        title.textContent = item.title;
        const sub = document.createElement('span');
        sub.textContent = item.sub;
        if (item.kind !== 'xp') sub.prepend(Object.assign(document.createElement('i'), { className: 'coin-dot' }));
        entry.el.append(title, sub);
      }
      entry.el.style.display = '';
      entry.el.style.transform = `translate(${Math.round(item.x)}px, ${Math.round(item.y)}px) translate(-50%, -50%)`;
    }
    for (const [index, entry] of this.padPool) if (!seen.has(index)) entry.el.style.display = 'none';
  }

  /** The touch joystick at the base: a ring where the drag started and a knob that follows it. */
  showStick(stick: { active: boolean; originX: number; originY: number; x: number; y: number } | null): void {
    const on = !!stick?.active;
    this.stick.classList.toggle('on', on);
    if (!stick || !on) return;
    this.stick.style.left = `${stick.originX}px`;
    this.stick.style.top = `${stick.originY}px`;
    this.stickKnob.style.transform = `translate(${stick.x * 44}px, ${-stick.y * 44}px)`;
  }

  /** True while any panel or the card reveal covers the game. */
  get modalOpen(): boolean {
    return !this.modal.classList.contains('hidden') || this.revealing;
  }

  get revealing(): boolean {
    return !this.revealEl.classList.contains('hidden');
  }

  /**
   * Trading-card reveal: the cards are dealt face down, rarest last, and each flips over when tapped (or all
   * at once with Flip all). Rare and better glow through their backs first; Epic and better have holo foil.
   */
  revealCards(
    items: RevealItem[],
    title: string,
    onFlip: (item: RevealItem) => void,
    onDone: () => void,
    onTease: (item: RevealItem) => void = () => {},
  ): void {
    const ordered = [...items].sort((a, b) => a.rarity - b.rarity);
    let left = ordered.length;
    const flips: (() => void)[] = [];
    const update = () => {
      this.revealHead.textContent = left > 0 ? title : 'All revealed!';
      this.flipAllBtn.classList.toggle('hidden', left === 0);
      this.revealDone.classList.toggle('hidden', left > 0);
    };
    const close = () => {
      this.revealEl.classList.add('hidden');
      this.revealNext = null;
      this.revealDone.onclick = null;
      this.flipAllBtn.onclick = null;
      onDone();
    };
    this.revealRow.replaceChildren(
      ...ordered.map((item, i) => {
        const r = RARITIES[item.rarity];
        const card = document.createElement('div');
        card.className = 'tcard';
        card.style.setProperty('--c', r.css);
        card.style.animationDelay = `${i * 0.08}s`;
        if (item.rarity >= 2) card.classList.add('tease');
        if (item.rarity >= 3) card.classList.add('holo');
        if (item.rarity === RARITIES.length - 1) card.classList.add('secret');
        const inner = document.createElement('div');
        inner.className = 'tcard-inner';
        const back = document.createElement('div');
        back.className = 'tcard-back';
        back.innerHTML = '<div class="tc-emblem"><span>BRAIN</span><span>ROT</span></div>';
        const front = document.createElement('div');
        front.className = 'tcard-front';
        const top = document.createElement('div');
        top.className = 'tc-top';
        const name = document.createElement('span');
        name.className = 'tc-name';
        name.textContent = item.name;
        const income = document.createElement('span');
        income.className = 'tc-income';
        income.textContent = item.income;
        top.append(name, income);
        const art = document.createElement('div');
        art.className = 'tc-art';
        const icon = this.iconFor(item.name, item.rarity);
        if (icon) {
          const img = document.createElement('img');
          img.src = icon;
          img.alt = '';
          img.draggable = false;
          art.append(img);
        }
        const type = document.createElement('div');
        type.className = 'tc-type';
        type.textContent = `${r.name} ${'★'.repeat(item.rarity + 1)}`;
        const note = document.createElement('div');
        note.className = 'tc-note';
        note.textContent = item.note;
        front.append(top, art, type, note);
        if (item.isNew) {
          const badge = document.createElement('div');
          badge.className = 'tc-new';
          badge.textContent = 'NEW!';
          front.append(badge);
        }
        const shine = document.createElement('div');
        shine.className = 'tc-shine';
        front.append(shine);
        inner.append(back, front);
        card.append(inner);
        if (item.rarity >= 5) card.classList.add('mythic');
        const turn = () => {
          card.classList.remove('charging');
          card.classList.add('flipped');
          left--;
          onFlip(item);
          if (item.rarity >= 3) this.celebrate(card, item);
          update();
        };
        const flip = () => {
          if (card.classList.contains('flipped') || card.classList.contains('charging')) return;
          // Legendary and Mythic hold back a moment: the card shakes and blazes before it turns.
          if (item.rarity >= 4) {
            card.classList.add('charging');
            onTease(item);
            setTimeout(turn, item.rarity >= 5 ? 1300 : 900);
          } else {
            turn();
          }
        };
        card.addEventListener('click', flip);
        flips.push(flip);
        return card;
      }),
    );
    this.revealEl.classList.toggle('many', ordered.length > 5);
    this.flipAllBtn.onclick = () => {
      flips.forEach((flip, i) => setTimeout(flip, i * 160));
      this.flipAllBtn.blur();
    };
    this.revealDone.onclick = close;
    this.revealNext = () => {
      const next = flips.find((_, i) => !this.revealRow.children[i].classList.contains('flipped'));
      if (next) next();
      else close();
    };
    update();
    this.revealEl.classList.remove('hidden');
  }

  /** One modal at a time: a title, any content, and buttons that each close it and run their action. */
  showModal(title: string, body: Node[], buttons: { label: string; primary?: boolean; action?: () => void }[]): void {
    this.modalTitle.textContent = title;
    this.modalBody.replaceChildren(...body);
    this.modalButtons.replaceChildren(
      ...buttons.map(({ label, primary, action }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        if (primary) button.className = 'primary';
        button.addEventListener('click', () => {
          this.closeModal();
          action?.();
        });
        return button;
      }),
    );
    this.modal.classList.remove('hidden');
  }

  closeModal(): void {
    this.modal.classList.add('hidden');
  }

  /** A character card like the reveal's; locked ones show a dark silhouette and no name. */
  characterCard(name: string, rarity: number, locked = false): HTMLElement {
    const r = RARITIES[rarity];
    const card = document.createElement('div');
    card.className = locked ? 'card locked' : 'card';
    card.style.setProperty('--c', r.css);
    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    const icon = this.iconFor(name, rarity);
    if (icon) {
      const img = document.createElement('img');
      img.src = icon;
      img.alt = '';
      img.draggable = false;
      swatch.append(img);
      swatch.classList.add('has-icon');
    }
    const label = document.createElement('div');
    label.className = 'name';
    label.textContent = locked ? '???' : name;
    const tier = document.createElement('div');
    tier.className = 'rarity';
    tier.textContent = r.name;
    card.append(swatch, label, tier);
    return card;
  }

  get shopOpen(): boolean {
    return !this.shop.classList.contains('hidden');
  }

  openShop(note = ''): void {
    byId('shopNote').textContent = note;
    this.shop.classList.remove('hidden');
  }

  closeShop(): void {
    this.shop.classList.add('hidden');
  }

  /** Redraws the shop only when a row's text or affordability changed. */
  renderShop(rows: ShopRow[]): void {
    const key = JSON.stringify(rows);
    if (key === this.last.shop) return;
    this.last.shop = key;
    this.shopRows.replaceChildren(
      ...rows.map((row) => {
        const el = document.createElement('div');
        el.className = 'shop-row';
        const text = document.createElement('div');
        text.className = 'text';
        const title = document.createElement('span');
        title.className = 'title';
        title.textContent = row.title;
        const level = document.createElement('span');
        level.className = 'level';
        level.textContent = row.level;
        const detail = document.createElement('div');
        detail.className = 'detail';
        detail.textContent = row.detail;
        text.append(title, level, detail);
        const buy = document.createElement('button');
        buy.type = 'button';
        buy.dataset.item = row.id;
        if (row.button || row.cost === null) {
          buy.textContent = row.button ?? 'MAX';
        } else {
          // A price: coin icon, then the amount.
          const coin = document.createElement('i');
          coin.className = 'coin-dot';
          buy.append(coin, formatCoins(row.cost));
        }
        buy.disabled = !row.affordable;
        el.append(text, buy);
        return el;
      }),
    );
  }

  /** The dev tuning panel. It edits the save directly, so it can skip past upgrade costs. */
  bindTuning(save: Save, hooks: TuningHooks): void {
    const level = byId<HTMLInputElement>('levelIn');
    const hazards = byId<HTMLSelectElement>('hazIn');
    level.max = String(UPGRADES.cannon.max + 1);
    const show = () => {
      level.value = String(save.cannon);
      hazards.value = save.hazards;
      byId('levelVal').textContent = String(save.cannon);
      const h = launchHeight(save.cannon);
      byId('heightVal').textContent =
        `Apex ${Math.round(h)} m · green ${Math.round(h * (1 + CHARGE.greenBonus))} m · ` +
        `perfect ${Math.round(h * (1 + CHARGE.perfectBonus))} m`;
    };
    level.addEventListener('input', () => {
      save.cannon = Number(level.value);
      show();
      hooks.changed();
    });
    // Drop focus so Space and the arrow keys go back to the game.
    level.addEventListener('change', () => level.blur());
    hazards.addEventListener('change', () => {
      save.hazards = hazards.value as HazardMode;
      hooks.changed();
      hazards.blur();
    });
    for (const btn of this.tunePanel.querySelectorAll<HTMLButtonElement>('[data-coins]')) {
      btn.addEventListener('click', () => {
        hooks.addCoins(Number(btn.dataset.coins));
        btn.blur();
      });
    }
    for (const btn of this.tunePanel.querySelectorAll<HTMLButtonElement>('[data-gems]')) {
      btn.addEventListener('click', () => {
        hooks.addGems(Number(btn.dataset.gems));
        btn.blur();
      });
    }
    // Playtest speed-up, x1 to x20 (not saved, so a reload is back to x1).
    const speed = byId<HTMLInputElement>('speedIn');
    speed.addEventListener('input', () => {
      byId('speedVal').textContent = `×${speed.value}`;
      hooks.setSpeed(Number(speed.value));
    });
    speed.addEventListener('change', () => speed.blur());
    // Active play time, in game time (what a player at normal speed would have played) and real time.
    const clock = (s: number) => {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = Math.floor(s % 60);
      return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(sec).padStart(2, '0')}s`;
    };
    const showTime = () => {
      byId('playVal').textContent = clock(save.playTime ?? 0);
      byId('playReal').textContent = `(real ${clock(save.playReal ?? 0)})`;
    };
    showTime();
    window.setInterval(showTime, 500);
    // Reset wipes the save, so it takes a second tap within 3 seconds.
    const resetBtn = byId<HTMLButtonElement>('resetBtn');
    let resetTimer = 0;
    resetBtn.addEventListener('click', () => {
      if (resetTimer) {
        hooks.resetAll();
        return;
      }
      resetBtn.textContent = 'Tap again to wipe the save';
      resetBtn.classList.add('armed');
      resetTimer = window.setTimeout(() => {
        resetTimer = 0;
        resetBtn.textContent = 'Reset everything';
        resetBtn.classList.remove('armed');
      }, 3000);
      resetBtn.blur();
    });
    // Upgrades bought in the shop move the sliders too.
    this.tuneBtn.addEventListener('click', show);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyT') show();
    });
    show();
  }
}
