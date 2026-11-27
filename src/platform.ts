// The game portal's SDK, behind one wrapper. `npm run build` makes the CrazyGames build (CrazyGames HTML5 SDK v3)
// and `npm run build:poki` the Poki build (Poki SDK v2); the build mode picks the SDK script in index.html too.
// Either way the wrapper does nothing when the SDK is missing (blocked script, offline, ad blocker) or disabled,
// so the game always stays playable.
// Docs: https://docs.crazygames.com/sdk/intro/ and https://developers.poki.com/guide/sdk-html5

interface CrazySettings {
  muteAudio: boolean;
}

interface CrazySdk {
  init(): Promise<void>;
  environment: 'local' | 'crazygames' | 'disabled';
  game: {
    loadingStart(): void;
    loadingStop(): void;
    gameplayStart(): void;
    gameplayStop(): void;
    happytime(): void;
    settings: CrazySettings;
    addSettingsChangeListener(listener: (settings: CrazySettings) => void): void;
  };
  data: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  user?: {
    getUser(): Promise<{ username: string } | null>;
    systemInfo?: { device?: { type?: 'desktop' | 'tablet' | 'mobile' } };
  };
}

interface PokiSdk {
  init(): Promise<void>;
  gameLoadingFinished(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  commercialBreak(onStart?: () => void): Promise<void>;
  movePill?(topPercent: number, topPx: number): void;
}

declare global {
  interface Window {
    CrazyGames?: { SDK: CrazySdk };
    PokiSDK?: PokiSdk;
  }
}

/** Which portal this build is for. */
export const PORTAL: 'crazygames' | 'poki' = import.meta.env.MODE === 'poki' ? 'poki' : 'crazygames';

let crazy: CrazySdk | null = null;
let poki: PokiSdk | null = null;
/** Poki's init failed (usually an ad blocker): the game runs on, with no ad breaks. */
let pokiAds = false;

/** What the game says (playing or on a break), what the SDK was last told, and whether an ad is showing. */
let wantPlaying = false;
let playing = false;
let inBreak = false;
/** Poki: gameplay can only start on the player's first input, never on load. */
let interacted = PORTAL !== 'poki';

function safely(what: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.warn(`${what} SDK call failed`, err);
  }
}

/**
 * Sends gameplayStart / gameplayStop when the state really changes: never the same event twice in a row, nothing
 * during an ad, and (on Poki) no start before the player's first input.
 */
function sync(): void {
  const next = wantPlaying && interacted && !inBreak;
  if (next === playing) return;
  playing = next;
  if (crazy) safely('CrazyGames', () => (next ? crazy!.game.gameplayStart() : crazy!.game.gameplayStop()));
  if (poki) safely('Poki', () => (next ? poki!.gameplayStart() : poki!.gameplayStop()));
}

/** Waits for a promise, but never longer than `ms`. */
function capped<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))]);
}

export const platform = {
  /** Waits for the SDK, but never more than 4 seconds, so a slow or blocked script can't stall the game. */
  async init(): Promise<void> {
    if (PORTAL === 'poki') {
      const candidate = window.PokiSDK;
      if (!candidate) return;
      poki = candidate;
      try {
        await capped(candidate.init(), 4000);
        pokiAds = true;
      } catch (err) {
        // Poki's advice: load the game anyway.
        console.warn('Poki SDK init failed', err);
      }
      const first = () => {
        interacted = true;
        sync();
        for (const type of ['pointerdown', 'keydown', 'touchstart'] as const) window.removeEventListener(type, first, true);
      };
      for (const type of ['pointerdown', 'keydown', 'touchstart'] as const) window.addEventListener(type, first, true);
      return;
    }
    const candidate = window.CrazyGames?.SDK;
    if (!candidate) return;
    try {
      await capped(candidate.init(), 4000);
    } catch (err) {
      console.warn('CrazyGames SDK unavailable', err);
      return;
    }
    if (candidate.environment !== 'disabled') crazy = candidate;
  },

  /** CrazyGames' cross-device save (localStorage for guests). Null elsewhere: the game uses localStorage. */
  get storage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
    return crazy ? crazy.data : null;
  },

  loadingStart(): void {
    if (crazy) safely('CrazyGames', () => crazy!.game.loadingStart());
  },

  /** Loading is done (CrazyGames' loadingStop, Poki's gameLoadingFinished). */
  loadingStop(): void {
    if (crazy) safely('CrazyGames', () => crazy!.game.loadingStop());
    if (poki) safely('Poki', () => poki!.gameLoadingFinished());
  },

  /**
   * Whether the player is in play or on a break (menu, pause, shop, popup, the end of a flight). Safe to call every
   * frame: only changes are sent.
   */
  setPlaying(on: boolean): void {
    wantPlaying = on;
    sync();
  },

  /**
   * A natural break heading back into play (the end of a flight, leaving the pause screen): on Poki an ad may show
   * here. Gameplay stops first; `onAdStart` runs if an ad really starts (mute everything then). Resolves when play can
   * go on; the game's next setPlaying(true) is the gameplayStart that follows. Elsewhere it resolves at once.
   */
  async commercialBreak(onAdStart: () => void): Promise<void> {
    if (!poki || !pokiAds) return;
    wantPlaying = false;
    sync();
    inBreak = true;
    try {
      await poki.commercialBreak(onAdStart);
    } catch (err) {
      console.warn('Poki commercialBreak failed', err);
    } finally {
      inBreak = false;
    }
  },

  /** A celebration moment; CrazyGames asks for it to be rare. */
  happytime(): void {
    if (crazy) safely('CrazyGames', () => crazy!.game.happytime());
  },

  /**
   * Whether this is a phone or tablet (tablets get the touch controls too). CrazyGames asks games to use its system
   * info for this rather than touch detection; elsewhere a coarse pointer (a finger) stands in.
   */
  get isMobile(): boolean {
    const type = crazy?.user?.systemInfo?.device?.type;
    if (type) return type !== 'desktop';
    return matchMedia('(pointer: coarse)').matches;
  },

  /** The signed-in CrazyGames username, or null for guests and elsewhere. */
  async username(): Promise<string | null> {
    if (!crazy?.user) return null;
    try {
      return (await crazy.user.getUser())?.username || null;
    } catch {
      return null;
    }
  },

  /** CrazyGames' mute setting, which overrides the game's own. */
  get muted(): boolean {
    return crazy?.game.settings.muteAudio ?? false;
  },

  onSettingsChange(listener: () => void): void {
    if (crazy) safely('CrazyGames', () => crazy!.game.addSettingsChangeListener(listener));
  },

  /** Poki's pill on phones: moves it down the game area (topPercent 0-50, then topPx). */
  movePill(topPercent: number, topPx: number): void {
    if (poki?.movePill) safely('Poki', () => poki!.movePill!(topPercent, topPx));
  },
};
