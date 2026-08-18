import { describe, expect, it, vi } from "vitest";
import { buildFeedbackIssue, createFeedbackIssue } from "./github-issues";
import type { FeedbackEvent } from "./handlers/ingest";
import type { Env } from "./index";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    LICENSE_KV: {} as KVNamespace,
    EVENTS_KV: {} as KVNamespace,
    WAITLIST_KV: {} as KVNamespace,
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
    GITHUB_ISSUES_TOKEN: "",
    ...overrides,
  } satisfies Env;
}

const RECEIVED_AT = "2026-08-18T12:00:00.000Z";

const fullEvent: FeedbackEvent = {
  type: "feedback",
  appVersion: "1.2.3",
  osVersion: "14.5",
  message: "the EQ suggestion panel is great, thanks",
  category: "bug",
  platform: "darwin-arm64",
  contactEmail: "pat@example.test",
};

const minimalEvent: FeedbackEvent = {
  type: "feedback",
  appVersion: "1.2.3",
  message: "seems to be missing a way to export the report",
};

describe("buildFeedbackIssue", () => {
  it("builds title, assignees, labels, and a body carrying the metadata for a full event", () => {
    const issue = buildFeedbackIssue(fullEvent, RECEIVED_AT);

    expect(issue.title).toBe(`Feedback (bug): ${fullEvent.message}`);
    expect(issue.assignees).toEqual(["patrob"]);
    expect(issue.labels).toEqual(["epic:feedback"]);
    expect(issue.body).toContain(fullEvent.message);
    expect(issue.body).toContain("1.2.3");
    expect(issue.body).toContain("14.5");
    expect(issue.body).toContain("darwin-arm64");
    expect(issue.body).toContain(RECEIVED_AT);
    expect(issue.body).toContain("Reply address: provided");
  });

  it("never writes the contactEmail string into the body (on-par/sound-buddy is public)", () => {
    const issue = buildFeedbackIssue(fullEvent, RECEIVED_AT);

    expect(issue.body).not.toContain("pat@example.test");
  });

  it("a minimal event (no category/osVersion/platform/contactEmail) titles as 'other', omits absent bullets, and says not provided", () => {
    const issue = buildFeedbackIssue(minimalEvent, RECEIVED_AT);

    expect(issue.title).toBe(`Feedback (other): ${minimalEvent.message}`);
    expect(issue.body).not.toContain("macOS version:");
    expect(issue.body).not.toContain("Platform:");
    expect(issue.body).toContain("Reply address: not provided");
  });

  it("collapses newlines/whitespace and truncates a long message to at most 80 chars ending in an ellipsis", () => {
    const longMessage = `${"word ".repeat(30)}\nmore\ntext here to push past eighty characters total length`;
    const issue = buildFeedbackIssue({ ...minimalEvent, message: longMessage }, RECEIVED_AT);

    const titleText = issue.title.replace(/^Feedback \(other\): /, "");
    expect(titleText.length).toBeLessThanOrEqual(80);
    expect(titleText.endsWith("…")).toBe(true);
    expect(titleText).not.toContain("\n");
  });
});

describe("createFeedbackIssue", () => {
  it("success: POSTs to the GitHub issues API and returns { ok: true, issueNumber }", async () => {
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ number: 42 }), { status: 201 }),
    );
    const env = makeEnv({ GITHUB_ISSUES_TOKEN: "ghp_test_token" });

    const result = await createFeedbackIssue(
      env,
      { event: minimalEvent, receivedAt: RECEIVED_AT },
      { fetch: fetchSpy as unknown as typeof fetch },
    );

    expect(result).toEqual({ ok: true, issueNumber: 42 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/on-par/sound-buddy/issues");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ghp_test_token");
    expect(headers["User-Agent"]).toBeTruthy();
    const body = JSON.parse(init.body as string) as { assignees: string[] };
    expect(body.assignees).toEqual(["patrob"]);
  });

  it("empty GITHUB_ISSUES_TOKEN returns { ok: false } and never calls fetch", async () => {
    const fetchSpy = vi.fn();
    const env = makeEnv({ GITHUB_ISSUES_TOKEN: "" });

    const result = await createFeedbackIssue(
      env,
      { event: minimalEvent, receivedAt: RECEIVED_AT },
      { fetch: fetchSpy as unknown as typeof fetch },
    );

    expect(result).toEqual({ ok: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a 401 response returns { ok: false }", async () => {
    const fetchSpy = vi.fn(async () => new Response("", { status: 401 }));
    const env = makeEnv({ GITHUB_ISSUES_TOKEN: "ghp_test_token" });

    const result = await createFeedbackIssue(
      env,
      { event: minimalEvent, receivedAt: RECEIVED_AT },
      { fetch: fetchSpy as unknown as typeof fetch },
    );

    expect(result).toEqual({ ok: false });
  });

  it("a rejecting fetch (timeout/abort) returns { ok: false } and does not throw", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("aborted");
    });
    const env = makeEnv({ GITHUB_ISSUES_TOKEN: "ghp_test_token" });

    const result = await createFeedbackIssue(
      env,
      { event: minimalEvent, receivedAt: RECEIVED_AT },
      { fetch: fetchSpy as unknown as typeof fetch },
    );

    expect(result).toEqual({ ok: false });
  });

  it("a 201 response with a non-JSON body returns { ok: false } (caught path)", async () => {
    const fetchSpy = vi.fn(async () => new Response("not json", { status: 201 }));
    const env = makeEnv({ GITHUB_ISSUES_TOKEN: "ghp_test_token" });

    const result = await createFeedbackIssue(
      env,
      { event: minimalEvent, receivedAt: RECEIVED_AT },
      { fetch: fetchSpy as unknown as typeof fetch },
    );

    expect(result).toEqual({ ok: false });
  });

  it("never logs the feedback message text on the success path", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ number: 1 }), { status: 201 }),
    );
    const env = makeEnv({ GITHUB_ISSUES_TOKEN: "ghp_test_token" });

    await createFeedbackIssue(
      env,
      { event: fullEvent, receivedAt: RECEIVED_AT },
      { fetch: fetchSpy as unknown as typeof fetch },
    );

    const allLoggedArgs = [...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls]
      .flat()
      .map((arg) => JSON.stringify(arg));
    expect(allLoggedArgs.some((s) => s.includes(fullEvent.message))).toBe(false);

    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("never logs the feedback message text on the failure path", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi.fn(async () => new Response("", { status: 500 }));
    const env = makeEnv({ GITHUB_ISSUES_TOKEN: "ghp_test_token" });

    await createFeedbackIssue(
      env,
      { event: fullEvent, receivedAt: RECEIVED_AT },
      { fetch: fetchSpy as unknown as typeof fetch },
    );

    const allLoggedArgs = consoleErrorSpy.mock.calls.flat().map((arg) => JSON.stringify(arg));
    expect(allLoggedArgs.some((s) => s.includes(fullEvent.message))).toBe(false);

    consoleErrorSpy.mockRestore();
  });
});
