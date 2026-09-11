import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'fs';
import path from 'path';

const keyPath = path.resolve(__dirname, '../certs/key.pem');
const certPath = path.resolve(__dirname, '../certs/cert.pem');
const hasCerts = fs.existsSync(keyPath) && fs.existsSync(certPath);

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: false
      },
      includeAssets: ['favicon.ico', 'favicon-32x32.png', 'favicon-16x16.png', 'apple-touch-icon.png', 'apple-touch-icon-precomposed.png', 'pwa-192x192.png', 'pwa-512x512.png', 'snist_logo.jpg'],
      manifest: {
        name: 'SNIST Attendance & Academic ERP',
        short_name: 'SNIST Attendance',
        description: 'AI-Powered QR Attendance & Academic System for Sreenidhi Institute of Science & Technology',
        start_url: '/dashboard',
        scope: '/',
        theme_color: '#0b1a3d',
        background_color: '#08142c',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: 'apple-touch-icon.png',
            sizes: '180x180',
            type: 'image/png',
            purpose: 'any'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp}'],
        globIgnores: ['**/vendor-scanner*.js'],
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            // API endpoints, auth, and attendance must NEVER be cached (private data & live rotating tokens)
            urlPattern: /^\/api\/.*$/,
            handler: 'NetworkOnly',
          },
          {
            // /qr route must be NetworkFirst (always fresh, never cached stale)
            urlPattern: /\/qr$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'public-qr-cache',
              networkTimeoutSeconds: 3,
            },
          },
          {
            // Cache scanner chunk on demand via StaleWhileRevalidate so students don't precache it
            urlPattern: /.*vendor-scanner.*\.js$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'scanner-cache',
              expiration: {
                maxEntries: 5,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
        ],
      }
    })
  ],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Isolate heavy scanner lib into separate chunk so student portal doesn't load it
            if (id.includes('html5-qrcode')) {
              return 'vendor-scanner';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }
            if (id.includes('react-router-dom') || id.includes('react-dom') || id.includes('react')) {
              return 'vendor-react';
            }
          }
        }
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: process.env.VITE_PORT ? parseInt(process.env.VITE_PORT) : 5173,
    allowedHosts: true,
    ...(hasCerts && process.env.VITE_USE_HTTPS === 'true' ? {
      https: {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      }
    } : {}),
    proxy: {
      '/api': {
        target: process.env.BACKEND_URL || process.env.VITE_BACKEND_URL || (process.env.DOCKER_ENV ? 'http://backend:8000' : 'http://127.0.0.1:8001'),
        changeOrigin: true
      }
    }
  },
  preview: {
    host: '0.0.0.0',
    port: process.env.VITE_PORT ? parseInt(process.env.VITE_PORT) : 5173,
    allowedHosts: true
  }
});
