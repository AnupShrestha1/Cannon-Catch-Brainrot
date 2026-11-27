import { defineConfig, type Plugin } from 'vite';

const CRAZYGAMES_SDK = '<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>';
const POKI_SDK = '<script src="https://game-cdn.poki.com/scripts/v2/poki-sdk.js"></script>';

/**
 * The portal's SDK script in index.html: CrazyGames by default, Poki with `--mode poki`. Builds also leave out
 * everything between <!-- dev-only --> and <!-- /dev-only --> (the tuning panel), so no test tools ship.
 */
function portal(mode: string): Plugin {
  return {
    name: 'portal-sdk',
    transformIndexHtml(html, ctx) {
      let out = mode === 'poki' ? html.replace(CRAZYGAMES_SDK, POKI_SDK) : html;
      if (!ctx.server) out = out.replace(/\s*<!-- dev-only -->[\s\S]*?<!-- \/dev-only -->/g, '');
      return out;
    },
  };
}

// Relative asset paths so the build runs from any folder a portal serves it from.
// Three.js alone is ~500 kB minified, so the default chunk warning would always fire.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [portal(mode)],
  // host: listen on the local network too, so phones on the same Wi-Fi can open the dev server.
  server: { port: 5173, host: true },
  build: { chunkSizeWarningLimit: 1000, outDir: mode === 'poki' ? 'dist-poki' : 'dist' },
}));
