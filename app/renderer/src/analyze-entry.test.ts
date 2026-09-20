// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { resolveAnalyzeEntry, resolveListenLiveChoice } from './analyze-entry';

describe('resolveAnalyzeEntry (#1485)', () => {
  it('opens the dialog when no secondary measurement device is configured', () => {
    expect(resolveAnalyzeEntry('')).toBe('openDialog');
  });

  it('starts listening when a secondary measurement device is configured', () => {
    expect(resolveAnalyzeEntry('MOTU M2')).toBe('startListening');
  });

  it('depends only on the device name — no settings/feature-tier input exists to vary', () => {
    // resolveAnalyzeEntry's signature takes a single deviceName string; these
    // are the only two device values that matter (configured vs not), and
    // both are asserted above with no settings object involved anywhere.
    expect(resolveAnalyzeEntry('')).not.toBe(resolveAnalyzeEntry('MOTU M2'));
  });
});

describe('resolveListenLiveChoice', () => {
  it('routes to Settings > Audio when no secondary device is configured', () => {
    expect(resolveListenLiveChoice('')).toBe('needsSecondarySource');
  });

  it('starts listening when a secondary device name is remembered', () => {
    expect(resolveListenLiveChoice('MOTU M2')).toBe('startListening');
  });
});
