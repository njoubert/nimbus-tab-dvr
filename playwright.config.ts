// Copyright (C) 2026 Niels Joubert
// SPDX-License-Identifier: MIT

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 240_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  webServer: {
    command: 'node scripts/demo/serve.mjs',
    url: 'http://localhost:5173/',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
