import { defineConfig } from 'vitest/config';

// Unit tests are colocated with the code they cover: main-process logic under
// electron/, pure renderer helpers under renderer/. The Playwright e2e specs
// under tests/ are driven by `npm run test:e2e`, not Vitest — keep them out.
// Renderer tests are .test.ts by convention; grading.test.js (#130) is .js, so
// the renderer glob covers both extensions.
export default defineConfig({
  test: {
    // Unit tests are colocated with the code they cover: main-process logic under
    // electron/, pure renderer helpers under renderer/. The Playwright e2e specs
    // under tests/ are driven by `npm run test:e2e`, not Vitest — keep them out.
    // Renderer tests are .test.ts by convention; grading.test.js (#130) is .js, so
    // the renderer glob covers both extensions.
    include: ['electron/**/*.test.ts', 'renderer/**/*.test.{ts,js}'],
    coverage: {
      provider: 'v8',
      // Only instrument real source. Everything else under app/ — the Python
      // runtime + emscripten bundles under .build-cache/ and release/, the
      // electron-builder staging under app/, dist/, build scripts, configs,
      // assets — is vendored/generated and must NOT count toward coverage.
      include: ['electron/**/*.ts', 'renderer/**/*.{ts,js}'],
      exclude: [
        'electron/**/*.test.ts',
        'renderer/**/*.test.{ts,js}',
        '**/*.config.{ts,js,mjs}',
        '**/dist/**',
        'build/**',
        '.build-cache/**',
        'release/**',
        'app/**',
        'assets/**',
        'coverage/**',
        'test-results/**',
      ],
      thresholds: { statements: 62, branches: 82, functions: 80, lines: 62 },
    },
  },
});
