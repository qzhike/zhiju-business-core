import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: { enabled: false },
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: [...configDefaults.exclude, 'tests/persistence/**'],
    passWithNoTests: false,
  },
});
