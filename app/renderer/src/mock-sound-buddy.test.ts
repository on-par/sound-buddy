// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { createMockSoundBuddy } from './mock-sound-buddy';

describe('createMockSoundBuddy', () => {
  it('resolves defaults and records the call', async () => {
    const mock = createMockSoundBuddy();
    await expect(mock.api.getAppVersion()).resolves.toBe('');
    expect(mock.calls).toContainEqual({ method: 'getAppVersion', args: [] });
  });

  it('resolves an override value instead of the default', async () => {
    const mock = createMockSoundBuddy({ getLicense: async () => ({ tier: 'pro' }) });
    await expect(mock.api.getLicense()).resolves.toEqual({ tier: 'pro' });
  });

  it('emit() fires callbacks registered via an on* method', () => {
    const mock = createMockSoundBuddy();
    const received: unknown[] = [];
    mock.api.onAnalysisProgress((data) => received.push(data));
    mock.emit('onAnalysisProgress', { status: 'running' });
    expect(received).toEqual([{ status: 'running' }]);
  });
});
