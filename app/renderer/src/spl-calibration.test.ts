// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  SPL_METER_MIN_DB,
  SPL_METER_MAX_DB,
  computeSplOffsetDb,
  splFromDbfs,
  levelDisplay,
  roomLevelChannel,
  splOffsetFromSnapshot,
  splCalibrationRowView,
} from './spl-calibration';
import type { LiveMeterChannel, LiveEvent, ChannelWindowData } from './live-capture-panel';
import type { LiveMeterSnapshot } from './live-meter-controller';

function ch(rms: number, peak = rms): LiveMeterChannel {
  return { bands: {}, rms, peak };
}

function tickWith(...channels: LiveMeterChannel[]): LiveEvent {
  return { channels } as unknown as LiveEvent;
}

function measurementChannels(...channels: LiveMeterChannel[]): ChannelWindowData[] {
  return channels as unknown as ChannelWindowData[];
}

describe('computeSplOffsetDb', () => {
  it('pins the sign: offset = meterSPL - appdBFS', () => {
    expect(computeSplOffsetDb(88, -23.4)).toBeCloseTo(111.4, 9);
  });

  it('handles a negative-going case', () => {
    expect(computeSplOffsetDb(30, -10)).toBeCloseTo(40, 9);
  });

  it('rounds to 0.1 dB resolution', () => {
    expect(computeSplOffsetDb(85, -23.44)).toBeCloseTo(108.4, 9);
  });

  it('returns null for a meter value below SPL_METER_MIN_DB', () => {
    expect(computeSplOffsetDb(SPL_METER_MIN_DB - 0.1, -23.4)).toBeNull();
  });

  it('returns null for a meter value above SPL_METER_MAX_DB', () => {
    expect(computeSplOffsetDb(SPL_METER_MAX_DB + 0.1, -23.4)).toBeNull();
  });

  it('returns null for a NaN meter value', () => {
    expect(computeSplOffsetDb(NaN, -23.4)).toBeNull();
  });

  it('returns null for a non-finite appDbfs (the idle reading)', () => {
    expect(computeSplOffsetDb(88, -Infinity)).toBeNull();
  });
});

describe('splFromDbfs', () => {
  it('round-trips against computeSplOffsetDb', () => {
    const offset = computeSplOffsetDb(88, -23.4);
    expect(splFromDbfs(-23.4, offset)).toBeCloseTo(88, 9);
  });

  it('returns null for a null offset', () => {
    expect(splFromDbfs(-23.4, null)).toBeNull();
  });

  it('returns null for an undefined offset', () => {
    expect(splFromDbfs(-23.4, undefined)).toBeNull();
  });

  it('returns null for a non-finite dbfs', () => {
    expect(splFromDbfs(-Infinity, 111.4)).toBeNull();
  });
});

describe('levelDisplay', () => {
  it('uncalibrated returns the raw dBFS value and unit', () => {
    expect(levelDisplay(-23.4, null)).toEqual({ value: '-23.4', unit: 'dBFS' });
  });

  it('calibrated returns the converted SPL value and unit', () => {
    expect(levelDisplay(-23.4, 111.4)).toEqual({ value: '88.0', unit: 'dB SPL' });
  });

  it('calibrated with a non-finite reading returns the no-data marker', () => {
    expect(levelDisplay(-Infinity, 111.4)).toEqual({ value: '—', unit: 'dB SPL' });
  });

  it('uncalibrated with a non-finite reading matches the #767 fallback byte-for-byte', () => {
    expect(levelDisplay(-Infinity, null)).toEqual({ value: '-∞', unit: 'dBFS' });
  });
});

describe('roomLevelChannel', () => {
  it('secondary active returns lastMeasurementChannels[0]', () => {
    const secondaryCh = ch(-10);
    const snap: LiveMeterSnapshot = {
      lastTick: null,
      isCapturing: true,
      measurementSource: null,
      lastMeasurementChannels: measurementChannels(secondaryCh),
      secondaryActive: true,
    };
    expect(roomLevelChannel(snap)).toBe(secondaryCh);
  });

  it('secondary active with an empty list returns null', () => {
    const snap: LiveMeterSnapshot = {
      lastTick: null,
      isCapturing: true,
      measurementSource: null,
      lastMeasurementChannels: [],
      secondaryActive: true,
    };
    expect(roomLevelChannel(snap)).toBeNull();
  });

  it('secondary inactive returns the measurementSource strip', () => {
    const c0 = ch(-40);
    const c1 = ch(-10);
    const snap: LiveMeterSnapshot = {
      lastTick: tickWith(c0, c1),
      isCapturing: true,
      measurementSource: 1,
      lastMeasurementChannels: null,
      secondaryActive: false,
    };
    expect(roomLevelChannel(snap)).toBe(c1);
  });

  it('secondary inactive with measurementSource out of range falls back to channel 0', () => {
    const c0 = ch(-40);
    const snap: LiveMeterSnapshot = {
      lastTick: tickWith(c0),
      isCapturing: true,
      measurementSource: 5,
      lastMeasurementChannels: null,
      secondaryActive: false,
    };
    expect(roomLevelChannel(snap)).toBe(c0);
  });

  it('no tick returns null', () => {
    const snap: LiveMeterSnapshot = {
      lastTick: null,
      isCapturing: false,
      measurementSource: null,
      lastMeasurementChannels: null,
      secondaryActive: false,
    };
    expect(roomLevelChannel(snap)).toBeNull();
  });
});

describe('splOffsetFromSnapshot', () => {
  function snapshotWithRoom(rms: number): LiveMeterSnapshot {
    return {
      lastTick: tickWith(ch(rms)),
      isCapturing: true,
      measurementSource: 0,
      lastMeasurementChannels: null,
      secondaryActive: false,
    };
  }

  it('happy path returns the computed offset', () => {
    expect(splOffsetFromSnapshot(snapshotWithRoom(-23.4), '88')).toBeCloseTo(111.4, 9);
  });

  it('returns null for unparseable meter text', () => {
    expect(splOffsetFromSnapshot(snapshotWithRoom(-23.4), 'loud')).toBeNull();
  });

  it('returns null for out-of-range meter text', () => {
    expect(splOffsetFromSnapshot(snapshotWithRoom(-23.4), '999')).toBeNull();
  });

  it('returns null when the snapshot has no Room channel', () => {
    const snap: LiveMeterSnapshot = {
      lastTick: null,
      isCapturing: false,
      measurementSource: null,
      lastMeasurementChannels: null,
      secondaryActive: false,
    };
    expect(splOffsetFromSnapshot(snap, '88')).toBeNull();
  });

  it('calibrates against the secondary channel when secondary is active', () => {
    const secondaryCh = ch(-20);
    const snap: LiveMeterSnapshot = {
      lastTick: tickWith(ch(-40)),
      isCapturing: true,
      measurementSource: 0,
      lastMeasurementChannels: measurementChannels(secondaryCh),
      secondaryActive: true,
    };
    expect(splOffsetFromSnapshot(snap, '90')).toBeCloseTo(110, 9);
  });
});

describe('splCalibrationRowView', () => {
  it('null renders uncalibrated', () => {
    expect(splCalibrationRowView(null)).toEqual({ calibrated: false, offsetText: 'Not calibrated' });
  });

  it('a positive offset renders with a leading plus sign', () => {
    expect(splCalibrationRowView(111.4)).toEqual({ calibrated: true, offsetText: '+111.4 dB' });
  });

  it('a negative offset renders without a doubled sign', () => {
    expect(splCalibrationRowView(-5.2)).toEqual({ calibrated: true, offsetText: '-5.2 dB' });
  });

  it('undefined renders uncalibrated', () => {
    expect(splCalibrationRowView(undefined)).toEqual({ calibrated: false, offsetText: 'Not calibrated' });
  });
});
