// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { CHURCH_NAME_DEBOUNCE_MS, createChurchNameCommitter } from './church-name-debounce';

function fakeScheduler() {
  const scheduled: { handle: number; cb: () => void }[] = [];
  const cancelled: number[] = [];
  const scheduledMs: number[] = [];
  let next = 1;
  return {
    scheduled,
    cancelled,
    scheduledMs,
    schedule(cb: () => void, ms: number) {
      const handle = next++;
      scheduled.push({ handle, cb });
      scheduledMs.push(ms);
      return handle;
    },
    cancel(handle: number) {
      cancelled.push(handle);
    },
    runLast() {
      scheduled[scheduled.length - 1].cb();
    },
  };
}

describe('createChurchNameCommitter', () => {
  it('settles a burst of typing into one commit carrying the final value', () => {
    const scheduler = fakeScheduler();
    const commits: string[] = [];
    const committer = createChurchNameCommitter({
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
      commit: (value) => commits.push(value),
    });

    committer.change('G');
    committer.change('Gr');
    committer.change('Grace Chapel');
    scheduler.runLast();

    expect(commits).toEqual(['Grace Chapel']);
  });

  it('issues no commit for intermediate typed values', () => {
    const scheduler = fakeScheduler();
    const commits: string[] = [];
    const committer = createChurchNameCommitter({
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
      commit: (value) => commits.push(value),
    });

    committer.change('G');
    committer.change('Gr');
    committer.change('Grace Chapel');

    expect(commits).toHaveLength(0);
    scheduler.runLast();
    expect(commits).toHaveLength(1);
    expect(commits).not.toContain('G');
    expect(commits).not.toContain('Gr');
  });

  it('cancels the previously scheduled handle on each change, leaving exactly one outstanding', () => {
    const scheduler = fakeScheduler();
    const committer = createChurchNameCommitter({
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
      commit: () => {},
    });

    committer.change('G');
    committer.change('Gr');
    committer.change('Grace');

    expect(scheduler.cancelled).toEqual([1, 2]);
    expect(scheduler.scheduled).toHaveLength(3);
  });

  it('defaults the debounce window to CHURCH_NAME_DEBOUNCE_MS', () => {
    const scheduler = fakeScheduler();
    const committer = createChurchNameCommitter({
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
      commit: () => {},
    });

    committer.change('Grace');

    expect(scheduler.scheduledMs).toEqual([CHURCH_NAME_DEBOUNCE_MS]);
  });

  it('honors an overridden delayMs', () => {
    const scheduler = fakeScheduler();
    const committer = createChurchNameCommitter({
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
      commit: () => {},
      delayMs: 50,
    });

    committer.change('Grace');

    expect(scheduler.scheduledMs).toEqual([50]);
  });

  it('flush() commits the pending value immediately and cancels the outstanding timer', () => {
    const scheduler = fakeScheduler();
    const commits: string[] = [];
    const committer = createChurchNameCommitter({
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
      commit: (value) => commits.push(value),
    });

    committer.change('Grace Chapel');
    committer.flush();

    expect(commits).toEqual(['Grace Chapel']);
    expect(scheduler.cancelled).toEqual([1]);

    // Even if the (already-cancelled) callback still fires, flush already
    // cleared the pending value, so nothing further commits.
    scheduler.runLast();
    expect(commits).toEqual(['Grace Chapel']);
  });

  it('flush() with nothing pending issues no commit', () => {
    const scheduler = fakeScheduler();
    const commits: string[] = [];
    const committer = createChurchNameCommitter({
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
      commit: (value) => commits.push(value),
    });

    committer.flush();

    expect(commits).toHaveLength(0);
  });

  it('cancel() drops the pending value without committing it', () => {
    const scheduler = fakeScheduler();
    const commits: string[] = [];
    const committer = createChurchNameCommitter({
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
      commit: (value) => commits.push(value),
    });

    committer.change('Grace Chapel');
    committer.cancel();
    scheduler.runLast();

    expect(commits).toHaveLength(0);
    expect(scheduler.cancelled).toEqual([1]);
  });

  it('treats an empty string as a real value to persist', () => {
    const scheduler = fakeScheduler();
    const commits: string[] = [];
    const committer = createChurchNameCommitter({
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
      commit: (value) => commits.push(value),
    });

    committer.change('');
    scheduler.runLast();

    expect(commits).toEqual(['']);
  });
});
