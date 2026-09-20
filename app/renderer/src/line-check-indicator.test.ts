// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { soleSoloedChannelIndex, lineCheckIndicatorLabel } from './line-check-indicator';
import type { ChannelFlagMap } from './live-capture-panel';

describe('soleSoloedChannelIndex (#1464)', () => {
  it('returns null when no channel is soloed', () => {
    expect(soleSoloedChannelIndex({})).toBeNull();
    expect(soleSoloedChannelIndex({ 0: false, 1: false })).toBeNull();
  });

  it('returns the index when exactly one channel is soloed', () => {
    expect(soleSoloedChannelIndex({ 2: true })).toBe(2);
    expect(soleSoloedChannelIndex({ 0: false, 2: true, 3: false })).toBe(2);
  });

  it('returns null when more than one channel is soloed', () => {
    expect(soleSoloedChannelIndex({ 0: true, 2: true })).toBeNull();
  });
});

describe('lineCheckIndicatorLabel (#1464)', () => {
  const soloedOne: ChannelFlagMap = { 1: true };
  const labelAt = (index: number) => `Strip ${index}`;

  it('is null when the flag is off, regardless of solo state', () => {
    expect(lineCheckIndicatorLabel(false, soloedOne, labelAt)).toBeNull();
    expect(lineCheckIndicatorLabel(false, {}, labelAt)).toBeNull();
  });

  it('is null when the flag is on but no channel is soloed', () => {
    expect(lineCheckIndicatorLabel(true, {}, labelAt)).toBeNull();
  });

  it('is null when the flag is on but more than one channel is soloed (ambiguous)', () => {
    expect(lineCheckIndicatorLabel(true, { 0: true, 1: true }, labelAt)).toBeNull();
  });

  it('renders "Currently checking: {label}" when the flag is on and exactly one channel is soloed', () => {
    expect(lineCheckIndicatorLabel(true, soloedOne, labelAt)).toBe('Currently checking: Strip 1');
  });

  it('resolves the label through the injected labelAt for the soloed index only', () => {
    let calledWith: number | null = null;
    const spyLabelAt = (index: number) => { calledWith = index; return 'Vocals'; };
    expect(lineCheckIndicatorLabel(true, { 3: true }, spyLabelAt)).toBe('Currently checking: Vocals');
    expect(calledWith).toBe(3);
  });
});
