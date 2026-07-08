import { defineConfig } from "vitest/config";

// Routing/unit tests call the Worker's fetch handler directly with a stub Env,
// so the default Node environment (global Request/Response/URL) is enough — no
// Miniflare/worker pool needed for the scaffold. Later stories that exercise KV
// or Web Crypto can add @cloudflare/vitest-pool-workers if they need it.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
