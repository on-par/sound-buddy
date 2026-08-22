// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import type { StripConfig } from './live-capture-panel';
import type { RouteState } from './stores/routeStore';

const FIRST_DEVICE_CHANNEL = 0;
const DISPLAY_CHANNEL_OFFSET = 1;
const STEREO_CHANNEL_COUNT = 2;

export interface RoutingMatrixOutputChoice {
  channels: number[];
  label: string;
  selected: boolean;
}

export interface RoutingMatrixTrackView {
  trackIndex: number;
  label: string;
  kind: StripConfig['kind'];
  outputChannels: number[];
  outputChoices: RoutingMatrixOutputChoice[];
}

export type RoutingMatrixView = RoutingMatrixTrackView[];

export function routingMatrixView(
  tracks: StripConfig[],
  routeState: RouteState,
  deviceChannelCount: number,
): RoutingMatrixView {
  return tracks.map((track, trackIndex) => {
    const outputChannels = routeState.tracks[trackIndex]?.outputChannels ?? [];

    return {
      trackIndex,
      label: track.label || `Track ${trackIndex + DISPLAY_CHANNEL_OFFSET}`,
      kind: track.kind,
      outputChannels: [...outputChannels],
      outputChoices: routingMatrixOutputChoices(track.kind, outputChannels, deviceChannelCount),
    };
  });
}

function routingMatrixOutputChoices(
  kind: StripConfig['kind'],
  outputChannels: number[],
  deviceChannelCount: number,
): RoutingMatrixOutputChoice[] {
  if (!isKnownDeviceChannelCount(deviceChannelCount)) return [];

  if (kind === 'stereo') {
    return stereoOutputChoices(outputChannels, deviceChannelCount);
  }

  return monoOutputChoices(outputChannels, deviceChannelCount);
}

function monoOutputChoices(
  outputChannels: number[],
  deviceChannelCount: number,
): RoutingMatrixOutputChoice[] {
  const choices: RoutingMatrixOutputChoice[] = [];

  for (let channel = FIRST_DEVICE_CHANNEL; channel < deviceChannelCount; channel += 1) {
    const channels = [channel];
    choices.push({
      channels,
      label: `Ch ${channel + DISPLAY_CHANNEL_OFFSET}`,
      selected: arraysEqual(channels, outputChannels),
    });
  }

  return choices;
}

function stereoOutputChoices(
  outputChannels: number[],
  deviceChannelCount: number,
): RoutingMatrixOutputChoice[] {
  if (deviceChannelCount < STEREO_CHANNEL_COUNT) return [];

  const choices: RoutingMatrixOutputChoice[] = [];

  for (let base = FIRST_DEVICE_CHANNEL; base + DISPLAY_CHANNEL_OFFSET < deviceChannelCount; base += 1) {
    const channels = [base, base + DISPLAY_CHANNEL_OFFSET];
    choices.push({
      channels,
      label: `Ch ${base + DISPLAY_CHANNEL_OFFSET}-${base + STEREO_CHANNEL_COUNT}`,
      selected: arraysEqual(channels, outputChannels),
    });
  }

  return choices;
}

function isKnownDeviceChannelCount(deviceChannelCount: number): boolean {
  return Number.isFinite(deviceChannelCount)
    && Number.isInteger(deviceChannelCount)
    && deviceChannelCount > FIRST_DEVICE_CHANNEL;
}

function arraysEqual(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
