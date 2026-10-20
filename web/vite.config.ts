import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import { defineConfig } from 'vite';

// The Node server owns all data; in dev we proxy its routes so the browser sees one origin (no CORS,
// and the server's Host/Origin checks still pass because the proxy rewrites them to the target).
const API = 'http://127.0.0.1:3777';

export default defineConfig({
  // The app lives under /next/ until Phase 8 cut-over, so asset URLs must be prefixed.
  base: '/next/',
  plugins: [
    react(),
    // React Compiler: auto-memoizes components, so we do not write useMemo/useCallback by hand.
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/events': { target: API, changeOrigin: true },
      '/mcp': { target: API, changeOrigin: true },
      '/reply': { target: API, changeOrigin: true },
    },
  },
});
