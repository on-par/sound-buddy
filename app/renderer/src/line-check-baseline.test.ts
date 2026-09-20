// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { evaluateRules } from '@sound-buddy/audio-engine/dist/analyze/rules.js';
import { capturedStripProfile, type CapturedStripRef } from './line-check-baseline';
import { symptomOptionsFor } from './report-card';
import type { CustomIdealProfile } from '../../electron/ipc/api';

const STRIP: CapturedStripRef = { deviceName: 'Scarlett 18i20', token: '0' };

const CAPTURED: CustomIdealProfile = {
  id: 'lc-scarlett-18i20-0-abcd1234',
  label: 'Kick (line check)',
  description: 'Captured from the Kick line check',
  freqs: [80, 200, 400, 800, 1600, 3000, 4200, 5000, 7000, 10000],
  dbOffsets: [8, 8, 4, 0, 0, -4, -6, -6, -10, -10],
  source: 'analysis',
};

describe('capturedStripProfile', () => {
  it('returns null when there is no override recorded for the strip', () => {
    expect(capturedStripProfile({}, [CAPTURED], STRIP)).toBeNull();
    expect(capturedStripProfile(null, [CAPTURED], STRIP)).toBeNull();
    expect(capturedStripProfile(undefined, [CAPTURED], STRIP)).toBeNull();
  });

  it('returns null when the override is a built-in instrument-profile id, not a capture', () => {
    const overrides = { 'Scarlett 18i20': { '0': 'kick' } };
    expect(capturedStripProfile(overrides, [CAPTURED], STRIP)).toBeNull();
  });

  it('returns null when the override is the bare "custom:" prefix with no id', () => {
    const overrides = { 'Scarlett 18i20': { '0': 'custom:' } };
    expect(capturedStripProfile(overrides, [CAPTURED], STRIP)).toBeNull();
  });

  it('returns null when the override references an id not present in customProfiles (dangling)', () => {
    const overrides = { 'Scarlett 18i20': { '0': `custom:${CAPTURED.id}` } };
    expect(capturedStripProfile(overrides, [], STRIP)).toBeNull();
  });

  it('returns null when the referenced profile has an unusable curve shape', () => {
    const unusable: CustomIdealProfile = { ...CAPTURED, dbOffsets: [] };
    const overrides = { 'Scarlett 18i20': { '0': `custom:${unusable.id}` } };
    expect(capturedStripProfile(overrides, [unusable], STRIP)).toBeNull();
  });

  it('returns the captured profile for a matching custom: override (AC1/AC2)', () => {
    const overrides = { 'Scarlett 18i20': { '0': `custom:${CAPTURED.id}` } };
    expect(capturedStripProfile(overrides, [CAPTURED], STRIP)).toEqual(CAPTURED);
  });

  it('scopes the lookup to the strip\'s own device + token', () => {
    const overrides = {
      'Scarlett 18i20': { '0': `custom:${CAPTURED.id}` },
      'X32': { '0': `custom:${CAPTURED.id}` },
    };
    expect(capturedStripProfile(overrides, [CAPTURED], { deviceName: 'Scarlett 18i20', token: '1' })).toBeNull();
    expect(capturedStripProfile(overrides, [CAPTURED], { deviceName: 'X32', token: '2' })).toBeNull();
  });
});

// AC3 regression: a bass-heavy capture must suppress the "muddy" symptom for
// its own strip. Fixture grid mirrors packages/audio-engine's
// rules.test.ts "baseline-relative evaluation" fixture (same FREQS/TILTED/
// baseline values) so this proves the same shape that silences `muddy` at
// the rules-engine layer also does so end-to-end through a captured profile.
describe('AC3 — captured baseline suppresses a symptom that fires against flat', () => {
  const FREQS = [80, 200, 400, 800, 1600, 3000, 4200, 5000, 7000, 10000];
  // Pink-like tilt: 60-250 Hz sits 8 dB above the 500 Hz-2 kHz body — reads
  // "Muddy" against a flat reference, but is exactly this strip's own shape.
  const TILTED = [-22, -22, -26, -30, -30, -34, -36, -36, -40, -40];
  const curve = { freqs: FREQS, db: TILTED };

  it('fires `muddy` against the flat context (no capture for this strip)', () => {
    expect(symptomOptionsFor(undefined).baseline).toBeNull();
    const hits = evaluateRules(curve, undefined, symptomOptionsFor(undefined));
    expect(hits.map((h) => h.rule.id)).toContain('muddy');
  });

  it('is silent against the captured baseline matching this strip\'s own shape', () => {
    const captured: CustomIdealProfile = {
      id: 'lc-scarlett-18i20-0-abcd1234',
      label: 'Kick (line check)',
      description: 'Captured from the Kick line check',
      freqs: FREQS,
      dbOffsets: [8, 8, 4, 0, 0, -4, -6, -6, -10, -10],
      source: 'analysis',
    };
    const overrides = { 'Scarlett 18i20': { '0': `custom:${captured.id}` } };
    const resolved = capturedStripProfile(overrides, [captured], STRIP);
    expect(resolved).not.toBeNull();

    const ctx = { idealProfile: resolved, isAutoProfile: false };
    const hits = evaluateRules(curve, undefined, symptomOptionsFor(ctx));
    expect(hits.map((h) => h.rule.id)).not.toContain('muddy');
    expect(hits).toEqual([]);
  });
});
