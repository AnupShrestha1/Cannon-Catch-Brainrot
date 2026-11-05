// HTML overlay on top of the 3D canvas.
import { CHARGE, RARITIES, UPGRADES, launchHeight, type Track } from './config';
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

export interface TuningHooks {
  changed(): void;
  addCoins(amount: number): void;
  addGems(amount: number): void;
  resetAll(): void;
}

export class Hud {
  readonly chuteBtn = byId<HTMLButtonElement>('chuteBtn');
  readonly againBtn = byId<HTMLButtonElement>('againBtn');
  readonly soundBtn = byId<HTMLButtonElement>('soundBtn');
  readonly tuneBtn = byId<HTMLButtonElement>('tuneBtn');
  readonly upgradesBtn = byId<HTMLButtonElement>('upgradesBtn');
  readonly bookBtn = byId<HTMLButtonElement>('bookBtn');
  readonly backpackBtn = byId<HTMLButtonElement>('backpackBtn');
  readonly launchBtn = byId<HTMLButtonElement>('launchBtn');
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
  private best = byId('best');
  private stack = byId('stack');
  private promptEl = byId('prompt');
  private toasts = byId('toasts');
  private floats = byId('floats');
  private charge = byId('charge');
  private needle = this.charge.querySelector<HTMLElement>('.needle')!;
  private ground = byId('groundBar');
  private marker = this.ground.querySelector<HTMLElement>('.marker')!;
  private crashZone = this.ground.querySelector<HTMLElement>('.crash')!;
  private perfectZone = this.ground.querySelector<HTMLElement>('.perfect')!;
  private reveal = byId('reveal');
  private revealTitle = byId('revealTitle');
  private cards = byId('cards');
  private summary = byId('summary');
  private shop = byId('shop');
  private shopRows = byId('shopRows');
  private flight = byId('flightNo');
  private stick = byId('stick');
  private actionBtn = byId<HTMLButtonElement>('actionBtn');
  private actionKey = '';
  private padLayer = byId('padBtns');
  private padPool = new Map<number, { el: HTMLButtonElement; key: string }>();
  private stickKnob = this.stick.querySelector<HTMLElement>('.knob')!;
  private modal = byId('modal');
  private modalTitle = byId('modalTitle');
  private modalBody = byId('modalBody');
  private modalButtons = byId('modalButtons');
  private last = { alt: -1, zone: '', best: -1, stack: '', prompt: '', coins: '', income: -1, gems: '', pack: -1, gift: '', shop: '' };

  constructor() {
    // Modals answer the keyboard and the backdrop too, so there's always a way out. Capture phase and
    // stopImmediatePropagation keep the key from also reaching the game (Space would launch).
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.modalOpen) return;
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

  setAlt(visible: boolean, y: number, zone: string, best: number): void {
    this.alt.classList.toggle('hidden-soft', !visible);
    if (!visible) return;
    const alt = Math.round(y);
    if (alt !== this.last.alt) {
      this.last.alt = alt;
      this.altNum.textContent = String(alt);
    }
    if (zone !== this.last.zone) {
      this.last.zone = zone;
      this.zone.textContent = zone;
    }
    const b = Math.round(best);
    if (b !== this.last.best) {
      this.last.best = b;
      this.best.textContent = b > 0 ? `Best ${b} m` : '';
    }
  }

  /** The gems collected this run, shown at the top during a flight; null hides it. */
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

  toast(text: string, kind = '', color?: string): void {
    const el = document.createElement('div');
    el.className = `toast outline ${kind}`;
    el.textContent = text;
    if (color) el.style.color = color;
    this.toasts.appendChild(el);
    setTimeout(() => el.remove(), 1400);
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

  /** frac = time to impact as a share of the bar; crash and perfect are the tops of those zones. */
  showGround(frac: number | null, crash = 0, perfect = 0): void {
    this.ground.classList.toggle('on', frac !== null);
    if (frac === null) return;
    this.crashZone.style.height = `${crash * 100}%`;
    this.perfectZone.style.bottom = `${crash * 100}%`;
    this.perfectZone.style.height = `${(perfect - crash) * 100}%`;
    this.marker.style.bottom = `calc(${frac * 100}% - 4px)`;
    this.ground.classList.toggle('danger', frac < crash);
  }

  showChute(on: boolean, pulse = false): void {
    this.chuteBtn.classList.toggle('on', on);
    this.chuteBtn.classList.toggle('pulse', on && pulse);
  }

  showBaseButtons(upgrades: boolean, launch: boolean, pulseUpgrades = false, pulseLaunch = false, pulseBook = false): void {
    this.backpackBtn.classList.toggle('on', upgrades);
    this.bookBtn.classList.toggle('on', upgrades);
    this.bookBtn.classList.toggle('pulse', upgrades && pulseBook);
    this.upgradesBtn.classList.toggle('on', upgrades);
    this.upgradesBtn.classList.toggle('pulse', upgrades && pulseUpgrades);
    this.launchBtn.classList.toggle('on', launch);
    this.launchBtn.classList.toggle('pulse', launch && pulseLaunch);
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

  get modalOpen(): boolean {
    return !this.modal.classList.contains('hidden');
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

  openShop(): void {
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
        buy.textContent = row.button ?? (row.cost === null ? 'MAX' : formatCoins(row.cost));
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
