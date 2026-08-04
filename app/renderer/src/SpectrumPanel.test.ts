// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import SpectrumPanel from './SpectrumPanel';
import { useSpectrumStore } from './stores/spectrumStore';

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

function renderMarkup(): string {
  return renderToString(createElement(SpectrumPanel));
}

describe('SpectrumPanel', () => {
  it('renders nothing when panelState is meters (inline-app.js owns #spectrum-imperative)', () => {
    useSpectrumStore.setState({ panelState: 'meters' });
    expect(renderMarkup()).toBe('');
  });

  it('defensively renders nothing for the populated state if spectrumData is somehow absent', () => {
    useSpectrumStore.setState({ panelState: 'populated', spectrumData: null });
    expect(renderMarkup()).toBe('');
  });

  it('renders the default empty status view at boot (default store state)', () => {
    const html = renderMarkup();
    expect(html).toContain('spectrum-empty');
    expect(html).toContain('Load a file to see the spectrum');
  });

  it('renders a per-mode empty status view', () => {
    useSpectrumStore.getState().setPanelState('empty', 'Waiting for live audio…');
    const html = renderMarkup();
    expect(html).toContain('spectrum-empty');
    expect(html).toContain('Waiting for live audio…');
  });

  it('renders the loading status view with the stage stepper', () => {
    useSpectrumStore.getState().setPanelState('loading');
    const html = renderMarkup();
    expect(html).toContain('Analyzing audio…');
    expect(html).toContain('stage-stepper');
  });

  it('renders the error status view', () => {
    useSpectrumStore.getState().setPanelState('error', 'Could not decode audio');
    const html = renderMarkup();
    expect(html).toContain('Analysis failed');
    expect(html).toContain('Could not decode audio');
  });

  it('renders the no-curve bar fallback when spectrumData has no curve', () => {
    useSpectrumStore.getState().setSpectrumFromAnalysis({
      spectrum: { bands: { subBass: -20, bass: -18, lowMid: -22, mid: -16, highMid: -25, presence: -30, brilliance: -35 } },
    });

    const html = renderMarkup();

    expect(html).toContain('id="spectrum-chart"');
    expect(html).toContain('veq-bar');
    expect(html).not.toContain('sb-spectrum-curve');
  });

  it('renders the curve + target overlay when spectrumData has a usable curve and an ideal profile is set', () => {
    useSpectrumStore.getState().setSpectrumFromAnalysis({
      spectrum: {
        bands: { subBass: -20, bass: -18, lowMid: -22, mid: -16, highMid: -25, presence: -30, brilliance: -35 },
        curve: { freqs: [100, 200, 300], db: [-10, -12, -14] },
      },
    });
    useSpectrumStore.getState().setIdealProfile({ label: 'Flat / neutral', dbOffsets: [-10, -12, -14] }, true);

    const html = renderMarkup();

    expect(html).toContain('veq-bar');
    expect(html).toContain('spectrum-legend');
    expect(html).toContain('Flat / neutral');
    expect(html).toContain('(auto)');
  });

  it('mounts the spectrogram scrubber when the populated spectrum has frames', () => {
    useSpectrumStore.getState().setSpectrumFromAnalysis({
      spectrum: {
        bands: { subBass: -20, bass: -18, lowMid: -22, mid: -16, highMid: -25, presence: -30, brilliance: -35 },
        curve: { freqs: [100, 200, 300], db: [-10, -12, -14] },
        frames: [{ t: 0, db: [-10, -12, -14], rms: -20, class: 'music' }],
      },
    });

    const html = renderMarkup();

    expect(html).toContain('spectro-scrub');
    expect(html).toContain('id="spectrum-heatmap"');
  });

  it('does not mount the spectrogram scrubber when the populated spectrum has no frames', () => {
    useSpectrumStore.getState().setSpectrumFromAnalysis({
      spectrum: { bands: { bass: -10 } },
    });

    const html = renderMarkup();

    expect(html).not.toContain('spectro-scrub');
  });
});
