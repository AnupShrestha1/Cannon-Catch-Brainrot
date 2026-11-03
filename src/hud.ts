// HTML overlay on top of the 3D canvas.
import { CHARGE, ECONOMY, RARITIES, UPGRADES, launchHeight, type Track } from './config';
import { formatCoins } from './economy';
import type { HazardMode, Save } from './store';

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface RevealCard {
  name: string;
  rarity: number;
}

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

export interface TuningHooks {
  changed(): void;
  addCoins(): void;
  resetAll(): void;
}

export class Hud {
  readonly chuteBtn = byId<HTMLButtonElement>('chuteBtn');
  readonly againBtn = byId<HTMLButtonElement>('againBtn');
  readonly soundBtn = byId<HTMLButtonElement>('soundBtn');
  readonly tuneBtn = byId<HTMLButtonElement>('tuneBtn');
  readonly upgradesBtn = byId<HTMLButtonElement>('upgradesBtn');
  readonly launchBtn = byId<HTMLButtonElement>('launchBtn');
  readonly giftBtn = byId<HTMLButtonElement>('giftBtn');
  readonly tunePanel = byId('tune');
  onBuy: (item: ShopItem) => void = () => {};

  private coins = byId('coins');
  private income = byId('income');
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
  private last = { alt: -1, zone: '', best: -1, stack: '', prompt: '', coins: '', income: -1, gift: '', shop: '' };

  constructor() {
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

  setWallet(coins: number, income: number): void {
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

  setStack(rarities: number[], limit: number, visible: boolean): void {
    const key = visible ? `${rarities.join(',')}/${limit}` : '';
    if (key === this.last.stack) return;
    this.last.stack = key;
    if (!visible) {
      this.stack.replaceChildren();
      return;
    }
    const slots = Array.from({ length: limit }, (_, i) => {
      const slot = document.createElement('div');
      slot.className = 'slot';
      const rarity = rarities[i];
      if (rarity !== undefined) {
        slot.classList.add('filled');
        slot.style.setProperty('--c', RARITIES[rarity].css);
        if (rarity === RARITIES.length - 1) slot.classList.add('secret');
      }
      return slot;
    });
    this.stack.replaceChildren(...slots);
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

  showBaseButtons(upgrades: boolean, launch: boolean, pulseUpgrades = false, pulseLaunch = false): void {
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

  showReveal(cards: RevealCard[], summary: string, button: string): void {
    this.revealTitle.textContent = cards.length ? `Caught ${cards.length}!` : 'Nothing caught';
    this.cards.replaceChildren(
      ...cards.map((c, i) => {
        const r = RARITIES[c.rarity];
        const card = document.createElement('div');
        card.className = 'card';
        if (c.rarity >= 2) card.classList.add('rare');
        if (c.rarity === RARITIES.length - 1) card.classList.add('secret');
        card.style.setProperty('--c', r.css);
        card.style.animationDelay = `${0.25 + i * 0.32}s`;
        const swatch = document.createElement('div');
        swatch.className = 'swatch';
        const name = document.createElement('div');
        name.className = 'name';
        name.textContent = c.name;
        const rarity = document.createElement('div');
        rarity.className = 'rarity';
        rarity.textContent = r.name;
        const income = document.createElement('div');
        income.className = 'income';
        income.textContent = `+${r.income.toLocaleString()} coins/s`;
        card.append(swatch, name, rarity, income);
        return card;
      }),
    );
    this.summary.textContent = summary;
    this.againBtn.textContent = button;
    this.reveal.classList.remove('hidden');
  }

  hideReveal(): void {
    this.reveal.classList.add('hidden');
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
    const carry = byId<HTMLInputElement>('carryIn');
    const hazards = byId<HTMLSelectElement>('hazIn');
    level.max = String(UPGRADES.cannon.max + 1);
    carry.max = String(UPGRADES.carry.max);
    const show = () => {
      level.value = String(save.cannon);
      carry.value = String(save.carryLevel);
      hazards.value = save.hazards;
      byId('levelVal').textContent = String(save.cannon);
      byId('carryVal').textContent = String(ECONOMY.startCarry + save.carryLevel);
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
    carry.addEventListener('input', () => {
      save.carryLevel = Number(carry.value);
      show();
      hooks.changed();
    });
    // Drop focus so Space and the arrow keys go back to the game.
    for (const el of [level, carry]) el.addEventListener('change', () => el.blur());
    hazards.addEventListener('change', () => {
      save.hazards = hazards.value as HazardMode;
      hooks.changed();
      hazards.blur();
    });
    const coinsBtn = byId<HTMLButtonElement>('coinsBtn');
    coinsBtn.addEventListener('click', () => {
      hooks.addCoins();
      coinsBtn.blur();
    });
    byId<HTMLButtonElement>('resetBtn').addEventListener('click', () => hooks.resetAll());
    // Upgrades bought in the shop move the sliders too.
    this.tuneBtn.addEventListener('click', show);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyT') show();
    });
    show();
  }
}
