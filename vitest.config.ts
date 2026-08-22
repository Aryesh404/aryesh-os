import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/intelligence/src/**'],
      // Type-only modules emit no statements; counting them as 0% is noise.
      exclude: ['**/types.ts', '**/index.ts'],
      // The intelligence core is pure and is the part that must be correct.
      // It is the only package with a coverage floor.
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
