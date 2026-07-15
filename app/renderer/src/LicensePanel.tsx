// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// React island for the license entry/status dialog (#54, TD-001 slice 3,
// #421) — replaces the static #license-dialog markup + initLicense() in
// inline-app.js with a component backed by licensingStore. Renders the exact
// same ids/classes/structure the static markup had (index.html:220–233) so
// the existing Playwright e2e suite (license.spec.ts, momentum.spec.ts,
// trial.spec.ts, entitlement-matrix.spec.ts) keeps driving the same
// selectors. The dialog stays permanently in the DOM — `display` toggles via
// `dialogOpen`, matching today's show/hide behavior rather than
// conditionally mounting/unmounting it.

import { useEffect, useRef, useState } from 'react';
import type { StoreApi, UseBoundStore } from 'zustand';
import { useElectron } from './useElectron';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLicensingStore, type LicensingState } from './stores/licensingStore';
import type { LicenseState } from '../../electron/ipc/api';

const POLL_INTERVAL_MS = 60_000;
const GRACE_DAY_MS = 24 * 60 * 60 * 1000;

type LicensingStoreHandle = UseBoundStore<StoreApi<LicensingState>>;

// Verbatim port of license-state.js's graceBannerText composition (that file
// is a classic UMD script on window.licenseState, not an ES module this
// component can import) — duplicated rather than shared, same reasoning as
// inline-app.js's own HOSTED_PROVIDER_IDS duplication across the IPC
// boundary. Keep the wording byte-identical; entitlement-matrix.spec.ts and
// license.spec.ts assert substrings of it.
function graceBannerText(state: LicenseState, now: Date): string | null {
  if (state.status !== 'grace' || !state.graceEndsAt) return null;
  const endMs = Date.parse(state.graceEndsAt);
  if (isNaN(endMs)) return null;
  const ms = endMs - now.getTime();
  if (ms <= 0) return null;
  const days = Math.max(1, Math.ceil(ms / GRACE_DAY_MS));
  const unit = days === 1 ? 'day' : 'days';
  return `Your license has expired — Pro features stay unlocked for ${days} more ${unit}. Renew to keep them.`;
}

// Verbatim port of inline-app.js:3243–3264.
export function licenseStatusLine(state: LicenseState | null, trialDaysLeft: number | null): string {
  if (!state || state.status === 'none') return 'Free tier — full report card included.';
  if (state.status === 'trial') {
    const left = trialDaysLeft ? `${trialDaysLeft} ${trialDaysLeft === 1 ? 'day' : 'days'} left` : 'active';
    return `Pro trial — ${left}. Start a subscription to keep Pro when it ends.`;
  }
  if (state.status === 'trial-expired') {
    return 'Your Pro trial has ended — the report card stays free. Start a subscription to reunlock Pro features.';
  }
  if (state.status === 'valid') {
    const who = state.email ? ` (${state.email})` : '';
    if (state.kind === 'lifetime') return `Pro — lifetime license${who}.`;
    const until = state.expiresAt ? ` until ${new Date(state.expiresAt).toLocaleDateString()}` : '';
    return `Pro — active${until}${who}.`;
  }
  if (state.status === 'grace') return graceBannerText(state, new Date()) || 'License expired — grace period active.';
  if (state.status === 'expired') return 'License expired — back on the free tier. Renew to restore Pro features.';
  // Invalid: surface the specific reason the validator computed rather than a
  // generic shrug.
  return 'License key could not be validated' + (state.error ? ': ' + state.error : '') + '.';
}

// Injected-store handlers (constitution: side effects injected, not
// imported globally) — ported from inline-app.js:3319–3375.
export async function activate(
  key: string,
  store: LicensingStoreHandle,
  setError: (msg: string) => void
): Promise<void> {
  try {
    await store.getState().activateLicense(key);
  } catch (err) {
    setError('Could not save the license: ' + String(err));
    return;
  }
  const { licenseStatus, trialDaysLeft } = store.getState();
  if (licenseStatus?.tier === 'pro') {
    setError('');
    store.getState().closeDialog();
  } else {
    setError(licenseStatusLine(licenseStatus, trialDaysLeft));
  }
}

export async function remove(store: LicensingStoreHandle, setError: (msg: string) => void): Promise<void> {
  try {
    await store.getState().removeLicense();
  } catch (err) {
    setError('Could not remove the license: ' + String(err));
    return;
  }
  setError('');
}

// The store's refreshLicense() already swallows a rejected round-trip and
// keeps the current state (see licensingStore.ts) — same silent-failure
// contract as the manual "Refresh license" button (inline-app.js:3365–3375).
export async function refresh(store: LicensingStoreHandle): Promise<void> {
  await store.getState().refreshLicense();
}

export default function LicensePanel() {
  const api = useElectron();
  const { licenseStatus, trialDaysLeft, dialogOpen } = useStoreShallow(useLicensingStore, (s) => ({
    licenseStatus: s.licenseStatus,
    trialDaysLeft: s.trialDaysLeft,
    dialogOpen: s.dialogOpen,
  }));
  const [keyInput, setKeyInput] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  /* c8 ignore start -- mount-once lifecycle wiring (menu listener + the
     entitlement poll, inline-app.js:3311/3381–3383); requires a real
     Electron bridge + timers to observe, exercised by license.spec.ts. No
     jsdom in this harness (constitution forbids adding a new framework). */
  useEffect(() => {
    api.onOpenLicenseDialog(() => useLicensingStore.getState().openDialog());
    void useLicensingStore.getState().checkLicense();
    const id = setInterval(() => {
      void useLicensingStore.getState().checkLicense();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [api]);
  /* c8 ignore stop */

  /* c8 ignore start -- DOM focus() needs a real element (inline-app.js:3281–3287). */
  useEffect(() => {
    if (!dialogOpen) return;
    setKeyInput('');
    setError('');
    inputRef.current?.focus();
  }, [dialogOpen]);
  /* c8 ignore stop */

  /* c8 ignore start -- document-level Escape close (inline-app.js:3315–3317). */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') useLicensingStore.getState().closeDialog();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  /* c8 ignore stop */

  function handleActivate() {
    const key = keyInput.trim();
    if (!key) {
      inputRef.current?.focus();
      return;
    }
    void activate(key, useLicensingStore, setError);
  }

  const showRemove = licenseStatus?.tier === 'pro';
  const showRefresh = licenseStatus?.tier === 'pro' && licenseStatus?.kind === 'subscription';

  return (
    <div
      id="license-dialog"
      className="rig-dialog"
      style={{ display: dialogOpen ? 'flex' : 'none' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="license-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) useLicensingStore.getState().closeDialog();
      }}
    >
      <div className="rig-dialog-card">
        <div className="rig-dialog-title" id="license-dialog-title">
          License
        </div>
        <div className="lic-status" id="license-dialog-status">
          {licenseStatusLine(licenseStatus, trialDaysLeft)}
        </div>
        <input
          ref={inputRef}
          type="text"
          id="license-key-input"
          className="rig-dialog-input"
          placeholder="Paste your license key (SB1.…)"
          autoComplete="off"
          spellCheck={false}
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleActivate();
          }}
        />
        <div className="lic-status err" id="license-dialog-error" style={{ display: error ? 'block' : 'none' }} role="alert">
          {error}
        </div>
        <div className="rig-dialog-actions">
          <button
            type="button"
            id="license-refresh-btn"
            className="btn btn-secondary sm"
            style={{ display: showRefresh ? 'inline-flex' : 'none' }}
            onClick={() => void refresh(useLicensingStore)}
          >
            Refresh license
          </button>
          <button
            type="button"
            id="license-remove-btn"
            className="btn btn-secondary sm"
            style={{ display: showRemove ? 'inline-flex' : 'none' }}
            onClick={() => void remove(useLicensingStore, setError)}
          >
            Remove key
          </button>
          <button
            type="button"
            id="license-close-btn"
            className="btn btn-secondary sm"
            onClick={() => useLicensingStore.getState().closeDialog()}
          >
            Close
          </button>
          <button type="button" id="license-activate-btn" className="btn btn-primary sm" onClick={handleActivate}>
            Activate
          </button>
        </div>
      </div>
    </div>
  );
}
