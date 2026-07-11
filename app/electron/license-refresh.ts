// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Automatic license refresh (#117) — the app's first-ever outbound network
// call, a deliberate, scoped amendment of the "never phones home" stance
// (Patrick 2026-07-08). Silently swaps in a renewed `subscription` key from
// #113's refresh endpoint so a paying monthly subscriber never re-pastes a
// key; if they cancel, the existing offline expiry + grace behavior winds
// Pro down on its own. Sends nothing but the already-signed key string — no
// audio, no telemetry, no other data. Fires only on launch, on paywall
// evaluation, and the manual "Refresh license" button — never on a timer.

import { app } from 'electron';
import { getLicenseState, activateLicense, getStoredKey, GRACE_DAYS, DAY_MS, LicenseState } from './license';
import { logWarn } from './logger';

const DEFAULT_REFRESH_URL = 'https://soundbuddy.online/api/license/refresh';

const REFRESH_TIMEOUT_MS = 5000;

/**
 * Resolve the refresh endpoint: a dev/e2e-only env override (mirrors how
 * licensePublicKey() gates its own override) or the production default. A
 * packaged .app can never be redirected to a different server.
 */
function refreshUrl(): string {
  const env = !app.isPackaged && process.env.SOUND_BUDDY_LICENSE_API_URL?.trim();
  return env || DEFAULT_REFRESH_URL;
}

/**
 * Kill-switch, honored unconditionally — even in a packaged build — so it
 * doubles as a support switch and keeps Playwright specs deterministic.
 */
function refreshDisabled(): boolean {
  return !!process.env.SOUND_BUDDY_DISABLE_LICENSE_REFRESH;
}

/**
 * Pure predicate: should an automatic (non-forced) refresh fire right now?
 * Only a `subscription` key already in grace, or valid but within the
 * `GRACE_DAYS` window of `expiresAt`, qualifies — never `lifetime`, any
 * trial status, `expired`, `invalid`, `none`, or a missing/unparseable expiry.
 */
export function shouldAutoRefresh(state: LicenseState, now: Date): boolean {
  if (state.kind !== 'subscription') return false;
  if (state.status === 'grace') return true;
  if (state.status !== 'valid') return false;
  const expiresMs = Date.parse(state.expiresAt ?? '');
  if (Number.isNaN(expiresMs)) return false;
  return expiresMs - now.getTime() <= GRACE_DAYS * DAY_MS;
}

// Dedupes concurrent calls (the main-process launch trigger and a renderer's
// forced manual/paywall trigger can land in the same tick) into a single
// in-flight network request — both callers await the same result instead of
// firing two refresh POSTs for the same key.
let inFlight: Promise<LicenseState> | null = null;

/**
 * The single entry point: fetch and activate a renewed key when due. Never
 * throws — every failure path (disabled, no key, out of window, offline,
 * timeout, a non-200, a body without a usable key, a key that fails
 * verification, an activation error) silently falls back to the current
 * offline-derived state, which already handles expiry/grace/messaging.
 * `force: true` (the manual button) bypasses the 7-day window but still
 * requires a stored `subscription` key.
 */
export async function maybeRefreshLicense(
  opts: { force?: boolean } = {},
  now: Date = new Date(),
): Promise<LicenseState> {
  const current = getLicenseState(now);
  if (refreshDisabled()) return current;

  const key = getStoredKey();
  if (!key) return current;

  if (!opts.force) {
    if (!shouldAutoRefresh(current, now)) return current;
  } else if (current.kind !== 'subscription') {
    return current;
  }

  if (inFlight) return inFlight;
  inFlight = doRefresh(key, current, now).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** The network call + activation, isolated so `maybeRefreshLicense` can dedupe it. */
async function doRefresh(key: string, current: LicenseState, now: Date): Promise<LicenseState> {
  try {
    const res = await fetch(refreshUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key }),
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
    if (!res.ok) {
      logWarn(`license refresh: server responded ${res.status}`);
      return current;
    }
    const body = (await res.json()) as { key?: unknown };
    if (typeof body?.key !== 'string' || !body.key) {
      logWarn('license refresh: response had no usable key');
      return current;
    }
    // A response key that fails offline verification (bad signature, corrupt
    // payload, wrong keypair) must not overwrite a still-valid current state.
    const activated = activateLicense(body.key, now);
    if (activated.tier !== 'pro') {
      logWarn(`license refresh: returned key did not verify (${activated.status})`);
      return current;
    }
    return activated;
  } catch (err) {
    logWarn(`license refresh failed: ${String(err)}`);
    return current;
  }
}
