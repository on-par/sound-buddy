// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, expect, it, vi } from 'vitest';
import { LOOP_FROM_SELECTION_BUTTON_ID, loopRegionFromSelection, promoteSelectionToLoop } from './loopFromSelection';
import { createLoopRegionModel } from './loopBrace.render';
import { sessionTabPlaybackHTML, sessionTabPlaybackView } from './session-tab-playback';

const MANIFEST = { name: 'Sunday service', tracks: [{ kind: 'mono' as const }] };

describe('loopRegionFromSelection', () => {
  it('returns null for a null selection', () => {
    expect(loopRegionFromSelection(null)).toBeNull();
  });

  it('returns null for an undefined selection', () => {
    expect(loopRegionFromSelection(undefined)).toBeNull();
  });

  it('returns the selection endpoints as a loop region', () => {
    expect(loopRegionFromSelection({ startSecs: 3, endSecs: 9 })).toEqual({ startSecs: 3, endSecs: 9 });
  });

  it('orders a reversed selection', () => {
    expect(loopRegionFromSelection({ startSecs: 9, endSecs: 3 })).toEqual({ startSecs: 3, endSecs: 9 });
  });

  it('rejects a zero-width selection', () => {
    expect(loopRegionFromSelection({ startSecs: 4, endSecs: 4 })).toBeNull();
  });

  it('rejects a non-finite endpoint', () => {
    expect(loopRegionFromSelection({ startSecs: Number.NaN, endSecs: 9 })).toBeNull();
  });
});

describe('promoteSelectionToLoop', () => {
  it('sets the loop range and reports enableLooping when Loop was off', () => {
    const model = createLoopRegionModel();
    const result = promoteSelectionToLoop(model, { startSecs: 12, endSecs: 20 }, { available: true, looping: false });
    expect(result).toEqual({ region: { startSecs: 12, endSecs: 20 }, enableLooping: true });
    expect(model.getRegion()).toEqual({ startSecs: 12, endSecs: 20 });
  });

  it('sets the loop range but reports enableLooping:false when Loop was already on', () => {
    const model = createLoopRegionModel();
    const result = promoteSelectionToLoop(model, { startSecs: 12, endSecs: 20 }, { available: true, looping: true });
    expect(result).toEqual({ region: { startSecs: 12, endSecs: 20 }, enableLooping: false });
    expect(model.getRegion()).toEqual({ startSecs: 12, endSecs: 20 });
  });

  it('is a no-op with no selection', () => {
    const model = createLoopRegionModel();
    const before = model.getRegion();
    const listener = vi.fn();
    model.subscribe(listener);
    const result = promoteSelectionToLoop(model, null, { available: true, looping: false });
    expect(result).toBeNull();
    expect(model.getRegion()).toEqual(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('is a no-op when no session is loaded', () => {
    const model = createLoopRegionModel();
    const before = model.getRegion();
    const result = promoteSelectionToLoop(model, { startSecs: 12, endSecs: 20 }, { available: false, looping: false });
    expect(result).toBeNull();
    expect(model.getRegion()).toEqual(before);
  });

  it('beats the #1314 seed-once default', () => {
    const model = createLoopRegionModel();
    promoteSelectionToLoop(model, { startSecs: 30, endSecs: 40 }, { available: true, looping: false });
    model.applyDefaultIfUnseeded({ startSecs: 0, endSecs: 10 });
    expect(model.getRegion()).toEqual({ startSecs: 30, endSecs: 40 });
  });
});

describe('LOOP_FROM_SELECTION_BUTTON_ID', () => {
  it('matches the id sessionTabPlaybackHTML actually emits (drift guard)', () => {
    const html = sessionTabPlaybackHTML(sessionTabPlaybackView(MANIFEST, false, false));
    expect(html).toContain(`id="${LOOP_FROM_SELECTION_BUTTON_ID}"`);
  });
});
