// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The license badge, license grace banner, and trial nudge/expired banner
// (#54, #61, TD-001 slice 6e, #703) — three portals from one component
// (all reading licensingStore reactively), replacing inline-app.js's
// renderLicenseUi/renderTrialBanner + the initLicense() IIFE.

import { useEffect, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLicensingStore } from './stores/licensingStore';
import { graceBannerText } from './LicensePanel';
import { iconSvg } from './report-card';
import type { LicenseState } from '../../electron/ipc/api';

const TRIAL_DAYS = 14; // must mirror TRIAL_DAYS in license.ts (#61)
const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_DAYS = 7; // must mirror GRACE_DAYS in license.ts

const DEFAULT_STATUS: LicenseState = { tier: 'free', status: 'none' };

export interface LicenseBadgeView {
  label: string;
  pro: boolean;
  grace: boolean;
  trial: boolean;
}

// Verbatim ports of license-state.js's badge/trialDaysLeft/trialBadgeText/
// trialNudge/isInRefreshWindow as typed local functions — license-state.js
// is a classic UMD script, duplicated here rather than shared (same
// rationale already documented above LicensePanel.tsx's own graceBannerText
// port). Keep wording byte-identical: entitlement-matrix.spec.ts/
// license.spec.ts/trial.spec.ts/momentum.spec.ts assert substrings of it.
export function badge(state: LicenseState | null): LicenseBadgeView {
  const pro = !!state && state.tier === 'pro';
  const grace = pro && state.status === 'grace';
  const trial = pro && state.status === 'trial';
  return {
    label: grace ? 'PRO · GRACE' : trial ? 'PRO · TRIAL' : pro ? 'PRO' : 'FREE',
    pro,
    grace,
    trial,
  };
}

export function trialDaysLeft(state: LicenseState | null, now: Date): number | null {
  if (!state || state.status !== 'trial' || !state.trialEndsAt) return null;
  const endMs = Date.parse(state.trialEndsAt);
  if (isNaN(endMs)) return null;
  const ms = endMs - now.getTime();
  if (ms <= 0) return null;
  return Math.max(1, Math.ceil(ms / DAY_MS));
}

export function trialBadgeText(state: LicenseState | null, now: Date): string | null {
  const days = trialDaysLeft(state, now);
  if (days === null) return null;
  return `Pro trial — ${days}${days === 1 ? ' day left' : ' days left'}`;
}

export interface TrialNudge {
  milestone: string;
  text: string;
}

export function trialNudge(state: LicenseState | null, now: Date): TrialNudge | null {
  const days = trialDaysLeft(state, now);
  if (days === null) return null;
  const elapsed = TRIAL_DAYS - days; // days is a ceiling, so elapsed is a floor
  const milestone = elapsed >= 11 ? 'day11' : elapsed >= 3 ? 'day3' : null;
  if (!milestone) return null;
  return { milestone, text: 'Enjoying Pro? Start your subscription to keep it.' };
}

export function isInRefreshWindow(state: LicenseState | null, now: Date): boolean {
  if (!state || state.kind !== 'subscription') return false;
  if (state.status === 'grace') return true;
  if (state.status !== 'valid') return false;
  const expiresMs = Date.parse(state.expiresAt || '');
  if (isNaN(expiresMs)) return false;
  return expiresMs - now.getTime() <= GRACE_DAYS * DAY_MS;
}

// Verbatim port of trialDismissed/dismissTrial (inline-app.js), with
// storage injected rather than reaching for global localStorage directly.
export function trialDismissed(storage: Pick<Storage, 'getItem'>, id: string): boolean {
  try { return storage.getItem('sb-trial-dismiss-' + id) === '1'; } catch { return false; }
}
export function dismissTrial(storage: Pick<Storage, 'setItem'>, id: string): void {
  try { storage.setItem('sb-trial-dismiss-' + id, '1'); }
  catch { /* private mode: banner just returns next launch */ }
}

export interface TrialBannerView {
  message: string | null;
  dismissId: string | null;
}

// Port of renderTrialBanner's message/id resolution (inline-app.js), split
// from the dismissal check so it's directly testable.
export function trialBannerView(state: LicenseState | null, now: Date): TrialBannerView {
  if (state?.status === 'trial') {
    const nudge = trialNudge(state, now);
    return nudge ? { message: nudge.text, dismissId: nudge.milestone } : { message: null, dismissId: null };
  }
  if (state?.status === 'trial-expired') {
    return {
      message: 'Your 14-day Pro trial has ended — the report card stays free. Start a subscription to reunlock live monitoring, saved rigs & virtual soundcheck.',
      dismissId: 'expired',
    };
  }
  return { message: null, dismissId: null };
}

/* c8 ignore start -- LicenseChrome itself can't be exercised in this
   harness: it's a real DOM component (document.getElementById targets,
   document.body.classList, localStorage) with no jsdom here, AND React's
   server renderer explicitly rejects createPortal ("Portals are not
   currently supported by the server renderer"), so renderToString can't
   render it either. Every unit of actual logic it wires together — badge/
   trialBadgeText/graceBannerText/trialBannerView/trialDismissed/
   isInRefreshWindow, and the LicenseBadgeButton/LicenseBanner/TrialBanner
   presentational pieces — is exhaustively unit-tested above/below. This
   function is exercised end-to-end by tests/e2e/license.spec.ts,
   trial.spec.ts, entitlement-matrix.spec.ts, and momentum.spec.ts. */
export default function LicenseChrome(): JSX.Element {
  const licenseStatus = useStoreShallow(useLicensingStore, (s) => s.licenseStatus);
  const state = licenseStatus ?? DEFAULT_STATUS;
  const now = new Date();

  const b = badge(state);
  const trialText = trialBadgeText(state, now);
  const grace = graceBannerText(state, now);
  const trialView = trialBannerView(state, now);
  const trialShown = trialView.message !== null && trialView.dismissId !== null
    && !trialDismissed(localStorage, trialView.dismissId);

  const refreshKickedRef = useRef(false);
  // The license-banner "✕" has no persistence today (matches
  // banner.classList.remove('show') with no storage write) — a local flag
  // that resets whenever licenseStatus changes, mirroring renderLicenseUi
  // re-adding 'show' unconditionally on every licStore notification.
  const [bannerDismissed, setBannerDismissed] = useState(false);
  useEffect(() => { setBannerDismissed(false); }, [licenseStatus]);
  const bannerShown = grace !== null && !bannerDismissed;

  // trialDismissed() reads localStorage directly rather than component
  // state — this counter's only job is forcing a re-render (and so a fresh
  // read) the instant the "✕" writes a new dismissal, since setting
  // localStorage alone doesn't trigger one.
  const [, setTrialDismissTick] = useState(0);

  useEffect(() => {
    if (!refreshKickedRef.current && isInRefreshWindow(state, new Date())) {
      refreshKickedRef.current = true;
      // licensingStore.refreshLicense() never throws — a rejected round
      // trip just keeps the current state (see its own comment).
      void useLicensingStore.getState().refreshLicense();
    }
  });
  useEffect(() => {
    // The single gating hook: every Pro surface keys off body.not-pro in CSS.
    document.body.classList.toggle('not-pro', !b.pro);
  }, [b.pro]);

  const badgeEl = document.getElementById('license-badge-island');
  const bannerEl = document.getElementById('license-banner-island');
  const trialEl = document.getElementById('trial-banner-island');

  return (
    <>
      {badgeEl && createPortal(
        <LicenseBadgeButton badge={b} trialText={trialText} onOpen={() => useLicensingStore.getState().openDialog()} />,
        badgeEl
      )}
      {bannerEl && createPortal(
        <LicenseBanner
          shown={bannerShown}
          text={grace}
          onManage={() => useLicensingStore.getState().openDialog()}
          onDismiss={() => setBannerDismissed(true)}
        />,
        bannerEl
      )}
      {trialEl && createPortal(
        <TrialBanner
          shown={trialShown}
          view={trialView}
          onStart={() => useLicensingStore.getState().openDialog()}
          onDismiss={() => {
            if (trialView.dismissId) {
              dismissTrial(localStorage, trialView.dismissId);
              setTrialDismissTick((t) => t + 1);
            }
          }}
        />,
        trialEl
      )}
    </>
  );
}
/* c8 ignore stop */

// Pure presentational pieces, split out from the portal-owning default
// export so they're directly testable via renderToString — React's server
// renderer throws on createPortal ("Portals are not currently supported by
// the server renderer"), so LicenseChrome itself can't be rendered that way.
export function LicenseBadgeButton(
  { badge: b, trialText, onOpen }: { badge: LicenseBadgeView; trialText: string | null; onOpen: () => void }
): JSX.Element {
  const badgeClass = [b.pro && 'pro', b.grace && 'grace', b.trial && 'trial'].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      id="license-badge"
      title="License — click to manage"
      className={badgeClass}
      /* c8 ignore next -- click dispatch, no jsdom */
      onClick={onOpen}
    >
      {trialText || b.label}
    </button>
  );
}

export function LicenseBanner(
  { shown, text, onManage, onDismiss }: { shown: boolean; text: string | null; onManage: () => void; onDismiss: () => void }
): JSX.Element {
  return (
    <div id="license-banner" role="status" className={shown ? 'show' : ''}>
      <span className="ub-icon" dangerouslySetInnerHTML={{ __html: iconSvg('alert-triangle', 16) }} />
      <span className="lb-text" id="license-banner-text">{text ?? ''}</span>
      {/* c8 ignore next -- click dispatch, no jsdom */}
      <button type="button" id="license-banner-manage" className="ub-btn" onClick={onManage}>
        Manage…
      </button>
      {/* c8 ignore next -- click dispatch, no jsdom */}
      <button type="button" id="license-banner-dismiss" className="ub-x" aria-label="Dismiss" onClick={onDismiss}>
        ✕
      </button>
    </div>
  );
}

export function TrialBanner(
  { shown, view, onStart, onDismiss }: { shown: boolean; view: TrialBannerView; onStart: () => void; onDismiss: () => void }
): JSX.Element {
  return (
    <div id="trial-banner" role="status" className={shown ? 'show' : ''} data-dismiss-id={view.dismissId ?? undefined}>
      <span className="ub-icon" dangerouslySetInnerHTML={{ __html: iconSvg('sparkles', 16) }} />
      <span className="lb-text" id="trial-banner-text">{view.message ?? ''}</span>
      {/* c8 ignore next -- click dispatch, no jsdom */}
      <button type="button" id="trial-banner-start" className="ub-btn" onClick={onStart}>
        Start subscription
      </button>
      {/* c8 ignore next -- click dispatch, no jsdom */}
      <button type="button" id="trial-banner-dismiss" className="ub-x" aria-label="Dismiss" onClick={onDismiss}>
        ✕
      </button>
    </div>
  );
}
