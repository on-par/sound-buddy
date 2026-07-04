import { defineConfig } from 'vitest/config';

// Unit tests are colocated under electron/. The Playwright e2e specs under
// tests/ are driven by `npm run test:e2e`, not Vitest — keep them out of here.
export default defineConfig({
  test: {
    include: ['electron/**/*.test.ts'],
  },
});
