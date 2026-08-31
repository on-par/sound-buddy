// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, expect, it, vi } from 'vitest';
import { CLIP_SELECTED_LANE_CLASS, createClipSelectionModel, sessionClipSelection } from './clip-selection';

describe('createClipSelectionModel', () => {
  it('defaults to no selection', () => {
    const model = createClipSelectionModel();
    expect(model.getSelectedChannel()).toBeNull();
  });

  it('selectClip(3) returns 3 and becomes the selected channel', () => {
    const model = createClipSelectionModel();
    expect(model.selectClip(3)).toBe(3);
    expect(model.getSelectedChannel()).toBe(3);
  });

  it('notifies a subscriber once for selectClip(3) and not again for a repeated selectClip(3)', () => {
    const model = createClipSelectionModel();
    const listener = vi.fn();
    model.subscribe(listener);
    model.selectClip(3);
    model.selectClip(3);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(3);
  });

  it.each([-1, 1.5, Number.NaN])('selectClip(%p) leaves the current selection unchanged', (bad) => {
    const model = createClipSelectionModel();
    model.selectClip(2);
    expect(model.selectClip(bad)).toBe(2);
    expect(model.getSelectedChannel()).toBe(2);
  });

  it('clearSelection() returns null, clears the selection, and notifies', () => {
    const model = createClipSelectionModel();
    const listener = vi.fn();
    model.selectClip(4);
    model.subscribe(listener);
    expect(model.clearSelection()).toBeNull();
    expect(model.getSelectedChannel()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(null);
  });

  it('clearing an already-clear model notifies no one', () => {
    const model = createClipSelectionModel();
    const listener = vi.fn();
    model.subscribe(listener);
    model.clearSelection();
    expect(listener).not.toHaveBeenCalled();
  });

  it('subscribe returns an unsubscribe function that stops further notifications', () => {
    const model = createClipSelectionModel();
    const listener = vi.fn();
    const unsubscribe = model.subscribe(listener);
    unsubscribe();
    model.selectClip(1);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('sessionClipSelection', () => {
  it('is a shared ClipSelectionModel instance with the default null selection', () => {
    expect(sessionClipSelection.getSelectedChannel()).toBeNull();
  });
});

describe('CLIP_SELECTED_LANE_CLASS', () => {
  it("is 'clip-selected'", () => {
    expect(CLIP_SELECTED_LANE_CLASS).toBe('clip-selected');
  });
});
