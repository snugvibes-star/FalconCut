import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { handleAIProxy } from './server/aiProxy.mjs';

/**
 * Same-origin AI proxy for `npm run dev` and `vite preview`.
 *
 * api.openai.com (and some gateways) refuse browser CORS requests on POST
 * /chat/completions, so a client-only app can never call them. The production
 * server (scripts/serve.mjs) and this middleware both expose POST /__ai?url=…
 * and forward the request server-side, where CORS does not apply. The app
 * probes GET /__ai at runtime, so behaviour is identical in dev, preview and
 * the packaged PWA — and it silently stays direct when the proxy is absent
 * (e.g. static hosting).
 */
function aiProxy() {
  const attach = (server: { middlewares: { use: (fn: (req: never, res: never, next: () => void) => void) => void } }) => {
    server.middlewares.use((req: { url?: string }, res: never, next: () => void) => {
      if (!req.url || !req.url.startsWith('/__ai')) { next(); return; }
      void handleAIProxy(req as never, res);
    });
  };
  return { name: 'falconcut-ai-proxy', configureServer: attach, configurePreviewServer: attach };
}

export default defineConfig({
  plugins: [react(), aiProxy()],
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
  // mp4box is loaded on the first media import. Without pre-bundling, Vite
  // discovers it at runtime, re-optimizes and FULL-RELOADS the page mid-import
  // — the video can end up on the timeline with no decoded audio. Keep the
  // dependency warm from startup so importing never reloads the editor.
  optimizeDeps: { include: ['mp4box'], exclude: ['@huggingface/transformers'] },
});
