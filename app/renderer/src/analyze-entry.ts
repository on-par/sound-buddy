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
