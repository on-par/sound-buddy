import { defineConfig } from 'vitest/config';

// Pure math only (no DOM/AudioContext) — the default Node environment is
// enough, matching the worker/ standalone-package vitest pattern. Colocated
// build-script tests (scripts/**/*.test.mjs) run alongside src tests so
// scripts/lib/*.mjs modules get the same TDD/coverage treatment (#555).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
  },
});
