// CrazyGames HTML5 SDK v3, behind a wrapper that does nothing when the SDK is missing (blocked script,
// offline) or disabled (any domain other than localhost or CrazyGames). Docs: https://docs.crazygames.com/sdk/intro/

interface CrazySettings {
  muteAudio: boolean;
  disableChat: boolean;
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
}

declare global {
  interface Window {
    CrazyGames?: { SDK: CrazySdk };
  }
}

let sdk: CrazySdk | null = null;
let playing = false;

function call(fn: (s: CrazySdk) => void): void {
  if (!sdk) return;
  try {
    fn(sdk);
  } catch (err) {
    console.warn('CrazyGames SDK call failed', err);
  }
}

export const platform = {
  /** Waits for the SDK, but never more than 4 seconds, so a slow or blocked script can't stall the game. */
  async init(): Promise<void> {
    const candidate = window.CrazyGames?.SDK;
    if (!candidate) return;
    try {
      await Promise.race([
        candidate.init(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('SDK init timed out')), 4000)),
      ]);
    } catch (err) {
      console.warn('CrazyGames SDK unavailable', err);
      return;
    }
    if (candidate.environment !== 'disabled') sdk = candidate;
  },

  /** The SDK's cross-device save, which falls back to localStorage for guests. Null without the SDK. */
  get storage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
    return sdk ? sdk.data : null;
  },

  loadingStart(): void {
    call((s) => s.game.loadingStart());
  },

  loadingStop(): void {
    call((s) => s.game.loadingStop());
  },

  /**
   * Tells CrazyGames whether the player is in play or on a break (shop, reveal screen). Safe to call
   * every frame: it only sends changes. The first `true` is the gameplay-start event that CrazyGames
   * measures the initial download against.
   */
  setPlaying(on: boolean): void {
    if (on === playing) return;
    playing = on;
    call((s) => (on ? s.game.gameplayStart() : s.game.gameplayStop()));
  },

  /** A celebration moment; CrazyGames asks for it to be rare. */
  happytime(): void {
    call((s) => s.game.happytime());
  },

  /** CrazyGames' mute setting, which overrides the game's own. */
  get muted(): boolean {
    return sdk?.game.settings.muteAudio ?? false;
  },

  onSettingsChange(listener: () => void): void {
    call((s) => s.game.addSettingsChangeListener(listener));
  },
};
