#!/usr/bin/env node
// Sandbox e2e runner (#121) — manual/local launch gate only, never invoked by
// CI. Run via `npm run test:e2e:sandbox`, which loads `.env.local` into
// process.env via `node --env-file` BEFORE this script starts. This script
// never reads `.env.local` itself and never echoes any of its values — it
// only checks that WORKER_BASE_URL is reachable, then hands off to vitest.

import { spawnSync } from "node:child_process";

const workerBaseUrl = process.env.WORKER_BASE_URL;

if (!workerBaseUrl) {
  console.error(
    "test:e2e:sandbox: WORKER_BASE_URL is not set (see .env.local) — aborting",
  );
  process.exit(1);
}

const healthUrl = new URL("/api/stripe/health", workerBaseUrl).toString();
console.log(`test:e2e:sandbox: checking Worker health at ${healthUrl}`);

let res;
try {
  res = await fetch(healthUrl);
} catch {
  console.error(
    `test:e2e:sandbox: Worker unreachable at ${workerBaseUrl} — is it running? (wrangler dev, or a preview deploy)`,
  );
  process.exit(1);
}

if (!res.ok) {
  console.error(
    `test:e2e:sandbox: Worker health check failed (HTTP ${res.status}) at ${workerBaseUrl}`,
  );
  process.exit(1);
}

console.log("test:e2e:sandbox: Worker is reachable — running the sandbox suite");

const result = spawnSync(
  process.execPath,
  ["node_modules/.bin/vitest", "run", "test/e2e/sandbox.e2e.test.ts"],
  { stdio: "inherit", env: process.env },
);

process.exit(result.status ?? 1);
