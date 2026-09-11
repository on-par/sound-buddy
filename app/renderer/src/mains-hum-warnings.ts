// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure per-strip mains-hum warning tracker (#1392). Folds each window tick's
// channels through the audio-engine's classifyMainsHum, keyed by the tick's
// POSITIONAL index (not ChannelWindowData.index) because liveChannelAt/
// dawTrackRows map strips to lastLiveChannels[idx] positionally. No DOM, no
// store import — liveCaptureStore owns the tracker as discrete state and
// live-workspace-view derives the per-row badge from it.

import { classifyMainsHum, type MainsHumEligibility, type MainsHumDetectionResult } from '@sound-buddy/audio-engine/dist/analyze/mains-hum.js';
import type { ChannelWindowData } from './live-capture-panel';

export type MainsHumFrequencyHz = NonNullable<MainsHumDetectionResult['frequencyHz']>;

export interface MainsHumWarning {
  channelIndex: number;
  channelName: string;
  frequencyHz: MainsHumFrequencyHz;
}

export type MainsHumWarningMap = Record<number, MainsHumWarning>;

export interface MainsHumTracker {
  eligibility: Record<number, MainsHumEligibility>;
  warnings: MainsHumWarningMap;
}

const FRESH_ELIGIBILITY: MainsHumEligibility = { consecutiveQualifyingWindows: 0, eligible: false };

export function createMainsHumTracker(): MainsHumTracker {
  return { eligibility: {}, warnings: {} };
}

// Builds fresh eligibility/warnings objects from `channels` alone — an index
// missing from this tick is simply not carried forward into either map, so a
// channel that drops out of a tick loses its persistence and its warning.
export function advanceMainsHumTracker(prev: MainsHumTracker, channels: readonly ChannelWindowData[]): MainsHumTracker {
  const eligibility: Record<number, MainsHumEligibility> = {};
  const warnings: MainsHumWarningMap = {};

  channels.forEach((ch, idx) => {
    const result = classifyMainsHum(prev.eligibility[idx] ?? FRESH_ELIGIBILITY, {
      index: idx,
      name: ch.name,
      rms: ch.rms,
      curve: ch.curve,
    });
    eligibility[idx] = result.eligibility;
    if (result.eligibility.eligible && result.frequencyHz !== null) {
      warnings[idx] = { channelIndex: idx, channelName: result.channelName, frequencyHz: result.frequencyHz };
    }
  });

  return { eligibility, warnings };
}

export function mainsHumBadgeText(frequencyHz: MainsHumFrequencyHz): string {
  return `${frequencyHz} Hz hum`;
}

export function mainsHumWarningText(channelLabel: string, frequencyHz: MainsHumFrequencyHz): string {
  return `Mains hum at ${frequencyHz} Hz on ${channelLabel} — check that input's cable, DI box, or ground loop.`;
}
