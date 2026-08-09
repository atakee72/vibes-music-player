import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Absolute base is required for a working service worker (SW scope must
  // resolve from an absolute path). All deploys are root-domain, so '/' is safe.
  base: '/',
  // ES-format workers: the default iife format cannot code-split, which would
  // inline every music-metadata parser chunk into one monolithic worker file.
  worker: { format: 'es' },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      pwaAssets: { config: true },
      manifest: {
        name: 'Vibes',
        short_name: 'Vibes',
        description:
          'A browser music player with a warm analog-dusk UI, real-time audio visualization, and metadata extraction from local files.',
        theme_color: '#150A24',
        background_color: '#150A24',
        display: 'standalone',
        start_url: '/',
        scope: '/',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // The SW was adding ~1.4s to navigations on slower hardware: every
        // navigation blocked on SW boot before the cached HTML was returned.
        // Navigation Preload lets the browser fetch the HTML *in parallel* with
        // SW startup, hiding the boot latency behind the (tiny) network fetch.
        navigationPreload: true,
        // Disable vite-plugin-pwa's default cache-only navigation fallback
        // (`navigateFallback: 'index.html'`). That route is registered first and
        // would shadow the NetworkFirst route below, serving from precache and
        // *ignoring* the preload response — defeating navigation preload.
        navigateFallback: undefined,
        // Handle navigations NetworkFirst so the preloaded response is actually
        // used; offline falls back to the `html` cache (seeded on first online
        // load). index.html stays precached as the ultimate shell fallback.
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html',
              networkTimeoutSeconds: 3,
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          // NOTE: don't force `music-metadata` into a named manualChunk — that
          // pulls it into the eagerly-modulepreloaded set. All imports of it are
          // now dynamic (`await import('music-metadata')`), so Rollup auto-splits
          // it into an on-demand chunk that stays off the startup critical path.
        },
      },
    },
  },
});
