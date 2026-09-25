// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import { resolveAnalyzeEntry, resolveListenLiveChoice, analyzeModeOf, droppedAudioPath } from './analyze-entry';

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

describe('analyzeModeOf (#1522)', () => {
  it('is live while listening', () => {
    expect(analyzeModeOf(true)).toBe('live');
  });

  it('is file while not listening', () => {
    expect(analyzeModeOf(false)).toBe('file');
  });
});

describe('droppedAudioPath (#1522)', () => {
  it('returns null when files is null', () => {
    expect(droppedAudioPath(null, vi.fn())).toBeNull();
  });

  it('returns null when files is undefined', () => {
    expect(droppedAudioPath(undefined, vi.fn())).toBeNull();
  });

  it('returns null when files is empty', () => {
    const getPathForFile = vi.fn();
    expect(droppedAudioPath({ length: 0 } as unknown as ArrayLike<File>, getPathForFile)).toBeNull();
    expect(getPathForFile).not.toHaveBeenCalled();
  });

  it('returns null when the resolver returns an empty path', () => {
    const file = { name: 'a.wav' } as unknown as File;
    const getPathForFile = vi.fn(() => '');
    expect(droppedAudioPath([file], getPathForFile)).toBeNull();
    expect(getPathForFile).toHaveBeenCalledWith(file);
  });

  it('resolves the first file only, ignoring extension', () => {
    const first = { name: 'a.scn' } as unknown as File;
    const second = { name: 'b.wav' } as unknown as File;
    const getPathForFile = vi.fn((f: File) => (f === first ? '/tmp/a.scn' : '/tmp/b.wav'));

    expect(droppedAudioPath([first, second], getPathForFile)).toBe('/tmp/a.scn');
    expect(getPathForFile).toHaveBeenCalledTimes(1);
    expect(getPathForFile).toHaveBeenCalledWith(first);
  });
});
