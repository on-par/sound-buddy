// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The #1404 track-head channel-routing badge + inline picker: the compact
// "3" / "3/4" badge every configured track's head shows, and the Mono/Stereo
// + Source A/B picker a click (or Enter/Space, native <button> semantics)
// opens on the track itself. This is the one sanctioned exception to #849's
// "overview-only head" rule (docs/adr/0133) — every other per-channel
// setting still lives in the EQ pane inspector.

import { channelOptions, type StripConfig } from './live-capture-panel';
import { escapeHtml } from './spectrum-display';

export interface TrackChannelPickerView {
  index: number;
  open: boolean;
  /** Mirrors captureConfigLocked (live-workspace-view.ts) — locked only by an
   *  active recording or the record->monitor demote window, never by plain
   *  monitoring (ADR-0132 applies to this control too). */
  locked: boolean;
  badgeText: string;
  kind: 'mono' | 'stereo';
  a: number;
  b: number;
  deviceChannels: number;
}

// 1-based, matching channelOptions' "Ch N" labels: "3" for a mono strip on
// channel 3, "3/4" for a stereo pair on channels 3 and 4.
export function trackChannelBadgeText(strip: Pick<StripConfig, 'kind' | 'a' | 'b'>): string {
  return strip.kind === 'stereo' ? `${strip.a + 1}/${strip.b + 1}` : `${strip.a + 1}`;
}

export function trackChannelPickerView(
  index: number,
  strip: StripConfig,
  deviceChannels: number,
  openIndex: number | null,
  locked: boolean,
): TrackChannelPickerView {
  return {
    index,
    open: openIndex === index,
    locked,
    badgeText: trackChannelBadgeText(strip),
    kind: strip.kind === 'stereo' ? 'stereo' : 'mono',
    a: strip.a,
    b: strip.b,
    deviceChannels,
  };
}

// Badge button (always rendered) plus the Mono/Stereo + Source popover, only
// while `open`. The popover's two source selects reuse channelOptions'
// `exclude` param against each other's current value, so a stereo pair's
// a === b is never a selectable option in either select.
export function trackChannelPickerHTML(view: TrackChannelPickerView): string {
  const disabled = view.locked ? ' disabled' : '';
  const badgeLabel = escapeHtml(view.badgeText);
  const badge = `<button type="button" class="daw-track-head-channel-badge" aria-haspopup="true" aria-expanded="${view.open}" aria-label="Change channel routing — currently ${badgeLabel}" title="Change channel routing"${disabled}>${badgeLabel}</button>`;
  if (!view.open) return badge;
  const stereo = view.kind === 'stereo';
  const popover = `<div class="daw-track-channel-picker" role="group" aria-label="Channel routing">`
    + `<label class="daw-track-channel-picker-field">Mode`
    + `<select class="daw-track-channel-picker-kind" aria-label="Mono or stereo"${disabled}>`
    + `<option value="mono"${!stereo ? ' selected' : ''}>Mono</option>`
    + `<option value="stereo"${stereo ? ' selected' : ''}>Stereo</option>`
    + `</select></label>`
    + `<label class="daw-track-channel-picker-field">${stereo ? 'Source A' : 'Source'}`
    + `<select class="daw-track-channel-picker-source" data-field="a" aria-label="${stereo ? 'Source A channel' : 'Source channel'}"${disabled}>${channelOptions(view.a, view.deviceChannels, false, stereo ? view.b : undefined)}</select></label>`
    + (stereo
      ? `<label class="daw-track-channel-picker-field">Source B`
        + `<select class="daw-track-channel-picker-source" data-field="b" aria-label="Source B channel"${disabled}>${channelOptions(view.b, view.deviceChannels, false, view.a)}</select></label>`
      : '')
    + `</div>`;
  return badge + popover;
}
