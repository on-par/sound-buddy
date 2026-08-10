// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { decideLiveAutoStart } from './live-auto-start';

describe('decideLiveAutoStart', () => {
  it('skips when a capture is already running', () => {
    expect(decideLiveAutoStart({ isCapturing: true, activeRigId: 'rig-1', deviceHint: null }))
      .toEqual({ type: 'skip', reason: 'already-monitoring' });
  });

  it('skips when the device hint is a blocking error', () => {
    expect(decideLiveAutoStart({
      isCapturing: false,
      activeRigId: 'rig-1',
      deviceHint: { text: 'Mic access denied', isError: true },
    })).toEqual({ type: 'skip', reason: 'device-blocked' });
  });

  it('skips when no rig is active', () => {
    expect(decideLiveAutoStart({ isCapturing: false, activeRigId: null, deviceHint: null }))
      .toEqual({ type: 'skip', reason: 'no-last-used-device' });
  });

  it('starts when not capturing, a rig is active, and there is no device hint', () => {
    expect(decideLiveAutoStart({ isCapturing: false, activeRigId: 'rig-1', deviceHint: null }))
      .toEqual({ type: 'start' });
  });

  it('starts even with a non-error device hint', () => {
    expect(decideLiveAutoStart({
      isCapturing: false,
      activeRigId: 'rig-1',
      deviceHint: { text: 'macOS will ask for microphone permission', isError: false },
    })).toEqual({ type: 'start' });
  });
});
