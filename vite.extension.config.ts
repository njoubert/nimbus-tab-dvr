// Copyright (C) 2026 Niels Joubert
// SPDX-License-Identifier: MIT

// The extension has four entries: a service worker, a content script, and two pages. Vite is
// a one-page tool, so each is named here and the output keeps their names, because the
// manifest refers to them by name and a hash would break it.

import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const root = resolve(import.meta.dirname, 'src/extension');

export default defineConfig({
  root,
  publicDir: resolve(root, 'public'),
  build: {
    outDir: resolve(import.meta.dirname, 'dist/extension'),
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    target: 'esnext',
    modulePreload: false,
    rollupOptions: {
      input: {
        'service-worker': resolve(root, 'service-worker.ts'),
        'content-script': resolve(root, 'content-script.ts'),
        offscreen: resolve(root, 'offscreen.html'),
        console: resolve(root, 'console.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
