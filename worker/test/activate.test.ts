import { describe, expect, it } from "vitest";
import { handleActivate } from "../src/handlers/activate";
import type { Env } from "../src/index";

const env = {
  LICENSE_KV: {} as KVNamespace,
  FOUNDING_CAP: "300",
  FROM_EMAIL: "hello@example.test",
  SUPPORT_EMAIL: "support@example.test",
  CUSTOMER_PORTAL_URL: "https://portal.example.test",
  APP_ORIGIN: "https://example.test",
  STRIPE_WEBHOOK_SECRET: "whsec_test_dummy",
  STRIPE_SECRET_KEY: "sk_test_dummy",
  LICENSE_SIGNING_PRIVATE_KEY: "",
  RESEND_API_KEY: "re_test_unused",
  LICENSE_SIGNING_KID: "test-kid",
  LICENSE_PUBLIC_KEY: "",
} satisfies Env;

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const request = (query = ""): Request =>
  new Request(`https://sound-buddy-api.test/activate${query}`);

/** No external assets of any kind — the page must be fully self-contained. */
function assertNoExternalAssets(body: string): void {
  expect(body).not.toMatch(/\bsrc="http/i);
  expect(body).not.toMatch(/\bhref="http/i);
  expect(body).not.toMatch(/@import/i);
  expect(body).not.toMatch(/<link\b/i);
  expect(body).not.toMatch(/<script\s+src/i);
}

describe("GET /activate (#112)", () => {
  it("Scenario: no session_id renders the email fallback", async () => {
    const res = await handleActivate(request(), env, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("Check your email");
    assertNoExternalAssets(body);
  });

  it("Scenario: with session_id renders a self-contained page with no external assets", async () => {
    const res = await handleActivate(request("?session_id=cs_test_123"), env, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const body = await res.text();
    assertNoExternalAssets(body);
    expect(body).toContain("cs_test_123");
  });

  it("Scenario: a crafted session_id is HTML-escaped, not injected raw", async () => {
    const malicious = '"><script>alert(1)</script>';
    const res = await handleActivate(
      request(`?session_id=${encodeURIComponent(malicious)}`),
      env,
      ctx,
    );

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain(malicious);
    expect(body).not.toContain('"><script>alert(1)</script>');
    // The escaped form is present instead.
    expect(body).toContain("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
