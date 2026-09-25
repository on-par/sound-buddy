// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { analyzeLiveEqView } from './analyze-live-eq';
import type { SecondaryMeasurementState } from './measurement-device-state';
import type { EqPaneRoomOverride, LiveMeterChannel } from './live-capture-panel';

const CH: LiveMeterChannel = {
  name: 'Room', rms: -30, peak: -12, clipping: false, centroid: 1000,
  bands: { sub_bass: -40, bass: -34, low_mid: -28, mid: -24, high_mid: -32, presence: -44, brilliance: -60 },
};
const OVERRIDE: EqPaneRoomOverride = { ch: CH, label: 'MacBook Pro Microphone' };

function secondary(status: SecondaryMeasurementState['status'], overrides: Partial<SecondaryMeasurementState> = {}): SecondaryMeasurementState {
  return { status, deviceName: 'MacBook Pro Microphone', ...overrides };
}

describe('analyzeLiveEqView (#1469, lc-06)', () => {
  it('is hidden when neither listening nor the stage is open, even with an active + overridden secondary source', () => {
    expect(analyzeLiveEqView({ listening: false, analyzeStage: false, appMode: 'reportcard', secondary: secondary('active'), override: OVERRIDE }))
      .toEqual({ kind: 'hidden' });
  });

  it('is hidden while the Session (live) workspace is active, even while listening (AC2)', () => {
    expect(analyzeLiveEqView({ listening: true, analyzeStage: true, appMode: 'live', secondary: secondary('active'), override: OVERRIDE }))
      .toEqual({ kind: 'hidden' });
  });

  it('is hidden on the Session (live) workspace even with the stage open and not listening', () => {
    expect(analyzeLiveEqView({ listening: false, analyzeStage: true, appMode: 'live', secondary: secondary('off'), override: null }))
      .toEqual({ kind: 'hidden' });
  });

  it('renders room when listening, active, and an override is present', () => {
    expect(analyzeLiveEqView({ listening: true, analyzeStage: true, appMode: 'reportcard', secondary: secondary('active'), override: OVERRIDE }))
      .toEqual({ kind: 'room', override: OVERRIDE });
  });

  it('renders a notice — not room — when active but no override data has arrived yet', () => {
    const view = analyzeLiveEqView({ listening: true, analyzeStage: true, appMode: 'reportcard', secondary: secondary('active'), override: null });
    expect(view.kind).toBe('notice');
  });

  it('renders a notice honestly reflecting DISCONNECTED rather than freezing on the last override (AC3)', () => {
    const view = analyzeLiveEqView({
      listening: true, analyzeStage: true, appMode: 'reportcard',
      secondary: secondary('disconnected'), override: OVERRIDE,
    });
    expect(view).toEqual({ kind: 'notice', text: expect.stringContaining('disconnected') });
  });

  it('renders a notice while starting', () => {
    const view = analyzeLiveEqView({ listening: true, analyzeStage: true, appMode: 'reportcard', secondary: secondary('starting'), override: null });
    expect(view).toEqual({ kind: 'notice', text: expect.stringContaining('Starting') });
  });

  it('renders a notice when blocked', () => {
    const view = analyzeLiveEqView({ listening: true, analyzeStage: true, appMode: 'reportcard', secondary: secondary('blocked'), override: null });
    expect(view).toEqual({ kind: 'notice', text: expect.stringContaining('blocked') });
  });

  it('never reaches room from a status other than active, even with a stale override object (AC3, structural)', () => {
    const statuses: SecondaryMeasurementState['status'][] = ['off', 'starting', 'blocked', 'disconnected'];
    for (const status of statuses) {
      const view = analyzeLiveEqView({ listening: true, analyzeStage: true, appMode: 'reportcard', secondary: secondary(status), override: OVERRIDE });
      expect(view.kind).not.toBe('room');
    }
  });

  // #1487: the stage stays open (analyzeStage) after a listen stops — e.g. the
  // user picked "Load file…" — so the island keeps rendering (an idle notice,
  // never the last-seen room curve) instead of the whole stage vanishing.
  describe('analyzeStage (#1487)', () => {
    it('stays visible with an idle notice once listening has stopped but the stage is still open', () => {
      const view = analyzeLiveEqView({ listening: false, analyzeStage: true, appMode: 'reportcard', secondary: secondary('off'), override: null });
      expect(view).toEqual({ kind: 'notice', text: expect.stringContaining('Not listening') });
    });

    it('never reaches room from analyzeStage alone — room still requires listening', () => {
      const view = analyzeLiveEqView({ listening: false, analyzeStage: true, appMode: 'reportcard', secondary: secondary('active'), override: OVERRIDE });
      expect(view.kind).toBe('notice');
    });

    it('is hidden once both listening and the stage have closed', () => {
      expect(analyzeLiveEqView({ listening: false, analyzeStage: false, appMode: 'reportcard', secondary: secondary('off'), override: null }))
        .toEqual({ kind: 'hidden' });
    });
  });
});
