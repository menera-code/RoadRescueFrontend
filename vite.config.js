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