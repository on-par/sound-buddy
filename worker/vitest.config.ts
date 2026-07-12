import { defineConfig } from "vitest/config";

// Routing/unit tests call the Worker's fetch handler directly with a stub Env,
// so the default Node environment (global Request/Response/URL) is enough — no
// Miniflare/worker pool needed for the scaffold. Later stories that exercise KV
// or Web Crypto can add @cloudflare/vitest-pool-workers if they need it.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/e2e/**", "**/dist/**", "**/*.config.{ts,js,mjs}"],
      // Ratchet floors set a few points below the current baseline so this
      // gates real regressions without being a constant false alarm. Raise
      // them as coverage grows. Recalibrated for Vitest 4's more accurate v8
      // coverage remapping (#224): the baseline now measures
      // ~92.5/77.8/91.2/94.3 statements/branches/functions/lines (vs
      // ~94/79/93/94 under vitest 2) even though nothing here changed
      // behaviorally.
      thresholds: { statements: 89, branches: 74, functions: 88, lines: 91 },
    },
  },
});
