// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Measurement-source quality & calibration hints (#461) — the single source
// of truth for how Sound Buddy talks about the measurement source the
// engineer has chosen. Two Settings → Audio pickers render one .device-hint
// paragraph under their select from here: the board "Measurement Source"
// select (LiveSourceSettings, always the board/crowd-mic type) and the
// "Secondary Measurement Device" select (SecondaryMeasurementPanel,
// classified by device name). Informational only — no store, IPC, stream, or
// analysis behavior is touched, and the copy is deliberately hedged so a
// rough trend (board-fed crowd mic, built-in laptop mic) is never mistaken
// for a calibrated room measurement.
//
// The taxonomy lives here so it can evolve without touching call sites: every
// source kind's classification label and copy exists in exactly one module.

export type MeasurementSourceKind = 'board' | 'builtin-mic' | 'measurement-mic' | 'external-mic';

export interface SourceHint {
  kind: MeasurementSourceKind;
  classification: string; // short label, e.g. 'Board / crowd mic'
  copy: string;           // the informational hint paragraph text
}

// Best-effort device-name heuristics. Informational only — the app cannot
// detect calibration files, so 'calibrated' is framed inside the
// measurement-mic copy (the "calibrated sources" scope from #461).
const MEASUREMENT_NAME_RE = /measurement|umik|umm-|ecm|rta-|isemcon|earthworks|dayton|calibrat/i;
const BUILTIN_NAME_RE = /macbook|built-?in|internal microphon|laptop/i;

const SOURCE_HINTS: Record<MeasurementSourceKind, SourceHint> = {
  board: {
    kind: 'board',
    classification: 'Board / crowd mic',
    copy: 'Board feed — the signal may already be EQ\u2019d for recording or routing, so this reflects the console\u2019s mix, not the room itself.',
  },
  'builtin-mic': {
    kind: 'builtin-mic',
    classification: 'Built-in computer microphone',
    copy: 'Useful for rough trends, but not a calibrated measurement — built-in mics color the signal and are not a reliable room reference.',
  },
  'measurement-mic': {
    kind: 'measurement-mic',
    classification: 'Dedicated measurement microphone',
    copy: 'A stronger source for room measurement. A calibrated measurement mic is the gold standard — trust these readings most.',
  },
  'external-mic': {
    kind: 'external-mic',
    classification: 'External audio input',
    copy: 'Fine for rough trends — for trustworthy room measurements, use a calibrated measurement microphone.',
  },
};

export function classifySourceName(deviceName: string): MeasurementSourceKind {
  const n = deviceName.toLowerCase();
  if (MEASUREMENT_NAME_RE.test(n)) return 'measurement-mic';
  if (BUILTIN_NAME_RE.test(n)) return 'builtin-mic';
  return 'external-mic';
}

export function sourceHintForDevice(deviceName: string): SourceHint {
  return SOURCE_HINTS[classifySourceName(deviceName)];
}

export function boardSourceHint(): SourceHint {
  return SOURCE_HINTS.board;
}
