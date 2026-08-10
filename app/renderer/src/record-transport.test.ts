// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { recordButtonPhase, recordButtonView, recordButtonAction, type RecordButtonInput } from './record-transport';

function input(overrides: Partial<RecordButtonInput> = {}): RecordButtonInput {
  return {
    liveRunning: false,
    liveMode: 'monitor',
    promoting: false,
    stopping: false,
    ...overrides,
  };
}

describe('recordButtonPhase', () => {
  it('is idle when nothing is running', () => {
    expect(recordButtonPhase(input())).toBe('idle');
  });

  it('is idle while monitoring (liveRunning, mode monitor)', () => {
    expect(recordButtonPhase(input({ liveRunning: true, liveMode: 'monitor' }))).toBe('idle');
  });

  it('is starting while promoting, regardless of liveRunning/liveMode', () => {
    expect(recordButtonPhase(input({ promoting: true }))).toBe('starting');
    expect(recordButtonPhase(input({ liveRunning: true, liveMode: 'record', promoting: true }))).toBe('starting');
  });

  it('is recording when liveRunning and mode is record', () => {
    expect(recordButtonPhase(input({ liveRunning: true, liveMode: 'record' }))).toBe('recording');
  });

  it('is stopping when the stopping flag is set, taking priority over every other flag', () => {
    expect(recordButtonPhase(input({ stopping: true }))).toBe('stopping');
    expect(recordButtonPhase(input({ stopping: true, promoting: true }))).toBe('stopping');
    expect(recordButtonPhase(input({ stopping: true, liveRunning: true, liveMode: 'record' }))).toBe('stopping');
  });
});

describe('recordButtonView', () => {
  it('idle-disabled: no monitor running', () => {
    const view = recordButtonView(input());
    expect(view).toEqual({
      phase: 'idle',
      disabled: true,
      label: 'Record',
      ariaLabel: 'Recording unavailable — monitoring is not active',
    });
  });

  it('idle-enabled: monitoring, ready to record', () => {
    const view = recordButtonView(input({ liveRunning: true, liveMode: 'monitor' }));
    expect(view).toEqual({
      phase: 'idle',
      disabled: false,
      label: 'Record',
      ariaLabel: 'Start recording',
    });
  });

  it('starting: promoting the monitor session', () => {
    const view = recordButtonView(input({ liveRunning: true, promoting: true }));
    expect(view).toEqual({
      phase: 'starting',
      disabled: true,
      label: 'Starting…',
      ariaLabel: 'Starting recording',
    });
  });

  it('recording: liveRunning and mode is record', () => {
    const view = recordButtonView(input({ liveRunning: true, liveMode: 'record' }));
    expect(view).toEqual({
      phase: 'recording',
      disabled: false,
      label: 'Recording',
      ariaLabel: 'Recording — press to stop',
    });
  });

  it('stopping: the transient stopping flag', () => {
    const view = recordButtonView(input({ liveRunning: true, liveMode: 'record', stopping: true }));
    expect(view).toEqual({
      phase: 'stopping',
      disabled: true,
      label: 'Stopping…',
      ariaLabel: 'Stopping recording',
    });
  });
});

describe('recordButtonAction', () => {
  it('returns null whenever disabled, regardless of phase', () => {
    expect(recordButtonAction('idle', true)).toBeNull();
    expect(recordButtonAction('starting', true)).toBeNull();
    expect(recordButtonAction('recording', true)).toBeNull();
    expect(recordButtonAction('stopping', true)).toBeNull();
  });

  it('returns promote for idle when enabled', () => {
    expect(recordButtonAction('idle', false)).toBe('promote');
  });

  it('returns stop for recording when enabled', () => {
    expect(recordButtonAction('recording', false)).toBe('stop');
  });

  it('returns null for starting/stopping even when enabled (not a real reachable state, but no action either way)', () => {
    expect(recordButtonAction('starting', false)).toBeNull();
    expect(recordButtonAction('stopping', false)).toBeNull();
  });
});
