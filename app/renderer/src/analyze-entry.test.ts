// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import {
  analyzeModeOf,
  droppedAudioPath,
  decideAnalyzeHomeAutoListen,
  effectiveSecondaryDeviceName,
  shouldYieldLiveToFileResult,
} from './analyze-entry';

describe('effectiveSecondaryDeviceName (#1604)', () => {
  it('prefers the live in-memory name when it is non-empty', () => {
    expect(effectiveSecondaryDeviceName('MOTU M2', 'UMIK-1')).toBe('MOTU M2');
  });

  it('falls back to the persisted name when the live name is empty', () => {
    expect(effectiveSecondaryDeviceName('', 'UMIK-1')).toBe('UMIK-1');
  });

  it('is empty when both the live and persisted names are empty', () => {
    expect(effectiveSecondaryDeviceName('', '')).toBe('');
  });

  it('treats a null persisted name as empty', () => {
    expect(effectiveSecondaryDeviceName('', null)).toBe('');
  });

  it('treats an undefined persisted name as empty', () => {
    expect(effectiveSecondaryDeviceName('', undefined)).toBe('');
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

// #1646: Analyze defaults to Live on every landing — a configured room mic
// or not (no device listens on the system default input) — so the device no
// longer factors into the boot verdict at all.
describe('decideAnalyzeHomeAutoListen (#1577, #1646)', () => {
  it('starts listening on the Analyze home when not already listening', () => {
    expect(decideAnalyzeHomeAutoListen({ currentMode: 'analyze', listening: false })).toBe('startListening');
  });

  it('does not start when already listening', () => {
    expect(decideAnalyzeHomeAutoListen({ currentMode: 'analyze', listening: true })).toBe('skip');
  });

  it.each(['live', 'reportcard'])('does not start when the current mode is %s, not analyze', (currentMode) => {
    expect(decideAnalyzeHomeAutoListen({ currentMode, listening: false })).toBe('skip');
  });
});

// #1646: a file-derived result (a new analysis, or a history entry) must hand
// the Analyze stage to File mode, or the Live rail would hide it.
describe('shouldYieldLiveToFileResult (#1646)', () => {
  const idle = { isAnalyzing: false, historySummary: null };

  it('yields when a file analysis starts', () => {
    expect(shouldYieldLiveToFileResult(idle, { isAnalyzing: true, historySummary: null })).toBe(true);
  });

  it('does not yield while an analysis keeps running or when it finishes', () => {
    const running = { isAnalyzing: true, historySummary: null };
    expect(shouldYieldLiveToFileResult(running, running)).toBe(false);
    expect(shouldYieldLiveToFileResult(running, idle)).toBe(false);
  });

  it('yields when a history entry is loaded', () => {
    const summary = { file: 'a.json' };
    expect(shouldYieldLiveToFileResult(idle, { isAnalyzing: false, historySummary: summary })).toBe(true);
  });

  it('does not yield when the same history entry stays loaded or is cleared', () => {
    const loaded = { isAnalyzing: false, historySummary: { file: 'a.json' } };
    expect(shouldYieldLiveToFileResult(loaded, loaded)).toBe(false);
    expect(shouldYieldLiveToFileResult(loaded, idle)).toBe(false);
  });

  it('does not yield on an unrelated change', () => {
    expect(shouldYieldLiveToFileResult(idle, { ...idle })).toBe(false);
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
