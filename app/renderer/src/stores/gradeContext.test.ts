// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { GRID_FREQS } from '@sound-buddy/audio-engine/dist/profiles/index.js';
import { createGradeContextResolver, gradeContext } from './gradeContext';
import type { AppSettings, CustomIdealProfile } from '../../../electron/ipc/api';

const custom: CustomIdealProfile = {
  id: 'sanctuary',
  label: 'Sanctuary',
  description: 'Custom ideal curve',
  freqs: GRID_FREQS,
  dbOffsets: GRID_FREQS.map((f) => (f < 200 ? 6 : 0)),
  source: 'manual',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function resolver(selectedId = '', customProfiles: CustomIdealProfile[] = [], settings: Partial<AppSettings> | null = {}) {
  return createGradeContextResolver({
    idealProfiles: () => ({ selectedId, customProfiles }),
    settings: () => (settings as AppSettings | null),
  });
}

describe('createGradeContextResolver', () => {
  it('Auto resolves by content type for a file and flags it as auto', () => {
    const ctx = resolver().forSpectrum({ contentType: 'speech' });
    expect(ctx.idealProfile?.id).toBe('speech-podcast');
    expect(ctx.isAutoProfile).toBe(true);
    expect(ctx.symptomThresholdOffsetDb).toBe(0);
  });

  it('Auto resolves to the live default when there is no spectrum', () => {
    const ctx = resolver().forSpectrum(null);
    expect(ctx.idealProfile?.id).toBe('worship-service');
    expect(ctx.isAutoProfile).toBe(true);
  });

  it('an explicit or custom pick wins over Auto and is not flagged auto', () => {
    expect(resolver('flat').forSpectrum({ contentType: 'music' }).idealProfile?.id).toBe('flat');
    const ctx = resolver('custom:sanctuary', [custom]).forSpectrum(null);
    expect(ctx.idealProfile?.label).toBe('Sanctuary');
    expect(ctx.isAutoProfile).toBe(false);
  });

  it('reads the rubric symptom offset from settings, defaulting to 0 when unset or settings are null', () => {
    expect(resolver('', [], { gradingRubric: { 'symptoms.thresholdOffsetDb': 2.5 } }).forSpectrum(null).symptomThresholdOffsetDb).toBe(2.5);
    expect(resolver('', [], { gradingRubric: {} }).forSpectrum(null).symptomThresholdOffsetDb).toBe(0);
    expect(resolver('', [], null).forSpectrum(null).symptomThresholdOffsetDb).toBe(0);
  });

  it('liveBaseline carries the live default profile label and its band targets', () => {
    const b = resolver().liveBaseline()!;
    expect(b.label).toBe('Worship service');
    expect(b.isAuto).toBe(true);
    expect(b.bandTargets.subBass).toBeGreaterThan(b.bandTargets.brilliance);
    const c = resolver('custom:sanctuary', [custom]).liveBaseline()!;
    expect(c.label).toBe('Sanctuary');
    expect(c.bandTargets.subBass).toBeGreaterThan(0);
    expect(c.bandTargets.mid).toBeCloseTo(0, 6);
  });

  it('the app resolver reads the real stores (defaults: Auto, no settings)', () => {
    expect(gradeContext.forSpectrum(null).idealProfile?.id).toBe('worship-service');
    expect(gradeContext.liveBaseline()?.label).toBe('Worship service');
  });
});
