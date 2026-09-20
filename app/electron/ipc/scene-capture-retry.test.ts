// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  createSceneCaptureWalkState,
  recordWalkSuccess,
  recordWalkFailure,
  isWalkBreakerTripped,
  buildSceneCaptureFailureMessage,
  CONSECUTIVE_FAILURE_BREAKER_LIMIT,
  DEFERRED_PATH_CAP,
} from './scene-capture-retry';

describe('createSceneCaptureWalkState', () => {
  it('starts with no deferred paths and zero consecutive failures', () => {
    const state = createSceneCaptureWalkState();
    expect(state.deferred).toEqual([]);
    expect(state.consecutiveFailures).toBe(0);
  });
});

describe('recordWalkSuccess / recordWalkFailure', () => {
  it('a failure defers the path and increments consecutive failures', () => {
    const state = createSceneCaptureWalkState();
    recordWalkFailure(state, '/ch/01/config');
    expect(state.deferred).toEqual(['/ch/01/config']);
    expect(state.consecutiveFailures).toBe(1);
  });

  it('accumulates deferred paths and consecutive failures across repeated misses', () => {
    const state = createSceneCaptureWalkState();
    recordWalkFailure(state, '/ch/01/config');
    recordWalkFailure(state, '/ch/02/config');
    expect(state.deferred).toEqual(['/ch/01/config', '/ch/02/config']);
    expect(state.consecutiveFailures).toBe(2);
  });

  it('a success resets consecutive failures but does not clear deferred paths', () => {
    const state = createSceneCaptureWalkState();
    recordWalkFailure(state, '/ch/01/config');
    recordWalkFailure(state, '/ch/02/config');
    recordWalkSuccess(state);
    expect(state.consecutiveFailures).toBe(0);
    expect(state.deferred).toEqual(['/ch/01/config', '/ch/02/config']);
  });
});

describe('isWalkBreakerTripped', () => {
  it('is false for a fresh state', () => {
    expect(isWalkBreakerTripped(createSceneCaptureWalkState())).toBe(false);
  });

  it(`is false just below the consecutive-failure limit (${CONSECUTIVE_FAILURE_BREAKER_LIMIT - 1})`, () => {
    const state = createSceneCaptureWalkState();
    for (let i = 0; i < CONSECUTIVE_FAILURE_BREAKER_LIMIT - 1; i++) recordWalkFailure(state, `/p${i}`);
    expect(isWalkBreakerTripped(state)).toBe(false);
  });

  it(`trips once consecutive failures reach the limit (${CONSECUTIVE_FAILURE_BREAKER_LIMIT})`, () => {
    const state = createSceneCaptureWalkState();
    for (let i = 0; i < CONSECUTIVE_FAILURE_BREAKER_LIMIT; i++) recordWalkFailure(state, `/p${i}`);
    expect(isWalkBreakerTripped(state)).toBe(true);
  });

  it('an interleaved success resets the consecutive run so the breaker does not trip', () => {
    const state = createSceneCaptureWalkState();
    for (let i = 0; i < CONSECUTIVE_FAILURE_BREAKER_LIMIT - 1; i++) recordWalkFailure(state, `/p${i}`);
    recordWalkSuccess(state);
    for (let i = 0; i < CONSECUTIVE_FAILURE_BREAKER_LIMIT - 1; i++) recordWalkFailure(state, `/q${i}`);
    expect(isWalkBreakerTripped(state)).toBe(false);
  });

  it(`trips once the deferred cap (${DEFERRED_PATH_CAP}) is reached even with no consecutive run`, () => {
    const state = createSceneCaptureWalkState();
    for (let i = 0; i < DEFERRED_PATH_CAP; i++) {
      recordWalkFailure(state, `/p${i}`);
      recordWalkSuccess(state); // breaks the consecutive run every time
    }
    expect(state.consecutiveFailures).toBe(0);
    expect(isWalkBreakerTripped(state)).toBe(true);
  });

  it(`is false just below the deferred cap (${DEFERRED_PATH_CAP - 1} scattered misses)`, () => {
    const state = createSceneCaptureWalkState();
    for (let i = 0; i < DEFERRED_PATH_CAP - 1; i++) {
      recordWalkFailure(state, `/p${i}`);
      recordWalkSuccess(state);
    }
    expect(isWalkBreakerTripped(state)).toBe(false);
  });
});

describe('buildSceneCaptureFailureMessage', () => {
  it('preserves the exact pre-#1490 wording, naming the path, count, and underlying error', () => {
    const message = buildSceneCaptureFailureMessage(
      '192.168.1.77',
      '/config/auxlink',
      1,
      2103,
      new Error('No reply from console at 192.168.1.77:10023 for "/node" after 4 retries (500ms each)')
    );

    expect(message).toBe(
      'Scene capture failed: the console at 192.168.1.77 did not answer "/config/auxlink" ' +
        '(1 of 2103 paths captured). Nothing was saved — ' +
        'check the console is still powered on and reachable, then run the capture again. ' +
        '(Error: No reply from console at 192.168.1.77:10023 for "/node" after 4 retries (500ms each))'
    );
  });
});
