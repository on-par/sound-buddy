// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { recordPayload, formatRecordElapsed, analyzeRecordView, ANALYZE_RECORD_LABEL } from './analyze-record';
import { captureOptsFromCadence } from './measurement-device-state';
import type { AnalyzeRecordState } from './stores/analyzeRecordStore';

describe('recordPayload (#1636)', () => {
  it('builds a mono record-mode StartLiveOpts for the given device/channel/cadence', () => {
    const cadence = { windowSecs: 3, meterIntervalMs: 100 };
    const opts = recordPayload('2', 1, cadence);

    expect(opts.mode).toBe('record');
    expect(opts.device).toBe('2');
    expect(opts.channels).toEqual(['1']);
    expect(opts.arm).toEqual(['1']);
    expect(opts.labels).toEqual([ANALYZE_RECORD_LABEL]);
    const expectedCadence = captureOptsFromCadence(cadence.windowSecs, cadence.meterIntervalMs);
    expect(opts.windowSecs).toBe(expectedCadence.windowSecs);
    expect(opts.intervalSecs).toBe(expectedCadence.intervalSecs);
  });

  it('stringifies a 0 channel and a multi-digit channel the same way', () => {
    expect(recordPayload('0', 0, { windowSecs: 3, meterIntervalMs: 100 }).channels).toEqual(['0']);
    expect(recordPayload('0', 12, { windowSecs: 3, meterIntervalMs: 100 }).channels).toEqual(['12']);
  });
});

describe('formatRecordElapsed (#1636)', () => {
  it('formats whole seconds as M:SS', () => {
    expect(formatRecordElapsed(0)).toBe('0:00');
    expect(formatRecordElapsed(61_500)).toBe('1:01');
    expect(formatRecordElapsed(600_000)).toBe('10:00');
  });

  it('floors non-finite or negative input to 0:00', () => {
    expect(formatRecordElapsed(NaN)).toBe('0:00');
    expect(formatRecordElapsed(-5000)).toBe('0:00');
  });
});

describe('analyzeRecordView (#1636)', () => {
  const base: Pick<AnalyzeRecordState, 'phase' | 'startedAt' | 'lastSessionDir' | 'error'> = {
    phase: 'idle', startedAt: null, lastSessionDir: null, error: null,
  };

  it('idle: Record, enabled, not recording, no status', () => {
    const view = analyzeRecordView(base, 1000);
    expect(view).toMatchObject({ buttonLabel: 'Record', disabled: false, recording: false, statusText: null, sessionDir: null, error: null });
  });

  it('starting: Starting…, disabled', () => {
    const view = analyzeRecordView({ ...base, phase: 'starting' }, 1000);
    expect(view.buttonLabel).toBe('Starting…');
    expect(view.disabled).toBe(true);
    expect(view.recording).toBe(false);
  });

  it('recording: Stop recording, recording true, elapsed status text', () => {
    const view = analyzeRecordView({ ...base, phase: 'recording', startedAt: 1000 }, 43_000);
    expect(view.buttonLabel).toBe('Stop recording');
    expect(view.recording).toBe(true);
    expect(view.disabled).toBe(false);
    expect(view.statusText).toBe('Recording · 0:42');
  });

  it('stopping: Stopping…, disabled, still recording, Finishing file… status', () => {
    const view = analyzeRecordView({ ...base, phase: 'stopping', startedAt: 1000 }, 2000);
    expect(view.buttonLabel).toBe('Stopping…');
    expect(view.disabled).toBe(true);
    expect(view.recording).toBe(true);
    expect(view.statusText).toBe('Finishing file…');
  });

  it('exposes lastSessionDir as sessionDir only when idle', () => {
    const idleWithDir = analyzeRecordView({ ...base, lastSessionDir: '/tmp/x' }, 1000);
    expect(idleWithDir.sessionDir).toBe('/tmp/x');

    const recordingWithDir = analyzeRecordView({ ...base, phase: 'recording', startedAt: 1000, lastSessionDir: '/tmp/x' }, 1000);
    expect(recordingWithDir.sessionDir).toBeNull();
  });

  it('passes error through unchanged', () => {
    const view = analyzeRecordView({ ...base, error: 'boom' }, 1000);
    expect(view.error).toBe('boom');
  });
});
