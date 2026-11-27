// The landing menu for returning players: the game's logo over their live town (the camera circles their
// showcase behind it), a welcome with their best height, brainrots and income, and one big PLAY button.
// One click (or Space / Enter) and they're in: CrazyGames allows at most one click before gameplay, and new
// players skip the menu altogether and land straight in the tutorial.

export interface MenuInfo {
  name: string;
  best: string;
  income: string;
  brainrots: number;
  rebirths: number;
  sound: boolean;
  music: boolean;
}

export interface MenuActions {
  play(): void;
  /** Toggle and return the new state (true = on). */
  sound(): boolean;
  music(): boolean;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export class Menu {
  private root = el('div');
  private closed = false;

  constructor(info: MenuInfo, private actions: MenuActions) {
    this.root.id = 'menu';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Cannon Catch Brainrot');

    const logo = el('h1', 'menu-logo');
    logo.append(el('span', 'l1', 'Cannon'), el('span', 'l2', 'Catch'), el('span', 'l3', 'Brainrot'));

    const hello = el('p', 'menu-hello', info.name ? `Welcome back, ${info.name}!` : 'Welcome back!');
    const solo = el('p', 'menu-solo', 'Single-player · your neighbours are 🤖 bots');

    const stats = el('div', 'menu-stats');
    const chip = (icon: string, value: string, label: string) => {
      const c = el('div', 'menu-chip');
      c.append(el('span', 'ic', icon), el('b', '', value), el('small', '', label));
      stats.append(c);
    };
    chip('🏆', info.best, 'best height');
    chip('🧠', String(info.brainrots), info.brainrots === 1 ? 'brainrot' : 'brainrots');
    if (info.income !== '0') chip('💰', info.income, 'per second');
    if (info.rebirths > 0) chip('🔁', `Lv ${info.rebirths}`, 'rebirth');

    const play = el('button', 'menu-play', 'PLAY');
    play.type = 'button';
    play.append(el('span', 'key', 'Press Space'));
    play.addEventListener('click', () => this.play());

    const corner = el('div', 'menu-corner');
    const toggle = (label: string, on: boolean, icons: [string, string], flip: () => boolean) => {
      const b = el('button', 'menu-toggle');
      b.type = 'button';
      const paint = (state: boolean) => {
        b.textContent = state ? icons[0] : icons[1];
        b.setAttribute('aria-label', `${label} ${state ? 'on' : 'off'}`);
        b.title = `${label} ${state ? 'on' : 'off'}`;
        b.classList.toggle('off', !state);
      };
      paint(on);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        paint(flip());
        b.blur();
      });
      corner.append(b);
    };
    toggle('Sound', info.sound, ['🔊', '🔇'], () => this.actions.sound());
    toggle('Music', info.music, ['🎵', '🔕'], () => this.actions.music());

    const card = el('div', 'menu-card');
    card.append(logo, hello, solo, stats, play);
    this.root.append(el('div', 'menu-shade'), card, corner);
    document.body.append(this.root);
    document.body.classList.add('menu-open');
    window.addEventListener('keydown', this.onKey, true);
    // Focus PLAY so a keyboard (or a controller mapped to Enter) starts straight away.
    requestAnimationFrame(() => play.focus({ preventScroll: true }));
  }

  get open(): boolean {
    return !this.closed;
  }

  /** While the menu is up the game gets no keys; Space or Enter plays. */
  private onKey = (e: KeyboardEvent) => {
    if (this.closed) return;
    e.stopImmediatePropagation();
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      if (!e.repeat) this.play();
    }
  };

  private play(): void {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener('keydown', this.onKey, true);
    document.body.classList.remove('menu-open');
    this.root.classList.add('done');
    setTimeout(() => this.root.remove(), 450);
    this.actions.play();
  }
}
