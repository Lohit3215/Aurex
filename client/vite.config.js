import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Localhost-first dev setup:
 *  - the client runs on 5173 and proxies `/ws` (signaling) and `/api` (health)
 *    to the signaling server, so the browser talks to a single origin and
 *    CORS/WS origin checks never get in the way.
 *  - `VITE_SIGNALING_URL` still wins when a deployment needs a different host.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.SIGNALING_PROXY_TARGET || env.VITE_DEV_PROXY_TARGET || 'http://127.0.0.1:4000';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: false,
      proxy: {
        '/ws': { target, ws: true, changeOrigin: true },
        '/api': { target, changeOrigin: true },
        '/health': { target, changeOrigin: true },
      },
    },
    preview: {
      port: 4173,
      proxy: {
        '/ws': { target, ws: true, changeOrigin: true },
        '/api': { target, changeOrigin: true },
        '/health': { target, changeOrigin: true },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: mode !== 'production',
      target: 'es2020',
    },
    define: {
      __DEV__: JSON.stringify(mode !== 'production'),
    },
  };
});
