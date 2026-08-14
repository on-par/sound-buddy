// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  classifySourceName,
  sourceHintForDevice,
  boardSourceHint,
  type MeasurementSourceKind,
} from './measurement-source-hints';

// The measurement-source quality/calibration hints (#461) — a single pure
// module owns the source taxonomy, the classification copy, and the
// device-name heuristics the two Settings → Audio pickers render underneath
// their selects. No store, IPC, or analysis involvement: the hints are
// informational only.

describe('classifySourceName', () => {
  it.each([
    'Built-in Microphone',
    'MacBook Pro Microphone',
  ])('classifies built-in computer microphones (%s)', (name) => {
    expect(classifySourceName(name)).toBe('builtin-mic');
  });

  it.each([
    'USB Measurement Mic',
    'miniDSP UMIK-1',
    'Behringer ECM8000',
  ])('classifies dedicated measurement mics (%s)', (name) => {
    expect(classifySourceName(name)).toBe('measurement-mic');
  });

  it('prefers measurement markers when both measurement and builtin markers match', () => {
    expect(classifySourceName('MacBook Pro Measurement Microphone')).toBe('measurement-mic');
  });

  it.each([
    'Scarlett 18i20',
    'Aggregate Device',
    'USB Mic',
    '',
  ])('classifies everything else as external (%s)', (name) => {
    expect(classifySourceName(name)).toBe('external-mic');
  });

  it('is case-insensitive — mixed case classifies the same as lowercase', () => {
    expect(classifySourceName('uSb MeAsUrEmEnT MiC')).toBe('measurement-mic');
    expect(classifySourceName('bUiLt-In MiCrOpHoNe')).toBe('builtin-mic');
  });
});

describe('sourceHintForDevice', () => {
  it('returns the matching kind and classification for each device-classified source', () => {
    const cases: Array<[string, MeasurementSourceKind, string]> = [
      ['Built-in Microphone', 'builtin-mic', 'Built-in computer microphone'],
      ['USB Measurement Mic', 'measurement-mic', 'Dedicated measurement microphone'],
      ['Scarlett 18i20', 'external-mic', 'External audio input'],
    ];
    for (const [deviceName, kind, classification] of cases) {
      const hint = sourceHintForDevice(deviceName);
      expect(hint.kind).toBe(kind);
      expect(hint.classification).toBe(classification);
    }
  });

  it('cautions that a built-in mic is not a calibrated measurement', () => {
    expect(sourceHintForDevice('Built-in Microphone').copy).toContain('not a calibrated measurement');
  });

  it('marks a dedicated measurement mic as a stronger source', () => {
    expect(sourceHintForDevice('USB Measurement Mic').copy).toContain('stronger source');
  });
});

describe('boardSourceHint', () => {
  it('is the board / crowd-mic type with hedged EQ-for-recording copy', () => {
    const hint = boardSourceHint();
    expect(hint.kind).toBe('board');
    expect(hint.classification).toBe('Board / crowd mic');
    expect(hint.copy).toContain('may already be EQ');
  });
});
