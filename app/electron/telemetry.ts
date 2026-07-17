// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Opt-in usage telemetry (#474): after the user explicitly turns on the
// `usageSignalEnabled` setting (default off), records a documented allowlist
// of product events, batches them locally in the main process, and uploads
// them to the #475 ingestion endpoint. Modeled on crash-reporting.ts (#473)
// and feedback.ts (#472): the payload is built here from an explicit
// allowlist so a caller can neither add nor omit fields. When opt-in is off,
// nothing is recorded, queued, or sent.
//
// The allowlist below IS the documentation required by the issue — every
// event name and the call site that fires it:
export const TELEMETRY_EVENTS = [
  'app_opened',        // main process, once per launch (app.whenReady)
  'analysis_started',  // analyze-file IPC handler entry
  'analysis_completed',// analyze-file success (not cancel, not error)
  'report_viewed',     // renderer: report card becomes visible
  'report_exported',   // save-report-image handler, after a successful save
  'browser_lite_used', // RESERVED for the website's Browser Lite (site/) — no desktop call site yet
  'feedback_sent',     // submit-feedback handler, after an ok result
] as const;
export type TelemetryEventName = (typeof TELEMETRY_EVENTS)[number];

// SECURITY (normative, mirrors ingest.ts/crash-reporting.ts/feedback.ts):
// never log payload contents (event names) — log outcomes only (status code
// or error class).

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { logWarn } from './logger';
import { getSettings } from './settings';
import { ingestUrl } from './feedback';

export const MAX_QUEUE = 20;
export const FLUSH_INTERVAL_MS = 30_000;
const SUBMIT_TIMEOUT_MS = 5000;
export const INSTALL_ID_FILENAME = 'telemetry-install-id.json';

const LOWERCASE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function installIdPath(): string {
  return path.join(app.getPath('userData'), INSTALL_ID_FILENAME);
}

/** Anonymous, random, never derived from anything — generated once per
 * install and persisted to disk; regenerated if the file is missing,
 * unreadable, or holds anything other than a lowercase UUID. */
export function getOrCreateInstallId(): string {
  try {
    const raw = fs.readFileSync(installIdPath(), 'utf8');
    const parsed = JSON.parse(raw) as { installId?: unknown };
    if (typeof parsed.installId === 'string' && LOWERCASE_UUID_PATTERN.test(parsed.installId)) {
      return parsed.installId;
    }
  } catch {
    // Missing or unreadable — fall through to generating a fresh one.
  }
  const installId = randomUUID();
  fs.writeFileSync(installIdPath(), JSON.stringify({ installId }));
  return installId;
}

export function isApprovedTelemetryEvent(name: unknown): name is TelemetryEventName {
  return typeof name === 'string' && (TELEMETRY_EVENTS as readonly string[]).includes(name);
}

/** Pure: hour-precision only, e.g. "2026-07-17T14:00:00Z". */
export function coarseTimestamp(now: Date): string {
  return now.toISOString().slice(0, 13) + ':00:00Z';
}

interface QueuedTelemetryEvent {
  name: TelemetryEventName;
  occurredAt: string;
}

let queue: QueuedTelemetryEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let sessionId: string | undefined;

function getOrCreateSessionId(): string {
  if (sessionId === undefined) sessionId = randomUUID();
  return sessionId;
}

export function resetTelemetryForTest(): void {
  queue = [];
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined;
  sessionId = undefined;
}

/**
 * Record an approved event name, gated on explicit opt-in. No-op unless
 * `usageSignalEnabled` is on AND `name` is in the documented allowlist —
 * unknown names are silently dropped here (the client-side half of "unknown
 * event names fail validation"). Injected `now` per the constitution's
 * injected-side-effects rule.
 */
export function recordTelemetryEvent(name: unknown, deps: { now?: () => Date } = {}): void {
  if (!getSettings().usageSignalEnabled) return;
  if (!isApprovedTelemetryEvent(name)) return;

  const now = deps.now ?? (() => new Date());
  queue.push({ name, occurredAt: coarseTimestamp(now()) });
  if (queue.length > MAX_QUEUE) queue.shift();

  if (!flushTimer) {
    flushTimer = setTimeout(() => void flushTelemetry(), FLUSH_INTERVAL_MS);
    flushTimer.unref?.();
  }
}

/**
 * Drain the queue and POST one event per request to the ingestion endpoint.
 * Never throws; a non-ok response or fetch error logs the outcome only
 * (status code or error class — never the event name) and drops the event,
 * with no retry queue. Turning telemetry off before a flush runs empties the
 * queue and sends nothing.
 *
 * Kept field-for-field in sync with the worker's ALLOWED_FIELDS.telemetry and
 * TELEMETRY_EVENT_NAMES (worker/src/handlers/ingest.ts).
 */
export async function flushTelemetry(fetchFn: typeof fetch = fetch): Promise<{ sent: number }> {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined;

  const pending = queue;
  queue = [];

  if (!getSettings().usageSignalEnabled) return { sent: 0 };

  const installId = getOrCreateInstallId();
  const session = getOrCreateSessionId();
  let sent = 0;

  for (const item of pending) {
    const payload = {
      type: 'telemetry' as const,
      appVersion: app.getVersion(),
      osVersion: process.getSystemVersion(),
      platform: `${process.platform}-${process.arch}`,
      name: item.name,
      installId,
      sessionId: session,
      occurredAt: item.occurredAt,
    };

    try {
      const res = await fetchFn(ingestUrl(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
      });

      if (!res.ok) {
        logWarn(`telemetry submit: server responded ${res.status}`);
        continue;
      }
      sent++;
    } catch (err) {
      logWarn(`telemetry submit failed: ${err instanceof Error ? err.constructor.name : String(err)}`);
    }
  }

  return { sent };
}

/**
 * Opt-out: empties the pending queue and best-effort deletes the install-id
 * file so a later opt-in starts with a fresh anonymous identity.
 */
export function clearTelemetryState(): void {
  queue = [];
  try {
    fs.unlinkSync(installIdPath());
  } catch {
    // Best-effort — nothing left to clean up if the file never existed.
  }
}
