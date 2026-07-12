// ESLint flat config (#222) — TypeScript-aware linting for packages/* and
// app/, wired into `npm run lint` alongside the existing `tsc --noEmit`
// checks. CI runs it with `--max-warnings 0`, so any rule left at "warn"
// (e.g. @typescript-eslint/no-explicit-any) still fails the build — that's
// deliberate, it's how "no unused imports / no any" gets enforced without
// hand-bumping every rule to "error".
//
// Out of scope (see issue): site/ (Astro, already gated by `astro check` +
// strict tsconfig) and worker/ (already has noUnusedLocals/noUnusedParameters
// and its own typecheck+test verify step) — both are standalone packages,
// not npm workspaces, and aren't touched here.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      'app/release/**',
      'app/test-results/**',
      'app/.build-cache/**',
      'app/renderer/*.golden.json',
      // Verbatim-ported inline boot script (#303, see src/App.tsx) — was never
      // linted before either (it lived inline in index.html, which ESLint
      // doesn't parse); moving it to a .js file for the Vite build shouldn't
      // retroactively lint content nothing here changed.
      'app/renderer/src/inline-app.js',
      'site/**',
      'worker/**',
      'backlog/**',
      'docs/**',
      'scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Codebase-wide convention (already respected by tsc's noUnusedParameters,
    // which ignores `_`-prefixed names by default — see app/electron/preload.ts,
    // main.ts, ipc.ts): an intentionally-unused binding is prefixed `_`.
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // packages/* and app/electron + app/tests are real ES modules, built (or
    // type-checked) by tsc against a Node target — see tsconfig.base.json /
    // app/tsconfig.json.
    files: ['packages/*/**/*.ts', 'app/electron/**/*.ts', 'app/tests/**/*.ts'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    // Standalone Node scripts (e.g. the audio-engine wall-clock/memory
    // benchmark harness, the renderer dev-server orchestrator) run directly
    // via `node foo.mjs`, outside tsc.
    files: ['packages/*/scripts/**/*.mjs', 'app/scripts/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    // Renderer helpers are colocated .ts (types) test files exercised by
    // Vitest but never compiled by tsc directly (app/tsconfig.json only
    // includes electron/**/*) — same module semantics as above.
    files: ['app/renderer/**/*.ts'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    // Renderer runtime helpers (grading.js, onboarding-state.js, ...) are
    // loaded two ways: as classic non-module <script> tags in
    // app/renderer/index.html (attaching to `window.*`), and via
    // `require()` from Vitest/Node tests (UMD-style `module.exports` guard).
    // Neither ships bundled, so they stay plain scripts, not modules.
    files: ['app/renderer/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    // electron-builder's afterPack hook runs standalone under Node during
    // packaging (see app/build/afterPack.js) — plain CommonJS, so `require()`
    // is the correct import form (not a lint violation to fix), and its own
    // `const crypto = require('crypto')` intentionally shadows the newer
    // WebCrypto global Node exposes at the same name.
    files: ['app/build/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-redeclare': 'off',
    },
  },
  {
    // Test files reasonably use non-null assertions / relaxed patterns that
    // would be noisy to police as hard as production source. Several
    // (renderer + parser-drift specs) also `require()` the plain
    // classic-script helpers under test (module.exports, no ES export) —
    // that's the documented pattern (see each file's header comment), not an
    // oversight.
    files: ['**/*.test.ts', '**/*.test.js', 'app/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // Playwright e2e specs poke the untyped `window.soundBuddy` preload
    // bridge from inside `page.evaluate()`, where TS has no visibility into
    // the injected global — `any` is the standard escape hatch there.
    files: ['app/tests/**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  }
);
