import { defineConfig } from 'vite';

export default defineConfig({
  // Use repository name for GitHub Pages, or './' for local development
  base: process.env.GITHUB_ACTIONS ? '/ListeningEar/' : './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    target: 'esnext',  // Required for top-level await used by transformers.js
  },
  worker: {
    format: 'es',  // ES module workers needed for transformers.js imports
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],  // Don't pre-bundle — uses WASM
  },
  server: {
    port: 3000,
    open: true,
    headers: {
      // Enables SharedArrayBuffer for multi-threaded WASM (dev only)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
