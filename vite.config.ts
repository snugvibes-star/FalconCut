import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          transformers: ['@huggingface/transformers'],
        },
      },
    },
  },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
});