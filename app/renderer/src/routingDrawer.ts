// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import type { StripConfig } from './live-capture-panel';
import { routingMatrixView } from './routingMatrix';
import type { RouteState, RouteStoreState } from './stores/routeStore';
import type { SoundcheckState } from './stores/soundcheckStore';
import { escapeHtml } from './spectrum-display';
import type { SoundcheckBus } from '../../electron/ipc/api';

const FIRST_CHANNEL = 0;
const STEREO_CHANNEL_COUNT = 2;
const DISPLAY_CHANNEL_OFFSET = 1;

export interface RoutingDrawerChangeDeps {
  routes: Pick<RouteStoreState, 'updateTrackInput' | 'updateTrackOutput' | 'setMasterMixdown'>;
  soundcheck: Pick<SoundcheckState, 'setRoute' | 'setMaster'>;
}

export function routeStateForSession(tracks: StripConfig[], outputRoutes: number[][], savedBuses: SoundcheckBus[]): RouteState {
  return {
    tracks: tracks.map((track, trackIndex) => ({
      inputChannels: track.kind === 'stereo' ? [track.a, track.b] : [track.a],
      outputChannels: [...(outputRoutes[trackIndex] ?? [])],
    })),
    savedBuses: savedBuses.map((bus) => ({ ...bus })),
    masterMixdown: false,
  };
}

export function routingDrawerHTML(
  tracks: StripConfig[],
  routeState: RouteState,
  inputDeviceChannelCount: number,
  outputDeviceChannelCount: number,
): string {
  const matrix = routingMatrixView(tracks, routeState, outputDeviceChannelCount);
  const trackAssignments = `<div class="daw-routing-list">${tracks.map((track, trackIndex) => {
    const label = escapeHtml(track.label || `Track ${trackIndex + DISPLAY_CHANNEL_OFFSET}`);
    const selectedInput = routeState.tracks[trackIndex]?.inputChannels ?? [];
    const sourceOptions = inputOptions(track.kind, selectedInput, inputDeviceChannelCount);
    const outputChoices = matrix[trackIndex]?.outputChoices ?? [];
    return `<div class="daw-routing-track">`
      + `<span class="daw-routing-track-name">${label}</span>`
      + `<label class="daw-routing-source-label">Source <select class="daw-routing-source" data-routing-kind="input" data-routing-track-index="${trackIndex}" aria-label="${label} source">${sourceOptions}</select></label>`
      + `<div class="daw-routing-output" aria-label="${label} outputs">${outputChoices.map((choice) =>
        `<button type="button" class="daw-routing-output-cell" data-routing-kind="output" data-routing-track-index="${trackIndex}" data-routing-channels="${choice.channels.join(',')}" aria-label="${label} output ${choice.label}" aria-pressed="${choice.selected}">${choice.label}</button>`).join('')}</div>`
      + `</div>`;
  }).join('')}</div>`;
  const savedBusAssignments = routeState.savedBuses.length > 0
    ? routeState.savedBuses.map((bus) => `<div class="daw-routing-saved-bus">`
      + `<span class="daw-routing-saved-bus-name">${escapeHtml(bus.name)}</span>`
      + `<span class="daw-routing-saved-bus-pattern">${escapeHtml(bus.pattern)}</span>`
      + `<span class="daw-routing-saved-bus-output">Ch ${bus.outputChannel + DISPLAY_CHANNEL_OFFSET}</span>`
      + `</div>`).join('')
    : '<p class="daw-routing-saved-bus-empty">No saved bus assignments for this session.</p>';
  const masterChecked = routeState.masterMixdown ? ' checked' : '';
  return trackAssignments
    + `<section class="daw-routing-saved-buses" aria-label="Saved bus assignments">`
    + `<span class="daw-routing-saved-buses-title">Saved buses</span>${savedBusAssignments}</section>`
    + `<label class="daw-routing-master-label"><input type="checkbox" class="daw-routing-master-mixdown" aria-label="Force stereo master mixdown"${masterChecked}>Force stereo master mixdown</label>`;
}

export function applyRoutingDrawerChange(
  kind: 'input' | 'output',
  sessionId: string,
  trackIndex: number,
  channels: number[],
  deps: RoutingDrawerChangeDeps,
): RouteState | null {
  if (!isValidChange(sessionId, trackIndex, channels)) return null;

  if (kind === 'input') {
    return deps.routes.updateTrackInput(sessionId, trackIndex, channels);
  }

  const next = deps.routes.updateTrackOutput(sessionId, trackIndex, channels);
  if (next) deps.soundcheck.setRoute(trackIndex, channels[FIRST_CHANNEL]);
  return next;
}

export function applyRoutingDrawerMasterMixdownChange(
  sessionId: string,
  masterMixdown: boolean,
  deps: RoutingDrawerChangeDeps,
): RouteState | null {
  if (!sessionId) return null;

  const next = deps.routes.setMasterMixdown(sessionId, masterMixdown);
  if (next) deps.soundcheck.setMaster(masterMixdown);
  return next;
}

function inputOptions(kind: StripConfig['kind'], selectedChannels: number[], channelCount: number): string {
  if (!isKnownChannelCount(channelCount)) return '';
  const choices = kind === 'stereo'
    ? Array.from({ length: Math.max(FIRST_CHANNEL, channelCount - DISPLAY_CHANNEL_OFFSET) }, (_, base) => [base, base + DISPLAY_CHANNEL_OFFSET])
    : Array.from({ length: channelCount }, (_, channel) => [channel]);
  return choices.map((channels) => {
    const selected = arraysEqual(channels, selectedChannels) ? ' selected' : '';
    const label = channels.length === STEREO_CHANNEL_COUNT
      ? `Ch ${channels[FIRST_CHANNEL] + DISPLAY_CHANNEL_OFFSET}-${channels[DISPLAY_CHANNEL_OFFSET] + DISPLAY_CHANNEL_OFFSET}`
      : `Ch ${channels[FIRST_CHANNEL] + DISPLAY_CHANNEL_OFFSET}`;
    return `<option value="${channels.join(',')}"${selected}>${label}</option>`;
  }).join('');
}

function isKnownChannelCount(channelCount: number): boolean {
  return Number.isFinite(channelCount) && Number.isInteger(channelCount) && channelCount > FIRST_CHANNEL;
}

function isValidChange(sessionId: string, trackIndex: number, channels: number[]): boolean {
  return sessionId.length > 0
    && Number.isInteger(trackIndex)
    && trackIndex >= FIRST_CHANNEL
    && channels.length > 0
    && channels.every((channel) => Number.isInteger(channel) && channel >= FIRST_CHANNEL);
}

function arraysEqual(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
