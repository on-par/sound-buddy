// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Opt-in crash reporting (#473): captures main-process errors and renderer
// unhandled errors only after the user explicitly turns on the
// `crashReportingEnabled` setting (default off), and submits a strictly
// allowlisted, redacted crash payload to the #475 ingestion endpoint. Modeled
// on feedback.ts (#472): the payload is built here from an explicit
// allowlist so a caller (logger's crash sink, the renderer IPC handler) can
// neither add nor omit fields. When opt-in is off, nothing is captured,
// persisted, or sent.
//
// SECURITY (normative, mirrors ingest.ts/feedback.ts): never log payload
// contents (message/stack) — log outcomes only (status code or error class).

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { logWarn } from './logger';
import { getSettings } from './settings';
import { ingestUrl, redactFeedbackText } from './feedback';

export const MAX_CRASH_MESSAGE_LENGTH = 2000;
export const MAX_STACK_LENGTH = 8000;
export const MAX_RECENT_EVENTS = 20;
export const MAX_REPORTS_PER_SESSION = 5;
const SUBMIT_TIMEOUT_MS = 5000;
// Kept byte-for-byte in sync with the worker's TELEMETRY_NAME_PATTERN
// (worker/src/handlers/ingest.ts) — crash.route and crash.recentEvents
// entries must validate identically on both sides.
export const APP_EVENT_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const PENDING_CRASH_FILENAME = 'pending-crash.json';

function pendingCrashPath(): string {
  return path.join(app.getPath('userData'), PENDING_CRASH_FILENAME);
}

/**
 * Redact PII (via redactFeedbackText — emails, license strings, macOS home
 * paths), then reduce every remaining absolute path to its basename so stack
 * frames stay diagnosable but a user's own file/folder names never leak
 * directory structure. The character class excludes '/', ':', ')' but NOT
 * whitespace, so a segment containing a space (e.g. "Sound Buddy") still
 * collapses into the trailing basename instead of surviving as a leaked
 * directory component.
 */
export function redactCrashText(input: string): string {
  return redactFeedbackText(input).replace(/(?:\/[^/:)]+)+\/([^/:)]+)/g, '…/$1');
}

// ── Recent safe app events (breadcrumbs) ────────────────────────────────────
// Event *names* only — no free text, no values — so user content structurally
// cannot enter the buffer.
let recentEvents: string[] = [];
let currentRoute: string | undefined;
let reportsThisSession = 0;

export function recordAppEvent(name: unknown): void {
  if (typeof name !== 'string' || !APP_EVENT_NAME_PATTERN.test(name)) return;
  recentEvents.push(name);
  if (recentEvents.length > MAX_RECENT_EVENTS) recentEvents.shift();
  if (name.startsWith('screen.')) currentRoute = name;
}

export function resetCrashReportingForTest(): void {
  recentEvents = [];
  currentRoute = undefined;
  reportsThisSession = 0;
}

// ── Payload building ─────────────────────────────────────────────────────
export interface CrashPayload {
  type: 'crash';
  appVersion: string;
  osVersion: string;
  platform: string;
  message: string;
  stack?: string;
  processType: 'main' | 'renderer';
  route?: string;
  recentEvents?: string[];
}

/**
 * Build the strictly-allowlisted crash payload. Built here (main process)
 * from an explicit allowlist so a renderer-supplied input can neither add
 * nor omit fields — mirrors submitFeedback's doctrine.
 */
export function buildCrashPayload(input: {
  message: string;
  stack?: string;
  processType: 'main' | 'renderer';
}): CrashPayload {
  return {
    type: 'crash',
    appVersion: app.getVersion(),
    osVersion: process.getSystemVersion(),
    platform: `${process.platform}-${process.arch}`,
    message: redactCrashText(input.message).slice(0, MAX_CRASH_MESSAGE_LENGTH),
    ...(input.stack !== undefined
      ? { stack: redactCrashText(input.stack).slice(0, MAX_STACK_LENGTH) }
      : {}),
    processType: input.processType,
    ...(currentRoute !== undefined ? { route: currentRoute } : {}),
    ...(recentEvents.length > 0 ? { recentEvents: [...recentEvents] } : {}),
  };
}

// ── Submission ───────────────────────────────────────────────────────────

/**
 * Submit a crash payload to the ingestion endpoint. Never throws — every
 * failure path resolves `{ sent: false }` and `logWarn`s the outcome only
 * (status code or error class, never message/stack contents). Gated on
 * `crashReportingEnabled` and capped at MAX_REPORTS_PER_SESSION per launch so
 * an error loop can't spam the endpoint.
 */
export async function submitCrashPayload(
  payload: CrashPayload,
  fetchFn: typeof fetch = fetch
): Promise<{ sent: boolean }> {
  if (!getSettings().crashReportingEnabled) return { sent: false };
  if (reportsThisSession >= MAX_REPORTS_PER_SESSION) return { sent: false };
  reportsThisSession++;

  try {
    const res = await fetchFn(ingestUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });

    if (!res.ok) {
      logWarn(`crash submit: server responded ${res.status}`);
      return { sent: false };
    }
    return { sent: true };
  } catch (err) {
    logWarn(`crash submit failed: ${err instanceof Error ? err.constructor.name : String(err)}`);
    return { sent: false };
  }
}

// ── Capture entry points ─────────────────────────────────────────────────

/**
 * Capture a main-process error (#153's uncaughtException/unhandledRejection
 * hooks, via logger.ts's injected CrashSink). No-op when opt-in is off.
 *
 * `fatal: true` (uncaughtException — app.exit(1) follows synchronously, an
 * async fetch would die with the process): best-effort synchronous write of
 * the payload to a pending-crash file, sent on next launch by
 * flushPendingCrashReport. `fatal: false` (unhandledRejection,
 * render-process-gone): fire-and-forget submit now.
 */
export function captureMainError(err: unknown, opts: { fatal: boolean }): void {
  if (!getSettings().crashReportingEnabled) return;

  const message = err instanceof Error ? err.message : String(err);
  const payload = buildCrashPayload({
    message,
    ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
    processType: 'main',
  });

  if (opts.fatal) {
    try {
      fs.writeFileSync(pendingCrashPath(), JSON.stringify(payload));
    } catch (writeErr) {
      // A crashing process must never crash harder trying to report itself.
      logWarn(
        `crash pending-write failed: ${writeErr instanceof Error ? writeErr.constructor.name : String(writeErr)}`
      );
    }
    return;
  }

  void submitCrashPayload(payload);
}

/**
 * Send a crash payload saved by a previous fatal-crash launch, if any.
 * Called once at startup. One attempt only: the file is deleted whether or
 * not the send succeeds (or is skipped because opt-in is now off, or the
 * file is malformed) — no retry queue.
 */
export async function flushPendingCrashReport(fetchFn: typeof fetch = fetch): Promise<void> {
  const pendingPath = pendingCrashPath();
  if (!fs.existsSync(pendingPath)) return;

  try {
    const raw = fs.readFileSync(pendingPath, 'utf8');
    if (getSettings().crashReportingEnabled) {
      const payload = JSON.parse(raw) as CrashPayload;
      await submitCrashPayload(payload, fetchFn);
    }
  } catch (err) {
    logWarn(
      `flush pending crash report failed: ${err instanceof Error ? err.constructor.name : String(err)}`
    );
  } finally {
    try {
      fs.unlinkSync(pendingPath);
    } catch {
      /* best-effort cleanup — nothing left to retry */
    }
  }
}

/**
 * IPC-facing validator for a renderer-reported error (#473's
 * report-renderer-error handler) — never trusts the renderer: drops anything
 * that isn't a plain object with a non-empty string `message` and an
 * optional string `stack`, truncating both before redaction runs inside
 * buildCrashPayload.
 */
export function handleRendererErrorReport(input: unknown): void {
  if (typeof input !== 'object' || input === null) return;
  const { message, stack } = input as { message?: unknown; stack?: unknown };
  if (typeof message !== 'string' || message.length === 0) return;
  if (stack !== undefined && typeof stack !== 'string') return;
  if (!getSettings().crashReportingEnabled) return;

  const payload = buildCrashPayload({
    message: message.slice(0, MAX_CRASH_MESSAGE_LENGTH),
    ...(stack !== undefined ? { stack: stack.slice(0, MAX_STACK_LENGTH) } : {}),
    processType: 'renderer',
  });
  void submitCrashPayload(payload);
}
