// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { isAbortError } from './ipc/timeout';
import { isAbortError as engineIsAbortError } from '@sound-buddy/audio-engine/dist/analyze/timeout.js';

describe('isAbortError', () => {
  it('is true for an error named AbortError', () => {
    expect(isAbortError({ name: 'AbortError' })).toBe(true);
  });

  it('is true for an error with code ABORT_ERR', () => {
    expect(isAbortError({ code: 'ABORT_ERR' })).toBe(true);
  });

  it('is false for a plain Error', () => {
    expect(isAbortError(new Error('boom'))).toBe(false);
  });

  it('is false for null/undefined', () => {
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});

describe('isAbortError drift guard (#745)', () => {
  // The app's copy of isAbortError cannot delegate to the engine at runtime
  // (run-analysis.ts, its only caller, is deliberately Electron-free — see
  // ipc/timeout.ts). This proves the two hand-maintained copies still behave
  // identically over a fixed set of AbortError-shaped, plain-Error, null, and
  // undefined fixtures.
  const fixtures = [{ name: 'AbortError' }, { code: 'ABORT_ERR' }, new Error('boom'), null, undefined];

  it('produces identical results to the audio-engine copy', () => {
    for (const f of fixtures) {
      expect(isAbortError(f)).toBe(engineIsAbortError(f));
    }
  });
});
