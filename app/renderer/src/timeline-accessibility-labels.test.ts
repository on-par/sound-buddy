// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { formatAccessibleTime, timelineAccessibilityLabels } from './timeline-accessibility-labels';
import { formatRulerElapsed } from './timeline-ruler-labels';

describe('formatAccessibleTime', () => {
  it('formats whole seconds as m:ss', () => {
    expect(formatAccessibleTime(0)).toBe('0:00');
    expect(formatAccessibleTime(5)).toBe('0:05');
    expect(formatAccessibleTime(65)).toBe('1:05');
    expect(formatAccessibleTime(600)).toBe('10:00');
  });

  it('resolves non-finite or non-positive input to 0:00', () => {
    expect(formatAccessibleTime(-3)).toBe('0:00');
    expect(formatAccessibleTime(NaN)).toBe('0:00');
    expect(formatAccessibleTime(Infinity)).toBe('0:00');
  });

  it('floors a fractional value', () => {
    expect(formatAccessibleTime(12.9)).toBe('0:12');
  });

  // ADR-0011 hand-duplication drift pattern: timeline-accessibility-labels.ts is a leaf
  // module (imports nothing) so it cannot import formatRulerElapsed (which reaches back
  // through timeline-scale.ts into daw-shell-runtime.ts, an ESM cycle). This pins the
  // hand-duplicated formatter to the original across a fixed fixture set.
  it('never drifts from formatRulerElapsed', () => {
    const fixtures = [0, 0.4, 5, 59, 60, 65, 125, 599.9, 3600, -1, NaN, Infinity];
    for (const t of fixtures) {
      expect(formatAccessibleTime(t)).toBe(formatRulerElapsed(t));
    }
  });
});

describe('timelineAccessibilityLabels', () => {
  it('produces distinct strings for the insert marker and playhead at different times', () => {
    const labels = timelineAccessibilityLabels({
      playheadSecs: 10,
      insertMarkerSecs: 20,
      selectedClipChannel: null,
      timeSelection: null,
    });
    expect(labels.insertMarker).toBe('Insert marker at 0:20');
    expect(labels.playhead).toBe('Playhead at 0:10');
    expect(labels.insertMarker).not.toBe(labels.playhead);
  });

  it('produces distinct strings for the insert marker and playhead even at the same second', () => {
    const labels = timelineAccessibilityLabels({
      playheadSecs: 15,
      insertMarkerSecs: 15,
      selectedClipChannel: null,
      timeSelection: null,
    });
    expect(labels.insertMarker).toBe('Insert marker at 0:15');
    expect(labels.playhead).toBe('Playhead at 0:15');
    expect(labels.insertMarker).not.toBe(labels.playhead);
  });

  describe('clip selection', () => {
    it('reads "No clip selected" when null', () => {
      expect(timelineAccessibilityLabels({
        playheadSecs: 0, insertMarkerSecs: 0, selectedClipChannel: null, timeSelection: null,
      }).clipSelection).toBe('No clip selected');
    });

    it('reads "Clip selected on channel N" for a non-negative integer channel', () => {
      expect(timelineAccessibilityLabels({
        playheadSecs: 0, insertMarkerSecs: 0, selectedClipChannel: 0, timeSelection: null,
      }).clipSelection).toBe('Clip selected on channel 0');
      expect(timelineAccessibilityLabels({
        playheadSecs: 0, insertMarkerSecs: 0, selectedClipChannel: 3, timeSelection: null,
      }).clipSelection).toBe('Clip selected on channel 3');
    });

    it('falls back to "No clip selected" for an invalid channel', () => {
      expect(timelineAccessibilityLabels({
        playheadSecs: 0, insertMarkerSecs: 0, selectedClipChannel: -1, timeSelection: null,
      }).clipSelection).toBe('No clip selected');
      expect(timelineAccessibilityLabels({
        playheadSecs: 0, insertMarkerSecs: 0, selectedClipChannel: 1.5, timeSelection: null,
      }).clipSelection).toBe('No clip selected');
    });
  });

  describe('time selection', () => {
    it('reads "No time selection" when null', () => {
      expect(timelineAccessibilityLabels({
        playheadSecs: 0, insertMarkerSecs: 0, selectedClipChannel: null, timeSelection: null,
      }).timeSelection).toBe('No time selection');
    });

    it('reads the formatted range when present', () => {
      expect(timelineAccessibilityLabels({
        playheadSecs: 0, insertMarkerSecs: 0, selectedClipChannel: null,
        timeSelection: { startSecs: 10, endSecs: 20 },
      }).timeSelection).toBe('Time selection from 0:10 to 0:20');
    });

    it('falls back to "No time selection" for a non-finite endpoint', () => {
      expect(timelineAccessibilityLabels({
        playheadSecs: 0, insertMarkerSecs: 0, selectedClipChannel: null,
        timeSelection: { startSecs: 10, endSecs: NaN },
      }).timeSelection).toBe('No time selection');
      expect(timelineAccessibilityLabels({
        playheadSecs: 0, insertMarkerSecs: 0, selectedClipChannel: null,
        timeSelection: { startSecs: Infinity, endSecs: 20 },
      }).timeSelection).toBe('No time selection');
    });
  });

  it('keeps the four fields independent: changing only insertMarkerSecs leaves the rest byte-identical', () => {
    const base = {
      playheadSecs: 5,
      insertMarkerSecs: 5,
      selectedClipChannel: 2,
      timeSelection: { startSecs: 1, endSecs: 2 },
    };
    const a = timelineAccessibilityLabels(base);
    const b = timelineAccessibilityLabels({ ...base, insertMarkerSecs: 99 });
    expect(b.insertMarker).not.toBe(a.insertMarker);
    expect(b.playhead).toBe(a.playhead);
    expect(b.clipSelection).toBe(a.clipSelection);
    expect(b.timeSelection).toBe(a.timeSelection);
  });
});
