import { defineConfig } from 'vite';

export default defineConfig({
  // Use repository name for GitHub Pages, or './' for local development
  base: process.env.GITHUB_ACTIONS ? '/ListeningEar/' : './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  },
  server: {
    port: 3000,
    open: true
  }
});
