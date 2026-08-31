// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// A test-only harness for the Session arrangement's timeline scale (#1294, epic
// #1259). It exists so an automated e2e spec can put the shared Session timeline
// scale into 'fit' / 'default' / 'zoomed-in' / 'zoomed-out' deterministically,
// without driving the #1284 toolbar zoom buttons (which are order-dependent and
// cannot express 'fit' at all). It is pure — no DOM, no store, no React — and
// imports only from ./timeline-scale.
//
// IMPORTANT: nothing paints from this model yet. SESSION_TIMELINE_SCALE in
// live-workspace-view.ts is still the one scale the shell renders from; this
// module's sessionTimelineScaleModel is the harness surface, kept in sync with
// it only at the 'default' state (see the drift test in
// timeline-scale-harness.test.ts). The zoom-wiring slice (#1283, parked) is what
// collapses the two into one owner.
//
// From a Playwright spec, after launchApp({ SOUND_BUDDY_TEST_HOOKS: '1' }):
//   await window.evaluate(() => window.__soundBuddyTimelineScale.setState('zoomed-in'));
//   const snap = await window.evaluate(() => window.__soundBuddyTimelineScale.getState());
//   // snap === { state: 'zoomed-in', pxPerSecond: 32, fit: null }
// 'fit' needs a request:
//   window.__soundBuddyTimelineScale.setState('fit', { durationSecs: 120, viewportWidthPx: 960 })
// Without SOUND_BUDDY_TEST_HOOKS=1 the property is absent — that is the gate, not a bug.

import {
  createTimelineScale,
  type TimelineFitRequest,
  type TimelineScale,
  type TimelineZoomState,
} from './timeline-scale';

/** The four supported states, and the one source both the validator and the
 *  test hook's error message draw from. */
export const TIMELINE_SCALE_STATES: readonly TimelineZoomState[] = Object.freeze([
  'fit',
  'default',
  'zoomed-in',
  'zoomed-out',
]);

export const TIMELINE_SCALE_DEFAULT_STATE: TimelineZoomState = 'default';

/** The window property name the test hook installs at. */
export const TIMELINE_SCALE_HOOK_KEY = '__soundBuddyTimelineScale';

/** The queryable value: plain data only (no functions), so it survives
 *  Playwright's page.evaluate structured-clone boundary. */
export interface TimelineScaleSnapshot {
  readonly state: TimelineZoomState;
  readonly pxPerSecond: number;
  readonly fit: TimelineFitRequest | null;
}

/** The shared mutable holder over timeline-scale.ts's pure resolvers. */
export interface TimelineScaleModel {
  getScale(): TimelineScale;
  getSnapshot(): TimelineScaleSnapshot;
  setState(state: TimelineZoomState, fit?: TimelineFitRequest): TimelineScaleSnapshot;
  reset(): TimelineScaleSnapshot;
  subscribe(listener: (snapshot: TimelineScaleSnapshot) => void): () => void;
}

/** The surface installed on window — a validated, string-in subset of
 *  TimelineScaleModel suitable for an untyped page.evaluate() caller. */
export interface TimelineScaleTestHook {
  setState(state: string, fit?: TimelineFitRequest): TimelineScaleSnapshot;
  getState(): TimelineScaleSnapshot;
  reset(): TimelineScaleSnapshot;
}

export function createTimelineScaleModel(
  initialState: TimelineZoomState = TIMELINE_SCALE_DEFAULT_STATE,
  initialFit?: TimelineFitRequest,
): TimelineScaleModel {
  let fit: TimelineFitRequest | null = initialFit ?? null;
  let scale = createTimelineScale(initialState, fit ?? undefined);
  const listeners = new Set<(snapshot: TimelineScaleSnapshot) => void>();

  function snapshot(): TimelineScaleSnapshot {
    return Object.freeze({ state: scale.state, pxPerSecond: scale.pxPerSecond, fit });
  }

  // Exact-value comparison, not epsilon: `scale`/`fit` only ever hold a value
  // this module itself produced via createTimelineScale, so this compares a
  // stored value to itself, not two independently-derived computations (the
  // float rule targets the latter — see timeline-state.ts's commit()).
  function commit(nextState: TimelineZoomState, nextFit: TimelineFitRequest | undefined): TimelineScaleSnapshot {
    const prev = snapshot();
    const nextFitValue = nextFit ?? null;
    const nextScale = createTimelineScale(nextState, nextFitValue ?? undefined);
    const changed =
      nextScale.state !== prev.state ||
      nextScale.pxPerSecond !== prev.pxPerSecond ||
      nextFitValue?.durationSecs !== prev.fit?.durationSecs ||
      nextFitValue?.viewportWidthPx !== prev.fit?.viewportWidthPx;
    scale = nextScale;
    fit = nextFitValue;
    const next = snapshot();
    if (changed) {
      for (const listener of [...listeners]) listener(next);
    }
    return next;
  }

  return {
    getScale: () => scale,
    getSnapshot: snapshot,
    setState: (state, nextFit) => commit(state, nextFit),
    reset: () => commit(TIMELINE_SCALE_DEFAULT_STATE, undefined),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** The one shared instance — same "one owner" convention as
 *  sessionTimelineMarks in timeline-state.ts. */
export const sessionTimelineScaleModel: TimelineScaleModel = createTimelineScaleModel();

export function isTimelineScaleState(value: unknown): value is TimelineZoomState {
  return typeof value === 'string' && (TIMELINE_SCALE_STATES as readonly string[]).includes(value);
}

export function createTimelineScaleTestHook(model: TimelineScaleModel): TimelineScaleTestHook {
  return {
    setState(state, fit) {
      // state arrives from an untyped page.evaluate() caller, so it must be
      // validated before it can reach the model.
      if (!isTimelineScaleState(state)) {
        throw new Error(`Unknown timeline scale state "${String(state)}" — use one of: ${TIMELINE_SCALE_STATES.join(', ')}`);
      }
      return model.setState(state, fit);
    },
    getState: () => model.getSnapshot(),
    reset: () => model.reset(),
  };
}

/** Installs (enabled) or removes (disabled) the test hook at
 *  target[TIMELINE_SCALE_HOOK_KEY]. Returns an uninstall closure when
 *  installed, or null when the key was left/made absent. */
export function installTimelineScaleTestHook(
  target: Record<string, unknown>,
  enabled: boolean,
  model: TimelineScaleModel = sessionTimelineScaleModel,
): (() => void) | null {
  if (!enabled) {
    delete target[TIMELINE_SCALE_HOOK_KEY];
    return null;
  }
  target[TIMELINE_SCALE_HOOK_KEY] = createTimelineScaleTestHook(model);
  return () => { delete target[TIMELINE_SCALE_HOOK_KEY]; };
}
