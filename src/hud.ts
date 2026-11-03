// HTML overlay on top of the 3D canvas.
import { CHARGE, RARITIES, launchHeight } from './config';
import type { HazardMode, Save } from './store';

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface RevealCard {
  name: string;
  rarity: number;
}

export class Hud {
  readonly chuteBtn = byId<HTMLButtonElement>('chuteBtn');
  readonly againBtn = byId<HTMLButtonElement>('againBtn');
  readonly soundBtn = byId<HTMLButtonElement>('soundBtn');
  readonly tuneBtn = byId<HTMLButtonElement>('tuneBtn');
  readonly tunePanel = byId('tune');

  private altNum = byId('altNum');
  private zone = byId('zone');
  private best = byId('best');
  private stack = byId('stack');
  private promptEl = byId('prompt');
  private toasts = byId('toasts');
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
  private flight = byId('flightNo');
  private last = { alt: -1, zone: '', best: -1, stack: '', prompt: '' };

  constructor() {
    const place = (el: HTMLElement, [from, to]: readonly [number, number]) => {
      el.style.bottom = `${from * 100}%`;
      el.style.height = `${(to - from) * 100}%`;
    };
    place(this.charge.querySelector<HTMLElement>('.green')!, CHARGE.green);
    place(this.charge.querySelector<HTMLElement>('.perfect')!, CHARGE.perfect);
  }

  setAlt(y: number, zone: string, best: number): void {
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

  setStack(rarities: number[], limit: number): void {
    const key = `${rarities.join(',')}/${limit}`;
    if (key === this.last.stack) return;
    this.last.stack = key;
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

  setFlight(n: number): void {
    this.flight.textContent = n > 0 ? `Flight ${n}` : '';
  }

  setSound(on: boolean): void {
    this.soundBtn.textContent = on ? 'Sound on' : 'Sound off';
  }

  showReveal(cards: RevealCard[], summary: string): void {
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
    this.reveal.classList.remove('hidden');
  }

  hideReveal(): void {
    this.reveal.classList.add('hidden');
  }

  bindTuning(save: Save, changed: () => void, reset: () => void): void {
    const level = byId<HTMLInputElement>('levelIn');
    const carry = byId<HTMLInputElement>('carryIn');
    const hazards = byId<HTMLSelectElement>('hazIn');
    const show = () => {
      byId('levelVal').textContent = String(save.level);
      byId('carryVal').textContent = String(save.carry);
      const h = launchHeight(save.level);
      byId('heightVal').textContent =
        `Apex ${Math.round(h)} m · green ${Math.round(h * (1 + CHARGE.greenBonus))} m · ` +
        `perfect ${Math.round(h * (1 + CHARGE.perfectBonus))} m`;
    };
    level.value = String(save.level);
    carry.value = String(save.carry);
    hazards.value = save.hazards;
    level.addEventListener('input', () => {
      save.level = Number(level.value);
      show();
      changed();
    });
    carry.addEventListener('input', () => {
      save.carry = Number(carry.value);
      show();
      changed();
    });
    // Drop focus so Space and the arrow keys go back to the game.
    for (const el of [level, carry]) el.addEventListener('change', () => el.blur());
    hazards.addEventListener('change', () => {
      save.hazards = hazards.value as HazardMode;
      changed();
      hazards.blur();
    });
    const resetBtn = byId<HTMLButtonElement>('resetBtn');
    resetBtn.addEventListener('click', () => {
      reset();
      resetBtn.blur();
    });
    show();
  }
}
