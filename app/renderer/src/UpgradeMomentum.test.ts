// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import UpgradeMomentum, {
  upgradeMomentumView,
  upgradeMomentumHoldUntilMs,
  upgradeMomentumDismissedAt,
  dismissUpgradeMomentum,
  upgradeMomentumFirstSeenAt,
  markUpgradeMomentumFirstSeen,
} from './UpgradeMomentum';
import { useLicensingStore } from './stores/licensingStore';
import { useAnalysisStore } from './stores/analysisStore';
import type { AnalysisSummary } from '../../electron/ipc/api';

// Full contract-shaped literal for the now-typed historySummary store field
// (#748) — UpgradeMomentum only reads gradeLetter, but the store field demands
// the whole AnalysisSummary shape.
function makeSummary(gradeLetter: string): AnalysisSummary {
  return {
    date: '2026-08-06T12:00:00Z',
    sourceFilename: 'service.wav',
    gradeLetter,
    score: 90,
    recordingType: 'Full Mix',
    topFixes: [],
  };
}

const NOW = new Date('2026-08-06T12:00:00Z');
const PRO_STATUS = { tier: 'pro', status: 'valid' } as const;
const FREE_STATUS = { tier: 'free', status: 'none' } as const;

const UPGRADE_MOMENTUM_API = {
  ACTIONS: [{ title: 'See what changed', hint: 'Track it over time.' }],
  PLANS: [{ plan: 'monthly', label: 'Start for $9/mo', primary: true }],
  TRUST_COPY: 'Your audio never leaves this Mac.',
  toneForGrade: (grade: string) => (grade === 'A'
    ? { heading: 'Nice mix', sub: 'Keep it dialed in.' }
    : { heading: 'Keep improving', sub: 'Turn this into a workflow.' }),
  shouldShowForLicense: (state: { tier?: string } | null) => !(state && state.tier === 'pro'),
  isDismissed: (dismissedAt: string | null, now?: Date) => {
    if (!dismissedAt) return false;
    const at = parseInt(dismissedAt, 10);
    return (now ?? new Date()).getTime() - at < 7 * 24 * 60 * 60 * 1000;
  },
  revealDelayMs: (firstSeenAt: string | null) => (firstSeenAt == null ? 6000 : 0),
};

function renderMarkup(): string {
  return renderToString(createElement(UpgradeMomentum));
}

function fakeStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    _store: store,
  };
}

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { upgradeMomentum: UPGRADE_MOMENTUM_API };
  // Pre-seed first-seen so renderToString-based tests see the card
  // immediately, without needing a real setTimeout to elapse.
  (globalThis as { localStorage?: unknown }).localStorage = fakeStorage({ 'sb-first-report-seen-at': '1' });
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { localStorage?: unknown }).localStorage;
  useLicensingStore.setState({ licenseStatus: null });
  useAnalysisStore.setState({ currentAnalysis: null, liveSource: null, historySummary: null, status: 'idle' });
});

describe('upgradeMomentumDismissedAt / dismissUpgradeMomentum', () => {
  it('round-trips a dismissal timestamp', () => {
    const storage = fakeStorage();
    expect(upgradeMomentumDismissedAt(storage)).toBeNull();
    dismissUpgradeMomentum(storage);
    expect(upgradeMomentumDismissedAt(storage)).not.toBeNull();
  });

  it('swallows a throwing storage (private mode)', () => {
    const throwing = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(upgradeMomentumDismissedAt(throwing)).toBeNull();
    expect(() => dismissUpgradeMomentum(throwing)).not.toThrow();
  });
});

describe('upgradeMomentumFirstSeenAt / markUpgradeMomentumFirstSeen', () => {
  it('round-trips a first-seen timestamp', () => {
    const storage = fakeStorage();
    expect(upgradeMomentumFirstSeenAt(storage)).toBeNull();
    markUpgradeMomentumFirstSeen(storage);
    expect(upgradeMomentumFirstSeenAt(storage)).not.toBeNull();
  });

  it('swallows a throwing storage (private mode)', () => {
    const throwing = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(upgradeMomentumFirstSeenAt(throwing)).toBeNull();
    expect(() => markUpgradeMomentumFirstSeen(throwing)).not.toThrow();
  });
});

describe('upgradeMomentumHoldUntilMs', () => {
  it('holds a first-ever result back for the reveal delay', () => {
    expect(upgradeMomentumHoldUntilMs(null, NOW)).toBe(NOW.getTime() + 6000);
  });

  it('shows immediately once a first-seen value already exists', () => {
    expect(upgradeMomentumHoldUntilMs('1', NOW)).toBe(0);
  });
});

describe('upgradeMomentumView', () => {
  const BASE = { lastReportGrade: 'A', licenseStatus: FREE_STATUS, dismissedAt: null, holdUntilMs: 0, now: NOW };

  it('shows once a grade exists, license is free, not dismissed, and the hold has passed', () => {
    expect(upgradeMomentumView(BASE)).toEqual({ show: true });
  });

  it('never shows with no grade yet', () => {
    expect(upgradeMomentumView({ ...BASE, lastReportGrade: null })).toEqual({ show: false });
  });

  it('never shows before the license status has resolved', () => {
    expect(upgradeMomentumView({ ...BASE, licenseStatus: null })).toEqual({ show: false });
  });

  it('never shows for a Pro license', () => {
    expect(upgradeMomentumView({ ...BASE, licenseStatus: PRO_STATUS })).toEqual({ show: false });
  });

  it('never shows within the 7-day "Maybe later" dismissal window', () => {
    expect(upgradeMomentumView({ ...BASE, dismissedAt: String(NOW.getTime() - 1000) })).toEqual({ show: false });
  });

  it('shows again once the dismissal window has elapsed', () => {
    const eightDaysAgo = String(NOW.getTime() - 8 * 24 * 60 * 60 * 1000);
    expect(upgradeMomentumView({ ...BASE, dismissedAt: eightDaysAgo })).toEqual({ show: true });
  });

  it('stays hidden while still within the hold window', () => {
    expect(upgradeMomentumView({ ...BASE, holdUntilMs: NOW.getTime() + 6000 })).toEqual({ show: false });
  });

  it('shows once the hold window has elapsed', () => {
    expect(upgradeMomentumView({ ...BASE, holdUntilMs: NOW.getTime() - 1 })).toEqual({ show: true });
  });
});

describe('UpgradeMomentum', () => {
  it('renders hidden with no report card yet', () => {
    const html = renderMarkup();
    expect(html).toMatch(/id="rc-upgrade"[^>]*hidden=""/);
  });

  it('renders visible for a free user with a grade, not first-seen', () => {
    useLicensingStore.setState({ licenseStatus: FREE_STATUS });
    useAnalysisStore.setState({ historySummary: makeSummary('A') });
    const html = renderMarkup();
    expect(html).not.toMatch(/id="rc-upgrade"[^>]*hidden=""/);
    expect(html).toContain('Nice mix');
    expect(html).toContain('See what changed');
    expect(html).toContain('Start for $9/mo');
    expect(html).toContain('Your audio never leaves this Mac.');
  });

  it('shows the "Keep improving" tone for a non-A/B grade', () => {
    useLicensingStore.setState({ licenseStatus: FREE_STATUS });
    useAnalysisStore.setState({ historySummary: makeSummary('D') });
    const html = renderMarkup();
    expect(html).toContain('Keep improving');
  });

  it('stays hidden for a Pro license even with a grade', () => {
    useLicensingStore.setState({ licenseStatus: PRO_STATUS });
    useAnalysisStore.setState({ historySummary: makeSummary('A') });
    const html = renderMarkup();
    expect(html).toMatch(/id="rc-upgrade"[^>]*hidden=""/);
  });

  it('stays hidden for a fresh install (first-seen not yet recorded)', () => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage();
    useLicensingStore.setState({ licenseStatus: FREE_STATUS });
    useAnalysisStore.setState({ historySummary: makeSummary('A') });
    const html = renderMarkup();
    expect(html).toMatch(/id="rc-upgrade"[^>]*hidden=""/);
  });

  it('stays hidden within the dismissal window', () => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage({
      'sb-first-report-seen-at': '1',
      'sb-upgrade-momentum-dismissed-at': String(Date.now()),
    });
    useLicensingStore.setState({ licenseStatus: FREE_STATUS });
    useAnalysisStore.setState({ historySummary: makeSummary('A') });
    const html = renderMarkup();
    expect(html).toMatch(/id="rc-upgrade"[^>]*hidden=""/);
  });
});
