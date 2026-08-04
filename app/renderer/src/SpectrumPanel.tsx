// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Container island mounted into `#spectrum-island` (TD-001 slice 4, #422;
// rewritten slice 6a, #695): now owns the full spectrum-panel surface —
// empty/loading/error status (<SpectrumStatus>), the curve/bars
// (<SpectrumDisplay>), and the spectrogram scrubber + playback transport
// (<SpectrogramScrubber>) — driven entirely by spectrumStore. Renders null
// while inline-app.js still owns `#spectrum-imperative` (`panelState ===
// 'meters'`: live/soundcheck meters, the DAW shell — slices 6b-6f). The one
// remaining DOM-applier effect below keeps the panel's still-inline chrome
// (title/stats-row/ideal-profile-wrap, island-vs-imperative visibility) in
// sync — see spectrum-chrome.ts's spectrumChromeView.

import { useEffect } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useSpectrumStore } from './stores/spectrumStore';
import { spectrumChromeView, spectrumStatusView } from './spectrum-chrome';
import { hasUsableCurve } from './spectrum-display';
import SpectrumDisplay from './SpectrumDisplay';
import SpectrumStatus from './SpectrumStatus';
import SpectrogramScrubber from './SpectrogramScrubber';

export default function SpectrumPanel() {
  const { spectrumData, idealProfile, isAutoProfile, panelState, panelText, stagesDone, selectedFrame, filePath } =
    useStoreShallow(useSpectrumStore, (s) => ({
      spectrumData: s.spectrumData,
      idealProfile: s.idealProfile,
      isAutoProfile: s.isAutoProfile,
      panelState: s.panelState,
      panelText: s.panelText,
      stagesDone: s.stagesDone,
      selectedFrame: s.selectedFrame,
      filePath: s.filePath,
    }));

  const hasCurve = spectrumData ? hasUsableCurve(spectrumData) : false;
  const chrome = spectrumChromeView({ panelState, hasCurve });

  /* c8 ignore start -- chrome DOM applier; no jsdom in this harness
     (renderToString doesn't run effects, and the constitution forbids adding
     a new test framework) — exercised by tests/e2e/report-card-spectrum.spec.ts.
     spectrumChromeView's derivation (what to show/hide/title) is fully
     unit-tested in spectrum-chrome.test.ts. */
  useEffect(() => {
    const island = document.getElementById('spectrum-island');
    if (island) island.style.display = chrome.showIsland ? '' : 'none';
    const imperative = document.getElementById('spectrum-imperative');
    if (imperative) imperative.style.display = chrome.showImperative ? '' : 'none';
    if (chrome.title != null) {
      const titleEl = document.getElementById('spectrum-title');
      if (titleEl) titleEl.textContent = chrome.title;
    }
    if (chrome.showStats != null) {
      const statsRow = document.getElementById('stats-row');
      if (statsRow) statsRow.style.display = chrome.showStats ? 'flex' : 'none';
    }
    if (chrome.showIdealProfile != null) {
      const ipWrap = document.getElementById('ideal-profile-wrap');
      if (ipWrap) ipWrap.style.display = chrome.showIdealProfile ? 'flex' : 'none';
    }
  }, [chrome.showIsland, chrome.showImperative, chrome.title, chrome.showStats, chrome.showIdealProfile]);
  /* c8 ignore stop */

  if (panelState === 'meters') return null;

  const status = spectrumStatusView(panelState, panelText);
  if (status) return <SpectrumStatus view={status} stagesDone={stagesDone} />;

  if (!spectrumData) return null;

  return (
    <>
      <SpectrumDisplay spectrum={spectrumData} idealProfile={idealProfile} isAutoProfile={isAutoProfile} selectedFrame={selectedFrame} />
      <SpectrogramScrubber spectrum={spectrumData} idealProfile={idealProfile} filePath={filePath} />
    </>
  );
}
