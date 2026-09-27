import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: { enabled: false },
    include: ['tests/persistence/**/*.test.ts'],
    passWithNoTests: false,
    fileParallelism: false,
    reporters: ['default', './tools/persistence/progress-reporter.mjs'],
  },
});
