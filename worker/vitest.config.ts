import { defineConfig } from "vitest/config";

// Routing/unit tests call the Worker's fetch handler directly with a stub Env,
// so the default Node environment (global Request/Response/URL) is enough — no
// Miniflare/worker pool needed for the scaffold. Later stories that exercise KV
// or Web Crypto can add @cloudflare/vitest-pool-workers if they need it.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["test/**", "**/dist/**", "**/*.config.{ts,js,mjs}"],
      // Ratchet floors set a few points below the current baseline (~94/79/93/94
      // statements/branches/functions/lines) so this gates real regressions
      // without being a constant false alarm. Raise them as coverage grows.
      thresholds: { statements: 90, branches: 75, functions: 90, lines: 90 },
    },
  },
});
