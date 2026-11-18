import { defineConfig } from 'vite';

const pagesBase =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.GITHUB_PAGES === 'true'
    ? '/pixel-spaceship/'
    : './';

export default defineConfig({
  base: pagesBase,
  resolve: { dedupe: ['three'] },
  build: { rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
  server: { host: '0.0.0.0', port: 5180, strictPort: true },
  preview: { host: '0.0.0.0', port: 5180, strictPort: true },
});
