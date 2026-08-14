// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { liveLevelReadout } from './live-level-readout';
import type { LiveMeterSnapshot } from './live-meter-controller';
import type { ChannelWindowData, LiveEvent } from './live-capture-panel';

function makeChannel(overrides: Partial<ChannelWindowData> = {}): ChannelWindowData {
  return {
    index: 0,
    name: 'Ch 1',
    bands: { mid: -12 },
    rms: -18,
    peak: -6,
    clipping: false,
    centroid: 2400,
    rolloff: 15000,
    ...overrides,
  };
}

function makeTick(channels: ChannelWindowData[]): LiveEvent {
  return { type: 'meter', ts: 1, channels } as unknown as LiveEvent;
}

function makeSnapshot(overrides: Partial<LiveMeterSnapshot> = {}): LiveMeterSnapshot {
  return {
    lastTick: null,
    isCapturing: false,
    measurementSource: null,
    lastMeasurementChannels: null,
    secondaryActive: false,
    ...overrides,
  };
}

describe('liveLevelReadout (#767)', () => {
  it('is hidden when neither a board capture nor the secondary device is active — even with a stale lastTick', () => {
    const view = liveLevelReadout(makeSnapshot({ lastTick: makeTick([makeChannel()]) }));
    expect(view.visible).toBe(false);
  });

  it('is visible with no-data copy when capturing before the first tick arrives', () => {
    const view = liveLevelReadout(makeSnapshot({ isCapturing: true }));
    expect(view.visible).toBe(true);
    expect(view.rmsText).toBe('—');
    expect(view.peakText).toBe('pk —');
    expect(view.color).toBe('var(--meter-idle)');
    expect(view.clipping).toBe(false);
  });

  it('reads the measurement-source strip via measurementChannel, falling back to channel 0 when the source is null', () => {
    const channels = [makeChannel({ name: 'Vocals' }), makeChannel({ name: 'Band', rms: -30, peak: -12 })];
    const view = liveLevelReadout(makeSnapshot({ isCapturing: true, measurementSource: null, lastTick: makeTick(channels) }));
    expect(view.rmsText).toBe('-18.0');
    expect(view.peakText).toBe('pk -6.0');
  });

  it('reads the selected measurement source strip', () => {
    const channels = [makeChannel({ name: 'Vocals' }), makeChannel({ name: 'Band', rms: -30, peak: -12 })];
    const view = liveLevelReadout(makeSnapshot({ isCapturing: true, measurementSource: 1, lastTick: makeTick(channels) }));
    expect(view.rmsText).toBe('-30.0');
    expect(view.peakText).toBe('pk -12.0');
  });

  it('falls back to channel 0 when the measurement source is out of range (measurementChannel contract)', () => {
    const channels = [makeChannel({ name: 'Vocals' }), makeChannel({ name: 'Band' })];
    const view = liveLevelReadout(makeSnapshot({ isCapturing: true, measurementSource: 5, lastTick: makeTick(channels) }));
    expect(view.rmsText).toBe('-18.0');
  });

  it('owns the readout from the secondary device channel 0 when active, even alongside a board tick (ADR-0003)', () => {
    const board = [makeChannel({ name: 'Vocals', rms: -8, peak: -2 })];
    const measurement = [makeChannel({ name: 'Room mic', rms: -24, peak: -10 })];
    const view = liveLevelReadout(
      makeSnapshot({
        isCapturing: true,
        secondaryActive: true,
        lastTick: makeTick(board),
        lastMeasurementChannels: measurement,
      }),
    );
    expect(view.rmsText).toBe('-24.0');
    expect(view.peakText).toBe('pk -10.0');
  });

  it('is visible with no-data copy when secondaryActive but no measurement channel has arrived yet', () => {
    const view = liveLevelReadout(makeSnapshot({ secondaryActive: true, lastMeasurementChannels: null }));
    expect(view.visible).toBe(true);
    expect(view.rmsText).toBe('—');
    expect(view.peakText).toBe('pk —');
  });

  it('formats rms/peak with the report-card fmt contract (1 decimal)', () => {
    const view = liveLevelReadout(
      makeSnapshot({ isCapturing: true, lastTick: makeTick([makeChannel({ rms: -18, peak: -6 })]) }),
    );
    expect(view.rmsText).toBe('-18.0');
    expect(view.peakText).toBe('pk -6.0');
  });

  it('renders non-finite rms as -∞ (report-card parity)', () => {
    const view = liveLevelReadout(
      makeSnapshot({ isCapturing: true, lastTick: makeTick([makeChannel({ rms: Number.NaN, peak: -6 })]) }),
    );
    expect(view.rmsText).toBe('-∞');
  });

  it('maps rms to the report-card level color', () => {
    const read = (rms: number) =>
      liveLevelReadout(makeSnapshot({ isCapturing: true, lastTick: makeTick([makeChannel({ rms })]) })).color;
    expect(read(-18)).toBe('var(--meter-good)');
    expect(read(-30)).toBe('var(--meter-hot)');
    expect(read(-50)).toBe('var(--meter-idle)');
  });

  it('overrides the color to the issue color when the channel is clipping', () => {
    const view = liveLevelReadout(
      makeSnapshot({ isCapturing: true, lastTick: makeTick([makeChannel({ rms: -18, clipping: true })]) }),
    );
    expect(view.color).toBe('var(--issue-text)');
    expect(view.clipping).toBe(true);
  });
});
