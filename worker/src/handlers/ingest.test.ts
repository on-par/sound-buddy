import { describe, expect, it, vi } from "vitest";
import {
  handleIngestEvent,
  redactIngestEvent,
  redactText,
  validateIngestEvent,
  type IngestDeps,
  type IngestEvent,
  type StoredIngestEvent,
} from "./ingest";
import type { Env } from "../index";

/** In-memory KV double backed by a Map, with spy-able `get`/`put` (`put`
 * captures its options argument so TTL is assertable). */
function makeKv(): {
  kv: KVNamespace;
  store: Map<string, string>;
  getSpy: ReturnType<typeof vi.fn>;
  putSpy: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, string>();
  const getSpy = vi.fn(async (key: string) => (store.has(key) ? store.get(key)! : null));
  const putSpy = vi.fn(async (key: string, value: string, options?: { expirationTtl?: number }) => {
    store.set(key, value);
    return options;
  });
  const kv = { get: getSpy, put: putSpy } as unknown as KVNamespace;
  return { kv, store, getSpy, putSpy };
}

function makeEnv(kv: KVNamespace): Env {
  return {
    LICENSE_KV: {} as KVNamespace,
    EVENTS_KV: kv,
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
  } satisfies Env;
}

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const NOW = new Date("2026-07-16T12:00:00.000Z");
const FIXED_ID = "fixed-id-123";
const deps: IngestDeps = { now: () => NOW, randomId: () => FIXED_ID };

const request = (body: unknown, ip = "1.2.3.4"): Request =>
  new Request("https://sound-buddy-api.test/api/ingest", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "CF-Connecting-IP": ip },
  });

const rawRequest = (rawBody: string, ip = "1.2.3.4"): Request =>
  new Request("https://sound-buddy-api.test/api/ingest", {
    method: "POST",
    body: rawBody,
    headers: { "CF-Connecting-IP": ip },
  });

const validFeedback = { type: "feedback", appVersion: "1.2.3", message: "it works great" };
const validCrash = {
  type: "crash",
  appVersion: "1.2.3",
  message: "boom",
  stack: "Error: boom\n  at x",
  processType: "renderer",
};
const validTelemetry = {
  type: "telemetry",
  appVersion: "1.2.3",
  name: "app_opened",
  platform: "darwin-arm64",
  installId: "11111111-1111-1111-1111-111111111111",
  sessionId: "22222222-2222-2222-2222-222222222222",
  occurredAt: "2026-07-16T12:00:00Z",
  value: 42,
  props: { channel: "stable", ok: true, count: 3 },
};

describe("POST /api/ingest (#475)", () => {
  describe("body parsing", () => {
    it("non-JSON body → 400 invalid_json, KV untouched", async () => {
      const { kv, putSpy } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(rawRequest("not json"), env, ctx, deps);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_json" });
      expect(putSpy).not.toHaveBeenCalled();
    });

    it("body over 32 KB → 413 payload_too_large, KV untouched", async () => {
      const { kv, putSpy } = makeKv();
      const env = makeEnv(kv);
      const big = "x".repeat(32 * 1024 + 1);

      const res = await handleIngestEvent(rawRequest(big), env, ctx, deps);

      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: "payload_too_large" });
      expect(putSpy).not.toHaveBeenCalled();
    });
  });

  describe("event type", () => {
    it("unknown type → 400 unknown_event_type", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ type: "nope", appVersion: "1.0.0" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "unknown_event_type" });
    });

    it("missing type → 400 unknown_event_type", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(request({ appVersion: "1.0.0" }), env, ctx, deps);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "unknown_event_type" });
    });

    it.each([["a string"], [null], [[]]])("non-object body %j → 400 invalid_event", async (body) => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(request(body), env, ctx, deps);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_event" });
    });
  });

  describe("appVersion", () => {
    it("missing appVersion → 400 invalid_field appVersion", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ type: "feedback", message: "hi" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "appVersion" });
    });

    it("empty appVersion → 400 invalid_field appVersion", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validFeedback, appVersion: "" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "appVersion" });
    });

    it("oversize appVersion → 400 invalid_field appVersion", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validFeedback, appVersion: "x".repeat(33) }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "appVersion" });
    });

    it("whitespace in appVersion → 400 invalid_field appVersion", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validFeedback, appVersion: "1.2 3" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "appVersion" });
    });

    it("oversize osVersion → 400 invalid_field osVersion", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validFeedback, osVersion: "x".repeat(33) }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "osVersion" });
    });

    it("valid osVersion accepted", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validFeedback, osVersion: "14.5" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(202);
    });
  });

  describe("unknown fields", () => {
    it("unknown field on feedback → 400 unknown_field", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validFeedback, extra: 1 }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "unknown_field", field: "extra" });
    });
  });

  describe("sensitive fields (deny list runs before unknown-field check)", () => {
    it("email on feedback → 400 sensitive_field email", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validFeedback, email: "pat@example.test" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "sensitive_field", field: "email" });
    });

    it("licenseKey on crash → 400 sensitive_field licenseKey", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validCrash, licenseKey: "SB1.abc.def" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "sensitive_field", field: "licenseKey" });
    });

    it("userId inside telemetry props → 400 sensitive_field userId", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validTelemetry, props: { userId: "abc123" } }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "sensitive_field", field: "userId" });
    });
  });

  describe("feedback message", () => {
    it("missing message → 400 invalid_field message", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ type: "feedback", appVersion: "1.0.0" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "message" });
    });

    it("empty message → 400 invalid_field message", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validFeedback, message: "" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "message" });
    });

    it("message over 4000 chars → 400 invalid_field message", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validFeedback, message: "x".repeat(4001) }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "message" });
    });
  });

  describe("feedback category/contactEmail/platform (#472)", () => {
    it("accepts a feedback event with category, contactEmail, and platform and stores them", async () => {
      const { kv, store, putSpy } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({
          ...validFeedback,
          category: "bug",
          contactEmail: "pat@example.test",
          platform: "darwin-arm64",
        }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(202);
      const ingestPutCall = putSpy.mock.calls.find((call) =>
        String(call[0]).startsWith("ingest:"),
      );
      const stored = JSON.parse(store.get(ingestPutCall![0] as string)!) as StoredIngestEvent;
      expect(stored.event).toEqual({
        ...validFeedback,
        category: "bug",
        contactEmail: "pat@example.test",
        platform: "darwin-arm64",
      });
    });

    it("bare {type, appVersion, message} feedback events are still accepted (back-compat)", async () => {
      const { kv, store, putSpy } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(request(validFeedback), env, ctx, deps);

      expect(res.status).toBe(202);
      const ingestPutCall = putSpy.mock.calls.find((call) =>
        String(call[0]).startsWith("ingest:"),
      );
      const stored = JSON.parse(store.get(ingestPutCall![0] as string)!) as StoredIngestEvent;
      expect(Object.keys(stored.event).sort()).toEqual(["appVersion", "message", "type"].sort());
    });

    it("category outside the allowed set → 400 invalid_field category", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validFeedback, category: "rant" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "category" });
    });

    it("malformed contactEmail → 400 invalid_field contactEmail", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validFeedback, contactEmail: "not-an-email" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "contactEmail" });
    });

    it("overlong contactEmail → 400 invalid_field contactEmail", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);
      const overlong = `${"a".repeat(250)}@x.com`; // > 254 chars

      const res = await handleIngestEvent(
        request({ ...validFeedback, contactEmail: overlong }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "contactEmail" });
    });

    it("whitespace-containing platform → 400 invalid_field platform", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validFeedback, platform: "darwin arm64" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "platform" });
    });

    it("contactEmail survives storage un-redacted while an email inside message is redacted", async () => {
      const { kv, store, putSpy } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({
          type: "feedback",
          appVersion: "1.0.0",
          message: "reach me at other@example.test if needed",
          contactEmail: "pat@example.test",
        }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(202);
      const ingestPutCall = putSpy.mock.calls.find((call) =>
        String(call[0]).startsWith("ingest:"),
      );
      const stored = JSON.parse(store.get(ingestPutCall![0] as string)!) as StoredIngestEvent;
      const event = stored.event as { message: string; contactEmail: string };
      expect(event.message).toBe("reach me at [redacted-email] if needed");
      expect(event.contactEmail).toBe("pat@example.test");
    });

    it("email/userEmail top-level keys are still rejected as sensitive_field alongside category/contactEmail", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validFeedback, category: "bug", email: "pat@example.test" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "sensitive_field", field: "email" });
    });
  });

  describe("crash fields", () => {
    it("stack over 8000 chars → 400 invalid_field stack", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validCrash, stack: "x".repeat(8001) }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "stack" });
    });

    it("invalid processType → 400 invalid_field processType", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validCrash, processType: "gpu" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "processType" });
    });

    it("valid crash with stack accepted", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(request(validCrash), env, ctx, deps);

      expect(res.status).toBe(202);
    });

    it("valid crash with no stack accepted", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ type: "crash", appVersion: "1.2.3", message: "boom" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(202);
    });

    it("crash message over 2000 chars → 400 invalid_field message", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validCrash, message: "x".repeat(2001) }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "message" });
    });

    it("valid crash with osVersion accepted", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validCrash, osVersion: "14.5" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(202);
    });

    it("crash with platform/route/recentEvents accepted and stored verbatim", async () => {
      const { kv, store, putSpy } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({
          ...validCrash,
          platform: "darwin-arm64",
          route: "screen.live",
          recentEvents: ["app.launch", "screen.live"],
        }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(202);
      const ingestPutCall = putSpy.mock.calls.find((call) =>
        String(call[0]).startsWith("ingest:"),
      );
      const stored = JSON.parse(store.get(ingestPutCall![0] as string)!) as StoredIngestEvent;
      const event = stored.event as {
        platform: string;
        route: string;
        recentEvents: string[];
      };
      expect(event.platform).toBe("darwin-arm64");
      expect(event.route).toBe("screen.live");
      expect(event.recentEvents).toEqual(["app.launch", "screen.live"]);
    });

    it("whitespace-containing platform → 400 invalid_field platform", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validCrash, platform: "darwin arm64" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "platform" });
    });

    it("route with spaces → 400 invalid_field route", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validCrash, route: "Has Spaces" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "route" });
    });

    it("21 recentEvents → 400 invalid_field recentEvents", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validCrash, recentEvents: Array.from({ length: 21 }, () => "app.tick") }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "recentEvents" });
    });

    it("non-string entry in recentEvents → 400 invalid_field recentEvents", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validCrash, recentEvents: ["app.launch", 42] }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "recentEvents" });
    });

    it("non-array recentEvents → 400 invalid_field recentEvents", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validCrash, recentEvents: "app.launch" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "recentEvents" });
    });

    it("old minimal crash events (no platform/route/recentEvents) still accepted (back-compat)", async () => {
      const { kv, store, putSpy } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ type: "crash", appVersion: "1.2.3", message: "boom" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(202);
      const ingestPutCall = putSpy.mock.calls.find((call) =>
        String(call[0]).startsWith("ingest:"),
      );
      const stored = JSON.parse(store.get(ingestPutCall![0] as string)!) as StoredIngestEvent;
      expect(Object.keys(stored.event).sort()).toEqual(["appVersion", "message", "type"].sort());
    });
  });

  describe("telemetry fields", () => {
    it("uppercase name → 400 invalid_field name", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validTelemetry, name: "App.Launch" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "name" });
    });

    it("leading dot in name → 400 invalid_field name", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validTelemetry, name: ".launch" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "name" });
    });

    it("name over 64 chars → 400 invalid_field name", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validTelemetry, name: "a".repeat(65) }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "name" });
    });

    it("wrong-type value (string instead of number) → 400 invalid_field value", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validTelemetry, value: "1" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "value" });
    });

    it("validateIngestEvent rejects non-finite value directly (Infinity)", () => {
      const result = validateIngestEvent({ ...validTelemetry, value: Infinity });
      expect(result).toEqual({ error: "invalid_field", field: "value", status: 400, ok: false });
    });

    it("validateIngestEvent rejects non-finite value directly (NaN)", () => {
      const result = validateIngestEvent({ ...validTelemetry, value: NaN });
      expect(result).toEqual({ error: "invalid_field", field: "value", status: 400, ok: false });
    });

    it("validateIngestEvent rejects a non-object props value directly (array)", () => {
      const result = validateIngestEvent({ ...validTelemetry, props: ["not", "an", "object"] });
      expect(result).toEqual({ error: "invalid_field", field: "props", status: 400, ok: false });
    });

    it("validateIngestEvent rejects a non-finite number prop value directly", () => {
      const result = validateIngestEvent({ ...validTelemetry, props: { latency: Infinity } });
      expect(result).toEqual({ error: "invalid_field", field: "props", status: 400, ok: false });
    });

    it("props with 21 keys → 400 invalid_field props", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);
      const props: Record<string, string> = {};
      for (let i = 0; i < 21; i++) props[`k${i}`] = "v";

      const res = await handleIngestEvent(
        request({ ...validTelemetry, props }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "props" });
    });

    it("prop key with a space → 400 invalid_field props", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validTelemetry, props: { "Bad Key": "v" } }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "props" });
    });

    it("prop value over 256 chars → 400 invalid_field props", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validTelemetry, props: { long: "x".repeat(257) } }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "props" });
    });

    it("nested object prop value → 400 invalid_field props", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validTelemetry, props: { nested: { a: 1 } } }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "props" });
    });

    it("valid props (string/number/boolean mix) accepted", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(request(validTelemetry), env, ctx, deps);

      expect(res.status).toBe(202);
    });

    it("valid telemetry with osVersion and no props accepted", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({
          type: "telemetry",
          appVersion: "1.2.3",
          osVersion: "14.5",
          name: "app_opened",
          platform: "darwin-arm64",
          installId: "11111111-1111-1111-1111-111111111111",
          sessionId: "22222222-2222-2222-2222-222222222222",
          occurredAt: "2026-07-16T12:00:00Z",
        }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(202);
    });
  });

  describe("telemetry allowlist + envelope fields (#474)", () => {
    it("an approved name with platform/installId/sessionId/occurredAt → 202", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(request(validTelemetry), env, ctx, deps);

      expect(res.status).toBe(202);
    });

    it("a pattern-valid but unapproved name → 400 unknown_event_name", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validTelemetry, name: "app.launch" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "unknown_event_name", field: "name" });
    });

    it("missing platform → 400 invalid_field platform", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);
      const { platform: _platform, ...withoutPlatform } = validTelemetry;

      const res = await handleIngestEvent(request(withoutPlatform), env, ctx, deps);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "platform" });
    });

    it("missing installId → 400 invalid_field installId", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);
      const { installId: _installId, ...withoutInstallId } = validTelemetry;

      const res = await handleIngestEvent(request(withoutInstallId), env, ctx, deps);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "installId" });
    });

    it("missing sessionId → 400 invalid_field sessionId", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);
      const { sessionId: _sessionId, ...withoutSessionId } = validTelemetry;

      const res = await handleIngestEvent(request(withoutSessionId), env, ctx, deps);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "sessionId" });
    });

    it("missing occurredAt → 400 invalid_field occurredAt", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);
      const { occurredAt: _occurredAt, ...withoutOccurredAt } = validTelemetry;

      const res = await handleIngestEvent(request(withoutOccurredAt), env, ctx, deps);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "occurredAt" });
    });

    it("minute-precision occurredAt → 400 invalid_field occurredAt", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validTelemetry, occurredAt: "2026-07-17T14:23:00Z" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "occurredAt" });
    });

    it("non-UUID installId → 400 invalid_field installId", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validTelemetry, installId: "not-a-uuid" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "installId" });
    });

    it("non-UUID sessionId → 400 invalid_field sessionId", async () => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({ ...validTelemetry, sessionId: "not-a-uuid" }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_field", field: "sessionId" });
    });

    it("stores the four new fields verbatim alongside the existing telemetry shape", async () => {
      const { kv, store, putSpy } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(request(validTelemetry), env, ctx, deps);

      expect(res.status).toBe(202);
      const ingestPutCall = putSpy.mock.calls.find((call) =>
        String(call[0]).startsWith("ingest:"),
      );
      const stored = JSON.parse(store.get(ingestPutCall![0] as string)!) as StoredIngestEvent;
      expect(stored.event).toEqual(validTelemetry);
    });
  });

  describe("rate limiting", () => {
    it("30 requests from one IP accepted, 31st → 429; another IP unaffected; missing header buckets under 'unknown'", async () => {
      const { kv, store, putSpy } = makeKv();
      const env = makeEnv(kv);

      let last!: Response;
      for (let i = 0; i < 31; i++) {
        last = await handleIngestEvent(
          request({ ...validFeedback, message: `msg ${i}` }, "1.2.3.4"),
          env,
          ctx,
          deps,
        );
      }
      expect(last.status).toBe(429);
      expect(await last.json()).toEqual({ error: "rate_limited" });

      const other = await handleIngestEvent(
        request(validFeedback, "5.6.7.8"),
        env,
        ctx,
        deps,
      );
      expect(other.status).toBe(202);

      const unknownIpRes = await handleIngestEvent(
        new Request("https://sound-buddy-api.test/api/ingest", {
          method: "POST",
          body: JSON.stringify(validFeedback),
        }),
        env,
        ctx,
        deps,
      );
      expect(unknownIpRes.status).toBe(202);
      expect(store.has("rl:ingest:unknown")).toBe(true);

      expect(store.has("rl:ingest:1.2.3.4")).toBe(true);
      const rateLimitPutCall = putSpy.mock.calls.find(
        (call) => call[0] === "rl:ingest:1.2.3.4",
      );
      expect(rateLimitPutCall?.[2]).toEqual({ expirationTtl: 60 });
    });
  });

  describe("accepted event storage", () => {
    it("accepted feedback → 202 with fixed id, KV put once with expected key/value/ttl", async () => {
      const { kv, store, putSpy } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(request(validFeedback), env, ctx, deps);

      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ status: "accepted", id: FIXED_ID });

      const ingestPutCall = putSpy.mock.calls.find((call) =>
        String(call[0]).startsWith("ingest:"),
      );
      expect(ingestPutCall?.[0]).toBe(`ingest:feedback:${NOW.toISOString()}:${FIXED_ID}`);
      expect(ingestPutCall?.[2]).toEqual({ expirationTtl: 90 * 24 * 60 * 60 });

      const stored = JSON.parse(store.get(ingestPutCall![0] as string)!) as StoredIngestEvent;
      expect(stored.receivedAt).toBe(NOW.toISOString());
      expect(stored.event).toEqual(validFeedback);
      expect(Object.keys(stored.event).sort()).toEqual(
        ["appVersion", "message", "type"].sort(),
      );
    });
  });

  describe("redaction end-to-end", () => {
    it("feedback message is redacted before storage", async () => {
      const { kv, store, putSpy } = makeKv();
      const env = makeEnv(kv);
      const message =
        "mail me at pat@x.com, key SB1.abc.def, log in /Users/patrick/Library";

      const res = await handleIngestEvent(
        request({ type: "feedback", appVersion: "1.0.0", message }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(202);
      const ingestPutCall = putSpy.mock.calls.find((call) =>
        String(call[0]).startsWith("ingest:"),
      );
      const stored = JSON.parse(store.get(ingestPutCall![0] as string)!) as StoredIngestEvent;
      expect((stored.event as { message: string }).message).toBe(
        "mail me at [redacted-email], key [redacted-license], log in /Users/[redacted]/Library",
      );
    });

    it("crash stack is redacted before storage", async () => {
      const { kv, store, putSpy } = makeKv();
      const env = makeEnv(kv);
      const stack = "Error at /Users/patrick/app.js reported by pat@x.com";

      const res = await handleIngestEvent(
        request({ type: "crash", appVersion: "1.0.0", message: "boom", stack }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(202);
      const ingestPutCall = putSpy.mock.calls.find((call) =>
        String(call[0]).startsWith("ingest:"),
      );
      const stored = JSON.parse(store.get(ingestPutCall![0] as string)!) as StoredIngestEvent;
      expect((stored.event as { stack: string }).stack).toBe(
        "Error at /Users/[redacted]/app.js reported by [redacted-email]",
      );
    });

    it("telemetry string prop values are redacted; numbers/booleans untouched", async () => {
      const { kv, store, putSpy } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(
        request({
          type: "telemetry",
          appVersion: "1.0.0",
          name: "feedback_sent",
          platform: "darwin-arm64",
          installId: "11111111-1111-1111-1111-111111111111",
          sessionId: "22222222-2222-2222-2222-222222222222",
          occurredAt: "2026-07-16T12:00:00Z",
          props: { contact: "pat@x.com", count: 3, ok: true },
        }),
        env,
        ctx,
        deps,
      );

      expect(res.status).toBe(202);
      const ingestPutCall = putSpy.mock.calls.find((call) =>
        String(call[0]).startsWith("ingest:"),
      );
      const stored = JSON.parse(store.get(ingestPutCall![0] as string)!) as StoredIngestEvent;
      const props = (stored.event as { props: Record<string, unknown> }).props;
      expect(props.contact).toBe("[redacted-email]");
      expect(props.count).toBe(3);
      expect(props.ok).toBe(true);
    });
  });

  describe("redactText", () => {
    it("redacts an email address", () => {
      expect(redactText("contact pat@example.com now")).toBe(
        "contact [redacted-email] now",
      );
    });

    it("redacts a signed license string", () => {
      expect(redactText("key SB1.abcDEF_123-x.sig")).toBe("key [redacted-license]");
    });

    it("redacts a macOS home path", () => {
      expect(redactText("see /Users/patrick/Library/logs")).toBe(
        "see /Users/[redacted]/Library/logs",
      );
    });

    it("redacts all patterns combined", () => {
      expect(
        redactText("pat@example.com SB1.a.b /Users/pat/file"),
      ).toBe("[redacted-email] [redacted-license] /Users/[redacted]/file");
    });

    it("passes through a string with no sensitive content unchanged", () => {
      expect(redactText("everything is fine here")).toBe("everything is fine here");
    });
  });

  describe("redactIngestEvent", () => {
    it("redacts message, stack, and every string prop value", () => {
      const event = {
        type: "crash",
        appVersion: "1.0.0",
        message: "hit pat@example.com",
        stack: "at /Users/pat/x.js",
      } as IngestEvent;
      const redacted = redactIngestEvent(event);
      expect(redacted).toEqual({
        type: "crash",
        appVersion: "1.0.0",
        message: "hit [redacted-email]",
        stack: "at /Users/[redacted]/x.js",
      });
    });

    it("crash event with no stack is left without a stack field", () => {
      const event = {
        type: "crash",
        appVersion: "1.0.0",
        message: "hit pat@example.com",
      } as IngestEvent;
      expect(redactIngestEvent(event)).toEqual({
        type: "crash",
        appVersion: "1.0.0",
        message: "hit [redacted-email]",
      });
    });

    it("telemetry event with no props is returned unchanged", () => {
      const event = {
        type: "telemetry",
        appVersion: "1.0.0",
        name: "app_opened",
        platform: "darwin-arm64",
        installId: "11111111-1111-1111-1111-111111111111",
        sessionId: "22222222-2222-2222-2222-222222222222",
        occurredAt: "2026-07-16T12:00:00Z",
      } as IngestEvent;
      expect(redactIngestEvent(event)).toEqual(event);
    });
  });

  describe("default deps (real clock and crypto.randomUUID)", () => {
    it("accepted event stores a real ISO timestamp and a UUID id when deps are omitted", async () => {
      const { kv, store, putSpy } = makeKv();
      const env = makeEnv(kv);

      const res = await handleIngestEvent(request(validFeedback), env, ctx);

      expect(res.status).toBe(202);
      const body = (await res.json()) as { status: string; id: string };
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/);

      const ingestPutCall = putSpy.mock.calls.find((call) =>
        String(call[0]).startsWith("ingest:"),
      );
      expect(ingestPutCall).toBeDefined();
      const stored = JSON.parse(store.get(ingestPutCall![0] as string)!) as StoredIngestEvent;
      expect(() => new Date(stored.receivedAt).toISOString()).not.toThrow();
      expect(new Date(stored.receivedAt).toISOString()).toBe(stored.receivedAt);
    });
  });
});
