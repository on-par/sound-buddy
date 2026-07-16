import { defineConfig } from 'vitest/config';

// Pure math only (no DOM/AudioContext) — the default Node environment is
// enough, matching the worker/ standalone-package vitest pattern.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
