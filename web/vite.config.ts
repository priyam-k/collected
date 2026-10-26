import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    port: 5173,
    // Fail instead of moving to 5174: PUBLIC_URL and the Google redirect URIs say 5173, and a quiet port change sends the OAuth callback to whatever else is on 5173.
    strictPort: true,
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } },
  },
  build: { outDir: 'dist', sourcemap: false },
});
