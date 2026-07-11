// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { execFileWithTimeout, SubprocessTimeoutError } from './ipc/timeout';

describe('execFileWithTimeout', () => {
  it('kills the child and rejects with SubprocessTimeoutError when it never returns', async () => {
    await expect(
      execFileWithTimeout('sleep', ['5'], { encoding: 'utf8' }, 'sleep test', 100),
    ).rejects.toBeInstanceOf(SubprocessTimeoutError);
  });

  it('resolves normally for a fast process', async () => {
    const { stdout } = await execFileWithTimeout('echo', ['ok'], { encoding: 'utf8' }, 'echo test', 5_000);
    expect(stdout.trim()).toBe('ok');
  });
});
