import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative base so the build works from any sub-path (GitHub Pages, a NAS, a local folder).
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Paper Reader',
        short_name: 'Papers',
        description: 'Read academic papers comfortably on any screen.',
        theme_color: '#f3e7ce',
        background_color: '#fbf8f1',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,png,svg,woff2}'],
        globIgnores: ['ocr/**'],
        // The library comes from the server on every visit; never answer /api with a cached page.
        navigateFallbackDenylist: [/^\/api\//],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        runtimeCaching: [
          {
            // OCR engine and language data are large: cache them the first time they are used.
            urlPattern: ({ url }) => url.pathname.includes('/ocr/'),
            handler: 'CacheFirst',
            options: { cacheName: 'ocr-assets', expiration: { maxEntries: 10 } },
          },
          {
            urlPattern: ({ url }) => url.pathname.includes('/pdfjs/'),
            handler: 'CacheFirst',
            options: { cacheName: 'pdfjs-assets', expiration: { maxEntries: 200 } },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  // In development the library still comes from the server (pnpm serve), on its fixed port.
  server: { proxy: { '/api': 'http://localhost:4300' } },
  build: { target: 'es2020', chunkSizeWarningLimit: 3000 },
  optimizeDeps: { exclude: ['pdfjs-dist'] },
});
