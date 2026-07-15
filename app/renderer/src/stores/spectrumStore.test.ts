// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { extractSpectrum, useSpectrumStore } from './spectrumStore';

afterEach(() => {
  useSpectrumStore.setState({
    spectrumData: null,
    bands: {},
    spectralCentroid: null,
    rolloff: null,
    idealProfile: null,
    isAutoProfile: false,
  });
});

describe('spectrumStore', () => {
  it('starts with a fresh, empty state', () => {
    expect(useSpectrumStore.getState().spectrumData).toBeNull();
    expect(useSpectrumStore.getState().bands).toEqual({});
    expect(useSpectrumStore.getState().spectralCentroid).toBeNull();
    expect(useSpectrumStore.getState().rolloff).toBeNull();
    expect(useSpectrumStore.getState().idealProfile).toBeNull();
    expect(useSpectrumStore.getState().isAutoProfile).toBe(false);
  });

  describe('setIdealProfile', () => {
    it('sets the active profile and auto flag', () => {
      const profile = { label: 'Speech / podcast', dbOffsets: [1, 2, 3] };

      useSpectrumStore.getState().setIdealProfile(profile, true);

      expect(useSpectrumStore.getState().idealProfile).toBe(profile);
      expect(useSpectrumStore.getState().isAutoProfile).toBe(true);
    });

    it('is independent of spectrumData — clearSpectrum does not reset it', () => {
      const profile = { label: 'Flat / neutral', dbOffsets: [0, 0] };
      useSpectrumStore.getState().setIdealProfile(profile, false);

      useSpectrumStore.getState().clearSpectrum();

      expect(useSpectrumStore.getState().idealProfile).toBe(profile);
      expect(useSpectrumStore.getState().isAutoProfile).toBe(false);
    });

    it('can be cleared back to null', () => {
      useSpectrumStore.getState().setIdealProfile({ label: 'Flat', dbOffsets: [] }, false);

      useSpectrumStore.getState().setIdealProfile(null, false);

      expect(useSpectrumStore.getState().idealProfile).toBeNull();
    });
  });

  it('extracts and populates all four fields from an analysis result', () => {
    const analysis = {
      spectrum: {
        bands: { bass: -12, mid: -6 },
        spectralCentroid: 1500.6,
        spectralRolloff85: 8000.4,
        curve: { freqs: [100], db: [-10] },
      },
    };

    useSpectrumStore.getState().setSpectrumFromAnalysis(analysis);

    expect(useSpectrumStore.getState().spectrumData).toEqual(analysis.spectrum);
    expect(useSpectrumStore.getState().bands).toEqual({ bass: -12, mid: -6 });
    expect(useSpectrumStore.getState().spectralCentroid).toBe(1500.6);
    expect(useSpectrumStore.getState().rolloff).toBe(8000.4);
  });

  it('defaults missing optionals to empty bands and null numbers', () => {
    const analysis = { spectrum: { curve: { freqs: [], db: [] } } };

    useSpectrumStore.getState().setSpectrumFromAnalysis(analysis);

    expect(useSpectrumStore.getState().spectrumData).toEqual(analysis.spectrum);
    expect(useSpectrumStore.getState().bands).toEqual({});
    expect(useSpectrumStore.getState().spectralCentroid).toBeNull();
    expect(useSpectrumStore.getState().rolloff).toBeNull();
  });

  it.each([null, 42, {}, { spectrum: 'nope' }])(
    'clears state for an unusable analysis value: %j',
    (bad) => {
      useSpectrumStore.setState({
        spectrumData: { bands: { bass: -1 } },
        bands: { bass: -1 },
        spectralCentroid: 1,
        rolloff: 1,
      });

      useSpectrumStore.getState().setSpectrumFromAnalysis(bad);

      expect(useSpectrumStore.getState().spectrumData).toBeNull();
      expect(useSpectrumStore.getState().bands).toEqual({});
      expect(useSpectrumStore.getState().spectralCentroid).toBeNull();
      expect(useSpectrumStore.getState().rolloff).toBeNull();
    }
  );

  it('clearSpectrum resets a populated store', () => {
    useSpectrumStore.setState({
      spectrumData: { bands: { bass: -1 } },
      bands: { bass: -1 },
      spectralCentroid: 1,
      rolloff: 1,
    });

    useSpectrumStore.getState().clearSpectrum();

    expect(useSpectrumStore.getState().spectrumData).toBeNull();
    expect(useSpectrumStore.getState().bands).toEqual({});
    expect(useSpectrumStore.getState().spectralCentroid).toBeNull();
    expect(useSpectrumStore.getState().rolloff).toBeNull();
  });

  describe('extractSpectrum', () => {
    it('returns the spectrum object for a valid shape', () => {
      const analysis = { spectrum: { bands: { bass: -1 } } };
      expect(extractSpectrum(analysis)).toEqual(analysis.spectrum);
    });

    it.each([
      ['null', null],
      ['a number', 42],
      ['an object with no spectrum', {}],
      ['a non-object spectrum', { spectrum: 'nope' }],
      ['a null spectrum', { spectrum: null }],
    ])('returns null for %s', (_label, bad) => {
      expect(extractSpectrum(bad)).toBeNull();
    });
  });
});
