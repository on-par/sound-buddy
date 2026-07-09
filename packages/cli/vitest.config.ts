import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**', '**/dist/**'],
      // functions floor is CI-calibrated: CI measures ~84.6% (a couple functions
      // only run on darwin), vs ~91.7% locally on macOS. Keep it below CI reality
      // so it's a ratchet, not a constant false alarm.
      thresholds: { statements: 75, branches: 65, functions: 82, lines: 75 },
    },
  },
});