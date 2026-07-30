// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, expect, it } from 'vitest';
import { assertTier2Consent, buildReadOnlyOscQuery } from './console-network';

describe('Tier 2 console-network boundary (#378)', () => {
  it('refuses all console work until explicit consent is granted', () => {
    expect(() => assertTier2Consent(false)).toThrow('Enable console-network access from a Tier 2 feature first.');
    expect(() => assertTier2Consent(true)).not.toThrow();
  });

  it('allows only the three documented read operations', () => {
    expect(buildReadOnlyOscQuery('channel-names')).toEqual({ address: '/xinfo', arguments: [] });
    expect(buildReadOnlyOscQuery('levels')).toEqual({ address: '/meters/0', arguments: [] });
    expect(buildReadOnlyOscQuery('routing')).toEqual({ address: '/node', arguments: [] });
  });
});
