import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 4,
  timeout: 30_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.WORKSPACE_TEST_URL,
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    trace: 'off',
  },
});
