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
      includeAssets: ['favicon.ico', 'snist_logo.jpg', 'snist_logo.webp', 'apple-touch-icon.png'],
      manifest: {
        name: 'SNIST QR Attendance Management PWA',
        short_name: 'SNIST QR',
        description: 'AI-Powered QR Code Attendance System for SNIST',
        theme_color: '#15347e',
        background_color: '#f7f9fe',
        display: 'standalone',
        icons: [
          {
            src: 'snist_logo.webp',
            sizes: '192x192',
            type: 'image/webp'
          },
          {
            src: 'snist_logo.jpg',
            sizes: '192x192',
            type: 'image/jpeg'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp}'],
        globIgnores: ['**/vendor-scanner*.js'],
        runtimeCaching: [
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
    port: 3000,
    allowedHosts: true,
    ...(hasCerts ? {
      https: {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      }
    } : {}),
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true
      }
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true
  }
});
