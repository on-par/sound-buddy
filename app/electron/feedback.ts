// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// In-app feedback submission (#472) — the app's second deliberate outbound
// call after #117's license refresh. User-initiated only (a Send click in
// the feedback dialog): the renderer supplies message/category/contactEmail,
// the main process attaches the safe diagnostic summary (app version, OS
// version, platform) itself so the renderer can neither add nor omit it,
// redacts the message client-side as defense in depth (the worker
// re-redacts server-side — see ingest.ts's redactText, which these regexes
// must stay in sync with), and POSTs to the #475 ingestion endpoint. Never
// fires on a timer or automatically — only on an explicit user action. Does
// not touch usageSignalEnabled or any telemetry/collection code (#145).

import { app, shell } from 'electron';
import * as fs from 'fs';
import { getLogFilePath, logWarn } from './logger';
import type { FeedbackSubmission, SubmitFeedbackResult } from './ipc/api';

export const FEEDBACK_EMAIL = 'support@soundbuddy.online';

const DEFAULT_INGEST_URL = 'https://soundbuddy.online/api/ingest';
const SUBMIT_TIMEOUT_MS = 5000;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_CONTACT_EMAIL_LENGTH = 254; // matches the worker's ingest.ts bound
const CONTACT_EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export const FEEDBACK_CATEGORIES = ['bug', 'idea', 'question', 'other'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

/**
 * Resolve the ingest endpoint: a dev/e2e-only env override (mirrors how
 * license-refresh.ts's refreshUrl() gates its own override) or the
 * production default. A packaged .app can never be redirected elsewhere.
 * Exported so crash-reporting.ts (#473) shares this instead of duplicating
 * the env-override logic.
 */
export function ingestUrl(): string {
  const env = !app.isPackaged && process.env.SOUND_BUDDY_INGEST_API_URL?.trim();
  return env || DEFAULT_INGEST_URL;
}

/** Redact PII from free-text before it ever leaves the machine: email
 * addresses, signed license strings, macOS home paths — in that order. Kept
 * byte-for-byte in sync with the worker's own `redactText` (ingest.ts),
 * which re-redacts server-side as the authoritative pass. */
export function redactFeedbackText(input: string): string {
  return input
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    .replace(/SB1\.[A-Za-z0-9_\-.]+/g, '[redacted-license]')
    .replace(/\/Users\/[^/\s]+/g, '/Users/[redacted]');
}

type ValidatedSubmission = { message: string; category: FeedbackCategory; contactEmail?: string };

function validateSubmission(
  input: unknown
): { ok: true; value: ValidatedSubmission } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'Enter a short message describing your feedback.' };
  }
  const { message, category, contactEmail } = input as Partial<FeedbackSubmission>;

  if (typeof message !== 'string' || !message.trim()) {
    return { ok: false, error: 'Enter a short message describing what happened or what would help.' };
  }
  const trimmedMessage = message.trim();
  if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      error: `Your message is too long — please shorten it to ${MAX_MESSAGE_LENGTH} characters or fewer.`,
    };
  }

  if (!FEEDBACK_CATEGORIES.includes(category as FeedbackCategory)) {
    return { ok: false, error: 'Choose a category for your feedback.' };
  }

  if (
    contactEmail !== undefined &&
    contactEmail !== '' &&
    (contactEmail.length > MAX_CONTACT_EMAIL_LENGTH || !CONTACT_EMAIL_PATTERN.test(contactEmail))
  ) {
    return { ok: false, error: 'Enter a valid email address, or leave it blank.' };
  }

  return {
    ok: true,
    value: {
      message: trimmedMessage,
      category: category as FeedbackCategory,
      ...(contactEmail ? { contactEmail } : {}),
    },
  };
}

/**
 * Submit a user's feedback dialog input to the #475 ingestion endpoint.
 * Never trusts the renderer: revalidates `input` from scratch, then builds
 * the payload here from an explicit allowlist — the "safe diagnostic
 * summary" of app version, macOS version, and platform — so the renderer
 * can neither add nor omit fields. Never throws; every failure path resolves
 * a typed, user-actionable result and `logWarn`s the outcome only (status
 * code or error class — never the message body or contact email).
 */
export async function submitFeedback(
  input: unknown,
  fetchFn: typeof fetch = fetch
): Promise<SubmitFeedbackResult> {
  const validated = validateSubmission(input);
  if (!validated.ok) {
    return { ok: false, retryable: false, error: validated.error };
  }
  const { message, category, contactEmail } = validated.value;

  // Redaction placeholders (e.g. "[redacted-email]") can be longer than the
  // text they replace, so a message just under MAX_MESSAGE_LENGTH can grow
  // past it here — re-check the length the worker will actually see before
  // ever making a network call, rather than sending a payload guaranteed to
  // bounce with a generic 400.
  const redactedMessage = redactFeedbackText(message);
  if (redactedMessage.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      retryable: false,
      error: `Your message is too long — please shorten it to ${MAX_MESSAGE_LENGTH} characters or fewer.`,
    };
  }

  const payload = {
    type: 'feedback' as const,
    appVersion: app.getVersion(),
    osVersion: process.getSystemVersion(),
    platform: `${process.platform}-${process.arch}`,
    message: redactedMessage,
    category,
    ...(contactEmail ? { contactEmail } : {}),
  };

  try {
    const res = await fetchFn(ingestUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });

    if (res.ok) return { ok: true };

    if (res.status === 429 || res.status >= 500) {
      logWarn(`feedback submit: server responded ${res.status}`);
      return { ok: false, retryable: true, error: 'The feedback service is busy — try again in a minute.' };
    }

    logWarn(`feedback submit: server responded ${res.status}`);
    return {
      ok: false,
      retryable: false,
      error: `Could not submit feedback — email ${FEEDBACK_EMAIL} instead.`,
    };
  } catch (err) {
    logWarn(`feedback submit failed: ${err instanceof Error ? err.constructor.name : String(err)}`);
    return {
      ok: false,
      retryable: true,
      error: 'Could not reach the feedback service — check your internet connection and try again.',
    };
  }
}

export function feedbackMailtoUrl(appVersion: string, osVersion: string): string {
  const subject = 'Sound Buddy Feedback';
  const body = `\n\n---\nApp version: ${appVersion}\nmacOS: ${osVersion}`;
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export async function openFeedback(): Promise<void> {
  const url = feedbackMailtoUrl(app.getVersion(), process.getSystemVersion());
  try {
    await shell.openExternal(url);
  } catch (err) {
    logWarn(`feedback mailto failed: ${String(err)}`);
  }
}

// #144: "Attach diagnostics" reveals the log file in Finder so the user can
// drag it into the feedback email themselves — a mailto: link can't carry an
// attachment, and the log never leaves the machine unless the user does that.
export type RevealDiagnosticsResult = { revealed: boolean; missing?: boolean };

export function revealDiagnosticLog(): RevealDiagnosticsResult {
  const p = getLogFilePath();
  if (!p || !fs.existsSync(p)) {
    logWarn('reveal diagnostics: log file does not exist yet');
    return { revealed: false, missing: true };
  }
  shell.showItemInFolder(p);
  return { revealed: true };
}
