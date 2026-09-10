// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, expect, it } from 'vitest';
import { zoomSelectionAtAction } from './zoomFromSelection';
import { createTimeSelectionModel } from './time-selection';
import { applyTimelineZoom, createTimelineZoomModel } from './timeline-zoom-controls';

describe('zoomSelectionAtAction', () => {
  it('returns the drawn selection when one exists', () => {
    const model = createTimeSelectionModel();
    model.setSelection(20, 35);
    expect(zoomSelectionAtAction(model, 120)).toEqual({ startSecs: 20, endSecs: 35 });
  });

  it('falls back to the full take span when there is no selection', () => {
    const model = createTimeSelectionModel();
    expect(zoomSelectionAtAction(model, 120)).toEqual({ startSecs: 0, endSecs: 120 });
  });

  it('falls back to null (the insert-marker window) when there is no selection and no take', () => {
    const model = createTimeSelectionModel();
    expect(zoomSelectionAtAction(model, 0)).toBeNull();
  });

  it('prefers the selection over the take span even when both exist', () => {
    const model = createTimeSelectionModel();
    model.setSelection(5, 10);
    expect(zoomSelectionAtAction(model, 120)).toEqual({ startSecs: 5, endSecs: 10 });
  });

  it('reads the model live: a selection set after render but before the action call is used', () => {
    const model = createTimeSelectionModel();
    // Simulates a render that captured no selection, followed by a drawn selection with
    // no re-render in between — the action must still see it because this function is
    // called at action time, not render time.
    expect(zoomSelectionAtAction(model, 120)).toEqual({ startSecs: 0, endSecs: 120 });
    model.setSelection(40, 55);
    expect(zoomSelectionAtAction(model, 120)).toEqual({ startSecs: 40, endSecs: 55 });
  });

  it('composes with the real zoom reducer to fit the drawn selection', () => {
    const model = createTimeSelectionModel();
    model.setSelection(20, 35);
    const zoomModel = createTimelineZoomModel(120);
    const next = applyTimelineZoom(zoomModel, 'zoom-to-selection', {
      durationSecs: 120,
      playheadSecs: 0,
      selection: zoomSelectionAtAction(model, 120),
    });
    expect(next.range).toEqual({ startSecs: 20, endSecs: 35 });
  });
});
