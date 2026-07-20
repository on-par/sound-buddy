// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';

// live-transition-state is a plain classic script (window.liveTransitionState in
// the browser, module.exports under Node), mirroring live-setup-state.js.
const {
  capturePhase,
  captureIndicator,
  recordButtonView,
  statusLabel,
  canPromoteToRecording,
} = require('./live-transition-state.js') as {
  capturePhase: (view: { liveRunning: boolean; liveMode: string; promoting: boolean }) => string;
  captureIndicator: (phase: string) => { text: string; recording: boolean };
  recordButtonView: (phase: string) => { visible: boolean; disabled: boolean; label: string };
  statusLabel: (phase: string, meterRate: number) => string;
  canPromoteToRecording: (view: {
    liveRunning: boolean;
    liveMode: string;
    promoting: boolean;
    armedCount: number;
  }) => { ok: boolean; reason: string | null };
};

describe('capturePhase', () => {
  it('is idle when not running', () => {
    expect(capturePhase({ liveRunning: false, liveMode: 'monitor', promoting: false })).toBe('idle');
  });
  it('is idle when not running even if promoting/record are set (liveRunning wins)', () => {
    expect(capturePhase({ liveRunning: false, liveMode: 'record', promoting: true })).toBe('idle');
  });
  it('is starting-record when promoting, regardless of liveMode', () => {
    expect(capturePhase({ liveRunning: true, liveMode: 'monitor', promoting: true })).toBe('starting-record');
  });
  it('is recording when liveMode is record and not promoting', () => {
    expect(capturePhase({ liveRunning: true, liveMode: 'record', promoting: false })).toBe('recording');
  });
  it('is monitoring when liveMode is monitor and not promoting', () => {
    expect(capturePhase({ liveRunning: true, liveMode: 'monitor', promoting: false })).toBe('monitoring');
  });
});

describe('captureIndicator', () => {
  it('shows REC/recording:true for recording', () => {
    expect(captureIndicator('recording')).toEqual({ text: 'REC', recording: true });
  });
  it('shows REC/recording:true for starting-record', () => {
    expect(captureIndicator('starting-record')).toEqual({ text: 'REC', recording: true });
  });
  it('shows LIVE/recording:false for monitoring', () => {
    expect(captureIndicator('monitoring')).toEqual({ text: 'LIVE', recording: false });
  });
  it('shows empty/recording:false for idle', () => {
    expect(captureIndicator('idle')).toEqual({ text: '', recording: false });
  });
});

describe('recordButtonView', () => {
  it('is visible and enabled only while monitoring', () => {
    expect(recordButtonView('monitoring')).toEqual({ visible: true, disabled: false, label: 'Start Recording' });
  });
  it('is visible but disabled with a "Starting…" label during starting-record', () => {
    expect(recordButtonView('starting-record')).toEqual({ visible: true, disabled: true, label: 'Starting…' });
  });
  it('is hidden while idle', () => {
    const view = recordButtonView('idle');
    expect(view.visible).toBe(false);
    expect(view.disabled).toBe(true);
  });
  it('is hidden while already recording', () => {
    const view = recordButtonView('recording');
    expect(view.visible).toBe(false);
    expect(view.disabled).toBe(true);
  });
});

describe('statusLabel', () => {
  it('reports the meter rate while recording', () => {
    expect(statusLabel('recording', 10)).toBe('Recording · meters 10/s');
  });
  it('reports "Starting recording…" during starting-record (no rate)', () => {
    expect(statusLabel('starting-record', 10)).toBe('Starting recording…');
  });
  it('reports the meter rate while monitoring', () => {
    expect(statusLabel('monitoring', 5)).toBe('Monitoring · meters 5/s');
  });
  it('is empty while idle', () => {
    expect(statusLabel('idle', 5)).toBe('');
  });
});

describe('canPromoteToRecording', () => {
  it('is ok only when monitoring with at least one armed strip', () => {
    expect(canPromoteToRecording({ liveRunning: true, liveMode: 'monitor', promoting: false, armedCount: 1 }))
      .toEqual({ ok: true, reason: null });
  });
  it('refuses with an actionable reason when monitoring but nothing is armed', () => {
    expect(canPromoteToRecording({ liveRunning: true, liveMode: 'monitor', promoting: false, armedCount: 0 }))
      .toEqual({ ok: false, reason: 'Arm at least one strip to record.' });
  });
  it('refuses with the not-monitoring reason when idle', () => {
    expect(canPromoteToRecording({ liveRunning: false, liveMode: 'monitor', promoting: false, armedCount: 3 }))
      .toEqual({ ok: false, reason: 'Recording can only start from an active monitor session.' });
  });
  it('refuses with the not-monitoring reason when already recording', () => {
    expect(canPromoteToRecording({ liveRunning: true, liveMode: 'record', promoting: false, armedCount: 3 }))
      .toEqual({ ok: false, reason: 'Recording can only start from an active monitor session.' });
  });
  it('refuses with the not-monitoring reason while already promoting', () => {
    expect(canPromoteToRecording({ liveRunning: true, liveMode: 'monitor', promoting: true, armedCount: 3 }))
      .toEqual({ ok: false, reason: 'Recording can only start from an active monitor session.' });
  });
});
