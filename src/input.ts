// One input layer for mouse, keyboard and touch.
// Desktop: hold Space or the mouse to charge, steer with the mouse or A/D, Space or click opens the chute.
// Touch: hold anywhere to charge, drag to steer, the on-screen button opens the chute.
// At the base: WASD or the arrows walk, dragging the mouse turns the camera, E uses the slot underfoot or
// the gacha machine, B opens the backpack and Space heads to the cannon. On touch, a drag that starts on the left of
// the screen is a joystick and a drag on the right turns the camera; on-screen buttons do the rest.

export type SteerMode = 'mouse' | 'keys' | 'touch';

/** A press on the game surface, followed until release to tell taps from drags. */
interface Gesture {
  touch: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  kind: 'none' | 'stick' | 'orbit';
}

/** Pixels a press can move and still count as a tap. */
const TAP_SLOP = 10;
/** Pixels of joystick drag for full speed. */
const STICK_RANGE = 60;

export class Input {
  /** True while Space, the mouse button or a finger is held on the game. */
  actionDown = false;
  mouseX = 0.5;
  mode: SteerMode = 'mouse';
  isTouch = false;
  onGesture: () => void = () => {};
  /** The touch joystick at the base: where it started on screen, and its direction (x right, y up, length ≤ 1). */
  readonly stick = { active: false, originX: 0, originY: 0, x: 0, y: 0 };

  private pressed = false;
  private spacePressed = false;
  private tap: { x: number; y: number } | null = null;
  private chute = false;
  private touchDx = 0;
  private orbitDx = 0;
  private orbitDy = 0;
  private touchId = -1;
  private lastTouchX = 0;
  private gestures = new Map<number, Gesture>();
  private keys = new Set<string>();
  /** Keys pressed since last consumed, for one-shot actions. */
  private taps = new Set<string>();

  constructor(surface: HTMLElement) {
    surface.addEventListener('pointerdown', (e) => {
      this.onGesture();
      const touch = e.pointerType === 'touch';
      if (touch) {
        this.isTouch = true;
        this.mode = 'touch';
        if (this.touchId < 0) {
          this.touchId = e.pointerId;
          this.lastTouchX = e.clientX;
        }
      } else {
        this.mouseX = e.clientX / window.innerWidth;
        this.chute = true;
      }
      this.gestures.set(e.pointerId, { touch, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, kind: 'none' });
      this.actionDown = true;
      this.pressed = true;
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') {
        if (e.pointerId === this.touchId) {
          this.touchDx += e.clientX - this.lastTouchX;
          this.lastTouchX = e.clientX;
        }
      } else {
        this.mouseX = e.clientX / window.innerWidth;
        this.mode = 'mouse';
      }
      const g = this.gestures.get(e.pointerId);
      if (g) this.drag(g, e.clientX, e.clientY);
    });
    const release = (e: PointerEvent) => {
      const g = this.gestures.get(e.pointerId);
      if (g) {
        if (g.kind === 'none') this.tap = { x: e.clientX, y: e.clientY };
        if (g.kind === 'stick') this.stick.active = false;
        this.gestures.delete(e.pointerId);
      }
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
      if (e.code === 'Tab') e.preventDefault();
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
      this.gestures.clear();
      this.stick.active = false;
      this.actionDown = false;
    });
  }

  /** Once a press moves past TAP_SLOP it becomes a drag: a joystick on the left half for touch, else the camera. */
  private drag(g: Gesture, x: number, y: number): void {
    const dx = x - g.startX;
    const dy = y - g.startY;
    if (g.kind === 'none' && Math.hypot(dx, dy) > TAP_SLOP) {
      g.kind = g.touch && g.startX < window.innerWidth * 0.45 ? 'stick' : 'orbit';
      if (g.kind === 'stick') {
        this.stick.active = true;
        this.stick.originX = g.startX;
        this.stick.originY = g.startY;
      }
    }
    if (g.kind === 'orbit') {
      this.orbitDx += x - g.lastX;
      this.orbitDy += y - g.lastY;
    }
    if (g.kind === 'stick') {
      const len = Math.hypot(dx, dy);
      const scale = len > STICK_RANGE ? 1 / len : 1 / STICK_RANGE;
      this.stick.x = dx * scale;
      this.stick.y = -dy * scale;
    }
    g.lastX = x;
    g.lastY = y;
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

  /** Screen position of the last tap or click: a press released without dragging. */
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

  /** Horizontal pixels dragged to turn the base camera since last read. */
  /** Vertical camera drag since the last call, in pixels (down is positive). */
  consumeOrbitDy(): number {
    const v = this.orbitDy;
    this.orbitDy = 0;
    return v;
  }

  consumeOrbitDx(): number {
    const v = this.orbitDx;
    this.orbitDx = 0;
    return v;
  }
}
