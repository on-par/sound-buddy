// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { PROFILES, GRID_FREQS, compareToProfile } from '../../../packages/audio-engine/src/profiles/index.js';
import SpectrumDisplay from './SpectrumDisplay';
import {
  bandDbFromSpectrum,
  bandLevelsFromCurve,
  levelMatchedTarget,
  eqBarsHTML,
  spectrumLegendHTML,
  eqCentroidHTML,
  type SpectrumData,
} from './spectrum-display';

const flatProfile = PROFILES.find((p) => p.id === 'flat')!;

// Shaped like the e2e FAKE_ANALYSIS fixture: bands + a full-grid curve + centroid.
const fixtureSpectrum: SpectrumData = {
  bands: {
    subBass: -40, bass: -30, lowMid: -25, mid: -16, highMid: -22, presence: -28, brilliance: -35,
  },
  curve: {
    freqs: GRID_FREQS,
    db: GRID_FREQS.map((_, i) => -20 + Math.sin(i) * 3),
  },
  spectralCentroid: 1500,
  contentType: 'music',
};

function renderMarkup(props: Parameters<typeof SpectrumDisplay>[0]): string {
  return renderToString(createElement(SpectrumDisplay, props));
}

describe('SpectrumDisplay', () => {
  it('renders bars, legend, and centroid via the shared module functions (markup identity)', () => {
    const bandDb = bandDbFromSpectrum(fixtureSpectrum);
    const target = levelMatchedTarget(fixtureSpectrum.curve!, flatProfile);
    const targetBandDb = bandLevelsFromCurve({ freqs: fixtureSpectrum.curve!.freqs, db: target });
    const cmp = compareToProfile(fixtureSpectrum.curve, flatProfile);
    const expectedChart = eqBarsHTML(bandDb, targetBandDb);
    const expectedLegend = spectrumLegendHTML(flatProfile, cmp, true);
    const expectedCentroid = eqCentroidHTML(fixtureSpectrum);

    const html = renderMarkup({ spectrum: fixtureSpectrum, idealProfile: flatProfile, isAutoProfile: true });

    expect(html).toContain(expectedChart);
    expect(html).toContain(expectedLegend);
    expect(html).toContain(expectedCentroid);
  });

  it('falls back to bars-only (no target overlay, no legend) when there is no curve', () => {
    const spectrum: SpectrumData = { bands: fixtureSpectrum.bands, spectralCentroid: 0 };
    const html = renderMarkup({ spectrum, idealProfile: flatProfile });

    expect(html).not.toContain('eq-target-svg');
    expect(html).not.toContain('spectrum-legend');
    expect(html).toContain('id="spectrum-chart"');
  });

  it('falls back when the curve is too short or grid-mismatched', () => {
    const tooShort: SpectrumData = { curve: { freqs: [20], db: [-10] } };
    const mismatched: SpectrumData = { curve: { freqs: [20, 200, 2000], db: [-10, -20] } };
    expect(renderMarkup({ spectrum: tooShort, idealProfile: flatProfile })).not.toContain('eq-target-svg');
    expect(renderMarkup({ spectrum: mismatched, idealProfile: flatProfile })).not.toContain('eq-target-svg');
  });

  it('suppresses the target overlay and legend in live mode even with a curve and profile', () => {
    const html = renderMarkup({ spectrum: fixtureSpectrum, idealProfile: flatProfile, isLive: true });

    expect(html).not.toContain('eq-target-svg');
    expect(html).not.toContain('spectrum-legend');
  });

  it('falls back when no idealProfile is given', () => {
    const html = renderMarkup({ spectrum: fixtureSpectrum });

    expect(html).not.toContain('eq-target-svg');
    expect(html).not.toContain('spectrum-legend');
  });

  it('carries contentClass on the root element', () => {
    const html = renderMarkup({ spectrum: fixtureSpectrum, contentClass: 'foo' });
    expect(html).toContain('class="foo"');
  });
});
