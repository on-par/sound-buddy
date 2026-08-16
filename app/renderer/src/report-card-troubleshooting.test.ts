// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// #862 troubleshooting-section view test: dispatches real evaluateRules hits
// through the #861 renderer store to deterministic rule-narrative prose. Hits
// are built by calling the real engine against the same fixed frequency grid
// rules.test.ts uses — not hand-mocked — so the section renders exactly what
// the shipped engine fires.
import { describe, it, expect, vi } from 'vitest';
import { evaluateRules } from '@sound-buddy/audio-engine/dist/analyze/rules.js';
import type { SpectrumCurve } from '@sound-buddy/audio-engine/dist/types.js';
import {
  troubleshootHits,
  troubleshootingSectionView,
  TROUBLESHOOTING_EMPTY_MESSAGE,
} from './report-card-troubleshooting';

// Same fixed ascending grid as packages/audio-engine/src/analyze/rules.test.ts,
// so every measured/reference band in the generic rule table lands on known
// indices:
//   [60,250)      -> indices 0,1
//   [250,500)     -> index 2
//   [500,2000)    -> indices 3,4
//   [2000,4000)   -> index 5   (also [2500,3500))
//   [3500,6000)   -> indices 6,7
//   [6000,12000)  -> indices 8,9
const FREQS = [80, 200, 400, 800, 1600, 3000, 4200, 5000, 7000, 10000];

// Fires only `harsh`: the 2–4 kHz band (idx 5) sits 20 dB over the 500 Hz–2 kHz
// body (idx 3,4 = -40); `edgy`'s 3.5–6 kHz reference (idx 6,7 = -25) makes its
// excess 5 < 8; `muddy` has 0 excess over its reference.
const SINGLE_HIT_DB = [-40, -40, -40, -40, -40, -20, -25, -25, -40, -40];

// Fires both `harsh` (excess 20) and `edgy` (excess 20, reference idx 6,7 =
// -40); stable sort keeps table order -> ['harsh', 'edgy'].
const MULTI_HIT_DB = [-40, -40, -40, -40, -40, -20, -40, -40, -40, -40];

function curve(db: number[]): SpectrumCurve {
  return { freqs: FREQS, db };
}

describe('troubleshootingSectionView (#862)', () => {
  it('maps a single fired `harsh` rule to its exact deterministic narrative', () => {
    const fired = evaluateRules(curve(SINGLE_HIT_DB));

    expect(troubleshootingSectionView(fired)).toEqual([
      {
        ruleId: 'harsh',
        narrative:
          'The mix reads as Quacky/harsh: the 2–4 kHz region sits 20.0 dB above the ' +
          '500 Hz–2 kHz body (threshold 6 dB). Cut 2–4 kHz to tame it.',
      },
    ]);
  });

  it('renders multiple hits in evaluateRules order, each with its own symptom', () => {
    const fired = evaluateRules(curve(MULTI_HIT_DB));

    const items = troubleshootingSectionView(fired);
    expect(items.map((item) => item.ruleId)).toEqual(['harsh', 'edgy']);
    expect(items[0].narrative).toContain('Quacky/harsh');
    expect(items[0].narrative).toContain('2–4 kHz region sits 20.0 dB above the 500 Hz–2 kHz body');
    expect(items[1].narrative).toContain('Edgy/piezo');
    expect(items[1].narrative).toContain('2.5–3.5 kHz region sits 20.0 dB above the 3.5–6 kHz body');
  });

  it('returns [] for an empty hit list (no fired rules)', () => {
    expect(troubleshootingSectionView([])).toEqual([]);
  });

  it('returns [] when no rules fire for a flat curve', () => {
    const flat = curve(Array(FREQS.length).fill(-40));
    expect(troubleshootingSectionView(evaluateRules(flat))).toEqual([]);
  });

  it('pins the calm no-hits empty-state copy for a clean mix (#863)', () => {
    expect(TROUBLESHOOTING_EMPTY_MESSAGE).toBe('No harshness issues detected — the measured bands sit clean.');
  });
});

describe('troubleshootHits (#862)', () => {
  it('skips hits gracefully when the rule type has no registered renderer (ADR-0038 miss)', () => {
    const fired = evaluateRules(curve(MULTI_HIT_DB));
    expect(fired.length).toBeGreaterThan(0);

    expect(troubleshootHits(fired, null)).toEqual([]);
  });

  it('never invokes the renderer for an empty hit list — zero renderer/LLM calls (#863)', () => {
    const spy = vi.fn();

    expect(troubleshootHits([], spy)).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});