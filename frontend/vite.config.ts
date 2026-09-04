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
      includeAssets: ['favicon.ico', 'snist_logo.jpg', 'apple-touch-icon.png'],
      manifest: {
        name: 'SNIST QR Attendance Management PWA',
        short_name: 'SNIST QR',
        description: 'AI-Powered QR Code Attendance System for SNIST',
        theme_color: '#15347e',
        background_color: '#f7f9fe',
        display: 'standalone',
        icons: [
          {
            src: 'snist_logo.jpg',
            sizes: '192x192',
            type: 'image/jpeg'
          }
        ]
      }
    })
  ],
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
  },
  build: {
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('html5-qrcode')) {
              return 'qr-scanner';
            }
            if (id.includes('lucide-react')) {
              return 'icons';
            }
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
              return 'react-vendor';
            }
            return 'vendor';
          }
        }
      }
    }
  }
});
