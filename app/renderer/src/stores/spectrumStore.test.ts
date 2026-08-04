// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { extractSpectrum, useSpectrumStore, ANALYSIS_STAGES } from './spectrumStore';

afterEach(() => {
  useSpectrumStore.setState({
    spectrumData: null,
    bands: {},
    spectralCentroid: null,
    rolloff: null,
    idealProfile: null,
    isAutoProfile: false,
    panelState: 'empty',
    panelText: '',
    stagesDone: [],
    selectedFrame: null,
    filePath: null,
    fallbackDuration: 0,
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
    expect(useSpectrumStore.getState().panelState).toBe('empty');
    expect(useSpectrumStore.getState().panelText).toBe('');
    expect(useSpectrumStore.getState().stagesDone).toEqual([]);
    expect(useSpectrumStore.getState().selectedFrame).toBeNull();
    expect(useSpectrumStore.getState().filePath).toBeNull();
    expect(useSpectrumStore.getState().fallbackDuration).toBe(0);
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

  it('extracts and populates all four fields from an analysis result, plus the transport inputs and panel state', () => {
    const analysis = {
      filePath: '/tmp/service.wav',
      ffprobe: { format: { durationSeconds: 42.5 } },
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
    expect(useSpectrumStore.getState().filePath).toBe('/tmp/service.wav');
    expect(useSpectrumStore.getState().fallbackDuration).toBe(42.5);
    expect(useSpectrumStore.getState().panelState).toBe('populated');
  });

  it('resets selectedFrame to the whole-file average on a new analysis', () => {
    useSpectrumStore.getState().selectFrame(3);

    useSpectrumStore.getState().setSpectrumFromAnalysis({ spectrum: { bands: { bass: -1 } } });

    expect(useSpectrumStore.getState().selectedFrame).toBeNull();
  });

  it('defaults missing optionals to empty bands and null numbers', () => {
    const analysis = { spectrum: { curve: { freqs: [], db: [] } } };

    useSpectrumStore.getState().setSpectrumFromAnalysis(analysis);

    expect(useSpectrumStore.getState().spectrumData).toEqual(analysis.spectrum);
    expect(useSpectrumStore.getState().bands).toEqual({});
    expect(useSpectrumStore.getState().spectralCentroid).toBeNull();
    expect(useSpectrumStore.getState().rolloff).toBeNull();
    expect(useSpectrumStore.getState().filePath).toBeNull();
    expect(useSpectrumStore.getState().fallbackDuration).toBe(0);
  });

  it.each([null, 42, {}, { spectrum: 'nope' }])(
    'clears state (including panel/transport fields) for an unusable analysis value: %j',
    (bad) => {
      useSpectrumStore.setState({
        spectrumData: { bands: { bass: -1 } },
        bands: { bass: -1 },
        spectralCentroid: 1,
        rolloff: 1,
        panelState: 'populated',
        selectedFrame: 2,
        filePath: '/tmp/a.wav',
        fallbackDuration: 12,
      });

      useSpectrumStore.getState().setSpectrumFromAnalysis(bad);

      expect(useSpectrumStore.getState().spectrumData).toBeNull();
      expect(useSpectrumStore.getState().bands).toEqual({});
      expect(useSpectrumStore.getState().spectralCentroid).toBeNull();
      expect(useSpectrumStore.getState().rolloff).toBeNull();
      expect(useSpectrumStore.getState().panelState).toBe('empty');
      expect(useSpectrumStore.getState().panelText).toBe('');
      expect(useSpectrumStore.getState().selectedFrame).toBeNull();
      expect(useSpectrumStore.getState().filePath).toBeNull();
      expect(useSpectrumStore.getState().fallbackDuration).toBe(0);
    }
  );

  it('clearSpectrum resets a populated store, including panel/transport fields', () => {
    useSpectrumStore.setState({
      spectrumData: { bands: { bass: -1 } },
      bands: { bass: -1 },
      spectralCentroid: 1,
      rolloff: 1,
      panelState: 'populated',
      selectedFrame: 2,
      filePath: '/tmp/a.wav',
      fallbackDuration: 12,
    });

    useSpectrumStore.getState().clearSpectrum();

    expect(useSpectrumStore.getState().spectrumData).toBeNull();
    expect(useSpectrumStore.getState().bands).toEqual({});
    expect(useSpectrumStore.getState().spectralCentroid).toBeNull();
    expect(useSpectrumStore.getState().rolloff).toBeNull();
    expect(useSpectrumStore.getState().panelState).toBe('empty');
    expect(useSpectrumStore.getState().panelText).toBe('');
    expect(useSpectrumStore.getState().selectedFrame).toBeNull();
    expect(useSpectrumStore.getState().filePath).toBeNull();
    expect(useSpectrumStore.getState().fallbackDuration).toBe(0);
  });

  describe('setPanelState', () => {
    it('sets panelState and panelText, defaulting text to empty', () => {
      useSpectrumStore.getState().setPanelState('error', 'boom');
      expect(useSpectrumStore.getState().panelState).toBe('error');
      expect(useSpectrumStore.getState().panelText).toBe('boom');

      useSpectrumStore.getState().setPanelState('empty');
      expect(useSpectrumStore.getState().panelText).toBe('');
    });

    it('resets stagesDone when entering loading, so a re-analysis starts from an unchecked checklist', () => {
      useSpectrumStore.getState().markStageDone('reading');
      expect(useSpectrumStore.getState().stagesDone).toEqual(['reading']);

      useSpectrumStore.getState().setPanelState('loading');

      expect(useSpectrumStore.getState().stagesDone).toEqual([]);
    });

    it('leaves stagesDone untouched for non-loading transitions', () => {
      useSpectrumStore.getState().markStageDone('reading');

      useSpectrumStore.getState().setPanelState('populated');

      expect(useSpectrumStore.getState().stagesDone).toEqual(['reading']);
    });
  });

  describe('markStageDone', () => {
    it('appends a stage without duplicating it', () => {
      useSpectrumStore.getState().markStageDone('reading');
      useSpectrumStore.getState().markStageDone('reading');
      useSpectrumStore.getState().markStageDone('levels');

      expect(useSpectrumStore.getState().stagesDone).toEqual(['reading', 'levels']);
    });
  });

  describe('selectFrame', () => {
    it('sets the selected frame index', () => {
      useSpectrumStore.getState().selectFrame(4);
      expect(useSpectrumStore.getState().selectedFrame).toBe(4);
    });

    it('clears back to the whole-file average with null', () => {
      useSpectrumStore.getState().selectFrame(4);
      useSpectrumStore.getState().selectFrame(null);
      expect(useSpectrumStore.getState().selectedFrame).toBeNull();
    });
  });

  describe('ANALYSIS_STAGES', () => {
    it('lists the three analysis stages in order with display labels', () => {
      expect(ANALYSIS_STAGES).toEqual([
        { stage: 'reading', label: 'Reading file' },
        { stage: 'levels', label: 'Measuring levels' },
        { stage: 'spectrum', label: 'Analyzing spectrum' },
      ]);
    });
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
