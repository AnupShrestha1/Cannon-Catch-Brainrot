import { defineConfig } from 'vite';

// Relative asset paths so the build runs from any folder CrazyGames serves it from.
// Three.js alone is ~500 kB minified, so the default chunk warning would always fire.
export default defineConfig({
  base: './',
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 1000 },
});
