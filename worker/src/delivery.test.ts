import { describe, expect, it, vi } from "vitest";
import { sendDunningEmail, sendLicenseEmail } from "./delivery";
import type { Env } from "./index";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    LICENSE_KV: {} as KVNamespace,
    EVENTS_KV: {} as KVNamespace,
    FOUNDING_CAP: "300",
    FROM_EMAIL: "hello@example.test",
    SUPPORT_EMAIL: "support@example.test",
    CUSTOMER_PORTAL_URL: "https://portal.example.test",
    APP_ORIGIN: "https://example.test",
    STRIPE_WEBHOOK_SECRET: "whsec_unused",
    STRIPE_SECRET_KEY: "sk_test_unused",
    LICENSE_SIGNING_PRIVATE_KEY: "",
    RESEND_API_KEY: "re_test_unused",
    LICENSE_SIGNING_KID: "test-kid",
    LICENSE_PUBLIC_KEY: "",
    ...overrides,
  } satisfies Env;
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>): {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
} {
  const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
  const init = calls[0][1];
  return JSON.parse(init.body as string) as {
    from: string;
    to: string[];
    subject: string;
    text: string;
    html: string;
  };
}

describe("license email delivery (#114)", () => {
  it("Scenario: sends via Resend with the right shape", async () => {
    const env = makeEnv();
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    const key = "SB1.test.payload";

    const result = await sendLicenseEmail(
      env,
      {
        to: "buyer@example.test",
        key,
        kind: "subscription",
        expiresAt: "2027-01-01T00:00:00.000Z",
      },
      { fetch: fetchMock as unknown as typeof fetch },
    );

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe("https://api.resend.com/emails");

    const init = calls[0][1];
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    });

    const body = requestBody(fetchMock);
    expect(body.from).toBe(env.FROM_EMAIL);
    expect(body.to).toContain("buyer@example.test");
    expect(body.subject).toBe("Your Sound Buddy license key");
    for (const content of [body.text, body.html]) {
      expect(content).toContain(key);
      expect(content).toContain("Open Sound Buddy, go to Activate, and paste this key.");
      expect(content).toContain(env.CUSTOMER_PORTAL_URL);
      expect(content).toContain(env.SUPPORT_EMAIL);
    }
  });

  it("Scenario: subscription vs lifetime copy differ", async () => {
    const env = makeEnv();
    const subscriptionFetch = vi.fn(async () => ({ ok: true, status: 200 }));
    const lifetimeFetch = vi.fn(async () => ({ ok: true, status: 200 }));

    await sendLicenseEmail(
      env,
      {
        to: "buyer@example.test",
        key: "SB1.subscription.key",
        kind: "subscription",
        expiresAt: "2027-02-03T04:05:06.000Z",
      },
      { fetch: subscriptionFetch as unknown as typeof fetch },
    );
    await sendLicenseEmail(
      env,
      { to: "buyer@example.test", key: "SB1.lifetime.key", kind: "lifetime" },
      { fetch: lifetimeFetch as unknown as typeof fetch },
    );

    const subscriptionBody = requestBody(subscriptionFetch);
    const lifetimeBody = requestBody(lifetimeFetch);
    expect(subscriptionBody.text).toContain("renews automatically");
    expect(subscriptionBody.text).toContain("valid through 2027-02-03");
    expect(subscriptionBody.text).toContain("fresh key is emailed each renewal");
    expect(lifetimeBody.text).toContain("lifetime license");
    expect(lifetimeBody.text).not.toContain("valid through");
  });

  it("Scenario: subscription with no expiresAt omits 'valid through' from the copy", async () => {
    const env = makeEnv();
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));

    await sendLicenseEmail(
      env,
      { to: "buyer@example.test", key: "SB1.no.expiry", kind: "subscription" },
      { fetch: fetchMock as unknown as typeof fetch },
    );

    const body = requestBody(fetchMock);
    expect(body.text).toContain("renews automatically");
    expect(body.text).not.toContain("valid through");
    expect(body.html).not.toContain("valid through");
  });

  it("Scenario: Resend error is non-fatal", async () => {
    const env = makeEnv();
    const failingStatus = vi.fn(async () => ({ ok: false, status: 500 }));
    const throwingFetch = vi.fn(async () => {
      throw new Error("network down");
    });

    await expect(
      sendLicenseEmail(
        env,
        { to: "buyer@example.test", key: "SB1.status.key", kind: "lifetime" },
        { fetch: failingStatus as unknown as typeof fetch },
      ),
    ).resolves.toEqual({ ok: false });
    await expect(
      sendLicenseEmail(
        env,
        { to: "buyer@example.test", key: "SB1.throw.key", kind: "lifetime" },
        { fetch: throwingFetch as unknown as typeof fetch },
      ),
    ).resolves.toEqual({ ok: false });
  });

  it("Scenario: no recipient is skipped", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));

    await expect(
      sendLicenseEmail(
        makeEnv(),
        { to: undefined, key: "SB1.no.recipient", kind: "lifetime" },
        { fetch: fetchMock as unknown as typeof fetch },
      ),
    ).resolves.toEqual({ ok: false });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Scenario: missing RESEND_API_KEY is skipped", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));

    await expect(
      sendLicenseEmail(
        makeEnv({ RESEND_API_KEY: "" }),
        { to: "buyer@example.test", key: "SB1.no.secret", kind: "lifetime" },
        { fetch: fetchMock as unknown as typeof fetch },
      ),
    ).resolves.toEqual({ ok: false });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("dunning email delivery (#118)", () => {

  it("Scenario: sends via Resend with the right shape", async () => {
    const env = makeEnv();
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));

    const result = await sendDunningEmail(
      env,
      { to: "a@b.c" },
      { fetch: fetchMock as unknown as typeof fetch },
    );

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe("https://api.resend.com/emails");

    const body = requestBody(fetchMock);
    expect(body.from).toBe(env.FROM_EMAIL);
    expect(body.to).toEqual(["a@b.c"]);
    expect(body.subject).toBe("Your Sound Buddy payment didn't go through");
    expect(body.text).toContain(env.CUSTOMER_PORTAL_URL);
    expect(body.html).toContain(env.CUSTOMER_PORTAL_URL);
  });

  it("Scenario: no recipient is skipped", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));

    await expect(
      sendDunningEmail(
        makeEnv(),
        { to: undefined },
        { fetch: fetchMock as unknown as typeof fetch },
      ),
    ).resolves.toEqual({ ok: false });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Scenario: missing RESEND_API_KEY is skipped", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));

    await expect(
      sendDunningEmail(
        makeEnv({ RESEND_API_KEY: "" }),
        { to: "a@b.c" },
        { fetch: fetchMock as unknown as typeof fetch },
      ),
    ).resolves.toEqual({ ok: false });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Scenario: Resend error status is non-fatal", async () => {
    const failingStatus = vi.fn(async () => ({ ok: false, status: 500 }));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      sendDunningEmail(
        makeEnv(),
        { to: "a@b.c" },
        { fetch: failingStatus as unknown as typeof fetch },
      ),
    ).resolves.toEqual({ ok: false });
    expect(consoleErrorSpy).toHaveBeenCalledWith("dunning email send failed", { status: 500 });

    consoleErrorSpy.mockRestore();
  });

  it("Scenario: a thrown fetch is non-fatal", async () => {
    const throwingFetch = vi.fn(async () => {
      throw new Error("network down");
    });

    await expect(
      sendDunningEmail(
        makeEnv(),
        { to: "a@b.c" },
        { fetch: throwingFetch as unknown as typeof fetch },
      ),
    ).resolves.toEqual({ ok: false });
  });
});
