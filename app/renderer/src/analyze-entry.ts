// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure decision logic for the Analyze tab's entry point. #1485 made Analyze
// the live room-mic measurement destination in both Simple and Advanced mode.
// #1646 removes its last precondition: Analyze always lands on Live, and with
// no secondary measurement device configured the listen runs on the system
// default input (stream.py's empty-device default) instead of bouncing to
// Settings > Audio or a File-or-live dialog. File is the explicit, secondary
// mode — reached only by the File toggle or a file load, never by default.

// #1604: "a configured device" means the in-memory liveCaptureStore name OR
// the persisted settings.measurementDeviceName (bridge.ts seeds the former
// from the latter only while idle). '' means none — the system default input.
export function effectiveSecondaryDeviceName(liveName: string, persistedName: string | null | undefined): string {
  return liveName !== '' ? liveName : (persistedName ?? '');
}

// #1577: the post-hydration boot auto-listen, run only on the unchanged
// boot-painted Analyze home. #1646: no device factor any more — a cold boot
// with no room mic configured listens on the system default input, exactly
// like one with a device configured listens on it. Still never resolves to
// opening any dialog, and is a no-op once already listening.
export interface AnalyzeHomeAutoListenInput {
  currentMode: string;
  listening: boolean;
}

// 'skip' covers not-on-Analyze and already-listening.
export type AnalyzeHomeAutoListenDecision = 'startListening' | 'skip';

export function decideAnalyzeHomeAutoListen(input: AnalyzeHomeAutoListenInput): AnalyzeHomeAutoListenDecision {
  if (input.currentMode !== 'analyze' || input.listening) return 'skip';
  return 'startListening';
}

// #1646: the analysisStore fields that mean "a file-derived result is about
// to land" — a file analysis starting (any entry point: the menu, onboarding's
// demo, a drop, Load file…) or a history entry being loaded.
export interface FileResultSignal {
  isAnalyzing: boolean;
  historySummary: unknown;
}

// #1646: Analyze's mode is derived from `listening` (analyzeModeOf), so a
// file result that lands while Live is listening would be hidden behind the
// live rail. Now that Live is the default, every file-result arrival must
// yield the stage to File — bridge.ts stops the listen on this edge, so no
// file entry point has to remember chooseFile()'s teardown rule itself.
export function shouldYieldLiveToFileResult(prev: FileResultSignal, next: FileResultSignal): boolean {
  if (next.isAnalyzing && !prev.isAnalyzing) return true;
  return next.historySummary !== null && next.historySummary !== prev.historySummary;
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
