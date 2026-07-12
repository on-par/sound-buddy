// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Thin registration point for every main-process IPC handler. The handlers
// themselves live under ipc/, grouped by domain (#225 — this file used to be
// a single ~1200-line module covering file analysis, live capture, playback,
// licensing, settings, and the AI narrative all at once):
//   ipc/analysis.ts      — analyze-file; wraps @sound-buddy/audio-engine's
//                          sox/ffprobe/spectrum/ebur128 parsers (#151)
//   ipc/narrative.ts     — AI provider settings + streaming to the renderer
//   ipc/live-capture.ts  — device enumeration, mic permission, start/stop-live
//   ipc/playback.ts      — virtual-soundcheck playback (start/stop-playback)
//   ipc/licensing.ts     — license get/activate/remove
//   ipc/settings.ts      — app settings, capture rigs, native dialogs
//
// Re-exports below preserve the surface other modules import from './ipc':
// main.ts (registerIpcHandlers), the parser drift-guard test (runSox/
// runFfprobe/runSpectrum/runEbur128, #150), and devices.test.ts
// (enumerateDevices).

import { registerAnalysisHandlers } from './ipc/analysis';
import { registerNarrativeHandlers } from './ipc/narrative';
import { registerLiveCaptureHandlers } from './ipc/live-capture';
import { registerPlaybackHandlers } from './ipc/playback';
import { registerLicensingHandlers } from './ipc/licensing';
import { registerSettingsHandlers } from './ipc/settings';

export { runSox, runFfprobe, runSpectrum, runEbur128 } from './ipc/analysis';
export { enumerateDevices, type DeviceListResult } from './ipc/live-capture';

export function registerIpcHandlers(): void {
  registerAnalysisHandlers();
  registerNarrativeHandlers();
  registerLiveCaptureHandlers();
  registerPlaybackHandlers();
  registerLicensingHandlers();
  registerSettingsHandlers();
}
