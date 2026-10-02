// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure helpers for Analyze's record-to-file control (#1636): the
// start-live-record payload for the room-mic listen channel, and the view
// model AnalyzeRecordControl.tsx renders from analyzeRecordStore's phase.
// See the #1636 ADR for why this reuses start-live's record mode directly
// instead of Session's capture-lifecycle/recordCapture path.

import type { StartLiveOpts } from '../../electron/ipc/api';
import { captureOptsFromCadence } from './measurement-device-state';
import { renderStableElapsedMs } from './recording-elapsed';
import type { AnalyzeRecordState } from './stores/analyzeRecordStore';

export const ANALYZE_RECORD_LABEL = 'Room';

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

export function recordPayload(
  device: string,
  channel: number,
  cadence: { windowSecs: number; meterIntervalMs: number }
): StartLiveOpts {
  const { windowSecs, intervalSecs } = captureOptsFromCadence(cadence.windowSecs, cadence.meterIntervalMs);
  const token = String(channel);
  return {
    device,
    channels: [token],
    windowSecs,
    intervalSecs,
    mode: 'record',
    arm: [token],
    labels: [ANALYZE_RECORD_LABEL],
  };
}

export function formatRecordElapsed(elapsedMs: number): string {
  const stableMs = renderStableElapsedMs(elapsedMs);
  const totalSecs = Math.floor(stableMs / MS_PER_SECOND);
  const mins = Math.floor(totalSecs / SECONDS_PER_MINUTE);
  const secs = totalSecs % SECONDS_PER_MINUTE;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export interface AnalyzeRecordViewModel {
  buttonLabel: string;
  disabled: boolean;
  recording: boolean;
  statusText: string | null;
  sessionDir: string | null;
  error: string | null;
}

export function analyzeRecordView(
  state: Pick<AnalyzeRecordState, 'phase' | 'startedAt' | 'lastSessionDir' | 'error'>,
  nowMs: number
): AnalyzeRecordViewModel {
  const { phase, startedAt, lastSessionDir, error } = state;
  const base = { sessionDir: phase === 'idle' ? lastSessionDir : null, error };

  if (phase === 'starting') {
    return { ...base, buttonLabel: 'Starting…', disabled: true, recording: false, statusText: null };
  }
  if (phase === 'recording') {
    const elapsed = startedAt === null ? 0 : nowMs - startedAt;
    return { ...base, buttonLabel: 'Stop recording', disabled: false, recording: true, statusText: `Recording · ${formatRecordElapsed(elapsed)}` };
  }
  if (phase === 'stopping') {
    return { ...base, buttonLabel: 'Stopping…', disabled: true, recording: true, statusText: 'Finishing file…' };
  }
  return { ...base, buttonLabel: 'Record', disabled: false, recording: false, statusText: null };
}
