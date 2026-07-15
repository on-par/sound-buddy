import { defineConfig } from 'vitest/config';

// Pure, dependency-free policy code — fully testable, so thresholds sit at
// (near) 100%. See constitution "Coverage — Ratchet, Never Regress".
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', '**/dist/**', '**/dist-cjs/**', '**/*.config.{ts,js,mjs}'],
      thresholds: { statements: 100, branches: 95, functions: 100, lines: 100 },
    },
  },
});
