// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// #1246 regression test: the report card's letter grade and its
// Troubleshooting section must be one judgment, not two. Before this fix, a
// curve that fired a RULE_TABLE rule (e.g. Muddy) could print "A, 99/100 —
// No deductions — Great job!" directly above a Troubleshooting entry naming
// the same symptom, because grading.js and evaluateRules shared nothing. Both
// fixtures below differ ONLY in spectrum.curve, so any grade difference is
// attributable to the fired rule alone.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import type { AnalysisPayload } from '@sound-buddy/shared';
import { evaluateRules } from '@sound-buddy/audio-engine/dist/analyze/rules.js';
import type { SpectrumCurve } from '@sound-buddy/audio-engine/dist/types.js';
import { troubleshootingSectionView } from './report-card-troubleshooting';
import { reportCardSourceFromAnalysis } from './report-card';

const grading = createRequire(import.meta.url)('../grading.js');

// Same fixed ascending grid as rules.test.ts / report-card-troubleshooting.test.ts:
//   [60,250) -> idx 0,1   [500,2000) -> idx 3,4
const FREQS = [80, 200, 400, 800, 1600, 3000, 4200, 5000, 7000, 10000];

// 60-250 Hz (idx 0,1) sits 8.7 dB above the 500 Hz-2 kHz body (idx 3,4):
// -21.3 - (-30) = 8.7, above muddy's 6 dB threshold.
const MUDDY_DB = [-21.3, -21.3, -30, -30, -30, -30, -30, -30, -30, -30];
const FLAT_DB = Array(FREQS.length).fill(-30);

function buildAnalysis(db: number[]): AnalysisPayload {
  return {
    filePath: '/fake/path/muddy.wav',
    sox: {
      samplesRead: 441000,
      lengthSeconds: 10,
      scaledBy: 1,
      maximumAmplitude: 0.9,
      minimumAmplitude: -0.9,
      midlineAmplitude: 0,
      meanNorm: 0.2,
      meanAmplitude: 0.1,
      rmsAmplitude: 0.2,
      maximumDelta: 0.8,
      minimumDelta: 0,
      meanDelta: 0.1,
      rmsDelta: 0.15,
      roughFrequency: 440,
      volumeAdjustment: 0,
      rmsDbfs: -17,
      peakDbfs: -6,
      dynamicRangeDb: 10,
      clipping: false,
    },
    spectrum: {
      spectralCentroid: 1200,
      spectralRolloff85: 4800,
      dynamicRange: 10,
      bands: { subBass: -30, bass: -30, lowMid: -30, mid: -30, highMid: -30, presence: -30, brilliance: -30 },
      curve: { freqs: FREQS, db },
      contentType: null,
      segments: [],
      frames: [],
    },
    ffprobe: {
      format: {
        filename: '/fake/path/muddy.wav',
        formatName: 'wav',
        formatLongName: 'WAV / WAVE (Waveform Audio)',
        durationSeconds: 10,
        sizeBytes: 100,
        bitRate: 800,
        tags: {},
      },
      stream: {
        codecName: 'pcm_s16le',
        codecLongName: 'PCM signed 16-bit little-endian',
        channels: 1,
        channelLayout: 'mono',
        sampleRate: 44100,
        bitDepth: 16,
        bitRate: 705600,
        durationSeconds: 10,
      },
    },
    loudness: null,
  } satisfies AnalysisPayload;
}

const muddyAnalysis = buildAnalysis(MUDDY_DB);
const flatAnalysis = buildAnalysis(FLAT_DB);

describe('grade / Troubleshooting reconciliation (#1246)', () => {
  it('reproduces the reported bug: a Muddy curve names the symptom in BOTH the grade and Troubleshooting', () => {
    const muddyCurve = muddyAnalysis.spectrum!.curve as SpectrumCurve;
    const troubleshooting = troubleshootingSectionView(evaluateRules(muddyCurve));
    expect(troubleshooting.length).toBeGreaterThan(0);
    expect(troubleshooting.some((item) => item.narrative.includes('Muddy'))).toBe(true);

    const src = reportCardSourceFromAnalysis(muddyAnalysis);
    const explanation = grading.explainGrade(src);
    expect(explanation.deductions.length).toBeGreaterThan(0);
    expect(explanation.deductions.some((d: { rule: string }) => d.rule.includes('Muddy'))).toBe(true);
    expect(grading.computeGrade(src)).not.toBe('A');
    const recs: string[] = grading.computeRecommendations(src);
    expect(recs.some((r) => r.includes('Great job!'))).toBe(false);
  });

  it('AC 2: a flat curve fires no rule and grades a clean A with no Troubleshooting entries', () => {
    const flatCurve = flatAnalysis.spectrum!.curve as SpectrumCurve;
    expect(troubleshootingSectionView(evaluateRules(flatCurve))).toEqual([]);

    const src = reportCardSourceFromAnalysis(flatAnalysis);
    const explanation = grading.explainGrade(src);
    expect(explanation.deductions).toEqual([]);
    expect(grading.computeGrade(src)).toBe('A');
    expect(grading.computeRecommendations(src)).toEqual([
      'Great job! No major issues detected — levels and balance are solid.',
    ]);
  });

  it('AC 3: the deduction target renders the fired rule\'s own minExcessDb — defined once, in RULE_TABLE', () => {
    const muddyCurve = muddyAnalysis.spectrum!.curve as SpectrumCurve;
    const fired = evaluateRules(muddyCurve);
    const minExcessDb = fired[0].rule.condition.minExcessDb;

    const src = reportCardSourceFromAnalysis(muddyAnalysis);
    const symptomDeduction = grading.explainGrade(src).deductions.find((d: { rule: string }) =>
      d.rule.startsWith('Tonal symptom'),
    );
    expect(symptomDeduction).toBeDefined();
    expect(symptomDeduction.target).toContain(String(minExcessDb));
  });

  it('the invariant: any Troubleshooting entry implies at least one grade deduction', () => {
    for (const analysis of [muddyAnalysis, flatAnalysis]) {
      const curve = analysis.spectrum!.curve as SpectrumCurve;
      const troubleshooting = troubleshootingSectionView(evaluateRules(curve));
      const src = reportCardSourceFromAnalysis(analysis);
      const explanation = grading.explainGrade(src);
      if (troubleshooting.length > 0) {
        expect(explanation.deductions.length).toBeGreaterThan(0);
      }
    }
  });
});
