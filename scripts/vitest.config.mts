import { defineConfig } from 'vitest/config';

// scripts/ has no package.json (it's not an npm workspace) and is excluded
// from eslint.config.mjs's TypeScript-aware linting by design — its .mjs
// files run directly via `node`, outside tsc. Before #1503 it also had no
// vitest project, so new runtime code here (scripts/factory/*.mjs) would be
// silently untested. This project entry gives it a real, colocated test run
// under `npm test` without pulling it into either lint config.
export default defineConfig({
  test: {
    include: ['factory/**/*.test.mjs'],
    exclude: ['**/node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['factory/**/*.mjs'],
      exclude: ['factory/**/*.test.mjs'],
    },
  },
});
