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
  });
});

function renderMarkup(): string {
  return renderToString(createElement(SpectrumPanel));
}

describe('SpectrumPanel', () => {
  it('renders nothing when there is no spectrum data', () => {
    expect(renderMarkup()).toBe('');
  });

  it('renders the no-curve bar fallback when spectrumData has no curve', () => {
    useSpectrumStore.getState().setSpectrumFromAnalysis({
      spectrum: { bands: { subBass: -20, bass: -18, lowMid: -22, mid: -16, highMid: -25, presence: -30, brilliance: -35 } },
    });

    const html = renderMarkup();

    expect(html).toContain('id="spectrum-chart"');
    expect(html).toContain('veq-bar');
    expect(html).not.toContain('sb-spectrum-curve');
    expect(html).toContain('id="spectrum-frames-host"');
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

  it('renders the frames host as a stable, empty mount point regardless of curve state', () => {
    useSpectrumStore.getState().setSpectrumFromAnalysis({ spectrum: { bands: { bass: -10 } } });
    expect(renderMarkup()).toContain('<div id="spectrum-frames-host"></div>');
  });
});
