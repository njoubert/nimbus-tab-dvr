// Copyright (C) 2026 Niels Joubert
// SPDX-License-Identifier: MIT

import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const root = resolve(import.meta.dirname, 'src/demo');

export default defineConfig({
  root,
  build: {
    outDir: resolve(import.meta.dirname, 'dist/demo'),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(root, 'index.html'),
        record: resolve(root, 'record.html'),
      },
    },
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
});
