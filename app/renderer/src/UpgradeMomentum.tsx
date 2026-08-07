// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The post-report-card "Keep improving" upgrade momentum card (#58, TD-001
// slice 6e, #703) — portaled by App.tsx onto #rc-upgrade-island, replacing
// inline-app.js's renderUpgradeMomentum with a component reading
// licensingStore + report-card-chrome.ts#reportCardChromeView. Copy/tone
// come from the pure window.upgradeMomentum module; `now` is injected
// (matching LicensePanel.tsx's graceBannerText(state, now) convention) so
// the reveal-delay gate is testable without a real timer.

import { useEffect, useState, type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLicensingStore } from './stores/licensingStore';
import { useAnalysisStore } from './stores/analysisStore';
import { getSoundBuddy } from './useElectron';
import { reportCardChromeView } from './report-card-chrome';
import { iconSvg } from './report-card';

const RCU_DISMISS_KEY = 'sb-upgrade-momentum-dismissed-at';
// Records that a report card has been shown to a free user once (#296) — its
// absence marks this install's first-value moment, when the upsell holds back.
const RCU_FIRST_SEEN_KEY = 'sb-first-report-seen-at';

// Verbatim port of inline-app.js's upgradeMomentumDismissedAt/
// dismissUpgradeMomentum/upgradeMomentumFirstSeenAt/
// markUpgradeMomentumFirstSeen, with storage injected (constitution: side
// effects injected, not imported globally) rather than reaching for the
// global `localStorage` directly — mirrors build-order-state.js/
// pass-mode-state.js's storage-as-parameter convention.
export function upgradeMomentumDismissedAt(storage: Pick<Storage, 'getItem'>): string | null {
  try { return storage.getItem(RCU_DISMISS_KEY); } catch { return null; }
}
export function dismissUpgradeMomentum(storage: Pick<Storage, 'setItem'>): void {
  try { storage.setItem(RCU_DISMISS_KEY, String(Date.now())); }
  catch { /* private mode: the card simply returns next launch */ }
}
export function upgradeMomentumFirstSeenAt(storage: Pick<Storage, 'getItem'>): string | null {
  try { return storage.getItem(RCU_FIRST_SEEN_KEY); } catch { return null; }
}
export function markUpgradeMomentumFirstSeen(storage: Pick<Storage, 'setItem'>): void {
  try { storage.setItem(RCU_FIRST_SEEN_KEY, String(Date.now())); }
  catch { /* private mode: the card just shows undelayed */ }
}

interface UpgradeMomentumAction { title: string; hint: string }
interface UpgradeMomentumPlan { plan: string; label: string; primary: boolean }
interface UpgradeMomentumApi {
  ACTIONS: UpgradeMomentumAction[];
  PLANS: UpgradeMomentumPlan[];
  TRUST_COPY: string;
  toneForGrade(grade: string): { heading: string; sub: string };
  shouldShowForLicense(state: unknown): boolean;
  isDismissed(dismissedAt: string | null, now?: Date): boolean;
  revealDelayMs(firstSeenAt: string | null): number;
}
// upgrade-momentum.js stays a classic script — read via a typed window cast,
// matching ReportCardIsland.tsx's getGrading()-style pattern.
function getUpgradeMomentum(): UpgradeMomentumApi {
  return (window as unknown as { upgradeMomentum: UpgradeMomentumApi }).upgradeMomentum;
}

// First-result softened reveal (#296): the ms epoch the card should become
// visible, computed once from the install's first-seen timestamp — 0 (show
// immediately) once a first-seen value already exists. A pure function of
// injected `now`, testable without a real setTimeout.
export function upgradeMomentumHoldUntilMs(firstSeenAt: string | null, now: Date): number {
  const delay = getUpgradeMomentum().revealDelayMs(firstSeenAt);
  return delay > 0 ? now.getTime() + delay : 0;
}

export interface UpgradeMomentumView {
  show: boolean;
}

// Port of renderUpgradeMomentum's show gate (inline-app.js) as a pure
// function — holdUntilMs is resolved once per mount (see
// upgradeMomentumHoldUntilMs above), not recomputed on every call, matching
// the original's "once per session" rcuHoldUntil.
export function upgradeMomentumView(params: {
  lastReportGrade: string | null;
  licenseStatus: unknown;
  dismissedAt: string | null;
  holdUntilMs: number;
  now: Date;
}): UpgradeMomentumView {
  const um = getUpgradeMomentum();
  const gate = params.lastReportGrade !== null
    && params.licenseStatus !== null
    && um.shouldShowForLicense(params.licenseStatus)
    && !um.isDismissed(params.dismissedAt, params.now);
  if (!gate) return { show: false };
  return { show: params.now.getTime() >= params.holdUntilMs };
}

export default function UpgradeMomentum(): JSX.Element {
  const licenseStatus = useStoreShallow(useLicensingStore, (s) => s.licenseStatus);
  const { currentAnalysis, liveSource, historySummary, status } = useStoreShallow(useAnalysisStore, (s) => ({
    currentAnalysis: s.currentAnalysis,
    liveSource: s.liveSource,
    historySummary: s.historySummary,
    status: s.status,
  }));
  const lastReportGrade = reportCardChromeView({ currentAnalysis, liveSource, historySummary, status }).lastReportGrade;

  const [now, setNow] = useState(() => new Date());
  // Resolved once at mount (a lazy initializer runs exactly once, even
  // across re-renders) — mirrors inline-app.js's module-level rcuHoldUntil,
  // set the first time the hold is scheduled and never recomputed after.
  const [holdUntilMs] = useState(() => upgradeMomentumHoldUntilMs(upgradeMomentumFirstSeenAt(localStorage), now));
  const view = upgradeMomentumView({
    lastReportGrade,
    licenseStatus,
    dismissedAt: upgradeMomentumDismissedAt(localStorage),
    holdUntilMs,
    now,
  });

  /* c8 ignore start -- setTimeout scheduling + localStorage write, no jsdom
     in this harness; upgradeMomentumView's own gate logic is exhaustively
     unit-tested above. Exercised end-to-end by tests/e2e/momentum.spec.ts. */
  useEffect(() => {
    if (!view.show && holdUntilMs > now.getTime()) {
      const timer = setTimeout(() => setNow(new Date()), holdUntilMs - now.getTime());
      return () => clearTimeout(timer);
    }
    // The first-seen flag is only written once the card actually shows, not
    // merely when the hold is scheduled (#296) — so quitting mid-hold never
    // silently burns it and skips the soft reveal on the next real sighting.
    if (view.show && upgradeMomentumFirstSeenAt(localStorage) == null) markUpgradeMomentumFirstSeen(localStorage);
  }, [view.show, holdUntilMs, now]);
  /* c8 ignore stop */

  const um = getUpgradeMomentum();
  const tone = lastReportGrade ? um.toneForGrade(lastReportGrade) : null;

  return (
    <aside id="rc-upgrade" hidden={!view.show} aria-label="Upgrade to Pro">
      <div className="rcu-head">
        <span className="rcu-heading" id="rcu-heading">{tone?.heading ?? ''}</span>
        <span className="rcu-sub" id="rcu-sub">{tone?.sub ?? ''}</span>
      </div>
      <ul className="rcu-actions" id="rcu-actions">
        {um.ACTIONS.map((a) => (
          <li className="rcu-action" key={a.title}>
            <span className="rcu-lock" dangerouslySetInnerHTML={{ __html: iconSvg('lock', 15) }} />
            <span className="rcu-atext">
              <span className="rcu-atitle">{a.title}</span>
              <span className="rcu-ahint">{a.hint}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="rcu-cta" id="rcu-cta">
        {um.PLANS.map((p) => (
          <button
            type="button"
            key={p.plan}
            className={`btn ${p.primary ? 'btn-primary' : 'btn-secondary'} rcu-btn`}
            data-checkout-plan={p.plan}
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => {
              // openCheckout returns a Promise (ipcRenderer.invoke); swallow
              // both a synchronous throw (preload missing) and an async
              // rejection so a failed open never surfaces as an unhandled
              // rejection.
              try { getSoundBuddy().openCheckout(p.plan as 'monthly' | 'annual')?.catch(() => {}); }
              catch { /* preload missing */ }
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="rcu-trust" id="rcu-trust">{um.TRUST_COPY}</p>
      <button
        type="button"
        className="rcu-later"
        id="rcu-later"
        /* c8 ignore next -- click dispatch, no jsdom */
        onClick={() => { dismissUpgradeMomentum(localStorage); setNow(new Date()); }}
      >
        Maybe later
      </button>
    </aside>
  );
}
