// The pause screen: Esc, P or the Pause button stops the game (time, flights, bots, income) and shows this over
// it, with sound and music switches and the controls. Esc, P, Space, Enter or RESUME carries on.

export interface PauseOptions {
  mobile: boolean;
  sound: boolean;
  music: boolean;
}

export interface PauseActions {
  resume(): void;
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

const DESKTOP: [string, string][] = [
  ['Walk', 'WASD or arrow keys'],
  ['Look around', 'Drag with the mouse'],
  ['Use, pull, merge', 'E'],
  ['Launch', 'F, or the Launch button'],
  ['Charge and fire', 'Hold and release Space or the mouse'],
  ['Steer', 'Mouse, or A / D'],
  ['Parachute', 'Space or click'],
  ['Backpack · Emotes · Mute', 'B · G · M'],
];

const TOUCH: [string, string][] = [
  ['Walk', 'Drag on the left side'],
  ['Look around', 'Drag on the right side'],
  ['Use, pull, merge', 'The action button'],
  ['Charge and fire', 'Hold and release anywhere'],
  ['Steer', 'Hold and drag left or right'],
  ['Parachute', 'The PARACHUTE button'],
];

export class PauseMenu {
  private root = el('div');
  private closed = false;

  constructor(options: PauseOptions, private actions: PauseActions) {
    this.root.id = 'pause';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Paused');

    const card = el('div', 'pause-card');
    const title = el('h2', 'pause-title', 'PAUSED');

    const resume = el('button', 'pause-resume', 'RESUME');
    resume.type = 'button';
    if (!options.mobile) resume.append(el('span', 'key', 'Esc or Space'));
    resume.addEventListener('click', () => this.close());

    const toggles = el('div', 'pause-toggles');
    const toggle = (label: string, on: boolean, icons: [string, string], flip: () => boolean) => {
      const b = el('button', 'pause-toggle');
      b.type = 'button';
      const paint = (state: boolean) => {
        b.textContent = `${state ? icons[0] : icons[1]} ${label} ${state ? 'on' : 'off'}`;
        b.classList.toggle('off', !state);
      };
      paint(on);
      b.addEventListener('click', () => {
        paint(flip());
        b.blur();
      });
      toggles.append(b);
    };
    toggle('Sound', options.sound, ['🔊', '🔇'], () => this.actions.sound());
    toggle('Music', options.music, ['🎵', '🔕'], () => this.actions.music());

    const controls = el('dl', 'pause-controls');
    for (const [what, how] of options.mobile ? TOUCH : DESKTOP) controls.append(el('dt', '', what), el('dd', '', how));

    card.append(title, resume, toggles, controls);
    this.root.append(card);
    document.body.append(this.root);
    window.addEventListener('keydown', this.onKey, true);
    requestAnimationFrame(() => resume.focus({ preventScroll: true }));
  }

  /** While paused the game gets no keys; Esc, P, Space or Enter resumes. */
  private onKey = (e: KeyboardEvent) => {
    if (this.closed) return;
    e.stopImmediatePropagation();
    if (['Escape', 'KeyP', 'Space', 'Enter', 'NumpadEnter'].includes(e.code)) {
      e.preventDefault();
      if (!e.repeat) this.close();
    }
  };

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener('keydown', this.onKey, true);
    this.root.remove();
    this.actions.resume();
  }
}
