import { defineConfig } from 'vitest/config';

// Types-only package (no runtime code, no tests). Coverage is reported for
// completeness but has no threshold — there is nothing executable to cover.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**', '**/dist/**'],
    },
  },
});