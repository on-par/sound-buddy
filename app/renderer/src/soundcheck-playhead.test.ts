// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure geometry for the #736 real playhead: px position of the overlay line
// and the continuous seek time for a pointer on #sc-waveforms. Both delegate
// the fraction/clamp to the #695 spectrum-transport helpers (playheadPercent /
// seekTimeFromBarClick) and express the offset track-name column in px, since
// the soundcheck lanes start at the measured name width, not at x=0.

import { describe, it, expect } from 'vitest';
import { soundcheckPlayheadLeftPx, soundcheckSeekTargetFromClick } from './soundcheck-playhead';

describe('soundcheckPlayheadLeftPx', () => {
  it('returns null for a non-positive duration', () => {
    expect(soundcheckPlayheadLeftPx(1, 0, 60, 300)).toBeNull();
    expect(soundcheckPlayheadLeftPx(1, -5, 60, 300)).toBeNull();
  });

  it('returns null for a zero/negative name or canvas width', () => {
    expect(soundcheckPlayheadLeftPx(1, 10, 0, 300)).toBeNull();
    expect(soundcheckPlayheadLeftPx(1, 10, 60, 0)).toBeNull();
    expect(soundcheckPlayheadLeftPx(1, 10, -2, 300)).toBeNull();
    expect(soundcheckPlayheadLeftPx(1, 10, 60, -4)).toBeNull();
  });

  it('sits exactly at the name-column edge at elapsed 0', () => {
    expect(soundcheckPlayheadLeftPx(0, 10, 60, 300)).toBe(60);
  });

  it('sits at the right edge of the canvas when elapsed reaches duration', () => {
    expect(soundcheckPlayheadLeftPx(10, 10, 60, 300)).toBeCloseTo(360, 10);
  });

  it('is proportional at half duration', () => {
    expect(soundcheckPlayheadLeftPx(5, 10, 60, 300)).toBeCloseTo(60 + 150, 10);
  });

  it('clamps elapsed beyond duration to the right edge (playheadPercent clamps)', () => {
    expect(soundcheckPlayheadLeftPx(42, 10, 60, 300)).toBeCloseTo(360, 10);
  });

  it('clamps negative elapsed to the name-column edge', () => {
    expect(soundcheckPlayheadLeftPx(-3, 10, 60, 300)).toBe(60);
  });
});

describe('soundcheckSeekTargetFromClick', () => {
  it('returns null for non-positive geometry or duration', () => {
    expect(soundcheckSeekTargetFromClick(100, 0, 0, 300, 10)).toBeNull();
    expect(soundcheckSeekTargetFromClick(100, 0, 60, 0, 10)).toBeNull();
    expect(soundcheckSeekTargetFromClick(100, 0, 60, 300, 0)).toBeNull();
    expect(soundcheckSeekTargetFromClick(100, 0, 60, 300, -1)).toBeNull();
  });

  it('returns null when the pointer lands on the track-name column', () => {
    // name column spans [containerLeft, containerLeft + nameWidthPx)
    expect(soundcheckSeekTargetFromClick(50, 0, 60, 300, 10)).toBeNull();
    expect(soundcheckSeekTargetFromClick(59, 0, 60, 300, 10)).toBeNull();
  });

  it('maps the canvas left edge to 0 seconds', () => {
    expect(soundcheckSeekTargetFromClick(60, 0, 60, 300, 10)).toBe(0);
  });

  it('maps the canvas right edge to the full duration', () => {
    expect(soundcheckSeekTargetFromClick(360, 0, 60, 300, 10)).toBeCloseTo(10, 10);
  });

  it('maps the canvas middle to half the duration', () => {
    expect(soundcheckSeekTargetFromClick(60 + 150, 0, 60, 300, 10)).toBeCloseTo(5, 10);
  });

  it('clamps a click past the right edge to the full duration', () => {
    expect(soundcheckSeekTargetFromClick(999, 0, 60, 300, 10)).toBeCloseTo(10, 10);
  });
});
