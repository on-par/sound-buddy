// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { ALL_FEATURE_FLAGS_OFF, FEATURE_FLAG_IDS, FEATURE_FLAGS_ENV, resolveFeatureFlags } from './feature-flags';

describe('resolveFeatureFlags', () => {
  it('resolves every flag to false when the env var is absent', () => {
    const flags = resolveFeatureFlags({});
    for (const id of FEATURE_FLAG_IDS) expect(flags[id]).toBe(false);
  });

  it('resolves every flag to false for an empty value', () => {
    const flags = resolveFeatureFlags({ [FEATURE_FLAGS_ENV]: '' });
    for (const id of FEATURE_FLAG_IDS) expect(flags[id]).toBe(false);
  });

  it('resolves every flag to false for a whitespace-only value', () => {
    const flags = resolveFeatureFlags({ [FEATURE_FLAGS_ENV]: '   ' });
    for (const id of FEATURE_FLAG_IDS) expect(flags[id]).toBe(false);
  });

  it("'all' turns every flag on", () => {
    const flags = resolveFeatureFlags({ [FEATURE_FLAGS_ENV]: 'all' });
    for (const id of FEATURE_FLAG_IDS) expect(flags[id]).toBe(true);
  });

  it("'ALL' turns every flag on (case-insensitive)", () => {
    const flags = resolveFeatureFlags({ [FEATURE_FLAGS_ENV]: 'ALL' });
    for (const id of FEATURE_FLAG_IDS) expect(flags[id]).toBe(true);
  });

  it("a comma-separated list turns on exactly the named ids", () => {
    const flags = resolveFeatureFlags({ [FEATURE_FLAGS_ENV]: 'console, ringOut' });
    expect(flags).toEqual({
      reportCard: false, directory: false, session: false,
      console: true, buildGuide: false, ringOut: true,
    });
  });

  it('a whitespace-separated, lowercase list turns on exactly the named ids', () => {
    const flags = resolveFeatureFlags({ [FEATURE_FLAGS_ENV]: 'session buildguide' });
    expect(flags).toEqual({
      reportCard: false, directory: false, session: true,
      console: false, buildGuide: true, ringOut: false,
    });
  });

  it('ignores unknown tokens', () => {
    const flags = resolveFeatureFlags({ [FEATURE_FLAGS_ENV]: 'bogus' });
    for (const id of FEATURE_FLAG_IDS) expect(flags[id]).toBe(false);
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(resolveFeatureFlags({}))).toBe(true);
    expect(Object.isFrozen(resolveFeatureFlags({ [FEATURE_FLAGS_ENV]: 'all' }))).toBe(true);
  });

  it('returns a fresh object on every call, not a shared instance', () => {
    expect(resolveFeatureFlags({})).not.toBe(resolveFeatureFlags({}));
  });
});

describe('ALL_FEATURE_FLAGS_OFF', () => {
  it('has a false entry for every FEATURE_FLAG_IDS id', () => {
    for (const id of FEATURE_FLAG_IDS) expect(ALL_FEATURE_FLAGS_OFF[id]).toBe(false);
    expect(Object.keys(ALL_FEATURE_FLAGS_OFF).sort()).toEqual([...FEATURE_FLAG_IDS].sort());
  });

  it('is frozen', () => {
    expect(Object.isFrozen(ALL_FEATURE_FLAGS_OFF)).toBe(true);
  });
});
