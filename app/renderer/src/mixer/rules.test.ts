// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  EMPTY_RULE_HISTORY,
  CLIP_HOLD_MS,
  OVER_COMP_GR_DB_THRESHOLD,
  OVER_COMP_SUSTAIN_MS,
  GR_DIRECTION_ESTABLISHED,
  ingestMeterFrame,
  ruleIssues,
  trackActive,
  grDbFromMeters,
  linearToDbfs,
  formatDbfs,
} from './rules';

const T0 = 50_000;

function frame(levels: Record<number, number>, count = 4): number[] {
  return Array.from({ length: count }, (_, i) => levels[i + 1] ?? 0.1);
}

describe('dBFS helpers', () => {
  it('reads 1.0 as 0 dBFS and headroom above it as positive', () => {
    expect(linearToDbfs(1)).toBe(0);
    expect(linearToDbfs(2)).toBeCloseTo(6.02, 2);
    expect(linearToDbfs(0)).toBe(-Infinity);
    expect(formatDbfs(2)).toBe('+6.0 dBFS');
    expect(formatDbfs(0.5)).toBe('-6.0 dBFS');
    expect(formatDbfs(0)).toBe('-∞ dBFS');
  });
});

describe('GR scale direction', () => {
  it('is not established, so every GR reading converts to null rather than a guessed dB figure', () => {
    expect(GR_DIRECTION_ESTABLISHED).toBe(false);
    expect(grDbFromMeters([0, 0.5, 1])).toEqual([null, null, null]);
  });

  it('keeps the over-compression rule off on real frames because no GR dB value exists', () => {
    let h = EMPTY_RULE_HISTORY;
    for (let t = 0; t <= OVER_COMP_SUSTAIN_MS * 2; t += 1000) {
      h = ingestMeterFrame(h, frame({}), grDbFromMeters([1, 1, 1, 1]), T0 + t);
    }
    expect(ruleIssues(h, T0 + OVER_COMP_SUSTAIN_MS * 2).filter((i) => i.kind === 'over-compression')).toEqual([]);
  });
});

describe('clipping rule (1.0 = digital full scale)', () => {
  it('raises an Issue card for a channel at or above full scale, with its peak', () => {
    const h = ingestMeterFrame(EMPTY_RULE_HISTORY, frame({ 2: 1.4 }), [], T0);
    const issues = ruleIssues(h, T0);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ key: 'clipping:2', kind: 'clipping', channel: 2, severity: 'issue' });
    expect(issues[0].magnitude).toBeCloseTo(2.92, 2);
    expect(issues[0].diagnosis).toBe('Input is hitting digital full scale (peak +2.9 dBFS)');
  });

  it('ignores a channel just under full scale', () => {
    expect(ruleIssues(ingestMeterFrame(EMPTY_RULE_HISTORY, frame({ 1: 0.999 }), [], T0), T0)).toEqual([]);
  });

  it('holds the card and its highest peak for the hold window after the level drops', () => {
    let h = ingestMeterFrame(EMPTY_RULE_HISTORY, frame({ 1: 1.2 }), [], T0);
    h = ingestMeterFrame(h, frame({ 1: 1.6 }), [], T0 + 200);
    h = ingestMeterFrame(h, frame({ 1: 1.1 }), [], T0 + 400);
    h = ingestMeterFrame(h, frame({ 1: 0.2 }), [], T0 + 400 + CLIP_HOLD_MS);
    const issues = ruleIssues(h, T0 + 400 + CLIP_HOLD_MS);
    expect(issues).toHaveLength(1);
    expect(issues[0].magnitude).toBeCloseTo(linearToDbfs(1.6), 5);
  });

  it('clears after the hold window', () => {
    let h = ingestMeterFrame(EMPTY_RULE_HISTORY, frame({ 1: 1.2 }), [], T0);
    h = ingestMeterFrame(h, frame({}), [], T0 + CLIP_HOLD_MS + 1);
    expect(h.clipPeak).toEqual({});
    expect(ruleIssues(h, T0 + CLIP_HOLD_MS + 1)).toEqual([]);
  });

  it('expires a held clip even when no further frames arrive', () => {
    const h = ingestMeterFrame(EMPTY_RULE_HISTORY, frame({ 3: 1.2 }), [], T0);
    expect(ruleIssues(h, T0 + CLIP_HOLD_MS + 1)).toEqual([]);
  });

  it('starts a fresh peak when a new clip begins after the hold window', () => {
    let h = ingestMeterFrame(EMPTY_RULE_HISTORY, frame({ 1: 3 }), [], T0);
    h = ingestMeterFrame(h, frame({ 1: 1.1 }), [], T0 + CLIP_HOLD_MS + 1);
    expect(h.clipPeak[1]).toBe(1.1);
  });
});

describe('over-compression rule on synthetic GR dB frames', () => {
  const heavy = (db: number) => [null, db, null, null];

  it('raises a Check card only after GR stays over the threshold for the sustain window', () => {
    let h = ingestMeterFrame(EMPTY_RULE_HISTORY, frame({}), heavy(OVER_COMP_GR_DB_THRESHOLD + 2), T0);
    expect(ruleIssues(h, T0)).toEqual([]);
    h = ingestMeterFrame(h, frame({}), heavy(OVER_COMP_GR_DB_THRESHOLD + 4), T0 + OVER_COMP_SUSTAIN_MS);
    const issues = ruleIssues(h, T0 + OVER_COMP_SUSTAIN_MS);
    expect(issues).toEqual([
      {
        key: 'over-compression:2',
        kind: 'over-compression',
        channel: 2,
        severity: 'check',
        magnitude: OVER_COMP_GR_DB_THRESHOLD + 4,
        diagnosis: 'Compressor is holding heavy gain reduction',
      },
    ]);
  });

  it('resets the sustain clock when GR dips under the threshold', () => {
    let h = ingestMeterFrame(EMPTY_RULE_HISTORY, frame({}), heavy(20), T0);
    h = ingestMeterFrame(h, frame({}), heavy(2), T0 + 1000);
    h = ingestMeterFrame(h, frame({}), heavy(20), T0 + 2000);
    expect(h.overCompSince[2]).toBe(T0 + 2000);
    expect(ruleIssues(h, T0 + OVER_COMP_SUSTAIN_MS + 1000)).toEqual([]);
  });
});

describe('trackActive', () => {
  it('stamps first-seen time, keeps it while active, and forgets it once resolved', () => {
    const clip = ruleIssues(ingestMeterFrame(EMPTY_RULE_HISTORY, frame({ 1: 1.2 }), [], T0), T0);
    const first = trackActive(EMPTY_RULE_HISTORY, clip, T0);
    expect(first.issues[0].activeSince).toBe(T0);
    const second = trackActive(first.history, clip, T0 + 5000);
    expect(second.issues[0].activeSince).toBe(T0);
    const cleared = trackActive(second.history, [], T0 + 6000);
    expect(cleared.history.activeSince).toEqual({});
  });
});
