// The emote wheel: a ring of six wedges round the middle of the screen, like a weapon wheel. Point at a wedge
// (mouse, finger or the number keys) and it lights up with its name in the middle; click or tap it, or let go
// of G when it was held open, to play it. Clicking the middle or outside, or Escape, closes it.
import { EMOTES, type Emote } from './emotes';

const SIZE = 340;
const R_OUT = 160;
const R_IN = 62;

export class EmoteWheel {
  readonly el: HTMLDivElement;
  private wedges: SVGPathElement[] = [];
  private icons: HTMLDivElement[] = [];
  private label: HTMLDivElement;
  private hover = -1;
  private held = false;
  open = false;

  constructor(private onPick: (emote: Emote) => void) {
    const el = document.createElement('div');
    el.id = 'emoteWheel';
    el.className = 'hidden';
    const ring = document.createElement('div');
    ring.className = 'ew-ring';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`);
    const n = EMOTES.length;
    const gap = 0.035;
    EMOTES.forEach((emote, i) => {
      // Wedge i is centred straight up for i = 0, then clockwise.
      const a0 = ((i - 0.5) / n) * Math.PI * 2 + gap - Math.PI / 2;
      const a1 = ((i + 0.5) / n) * Math.PI * 2 - gap - Math.PI / 2;
      const pt = (r: number, a: number) => `${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute(
        'd',
        `M ${pt(R_IN, a0)} L ${pt(R_OUT, a0)} A ${R_OUT} ${R_OUT} 0 0 1 ${pt(R_OUT, a1)} L ${pt(R_IN, a1)} A ${R_IN} ${R_IN} 0 0 0 ${pt(R_IN, a0)} Z`,
      );
      path.setAttribute('class', 'ew-wedge');
      svg.append(path);
      this.wedges.push(path);
      const mid = (i / n) * Math.PI * 2 - Math.PI / 2;
      const icon = document.createElement('div');
      icon.className = 'ew-icon';
      icon.innerHTML = `<span class="ew-emoji">${emote.emoji}</span><span class="ew-key">${i + 1}</span>`;
      const r = (R_IN + R_OUT) / 2;
      icon.style.left = `${50 + (Math.cos(mid) * r * 100) / SIZE}%`;
      icon.style.top = `${50 + (Math.sin(mid) * r * 100) / SIZE}%`;
      this.icons.push(icon);
    });
    this.label = document.createElement('div');
    this.label.className = 'ew-label';
    ring.append(svg, ...this.icons, this.label);
    const hint = document.createElement('div');
    hint.className = 'ew-hint';
    hint.textContent = 'Pick an emote';
    el.append(ring, hint);
    document.body.append(el);
    this.el = el;

    const aim = (e: PointerEvent) => {
      const box = ring.getBoundingClientRect();
      const x = e.clientX - (box.left + box.width / 2);
      const y = e.clientY - (box.top + box.height / 2);
      const scale = box.width / SIZE;
      const d = Math.hypot(x, y) / scale;
      if (d < R_IN * 0.7) return this.setHover(-1);
      // Angle from straight up, clockwise.
      let a = Math.atan2(x, -y);
      if (a < 0) a += Math.PI * 2;
      this.setHover(Math.round((a / (Math.PI * 2)) * n) % n);
    };
    el.addEventListener('pointermove', aim);
    el.addEventListener('pointerdown', aim);
    el.addEventListener('click', (e) => {
      const box = ring.getBoundingClientRect();
      const d = Math.hypot(e.clientX - (box.left + box.width / 2), e.clientY - (box.top + box.height / 2)) / (box.width / SIZE);
      if (d > R_OUT * 1.15 || this.hover < 0) this.close();
      else this.pick(this.hover);
    });
  }

  /** Opens the wheel; `held` when G is being held, so letting go picks. */
  show(held = false): void {
    this.open = true;
    this.held = held;
    this.setHover(-1);
    this.el.classList.remove('hidden');
    requestAnimationFrame(() => this.el.classList.add('on'));
  }

  close(): void {
    this.open = false;
    this.held = false;
    this.el.classList.remove('on');
    this.el.classList.add('hidden');
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  /** Keys while it's open: 1 to 6 pick, Escape closes; letting go of a held G picks what's lit. */
  key(code: string, down: boolean): boolean {
    if (!this.open) return false;
    if (!down) {
      if (code === 'KeyG' && this.held) {
        if (this.hover >= 0) this.pick(this.hover);
        else this.close();
      }
      return true;
    }
    const digit = /^Digit([1-6])$/.exec(code);
    if (digit) this.pick(Number(digit[1]) - 1);
    else if (code === 'Escape') this.close();
    return true;
  }

  private setHover(i: number): void {
    if (i === this.hover) return;
    this.hover = i;
    this.wedges.forEach((w, j) => w.classList.toggle('on', j === i));
    this.icons.forEach((w, j) => w.classList.toggle('on', j === i));
    this.label.textContent = i >= 0 ? EMOTES[i].name : 'Emotes';
    this.label.classList.toggle('on', i >= 0);
  }

  private pick(i: number): void {
    const emote = EMOTES[i];
    this.close();
    if (emote) this.onPick(emote);
  }
}
