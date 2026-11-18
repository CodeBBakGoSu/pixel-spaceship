import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  base: '/proto/three/',
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: { fs: { allow: [path.resolve(__dirname, '..'), path.resolve(__dirname, '../..')] } },
  build: {
    outDir: path.resolve(__dirname, '../../.proto-preview/proto/three'),
    emptyOutDir: true,
    target: 'es2022',
  },
});
