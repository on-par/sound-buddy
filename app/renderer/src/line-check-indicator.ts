// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure "currently checking" derivation for the line-check calibration epic
// (#1464, epic #1462). A line check is deterministic by construction: the
// console operator solos exactly one channel at a time, and soloedChannels
// already carries that state (#1463 wired the dark flag; this slice is the
// first read of it). Zero or many soloed channels is not a line-check moment
// and stays silent (ADR-0139) — no heuristic guesses at intent. `labelAt` is
// injected so this module never touches `window` or HTML escaping itself;
// the caller (live-workspace-view.ts's dawStatusLineView, the markup
// boundary) supplies the same resolveStripLabel/escapeHtml pipeline the
// track head already resolves through, so the indicator can't name a channel
// differently than its own track head does.

import type { ChannelFlagMap } from './live-capture-panel';

const CURRENTLY_CHECKING_PREFIX = 'Currently checking: ';

// The index of the one soloed channel, or null when zero or more than one
// channel is soloed (ambiguous — not a line-check moment).
export function soleSoloedChannelIndex(soloedChannels: ChannelFlagMap): number | null {
  const soloed = Object.keys(soloedChannels)
    .map(Number)
    .filter((index) => soloedChannels[index] === true);
  return soloed.length === 1 ? soloed[0] : null;
}

// null when the flag is off, or when zero/many channels are soloed;
// otherwise "Currently checking: {label}" for the sole soloed channel.
export function lineCheckIndicatorLabel(
  enabled: boolean,
  soloedChannels: ChannelFlagMap,
  labelAt: (index: number) => string,
): string | null {
  if (!enabled) return null;
  const index = soleSoloedChannelIndex(soloedChannels);
  return index === null ? null : `${CURRENTLY_CHECKING_PREFIX}${labelAt(index)}`;
}
