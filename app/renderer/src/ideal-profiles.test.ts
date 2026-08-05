// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { PROFILES as AE_PROFILES, GRID_FREQS } from '@sound-buddy/audio-engine/dist/profiles/index.js';
import {
  customProfileId,
  isAutoSelected,
  resolveActiveProfile,
  profileSelectOptions,
  selectedCustomProfile,
  curveEditorInit,
  type IdealCurvesApi,
} from './ideal-profiles';
import type { CustomIdealProfile } from '../../electron/ipc/api';
import type { SpectrumData } from './spectrum-display';

// ideal-curves is a plain classic script (window.idealCurves / module.exports)
// — require the real implementation, same pattern as ideal-curves.test.ts.
const curves = require('../ideal-curves.js') as IdealCurvesApi;

const customProfile = (overrides: Partial<CustomIdealProfile> = {}): CustomIdealProfile => ({
  id: 'sanctuary-ref',
  label: 'Sanctuary reference',
  description: 'Custom ideal curve',
  freqs: GRID_FREQS,
  dbOffsets: GRID_FREQS.map(() => 0),
  source: 'manual',
  createdAt: '2026-07-08T12:00:00Z',
  updatedAt: '2026-07-08T12:00:00Z',
  ...overrides,
});

const usableSpectrum = (contentType?: string): SpectrumData => ({
  contentType,
  curve: { freqs: GRID_FREQS, db: GRID_FREQS.map(() => -20) },
});

describe('customProfileId', () => {
  it('strips the custom: prefix', () => {
    expect(customProfileId('custom:abc')).toBe('abc');
  });

  it('returns empty string for a non-custom value', () => {
    expect(customProfileId('flat')).toBe('');
    expect(customProfileId('')).toBe('');
  });
});

describe('isAutoSelected', () => {
  it('is true for an empty selection', () => {
    expect(isAutoSelected('')).toBe(true);
  });

  it('is false for an explicit selection', () => {
    expect(isAutoSelected('flat')).toBe(false);
  });
});

describe('resolveActiveProfile', () => {
  it('resolves a custom profile hit, tagging it with source: custom', () => {
    const custom = customProfile();
    const result = resolveActiveProfile('custom:sanctuary-ref', [custom], null);
    expect(result.label).toBe('Sanctuary reference');
    expect((result as { source?: string }).source).toBe('custom');
  });

  it('falls back to flat when the custom id is missing (miss) — a non-empty selectedId short-circuits the content-type default', () => {
    const result = resolveActiveProfile('custom:does-not-exist', [], usableSpectrum('speech'));
    expect(result.id).toBe('flat');
  });

  it('resolves the auto default by content type when nothing is selected', () => {
    expect(resolveActiveProfile('', [], usableSpectrum('speech')).id).toBe('speech-podcast');
    expect(resolveActiveProfile('', [], usableSpectrum('music')).id).toBe('worship-service');
  });

  it('resolves an explicit built-in id regardless of content type', () => {
    const result = resolveActiveProfile('broadcast', [], usableSpectrum('music'));
    expect(result.id).toBe('broadcast');
  });

  it('falls back to flat when there is no spectrum and no selection', () => {
    expect(resolveActiveProfile('', [], null).id).toBe('flat');
  });
});

describe('profileSelectOptions', () => {
  it('lists Auto, every built-in profile, then Create new curve… when there are no custom profiles', () => {
    const options = profileSelectOptions([]);
    expect(options[0]).toEqual({ value: '', label: 'Auto (by content)', group: 'builtin' });
    AE_PROFILES.forEach((p, i) => {
      expect(options[i + 1]).toEqual({ value: p.id, label: p.label, group: 'builtin' });
    });
    expect(options[options.length - 1]).toEqual({ value: '__new', label: 'Create new curve…', group: 'action' });
    expect(options.some((o) => o.group === 'custom')).toBe(false);
  });

  it('inserts custom profiles (value custom:<id>) between the built-ins and the action entry', () => {
    const custom = customProfile();
    const options = profileSelectOptions([custom]);
    const customOption = options.find((o) => o.group === 'custom');
    expect(customOption).toEqual({ value: 'custom:sanctuary-ref', label: 'Sanctuary reference', group: 'custom' });
    expect(options[options.length - 1].value).toBe('__new');
  });
});

describe('selectedCustomProfile', () => {
  it('returns the matching custom profile for a custom: selection', () => {
    const custom = customProfile();
    expect(selectedCustomProfile('custom:sanctuary-ref', [custom])).toEqual(custom);
  });

  it('returns null for a built-in selection', () => {
    expect(selectedCustomProfile('flat', [customProfile()])).toBeNull();
  });

  it('returns null when the custom id has no match', () => {
    expect(selectedCustomProfile('custom:missing', [customProfile()])).toBeNull();
  });
});

describe('curveEditorInit', () => {
  it('starts a new curve from the auto-resolved profile when nothing is selected', () => {
    const init = curveEditorInit('', [], usableSpectrum('speech'), curves);
    expect(init.editingId).toBeNull();
    expect(init.title).toBe('Create Ideal Curve');
    expect(init.name).toBe('Copy of Speech / podcast');
    expect(init.canDelete).toBe(false);
    expect(init.bands).toHaveLength(7);
  });

  it('starts a new curve named "Copy of Flat / neutral" with no spectrum and no selection', () => {
    const init = curveEditorInit('', [], null, curves);
    expect(init.name).toBe('Copy of Flat / neutral');
  });

  it('edits the selected custom profile', () => {
    const custom = customProfile({ label: 'Sanctuary reference' });
    const init = curveEditorInit('custom:sanctuary-ref', [custom], null, curves);
    expect(init.editingId).toBe('sanctuary-ref');
    expect(init.title).toBe('Edit Ideal Curve');
    expect(init.name).toBe('Sanctuary reference');
    expect(init.canDelete).toBe(true);
  });

  it('allows capture when the current analysis has a usable curve', () => {
    const init = curveEditorInit('', [], usableSpectrum('music'), curves);
    expect(init.canCapture).toBe(true);
  });

  it('blocks capture when there is no spectrum', () => {
    const init = curveEditorInit('', [], null, curves);
    expect(init.canCapture).toBe(false);
  });

  it('blocks capture when the spectrum has no usable curve', () => {
    const init = curveEditorInit('', [], { contentType: 'speech' }, curves);
    expect(init.canCapture).toBe(false);
  });
});
