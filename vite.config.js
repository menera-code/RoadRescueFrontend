import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),

    VitePWA({
      registerType: 'autoUpdate',

      manifest: {
        name: 'RESQAPP - Road Rescue Assistance',
        short_name: 'RESQAPP',
        description:
          'Road Emergency and Quick Response Application for incident reporting and emergency assistance.',

        theme_color: '#dc2626',
        background_color: '#ffffff',

        display: 'standalone',

        start_url: '/',
        scope: '/',

        orientation: 'portrait',

        categories: [
          'emergency',
          'navigation',
          'utilities',
        ],

        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },

      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],

  server: {
    host: true,
    port: 5173,

    allowedHosts: ['privacy-diameter-reseal.ngrok-free.dev'],

    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/auth': 'http://127.0.0.1:8000',
      '/admin': 'http://127.0.0.1:8000',
      '/uploads': 'http://127.0.0.1:8000',
      '/chat': 'http://127.0.0.1:8000',
    },
  },

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})