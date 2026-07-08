import { defineConfig } from 'vitest/config';

// Unit tests are colocated with the code they cover: main-process logic under
// electron/, pure renderer helpers under renderer/. The Playwright e2e specs
// under tests/ are driven by `npm run test:e2e`, not Vitest — keep them out.
// Renderer tests are .test.ts by convention; grading.test.js (#130) is .js, so
// the renderer glob covers both extensions.
export default defineConfig({
  test: {
    include: ['electron/**/*.test.ts', 'renderer/**/*.test.{ts,js}'],
  },
});
