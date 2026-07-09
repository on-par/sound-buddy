import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // `scripts/` holds dev/benchmark tooling, not shipped library code.
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        'scripts/**',
        '**/dist/**',
      ],
      thresholds: { statements: 33, branches: 65, functions: 46, lines: 33 },
    },
  },
});