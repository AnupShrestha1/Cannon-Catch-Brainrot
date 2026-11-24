import './style.css';
import { Game } from './game';
import { platform } from './platform';
import { useStorage } from './store';

const loader = document.getElementById('loader');
const fill = loader?.querySelector<HTMLElement>('.fill');
const status = loader?.querySelector<HTMLElement>('.status');

/** Moves the loading bar on to `pct` and says what's happening. */
function step(pct: number, text: string): void {
  if (fill) fill.style.width = `${pct}%`;
  loader?.setAttribute('aria-valuenow', String(pct));
  if (status) status.textContent = text;
}

/** Lets the browser paint the loading screen before the next heavy step. */
const paint = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** Waits for the game's fonts, but never long: the fallback fonts are fine. */
function fonts(): Promise<unknown> {
  return Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 2500))]);
}

/** Fades the loading screen away and removes it. */
function hideLoader(): void {
  if (!loader) return;
  clearInterval((window as unknown as { __loaderTips?: number }).__loaderTips);
  loader.classList.add('done');
  setTimeout(() => loader.remove(), 600);
}

async function boot(): Promise<void> {
  step(15, 'Waking up the cannon…');
  await platform.init();
  platform.loadingStart();
  if (platform.storage) useStorage(platform.storage);
  step(30, 'Fetching fonts…');
  await fonts();
  step(45, 'Building the town…');
  await paint();
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const game = new Game(canvas);
  step(75, 'Painting the sky…');
  await paint();
  await game.warmUp();
  step(100, 'Ready!');
  platform.loadingStop();
  game.start();
  if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
  // Two frames so the first picture is on screen before the loading screen fades.
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(hideLoader, 250)));
}

boot().catch((err) => {
  console.error(err);
  loader?.classList.add('failed');
  step(0, 'The game couldn\u2019t start. Check your connection and try again.');
});
