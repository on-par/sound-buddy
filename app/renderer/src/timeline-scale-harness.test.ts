// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import { createTimelineScale, TIMELINE_SCALE_MAX_PX_PER_SECOND } from './timeline-scale';
import { getSessionTimelineScale } from './session-timeline-scale';
import {
  TIMELINE_SCALE_STATES,
  TIMELINE_SCALE_DEFAULT_STATE,
  TIMELINE_SCALE_HOOK_KEY,
  createTimelineScaleModel,
  isTimelineScaleState,
  createTimelineScaleTestHook,
  installTimelineScaleTestHook,
} from './timeline-scale-harness';

describe('createTimelineScaleModel', () => {
  it('seeds at the default state', () => {
    const model = createTimelineScaleModel();
    expect(model.getSnapshot()).toEqual({
      state: 'default',
      pxPerSecond: createTimelineScale('default').pxPerSecond,
      fit: null,
    });
  });

  it('the default state matches the shell paint scale before any render (session-timeline-scale.ts) — the shell must never drift from the harness default', () => {
    const model = createTimelineScaleModel();
    const shellDefault = getSessionTimelineScale();
    expect(model.getScale().state).toBe(shellDefault.state);
    expect(model.getScale().pxPerSecond).toBe(shellDefault.pxPerSecond);
  });

  it.each(['zoomed-in', 'zoomed-out', 'default'] as const)('setState(%s) matches createTimelineScale', (state) => {
    const model = createTimelineScaleModel();
    const snapshot = model.setState(state);
    const expected = createTimelineScale(state);
    expect(snapshot.state).toBe(state);
    expect(snapshot.pxPerSecond).toBe(expected.pxPerSecond);
    expect(model.getScale().timeToX(10)).toBe(expected.timeToX(10));
  });

  it('setState("fit", request) resolves from the request when inside the clamp', () => {
    const model = createTimelineScaleModel();
    const snapshot = model.setState('fit', { durationSecs: 120, viewportWidthPx: 960 });
    expect(snapshot.state).toBe('fit');
    expect(snapshot.pxPerSecond).toBe(8);
    expect(snapshot.fit).toEqual({ durationSecs: 120, viewportWidthPx: 960 });
  });

  it('setState("fit", request) clamps to the zoomed-in bound when the request exceeds it', () => {
    const model = createTimelineScaleModel();
    const snapshot = model.setState('fit', { durationSecs: 10, viewportWidthPx: 960 });
    expect(snapshot.state).toBe('fit');
    expect(snapshot.pxPerSecond).toBe(TIMELINE_SCALE_MAX_PX_PER_SECOND);
  });

  it('setState("fit") with no request falls back to the default px/s but still reports state "fit"', () => {
    const model = createTimelineScaleModel();
    const snapshot = model.setState('fit');
    expect(snapshot.state).toBe('fit');
    expect(snapshot.pxPerSecond).toBe(createTimelineScale('default').pxPerSecond);
    expect(snapshot.fit).toBeNull();
  });

  it('subscribe fires on a real change and not on a redundant setState', () => {
    const model = createTimelineScaleModel();
    const listener = vi.fn();
    const unsubscribe = model.subscribe(listener);

    model.setState('zoomed-in');
    expect(listener).toHaveBeenCalledTimes(1);

    model.setState('zoomed-in');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    model.setState('zoomed-out');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reset() returns the model to default with fit cleared', () => {
    const model = createTimelineScaleModel();
    model.setState('fit', { durationSecs: 120, viewportWidthPx: 960 });

    const snapshot = model.reset();

    expect(snapshot.state).toBe(TIMELINE_SCALE_DEFAULT_STATE);
    expect(snapshot.fit).toBeNull();
    expect(snapshot.pxPerSecond).toBe(createTimelineScale('default').pxPerSecond);
  });
});

describe('isTimelineScaleState', () => {
  it.each(TIMELINE_SCALE_STATES)('accepts %s', (state) => {
    expect(isTimelineScaleState(state)).toBe(true);
  });

  it('rejects an unknown string', () => {
    expect(isTimelineScaleState('zoomedIn')).toBe(false);
  });

  it('rejects a non-string value', () => {
    expect(isTimelineScaleState(42)).toBe(false);
  });
});

describe('createTimelineScaleTestHook', () => {
  it('setState delegates to the model and returns the resulting snapshot', () => {
    const model = createTimelineScaleModel();
    const hook = createTimelineScaleTestHook(model);

    const snapshot = hook.setState('zoomed-in');

    expect(snapshot.state).toBe('zoomed-in');
    expect(model.getSnapshot().state).toBe('zoomed-in');
  });

  it('setState throws an actionable Error for an unrecognised state and leaves the model unchanged', () => {
    const model = createTimelineScaleModel();
    const hook = createTimelineScaleTestHook(model);

    expect(() => hook.setState('zoomedIn')).toThrow(/zoomedIn.*fit.*default.*zoomed-in.*zoomed-out/s);
    expect(hook.getState().state).toBe('default');
  });

  it('getState reports the model snapshot and reset delegates to the model', () => {
    const model = createTimelineScaleModel();
    const hook = createTimelineScaleTestHook(model);
    hook.setState('zoomed-out');

    expect(hook.getState().state).toBe('zoomed-out');

    const resetSnapshot = hook.reset();
    expect(resetSnapshot.state).toBe('default');
    expect(model.getSnapshot().state).toBe('default');
  });
});

describe('installTimelineScaleTestHook', () => {
  it('when disabled, leaves the key absent and returns null', () => {
    const target: Record<string, unknown> = {};

    const result = installTimelineScaleTestHook(target, false);

    expect(result).toBeNull();
    expect(TIMELINE_SCALE_HOOK_KEY in target).toBe(false);
  });

  it('when disabled, removes a previously installed hook', () => {
    const target: Record<string, unknown> = {};
    installTimelineScaleTestHook(target, true);

    installTimelineScaleTestHook(target, false);

    expect(TIMELINE_SCALE_HOOK_KEY in target).toBe(false);
  });

  it('when enabled, installs a working hook against the passed model', () => {
    const target: Record<string, unknown> = {};
    const model = createTimelineScaleModel();

    const uninstall = installTimelineScaleTestHook(target, true, model);
    const hook = target[TIMELINE_SCALE_HOOK_KEY] as { setState(state: string): { state: string } };
    hook.setState('zoomed-in');

    expect(model.getSnapshot().state).toBe('zoomed-in');

    uninstall?.();
    expect(TIMELINE_SCALE_HOOK_KEY in target).toBe(false);
  });
});
