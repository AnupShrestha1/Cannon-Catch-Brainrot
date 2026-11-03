// One input layer for mouse, keyboard and touch.
// Desktop: hold Space or the mouse to charge, steer with the mouse or A/D, Space or click opens the chute.
// Touch: hold anywhere to charge, drag to steer, the on-screen button opens the chute.
// At the base, a tap or click picks a spot, WASD or the arrows walk, E uses the pad underfoot, 1-8 choose a
// carried character, and Space heads to the cannon.

export type SteerMode = 'mouse' | 'keys' | 'touch';

export class Input {
  /** True while Space, the mouse button or a finger is held on the game. */
  actionDown = false;
  mouseX = 0.5;
  mode: SteerMode = 'mouse';
  isTouch = false;
  onGesture: () => void = () => {};

  private pressed = false;
  private spacePressed = false;
  private tap: { x: number; y: number } | null = null;
  private chute = false;
  private touchDx = 0;
  private touchId = -1;
  private lastTouchX = 0;
  private keys = new Set<string>();
  /** Keys pressed since last consumed, for one-shot actions. */
  private taps = new Set<string>();

  constructor(surface: HTMLElement) {
    surface.addEventListener('pointerdown', (e) => {
      this.onGesture();
      if (e.pointerType === 'touch') {
        this.isTouch = true;
        this.mode = 'touch';
        this.touchId = e.pointerId;
        this.lastTouchX = e.clientX;
      } else {
        this.mouseX = e.clientX / window.innerWidth;
        this.chute = true;
      }
      this.actionDown = true;
      this.pressed = true;
      this.tap = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') {
        if (e.pointerId !== this.touchId) return;
        this.touchDx += e.clientX - this.lastTouchX;
        this.lastTouchX = e.clientX;
      } else {
        this.mouseX = e.clientX / window.innerWidth;
        this.mode = 'mouse';
      }
    });
    const release = (e: PointerEvent) => {
      if (e.pointerType === 'touch' && e.pointerId !== this.touchId) return;
      this.touchId = -1;
      this.actionDown = false;
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (e.repeat) return;
        this.onGesture();
        this.actionDown = true;
        this.pressed = true;
        this.spacePressed = true;
        this.chute = true;
        return;
      }
      if (!e.repeat) this.taps.add(e.code);
      if (['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight'].includes(e.code)) this.mode = 'keys';
      if (['KeyA', 'KeyD', 'KeyW', 'KeyS', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) {
        if (e.code.startsWith('Arrow')) e.preventDefault();
        this.keys.add(e.code);
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        this.actionDown = false;
      }
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.actionDown = false;
    });
  }

  /** -1 to 1 from A/D or the arrow keys. */
  get axis(): number {
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0;
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0;
    return right - left;
  }

  /** -1 to 1 from W/S or the up/down arrows; up is +1. */
  get axisY(): number {
    const up = this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0;
    const down = this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0;
    return up - down;
  }

  /** True once per press of a key, e.g. 'KeyE' or 'Digit3'. */
  consumeKey(code: string): boolean {
    return this.taps.delete(code);
  }

  /** Drops one-shot presses nobody read this frame, so they don't fire later. */
  endFrame(): void {
    this.taps.clear();
  }

  requestChute(): void {
    this.chute = true;
  }

  consumePressed(): boolean {
    const v = this.pressed;
    this.pressed = false;
    return v;
  }

  /** Like consumePressed, but only for Space, so a tap on the base isn't read as a launch. */
  consumeSpace(): boolean {
    const v = this.spacePressed;
    this.spacePressed = false;
    return v;
  }

  /** Screen position of the last press on the game surface. */
  consumeTap(): { x: number; y: number } | null {
    const v = this.tap;
    this.tap = null;
    return v;
  }

  consumeChute(): boolean {
    const v = this.chute;
    this.chute = false;
    return v;
  }

  consumeTouchDx(): number {
    const v = this.touchDx;
    this.touchDx = 0;
    return v;
  }
}
