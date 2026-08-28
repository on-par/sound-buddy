// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// SPL calibration (#846): the offset math (offset = meterSPL − appdBFS), the
// ADR-0003 Room-channel precedence lifted verbatim from the deleted
// live-level-readout.ts (#1114 removed the header readout, not the
// precedence), and the dBFS-vs-dB-SPL display formatter used by the live
// stats row and the Settings → Audio calibration panel. All pure — no DOM, no
// store access.

import { fmt } from './report-card';
import { measurementChannel, type LiveMeterChannel } from './live-capture-panel';
import type { LiveMeterSnapshot } from './live-meter-controller';

// Plausible handheld SPL-meter readings. Below 30 dB SPL is a quiet studio the
// app will never be calibrated in; above 150 dB SPL is past the pain threshold.
export const SPL_METER_MIN_DB = 30;
export const SPL_METER_MAX_DB = 150;

const NO_DATA = '—';
const DBFS_UNIT = 'dBFS';
const SPL_UNIT = 'dB SPL';

export interface LevelDisplay {
  /** Formatted number, or '—' when there is no usable reading. */
  value: string;
  /** 'dBFS' when uncalibrated, 'dB SPL' when calibrated. */
  unit: string;
}

export interface SplCalibrationRowView {
  calibrated: boolean;
  /** '+111.4 dB' when calibrated, 'Not calibrated' otherwise. */
  offsetText: string;
}

// offset = meterSPL − appdBFS, rounded to 0.1 dB (matching what a handheld
// meter displays). null when either input isn't usable for a calibration.
export function computeSplOffsetDb(meterSplDb: number, appDbfs: number): number | null {
  if (!Number.isFinite(meterSplDb) || meterSplDb < SPL_METER_MIN_DB || meterSplDb > SPL_METER_MAX_DB) return null;
  if (!Number.isFinite(appDbfs)) return null;
  return Math.round((meterSplDb - appDbfs) * 10) / 10;
}

export function splFromDbfs(dbfs: number, offsetDb: number | null | undefined): number | null {
  if (offsetDb == null || !Number.isFinite(dbfs)) return null;
  return dbfs + offsetDb;
}

export function levelDisplay(db: number, offsetDb: number | null | undefined): LevelDisplay {
  if (offsetDb == null) return { value: fmt(db), unit: DBFS_UNIT };
  const spl = splFromDbfs(db, offsetDb);
  return spl == null ? { value: NO_DATA, unit: SPL_UNIT } : { value: fmt(spl), unit: SPL_UNIT };
}

// The ADR-0003 Room-channel precedence, lifted verbatim from the deleted
// live-level-readout.ts (#1114): the secondary measurement device's channel 0
// when active, otherwise the measurement-source strip.
export function roomLevelChannel(snap: LiveMeterSnapshot): LiveMeterChannel | null {
  return snap.secondaryActive
    ? (snap.lastMeasurementChannels?.[0] ?? null)
    : measurementChannel(snap.lastTick?.channels, snap.measurementSource);
}

// Resolves the calibration offset a Calibrate click would persist: the
// meter's typed dB SPL text against the same Room channel the readout uses,
// so calibration and display always measure the same signal.
export function splOffsetFromSnapshot(snap: LiveMeterSnapshot, meterSplText: string): number | null {
  const parsed = parseFloat(meterSplText.trim());
  if (Number.isNaN(parsed)) return null;
  const ch = roomLevelChannel(snap);
  if (!ch) return null;
  return computeSplOffsetDb(parsed, ch.rms);
}

export function splCalibrationRowView(offsetDb: number | null | undefined): SplCalibrationRowView {
  const calibrated = typeof offsetDb === 'number' && Number.isFinite(offsetDb);
  return {
    calibrated,
    offsetText: calibrated ? `${offsetDb >= 0 ? '+' : ''}${fmt(offsetDb)} dB` : 'Not calibrated',
  };
}
