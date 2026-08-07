// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { spectrumChromeView, spectrumStatusView, SPECTRUM_TITLE } from './spectrum-chrome';

describe('spectrumChromeView', () => {
  it('meters: hides the island, shows the imperative container, and leaves everything else null', () => {
    const view = spectrumChromeView({ panelState: 'meters', hasCurve: true });
    expect(view).toEqual({ showIsland: false, showImperative: true, title: null, showStats: null, showIdealProfile: null });
  });

  it('empty: shows the island, hides stats/ideal-profile, curve title', () => {
    const view = spectrumChromeView({ panelState: 'empty', hasCurve: false });
    expect(view).toEqual({ showIsland: true, showImperative: false, title: SPECTRUM_TITLE.curve, showStats: false, showIdealProfile: false });
  });

  it('loading: same shape as empty', () => {
    const view = spectrumChromeView({ panelState: 'loading', hasCurve: false });
    expect(view.showStats).toBe(false);
    expect(view.showIdealProfile).toBe(false);
    expect(view.title).toBe(SPECTRUM_TITLE.curve);
  });

  it('error: same shape as empty', () => {
    const view = spectrumChromeView({ panelState: 'error', hasCurve: false });
    expect(view.showStats).toBe(false);
    expect(view.showIdealProfile).toBe(false);
  });

  it('populated with a curve: stats + ideal-profile shown, curve title', () => {
    const view = spectrumChromeView({ panelState: 'populated', hasCurve: true });
    expect(view).toEqual({ showIsland: true, showImperative: false, title: SPECTRUM_TITLE.curve, showStats: true, showIdealProfile: true });
  });

  it('populated without a curve: stats shown, ideal-profile hidden, meters title', () => {
    const view = spectrumChromeView({ panelState: 'populated', hasCurve: false });
    expect(view).toEqual({ showIsland: true, showImperative: false, title: SPECTRUM_TITLE.meters, showStats: true, showIdealProfile: false });
  });
});

describe('spectrumStatusView', () => {
  it('empty: waveform icon, default copy when panelText is blank', () => {
    expect(spectrumStatusView('empty', '')).toEqual({
      kind: 'empty', icon: 'waveform', iconSize: 44, text: 'Load a file to see the spectrum', sub: '',
    });
  });

  it('empty: uses panelText when provided (per-mode empty copy)', () => {
    expect(spectrumStatusView('empty', 'Waiting for live audio…')).toEqual({
      kind: 'empty', icon: 'waveform', iconSize: 44, text: 'Waiting for live audio…', sub: '',
    });
  });

  it('loading: fixed copy, ignores panelText', () => {
    expect(spectrumStatusView('loading', 'ignored')).toEqual({
      kind: 'loading', icon: 'waveform', iconSize: 44, text: 'Analyzing audio…', sub: '',
    });
  });

  it('error: alert icon, default sub copy when panelText is blank', () => {
    expect(spectrumStatusView('error', '')).toEqual({
      kind: 'error', icon: 'alert-triangle', iconSize: 40, text: 'Analysis failed', sub: 'Couldn’t decode the audio stream.',
    });
  });

  it('error: uses panelText as the sub copy when provided', () => {
    expect(spectrumStatusView('error', 'Disk read failed')).toEqual({
      kind: 'error', icon: 'alert-triangle', iconSize: 40, text: 'Analysis failed', sub: 'Disk read failed',
    });
  });

  it('populated and meters: no status view (the island/imperative container renders instead)', () => {
    expect(spectrumStatusView('populated', '')).toBeNull();
    expect(spectrumStatusView('meters', '')).toBeNull();
  });
});
