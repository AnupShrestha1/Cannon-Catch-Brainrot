import { defineConfig } from 'vite';

// Relative asset paths so the build runs from any folder CrazyGames serves it from.
// Three.js alone is ~500 kB minified, so the default chunk warning would always fire.
export default defineConfig({
  base: './',
  // host: listen on the local network too, so phones on the same Wi-Fi can open the dev server.
  server: { port: 5173, host: true },
  build: { chunkSizeWarningLimit: 1000 },
});
