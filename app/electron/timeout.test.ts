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

  // Cancellation (#125) — an aborted run must reject as an AbortError, not be
  // mislabeled a SubprocessTimeoutError (both surface `killed: true`).
  it('rejects with an AbortError, not a SubprocessTimeoutError, when aborted', async () => {
    const controller = new AbortController();
    const run = execFileWithTimeout(
      'sleep',
      ['5'],
      { encoding: 'utf8', signal: controller.signal },
      'sleep test',
      60_000,
    );
    setTimeout(() => controller.abort(), 50);

    await expect(run).rejects.not.toBeInstanceOf(SubprocessTimeoutError);
    await expect(run).rejects.toMatchObject({ code: 'ABORT_ERR' });
  });
});
