// `POST /api/ingest` handler (#475) — receiving side for feedback, crash, and
// telemetry events the desktop app submits for launch learning and support
// (epic:feedback). No app client wiring lands in this issue.
//
// SECURITY (normative): never log event bodies, messages, stacks, or KV
// values. Log outcomes only.

import { json } from "../http";
import type { Env } from "../index";

const MAX_BODY_BYTES = 32 * 1024; // bound attacker-supplied body before JSON.parse
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 30; // per client IP per window
const EVENT_TTL_SECONDS = 90 * 24 * 60 * 60; // events self-expire from KV after 90 days
const MAX_MESSAGE_LENGTH = 4000; // feedback.message
const MAX_CRASH_MESSAGE_LENGTH = 2000; // crash.message
const MAX_STACK_LENGTH = 8000; // crash.stack
const MAX_SHORT_FIELD_LENGTH = 32; // appVersion, osVersion
const MAX_TELEMETRY_PROPS = 20;
const MAX_PROP_VALUE_LENGTH = 256;
const TELEMETRY_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

// #472: feedback.category/contactEmail/platform — additive, backwards-compatible
// fields. contactEmail is a deliberate reply channel the user typed into a
// dedicated field, so it is validated (not deny-listed like `email`/`userEmail`).
const FEEDBACK_CATEGORIES = new Set(["bug", "idea", "question", "other"]);
const MAX_CONTACT_EMAIL_LENGTH = 254;
const CONTACT_EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export type IngestEventType = "feedback" | "crash" | "telemetry";

export type FeedbackCategory = "bug" | "idea" | "question" | "other";

export interface FeedbackEvent {
  type: "feedback";
  appVersion: string;
  osVersion?: string;
  message: string;
  category?: FeedbackCategory;
  contactEmail?: string;
  platform?: string;
}

export interface CrashEvent {
  type: "crash";
  appVersion: string;
  osVersion?: string;
  message: string;
  stack?: string;
  processType?: "main" | "renderer";
}

export interface TelemetryEvent {
  type: "telemetry";
  appVersion: string;
  osVersion?: string;
  name: string;
  value?: number;
  props?: Record<string, string | number | boolean>;
}

export type IngestEvent = FeedbackEvent | CrashEvent | TelemetryEvent;

/** Stored post-redaction, alongside a server-assigned receipt timestamp. */
export interface StoredIngestEvent {
  receivedAt: string;
  event: IngestEvent;
}

/** Keys that must never be accepted anywhere in the body (or `props`), even
 * when they'd otherwise pass an allowlist — checked before the allowlist so
 * the error is stable and specific. */
const SENSITIVE_FIELD_NAMES = new Set([
  "email",
  "userEmail",
  "ip",
  "ipAddress",
  "userId",
  "user",
  "username",
  "hostname",
  "licenseKey",
  "key",
  "path",
  "filePath",
]);

const ALLOWED_FIELDS: Record<IngestEventType, ReadonlySet<string>> = {
  feedback: new Set([
    "type",
    "appVersion",
    "osVersion",
    "message",
    "category",
    "contactEmail",
    "platform",
  ]),
  crash: new Set(["type", "appVersion", "osVersion", "message", "stack", "processType"]),
  telemetry: new Set(["type", "appVersion", "osVersion", "name", "value", "props"]),
};

type ValidationResult =
  | { ok: true; event: IngestEvent }
  | { ok: false; error: string; field?: string; status: number };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findSensitiveField(body: Record<string, unknown>): string | undefined {
  for (const key of Object.keys(body)) {
    if (SENSITIVE_FIELD_NAMES.has(key)) return key;
  }
  if (isPlainObject(body.props)) {
    for (const key of Object.keys(body.props)) {
      if (SENSITIVE_FIELD_NAMES.has(key)) return key;
    }
  }
  return undefined;
}

function isShortField(value: unknown, required: boolean): boolean {
  if (value === undefined) return !required;
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SHORT_FIELD_LENGTH &&
    !/\s/.test(value)
  );
}

function validateAppVersionAndOsVersion(
  body: Record<string, unknown>,
): { field: string } | undefined {
  if (!isShortField(body.appVersion, true)) return { field: "appVersion" };
  if (body.osVersion !== undefined && !isShortField(body.osVersion, false)) {
    return { field: "osVersion" };
  }
  return undefined;
}

function validateProps(props: unknown): boolean {
  if (props === undefined) return true;
  if (!isPlainObject(props)) return false;
  const entries = Object.entries(props);
  if (entries.length > MAX_TELEMETRY_PROPS) return false;
  for (const [key, value] of entries) {
    if (!TELEMETRY_NAME_PATTERN.test(key)) return false;
    if (typeof value === "string") {
      if (value.length > MAX_PROP_VALUE_LENGTH) return false;
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) return false;
    } else if (typeof value !== "boolean") {
      return false;
    }
  }
  return true;
}

/**
 * Explicit hand-rolled validation of an ingest event body: sensitive-field
 * deny list first (stable, specific error), then event type, then a per-type
 * key allowlist, then field-level rules. On success the event is rebuilt
 * field-by-field from the allowlist — the raw body is never spread into the
 * stored event.
 */
export function validateIngestEvent(body: unknown): ValidationResult {
  if (!isPlainObject(body)) {
    return { ok: false, error: "invalid_event", status: 400 };
  }

  const sensitiveField = findSensitiveField(body);
  if (sensitiveField) {
    return { ok: false, error: "sensitive_field", field: sensitiveField, status: 400 };
  }

  const type = body.type;
  if (type !== "feedback" && type !== "crash" && type !== "telemetry") {
    return { ok: false, error: "unknown_event_type", status: 400 };
  }

  const allowedKeys = ALLOWED_FIELDS[type];
  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) {
      return { ok: false, error: "unknown_field", field: key, status: 400 };
    }
  }

  const versionError = validateAppVersionAndOsVersion(body);
  if (versionError) {
    return { ok: false, error: "invalid_field", field: versionError.field, status: 400 };
  }
  const appVersion = body.appVersion as string;
  const osVersion = body.osVersion as string | undefined;

  if (type === "feedback") {
    const message = body.message;
    if (typeof message !== "string" || !message || message.length > MAX_MESSAGE_LENGTH) {
      return { ok: false, error: "invalid_field", field: "message", status: 400 };
    }
    const category = body.category;
    if (category !== undefined && !FEEDBACK_CATEGORIES.has(category as string)) {
      return { ok: false, error: "invalid_field", field: "category", status: 400 };
    }
    const contactEmail = body.contactEmail;
    if (
      contactEmail !== undefined &&
      (typeof contactEmail !== "string" ||
        contactEmail.length > MAX_CONTACT_EMAIL_LENGTH ||
        !CONTACT_EMAIL_PATTERN.test(contactEmail))
    ) {
      return { ok: false, error: "invalid_field", field: "contactEmail", status: 400 };
    }
    const platform = body.platform;
    if (platform !== undefined && !isShortField(platform, false)) {
      return { ok: false, error: "invalid_field", field: "platform", status: 400 };
    }
    return {
      ok: true,
      event: {
        type,
        appVersion,
        ...(osVersion ? { osVersion } : {}),
        message,
        ...(category !== undefined ? { category: category as FeedbackCategory } : {}),
        ...(contactEmail !== undefined ? { contactEmail: contactEmail as string } : {}),
        ...(platform !== undefined ? { platform: platform as string } : {}),
      },
    };
  }

  if (type === "crash") {
    const message = body.message;
    if (
      typeof message !== "string" ||
      !message ||
      message.length > MAX_CRASH_MESSAGE_LENGTH
    ) {
      return { ok: false, error: "invalid_field", field: "message", status: 400 };
    }
    const stack = body.stack;
    if (stack !== undefined && (typeof stack !== "string" || stack.length > MAX_STACK_LENGTH)) {
      return { ok: false, error: "invalid_field", field: "stack", status: 400 };
    }
    const processType = body.processType;
    if (
      processType !== undefined &&
      processType !== "main" &&
      processType !== "renderer"
    ) {
      return { ok: false, error: "invalid_field", field: "processType", status: 400 };
    }
    return {
      ok: true,
      event: {
        type,
        appVersion,
        ...(osVersion ? { osVersion } : {}),
        message,
        ...(stack !== undefined ? { stack: stack as string } : {}),
        ...(processType !== undefined ? { processType: processType as "main" | "renderer" } : {}),
      },
    };
  }

  // type === "telemetry"
  const name = body.name;
  if (typeof name !== "string" || !TELEMETRY_NAME_PATTERN.test(name)) {
    return { ok: false, error: "invalid_field", field: "name", status: 400 };
  }
  const value = body.value;
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
    return { ok: false, error: "invalid_field", field: "value", status: 400 };
  }
  if (!validateProps(body.props)) {
    return { ok: false, error: "invalid_field", field: "props", status: 400 };
  }
  return {
    ok: true,
    event: {
      type,
      appVersion,
      ...(osVersion ? { osVersion } : {}),
      name,
      ...(value !== undefined ? { value: value as number } : {}),
      ...(body.props !== undefined
        ? { props: body.props as Record<string, string | number | boolean> }
        : {}),
    },
  };
}

/** Redact PII from free-text: email addresses, signed license strings, macOS
 * home paths — in that order. */
export function redactText(input: string): string {
  return input
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .replace(/SB1\.[A-Za-z0-9_\-.]+/g, "[redacted-license]")
    .replace(/\/Users\/[^/\s]+/g, "/Users/[redacted]");
}

/** Returns a copy of `event` with `redactText` applied to `message`, `stack`,
 * and every string value in `props`. */
export function redactIngestEvent(event: IngestEvent): IngestEvent {
  if (event.type === "feedback") {
    // contactEmail is a deliberately consented reply channel the user typed
    // into a dedicated field — it is NOT unintended PII like a stray email
    // caught inside free-text `message`, so it is stored as-is, unlike the
    // deny-listed `email`/`userEmail` keys, which are rejected outright.
    return { ...event, message: redactText(event.message) };
  }
  if (event.type === "crash") {
    return {
      ...event,
      message: redactText(event.message),
      ...(event.stack !== undefined ? { stack: redactText(event.stack) } : {}),
    };
  }
  if (event.props === undefined) return event;
  const props: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(event.props)) {
    props[key] = typeof value === "string" ? redactText(value) : value;
  }
  return { ...event, props };
}

/** Injectable seams so tests never depend on the wall clock or crypto RNG. */
export interface IngestDeps {
  now?: () => Date;
  randomId?: () => string;
}

/** Resolves `true` when the request is within the per-client-IP rate limit.
 * Best-effort (KV has no atomic CAS), not a security boundary — mirrors
 * `withinRateLimit` in license-refresh.ts. */
async function withinRateLimit(env: Env, ip: string): Promise<boolean> {
  const key = `rl:ingest:${ip}`;
  const current = await env.EVENTS_KV.get(key);
  const count = current ? Number.parseInt(current, 10) : 0;
  if (count >= RATE_LIMIT_MAX_REQUESTS) return false;
  await env.EVENTS_KV.put(key, String(count + 1), {
    expirationTtl: RATE_LIMIT_WINDOW_SECONDS,
  });
  return true;
}

/**
 * Handle `POST /api/ingest`: bound + parse the body, rate-limit per client
 * IP, validate against a per-type schema, redact PII, and store the accepted
 * event in `EVENTS_KV` with a bounded TTL. No auth — the app is an
 * unauthenticated client; bounds are body size + rate limit + strict schemas.
 */
export async function handleIngestEvent(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  deps: IngestDeps = {},
): Promise<Response> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!(await withinRateLimit(env, ip))) {
    return json({ error: "rate_limited" }, 429);
  }

  const validated = validateIngestEvent(parsed);
  if (!validated.ok) {
    return json(
      { error: validated.error, ...(validated.field ? { field: validated.field } : {}) },
      validated.status,
    );
  }

  const event = redactIngestEvent(validated.event);

  const receivedAt = (deps.now ?? (() => new Date()))().toISOString();
  const id = (deps.randomId ?? (() => crypto.randomUUID()))();
  await env.EVENTS_KV.put(
    `ingest:${event.type}:${receivedAt}:${id}`,
    JSON.stringify({ receivedAt, event } satisfies StoredIngestEvent),
    { expirationTtl: EVENT_TTL_SECONDS },
  );

  return json({ status: "accepted", id }, 202);
}
