// One input layer for mouse, keyboard and touch.
// Desktop: hold Space or the mouse to charge, steer with the mouse or A/D, Space or click opens the chute.
// Touch: hold anywhere to charge, drag to steer, the on-screen button opens the chute.

export type SteerMode = 'mouse' | 'keys' | 'touch';

export class Input {
  /** True while Space, the mouse button or a finger is held on the game. */
  actionDown = false;
  mouseX = 0.5;
  mode: SteerMode = 'mouse';
  isTouch = false;
  onGesture: () => void = () => {};

  private pressed = false;
  private chute = false;
  private touchDx = 0;
  private touchId = -1;
  private lastTouchX = 0;
  private keys = new Set<string>();

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
        this.chute = true;
        return;
      }
      if (['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        this.keys.add(e.code);
        this.mode = 'keys';
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

  requestChute(): void {
    this.chute = true;
  }

  consumePressed(): boolean {
    const v = this.pressed;
    this.pressed = false;
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
