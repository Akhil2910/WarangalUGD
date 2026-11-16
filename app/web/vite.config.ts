import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API and map data come from the server on port 8787.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8787', '/data': 'http://127.0.0.1:8787' },
  },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 1500 },
  worker: { format: 'es' },
});
