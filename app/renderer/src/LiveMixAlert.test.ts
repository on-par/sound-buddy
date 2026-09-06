// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import LiveMixAlert, { lowEndMixAlertView } from './LiveMixAlert';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import type { AppSettings } from '../../electron/ipc/api';

type Candidate = {
  id: string;
  title: string;
  action: string;
  category: string;
  scope: string;
  confidence: number;
  severityDb: number;
};

type CoachingState = {
  active: Candidate | null;
  pendingId: string | null;
  pendingCount: number;
  pendingCandidate: Candidate | null;
  clearCount: number;
  cooldowns: Record<string, number>;
  dismissed: Record<string, unknown>;
  acknowledgedId: string | null;
  snoozeUntil: number | null;
  observing: null;
  outcome: null;
};

type CoachingView = { candidate: Candidate | null };

const liveAdjustments = require('../live-adjustments-state.js') as {
  createCoachingState: () => CoachingState;
  advanceCoaching: (state: CoachingState, candidates: Candidate[], now: number) => CoachingState;
  coachingView: (state: CoachingState, now: number) => CoachingView;
  snoozeCoaching: (state: CoachingState, now: number) => CoachingState;
  PERSISTENCE_WINDOWS: number;
  RECOVERY_WINDOWS: number;
};

const NOW = 10_000;
const LOW_END: Candidate = {
  id: 'low-end',
  title: 'Low-end buildup',
  action: 'Consider a small cut in the 60–250 Hz range, or a high-pass on channels that don’t need lows.',
  category: 'tonal',
  scope: 'mix',
  confidence: 0.9,
  severityDb: 2,
};

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    idealProfile: '', customIdealProfiles: [], storageDir: '', rigs: [], activeRigId: null,
    usageSignalEnabled: false, channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {},
    crashReportingEnabled: false, liveAdjustmentsEnabled: false,
    reportFirstUxEnabled: false, shareChurchName: '', weeklyReminderEnabled: false,
    weeklyReminderServiceDay: 0, liveEqPaneWidth: 360,
    measurementDeviceName: '', gradingProfile: 'casual', consoleNetworkConsentGranted: false,
    soundcheckBuses: [], splCalibrationOffsetDb: null,
    ...overrides,
  };
}

function settledLowEnd(): CoachingState {
  let state = liveAdjustments.createCoachingState();
  for (let count = 0; count < liveAdjustments.PERSISTENCE_WINDOWS; count++) {
    state = liveAdjustments.advanceCoaching(state, [LOW_END], NOW + count);
  }
  return state;
}

function renderMarkup(): string {
  return renderToString(createElement(LiveMixAlert));
}

afterEach(() => {
  useLiveCaptureStore.setState({ isCapturing: false, lapCoaching: null });
  useSettingsStore.setState({ settings: null });
  delete (globalThis as { window?: unknown }).window;
});

describe('liveMixAlertView (#1373)', () => {
  it('projects the settled overall-mix low-end candidate with its existing guidance', () => {
    const view = lowEndMixAlertView(true, true, liveAdjustments.coachingView(settledLowEnd(), NOW).candidate);

    expect(view).toEqual({ title: LOW_END.title, action: LOW_END.action });
  });

  it.each([
    ['capture is inactive', false, true, LOW_END],
    ['the experimental setting is absent', true, undefined, LOW_END],
    ['the experimental setting is not literally true', true, 'true', LOW_END],
    ['there is no active candidate', true, true, null],
    ['the active candidate is malformed', true, true, { id: 'low-end', scope: 'mix' }],
    ['the active candidate is unrelated', true, true, { ...LOW_END, id: 'harshness', title: 'Possible harshness', action: 'Consider a gentle cut in the 2–6 kHz range.' }],
    ['the active candidate is input-scoped low-end cleanup', true, true, { ...LOW_END, id: 'input-low-cleanup', scope: 'input' }],
  ])('returns null when %s', (_reason, isCapturing, enabled, candidate) => {
    expect(lowEndMixAlertView(isCapturing, enabled, candidate)).toBeNull();
  });

  it('stays absent for a pending low-end candidate, then appears only after reducer persistence settles it', () => {
    let state = liveAdjustments.createCoachingState();
    state = liveAdjustments.advanceCoaching(state, [LOW_END], NOW);
    expect(lowEndMixAlertView(true, true, liveAdjustments.coachingView(state, NOW).candidate)).toBeNull();

    for (let count = 1; count < liveAdjustments.PERSISTENCE_WINDOWS; count++) {
      state = liveAdjustments.advanceCoaching(state, [LOW_END], NOW + count);
    }
    expect(lowEndMixAlertView(true, true, liveAdjustments.coachingView(state, NOW).candidate)).toEqual({ title: LOW_END.title, action: LOW_END.action });
  });

  it('stays absent when the reducer has no qualifying candidate', () => {
    const state = liveAdjustments.advanceCoaching(liveAdjustments.createCoachingState(), [], NOW);

    expect(lowEndMixAlertView(true, true, liveAdjustments.coachingView(state, NOW).candidate)).toBeNull();
  });

  it('follows the reducer view through snooze, recovery, and cooldown', () => {
    let state = liveAdjustments.snoozeCoaching(settledLowEnd(), NOW);
    expect(lowEndMixAlertView(true, true, liveAdjustments.coachingView(state, NOW).candidate)).toBeNull();

    state = settledLowEnd();
    for (let count = 0; count < liveAdjustments.RECOVERY_WINDOWS; count++) {
      state = liveAdjustments.advanceCoaching(state, [], NOW + count);
    }
    expect(lowEndMixAlertView(true, true, liveAdjustments.coachingView(state, NOW + liveAdjustments.RECOVERY_WINDOWS).candidate)).toBeNull();
    expect(state.cooldowns['low-end']).toBeDefined();
  });
});

describe('LiveMixAlert (#1373)', () => {
  it('renders a semantic top-of-app alert from the current store state', () => {
    const state = settledLowEnd();
    useLiveCaptureStore.setState({ isCapturing: true, lapCoaching: state });
    useSettingsStore.setState({ settings: settings({ liveAdjustmentsEnabled: true }) });
    (globalThis as { window?: unknown }).window = { liveAdjustmentsState: liveAdjustments };

    const html = renderMarkup();
    expect(html).toContain('role="alert"');
    expect(html).toContain('id="live-mix-alert"');
    expect(html).toContain(LOW_END.title);
    expect(html).toContain('60–250 Hz range');
    expect(html).toContain('high-pass on channels');
  });

  it('renders no markup when the existing coaching view is no longer visible', () => {
    useLiveCaptureStore.setState({ isCapturing: true, lapCoaching: settledLowEnd() });
    useSettingsStore.setState({ settings: settings({ liveAdjustmentsEnabled: true }) });
    (globalThis as { window?: unknown }).window = {
      liveAdjustmentsState: { isEnabled: () => true, coachingView: () => ({ candidate: null }) },
    };

    expect(renderMarkup()).toBe('');
  });
});
