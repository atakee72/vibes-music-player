import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Absolute base is required for a working service worker (SW scope must
  // resolve from an absolute path). All deploys are root-domain, so '/' is safe.
  base: '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      pwaAssets: { config: true },
      manifest: {
        name: 'Vibes',
        short_name: 'Vibes',
        description:
          'A browser music player with an Apple-Music-style UI, real-time audio visualization, and metadata extraction from local files.',
        theme_color: '#8b5cf6',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        scope: '/',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          music: ['music-metadata'],
        },
      },
    },
  },
});
