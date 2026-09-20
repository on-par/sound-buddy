// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  lineCheckCaptureTarget,
  lineCheckCaptureControlView,
  averageCaptureCurve,
} from './line-check-capture-control';
import type { ChannelFlagMap } from './live-capture-panel';

describe('lineCheckCaptureTarget (#1467)', () => {
  it('is null when the flag is off, regardless of solo state', () => {
    const soloed: ChannelFlagMap = { 1: true };
    expect(lineCheckCaptureTarget(false, soloed)).toBeNull();
    expect(lineCheckCaptureTarget(false, {})).toBeNull();
  });

  it('is null when the flag is on but no channel is soloed', () => {
    expect(lineCheckCaptureTarget(true, {})).toBeNull();
  });

  it('is null when the flag is on but more than one channel is soloed (ambiguous)', () => {
    expect(lineCheckCaptureTarget(true, { 0: true, 1: true })).toBeNull();
  });

  it('is the sole soloed channel index when the flag is on and exactly one channel is soloed', () => {
    expect(lineCheckCaptureTarget(true, { 2: true })).toBe(2);
  });
});

describe('lineCheckCaptureControlView (#1467)', () => {
  const labelAt = (index: number) => `Strip ${index}`;

  it('is disabled with the idle hint when there is no target and no capture in progress', () => {
    const view = lineCheckCaptureControlView(null, false, labelAt);
    expect(view).toEqual({
      enabled: false,
      buttonLabel: 'Capture this channel',
      hint: 'Solo exactly one channel to enable capture.',
    });
  });

  it('is enabled with a ready hint naming the target when idle with an unambiguous target', () => {
    const view = lineCheckCaptureControlView(2, false, labelAt);
    expect(view).toEqual({
      enabled: true,
      buttonLabel: 'Capture this channel',
      hint: 'Ready to capture Strip 2.',
    });
  });

  it('is enabled with a "Stop capture" affordance and a capturing hint while capturing', () => {
    const view = lineCheckCaptureControlView(2, true, labelAt);
    expect(view).toEqual({
      enabled: true,
      buttonLabel: 'Stop capture',
      hint: 'Capturing Strip 2…',
    });
  });

  it('stays enabled to stop even if the solo state changes away from the target mid-capture', () => {
    const view = lineCheckCaptureControlView(null, true, labelAt);
    expect(view).toEqual({
      enabled: true,
      buttonLabel: 'Stop capture',
      hint: 'Capturing…',
    });
  });
});

describe('averageCaptureCurve (#1467)', () => {
  it('is null for an empty sample buffer', () => {
    expect(averageCaptureCurve([])).toBeNull();
  });

  it('returns the curve unchanged for a single sample', () => {
    const curve = { freqs: [100, 1000], db: [-20, -10] };
    const result = averageCaptureCurve([curve]);
    expect(result!.freqs).toEqual([100, 1000]);
    expect(result!.db[0]).toBeCloseTo(-20, 6);
    expect(result!.db[1]).toBeCloseTo(-10, 6);
  });

  it('reduces multiple samples per bin using a power-domain mean, not a plain dB average', () => {
    // Two samples at one bin: -20 dB and -10 dB. Power-domain mean:
    // 10*log10((10^-2 + 10^-1) / 2) ≈ -12.596 dB — above the -15 dB a plain
    // arithmetic mean would give, because power (not dB) is additive.
    const a = { freqs: [1000], db: [-20] };
    const b = { freqs: [1000], db: [-10] };
    const result = averageCaptureCurve([a, b]);
    expect(result!.db[0]).toBeCloseTo(-12.5964, 3);
  });

  it('skips non-finite values in the mean and floors a bin with no finite samples to silence', () => {
    const a = { freqs: [500], db: [NaN] };
    const b = { freqs: [500], db: [-Infinity] };
    expect(averageCaptureCurve([a, b])!.db[0]).toBe(-120);

    const c = { freqs: [500], db: [-6] };
    const withOneFinite = averageCaptureCurve([a, c]);
    expect(withOneFinite!.db[0]).toBeCloseTo(-6, 6);
  });
});
