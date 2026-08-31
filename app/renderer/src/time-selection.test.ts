// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, expect, it, vi } from 'vitest';
import { createTimeSelectionModel, normalizeTimeRange, sessionTimeSelection } from './time-selection';

describe('normalizeTimeRange', () => {
  it('orders a right-to-left pair', () => {
    expect(normalizeTimeRange(9, 3)).toEqual({ startSecs: 3, endSecs: 9 });
  });

  it('clamps a negative endpoint to 0', () => {
    expect(normalizeTimeRange(-5, 4)).toEqual({ startSecs: 0, endSecs: 4 });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'returns null when one endpoint is %p',
    (bad) => {
      expect(normalizeTimeRange(bad, 4)).toBeNull();
      expect(normalizeTimeRange(4, bad)).toBeNull();
    },
  );

  it('returns null for an equal pair', () => {
    expect(normalizeTimeRange(5, 5)).toBeNull();
  });

  it('returns null for (-3, -1) — both clamp to 0, a degenerate range', () => {
    expect(normalizeTimeRange(-3, -1)).toBeNull();
  });

  it('returns a frozen object', () => {
    const range = normalizeTimeRange(1, 2);
    expect(range).not.toBeNull();
    expect(Object.isFrozen(range)).toBe(true);
  });
});

describe('createTimeSelectionModel', () => {
  it('getSelection() starts null', () => {
    const model = createTimeSelectionModel();
    expect(model.getSelection()).toBeNull();
  });

  it('setSelection(2, 6) stores the normalized range', () => {
    const model = createTimeSelectionModel();
    expect(model.setSelection(2, 6)).toEqual({ startSecs: 2, endSecs: 6 });
    expect(model.getSelection()).toEqual({ startSecs: 2, endSecs: 6 });
  });

  it('setSelection(6, 2) stores the same normalized range', () => {
    const model = createTimeSelectionModel();
    model.setSelection(6, 2);
    expect(model.getSelection()).toEqual({ startSecs: 2, endSecs: 6 });
  });

  it('setSelection(4, 4) clears the selection', () => {
    const model = createTimeSelectionModel();
    model.setSelection(2, 6);
    expect(model.setSelection(4, 4)).toBeNull();
    expect(model.getSelection()).toBeNull();
  });

  it('clearSelection() returns null and clears an existing selection', () => {
    const model = createTimeSelectionModel();
    model.setSelection(2, 6);
    expect(model.clearSelection()).toBeNull();
    expect(model.getSelection()).toBeNull();
  });

  it('subscribe fires on a real change', () => {
    const model = createTimeSelectionModel();
    const listener = vi.fn();
    model.subscribe(listener);
    model.setSelection(2, 6);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ startSecs: 2, endSecs: 6 });
  });

  it('subscribe does not fire on a repeat setSelection with the same values', () => {
    const model = createTimeSelectionModel();
    model.setSelection(2, 6);
    const listener = vi.fn();
    model.subscribe(listener);
    model.setSelection(2, 6);
    expect(listener).not.toHaveBeenCalled();
  });

  it('subscribe does not fire when a degenerate setSelection leaves an already-null selection unchanged', () => {
    const model = createTimeSelectionModel();
    const listener = vi.fn();
    model.subscribe(listener);
    model.setSelection(4, 4);
    expect(listener).not.toHaveBeenCalled();
  });

  it('the returned unsubscribe stops further notifications', () => {
    const model = createTimeSelectionModel();
    const listener = vi.fn();
    const unsubscribe = model.subscribe(listener);
    unsubscribe();
    model.setSelection(2, 6);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('sessionTimeSelection', () => {
  it('is a shared TimeSelectionModel instance with the default null selection', () => {
    expect(sessionTimeSelection.clearSelection()).toBeNull();
    expect(sessionTimeSelection.getSelection()).toBeNull();
  });
});
