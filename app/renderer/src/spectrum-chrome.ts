// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure derivation of the spectrum panel's chrome (island vs. imperative
// visibility, title, stats-row/ideal-profile-wrap visibility) and the
// empty/loading/error status copy (TD-001 slice 6a, #695) — a faithful
// restatement of the last-writer-wins behavior inline-app.js used to produce
// by calling setSpectrumState and syncSpectrumChrome from separate call
// sites. SpectrumPanel applies spectrumChromeView's output via one effect and
// renders spectrumStatusView's output via <SpectrumStatus>.

import type { SpectrumPanelState } from './stores/spectrumStore';

export const SPECTRUM_TITLE = {
  curve: 'Spectrum · Curve',
  meters: 'Spectrum · Meters',
  live: 'Spectrum · Live EQ',
  liveStopped: 'Spectrum · Live EQ · Stopped',
} as const;

export interface SpectrumChromeView {
  showIsland: boolean;
  showImperative: boolean;
  /** null = leave the node alone (inline-app.js owns it in meters mode). */
  title: string | null;
  showStats: boolean | null;
  showIdealProfile: boolean | null;
}

export function spectrumChromeView(input: { panelState: SpectrumPanelState; hasCurve: boolean }): SpectrumChromeView {
  const { panelState, hasCurve } = input;
  if (panelState === 'meters') {
    return { showIsland: false, showImperative: true, title: null, showStats: null, showIdealProfile: null };
  }
  return {
    showIsland: true,
    showImperative: false,
    title: panelState === 'populated' && !hasCurve ? SPECTRUM_TITLE.meters : SPECTRUM_TITLE.curve,
    showStats: panelState === 'populated',
    showIdealProfile: panelState === 'populated' && hasCurve,
  };
}

export interface SpectrumStatusView {
  kind: 'empty' | 'loading' | 'error';
  icon: 'waveform' | 'alert-triangle';
  iconSize: number;
  text: string;
  sub: string;
}

export function spectrumStatusView(panelState: SpectrumPanelState, panelText: string): SpectrumStatusView | null {
  if (panelState === 'empty') {
    return { kind: 'empty', icon: 'waveform', iconSize: 44, text: panelText || 'Load a file to see the spectrum', sub: '' };
  }
  if (panelState === 'loading') {
    return { kind: 'loading', icon: 'waveform', iconSize: 44, text: 'Analyzing audio…', sub: '' };
  }
  if (panelState === 'error') {
    return { kind: 'error', icon: 'alert-triangle', iconSize: 40, text: 'Analysis failed', sub: panelText || 'Couldn’t decode the audio stream.' };
  }
  return null;
}
