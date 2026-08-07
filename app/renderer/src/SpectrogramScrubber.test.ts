// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import SpectrogramScrubber from './SpectrogramScrubber';
import { useSpectrumStore } from './stores/spectrumStore';
import { spectrumTransport } from './spectrum-transport';
import { heatmapSVG, timeAxisHTML, type SpectrumData } from './spectrum-display';

afterEach(() => {
  useSpectrumStore.setState({ selectedFrame: null, fallbackDuration: 0 });
});

function renderMarkup(spectrum: SpectrumData, idealProfile: Parameters<typeof SpectrogramScrubber>[0]['idealProfile'] = null, filePath: string | null = null): string {
  return renderToString(createElement(SpectrogramScrubber, { spectrum, idealProfile, filePath }));
}

const multiFrameSpectrum: SpectrumData = {
  bands: { subBass: -40, bass: -30, lowMid: -25, mid: -16, highMid: -22, presence: -28, brilliance: -35 },
  curve: { freqs: [20, 60, 250, 500, 2000, 4000, 6000], db: [-10, -20, -30, -40, -50, -60, -70] },
  frames: [
    { t: 0, db: [-10, -20, -30, -40, -50, -60, -70], rms: -20, class: 'music' },
    { t: 1, db: [-12, -22, -32, -42, -52, -62, -72], rms: -22, class: 'speech' },
    { t: 2, db: [-14, -24, -34, -44, -54, -64, -74], rms: -24, class: 'silence' },
  ],
};

const singleFrameSpectrum: SpectrumData = {
  ...multiFrameSpectrum,
  frames: [multiFrameSpectrum.frames![0]],
};

describe('SpectrogramScrubber', () => {
  it('returns null when the spectrum has no frames', () => {
    expect(renderMarkup({ bands: {} })).toBe('');
    expect(renderMarkup({ bands: {}, frames: [] })).toBe('');
  });

  it('renders the head/transport/heatmap/time-axis structure with the expected IDs', () => {
    const html = renderMarkup(multiFrameSpectrum);
    expect(html).toContain('class="spectro-scrub"');
    expect(html).toContain('class="spectro-head"');
    expect(html).toContain('id="scrub-readout"');
    expect(html).toContain('id="scrub-reset"');
    expect(html).toContain('class="spectro-transport"');
    expect(html).toContain('id="spectro-play-btn"');
    expect(html).toContain('id="spectro-time"');
    expect(html).toContain('id="spectrum-heatmap"');
    expect(html).toContain('id="spectro-playhead"');
  });

  it('embeds the shared heatmap SVG and time-axis markup verbatim', () => {
    const html = renderMarkup(multiFrameSpectrum);
    expect(html).toContain(heatmapSVG(multiFrameSpectrum.frames!));
    expect(html).toContain(timeAxisHTML(multiFrameSpectrum.frames!));
  });

  it('shows the "click a column to scrub" hint for a multi-frame spectrum', () => {
    expect(renderMarkup(multiFrameSpectrum)).toContain('click a column to scrub');
  });

  it('shows the "single frame — short file" hint for a one-frame spectrum', () => {
    expect(renderMarkup(singleFrameSpectrum)).toContain('single frame — short file');
  });

  it('scrub-reset carries "active" only when a frame is pinned', () => {
    expect(renderMarkup(multiFrameSpectrum)).not.toMatch(/id="scrub-reset"[^>]*active/);

    useSpectrumStore.getState().selectFrame(1);
    expect(renderMarkup(multiFrameSpectrum)).toMatch(/class="scrub-reset active"/);
  });

  it('the readout reflects the whole-file average when no frame is pinned', () => {
    expect(renderMarkup(multiFrameSpectrum)).toContain('Whole-file average');
  });

  it('the readout reflects the pinned frame when selectedFrame is set', () => {
    useSpectrumStore.getState().selectFrame(1);
    const html = renderMarkup(multiFrameSpectrum);
    expect(html).not.toContain('Whole-file average');
    expect(html).toContain('Speech');
  });

  it('falls back to the whole-file average readout when selectedFrame is out of range', () => {
    useSpectrumStore.getState().selectFrame(99);
    expect(renderMarkup(multiFrameSpectrum)).toContain('Whole-file average');
  });

  it('reflects a playing transport at mount (icon/class/aria-label)', () => {
    const spy = vi.spyOn(spectrumTransport, 'isPlaying').mockReturnValue(true);
    try {
      const html = renderMarkup(multiFrameSpectrum);
      expect(html).toContain('spectro-play-btn playing');
      expect(html).toContain('aria-label="Pause"');
    } finally {
      spy.mockRestore();
    }
  });
});
