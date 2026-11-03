import './style.css';
import { Game } from './game';
import { platform } from './platform';
import { useStorage } from './store';

async function boot(): Promise<void> {
  await platform.init();
  platform.loadingStart();
  if (platform.storage) useStorage(platform.storage);
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const game = new Game(canvas);
  platform.loadingStop();
  game.start();
  if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
}

void boot();
