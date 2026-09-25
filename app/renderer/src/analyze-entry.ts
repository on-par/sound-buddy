// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure decision logic for the Analyze tab's entry point. #1485 inverted the
// gate: it used to be feature-tier based (shouldOfferListenLive, gated on
// advancedFeaturesEnabled — #1468/#1479/#1483), but Analyze is now the live
// room-mic measurement destination in both Simple and Advanced mode. The
// only precondition for live listening is a configured secondary measurement
// device; feature tier no longer factors in at all.

export type ListenLiveChoice = 'startListening' | 'needsSecondarySource';

// deviceName is the persisted secondary-measurement-device preference
// (liveCaptureStore.secondaryMeasurement.deviceName, hydrated outside the
// Live tab by stores/bridge.ts). '' means the user has never chosen one —
// AC4 routes that case to Settings > Audio instead of a silent failure.
export function resolveListenLiveChoice(deviceName: string): ListenLiveChoice {
  return deviceName === '' ? 'needsSecondarySource' : 'startListening';
}

export type AnalyzeEntryAction = 'startListening' | 'openDialog';

// #1485: the Analyze tab's one entry rule, in Simple and Advanced mode alike.
// A configured secondary measurement device is the only precondition for live
// listening — feature tier no longer gates it. With no device configured we
// open the two-choice dialog rather than a native file picker, so a nav click
// never seizes focus with a modal OS surface.
export function resolveAnalyzeEntry(deviceName: string): AnalyzeEntryAction {
  return resolveListenLiveChoice(deviceName) === 'startListening' ? 'startListening' : 'openDialog';
}

// #1522: the Analyze stage's mode is derived from listening, never a second
// stored flag — a stored `analyzeMode` could disagree with `listening` (e.g.
// after a Settings-side stop), which is exactly the Live/File corruption the
// issue forbids. See analyzeResultsView, which takes this mode.
export type AnalyzeMode = 'live' | 'file';

export function analyzeModeOf(listening: boolean): AnalyzeMode {
  return listening ? 'live' : 'file';
}

// #1522: resolves a drag-and-drop FileList to a real disk path via the
// injected webUtils.getPathForFile (Electron removed File.path in v32). Only
// the first dropped file is analyzed — extension filtering is deliberately
// skipped; the analyze-file IPC already returns an actionable error for an
// unreadable file.
export function droppedAudioPath(
  files: ArrayLike<File> | null | undefined,
  getPathForFile: (file: File) => string,
): string | null {
  if (!files || files.length === 0) return null;
  const path = getPathForFile(files[0]);
  return path || null;
}
