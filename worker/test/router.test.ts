import { describe, expect, it } from "vitest";
import worker, { type Env } from "../src/index";

// Minimal stub Env — the scaffold's routes don't touch any binding yet, so a
// cast is enough. Later stories that read KV/vars will build a richer fixture.
const env = {
  LICENSE_KV: {} as KVNamespace,
  FOUNDING_CAP: "300",
  FROM_EMAIL: "hello@example.test",
  APP_ORIGIN: "https://example.test",
  STRIPE_WEBHOOK_SECRET: "whsec_test_dummy",
  STRIPE_SECRET_KEY: "sk_test_dummy",
  LICENSE_SIGNING_PRIVATE_KEY: "",
  LICENSE_SIGNING_KID: "test-kid",
} satisfies Env;

// Cloudflare passes an ExecutionContext; the scaffold never uses it.
const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const call = (method: string, path: string): Promise<Response> =>
  worker.fetch(new Request(`https://sound-buddy-api.test${path}`, { method }), env, ctx);

describe("worker router", () => {
  it("health endpoint responds 200", async () => {
    const res = await call("GET", "/api/stripe/health");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("unknown routes 404", async () => {
    const res = await call("GET", "/nope");
    expect(res.status).toBe(404);
  });

  it("GET /activate (no session_id) is reachable and returns HTML", async () => {
    // /api/stripe/webhook (#108), /api/license and /activate (#112) are now
    // implemented; their behaviour is covered in webhook.test.ts,
    // license.test.ts and activate.test.ts respectively. This is just a smoke
    // check that the route is wired.
    const res = await call("GET", "/activate");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("wrong method on a known path is 405 with an Allow header", async () => {
    const res = await call("GET", "/api/stripe/webhook");
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("never leaks secret env names in a response body", async () => {
    const res = await call("GET", "/api/stripe/health");
    const body = await res.text();
    for (const secret of [
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "LICENSE_SIGNING_PRIVATE_KEY",
      "RESEND_API_KEY",
    ]) {
      expect(body).not.toContain(secret);
    }
  });
});
